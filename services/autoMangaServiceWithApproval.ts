import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { loggingService, trackPerformance } from './loggingService';
import { duplicateChecker } from './duplicateChecker';

export type MangaSource = {
  id: string;
  name: string;
  baseUrl: string;
  type: 'api' | 'scraping';
  isActive: boolean;
  lastSyncAt?: string;
  config: {
    apiKey?: string;
    headers?: Record<string, string>;
    rateLimit?: number;
    selectors?: {
      title?: string;
      description?: string;
      author?: string;
      artist?: string;
      genre?: string;
      status?: string;
      coverImage?: string;
      chapters?: string;
      chapterTitle?: string;
      chapterNumber?: string;
      chapterPages?: string;
    };
  };
};

type MangaData = {
  title: string;
  description?: string;
  author?: string;
  artist?: string;
  genre?: string[];
  status: 'ongoing' | 'completed' | 'hiatus' | 'cancelled';
  coverImageUrl?: string;
  mangaType: 'manga' | 'manhwa' | 'manhua';
  sourceId: string;
  sourceMangaId: string;
  chapters?: ChapterData[];
};

type ChapterData = {
  chapterNumber: number;
  title?: string;
  description?: string;
  pages: string[];
  sourceChapterId: string;
};

export interface SyncResult {
  newManga: number;
  newChapters: number;
  duplicatesSkipped: number;
  pendingReview: number;
  errors: string[];
}

class AutoMangaServiceWithApproval {
  private sources: Map<string, MangaSource> = new Map();
  private isRunning = false;

  constructor() {
    this.loadSources();
  }

  @trackPerformance
  async loadSources() {
    try {
      await loggingService.info('بدء تحميل مصادر المانجا', {}, 'sources');

      const { data: sources, error } = await supabase
        .from('manga_sources')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

      this.sources.clear();
      sources?.forEach(source => {
        this.sources.set(source.id, {
          id: source.id,
          name: source.name,
          baseUrl: source.base_url,
          type: source.type,
          isActive: source.is_active,
          lastSyncAt: source.last_sync_at,
          config: source.config as MangaSource['config']
        });
      });

      await loggingService.info(`تم تحميل ${this.sources.size} مصدر للمانجا`, { count: this.sources.size }, 'sources');
    } catch (error) {
      await loggingService.error('خطأ في تحميل مصادر المانجا', error, 'sources');
      throw error;
    }
  }

  @trackPerformance
  async syncAllSources(): Promise<SyncResult> {
    if (this.isRunning) {
      const message = 'المزامنة قيد التشغيل بالفعل';
      await loggingService.warn(message, {}, 'sync');
      throw new Error(message);
    }

    this.isRunning = true;
    await loggingService.info('بدء مزامنة جميع المصادر مع نظام الموافقة', {}, 'sync');

    const totalResult: SyncResult = {
      newManga: 0,
      newChapters: 0,
      duplicatesSkipped: 0,
      pendingReview: 0,
      errors: []
    };

    try {
      for (const [sourceId, source] of this.sources) {
        if (!source.isActive) {
          await loggingService.debug(`تخطي المصدر غير النشط: ${source.name}`, {}, 'sync', sourceId);
          continue;
        }

        await loggingService.logSyncStart(sourceId, source.name);
        
        try {
          const sourceResult = await this.syncSource(source);
          
          totalResult.newManga += sourceResult.newManga;
          totalResult.newChapters += sourceResult.newChapters;
          totalResult.duplicatesSkipped += sourceResult.duplicatesSkipped;
          totalResult.pendingReview += sourceResult.pendingReview;
          totalResult.errors.push(...sourceResult.errors);

          await loggingService.logSyncSuccess(sourceId, source.name, {
            newManga: sourceResult.newManga,
            newChapters: sourceResult.newChapters,
            duplicates: sourceResult.duplicatesSkipped
          });

          // إشعار خاص بالمحتوى المعلق
          if (sourceResult.pendingReview > 0) {
            await loggingService.info(
              `${sourceResult.pendingReview} عنصر جديد في انتظار المراجعة من ${source.name}`,
              { pendingItems: sourceResult.pendingReview },
              'review',
              sourceId
            );
          }

        } catch (error) {
          totalResult.errors.push(`${source.name}: ${error.message}`);
          await loggingService.logSyncError(sourceId, source.name, error);
        }

        // انتظار بين المصادر لتجنب ��رهاق الخوادم
        const delay = source.config.rateLimit ? (60000 / source.config.rateLimit) * 1000 : 60000;
        await this.delay(delay);
      }

      // إرسال إشعار للمدراء إذا كان هناك محتوى للمراجعة
      if (totalResult.pendingReview > 0) {
        await this.notifyAdminsAboutPendingContent(totalResult.pendingReview);
      }

      await loggingService.info('اكتملت مزامنة جميع المصادر', totalResult, 'sync');
      
    } catch (error) {
      await loggingService.error('خطأ عام في المزامنة', error, 'sync');
      totalResult.errors.push(`خطأ عام: ${error.message}`);
    } finally {
      this.isRunning = false;
    }

    return totalResult;
  }

  @trackPerformance
  private async syncSource(source: MangaSource): Promise<SyncResult> {
    const result: SyncResult = {
      newManga: 0,
      newChapters: 0,
      duplicatesSkipped: 0,
      pendingReview: 0,
      errors: []
    };

    try {
      let mangaList: MangaData[] = [];

      if (source.type === 'api') {
        mangaList = await this.fetchFromAPI(source);
      } else {
        await loggingService.warn(`Web scraping غير مدعوم حالياً للمصدر: ${source.name}`, {}, 'sync', source.id);
        return result;
      }

      await loggingService.info(`تم جلب ${mangaList.length} مانجا من المصدر: ${source.name}`, { count: mangaList.length }, 'sync', source.id);

      for (const mangaData of mangaList) {
        try {
          const processResult = await this.processMangaDataWithApproval(mangaData, source);
          
          if (processResult.isNew) {
            result.newManga++;
            result.pendingReview++; // المانجا الجديدة تحتاج موافقة
            await loggingService.info(`تمت إضافة مانجا جديدة للمراجعة: ${mangaData.title}`, {}, 'approval', source.id);
          } else if (processResult.isDuplicate) {
            result.duplicatesSkipped++;
            await loggingService.logDuplicateSkipped(mangaData.title, processResult.reason || 'مانجا موجودة مسبقاً', source.id);
          }

          result.newChapters += processResult.newChapters;
          if (processResult.newChapters > 0) {
            result.pendingReview += processResult.newChapters; // الفصول الجديدة تحتاج موافقة
          }

        } catch (error) {
          result.errors.push(`خطأ في معالجة ${mangaData.title}: ${error.message}`);
          await loggingService.error(`خطأ في معالجة ا��مانجا: ${mangaData.title}`, error, 'manga', source.id);
        }
      }

      // تحديث آخر وقت مزامنة
      await this.updateSourceLastSync(source.id);

    } catch (error) {
      result.errors.push(error.message);
      throw error;
    }

    return result;
  }

  @trackPerformance
  private async fetchFromAPI(source: MangaSource): Promise<MangaData[]> {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...source.config.headers
    };

    if (source.config.apiKey) {
      headers['Authorization'] = `Bearer ${source.config.apiKey}`;
    }

    try {
      await loggingService.debug(`جاري جلب البيانات من API: ${source.baseUrl}`, { headers: Object.keys(headers) }, 'api', source.id);

      const response = await fetch(`${source.baseUrl}/api/manga`, {
        headers,
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const parsedData = this.parseAPIResponse(data, source);

      await loggingService.info(`تم تحليل ${parsedData.length} مانجا من API`, { count: parsedData.length }, 'api', source.id);
      
      return parsedData;
    } catch (error) {
      await loggingService.error(`خطأ في API للمصدر ${source.name}`, error, 'api', source.id);
      return [];
    }
  }

  private parseAPIResponse(data: any, source: MangaSource): MangaData[] {
    const mangaList: MangaData[] = [];

    try {
      const items = Array.isArray(data) ? data : data.manga || data.results || [];

      for (const item of items) {
        try {
          const manga: MangaData = {
            title: item.title || item.name,
            description: item.description || item.summary,
            author: item.author,
            artist: item.artist,
            genre: this.parseGenres(item.genre),
            status: this.normalizeStatus(item.status),
            coverImageUrl: item.coverImage || item.thumbnail || item.image,
            mangaType: this.detectMangaType(item.type || source.name),
            sourceId: source.id,
            sourceMangaId: String(item.id || item.slug),
            chapters: item.chapters ? this.parseChapters(item.chapters) : undefined
          };

          if (manga.title && manga.sourceMangaId) {
            mangaList.push(manga);
          }
        } catch (error) {
          await loggingService.warn(`خطأ في تحليل مانجا فردية`, { item: item.title || 'غير معروف', error: error.message }, 'parser', source.id);
        }
      }
    } catch (error) {
      await loggingService.error('خطأ في تحليل استجابة API', error, 'parser', source.id);
    }

    return mangaList;
  }

  private parseGenres(genre: any): string[] {
    if (Array.isArray(genre)) {
      return genre.map(g => typeof g === 'string' ? g : g.name || String(g)).filter(Boolean);
    }
    if (typeof genre === 'string') {
      return genre.split(',').map(g => g.trim()).filter(Boolean);
    }
    return [];
  }

  private normalizeStatus(status: string): 'ongoing' | 'completed' | 'hiatus' | 'cancelled' {
    if (!status) return 'ongoing';
    
    const normalizedStatus = status.toLowerCase();
    
    if (normalizedStatus.includes('ongoing') || normalizedStatus.includes('continuing')) return 'ongoing';
    if (normalizedStatus.includes('completed') || normalizedStatus.includes('finished')) return 'completed';
    if (normalizedStatus.includes('hiatus') || normalizedStatus.includes('pause')) return 'hiatus';
    if (normalizedStatus.includes('cancelled') || normalizedStatus.includes('dropped')) return 'cancelled';
    
    return 'ongoing';
  }

  private detectMangaType(type: string): 'manga' | 'manhwa' | 'manhua' {
    if (!type) return 'manga';
    
    const lowerType = type.toLowerCase();
    
    if (lowerType.includes('manhwa') || lowerType.includes('korean')) return 'manhwa';
    if (lowerType.includes('manhua') || lowerType.includes('chinese')) return 'manhua';
    
    return 'manga';
  }

  private parseChapters(chapters: any[]): ChapterData[] {
    return chapters.map(chapter => ({
      chapterNumber: parseFloat(chapter.number || chapter.chapter || '0'),
      title: chapter.title || chapter.name,
      description: chapter.description,
      pages: Array.isArray(chapter.pages) ? chapter.pages : [],
      sourceChapterId: String(chapter.id || chapter.slug)
    })).filter(c => c.chapterNumber > 0);
  }

  @trackPerformance
  private async processMangaDataWithApproval(mangaData: MangaData, source: MangaSource) {
    const result = {
      isNew: false,
      isDuplicate: false,
      reason: '',
      newChapters: 0
    };

    try {
      // فحص التكرار
      const duplicateCheck = await duplicateChecker.checkMangaDuplicate(
        mangaData.title,
        mangaData.author,
        mangaData.description,
        source.id,
        mangaData.sourceMangaId
      );

      if (duplicateCheck.isDuplicate) {
        result.isDuplicate = true;
        result.reason = duplicateCheck.reasons.join(', ');

        // ف��ص الفصول الجديدة للمانجا الموجودة
        if (duplicateCheck.matchedManga && mangaData.chapters) {
          result.newChapters = await this.syncNewChaptersWithApproval(duplicateCheck.matchedManga.id, mangaData.chapters);
        }
        
        return result;
      }

      // إضافة مانجا جديدة (سيتم وضعها في انتظار الموافقة تلقائياً)
      const mangaId = await this.addNewMangaForApproval(mangaData);
      result.isNew = true;

      if (mangaData.chapters && mangaData.chapters.length > 0) {
        result.newChapters = mangaData.chapters.length;
        await this.addChaptersForApproval(mangaId, mangaData.chapters);
      }

    } catch (error) {
      await loggingService.error(`خطأ في معالجة المانجا ${mangaData.title}`, error, 'processing', source.id);
      throw error;
    }

    return result;
  }

  @trackPerformance
  private async addNewMangaForApproval(mangaData: MangaData): Promise<string> {
    const { data: manga, error: mangaError } = await supabase
      .from('manga')
      .insert({
        title: mangaData.title,
        description: mangaData.description,
        author: mangaData.author,
        artist: mangaData.artist,
        genre: mangaData.genre,
        status: mangaData.status,
        cover_image_url: mangaData.coverImageUrl,
        manga_type: mangaData.mangaType,
        source_id: mangaData.sourceId,
        source_manga_id: mangaData.sourceMangaId,
        auto_added: true, // هذا سيؤدي لوضعها في انتظار الموافقة
        approval_status: 'pending', // حالة انتظار المراجعة
        created_by: 'auto-system'
      })
      .select('id')
      .single();

    if (mangaError) throw mangaError;

    await loggingService.info(`تمت إضافة مانجا للمراجعة: ${mangaData.title}`, { mangaId: manga.id }, 'approval');

    return manga.id;
  }

  @trackPerformance
  private async syncNewChaptersWithApproval(mangaId: string, chapters: ChapterData[]): Promise<number> {
    let newChaptersCount = 0;

    for (const chapterData of chapters) {
      const duplicateCheck = await duplicateChecker.checkChapterDuplicate(mangaId, chapterData.chapterNumber, chapterData.title);
      
      if (!duplicateCheck.isDuplicate) {
        await this.addChapterForApproval(mangaId, chapterData);
        newChaptersCount++;
        
        await loggingService.info(
          `تمت إضافة فصل للمراجعة: الفصل ${chapterData.chapterNumber}`,
          { mangaId, chapterNumber: chapterData.chapterNumber },
          'approval'
        );
      }
    }

    return newChaptersCount;
  }

  @trackPerformance
  private async addChaptersForApproval(mangaId: string, chapters: ChapterData[]) {
    const chaptersToInsert = chapters.map(chapter => ({
      manga_id: mangaId,
      chapter_number: chapter.chapterNumber,
      title: chapter.title,
      description: chapter.description,
      pages: chapter.pages,
      source_chapter_id: chapter.sourceChapterId,
      auto_added: true, // هذا سيؤدي لوضعها في انتظار الموافقة
      approval_status: 'pending', // حالة انتظار المراجعة
      created_by: 'auto-system'
    }));

    const { error } = await supabase
      .from('chapters')
      .insert(chaptersToInsert);

    if (error) throw error;
  }

  private async addChapterForApproval(mangaId: string, chapterData: ChapterData) {
    const { error } = await supabase
      .from('chapters')
      .insert({
        manga_id: mangaId,
        chapter_number: chapterData.chapterNumber,
        title: chapterData.title,
        description: chapterData.description,
        pages: chapterData.pages,
        source_chapter_id: chapterData.sourceChapterId,
        auto_added: true, // هذا سيؤدي لوضعها في انتظار الموافقة
        approval_status: 'pending', // حالة انتظار المراجعة
        created_by: 'auto-system'
      });

    if (error) throw error;
  }

  private async notifyAdminsAboutPendingContent(pendingCount: number) {
    try {
      // جلب جميع المدراء
      const { data: admins, error } = await supabase
        .from('profiles')
        .select('user_id')
        .in('role', ['admin', 'owner', 'site_admin']);

      if (error || !admins) {
        await loggingService.warn('فشل في جلب قائمة المدراء للإشعارات', error);
        return;
      }

      // إرسال إشعار لكل مدير
      const notifications = admins.map(admin => ({
        user_id: admin.user_id,
        type: 'content_review',
        title: 'محتوى جديد يحتاج مراجعة',
        message: `هناك ${pendingCount} عنصر جديد في انتظار المراجعة والموافقة`,
        data: {
          pending_count: pendingCount,
          action_required: true,
          review_url: '/admin/review-queue'
        }
      }));

      const { error: notificationError } = await supabase
        .from('notifications')
        .insert(notifications);

      if (notificationError) {
        await loggingService.error('فشل في إرسال إشعارات المراجعة', notificationError);
      } else {
        await loggingService.info(`تم إرسال إشعارات المراجعة لـ ${admins.length} مدير`, { pendingCount });
      }
    } catch (error) {
      await loggingService.error('خطأ في إرسال إشعارات المراجعة', error);
    }
  }

  private async updateSourceLastSync(sourceId: string) {
    await supabase
      .from('manga_sources')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', sourceId);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // إدارة المصادر (نفس الطرق السابقة)
  async addSource(source: Omit<MangaSource, 'id'>) {
    try {
      const { data, error } = await supabase
        .from('manga_sources')
        .insert({
          name: source.name,
          base_url: source.baseUrl,
          type: source.type,
          is_active: source.isActive,
          config: source.config
        })
        .select('id')
        .single();

      if (error) throw error;

      this.sources.set(data.id, { ...source, id: data.id });
      
      await loggingService.info(`تم إضافة مصدر جديد: ${source.name}`, { sourceId: data.id }, 'sources');
      
      return data.id;
    } catch (error) {
      await loggingService.error(`فشل في إضافة المصدر: ${source.name}`, error, 'sources');
      throw error;
    }
  }

  async updateSource(id: string, updates: Partial<MangaSource>) {
    try {
      const { error } = await supabase
        .from('manga_sources')
        .update({
          name: updates.name,
          base_url: updates.baseUrl,
          type: updates.type,
          is_active: updates.isActive,
          config: updates.config
        })
        .eq('id', id);

      if (error) throw error;

      const existingSource = this.sources.get(id);
      if (existingSource) {
        this.sources.set(id, { ...existingSource, ...updates });
      }

      await loggingService.info(`تم تحديث المصدر: ${updates.name || existingSource?.name}`, { sourceId: id, updates }, 'sources');
    } catch (error) {
      await loggingService.error(`فشل في تحديث المصدر: ${id}`, error, 'sources');
      throw error;
    }
  }

  async deleteSource(id: string) {
    try {
      const source = this.sources.get(id);
      
      const { error } = await supabase
        .from('manga_sources')
        .delete()
        .eq('id', id);

      if (error) throw error;

      this.sources.delete(id);
      
      await loggingService.info(`تم حذف المصدر: ${source?.name || id}`, { sourceId: id }, 'sources');
    } catch (error) {
      await loggingService.error(`فشل في ��ذف المصدر: ${id}`, error, 'sources');
      throw error;
    }
  }

  getSources() {
    return Array.from(this.sources.values());
  }

  async testSource(sourceId: string) {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error('المصدر غير موجود');

    try {
      await loggingService.info(`بدء اختبار المصدر: ${source.name}`, {}, 'test', sourceId);
      
      const testManga = await this.fetchFromAPI(source);
      
      const result = {
        success: true,
        count: testManga.length,
        sample: testManga.slice(0, 3)
      };

      await loggingService.info(`نجح اختبار المصدر: ${source.name}`, result, 'test', sourceId);
      
      return result;
    } catch (error) {
      await loggingService.error(`فشل اختبار المصدر: ${source.name}`, error, 'test', sourceId);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export const autoMangaServiceWithApproval = new AutoMangaServiceWithApproval();

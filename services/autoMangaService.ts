import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

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
    rateLimit?: number; // requests per minute
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

class AutoMangaService {
  private sources: Map<string, MangaSource> = new Map();
  private isRunning = false;

  constructor() {
    this.loadSources();
  }

  async loadSources() {
    try {
      const { data: sources, error } = await supabase
        .from('manga_sources')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

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

      console.log(`تم تحميل ${this.sources.size} مصدر للمانجا`);
    } catch (error) {
      console.error('خطأ في تحميل مصادر المانجا:', error);
    }
  }

  async syncAllSources() {
    if (this.isRunning) {
      console.log('المزامنة قيد التش��يل بالفعل');
      return;
    }

    this.isRunning = true;
    console.log('بدء مزامنة جميع المصادر...');

    try {
      for (const [sourceId, source] of this.sources) {
        if (!source.isActive) continue;

        console.log(`مزامنة المصدر: ${source.name}`);
        await this.syncSource(source);
        await this.delay(source.config.rateLimit || 60000); // انتظار بين المصادر
      }
    } catch (error) {
      console.error('خطأ في المزامنة:', error);
    } finally {
      this.isRunning = false;
      console.log('انتهت المزامنة');
    }
  }

  private async syncSource(source: MangaSource) {
    try {
      let mangaList: MangaData[] = [];

      if (source.type === 'api') {
        mangaList = await this.fetchFromAPI(source);
      } else {
        mangaList = await this.scrapeFromWebsite(source);
      }

      for (const mangaData of mangaList) {
        await this.processMangaData(mangaData, source);
      }

      // تحديث آخر وقت مزامنة
      await this.updateSourceLastSync(source.id);

    } catch (error) {
      console.error(`خطأ في مزامنة المصدر ${source.name}:`, error);
      await this.logError(source.id, error);
    }
  }

  private async fetchFromAPI(source: MangaSource): Promise<MangaData[]> {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...source.config.headers
    };

    if (source.config.apiKey) {
      headers['Authorization'] = `Bearer ${source.config.apiKey}`;
    }

    try {
      const response = await fetch(`${source.baseUrl}/api/manga`, {
        headers,
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return this.parseAPIResponse(data, source);
    } catch (error) {
      console.error(`خطأ في API للمصدر ${source.name}:`, error);
      return [];
    }
  }

  private async scrapeFromWebsite(source: MangaSource): Promise<MangaData[]> {
    // ملاحظة: Web scraping في المتصفح محدود، نحتاج خادم للـ scraping الفعلي
    console.warn('Web scraping غير مدعوم في المتصفح. استخدم API أو خادم خلفي.');
    return [];
  }

  private parseAPIResponse(data: any, source: MangaSource): MangaData[] {
    // تحليل استجابة API حسب تنسيق كل مصدر
    const mangaList: MangaData[] = [];

    try {
      const items = Array.isArray(data) ? data : data.manga || data.results || [];

      for (const item of items) {
        const manga: MangaData = {
          title: item.title || item.name,
          description: item.description || item.summary,
          author: item.author,
          artist: item.artist,
          genre: Array.isArray(item.genre) ? item.genre : 
                 typeof item.genre === 'string' ? item.genre.split(',').map((g: string) => g.trim()) : [],
          status: this.normalizeStatus(item.status),
          coverImageUrl: item.coverImage || item.thumbnail || item.image,
          mangaType: this.detectMangaType(item.type || source.name),
          sourceId: source.id,
          sourceMangaId: item.id || item.slug,
          chapters: item.chapters ? this.parseChapters(item.chapters) : undefined
        };

        mangaList.push(manga);
      }
    } catch (error) {
      console.error('خطأ في تحليل استجابة API:', error);
    }

    return mangaList;
  }

  private normalizeStatus(status: string): 'ongoing' | 'completed' | 'hiatus' | 'cancelled' {
    const normalizedStatus = status?.toLowerCase() || '';
    
    if (normalizedStatus.includes('ongoing') || normalizedStatus.includes('continuing')) return 'ongoing';
    if (normalizedStatus.includes('completed') || normalizedStatus.includes('finished')) return 'completed';
    if (normalizedStatus.includes('hiatus') || normalizedStatus.includes('pause')) return 'hiatus';
    if (normalizedStatus.includes('cancelled') || normalizedStatus.includes('dropped')) return 'cancelled';
    
    return 'ongoing'; // افتراضي
  }

  private detectMangaType(type: string): 'manga' | 'manhwa' | 'manhua' {
    const lowerType = type?.toLowerCase() || '';
    
    if (lowerType.includes('manhwa') || lowerType.includes('korean')) return 'manhwa';
    if (lowerType.includes('manhua') || lowerType.includes('chinese')) return 'manhua';
    
    return 'manga'; // افتراضي للمانجا اليابانية
  }

  private parseChapters(chapters: any[]): ChapterData[] {
    return chapters.map(chapter => ({
      chapterNumber: parseFloat(chapter.number || chapter.chapter || '0'),
      title: chapter.title || chapter.name,
      description: chapter.description,
      pages: Array.isArray(chapter.pages) ? chapter.pages : [],
      sourceChapterId: chapter.id || chapter.slug
    }));
  }

  private async processMangaData(mangaData: MangaData, source: MangaSource) {
    try {
      // فحص وجود المانجا
      const existingManga = await this.checkMangaExists(mangaData.sourceMangaId, source.id);
      
      if (existingManga) {
        console.log(`المانجا ${mangaData.title} موجودة بالفعل، فحص الفصول الجديدة...`);
        await this.syncNewChapters(existingManga.id, mangaData.chapters || []);
      } else {
        console.log(`إضافة مانجا جديدة: ${mangaData.title}`);
        await this.addNewManga(mangaData);
      }
    } catch (error) {
      console.error(`خطأ في معالجة المانجا ${mangaData.title}:`, error);
    }
  }

  private async checkMangaExists(sourceMangaId: string, sourceId: string) {
    const { data, error } = await supabase
      .from('manga')
      .select('id, title')
      .eq('source_manga_id', sourceMangaId)
      .eq('source_id', sourceId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data;
  }

  private async addNewManga(mangaData: MangaData) {
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
        created_by: 'auto-system'
      })
      .select('id')
      .single();

    if (mangaError) throw mangaError;

    if (mangaData.chapters && mangaData.chapters.length > 0) {
      await this.addChapters(manga.id, mangaData.chapters);
    }

    console.log(`تمت إضافة المانجا: ${mangaData.title} مع ${mangaData.chapters?.length || 0} فصل`);
  }

  private async syncNewChapters(mangaId: string, chapters: ChapterData[]) {
    for (const chapterData of chapters) {
      const exists = await this.checkChapterExists(mangaId, chapterData.chapterNumber);
      
      if (!exists) {
        await this.addChapter(mangaId, chapterData);
        console.log(`تمت إضافة فصل جديد: ${chapterData.chapterNumber}`);
      }
    }
  }

  private async checkChapterExists(mangaId: string, chapterNumber: number) {
    const { data, error } = await supabase
      .from('chapters')
      .select('id')
      .eq('manga_id', mangaId)
      .eq('chapter_number', chapterNumber)
      .single();

    return data !== null;
  }

  private async addChapters(mangaId: string, chapters: ChapterData[]) {
    const chaptersToInsert = chapters.map(chapter => ({
      manga_id: mangaId,
      chapter_number: chapter.chapterNumber,
      title: chapter.title,
      description: chapter.description,
      pages: chapter.pages,
      source_chapter_id: chapter.sourceChapterId,
      created_by: 'auto-system'
    }));

    const { error } = await supabase
      .from('chapters')
      .insert(chaptersToInsert);

    if (error) throw error;
  }

  private async addChapter(mangaId: string, chapterData: ChapterData) {
    const { error } = await supabase
      .from('chapters')
      .insert({
        manga_id: mangaId,
        chapter_number: chapterData.chapterNumber,
        title: chapterData.title,
        description: chapterData.description,
        pages: chapterData.pages,
        source_chapter_id: chapterData.sourceChapterId,
        created_by: 'auto-system'
      });

    if (error) throw error;
  }

  private async updateSourceLastSync(sourceId: string) {
    await supabase
      .from('manga_sources')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', sourceId);
  }

  private async logError(sourceId: string, error: any) {
    await supabase
      .from('sync_logs')
      .insert({
        source_id: sourceId,
        status: 'error',
        message: error.message || String(error),
        details: JSON.stringify(error),
        created_at: new Date().toISOString()
      });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // وظائف إدارة المصادر
  async addSource(source: Omit<MangaSource, 'id'>) {
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
    return data.id;
  }

  async updateSource(id: string, updates: Partial<MangaSource>) {
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
  }

  async deleteSource(id: string) {
    const { error } = await supabase
      .from('manga_sources')
      .delete()
      .eq('id', id);

    if (error) throw error;

    this.sources.delete(id);
  }

  getSources() {
    return Array.from(this.sources.values());
  }

  async testSource(sourceId: string) {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error('المصدر غير موجود');

    try {
      const testManga = await this.fetchFromAPI(source);
      return {
        success: true,
        count: testManga.length,
        sample: testManga.slice(0, 3)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export const autoMangaService = new AutoMangaService();

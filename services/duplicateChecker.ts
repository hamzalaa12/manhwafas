import { supabase } from '@/integrations/supabase/client';

export interface DuplicateCheckConfig {
  titleSimilarity: number; // 0-1, higher means more strict
  authorMatch: boolean;
  descriptionSimilarity: number;
  chapterNumberTolerance: number;
  enableFuzzyMatching: boolean;
}

export interface DuplicateResult {
  isDuplicate: boolean;
  confidence: number; // 0-1
  matchedManga?: {
    id: string;
    title: string;
    author?: string;
    similarity: number;
  };
  reasons: string[];
}

export interface ChapterDuplicateResult {
  isDuplicate: boolean;
  existingChapter?: {
    id: string;
    chapterNumber: number;
    title?: string;
  };
}

class DuplicateChecker {
  private config: DuplicateCheckConfig = {
    titleSimilarity: 0.85,
    authorMatch: true,
    descriptionSimilarity: 0.7,
    chapterNumberTolerance: 0.1,
    enableFuzzyMatching: true
  };

  constructor(config?: Partial<DuplicateCheckConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  async checkMangaDuplicate(
    title: string,
    author?: string,
    description?: string,
    sourceId?: string,
    sourceMangaId?: string
  ): Promise<DuplicateResult> {
    
    // فحص التطابق المباشر بالمصدر
    if (sourceId && sourceMangaId) {
      const exactMatch = await this.checkExactSourceMatch(sourceId, sourceMangaId);
      if (exactMatch) {
        return {
          isDuplicate: true,
          confidence: 1.0,
          matchedManga: exactMatch,
          reasons: ['تطابق مباشر بنفس المصدر والمعرف']
        };
      }
    }

    // فحص التطابق بالعنوان والمؤلف
    const candidates = await this.getMangaCandidates(title, author);
    
    if (candidates.length === 0) {
      return {
        isDuplicate: false,
        confidence: 0,
        reasons: ['لم يتم العثور على مانجا مشابهة']
      };
    }

    let bestMatch: DuplicateResult['matchedManga'] | undefined;
    let highestConfidence = 0;
    const reasons: string[] = [];

    for (const candidate of candidates) {
      const similarity = this.calculateSimilarity(
        { title, author, description },
        candidate
      );

      if (similarity.total > highestConfidence) {
        highestConfidence = similarity.total;
        bestMatch = {
          id: candidate.id,
          title: candidate.title,
          author: candidate.author,
          similarity: similarity.total
        };
        
        reasons.length = 0; // مسح الأسباب السابقة
        reasons.push(...similarity.reasons);
      }
    }

    const isDuplicate = highestConfidence >= this.config.titleSimilarity;

    return {
      isDuplicate,
      confidence: highestConfidence,
      matchedManga: isDuplicate ? bestMatch : undefined,
      reasons
    };
  }

  async checkChapterDuplicate(
    mangaId: string,
    chapterNumber: number,
    title?: string
  ): Promise<ChapterDuplicateResult> {
    
    // فحص رقم الفصل مع التسامح
    const tolerance = this.config.chapterNumberTolerance;
    const minNumber = chapterNumber - tolerance;
    const maxNumber = chapterNumber + tolerance;

    const { data: existingChapters, error } = await supabase
      .from('chapters')
      .select('id, chapter_number, title')
      .eq('manga_id', mangaId)
      .gte('chapter_number', minNumber)
      .lte('chapter_number', maxNumber);

    if (error) {
      console.error('خط�� في فحص تكرار الفصل:', error);
      return { isDuplicate: false };
    }

    if (!existingChapters || existingChapters.length === 0) {
      return { isDuplicate: false };
    }

    // فحص الرقم المطابق تماماً
    const exactMatch = existingChapters.find(ch => ch.chapter_number === chapterNumber);
    if (exactMatch) {
      return {
        isDuplicate: true,
        existingChapter: exactMatch
      };
    }

    // فحص العنوان إذا كان متوفراً
    if (title && this.config.enableFuzzyMatching) {
      for (const chapter of existingChapters) {
        if (chapter.title && this.calculateStringSimilarity(title, chapter.title) > 0.9) {
          return {
            isDuplicate: true,
            existingChapter: chapter
          };
        }
      }
    }

    return { isDuplicate: false };
  }

  private async checkExactSourceMatch(sourceId: string, sourceMangaId: string) {
    const { data, error } = await supabase
      .from('manga')
      .select('id, title, author')
      .eq('source_id', sourceId)
      .eq('source_manga_id', sourceMangaId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      title: data.title,
      author: data.author,
      similarity: 1.0
    };
  }

  private async getMangaCandidates(title: string, author?: string) {
    // البحث بالعنوان المشابه
    const titleWords = this.extractKeywords(title);
    const searchQuery = titleWords.join(' | ');

    let query = supabase
      .from('manga')
      .select('id, title, author, description')
      .textSearch('title', searchQuery, { config: 'arabic' })
      .limit(20);

    // إضافة فلتر المؤلف إذا كان متوفراً
    if (author && this.config.authorMatch) {
      query = query.ilike('author', `%${author}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('خطأ في البحث عن المانجا المشابهة:', error);
      return [];
    }

    return data || [];
  }

  private calculateSimilarity(
    target: { title: string; author?: string; description?: string },
    candidate: { title: string; author?: string; description?: string }
  ) {
    const reasons: string[] = [];
    let totalScore = 0;
    let weightSum = 0;

    // تشابه العنوان (وزن عالي)
    const titleWeight = 0.6;
    const titleSim = this.calculateStringSimilarity(target.title, candidate.title);
    totalScore += titleSim * titleWeight;
    weightSum += titleWeight;

    if (titleSim > 0.8) {
      reasons.push(`تشابه عالي في العنوان (${Math.round(titleSim * 100)}%)`);
    }

    // تطابق المؤلف (وزن متوسط)
    if (target.author && candidate.author) {
      const authorWeight = 0.3;
      const authorSim = this.calculateStringSimilarity(target.author, candidate.author);
      totalScore += authorSim * authorWeight;
      weightSum += authorWeight;

      if (authorSim > 0.9) {
        reasons.push('تطابق في اسم المؤلف');
      }
    }

    // تشابه الوصف (وزن منخفض)
    if (target.description && candidate.description) {
      const descWeight = 0.1;
      const descSim = this.calculateStringSimilarity(target.description, candidate.description);
      totalScore += descSim * descWeight;
      weightSum += descWeight;

      if (descSim > this.config.descriptionSimilarity) {
        reasons.push(`تشابه في الوصف (${Math.round(descSim * 100)}%)`);
      }
    }

    return {
      total: weightSum > 0 ? totalScore / weightSum : 0,
      reasons
    };
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    // تنظيف النصوص
    const clean1 = this.normalizeString(str1);
    const clean2 = this.normalizeString(str2);

    if (clean1 === clean2) return 1;

    // خوارزمية Levenshtein distance
    const distance = this.levenshteinDistance(clean1, clean2);
    const maxLength = Math.max(clean1.length, clean2.length);
    
    if (maxLength === 0) return 1;
    
    return 1 - (distance / maxLength);
  }

  private normalizeString(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, '') // إزالة علامات الترقيم
      .replace(/\s+/g, ' ') // دمج المسافات المتعددة
      .trim();
  }

  private extractKeywords(text: string): string[] {
    const normalized = this.normalizeString(text);
    const words = normalized.split(' ');
    
    // إزالة الكلمات الشائعة وقصيرة
    const commonWords = ['في', 'من', 'إلى', 'على', 'عن', 'مع', 'the', 'and', 'or', 'of', 'to', 'a', 'an'];
    
    return words
      .filter(word => word.length > 2 && !commonWords.includes(word))
      .slice(0, 5); // أخذ أول 5 كلمات مفتاحية
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // insertion
          matrix[j - 1][i] + 1, // deletion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  // فحص دُفعي للمانجا المتعددة
  async checkMultipleMangaDuplicates(mangaList: Array<{
    title: string;
    author?: string;
    description?: string;
    sourceId?: string;
    sourceMangaId?: string;
  }>) {
    const results = [];

    for (const manga of mangaList) {
      const result = await this.checkMangaDuplicate(
        manga.title,
        manga.author,
        manga.description,
        manga.sourceId,
        manga.sourceMangaId
      );

      results.push({
        manga,
        duplicateCheck: result
      });

      // تأخير صغير لتجنب إرهاق قاعدة البيانات
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }

  // تحديث إعدادات فحص التكرار
  updateConfig(newConfig: Partial<DuplicateCheckConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): DuplicateCheckConfig {
    return { ...this.config };
  }
}

export const duplicateChecker = new DuplicateChecker();

// دالة مساعدة لفحص التكرار السريع
export async function quickDuplicateCheck(title: string, author?: string) {
  return await duplicateChecker.checkMangaDuplicate(title, author);
}

// دالة مساعدة لفحص تكرار الفصل
export async function quickChapterDuplicateCheck(mangaId: string, chapterNumber: number) {
  return await duplicateChecker.checkChapterDuplicate(mangaId, chapterNumber);
}

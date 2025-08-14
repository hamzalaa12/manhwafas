import { supabase } from '@/integrations/supabase/client';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id?: string;
  level: LogLevel;
  message: string;
  details?: any;
  source: string;
  sourceId?: string;
  createdAt?: string;
  userId?: string;
}

export interface SystemStats {
  totalManga: number;
  totalChapters: number;
  autoAddedManga: number;
  autoAddedChapters: number;
  activeSources: number;
  totalSources: number;
  successfulSyncs: number;
  failedSyncs: number;
  lastSyncAt?: string;
}

class LoggingService {
  private isDevelopment = import.meta.env.MODE === 'development';

  async log(level: LogLevel, message: string, details?: any, source = 'system', sourceId?: string) {
    const logEntry: LogEntry = {
      level,
      message,
      details: details ? JSON.stringify(details) : null,
      source,
      sourceId,
      createdAt: new Date().toISOString()
    };

    // طباعة في وحدة التحكم للتطوير
    if (this.isDevelopment) {
      const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[consoleMethod](`[${level.toUpperCase()}] ${source}: ${message}`, details);
    }

    // حفظ في قاعدة البيانات
    try {
      const { error } = await supabase
        .from('sync_logs')
        .insert({
          source_id: sourceId,
          status: level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'success',
          message,
          details: details ? { level, source, data: details } : { level, source },
          created_at: logEntry.createdAt
        });

      if (error) {
        console.error('خطأ في حفظ السجل:', error);
      }
    } catch (error) {
      console.error('فشل في كتابة السجل:', error);
    }
  }

  async info(message: string, details?: any, source = 'system', sourceId?: string) {
    await this.log('info', message, details, source, sourceId);
  }

  async warn(message: string, details?: any, source = 'system', sourceId?: string) {
    await this.log('warn', message, details, source, sourceId);
  }

  async error(message: string, details?: any, source = 'system', sourceId?: string) {
    await this.log('error', message, details, source, sourceId);
  }

  async debug(message: string, details?: any, source = 'system', sourceId?: string) {
    if (this.isDevelopment) {
      await this.log('debug', message, details, source, sourceId);
    }
  }

  // سجلات خاصة بالمزامنة
  async logSyncStart(sourceId: string, sourceName: string) {
    await this.info(
      `بدء مزامنة المصدر: ${sourceName}`,
      { action: 'sync_start' },
      'sync',
      sourceId
    );
  }

  async logSyncSuccess(sourceId: string, sourceName: string, stats: { newManga: number; newChapters: number; duplicates: number }) {
    await this.info(
      `اكتملت مزامنة المصدر: ${sourceName}`,
      { action: 'sync_complete', stats },
      'sync',
      sourceId
    );
  }

  async logSyncError(sourceId: string, sourceName: string, error: any) {
    await this.error(
      `فشلت مزامنة المصدر: ${sourceName}`,
      { action: 'sync_error', error: error.message || String(error) },
      'sync',
      sourceId
    );
  }

  async logMangaAdded(mangaTitle: string, sourceId?: string) {
    await this.info(
      `تمت إضافة مانجا جديدة: ${mangaTitle}`,
      { action: 'manga_added', title: mangaTitle },
      'manga',
      sourceId
    );
  }

  async logChapterAdded(mangaTitle: string, chapterNumber: number, sourceId?: string) {
    await this.info(
      `تمت إضافة فصل جديد: ${mangaTitle} - الفصل ${chapterNumber}`,
      { action: 'chapter_added', manga: mangaTitle, chapter: chapterNumber },
      'chapter',
      sourceId
    );
  }

  async logDuplicateSkipped(mangaTitle: string, reason: string, sourceId?: string) {
    await this.warn(
      `تم تجاهل مانجا مكررة: ${mangaTitle}`,
      { action: 'duplicate_skipped', title: mangaTitle, reason },
      'duplicate',
      sourceId
    );
  }

  // إحصائيات النظام
  async getSystemStats(): Promise<SystemStats> {
    try {
      // إحصائيات المانجا والفصول
      const [mangaStats, chapterStats, sourceStats, syncStats] = await Promise.all([
        this.getMangaStats(),
        this.getChapterStats(), 
        this.getSourceStats(),
        this.getSyncStats()
      ]);

      return {
        totalManga: mangaStats.total,
        totalChapters: chapterStats.total,
        autoAddedManga: mangaStats.autoAdded,
        autoAddedChapters: chapterStats.autoAdded,
        activeSources: sourceStats.active,
        totalSources: sourceStats.total,
        successfulSyncs: syncStats.successful,
        failedSyncs: syncStats.failed,
        lastSyncAt: syncStats.lastSyncAt
      };
    } catch (error) {
      await this.error('فشل في جلب إحصائيات النظام', error);
      return {
        totalManga: 0,
        totalChapters: 0,
        autoAddedManga: 0,
        autoAddedChapters: 0,
        activeSources: 0,
        totalSources: 0,
        successfulSyncs: 0,
        failedSyncs: 0
      };
    }
  }

  private async getMangaStats() {
    const { data, error } = await supabase
      .from('manga')
      .select('auto_added')
      .not('auto_added', 'is', null);

    if (error) throw error;

    const total = data?.length || 0;
    const autoAdded = data?.filter(m => m.auto_added).length || 0;

    return { total, autoAdded };
  }

  private async getChapterStats() {
    const { data, error } = await supabase
      .from('chapters')
      .select('auto_added')
      .not('auto_added', 'is', null);

    if (error) throw error;

    const total = data?.length || 0;
    const autoAdded = data?.filter(c => c.auto_added).length || 0;

    return { total, autoAdded };
  }

  private async getSourceStats() {
    const { data, error } = await supabase
      .from('manga_sources')
      .select('is_active');

    if (error) throw error;

    const total = data?.length || 0;
    const active = data?.filter(s => s.is_active).length || 0;

    return { total, active };
  }

  private async getSyncStats() {
    const { data, error } = await supabase
      .from('sync_logs')
      .select('status, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const successful = data?.filter(l => l.status === 'success').length || 0;
    const failed = data?.filter(l => l.status === 'error').length || 0;
    const lastSyncAt = data?.find(l => l.status === 'success')?.created_at;

    return { successful, failed, lastSyncAt };
  }

  // جلب السجلات الأخيرة
  async getRecentLogs(limit = 50, level?: LogLevel, source?: string) {
    let query = supabase
      .from('sync_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (level) {
      query = query.eq('status', level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'success');
    }

    const { data, error } = await query;

    if (error) {
      await this.error('فشل في جلب السجلات', error);
      return [];
    }

    return data || [];
  }

  // تنظيف السجلات القديمة
  async cleanupOldLogs(daysToKeep = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    try {
      const { error } = await supabase
        .from('sync_logs')
        .delete()
        .lt('created_at', cutoffDate.toISOString());

      if (error) throw error;

      await this.info(`تم تنظيف السجلات الأقدم من ${daysToKeep} يوماً`);
    } catch (error) {
      await this.error('فشل في تنظيف السجلات القديمة', error);
    }
  }

  // تصدير السجلات
  async exportLogs(startDate?: Date, endDate?: Date, format: 'json' | 'csv' = 'json') {
    try {
      let query = supabase
        .from('sync_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (startDate) {
        query = query.gte('created_at', startDate.toISOString());
      }

      if (endDate) {
        query = query.lte('created_at', endDate.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      if (format === 'json') {
        return JSON.stringify(data, null, 2);
      } else {
        // تحويل إلى CSV
        if (!data || data.length === 0) return '';

        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => 
          Object.values(row)
            .map(value => typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value)
            .join(',')
        );

        return [headers, ...rows].join('\n');
      }
    } catch (error) {
      await this.error('فشل في تصدير السجلات', error);
      return '';
    }
  }

  // مراقبة الأداء
  async trackPerformance(operation: string, duration: number, details?: any) {
    await this.info(
      `أداء العملية: ${operation} (${duration}ms)`,
      { operation, duration, ...details },
      'performance'
    );
  }

  // تتبع أخطاء المستخدمين
  async trackUserError(error: Error, context?: any) {
    await this.error(
      `خطأ المستخدم: ${error.message}`,
      {
        error: error.stack,
        context,
        timestamp: new Date().toISOString()
      },
      'user_error'
    );
  }

  // إحصائيات الاستخدام
  async getUsageStats(days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const { data, error } = await supabase
        .from('sync_logs')
        .select('created_at, status, details')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      // تجميع الإحصائيات بالأيام
      const dailyStats = new Map();
      
      data?.forEach(log => {
        const date = new Date(log.created_at).toDateString();
        if (!dailyStats.has(date)) {
          dailyStats.set(date, { success: 0, error: 0, warning: 0 });
        }
        
        const stats = dailyStats.get(date);
        stats[log.status]++;
      });

      return Array.from(dailyStats.entries()).map(([date, stats]) => ({
        date,
        ...stats
      }));
    } catch (error) {
      await this.error('فشل في جلب إحصائيات الاستخدام', error);
      return [];
    }
  }
}

export const loggingService = new LoggingService();

// دوال مساعدة سريعة
export const logInfo = (message: string, details?: any, source?: string, sourceId?: string) => 
  loggingService.info(message, details, source, sourceId);

export const logWarn = (message: string, details?: any, source?: string, sourceId?: string) => 
  loggingService.warn(message, details, source, sourceId);

export const logError = (message: string, details?: any, source?: string, sourceId?: string) => 
  loggingService.error(message, details, source, sourceId);

export const logDebug = (message: string, details?: any, source?: string, sourceId?: string) => 
  loggingService.debug(message, details, source, sourceId);

// مُزخرف للوظائف لتتبع الأداء
export function trackPerformance(target: any, propertyName: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    const start = performance.now();
    try {
      const result = await originalMethod.apply(this, args);
      const duration = performance.now() - start;
      await loggingService.trackPerformance(propertyName, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      await loggingService.trackPerformance(propertyName, duration, { error: error.message });
      throw error;
    }
  };

  return descriptor;
}

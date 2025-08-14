import { supabase } from '@/integrations/supabase/client';
import { autoMangaService } from './autoMangaService';

export interface ScheduleConfig {
  enabled: boolean;
  interval: 'hourly' | 'daily' | 'weekly' | 'custom';
  time?: string; // HH:MM format for daily/weekly
  dayOfWeek?: number; // 0-6 for weekly (0 = Sunday)
  customInterval?: number; // minutes for custom interval
  sources?: string[]; // specific source IDs to sync, empty = all
}

export interface SyncJob {
  id: string;
  sourceId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  progress: {
    currentStep: string;
    processedManga: number;
    totalManga?: number;
    processedChapters: number;
    errors: number;
  };
  result?: {
    newManga: number;
    newChapters: number;
    duplicatesSkipped: number;
    errors: string[];
  };
}

class SchedulerService {
  private jobs: Map<string, SyncJob> = new Map();
  private scheduleInterval?: NodeJS.Timeout;
  private isInitialized = false;

  async initialize() {
    if (this.isInitialized) return;

    // تحميل الإعدادات من قاعدة البيانات
    await this.loadScheduleSettings();
    
    // بدء نظام الجدولة
    await this.startScheduler();
    
    this.isInitialized = true;
    console.log('تم تهيئة نظام الجدولة بنجاح');
  }

  private async loadScheduleSettings() {
    try {
      const { data, error } = await supabase
        .from('auto_system_settings')
        .select('value')
        .eq('key', 'sync_schedule')
        .single();

      if (error) {
        console.warn('تعذر تحميل إعدادات الجدولة، استخدام الإعدادات الافتراضية');
        return;
      }

      const config = data.value as ScheduleConfig;
      if (config.enabled) {
        this.setupSchedule(config);
      }
    } catch (error) {
      console.error('خطأ في تحميل إعدادات الجدولة:', error);
    }
  }

  private async startScheduler() {
    // فحص المهام المعلقة عند البدء
    await this.checkPendingJobs();
    
    // فحص دوري للمها�� كل دقيقة
    setInterval(() => {
      this.processJobQueue();
    }, 60000);
  }

  private async checkPendingJobs() {
    // فحص المهام المتوقفة في قاعدة البيانات
    const { data: pendingJobs, error } = await supabase
      .from('sync_jobs')
      .select('*')
      .eq('status', 'running')
      .lt('started_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()); // أكثر من 30 دقيقة

    if (error) {
      console.error('خطأ في فحص المهام المعلقة:', error);
      return;
    }

    // إعادة تعيين المهام المتوقفة
    for (const job of pendingJobs || []) {
      await this.markJobAsFailed(job.id, 'انتهت مهلة المهمة');
    }
  }

  async setupSchedule(config: ScheduleConfig) {
    // مسح الجدولة السابقة
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
    }

    if (!config.enabled) {
      console.log('الجدولة التلقائية معطلة');
      return;
    }

    let intervalMs: number;

    switch (config.interval) {
      case 'hourly':
        intervalMs = 60 * 60 * 1000; // ساعة
        break;
      case 'daily':
        intervalMs = 24 * 60 * 60 * 1000; // يوم
        break;
      case 'weekly':
        intervalMs = 7 * 24 * 60 * 60 * 1000; // أسبوع
        break;
      case 'custom':
        intervalMs = (config.customInterval || 60) * 60 * 1000; // دقائق
        break;
      default:
        intervalMs = 24 * 60 * 60 * 1000; // افتراضي: يومي
    }

    // جدولة المهمة
    this.scheduleInterval = setInterval(async () => {
      if (this.shouldRunNow(config)) {
        await this.startAutomaticSync(config.sources);
      }
    }, intervalMs);

    console.log(`تم تعيين الجدولة: ${config.interval} (كل ${intervalMs / 1000} ثانية)`);
  }

  private shouldRunNow(config: ScheduleConfig): boolean {
    const now = new Date();

    if (config.interval === 'daily' && config.time) {
      const [hour, minute] = config.time.split(':').map(Number);
      return now.getHours() === hour && now.getMinutes() === minute;
    }

    if (config.interval === 'weekly' && config.dayOfWeek !== undefined && config.time) {
      const [hour, minute] = config.time.split(':').map(Number);
      return now.getDay() === config.dayOfWeek && 
             now.getHours() === hour && 
             now.getMinutes() === minute;
    }

    // للفواصل الزمنية الأخرى، تشغيل مباشر
    return config.interval === 'hourly' || config.interval === 'custom';
  }

  async startManualSync(sourceIds?: string[]): Promise<string> {
    const jobId = this.generateJobId();
    
    const job: SyncJob = {
      id: jobId,
      status: 'pending',
      progress: {
        currentStep: 'تحضير المزامنة',
        processedManga: 0,
        processedChapters: 0,
        errors: 0
      }
    };

    this.jobs.set(jobId, job);
    
    // حفظ المهمة في قاعدة البيانات
    await this.saveJobToDatabase(job);

    // بدء المهمة
    this.processJobQueue();

    return jobId;
  }

  private async startAutomaticSync(sourceIds?: string[]): Promise<string> {
    console.log('بدء المزامنة التلقائية المجدولة');
    return await this.startManualSync(sourceIds);
  }

  private async processJobQueue() {
    // البحث عن مهمة معلقة
    const pendingJob = Array.from(this.jobs.values()).find(job => job.status === 'pending');
    
    if (!pendingJob) return;

    // فحص إذا كان هناك مهمة قيد التشغيل
    const runningJob = Array.from(this.jobs.values()).find(job => job.status === 'running');
    if (runningJob) return;

    // بدء تشغيل المهمة
    await this.executeJob(pendingJob);
  }

  private async executeJob(job: SyncJob) {
    try {
      // تحديث حالة المهمة
      job.status = 'running';
      job.startedAt = new Date();
      job.progress.currentStep = 'بدء المزامنة';
      
      await this.updateJobInDatabase(job);

      console.log(`بدء تشغيل المهمة: ${job.id}`);

      // تشغيل المزامنة
      const result = await this.runSyncProcess(job);

      // إكمال المهمة
      job.status = 'completed';
      job.completedAt = new Date();
      job.result = result;

      await this.updateJobInDatabase(job);
      console.log(`اكتملت المهمة: ${job.id}`);

    } catch (error) {
      console.error(`فشلت المهمة ${job.id}:`, error);
      await this.markJobAsFailed(job.id, error.message || 'خطأ غير معروف');
    }
  }

  private async runSyncProcess(job: SyncJob) {
    const result = {
      newManga: 0,
      newChapters: 0,
      duplicatesSkipped: 0,
      errors: [] as string[]
    };

    try {
      // تحديث الحالة
      job.progress.currentStep = 'تحميل المصادر';
      await this.updateJobInDatabase(job);

      const sources = autoMangaService.getSources();
      const activeSources = sources.filter(s => s.isActive);

      if (activeSources.length === 0) {
        throw new Error('لا توجد مصادر نشطة');
      }

      job.progress.currentStep = `معالجة ${activeSources.length} مصدر`;
      await this.updateJobInDatabase(job);

      // معالجة كل مصدر
      for (let i = 0; i < activeSources.length; i++) {
        const source = activeSources[i];
        
        try {
          job.progress.currentStep = `مزامنة المصدر: ${source.name}`;
          await this.updateJobInDatabase(job);

          // هنا يتم استدعاء خدمة المزامنة
          // نحتاج إلى تحديث autoMangaService لإرجاع إحصائيات
          const sourceResult = await this.syncSourceWithProgress(source, job);
          
          result.newManga += sourceResult.newManga;
          result.newChapters += sourceResult.newChapters;
          result.duplicatesSkipped += sourceResult.duplicatesSkipped;

        } catch (error) {
          job.progress.errors++;
          result.errors.push(`خطأ في المصدر ${source.name}: ${error.message}`);
          console.error(`خطأ في مزامنة المصدر ${source.name}:`, error);
        }

        // انتظار بين المصادر
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      job.progress.currentStep = 'اكتملت ��لمزامنة';
      await this.updateJobInDatabase(job);

    } catch (error) {
      result.errors.push(error.message || 'خطأ عام في المزامنة');
      throw error;
    }

    return result;
  }

  private async syncSourceWithProgress(source: any, job: SyncJob) {
    // إضافة تتبع التقدم لمزامنة المصدر
    const result = {
      newManga: 0,
      newChapters: 0,
      duplicatesSkipped: 0
    };

    // هذا مكان لتنفيذ المزامنة الفعلية مع تتبع التقدم
    // يمكن تحسين autoMangaService لدعم callbacks للتقدم

    return result;
  }

  private async saveJobToDatabase(job: SyncJob) {
    const { error } = await supabase
      .from('sync_jobs')
      .insert({
        id: job.id,
        source_id: job.sourceId,
        status: job.status,
        started_at: job.startedAt?.toISOString(),
        progress: job.progress,
        result: job.result
      });

    if (error) {
      console.error('خطأ في حفظ المهمة:', error);
    }
  }

  private async updateJobInDatabase(job: SyncJob) {
    const { error } = await supabase
      .from('sync_jobs')
      .update({
        status: job.status,
        started_at: job.startedAt?.toISOString(),
        completed_at: job.completedAt?.toISOString(),
        progress: job.progress,
        result: job.result
      })
      .eq('id', job.id);

    if (error) {
      console.error('خطأ في تحديث المهمة:', error);
    }
  }

  private async markJobAsFailed(jobId: string, errorMessage: string) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.result = {
        newManga: 0,
        newChapters: 0,
        duplicatesSkipped: 0,
        errors: [errorMessage]
      };
      
      await this.updateJobInDatabase(job);
    }
  }

  private generateJobId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // API للتحكم في الجدولة
  async updateScheduleSettings(config: ScheduleConfig) {
    // حفظ الإعدادات في قاعدة البيانات
    const { error } = await supabase
      .from('auto_system_settings')
      .update({ value: config })
      .eq('key', 'sync_schedule');

    if (error) {
      throw new Error('فشل في حفظ إعدادات الجدولة');
    }

    // تطبيق الإعدادات الجديدة
    await this.setupSchedule(config);
  }

  async getScheduleSettings(): Promise<ScheduleConfig> {
    const { data, error } = await supabase
      .from('auto_system_settings')
      .select('value')
      .eq('key', 'sync_schedule')
      .single();

    if (error) {
      // إرجاع الإعدادات الافتراضية
      return {
        enabled: false,
        interval: 'daily',
        time: '02:00'
      };
    }

    return data.value as ScheduleConfig;
  }

  getJobStatus(jobId: string): SyncJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): SyncJob[] {
    return Array.from(this.jobs.values());
  }

  async getJobHistory(limit = 20) {
    const { data, error } = await supabase
      .from('sync_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('خطأ في جلب تاريخ المهام:', error);
      return [];
    }

    return data || [];
  }

  async cancelJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job && job.status === 'pending') {
      await this.markJobAsFailed(jobId, 'تم إلغاء المهمة من قبل المستخدم');
      this.jobs.delete(jobId);
    }
  }

  stop() {
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = undefined;
    }
    this.isInitialized = false;
    console.log('تم إيقاف نظام الجدولة');
  }
}

export const schedulerService = new SchedulerService();

// تهيئة النظام عند بدء التطبيق
schedulerService.initialize().catch(console.error);

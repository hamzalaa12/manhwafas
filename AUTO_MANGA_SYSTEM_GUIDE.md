# 🤖 دليل النظام التلقائي لإضافة المانجا

## نظرة عامة

تم إنشاء نظام متكامل وتلقائي لإضافة المانجا والمانهوا والمانها إلى موقعك، يشمل:

- **مزامنة تلقائية** من مصادر متعددة
- **فحص التكرار المتقدم** لتجنب إضافة محتوى مكرر
- **جدولة مرنة** للمزامنة (يومية، أسبوعية، مخصصة)
- **نظام سجلات شامل** لمراقبة العمليات
- **واجهة إدارة متطورة** للتحكم في النظام

## 🗄️ قاعدة البيانات

### الجداول الجديدة

```sql
-- مصادر المانجا
manga_sources (
  id, name, base_url, type, is_active, 
  config, last_sync_at, created_at, updated_at
)

-- سجلات المزامنة
sync_logs (
  id, source_id, status, message, details, 
  manga_count, chapter_count, created_at
)

-- مهام المزامنة
sync_jobs (
  id, source_id, status, started_at, completed_at,
  progress, result, created_at, updated_at
)

-- إعدادات النظام
auto_system_settings (
  id, key, value, description, updated_at
)
```

### الأعمدة الجديدة

```sql
-- إضافة للجدول manga
ALTER TABLE manga ADD COLUMN source_id UUID;
ALTER TABLE manga ADD COLUMN source_manga_id TEXT;
ALTER TABLE manga ADD COLUMN auto_added BOOLEAN DEFAULT false;

-- إضافة للجدول chapters  
ALTER TABLE chapters ADD COLUMN source_chapter_id TEXT;
ALTER TABLE chapters ADD COLUMN auto_added BOOLEAN DEFAULT false;
```

## 🔧 الخدمات الأساسية

### 1. AutoMangaService
**الملف:** `src/services/autoMangaService.ts`

**الوظائف الرئيسية:**
- جلب البيانات من APIs أو Web Scraping
- تحليل وتحويل البيانات
- إدارة المصادر (إضافة، تحديث، حذف)
- اختبار المصادر

**مثال الاستخدام:**
```typescript
import { autoMangaService } from '@/services/autoMangaService';

// إضافة مصدر جديد
await autoMangaService.addSource({
  name: 'MangaDex',
  baseUrl: 'https://api.mangadex.org',
  type: 'api',
  isActive: true,
  config: {
    apiKey: 'your-api-key',
    rateLimit: 60
  }
});

// بدء مزامنة جميع المصادر
await autoMangaService.syncAllSources();
```

### 2. DuplicateChecker
**الملف:** `src/services/duplicateChecker.ts`

**الوظائف الرئيسية:**
- فحص تكرار المانجا بالذكاء الاصطناعي
- مقارنة العناوين والمؤلفين
- فحص تكرار الفصول

**مثال الاستخدام:**
```typescript
import { duplicateChecker } from '@/services/duplicateChecker';

// فحص تكرار المانجا
const result = await duplicateChecker.checkMangaDuplicate(
  'One Piece',
  'Eiichiro Oda',
  'قصة مغامرات القراصنة...'
);

if (result.isDuplicate) {
  console.log('المانجا موجودة مسبقاً:', result.matchedManga?.title);
}
```

### 3. SchedulerService
**الملف:** `src/services/schedulerService.ts`

**الوظائف الرئيسية:**
- جدولة المزامنة التلقائية
- إدارة المهام (بدء، إيقاف، مراقبة)
- تتبع التقدم

**مثال الاستخدام:**
```typescript
import { schedulerService } from '@/services/schedulerService';

// تعيين جدولة يومية في الساعة 2:00 صباحاً
await schedulerService.updateScheduleSettings({
  enabled: true,
  interval: 'daily',
  time: '02:00'
});

// بدء مزامنة يدوية
const jobId = await schedulerService.startManualSync();
```

### 4. LoggingService
**الملف:** `src/services/loggingService.ts`

**الوظائف الرئيسية:**
- تسجيل جميع العمليات
- مراقبة الأداء
- إحصائيات النظام
- تصدير السجلات

**مثال الاستخدام:**
```typescript
import { loggingService } from '@/services/loggingService';

// تسجيل حدث
await loggingService.info('تمت إضافة مانجا جديدة', { title: 'Naruto' });

// جلب الإحصائيات
const stats = await loggingService.getSystemStats();
console.log(`إجمالي المانجا: ${stats.totalManga}`);
```

## 🎛️ واجهة الإدارة

### AutoMangaManager
**الملف:** `src/components/admin/AutoMangaManager.tsx`

**الميزات:**
- إدارة المصادر (إضافة، تعديل، حذف)
- مراقبة المهام في الوقت الفعلي
- إعدادات الجدولة
- إحصائيات مفصلة

**الوصول:**
- من لوحة الإدارة → "النظام التلقائي"
- متاح للمدراء فقط

## 📝 إعداد المصادر

### مصدر API

```typescript
const apiSource = {
  name: 'MangaDex',
  baseUrl: 'https://api.mangadex.org',
  type: 'api',
  isActive: true,
  config: {
    apiKey: 'optional-api-key',
    rateLimit: 60, // طلب/دقيقة
    headers: {
      'User-Agent': 'MyMangaApp/1.0'
    }
  }
};
```

### مصدر Web Scraping

```typescript
const scrapingSource = {
  name: 'CustomSite',
  baseUrl: 'https://example-manga-site.com',
  type: 'scraping',
  isActive: true,
  config: {
    rateLimit: 30,
    selectors: {
      title: '.manga-title',
      description: '.manga-summary',
      author: '.manga-author',
      genre: '.manga-genres .tag',
      coverImage: '.manga-cover img'
    }
  }
};
```

## ⚙️ الإعدادات

### إعدادات الجدولة

```typescript
const scheduleConfig = {
  enabled: true,
  interval: 'daily', // 'hourly', 'daily', 'weekly', 'custom'
  time: '02:00', // للجدولة اليومية/الأسبوعية
  dayOfWeek: 1, // للجدولة الأسبوعية (0 = الأحد)
  customInterval: 120, // للجدولة المخصصة (دقائق)
  sources: [] // مصادر محددة، فارغ = جميع المصادر
};
```

### إعدادات فحص التكرار

```typescript
const duplicateConfig = {
  titleSimilarity: 0.85, // حساسية ��شابه العنوان
  authorMatch: true, // فحص تطابق المؤلف
  descriptionSimilarity: 0.7, // حساسية تشابه الوصف
  chapterNumberTolerance: 0.1, // تسامح رقم الفصل
  enableFuzzyMatching: true // تفعيل البحث الضبابي
};
```

## 🔍 مراقبة النظام

### إحصائيات في الوقت الفعلي

```typescript
// جلب إحصائيات شاملة
const stats = await loggingService.getSystemStats();

console.log(`
إجمالي المانجا: ${stats.totalManga}
المانجا المضافة تلقائياً: ${stats.autoAddedManga}
إجمالي الفصول: ${stats.totalChapters}
المصادر النشطة: ${stats.activeSources}
المزامنة الناجحة: ${stats.successfulSyncs}
المزامنة الفاشلة: ${stats.failedSyncs}
`);
```

### السجلات والتقارير

```typescript
// جلب السجلات الأخيرة
const logs = await loggingService.getRecentLogs(50, 'error');

// تصدير السجلات
const csvData = await loggingService.exportLogs(
  new Date('2024-01-01'),
  new Date(),
  'csv'
);
```

## 🛡️ الأمان والصلاحيات

### Row Level Security (RLS)

```sql
-- المدراء فقط يمكنهم إدارة المصادر
CREATE POLICY "Admins can manage manga sources" ON manga_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );
```

### التحقق من الصلاحيات

```typescript
// في مكونات React
const { isAdmin } = useAuth();

if (!isAdmin) {
  return <div>غير مسموح</div>;
}
```

## 🔄 سير العمل

### المزامنة التلقائية

1. **التحضير:** تحميل المصادر النشطة
2. **الجلب:** استدعاء APIs أو scraping المواقع
3. **التحليل:** تحويل البيانات إلى تنسيق موحد
4. **فحص التكرار:** التأكد من عدم وجود محتوى مكرر
5. **الحفظ:** إضافة المحتوى الجديد لقاعدة البيانات
6. **التسجيل:** حفظ سجلات العملية

### إضافة مصدر جديد

1. **الإعداد:** تكوين معلومات المصدر
2. **الاختبار:** التحقق من صحة الاتصال
3. **الحفظ:** إضافة المصدر لقاعدة البيانات
4. **التفعيل:** بدء المزامنة التلقائية

## 🔧 استكشاف الأخطاء

### مشاكل شائعة

**1. فشل الاتصال بالمصدر**
```typescript
// فحص حالة المصدر
const testResult = await autoMangaService.testSource(sourceId);
if (!testResult.success) {
  console.error('خطأ في المصدر:', testResult.error);
}
```

**2. تكرار المحتوى**
```typescript
// ضبط حساسية فحص التكرار
duplicateChecker.updateConfig({
  titleSimilarity: 0.9 // زيادة الحساسية
});
```

**3. بطء المزامنة**
```typescript
// تقليل معدل الطلبات
await autoMangaService.updateSource(sourceId, {
  config: { rateLimit: 30 }
});
```

## 📚 أمثلة التطبيق

### تشغيل مزامنة مجدولة

```typescript
// تفعيل المزامنة اليومية
await schedulerService.updateScheduleSettings({
  enabled: true,
  interval: 'daily',
  time: '03:00'
});

console.log('تم تفعيل المزامنة اليومية في الساعة 3:00 صباحاً');
```

### إضافة مصدر MangaDex

```typescript
const mangaDexId = await autoMangaService.addSource({
  name: 'MangaDex',
  baseUrl: 'https://api.mangadex.org',
  type: 'api',
  isActive: true,
  config: {
    rateLimit: 60,
    headers: {
      'User-Agent': 'MyMangaReader/1.0'
    }
  }
});

console.log('تم إضافة MangaDex بنجاح:', mangaDexId);
```

### مراقبة المهام

```typescript
// بدء مهمة مزامنة
const jobId = await schedulerService.startManualSync();

// مراقبة التقدم
const job = schedulerService.getJobStatus(jobId);
console.log(`الحالة: ${job?.status}`);
console.log(`التقدم: ${job?.progress.processedManga} مانجا`);
```

## 🚀 التطوير المستقبلي

### ميزات مخطط إضافتها

1. **دعم مصادر إضافية:** Crunchyroll, MAL, AniList
2. **ذكاء اصطناعي متقدم:** تحسين فحص التكرار
3. **إشعارات ذكية:** تنبيهات عند إضافة محتوى جديد
4. **تحسين الأداء:** معالجة متوازية للمصادر
5. **واجهة مستخدم محسنة:** dashboard أكثر تفاعلية

### كيفية إضافة مصدر جديد

1. **دراسة API المصدر:** فهم هيكل البيانات
2. **تحديث Parser:** إضافة منطق تحليل جديد
3. **إضافة اختبارات:** التأكد من صحة التكامل
4. **توثيق التغييرات:** تحديث هذا الدليل

---

## 📞 الدعم

للمساعدة في التطوير أو حل المشاكل:
- راجع سجلات النظام في لوحة الإدارة
- استخدم أدوات المطور لفحص طلبات الشبكة
- تحقق من إعدادات قاعدة البيانات

**تم إنشاء هذا النظام بعناية فائقة ليكون مرناً وقابلاً للتوسع! 🎉**

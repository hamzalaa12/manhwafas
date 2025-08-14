# 🔍 دليل نظام الموافقة على المحتوى

## نظرة عامة

تم تطوير نظام الموافقة ليعمل مع النظام التلقائي لإضافة المانجا. النظام يضيف المحتوى تلقائياً ولكن يتطلب موافقة الإدارة قبل إظهاره للمستخدمين.

## 🔄 سير العمل

### 1. الإضافة التلقائية
```
📥 النظام يجلب محتوى جديد من المصادر
    ⬇️
🔍 فحص التكرار لتجنب المحتوى المكرر
    ⬇️ 
📝 إضافة المحتوى مع حالة "pending"
    ⬇️
🔔 إشعار المدراء بوجود محتوى للمراجعة
    ⬇️
👨‍💼 مراجعة الإدارة والموافقة/الرفض
    ⬇️
✅ نشر المحتوى المعتمد للمستخدمين
```

### 2. حالات الموافقة

| الحالة | الوصف | مرئي للمستخدمين |
|--------|-------|------------------|
| `pending` | في انتظار المراجعة | ❌ لا |
| `approved` | تم اعتماده | ✅ نعم |
| `rejected` | تم رفضه | ❌ لا |

## 🗄️ قاعدة البيانات

### أعمدة الموافقة الجديدة

```sql
-- للمانجا والفصول
approval_status approval_status DEFAULT 'approved'  -- حالة الموافقة
reviewed_by TEXT                                    -- معرف المراجع
reviewed_at TIMESTAMPTZ                            -- تاريخ المراجعة  
review_notes TEXT                                   -- ملاحظات المراجعة
```

### جدول قائمة المراجعة

```sql
content_review_queue (
  id UUID PRIMARY KEY,
  content_type VARCHAR(20),      -- 'manga' أو 'chapter'
  content_id TEXT,               -- معرف المحتوى
  manga_id TEXT,                 -- للفصول، ربط بالمانجا
  title TEXT,                    -- عنوان المحتوى
  description TEXT,              -- وصف المحتوى
  priority INTEGER DEFAULT 0,    -- أولوية المراجعة
  auto_added_by TEXT,           -- مصدر الإضافة
  status approval_status,        -- حالة المراجع��
  submitted_at TIMESTAMPTZ,      -- تاريخ الإرسال
  reviewed_by TEXT,             -- المراجع
  reviewed_at TIMESTAMPTZ,      -- تاريخ المراجعة
  review_notes TEXT,            -- ملاحظات المراجعة
  reviewer_action TEXT          -- إجراء المراجع
)
```

## 🛠️ الوظائف الأساسية

### إضافة للمراجعة
```sql
SELECT add_to_review_queue(
  'manga',                    -- نوع المحتوى
  'manga-id-123',            -- معرف المحتوى
  NULL,                      -- معرف المانجا (للفصول)
  'عنوان المانجا',           -- العنوان
  'وصف المانجا',            -- الوصف
  1,                         -- الأولوية
  'auto-system'              -- مصدر الإضافة
);
```

### الموافقة على المحتوى
```sql
SELECT approve_content(
  'queue-id-uuid',           -- معرف قائمة المراجعة
  'admin-user-id',          -- معرف المراجع
  'ملاحظات الموافقة'        -- ملاحظات اختيارية
);
```

### رفض المحتوى
```sql
SELECT reject_content(
  'queue-id-uuid',           -- معرف قائمة المراجعة  
  'admin-user-id',          -- معرف المراجع
  'سبب ا��رفض'               -- ملاحظات مطلوبة
);
```

### جلب الإحصائيات
```sql
SELECT * FROM get_review_queue_stats();
-- إرجاع: pending_manga, pending_chapters, total_pending, 
--        approved_today, rejected_today, oldest_pending_days
```

## 🎛️ واجهة المراجعة

### الوصول للواجهة
- **لوحة الإدارة** → زر "مراجعة المحتوى" (برتقالي)
- **الرابط المباشر:** `/admin/review-queue`
- **الصلاحيات:** admin, owner, site_admin فقط

### المميزات الرئيسية

#### 1. إحصائيات سريعة
```typescript
- إجمالي المعلق: XX
- مانجا معلقة: XX  
- فصول معلقة: XX
- أقدم عنصر معلق: XX يوم
```

#### 2. فلاتر المحتوى
- **الكل:** جميع العناصر المعلقة
- **مانجا:** المانجا المعلقة فقط
- **فصول:** الفصول المعلقة فقط

#### 3. معلومات العنصر
- العنوان والوصف
- نوع المحتوى (مانجا/فصل)
- الأولوية (عالية/عادية)
- تاريخ الإضافة
- المصدر
- التصنيفات (للمانجا)
- رقم الفصل (للفصول)

#### 4. إجراءات المراجعة
- **عرض:** فتح المحتوى في نافذة جديدة
- **موافقة:** اعتماد المحتوى ونشره
- **رفض:** رفض المحتوى وإخفاؤه

## 📱 الإشعارات

### إشعارات تلقائية
```typescript
// عند إضافة محتوى للمراجعة
{
  type: 'content_review',
  title: 'محتوى جديد للمراجعة',
  message: 'مانجا جديدة تحتاج للمراجعة: عنوان المانجا',
  data: {
    queue_id: 'uuid',
    content_type: 'manga',
    content_id: 'manga-id',
    title: 'عنوان المانجا'
  }
}
```

### مكونات الإشعارات
- **ReviewNotifications:** إشعار ثابت في الزاوية
- **ReviewNotificationIcon:** أيقونة مع عداد في الشريط العلوي

## 🔧 التكامل مع النظام التلقائي

### تحديث خدمة المانجا التلقائية

```typescript
// autoMangaServiceWithApproval.ts
class AutoMangaServiceWithApproval {
  
  // إضافة مانجا للمراجعة
  private async addNewMangaForApproval(mangaData: MangaData) {
    const { data: manga } = await supabase
      .from('manga')
      .insert({
        ...mangaData,
        auto_added: true,           // مضافة تلقائياً
        approval_status: 'pending', // في انتظ��ر المراجعة
        created_by: 'auto-system'
      });
    
    return manga.id;
  }
  
  // نتائج المزامنة تشمل العناصر المعلقة
  interface SyncResult {
    newManga: number;
    newChapters: number;
    duplicatesSkipped: number;
    pendingReview: number;  // 🆕 العناصر المعلقة
    errors: string[];
  }
}
```

### Triggers التلقائية

```sql
-- عند إدراج مانجا جديدة
CREATE TRIGGER manga_auto_review 
  BEFORE INSERT ON manga 
  FOR EACH ROW 
  EXECUTE FUNCTION trigger_add_manga_to_review();

-- عند إدراج فصل جديد  
CREATE TRIGGER chapter_auto_review 
  BEFORE INSERT ON chapters 
  FOR EACH ROW 
  EXECUTE FUNCTION trigger_add_chapter_to_review();
```

## 🔒 الأمان والصلاحيات

### Row Level Security (RLS)

```sql
-- المدراء فقط يرون قائمة المراجعة
CREATE POLICY "Admins can manage review queue" ON content_review_queue
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );

-- المستخدمون يرون المحتوى المعتمد فقط
CREATE POLICY "Anyone can view approved manga" ON manga
  FOR SELECT USING (
    approval_status = 'approved' OR 
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );
```

### فلترة المحتوى في الاستعلامات

```typescript
// للمستخدمين العاديين
const { data: manga } = await supabase
  .from('manga')
  .select('*')
  .eq('approval_status', 'approved'); // معتمدة فقط

// للمدراء - يرون كل المحتوى
const { data: manga } = await supabase
  .from('manga')
  .select('*'); // جميع الحالات
```

## 📊 التتبع والإحصائيات

### معلومات المراجعة المحفوظة

```typescript
{
  approved_today: 15,        // معتمد اليوم
  rejected_today: 3,         // مرفوض اليوم
  pending_manga: 8,          // مانجا معلقة
  pending_chapters: 24,      // فصول معلقة
  oldest_pending_days: 5,    // أقدم عنصر معلق
  average_review_time: 2.5   // متوسط وقت المراجعة (ساعات)
}
```

### سجلات المراجعة

```sql
-- تتبع جميع إجراءات المراجعة
SELECT 
  crq.title,
  crq.content_type,
  crq.status,
  crq.reviewed_by,
  crq.reviewed_at,
  crq.review_notes,
  p.display_name as reviewer_name
FROM content_review_queue crq
LEFT JOIN profiles p ON crq.reviewed_by = p.user_id
WHERE crq.reviewed_at >= NOW() - INTERVAL '7 days'
ORDER BY crq.reviewed_at DESC;
```

## 🚀 الاستخدام العملي

### سيناريو نموذجي

1. **الصباح الباكر (2:00 ص):**
   - النظام التلقائي يجلب محتوى جديد
   - 5 مانجا جديدة و 12 فصل جديد يُضافون للمراجعة

2. **الصباح (9:00 ص):**
   - المدير يفتح لوحة الإدارة
   - يرى إشعار "17 عنصر يحتاج مراجعة"
   - يفتح واجهة المراجعة

3. **المراجعة:**
   ```
   ✅ مانجا 1: موافقة (محتوى جيد)
   ❌ مانجا 2: رفض (محتوى غير مناسب)
   ✅ مانجا 3: موافقة (بعد مراجعة التصنيفات)
   ✅ 12 فصل: موافقة جماعية (فصول لمانجا معتمدة مسبقاً)
   ```

4. **النتيجة:**
   - 4 مانجا جديدة منشورة للمستخدمين
   - 12 فصل جديد متاح للقراءة
   - 1 مانجا مرفوضة (مخفية)

### نصائح للمراجعة السريعة

1. **أولوية المراجعة:**
   - مانجا جديدة أولاً (أولوية عالية)
   - فصو�� لمانجا معتمدة مسبقاً (أولوية منخفضة)

2. **معايير الموافقة:**
   - جودة الترجمة والصور
   - ملاءمة المحتوى للجمهور المستهدف
   - صحة المعلومات والتصنيفات

3. **معايير الرفض:**
   - محتوى غير مناسب أو مسيء
   - جودة رديئة جداً
   - مخالفة حقوق الطبع والنشر

## 🔧 الصيانة والتحسين

### تنظيف دوري
```sql
-- حذف سجلات المراجعة القديمة (أكثر من 3 شهور)
DELETE FROM content_review_queue 
WHERE reviewed_at < NOW() - INTERVAL '3 months';

-- أرشفة السجلات المهمة
INSERT INTO review_archive 
SELECT * FROM content_review_queue 
WHERE reviewed_at < NOW() - INTERVAL '1 month'
AND status IN ('approved', 'rejected');
```

### مراقبة الأداء
```sql
-- متوسط وقت المراجعة
SELECT 
  AVG(EXTRACT(EPOCH FROM (reviewed_at - submitted_at))/3600) as avg_hours
FROM content_review_queue 
WHERE status != 'pending';

-- إحصائيات المراجعين
SELECT 
  reviewed_by,
  COUNT(*) as total_reviews,
  COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
  COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
FROM content_review_queue 
WHERE reviewed_at >= NOW() - INTERVAL '1 month'
GROUP BY reviewed_by;
```

---

## 📞 الدعم والتطوير

هذا النظام مصمم ليكون:
- **آمن:** محتوى محمي ومفلتر
- **سريع:** مراجعة فعالة مع إشعارات فورية  
- **مرن:** قابل للتخصيص والتوسع
- **شفاف:** سجلات مفصلة لجميع الإجراءات

**النظام الآن جاهز لضمان جودة المحتوى مع الحفاظ على السرعة التلقائية! 🎉**

-- إضافة حالات الموافقة للمانجا
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_status') THEN
        CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END $$;

-- إضافة أعمدة الموافقة للمانجا
ALTER TABLE manga 
ADD COLUMN IF NOT EXISTS approval_status approval_status DEFAULT 'approved',
ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_notes TEXT;

-- إضافة أعمدة الموافقة للفصول
ALTER TABLE chapters 
ADD COLUMN IF NOT EXISTS approval_status approval_status DEFAULT 'approved',
ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_notes TEXT;

-- تحديث المانجا والفصول المضافة يدوياً لتكون معتمدة
UPDATE manga SET approval_status = 'approved' WHERE auto_added = false OR auto_added IS NULL;
UPDATE chapters SET approval_status = 'approved' WHERE auto_added = false OR auto_added IS NULL;

-- جدول قائمة انتظار المراجعة
CREATE TABLE IF NOT EXISTS content_review_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content_type VARCHAR(20) CHECK (content_type IN ('manga', 'chapter')) NOT NULL,
  content_id TEXT NOT NULL,
  manga_id TEXT, -- للفصول، ربط بالمانجا
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 0, -- أولوية المراجعة
  auto_added_by TEXT, -- مصدر الإضافة التلقائية
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  status approval_status DEFAULT 'pending',
  review_notes TEXT,
  reviewer_action TEXT, -- 'approved', 'rejected', 'needs_edit'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_content_review_queue_status ON content_review_queue(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_review_queue_type ON content_review_queue(content_type, status);
CREATE INDEX IF NOT EXISTS idx_manga_approval_status ON manga(approval_status, auto_added);
CREATE INDEX IF NOT EXISTS idx_chapters_approval_status ON chapters(approval_status, auto_added);

-- دالة لإضافة محتوى للمراجعة
CREATE OR REPLACE FUNCTION add_to_review_queue(
  p_content_type VARCHAR(20),
  p_content_id TEXT,
  p_manga_id TEXT DEFAULT NULL,
  p_title TEXT DEFAULT '',
  p_description TEXT DEFAULT '',
  p_priority INTEGER DEFAULT 0,
  p_auto_added_by TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  queue_id UUID;
BEGIN
  INSERT INTO content_review_queue (
    content_type, content_id, manga_id, title, description, 
    priority, auto_added_by
  ) VALUES (
    p_content_type, p_content_id, p_manga_id, p_title, p_description,
    p_priority, p_auto_added_by
  ) RETURNING id INTO queue_id;
  
  RETURN queue_id;
END;
$$ LANGUAGE plpgsql;

-- دالة للموافقة على المحتوى
CREATE OR REPLACE FUNCTION approve_content(
  p_queue_id UUID,
  p_reviewer_id TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  queue_record RECORD;
BEGIN
  -- جلب سجل المراجعة
  SELECT * INTO queue_record FROM content_review_queue WHERE id = p_queue_id;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- تحديث حالة المحتوى
  IF queue_record.content_type = 'manga' THEN
    UPDATE manga 
    SET approval_status = 'approved',
        reviewed_by = p_reviewer_id,
        reviewed_at = NOW()
    WHERE id = queue_record.content_id;
  ELSIF queue_record.content_type = 'chapter' THEN
    UPDATE chapters 
    SET approval_status = 'approved',
        reviewed_by = p_reviewer_id,
        reviewed_at = NOW()
    WHERE id = queue_record.content_id;
  END IF;
  
  -- تحديث قائمة المراجعة
  UPDATE content_review_queue 
  SET status = 'approved',
      reviewed_by = p_reviewer_id,
      reviewed_at = NOW(),
      review_notes = p_notes,
      reviewer_action = 'approved'
  WHERE id = p_queue_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- دالة لرفض المحتوى
CREATE OR REPLACE FUNCTION reject_content(
  p_queue_id UUID,
  p_reviewer_id TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  queue_record RECORD;
BEGIN
  -- جلب سجل المراجعة
  SELECT * INTO queue_record FROM content_review_queue WHERE id = p_queue_id;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- تحديث حالة المحتوى
  IF queue_record.content_type = 'manga' THEN
    UPDATE manga 
    SET approval_status = 'rejected',
        reviewed_by = p_reviewer_id,
        reviewed_at = NOW(),
        review_notes = p_notes
    WHERE id = queue_record.content_id;
  ELSIF queue_record.content_type = 'chapter' THEN
    UPDATE chapters 
    SET approval_status = 'rejected',
        reviewed_by = p_reviewer_id,
        reviewed_at = NOW(),
        review_notes = p_notes
    WHERE id = queue_record.content_id;
  END IF;
  
  -- تحديث قائمة المراجعة
  UPDATE content_review_queue 
  SET status = 'rejected',
      reviewed_by = p_reviewer_id,
      reviewed_at = NOW(),
      review_notes = p_notes,
      reviewer_action = 'rejected'
  WHERE id = p_queue_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- دالة للحصول على إحصائيات المراجعة
CREATE OR REPLACE FUNCTION get_review_queue_stats()
RETURNS TABLE (
  pending_manga BIGINT,
  pending_chapters BIGINT,
  total_pending BIGINT,
  approved_today BIGINT,
  rejected_today BIGINT,
  oldest_pending_days INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(CASE WHEN content_type = 'manga' AND status = 'pending' THEN 1 END) as pending_manga,
    COUNT(CASE WHEN content_type = 'chapter' AND status = 'pending' THEN 1 END) as pending_chapters,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as total_pending,
    COUNT(CASE WHEN status = 'approved' AND DATE(reviewed_at) = CURRENT_DATE THEN 1 END) as approved_today,
    COUNT(CASE WHEN status = 'rejected' AND DATE(reviewed_at) = CURRENT_DATE THEN 1 END) as rejected_today,
    COALESCE(
      EXTRACT(DAY FROM NOW() - MIN(CASE WHEN status = 'pending' THEN submitted_at END))::INTEGER,
      0
    ) as oldest_pending_days
  FROM content_review_queue;
END;
$$ LANGUAGE plpgsql;

-- Triggers لإضافة المحتوى التلقائي للمراجعة
CREATE OR REPLACE FUNCTION trigger_add_manga_to_review()
RETURNS TRIGGER AS $$
BEGIN
  -- إذا كانت المانجا مضافة تلقائياً، أضفها للمراجعة
  IF NEW.auto_added = true THEN
    NEW.approval_status = 'pending';
    
    PERFORM add_to_review_queue(
      'manga',
      NEW.id,
      NULL,
      NEW.title,
      NEW.description,
      1, -- أولوية عالية للمانجا
      NEW.created_by
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_add_chapter_to_review()
RETURNS TRIGGER AS $$
BEGIN
  -- إذا كان الفصل مضاف تلقائياً، أضفه للمراجعة
  IF NEW.auto_added = true THEN
    NEW.approval_status = 'pending';
    
    PERFORM add_to_review_queue(
      'chapter',
      NEW.id,
      NEW.manga_id,
      NEW.title,
      NEW.description,
      0, -- أولوية منخفضة للفصو��
      NEW.created_by
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء Triggers
DROP TRIGGER IF EXISTS manga_auto_review ON manga;
CREATE TRIGGER manga_auto_review 
  BEFORE INSERT ON manga 
  FOR EACH ROW 
  EXECUTE FUNCTION trigger_add_manga_to_review();

DROP TRIGGER IF EXISTS chapter_auto_review ON chapters;
CREATE TRIGGER chapter_auto_review 
  BEFORE INSERT ON chapters 
  FOR EACH ROW 
  EXECUTE FUNCTION trigger_add_chapter_to_review();

-- تحديث trigger التوقيت
CREATE TRIGGER update_content_review_queue_updated_at BEFORE UPDATE ON content_review_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- صلاحيات
GRANT SELECT, INSERT, UPDATE ON content_review_queue TO authenticated;

-- RLS
ALTER TABLE content_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage review queue" ON content_review_queue
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );

-- تحديث policies للمانجا والفصول لإخفاء المحتوى غير المعتمد
DROP POLICY IF EXISTS "Anyone can view approved manga" ON manga;
CREATE POLICY "Anyone can view approved manga" ON manga
  FOR SELECT USING (
    approval_status = 'approved' OR 
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );

DROP POLICY IF EXISTS "Anyone can view approved chapters" ON chapters;  
CREATE POLICY "Anyone can view approved chapters" ON chapters
  FOR SELECT USING (
    approval_status = 'approved' OR 
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );

-- إضافة إشعار تلقائي عند وجود محتوى جديد للمراجعة
CREATE OR REPLACE FUNCTION notify_admins_new_content()
RETURNS TRIGGER AS $$
BEGIN
  -- إشعار للمدراء عند إضافة محتوى جديد للمراجعة
  INSERT INTO notifications (
    user_id,
    type,
    title, 
    message,
    data
  )
  SELECT 
    p.user_id,
    'content_review',
    'محتوى جديد للمراجعة',
    CASE 
      WHEN NEW.content_type = 'manga' THEN 'مانجا جديدة تحتاج للمراجعة: ' || NEW.title
      ELSE 'فصل جديد يحتاج للمراجعة: ' || NEW.title
    END,
    jsonb_build_object(
      'queue_id', NEW.id,
      'content_type', NEW.content_type,
      'content_id', NEW.content_id,
      'title', NEW.title
    )
  FROM profiles p
  WHERE p.role IN ('admin', 'owner', 'site_admin');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notify_admins_on_new_review 
  AFTER INSERT ON content_review_queue 
  FOR EACH ROW 
  EXECUTE FUNCTION notify_admins_new_content();

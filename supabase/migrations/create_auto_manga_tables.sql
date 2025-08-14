-- جدول مصادر المانجا
CREATE TABLE IF NOT EXISTS manga_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  base_url TEXT NOT NULL,
  type VARCHAR(20) CHECK (type IN ('api', 'scraping')) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- إضافة أعمدة للمانجا لربطها بالمصادر
ALTER TABLE manga 
ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES manga_sources(id),
ADD COLUMN IF NOT EXISTS source_manga_id TEXT,
ADD COLUMN IF NOT EXISTS auto_added BOOLEAN DEFAULT false;

-- إضافة أعمدة للفصول لربطها بالمصادر
ALTER TABLE chapters 
ADD COLUMN IF NOT EXISTS source_chapter_id TEXT,
ADD COLUMN IF NOT EXISTS auto_added BOOLEAN DEFAULT false;

-- جدول سجلات المزامنة
CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID REFERENCES manga_sources(id),
  status VARCHAR(20) CHECK (status IN ('success', 'error', 'warning')) NOT NULL,
  message TEXT,
  details JSONB,
  manga_count INTEGER DEFAULT 0,
  chapter_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- جدول إعدادات النظام التلقائي
CREATE TABLE IF NOT EXISTS auto_system_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- إدراج الإعدادات الافتراضية
INSERT INTO auto_system_settings (key, value, description) VALUES
('sync_schedule', '{"enabled": true, "interval": "daily", "time": "02:00"}', 'جدولة المزامنة التلقائية'),
('rate_limits', '{"default": 60, "max": 300}', 'حدود معدل الطلبات (طلب/دقيقة)'),
('duplicate_check', '{"enabled": true, "fields": ["title", "author"]}', 'إعدادات فحص التكرار'),
('notifications', '{"admin_email": "", "discord_webhook": ""}', 'إعدادات الإشعارات')
ON CONFLICT (key) DO NOTHING;

-- فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_manga_source ON manga(source_id, source_manga_id);
CREATE INDEX IF NOT EXISTS idx_chapters_source ON chapters(source_chapter_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_source_date ON sync_logs(source_id, created_at DESC);

-- دالة تحديث timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- إضافة triggers للتحديث التلقائي
CREATE TRIGGER update_manga_sources_updated_at BEFORE UPDATE ON manga_sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_auto_system_settings_updated_at BEFORE UPDATE ON auto_system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- دالة للحصول على إحصائيات المزامنة
CREATE OR REPLACE FUNCTION get_sync_statistics(source_uuid UUID DEFAULT NULL)
RETURNS TABLE (
  source_name TEXT,
  total_syncs BIGINT,
  successful_syncs BIGINT,
  failed_syncs BIGINT,
  last_sync TIMESTAMPTZ,
  total_manga BIGINT,
  total_chapters BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ms.name,
    COUNT(sl.id) as total_syncs,
    COUNT(CASE WHEN sl.status = 'success' THEN 1 END) as successful_syncs,
    COUNT(CASE WHEN sl.status = 'error' THEN 1 END) as failed_syncs,
    MAX(sl.created_at) as last_sync,
    COUNT(DISTINCT m.id) as total_manga,
    COUNT(DISTINCT c.id) as total_chapters
  FROM manga_sources ms
  LEFT JOIN sync_logs sl ON ms.id = sl.source_id
  LEFT JOIN manga m ON ms.id = m.source_id
  LEFT JOIN chapters c ON m.id = c.manga_id AND c.auto_added = true
  WHERE (source_uuid IS NULL OR ms.id = source_uuid)
  GROUP BY ms.id, ms.name;
END;
$$ LANGUAGE plpgsql;

-- صلاحيات المستخدمين
GRANT SELECT, INSERT, UPDATE, DELETE ON manga_sources TO authenticated;
GRANT SELECT, INSERT ON sync_logs TO authenticated;
GRANT SELECT, UPDATE ON auto_system_settings TO authenticated;

-- RLS (Row Level Security)
ALTER TABLE manga_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_system_settings ENABLE ROW LEVEL SECURITY;

-- سياسات الأمان للمدراء فقط
CREATE POLICY "Admins can manage manga sources" ON manga_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );

CREATE POLICY "Admins can view sync logs" ON sync_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );

CREATE POLICY "Admins can manage system settings" ON auto_system_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );

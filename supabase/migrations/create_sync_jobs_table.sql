-- جدول مهام المزامنة
CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY,
  source_id UUID REFERENCES manga_sources(id),
  status VARCHAR(20) CHECK (status IN ('pending', 'running', 'completed', 'failed')) NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  progress JSONB DEFAULT '{}',
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_at ON sync_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_source ON sync_jobs(source_id, started_at DESC);

-- trigger للتحديث التلقائي
CREATE TRIGGER update_sync_jobs_updated_at BEFORE UPDATE ON sync_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- صلاحيات
GRANT SELECT, INSERT, UPDATE ON sync_jobs TO authenticated;

-- RLS
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage sync jobs" ON sync_jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role IN ('admin', 'owner', 'site_admin')
    )
  );

-- دالة للحصول على إحصائيات المهام
CREATE OR REPLACE FUNCTION get_sync_job_statistics()
RETURNS TABLE (
  total_jobs BIGINT,
  completed_jobs BIGINT,
  failed_jobs BIGINT,
  running_jobs BIGINT,
  avg_duration_minutes NUMERIC,
  last_successful_sync TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_jobs,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
    COUNT(CASE WHEN status = 'running' THEN 1 END) as running_jobs,
    AVG(
      CASE 
        WHEN status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (completed_at - started_at)) / 60.0 
      END
    ) as avg_duration_minutes,
    MAX(CASE WHEN status = 'completed' THEN completed_at END) as last_successful_sync
  FROM sync_jobs;
END;
$$ LANGUAGE plpgsql;

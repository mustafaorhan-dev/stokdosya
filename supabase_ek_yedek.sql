-- Yedekler tablosu
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  label TEXT DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT ''
);

ALTER TABLE backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_backups" ON backups;
CREATE POLICY "anon_all_backups" ON backups FOR ALL USING (true) WITH CHECK (true);

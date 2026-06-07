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

-- pg_cron ile gece 23:00 yedekleme
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION nightly_backup()
RETURNS void AS $$
DECLARE
  ts TEXT := to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  filename TEXT := 'yedek_' || to_char(now(), 'YYYY-MM-DD_HH24MI') || '.json';
  backup_json JSONB;
BEGIN
  backup_json := jsonb_build_object(
    'products', (SELECT jsonb_agg(to_jsonb(p)) FROM products p),
    'transactions', (SELECT jsonb_agg(to_jsonb(t)) FROM transactions t),
    'users', (SELECT jsonb_agg(to_jsonb(u)) FROM stok_users u),
    'tenders', (SELECT jsonb_agg(to_jsonb(t)) FROM tenders t),
    'companies', (SELECT jsonb_agg(name) FROM companies),
    'product_names', (SELECT jsonb_agg(name) FROM product_names),
    'settings', (SELECT jsonb_agg(to_jsonb(s)) FROM settings s)
  );
  
  INSERT INTO backups (id, filename, label, data, created_at, created_by)
  VALUES (ts, filename, 'otomatik-gece', backup_json, now(), 'auto-backup');
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule('nightly-backup-job', '0 23 * * *', 'SELECT nightly_backup()');

-- ============================================================
-- STOKDEPO — Supabase Auth + Row Level Security (RLS) Kurulumu
-- Supabase Dashboard > SQL Editor > New query  (yapıştırıp RUN)
-- ============================================================

-- 1) stok_users tablosuna email kolonu ekle (giriş e-postası buradan eşleşir)
alter table public.stok_users add column if not exists email text;

-- 2) Her kullanıcının e-postasını yazın (Supabase Authentication'daki e-posta ile AYNI olmalı)
--    Aşağıyı kendinize göre düzenleyin, sonra ayrı ayrı çalıştırın:
-- update public.stok_users set email = 'ornek1@kurum.com' where name = 'MUSTAFA ORHAN';
-- update public.stok_users set email = 'ornek2@kurum.com' where name = 'AHMET YILMAZ';

-- 3) RLS'i tüm tablolarda AÇ (kapalıysa herkes anon anahtarla erişebiliyor demektir)
alter table public.products      enable row level security;
alter table public.transactions  enable row level security;
alter table public.stok_users    enable row level security;
alter table public.tenders       enable row level security;
alter table public.companies     enable row level security;
alter table public.product_names enable row level security;
alter table public.settings      enable row level security;
alter table public.costs         enable row level security;

-- 4) SADECE giriş yapmış (authenticated) kullanıcılara tam erişim ver.
--    'anon' rolüne policy verilmediği için anon anahtar tek başına HİÇBİR ŞEY okuyamaz/yazamaz.
do $$
declare
  t text;
begin
  foreach t in array array['products','transactions','stok_users','tenders','companies','product_names','settings','costs']
  loop
    execute format('drop policy if exists %I on public.%I;', 'authenticated_all_' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true);', 'authenticated_all_' || t, t);
  end loop;
end $$;

-- 5) Kontrol: aşağıdaki sorgu BOŞ dönmeli (RLS kapalı tablo kalmamalı)
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;

-- ============================================================
-- NOT: Bu script'ten sonra program yalnızca şu kişilerle açılır:
--   • Supabase > Authentication > Users'ta tanımlı bir e-posta + şifre, VE
--   • stok_users tablosunda aynı e-posta ile eşleşen bir kayıt (rol için).
-- ============================================================

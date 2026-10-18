-- ============================================================
-- STOKDEPO — GÜVENLİK DÜZELTMESİ (anon/public politikalarını kaldır)
-- Supabase Dashboard > SQL Editor > New query  (yapıştırıp RUN)
-- ============================================================
-- SORUN: pg_policies çıktısında {public} (anon) rolüne ait policy'ler var.
-- {public} = giriş yapmamış kişiler. app.js'deki açık (publishable) anahtarla
-- bu tablolar giriş yapmadan okunup yazılabiliyor/silinebiliyor.

-- 1) RLS'i tüm tablolarda aç (kapalı olan kalmasın)
alter table public.products      enable row level security;
alter table public.transactions  enable row level security;
alter table public.stok_users    enable row level security;
alter table public.tenders       enable row level security;
alter table public.companies     enable row level security;
alter table public.product_names enable row level security;
alter table public.settings      enable row level security;
alter table public.costs         enable row level security;
alter table public.backups       enable row level security;

-- 2) anon / public rolüne ait TÜM politikaları sil
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles && array['anon','public','authenticator']::name[]
  loop
    execute format('drop policy if exists %I on %I.%I;', r.policyname, r.schemaname, r.tablename);
    raise notice 'Silindi: %.% -> %', r.schemaname, r.tablename, r.policyname;
  end loop;
end $$;

-- 3) Her tablo için YALNIZCA authenticated'a tam erişim politikası olsun
do $$
declare
  t text;
begin
  foreach t in array array['products','transactions','stok_users','tenders','companies','product_names','settings','costs','backups']
  loop
    execute format('drop policy if exists %I on public.%I;', 'authenticated_all_' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true);', 'authenticated_all_' || t, t);
  end loop;
end $$;

-- 4) KONTROL: bu sorgu YALNIZCA {authenticated} satırları dönmeli.
--    {anon} veya {public} görünüyorsa tekrar bildir.
-- select tablename, policyname, roles, cmd
-- from pg_policies where schemaname = 'public' order by tablename;

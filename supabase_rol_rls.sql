-- ============================================================
-- STOKDEPO — ROL BAZLI RLS
-- "Sadece Görüntüleme" rolü YAZAMAZ, yalnızca OKUR.
-- Diğer roller (Yönetici, Depo Kullanıcısı vb.) tam erişim.
-- Supabase Dashboard > SQL Editor > New query  (yapıştırıp RUN)
-- ============================================================

-- 1) Giriş yapan kullanıcı yazma yetkili mi? (email -> stok_users.role)
--    security definer: stok_users'ı RLS'e takılmadan okuyabilir (özyineleme olmaz).
--    Eşleşen kayıt yoksa = false (güvenli varsayılan: yazamaz).
create or replace function public.is_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (u.role is distinct from 'Sadece Görüntüleme')
     from public.stok_users u
     where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     limit 1),
    false)
$$;

grant execute on function public.is_writer() to authenticated;

-- 2) Her tablo için: SELECT = tüm giriş yapanlar,
--    INSERT/UPDATE/DELETE = yalnızca is_writer() true ise.
do $$
declare
  t text;
begin
  foreach t in array array['products','transactions','stok_users','tenders','companies','product_names','settings','costs','backups']
  loop
    -- eski ALL politikasını ve varsa önceki sürümleri temizle
    execute format('drop policy if exists %I on public.%I;', 'authenticated_all_' || t, t);
    execute format('drop policy if exists %I on public.%I;', 'read_' || t, t);
    execute format('drop policy if exists %I on public.%I;', 'ins_' || t, t);
    execute format('drop policy if exists %I on public.%I;', 'upd_' || t, t);
    execute format('drop policy if exists %I on public.%I;', 'del_' || t, t);

    -- okuma: giriş yapan herkes
    execute format('create policy %I on public.%I for select to authenticated using (true);', 'read_' || t, t);
    -- yazma: yalnızca yetkili roller
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_writer());', 'ins_' || t, t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_writer()) with check (public.is_writer());', 'upd_' || t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_writer());', 'del_' || t, t);
  end loop;
end $$;

-- 3) KONTROL: her tabloda read_/ins_/upd_/del_ politikaları görünmeli.
-- select tablename, policyname, roles, cmd
-- from pg_policies where schemaname = 'public' order by tablename, cmd;

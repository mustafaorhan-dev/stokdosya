-- ============================================================
-- STOKDEPO — İHALE SENARYO (SİMÜLASYON) KURULUMU
-- Tek ortak senaryo tabloları. Sayfa, Rol Bazlı Yetkiler'deki
-- "İhale Senaryo" satırına göre açılır; varsayılan kapalıdır.
-- Gerçek ihale/stok verilerine dokunmaz; yalnızca bu iki tabloyu kullanır.
--
-- Supabase Dashboard > SQL Editor > New query  (yapıştırıp RUN)
-- Bu dosyayı bir kez çalıştırmanız yeterlidir; tekrar çalıştırmak güvenlidir.
-- ============================================================

-- 1) Giriş yapan kullanıcı "Yönetici" mi? (email -> stok_users.role)
--    security definer: stok_users'ı RLS'e takılmadan okuyabilir.
--    Eşleşen kayıt yoksa = false (güvenli varsayılan: yetkisiz).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (u.role = 'Yönetici')
     from public.stok_users u
     where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     limit 1),
    false)
$$;

grant execute on function public.is_admin() to authenticated;

-- 1b) Rol Bazlı Yetkiler'deki "İhale Senaryo" tiki RLS tarafından da uygulanır.
--     Yönetici her zaman tam yetki; diğer roller settings tablosundaki
--     _rolePermissions kaydının modules.scenario.view/edit/delete alanına bakar. Kayıt yoksa = false.
create or replace function public.can_scenario(act text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_perms jsonb;
  v_val text;
begin
  if act not in ('view', 'edit', 'delete') then
    return false;
  end if;

  select u.role into v_role
  from public.stok_users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;

  if v_role is null then
    return false;
  end if;

  if v_role = 'Yönetici' then
    return true;
  end if;

  select (s.value)::jsonb into v_perms
  from public.settings s
  where s.key = '_rolePermissions'
  limit 1;

  if v_perms is null then
    return false;
  end if;

  v_val := v_perms #>> array[v_role, 'modules', 'scenario', act];
  return coalesce(v_val::boolean, false);
end;
$$;

grant execute on function public.can_scenario(text) to authenticated;

-- 2) Senaryo satırları (ihale başına bir kayıt)
--    tender_id: tenders.id ile aynı metin kimlik (FK yok; ihale silinince uygulama temizler)
--    base_delivered: senaryo girildiği andaki gerçek teslim miktarı
--    planned_extra: o andan itibaren planlanan ilave teslim
create table if not exists public.tender_scenario (
  tender_id text primary key,
  base_delivered numeric not null default 0,
  planned_extra numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- 3) Tek satırlık senaryo ayarları (hedef oran)
create table if not exists public.tender_scenario_meta (
  id smallint primary key check (id = 1),
  target_rate numeric null check (target_rate is null or (target_rate > 0 and target_rate <= 100)),
  updated_at timestamptz not null default now()
);

-- 4) RLS: Rol Bazlı Yetkiler'deki İhale Senaryo satırına göre okuma/yazma
alter table public.tender_scenario enable row level security;
alter table public.tender_scenario_meta enable row level security;

drop policy if exists admin_read_tender_scenario on public.tender_scenario;
drop policy if exists admin_ins_tender_scenario on public.tender_scenario;
drop policy if exists admin_upd_tender_scenario on public.tender_scenario;
drop policy if exists admin_del_tender_scenario on public.tender_scenario;

create policy admin_read_tender_scenario on public.tender_scenario
  for select to authenticated using (public.can_scenario('view'));
create policy admin_ins_tender_scenario on public.tender_scenario
  for insert to authenticated with check (public.can_scenario('edit'));
create policy admin_upd_tender_scenario on public.tender_scenario
  for update to authenticated using (public.can_scenario('edit')) with check (public.can_scenario('edit'));
create policy admin_del_tender_scenario on public.tender_scenario
  for delete to authenticated using (public.can_scenario('delete'));

drop policy if exists admin_read_tender_scenario_meta on public.tender_scenario_meta;
drop policy if exists admin_ins_tender_scenario_meta on public.tender_scenario_meta;
drop policy if exists admin_upd_tender_scenario_meta on public.tender_scenario_meta;
drop policy if exists admin_del_tender_scenario_meta on public.tender_scenario_meta;

create policy admin_read_tender_scenario_meta on public.tender_scenario_meta
  for select to authenticated using (public.can_scenario('view'));
create policy admin_ins_tender_scenario_meta on public.tender_scenario_meta
  for insert to authenticated with check (public.can_scenario('edit'));
create policy admin_upd_tender_scenario_meta on public.tender_scenario_meta
  for update to authenticated using (public.can_scenario('edit')) with check (public.can_scenario('edit'));
create policy admin_del_tender_scenario_meta on public.tender_scenario_meta
  for delete to authenticated using (public.can_scenario('delete'));

-- 5) Tablo yetkileri (RLS zaten yetki satırına göre engeller)
grant select, insert, update, delete on public.tender_scenario to authenticated;
grant select, insert, update, delete on public.tender_scenario_meta to authenticated;

-- 6) PostgREST şema önbelleğini yenile (yeni tablolar hemen görünsün)
notify pgrst, 'reload schema';

-- 7) KONTROL (isteğe bağlı):
-- select * from public.tender_scenario order by updated_at desc;
-- select * from public.tender_scenario_meta;
-- select tablename, policyname, cmd from pg_policies where schemaname = 'public'
--   and tablename in ('tender_scenario','tender_scenario_meta') order by tablename, cmd;

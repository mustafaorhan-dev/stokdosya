-- ============================================================
-- STOKDEPO — İHALE SENARYO YETKİ GÜNCELLEMESİ (SADE)
-- Sadece fonksiyon + RLS politikalarını günceller.
-- Supabase Dashboard > SQL Editor > New query içinde TAMAMINI seçip RUN çalıştır.
-- ============================================================

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

notify pgrst, 'reload schema';

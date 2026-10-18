-- ============================================================
-- STOKDEPO - Log Kayıtları (Supabase)
-- Supabase Dashboard > SQL Editor'de bu dosyayı bir kez çalıştırın.
-- Amaç: Giriş/çıkış ve önemli işlemlerin ortak log kaydı.
--       500 kayıt sınırı: yeni kayıt gelince en eskisi otomatik silinir.
-- ============================================================

-- 1) Tablo
create table if not exists public.logs (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor      text,
  tur        text,
  mesaj      text
);

create index if not exists logs_created_at_idx on public.logs (created_at desc);

-- 2) RLS (giriş yapmış kullanıcılar görüntüleyebilir / ekleyebilir / temizleyebilir)
alter table public.logs enable row level security;

drop policy if exists logs_select on public.logs;
create policy logs_select on public.logs
  for select to authenticated using (true);

drop policy if exists logs_insert on public.logs;
create policy logs_insert on public.logs
  for insert to authenticated with check (true);

drop policy if exists logs_delete on public.logs;
create policy logs_delete on public.logs
  for delete to authenticated using (true);

-- 3) 500 sınırı: her eklemede en yeni 500 kayıt kalır, fazlası otomatik silinir.
create or replace function public.logs_trim() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.logs
  where id in (
    select id from public.logs order by id desc offset 500
  );
  return null;
end;
$$;

drop trigger if exists logs_trim_after_insert on public.logs;
create trigger logs_trim_after_insert
  after insert on public.logs
  for each row execute function public.logs_trim();

-- PostgREST şema önbelleğini yenile
notify pgrst, 'reload schema';

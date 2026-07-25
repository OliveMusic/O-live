-- O'live 설정 동기화 + 사용자가 직접 실행하는 클라우드 데이터 삭제
-- 001_cloud_sync.sql을 실행한 뒤 Supabase SQL Editor에서 한 번 실행하세요.

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint user_preferences_object check (jsonb_typeof(preferences) = 'object'),
  constraint user_preferences_size check (octet_length(preferences::text) <= 65536)
);

alter table public.user_preferences enable row level security;

drop policy if exists "Users read their own preferences" on public.user_preferences;
create policy "Users read their own preferences"
on public.user_preferences for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users insert their own preferences" on public.user_preferences;
create policy "Users insert their own preferences"
on public.user_preferences for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own preferences" on public.user_preferences;
create policy "Users update their own preferences"
on public.user_preferences for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.user_preferences from anon, authenticated;
grant select, insert, update on table public.user_preferences to authenticated;

create or replace function public.delete_my_cloud_data()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  delete from public.ear_sync_events where user_id = v_user_id;
  delete from public.ear_history_imports where user_id = v_user_id;
  delete from public.ear_daily_scores where user_id = v_user_id;
  delete from public.user_preferences where user_id = v_user_id;
  return true;
end;
$$;

revoke all on function public.delete_my_cloud_data() from public;
grant execute on function public.delete_my_cloud_data() to authenticated;

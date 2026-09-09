-- O'live 목록 고정, 여러 항목 한 번에 삭제, 오래된 기록 정리.
-- 012_practice_links.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.

-- 자주 쓰는 반주가 최신순 정렬에 밀리지 않도록 고정할 수 있게 한다.
alter table public.practice_recordings
  add column if not exists pinned boolean not null default false;

alter table public.practice_links
  add column if not exists pinned boolean not null default false;

create index if not exists practice_recordings_user_pinned_idx
  on public.practice_recordings(user_id, pinned desc, recorded_at desc);

create index if not exists practice_links_user_pinned_idx
  on public.practice_links(user_id, pinned desc, created_at desc);

create or replace function public.set_practice_recording_pinned(
  p_recording_id uuid,
  p_pinned boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.practice_recordings
  set pinned=coalesce(p_pinned,false), updated_at=now()
  where id=p_recording_id and user_id=v_user_id;
  return found;
end;
$$;

create or replace function public.set_practice_link_pinned(
  p_link_id uuid,
  p_pinned boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.practice_links
  set pinned=coalesce(p_pinned,false), updated_at=now()
  where id=p_link_id and user_id=v_user_id;
  return found;
end;
$$;

-- 여러 항목을 고를 수 있으므로 한 번에 지운다. 한 건씩 왕복하면 느리고,
-- 중간에 끊기면 일부만 지워진 상태가 남는다.
create or replace function public.remove_practice_recordings(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_ids is null or array_length(p_ids,1) is null then return 0; end if;
  if array_length(p_ids,1) > 50 then raise exception 'Too many items'; end if;
  delete from public.practice_recordings
  where user_id=v_user_id and id = any(p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.delete_practice_links(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_ids is null or array_length(p_ids,1) is null then return 0; end if;
  if array_length(p_ids,1) > 50 then raise exception 'Too many items'; end if;
  delete from public.practice_links
  where user_id=v_user_id and id = any(p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- cleanup_ear_sync_events(003)와 cleanup_youtube_search_usage(012)는 정의만 되어
-- 있고 부르는 곳이 없어 두 테이블이 계속 쌓이고 있었다. pg_cron은 확장을 따로
-- 켜야 하므로, 로그인 직후 앱이 한 번 부르는 방식으로 둔다.
-- 자문 잠금을 걸어 동시에 여러 번 돌지 않게 한다.
create or replace function public.run_olive_maintenance()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('olive_maintenance',0)) then
    return false;
  end if;
  perform public.cleanup_ear_sync_events();
  perform public.cleanup_youtube_search_usage();
  return true;
end;
$$;

revoke all on function public.set_practice_recording_pinned(uuid,boolean) from public, anon;
grant execute on function public.set_practice_recording_pinned(uuid,boolean) to authenticated;

revoke all on function public.set_practice_link_pinned(uuid,boolean) from public, anon;
grant execute on function public.set_practice_link_pinned(uuid,boolean) to authenticated;

revoke all on function public.remove_practice_recordings(uuid[]) from public, anon;
grant execute on function public.remove_practice_recordings(uuid[]) to authenticated;

revoke all on function public.delete_practice_links(uuid[]) from public, anon;
grant execute on function public.delete_practice_links(uuid[]) to authenticated;

revoke all on function public.run_olive_maintenance() from public, anon;
grant execute on function public.run_olive_maintenance() to authenticated;

create or replace function public.olive_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select 13::integer; $$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

-- O'live 계정별 YouTube 연습 링크와 구간 반복 설정.
-- 011_recording_mime_types.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.
--
-- 주의: YouTube API 개발자 정책상 영상 제목·채널명·설명은 30일 안에 갱신하거나
-- 삭제해야 한다. 따라서 이 테이블에는 YouTube 메타데이터를 보관하지 않는다.
-- title은 사용자가 직접 정하거나 확인한 별칭이며, 검색 결과의 제목·채널명·썸네일은
-- 화면에 표시할 때만 쓰고 저장하지 않는다.

create table if not exists public.practice_links (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'youtube',
  video_id text not null,
  title text not null,
  duration_ms integer not null default 0,
  last_position_ms integer not null default 0,
  loop_a_ms integer,
  loop_b_ms integer,
  loop_enabled boolean not null default false,
  playback_rate real not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practice_links_provider_check
    check (provider in ('youtube')),
  constraint practice_links_video_check
    check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint practice_links_title_check
    check (char_length(title) between 1 and 80),
  constraint practice_links_duration_check
    check (duration_ms between 0 and 43200000),
  constraint practice_links_position_check
    check (last_position_ms between 0 and 43200000),
  constraint practice_links_rate_check
    check (playback_rate between 0.25 and 2),
  constraint practice_links_loop_check
    check (
      (loop_a_ms is null and loop_b_ms is null)
      or (
        loop_a_ms is not null and loop_b_ms is not null
        and loop_a_ms >= 0 and loop_b_ms > loop_a_ms
        and loop_b_ms <= 43200000
      )
    ),
  constraint practice_links_unique_video
    unique (user_id, provider, video_id)
);

create index if not exists practice_links_user_date_idx
  on public.practice_links(user_id, created_at desc);

alter table public.practice_links enable row level security;

drop policy if exists "Users read their own practice links" on public.practice_links;
create policy "Users read their own practice links"
on public.practice_links for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.practice_links from anon, authenticated;
grant select on table public.practice_links to authenticated;

-- 목록 길이 제한은 녹음과 링크를 합쳐 50개다. 링크는 Storage 용량을 쓰지 않으므로
-- 250MB 저장 한도에는 포함하지 않는다.
create or replace function public.save_practice_link(
  p_link_id uuid,
  p_video_id text,
  p_title text,
  p_duration_ms integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_title,''));
  v_duration integer := coalesce(p_duration_ms,0);
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_link_id is null then raise exception 'Invalid link id'; end if;
  if p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'Invalid YouTube video id';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'Invalid link title';
  end if;
  if v_duration not between 0 and 43200000 then
    raise exception 'Link duration is outside the allowed range';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text,0));

  if exists (
    select 1 from public.practice_links
    where user_id=v_user_id and provider='youtube' and video_id=p_video_id
  ) then
    raise exception 'Link already saved';
  end if;

  select
    (select count(*) from public.practice_recordings where user_id=v_user_id)
    + (select count(*) from public.practice_links where user_id=v_user_id)
  into v_count;
  if v_count >= 50 then raise exception 'Practice item count limit reached'; end if;

  insert into public.practice_links(id,user_id,provider,video_id,title,duration_ms)
  values (p_link_id,v_user_id,'youtube',p_video_id,v_title,v_duration);
  return true;
end;
$$;

create or replace function public.rename_practice_link(
  p_link_id uuid,
  p_title text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_title,''));
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'Invalid link title';
  end if;
  update public.practice_links
  set title=v_title, updated_at=now()
  where id=p_link_id and user_id=v_user_id;
  return found;
end;
$$;

-- 연습 상태(마지막 위치, A/B 구간, 배속)는 자주 갱신되므로 한 번에 저장한다.
create or replace function public.save_practice_link_state(
  p_link_id uuid,
  p_last_position_ms integer,
  p_loop_a_ms integer,
  p_loop_b_ms integer,
  p_loop_enabled boolean,
  p_playback_rate real,
  p_duration_ms integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_a integer := p_loop_a_ms;
  v_b integer := p_loop_b_ms;
  v_rate real := coalesce(p_playback_rate,1);
  v_position integer := greatest(coalesce(p_last_position_ms,0),0);
  v_duration integer := greatest(coalesce(p_duration_ms,0),0);
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_a is null or v_b is null or v_b <= v_a or v_a < 0 then
    v_a := null;
    v_b := null;
  end if;
  if v_rate not between 0.25 and 2 then v_rate := 1; end if;
  if v_position > 43200000 then v_position := 43200000; end if;
  if v_duration > 43200000 then v_duration := 43200000; end if;

  update public.practice_links
  set last_position_ms=v_position,
      loop_a_ms=v_a,
      loop_b_ms=v_b,
      loop_enabled=(v_a is not null and coalesce(p_loop_enabled,false)),
      playback_rate=v_rate,
      duration_ms=case when v_duration > 0 then v_duration else duration_ms end,
      updated_at=now()
  where id=p_link_id and user_id=v_user_id;
  return found;
end;
$$;

create or replace function public.delete_practice_link(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  delete from public.practice_links where id=p_link_id and user_id=v_user_id;
  return found;
end;
$$;

revoke all on function public.save_practice_link(uuid,text,text,integer) from public, anon;
grant execute on function public.save_practice_link(uuid,text,text,integer) to authenticated;

revoke all on function public.rename_practice_link(uuid,text) from public, anon;
grant execute on function public.rename_practice_link(uuid,text) to authenticated;

revoke all on function public.save_practice_link_state(uuid,integer,integer,integer,boolean,real,integer) from public, anon;
grant execute on function public.save_practice_link_state(uuid,integer,integer,integer,boolean,real,integer) to authenticated;

revoke all on function public.delete_practice_link(uuid) from public, anon;
grant execute on function public.delete_practice_link(uuid) to authenticated;

-- YouTube Data API는 프로젝트 전체에 하루 100회의 search.list만 허용한다.
-- 한 사용자가 이를 모두 소진하지 못하도록 일자별 사용량만 센다.
-- 검색어 원문은 저장하지 않는다.
create table if not exists public.youtube_search_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  search_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.youtube_search_usage enable row level security;
revoke all on table public.youtube_search_usage from anon, authenticated;

-- 정책을 두지 않으므로 anon/authenticated는 접근할 수 없고, Edge Function의
-- service role만 이 함수를 통해 사용량을 올린다.
create or replace function public.consume_youtube_search_quota(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_user_count integer;
  v_global_count integer;
  v_user_limit constant integer := 20;
  v_global_limit constant integer := 90;
begin
  if p_user_id is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('olive_youtube_search',0));

  select coalesce(sum(search_count),0) into v_global_count
  from public.youtube_search_usage where day=v_day;
  if v_global_count >= v_global_limit then
    return jsonb_build_object('allowed',false,'reason','global');
  end if;

  select search_count into v_user_count
  from public.youtube_search_usage where user_id=p_user_id and day=v_day;
  if coalesce(v_user_count,0) >= v_user_limit then
    return jsonb_build_object('allowed',false,'reason','user');
  end if;

  /* ON CONFLICT DO UPDATE에서 대상 테이블은 별칭으로만 참조한다.
     스키마까지 붙인 이름(public.youtube_search_usage.search_count)은 쓸 수 없다. */
  insert into public.youtube_search_usage as u (user_id,day,search_count)
  values (p_user_id,v_day,1)
  on conflict (user_id,day) do update
  set search_count=u.search_count+1, updated_at=now();

  return jsonb_build_object('allowed',true,'remaining',v_global_limit-v_global_count-1);
end;
$$;

revoke all on function public.consume_youtube_search_quota(uuid) from public, anon, authenticated;
-- Edge Function이 service role로 호출하므로 실행 권한을 명시한다.
grant execute on function public.consume_youtube_search_quota(uuid) to service_role;

-- 오래된 사용량 기록은 남겨 둘 이유가 없다.
create or replace function public.cleanup_youtube_search_usage()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.youtube_search_usage
  where day < ((now() at time zone 'utc')::date - 30);
$$;

revoke all on function public.cleanup_youtube_search_usage() from public, anon, authenticated;
grant execute on function public.cleanup_youtube_search_usage() to service_role;

-- 기존 데이터 삭제 동작에 연습 링크도 포함한다.
-- 계정 자체를 지우는 경로는 auth.users의 on delete cascade가 처리한다.
create or replace function public.delete_my_cloud_data()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  delete from public.ear_sync_events where user_id=v_user_id;
  delete from public.ear_history_imports where user_id=v_user_id;
  delete from public.ear_daily_scores where user_id=v_user_id;
  delete from public.user_preferences where user_id=v_user_id;
  delete from public.practice_recordings where user_id=v_user_id;
  delete from public.practice_links where user_id=v_user_id;
  delete from public.youtube_search_usage where user_id=v_user_id;
  return true;
end;
$$;

revoke all on function public.delete_my_cloud_data() from public;
grant execute on function public.delete_my_cloud_data() to authenticated;

create or replace function public.olive_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select 12::integer; $$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

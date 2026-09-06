-- O'live 계정별 비공개 녹음 저장소와 메타데이터.
-- 005_schema_contract.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.

create table if not exists public.practice_recordings (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  object_path text not null unique,
  duration_ms integer not null,
  byte_size bigint not null,
  mime_type text not null,
  status text not null default 'pending',
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practice_recordings_title_check
    check (char_length(title) between 1 and 80),
  constraint practice_recordings_duration_check
    check (duration_ms between 1000 and 300000),
  constraint practice_recordings_size_check
    check (byte_size between 1 and 15728640),
  constraint practice_recordings_mime_check
    check (mime_type ~* '^(audio|video)/(mp4|webm|ogg|wav|x-m4a)(;.*)?$'),
  constraint practice_recordings_status_check
    check (status in ('pending','ready'))
);

create index if not exists practice_recordings_user_date_idx
  on public.practice_recordings(user_id, recorded_at desc);

alter table public.practice_recordings enable row level security;

drop policy if exists "Users read their own recordings" on public.practice_recordings;
create policy "Users read their own recordings"
on public.practice_recordings for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.practice_recordings from anon, authenticated;
grant select on table public.practice_recordings to authenticated;

-- 파일은 공개 URL이 없는 전용 버킷에 둔다. 한 파일은 최대 15MiB다.
insert into storage.buckets(id,name,public,file_size_limit)
values ('practice-recordings','practice-recordings',false,15728640)
on conflict (id) do update
set public=false, file_size_limit=15728640;

drop policy if exists "Users upload reserved recording objects" on storage.objects;
create policy "Users upload reserved recording objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id='practice-recordings'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists (
    select 1 from public.practice_recordings r
    where r.user_id=(select auth.uid())
      and r.object_path=name
      and r.status='pending'
  )
);

drop policy if exists "Users read their own recording objects" on storage.objects;
create policy "Users read their own recording objects"
on storage.objects for select
to authenticated
using (
  bucket_id='practice-recordings'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists "Users delete their own recording objects" on storage.objects;
create policy "Users delete their own recording objects"
on storage.objects for delete
to authenticated
using (
  bucket_id='practice-recordings'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create or replace function public.reserve_practice_recording(
  p_recording_id uuid,
  p_title text,
  p_object_path text,
  p_duration_ms integer,
  p_byte_size bigint,
  p_mime_type text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_title,''));
  v_count integer;
  v_bytes bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_recording_id is null or char_length(v_title) not between 1 and 80 then
    raise exception 'Invalid recording title';
  end if;
  if p_duration_ms not between 1000 and 300000 then
    raise exception 'Recording duration is outside the allowed range';
  end if;
  if p_byte_size not between 1 and 15728640 then
    raise exception 'Recording file is too large';
  end if;
  if p_mime_type !~* '^(audio|video)/(mp4|webm|ogg|wav|x-m4a)(;.*)?$' then
    raise exception 'Unsupported recording format';
  end if;
  if p_object_path !~ ('^'||v_user_id::text||'/'||p_recording_id::text||'\.(m4a|mp4|webm|ogg|wav)$') then
    raise exception 'Invalid recording path';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text,0));
  delete from public.practice_recordings
  where user_id=v_user_id and status='pending' and created_at < now()-interval '1 day';

  select count(*),coalesce(sum(byte_size),0)
  into v_count,v_bytes
  from public.practice_recordings
  where user_id=v_user_id;
  if v_count >= 50 then raise exception 'Recording count limit reached'; end if;
  if v_bytes+p_byte_size > 262144000 then raise exception 'Recording storage limit reached'; end if;

  insert into public.practice_recordings(
    id,user_id,title,object_path,duration_ms,byte_size,mime_type,status
  ) values (
    p_recording_id,v_user_id,v_title,p_object_path,p_duration_ms,p_byte_size,p_mime_type,'pending'
  );
  return true;
end;
$$;

create or replace function public.finalize_practice_recording(p_recording_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.practice_recordings
  set status='ready',updated_at=now()
  where id=p_recording_id and user_id=auth.uid() and status='pending';
  return found;
end;
$$;

create or replace function public.cancel_practice_recording(p_recording_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.practice_recordings
  where id=p_recording_id and user_id=auth.uid() and status='pending';
  return found;
end;
$$;

create or replace function public.rename_practice_recording(
  p_recording_id uuid,
  p_title text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_title text := btrim(coalesce(p_title,''));
begin
  if char_length(v_title) not between 1 and 80 then
    raise exception 'Invalid recording title';
  end if;
  update public.practice_recordings
  set title=v_title,updated_at=now()
  where id=p_recording_id and user_id=auth.uid() and status='ready';
  return found;
end;
$$;

create or replace function public.remove_practice_recording(p_recording_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.practice_recordings
  where id=p_recording_id and user_id=auth.uid();
  return found;
end;
$$;

revoke all on function public.reserve_practice_recording(uuid,text,text,integer,bigint,text) from public;
revoke all on function public.finalize_practice_recording(uuid) from public;
revoke all on function public.cancel_practice_recording(uuid) from public;
revoke all on function public.rename_practice_recording(uuid,text) from public;
revoke all on function public.remove_practice_recording(uuid) from public;
grant execute on function public.reserve_practice_recording(uuid,text,text,integer,bigint,text) to authenticated;
grant execute on function public.finalize_practice_recording(uuid) to authenticated;
grant execute on function public.cancel_practice_recording(uuid) to authenticated;
grant execute on function public.rename_practice_recording(uuid,text) to authenticated;
grant execute on function public.remove_practice_recording(uuid) to authenticated;

-- 기존 데이터 삭제 동작에 녹음 메타데이터도 포함한다.
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
as $$ select 6::integer; $$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

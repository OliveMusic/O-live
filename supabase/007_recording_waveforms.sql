-- O'live 녹음 파형 요약 데이터.
-- 006_recordings.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.

alter table public.practice_recordings
  add column if not exists waveform smallint[] not null default '{}'::smallint[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='practice_recordings_waveform_length_check'
      and conrelid='public.practice_recordings'::regclass
  ) then
    alter table public.practice_recordings
      add constraint practice_recordings_waveform_length_check
      check (cardinality(waveform) <= 240);
  end if;
end;
$$;

-- 파형을 함께 예약하는 새 시그니처로 교체한다.
drop function if exists public.reserve_practice_recording(uuid,text,text,integer,bigint,text);

create or replace function public.reserve_practice_recording(
  p_recording_id uuid,
  p_title text,
  p_object_path text,
  p_duration_ms integer,
  p_byte_size bigint,
  p_mime_type text,
  p_waveform smallint[]
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_title,''));
  v_waveform smallint[] := coalesce(p_waveform,'{}'::smallint[]);
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
  if cardinality(v_waveform) > 240 or exists (
    select 1 from unnest(v_waveform) value where value not between 0 and 100
  ) then
    raise exception 'Invalid recording waveform';
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
    id,user_id,title,object_path,duration_ms,byte_size,mime_type,waveform,status
  ) values (
    p_recording_id,v_user_id,v_title,p_object_path,p_duration_ms,p_byte_size,p_mime_type,v_waveform,'pending'
  );
  return true;
end;
$$;

-- 이전 녹음은 처음 펼쳤을 때 만든 파형을 계정에 보관해 다음 기기에서 재사용한다.
create or replace function public.save_practice_recording_waveform(
  p_recording_id uuid,
  p_waveform smallint[]
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_waveform smallint[] := coalesce(p_waveform,'{}'::smallint[]);
begin
  if cardinality(v_waveform) < 1 or cardinality(v_waveform) > 240 or exists (
    select 1 from unnest(v_waveform) value where value not between 0 and 100
  ) then
    raise exception 'Invalid recording waveform';
  end if;
  update public.practice_recordings
  set waveform=v_waveform,updated_at=now()
  where id=p_recording_id and user_id=auth.uid() and status='ready';
  return found;
end;
$$;

revoke all on function public.reserve_practice_recording(uuid,text,text,integer,bigint,text,smallint[]) from public;
revoke all on function public.save_practice_recording_waveform(uuid,smallint[]) from public;
grant execute on function public.reserve_practice_recording(uuid,text,text,integer,bigint,text,smallint[]) to authenticated;
grant execute on function public.save_practice_recording_waveform(uuid,smallint[]) to authenticated;

create or replace function public.olive_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select 7::integer; $$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

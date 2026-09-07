-- O'live 내 녹음 목록에 외부 오디오 파일을 함께 저장한다.
-- 009_recording_playback_gain.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.

alter table public.practice_recordings
  add column if not exists source_type text not null default 'recording';

alter table public.practice_recordings
  drop constraint if exists practice_recordings_source_type_check;
alter table public.practice_recordings
  add constraint practice_recordings_source_type_check
  check (source_type in ('recording','upload'));

-- 직접 녹음은 기존 5분 제한을 유지하고, 업로드한 반주는 최대 30분까지 허용한다.
alter table public.practice_recordings
  drop constraint if exists practice_recordings_duration_check;
alter table public.practice_recordings
  add constraint practice_recordings_duration_check
  check (
    (source_type='recording' and duration_ms between 1000 and 300000)
    or (source_type='upload' and duration_ms between 1000 and 1800000)
  );

alter table public.practice_recordings
  drop constraint if exists practice_recordings_mime_check;
alter table public.practice_recordings
  add constraint practice_recordings_mime_check
  check (mime_type ~* '^(audio/(mpeg|mp4|x-m4a|aac|wav|x-wav|ogg|webm|flac)|video/(mp4|webm|ogg))(;.*)?$');

drop function if exists public.reserve_practice_recording(uuid,text,text,integer,bigint,text,smallint[],timestamptz,real);

create or replace function public.reserve_practice_recording(
  p_recording_id uuid,
  p_title text,
  p_object_path text,
  p_duration_ms integer,
  p_byte_size bigint,
  p_mime_type text,
  p_waveform smallint[],
  p_recorded_at timestamptz,
  p_playback_gain real,
  p_source_type text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_title,''));
  v_waveform smallint[] := coalesce(p_waveform,'{}'::smallint[]);
  v_recorded_at timestamptz := coalesce(p_recorded_at,now());
  v_playback_gain real := coalesce(p_playback_gain,1);
  v_source_type text := lower(btrim(coalesce(p_source_type,'recording')));
  v_count integer;
  v_bytes bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_recording_id is null or char_length(v_title) not between 1 and 80 then
    raise exception 'Invalid recording title';
  end if;
  if v_source_type not in ('recording','upload') then
    raise exception 'Invalid recording source type';
  end if;
  if (v_source_type='recording' and p_duration_ms not between 1000 and 300000)
     or (v_source_type='upload' and p_duration_ms not between 1000 and 1800000) then
    raise exception 'Recording duration is outside the allowed range';
  end if;
  if p_byte_size not between 1 and 15728640 then
    raise exception 'Recording file is too large';
  end if;
  if p_mime_type !~* '^(audio/(mpeg|mp4|x-m4a|aac|wav|x-wav|ogg|webm|flac)|video/(mp4|webm|ogg))(;.*)?$' then
    raise exception 'Unsupported recording format';
  end if;
  if p_object_path !~ ('^'||v_user_id::text||'/'||p_recording_id::text||'\.(mp3|m4a|mp4|aac|webm|ogg|wav|flac)$') then
    raise exception 'Invalid recording path';
  end if;
  if cardinality(v_waveform) > 240 or exists (
    select 1 from unnest(v_waveform) value where value not between 0 and 100
  ) then
    raise exception 'Invalid recording waveform';
  end if;
  if v_playback_gain not between 0.25 and 16 then
    raise exception 'Invalid recording playback gain';
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
    id,user_id,title,object_path,duration_ms,byte_size,mime_type,waveform,status,
    recorded_at,playback_gain,source_type
  ) values (
    p_recording_id,v_user_id,v_title,p_object_path,p_duration_ms,p_byte_size,p_mime_type,
    v_waveform,'pending',v_recorded_at,v_playback_gain,v_source_type
  );
  return true;
end;
$$;

revoke all on function public.reserve_practice_recording(uuid,text,text,integer,bigint,text,smallint[],timestamptz,real,text) from public;
grant execute on function public.reserve_practice_recording(uuid,text,text,integer,bigint,text,smallint[],timestamptz,real,text) to authenticated;

create or replace function public.olive_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select 10::integer; $$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

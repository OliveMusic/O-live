-- O'live 녹음 시작 시각 저장.
-- 007_recording_waveforms.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.

-- 저장 버튼을 누른 시각이 아니라 실제 녹음을 시작한 시각을 받는 시그니처로 교체한다.
drop function if exists public.reserve_practice_recording(uuid,text,text,integer,bigint,text,smallint[]);

create or replace function public.reserve_practice_recording(
  p_recording_id uuid,
  p_title text,
  p_object_path text,
  p_duration_ms integer,
  p_byte_size bigint,
  p_mime_type text,
  p_waveform smallint[],
  p_recorded_at timestamptz
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
    id,user_id,title,object_path,duration_ms,byte_size,mime_type,waveform,status,recorded_at
  ) values (
    p_recording_id,v_user_id,v_title,p_object_path,p_duration_ms,p_byte_size,p_mime_type,v_waveform,'pending',v_recorded_at
  );
  return true;
end;
$$;

revoke all on function public.reserve_practice_recording(uuid,text,text,integer,bigint,text,smallint[],timestamptz) from public;
grant execute on function public.reserve_practice_recording(uuid,text,text,integer,bigint,text,smallint[],timestamptz) to authenticated;

create or replace function public.olive_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select 8::integer; $$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

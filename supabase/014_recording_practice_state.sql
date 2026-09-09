-- O'live 녹음본의 연습 설정을 계정에 저장한다.
-- 013_pinning_and_maintenance.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.
--
-- 지금까지 녹음본의 배속과 A/B 구간은 메모리에만 있어 새로고침하면 사라졌다.
-- 연습 링크만 클라우드에 저장하고 있었다. 같은 방식으로 맞추고, 조옮김을 더한다.

alter table public.practice_recordings
  add column if not exists playback_rate real not null default 1,
  add column if not exists transpose smallint not null default 0,
  add column if not exists loop_a_ms integer,
  add column if not exists loop_b_ms integer,
  add column if not exists loop_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='practice_recordings_rate_check'
  ) then
    alter table public.practice_recordings add constraint practice_recordings_rate_check
      check (playback_rate between 0.25 and 2);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='practice_recordings_transpose_check'
  ) then
    alter table public.practice_recordings add constraint practice_recordings_transpose_check
      check (transpose between -12 and 12);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='practice_recordings_loop_check'
  ) then
    alter table public.practice_recordings add constraint practice_recordings_loop_check
      check (
        (loop_a_ms is null and loop_b_ms is null)
        or (
          loop_a_ms is not null and loop_b_ms is not null
          and loop_a_ms >= 0 and loop_b_ms > loop_a_ms
        )
      );
  end if;
end
$$;

-- 배속·A/B·조옮김은 연습 중 자주 바뀌므로 한 번에 저장한다.
-- save_practice_link_state와 같은 모양이다.
create or replace function public.save_practice_recording_state(
  p_recording_id uuid,
  p_playback_rate real,
  p_transpose integer,
  p_loop_a_ms integer,
  p_loop_b_ms integer,
  p_loop_enabled boolean
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
  v_transpose integer := coalesce(p_transpose,0);
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_a is null or v_b is null or v_b <= v_a or v_a < 0 then
    v_a := null;
    v_b := null;
  end if;
  if v_rate not between 0.25 and 2 then v_rate := 1; end if;
  if v_transpose not between -12 and 12 then v_transpose := 0; end if;

  update public.practice_recordings
  set playback_rate=v_rate,
      transpose=v_transpose,
      loop_a_ms=v_a,
      loop_b_ms=v_b,
      loop_enabled=(v_a is not null and coalesce(p_loop_enabled,false)),
      updated_at=now()
  where id=p_recording_id and user_id=v_user_id;
  return found;
end;
$$;

revoke all on function public.save_practice_recording_state(uuid,real,integer,integer,integer,boolean) from public, anon;
grant execute on function public.save_practice_recording_state(uuid,real,integer,integer,integer,boolean) to authenticated;

create or replace function public.olive_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select 14::integer; $$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

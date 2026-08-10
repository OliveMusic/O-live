-- O'live 청음 기록을 음정·화음·음계로 나눠 저장한다.
-- 001~003을 실행한 프로젝트에서 Supabase SQL Editor로 한 번 실행하세요.

alter table public.ear_daily_scores
  add column if not exists interval_correct_count integer not null default 0,
  add column if not exists interval_total_count integer not null default 0,
  add column if not exists chord_correct_count integer not null default 0,
  add column if not exists chord_total_count integer not null default 0,
  add column if not exists scale_correct_count integer not null default 0,
  add column if not exists scale_total_count integer not null default 0;

alter table public.ear_sync_events
  add column if not exists training_mode text not null default 'unclassified';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ear_daily_scores_interval_counts_check'
  ) then
    alter table public.ear_daily_scores add constraint ear_daily_scores_interval_counts_check
      check (interval_correct_count >= 0 and interval_total_count >= interval_correct_count);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ear_daily_scores_chord_counts_check'
  ) then
    alter table public.ear_daily_scores add constraint ear_daily_scores_chord_counts_check
      check (chord_correct_count >= 0 and chord_total_count >= chord_correct_count);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ear_daily_scores_scale_counts_check'
  ) then
    alter table public.ear_daily_scores add constraint ear_daily_scores_scale_counts_check
      check (scale_correct_count >= 0 and scale_total_count >= scale_correct_count);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ear_sync_events_training_mode_check'
  ) then
    alter table public.ear_sync_events add constraint ear_sync_events_training_mode_check
      check (training_mode in ('interval','chord','scale','unclassified'));
  end if;
end $$;

create or replace function public.record_ear_answer(
  p_event_id uuid,
  p_score_date date,
  p_is_correct boolean,
  p_training_mode text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_event_id is null or p_score_date is null or p_is_correct is null then
    raise exception 'Invalid answer event';
  end if;
  if p_training_mode not in ('interval','chord','scale','unclassified') then
    raise exception 'Invalid training mode';
  end if;
  if p_score_date < current_date - 3660 or p_score_date > current_date + 1 then
    raise exception 'Score date is outside the allowed range';
  end if;

  insert into public.ear_sync_events(
    event_id,user_id,score_date,is_correct,training_mode
  ) values (
    p_event_id,v_user_id,p_score_date,p_is_correct,p_training_mode
  )
  on conflict (event_id) do nothing
  returning true into v_inserted;

  if coalesce(v_inserted,false) then
    insert into public.ear_daily_scores(
      user_id,score_date,correct_count,total_count,
      interval_correct_count,interval_total_count,
      chord_correct_count,chord_total_count,
      scale_correct_count,scale_total_count,updated_at
    ) values (
      v_user_id,p_score_date,case when p_is_correct then 1 else 0 end,1,
      case when p_training_mode='interval' and p_is_correct then 1 else 0 end,
      case when p_training_mode='interval' then 1 else 0 end,
      case when p_training_mode='chord' and p_is_correct then 1 else 0 end,
      case when p_training_mode='chord' then 1 else 0 end,
      case when p_training_mode='scale' and p_is_correct then 1 else 0 end,
      case when p_training_mode='scale' then 1 else 0 end,
      now()
    )
    on conflict (user_id,score_date) do update set
      correct_count=public.ear_daily_scores.correct_count+excluded.correct_count,
      total_count=public.ear_daily_scores.total_count+1,
      interval_correct_count=public.ear_daily_scores.interval_correct_count+excluded.interval_correct_count,
      interval_total_count=public.ear_daily_scores.interval_total_count+excluded.interval_total_count,
      chord_correct_count=public.ear_daily_scores.chord_correct_count+excluded.chord_correct_count,
      chord_total_count=public.ear_daily_scores.chord_total_count+excluded.chord_total_count,
      scale_correct_count=public.ear_daily_scores.scale_correct_count+excluded.scale_correct_count,
      scale_total_count=public.ear_daily_scores.scale_total_count+excluded.scale_total_count,
      updated_at=now();
  end if;
  return coalesce(v_inserted,false);
end;
$$;

create or replace function public.import_ear_history(
  p_install_id uuid,
  p_days jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_install_id is null or jsonb_typeof(p_days) <> 'array' then
    raise exception 'Invalid history import';
  end if;
  if jsonb_array_length(p_days) > 3660 then
    raise exception 'History import is too large';
  end if;

  insert into public.ear_history_imports(user_id,install_id)
  values (v_user_id,p_install_id)
  on conflict (user_id,install_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted,false) then
    return false;
  end if;

  insert into public.ear_daily_scores(
    user_id,score_date,correct_count,total_count,
    interval_correct_count,interval_total_count,
    chord_correct_count,chord_total_count,
    scale_correct_count,scale_total_count,updated_at
  )
  select
    v_user_id,d.score_date,d.correct_count,d.total_count,
    coalesce(d.interval_correct_count,0),coalesce(d.interval_total_count,0),
    coalesce(d.chord_correct_count,0),coalesce(d.chord_total_count,0),
    coalesce(d.scale_correct_count,0),coalesce(d.scale_total_count,0),now()
  from jsonb_to_recordset(p_days) as d(
    score_date date,
    correct_count integer,
    total_count integer,
    interval_correct_count integer,
    interval_total_count integer,
    chord_correct_count integer,
    chord_total_count integer,
    scale_correct_count integer,
    scale_total_count integer
  )
  where d.score_date between current_date - 3660 and current_date + 1
    and d.correct_count >= 0
    and d.total_count > 0
    and d.correct_count <= d.total_count
    and coalesce(d.interval_correct_count,0) between 0 and coalesce(d.interval_total_count,0)
    and coalesce(d.chord_correct_count,0) between 0 and coalesce(d.chord_total_count,0)
    and coalesce(d.scale_correct_count,0) between 0 and coalesce(d.scale_total_count,0)
    and coalesce(d.interval_total_count,0)+coalesce(d.chord_total_count,0)+coalesce(d.scale_total_count,0) <= d.total_count
    and coalesce(d.interval_correct_count,0)+coalesce(d.chord_correct_count,0)+coalesce(d.scale_correct_count,0) <= d.correct_count
  on conflict (user_id,score_date) do update set
    correct_count=public.ear_daily_scores.correct_count+excluded.correct_count,
    total_count=public.ear_daily_scores.total_count+excluded.total_count,
    interval_correct_count=public.ear_daily_scores.interval_correct_count+excluded.interval_correct_count,
    interval_total_count=public.ear_daily_scores.interval_total_count+excluded.interval_total_count,
    chord_correct_count=public.ear_daily_scores.chord_correct_count+excluded.chord_correct_count,
    chord_total_count=public.ear_daily_scores.chord_total_count+excluded.chord_total_count,
    scale_correct_count=public.ear_daily_scores.scale_correct_count+excluded.scale_correct_count,
    scale_total_count=public.ear_daily_scores.scale_total_count+excluded.scale_total_count,
    updated_at=now();

  return true;
end;
$$;

revoke all on function public.record_ear_answer(uuid,date,boolean,text) from public;
grant execute on function public.record_ear_answer(uuid,date,boolean,text) to authenticated;
revoke all on function public.import_ear_history(uuid,jsonb) from public;
grant execute on function public.import_ear_history(uuid,jsonb) to authenticated;

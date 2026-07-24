-- O'live 청음 기록: 계정별 일일 점수 + 오프라인 이벤트 동기화
-- Supabase SQL Editor에서 한 번 실행하세요.

create table if not exists public.ear_daily_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  score_date date not null,
  correct_count integer not null default 0 check (correct_count >= 0),
  total_count integer not null default 0 check (total_count >= 0 and correct_count <= total_count),
  updated_at timestamptz not null default now(),
  primary key (user_id, score_date)
);

create table if not exists public.ear_sync_events (
  event_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  score_date date not null,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ear_history_imports (
  user_id uuid not null references auth.users(id) on delete cascade,
  install_id uuid not null,
  imported_at timestamptz not null default now(),
  primary key (user_id, install_id)
);

alter table public.ear_daily_scores enable row level security;
alter table public.ear_sync_events enable row level security;
alter table public.ear_history_imports enable row level security;

drop policy if exists "Users read their own ear scores" on public.ear_daily_scores;
create policy "Users read their own ear scores"
on public.ear_daily_scores for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.ear_daily_scores from anon, authenticated;
revoke all on table public.ear_sync_events from anon, authenticated;
revoke all on table public.ear_history_imports from anon, authenticated;
grant select on table public.ear_daily_scores to authenticated;

create or replace function public.record_ear_answer(
  p_event_id uuid,
  p_score_date date,
  p_is_correct boolean
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
  if p_score_date < current_date - 3660 or p_score_date > current_date + 1 then
    raise exception 'Score date is outside the allowed range';
  end if;

  insert into public.ear_sync_events(event_id,user_id,score_date,is_correct)
  values (p_event_id,v_user_id,p_score_date,p_is_correct)
  on conflict (event_id) do nothing
  returning true into v_inserted;

  if coalesce(v_inserted,false) then
    insert into public.ear_daily_scores(user_id,score_date,correct_count,total_count,updated_at)
    values (v_user_id,p_score_date,case when p_is_correct then 1 else 0 end,1,now())
    on conflict (user_id,score_date) do update
      set correct_count=public.ear_daily_scores.correct_count+excluded.correct_count,
          total_count=public.ear_daily_scores.total_count+1,
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

  insert into public.ear_daily_scores(user_id,score_date,correct_count,total_count,updated_at)
  select v_user_id,d.score_date,d.correct_count,d.total_count,now()
  from jsonb_to_recordset(p_days) as d(
    score_date date,
    correct_count integer,
    total_count integer
  )
  where d.score_date between current_date - 3660 and current_date + 1
    and d.correct_count >= 0
    and d.total_count > 0
    and d.correct_count <= d.total_count
  on conflict (user_id,score_date) do update
    set correct_count=public.ear_daily_scores.correct_count+excluded.correct_count,
        total_count=public.ear_daily_scores.total_count+excluded.total_count,
        updated_at=now();

  return true;
end;
$$;

revoke all on function public.record_ear_answer(uuid,date,boolean) from public;
revoke all on function public.import_ear_history(uuid,jsonb) from public;
grant execute on function public.record_ear_answer(uuid,date,boolean) to authenticated;
grant execute on function public.import_ear_history(uuid,jsonb) to authenticated;

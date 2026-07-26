-- 동기화 중복 방지용 개별 이벤트는 장기 보관할 필요가 없다.
-- 날짜별 집계 점수(ear_daily_scores)는 유지하고, 상세 이벤트만 90일 후 삭제한다.
create index if not exists ear_sync_events_user_created_idx
  on public.ear_sync_events(user_id, created_at);

create extension if not exists pg_cron;

create or replace function public.cleanup_ear_sync_events()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.ear_sync_events
  where created_at < now() - interval '90 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_ear_sync_events() from public, anon, authenticated;

select cron.schedule(
  'olive-ear-sync-event-retention',
  '23 3 * * *',
  $$select public.cleanup_ear_sync_events();$$
)
where not exists (
  select 1
  from cron.job
  where jobname = 'olive-ear-sync-event-retention'
);

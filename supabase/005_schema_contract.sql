-- O'live 앱과 클라우드 데이터베이스의 호환 버전을 확인하는 계약 함수.
-- 004_ear_score_breakdown.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.

create or replace function public.olive_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select 5::integer;
$$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

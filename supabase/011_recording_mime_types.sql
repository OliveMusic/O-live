-- O'live 외부 오디오 업로드용 Storage MIME 설정을 통일한다.
-- 010_recording_uploads.sql 실행 후 Supabase SQL Editor에서 한 번 실행하세요.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'practice-recordings','practice-recordings',false,15728640,
  array['audio/*','video/mp4','video/webm','video/ogg']
)
on conflict (id) do update
set public=false,
    file_size_limit=15728640,
    allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.olive_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select 11::integer; $$;

revoke all on function public.olive_schema_version() from public, anon;
grant execute on function public.olive_schema_version() to authenticated;

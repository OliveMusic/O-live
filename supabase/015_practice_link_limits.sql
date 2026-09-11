-- 015: 유튜브 연습 링크의 한도를 녹음과 나눈다.
--
-- 녹음은 오디오 파일을 들고 있어 한 개마다 저장 공간을 쓴다. 그래서 50개, 250MB라는
-- 한도가 있다. 반면 연습 링크는 영상 id와 제목 몇 글자가 전부다 — 영상은 YouTube에
-- 있고 이쪽에는 주소만 남는다. 그 둘이 같은 50칸을 나눠 쓸 까닭이 없었다.
--
-- 링크는 링크끼리 세고, 꽉 차면 거절하는 대신 즐겨찾기가 아닌 것 중 가장 오래된 것을
-- 비워 자리를 만든다. 즐겨찾기는 사용자가 남기겠다고 표시한 것이라 건드리지 않는다.
-- 모두 즐겨찾기라 비울 것이 없으면 그때는 거절한다.
--
-- olive_schema_version()은 일부러 올리지 않는다. 이 마이그레이션은 열도 함수 서명도
-- 바꾸지 않고 기존 함수의 판단만 고친다. 앱이 이 버전을 요구하도록 만들면, 이 SQL을
-- 돌리기 전까지 클라우드 동기화가 통째로 멈춘다. 돌리지 않아도 예전 한도로 그대로
-- 동작하고, 돌리는 순간부터 링크가 제 한도를 갖는다.

create or replace function public.save_practice_link(
  p_link_id uuid,
  p_video_id text,
  p_title text,
  p_duration_ms integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_title,''));
  v_duration integer := coalesce(p_duration_ms,0);
  v_count integer;
  v_limit constant integer := 200;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_link_id is null then raise exception 'Invalid link id'; end if;
  if p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'Invalid YouTube video id';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'Invalid link title';
  end if;
  if v_duration not between 0 and 43200000 then
    raise exception 'Link duration is outside the allowed range';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text,0));

  if exists (
    select 1 from public.practice_links
    where user_id=v_user_id and provider='youtube' and video_id=p_video_id
  ) then
    raise exception 'Link already saved';
  end if;

  select count(*) into v_count
  from public.practice_links where user_id=v_user_id;

  -- 자리가 모자라면 즐겨찾기가 아닌 가장 오래된 것부터 비운다. 한 번에 여러 칸이
  -- 모자랄 수 있으므로(한도를 낮춘 뒤 등) 남는 자리가 생길 때까지 돈다.
  while v_count >= v_limit loop
    delete from public.practice_links
    where id = (
      select id from public.practice_links
      where user_id=v_user_id and pinned=false
      order by created_at asc
      limit 1
    );
    if not found then
      raise exception 'Practice link count limit reached';
    end if;
    v_count := v_count - 1;
  end loop;

  insert into public.practice_links(id,user_id,provider,video_id,title,duration_ms)
  values (p_link_id,v_user_id,'youtube',p_video_id,v_title,v_duration);
  return true;
end;
$$;

revoke all on function public.save_practice_link(uuid,text,text,integer) from public, anon;
grant execute on function public.save_practice_link(uuid,text,text,integer) to authenticated;

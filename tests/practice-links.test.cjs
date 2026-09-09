const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const index=fs.readFileSync('index.html','utf8');
const links=fs.readFileSync('js/practice-links.js','utf8');
const recorder=fs.readFileSync('js/recorder.js','utf8');
const audioRuntime=fs.readFileSync('js/audio-runtime.js','utf8');
const cloud=fs.readFileSync('cloud-sync.js','utf8');
const migration=fs.readFileSync('supabase/012_practice_links.sql','utf8');
const edge=fs.readFileSync('supabase/functions/youtube-search/index.ts','utf8');
const config=fs.readFileSync('supabase/config.toml','utf8');

/* ── 마크업 ── */
/* 링크는 아이콘 버튼이다. 글자가 없으므로 aria-label이 반드시 있어야 한다. */
assert.match(index,/id="recordLink"[^>]*aria-label="YouTube 링크 추가"/);
assert.match(index,/id="recordLink"[^>]*aria-controls="linkPanel"[^>]*aria-expanded="false"/);
assert.match(index,/class="record-upload icon" id="recordUpload"[^>]*aria-label="오디오 파일 업로드"/);
/* 동작 버튼은 테두리만 있는 형태가 아니라 올리브로 채운다. */
assert.doesNotMatch(index,/class="record-upload ghost"/);
assert.match(index,/\.record-upload\{[^}]*background:var\(--signal\)/);
assert.match(index,/id="linkModeSearch"[^>]*>검색</);
assert.match(index,/id="linkModeUrl"[^>]*>URL</);
assert.match(index,/id="linkSearchInput"/);
assert.match(index,/placeholder="곡명 또는 아티스트 검색"/);
assert.match(index,/id="linkUrlInput"/);
/* 링크는 녹음본과 같은 목록에 섞여 최신순으로 정렬된다. 별도 컨테이너를 두지 않는다. */
assert.doesNotMatch(index,/id="recordLinkList"/);
assert.match(links,/const list=document\.getElementById\('recordList'\)/);
assert.match(links,/function entries\(\)/);
assert.match(links,/\n    entries,\n/,'entries를 공개 API로 노출');
assert.match(links,/at:Date\.parse\(row\.created_at\)\|\|0/);
assert.match(recorder,/function practiceLinkEntries\(\)/);
assert.match(recorder,/\.concat\(practiceLinkEntries\(\)\)/);
assert.match(recorder,/entries\.sort\(\(a,b\)=>b\.at-a\.at\)/,'최신 항목이 위에 온다');
/* 목록에는 녹음·업로드·YouTube가 함께 들어가므로 문구를 녹음으로 한정하지 않는다. */
assert.match(recorder,/textContent='저장된 항목이 없습니다'/);
assert.match(recorder,/textContent='목록을 불러오는 중입니다'/);
assert.doesNotMatch(recorder,/textContent='저장된 녹음이 없습니다'/);
assert.match(recorder,/at:Date\.parse\(row\.recorded_at\)\|\|0/);
assert.match(recorder,/addEventListener\('olive-practice-links-change',renderList\)/);
/* 링크 메뉴에는 다운로드가 없고, 녹음과 마찬가지로 취소 항목도 두지 않는다. */
assert.match(index,/id="linkMenuRename"[^>]*>이름 변경</);
assert.match(index,/id="linkMenuDelete"[^>]*>삭제</);
assert.doesNotMatch(index,/id="linkMenuDownload"/);
assert.doesNotMatch(index,/id="linkMenuCancel"/);
/* 숨긴 폼이 display:flex에 덮이지 않아야 한 번에 하나만 보인다. */
assert.match(index,/\.link-form\[hidden\]\{ display:none; \}/);

/* ── CSP ── */
const csp=index.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
assert.match(csp,/frame-src[^;]*https:\/\/www\.youtube-nocookie\.com/,'공식 플레이어 프레임 허용');
assert.match(csp,/script-src[^;]*https:\/\/www\.youtube\.com/,'IFrame API 스크립트 허용');
assert.match(csp,/script-src[^;]*https:\/\/s\.ytimg\.com/,'플레이어 자산 허용');
/* 검색은 Edge Function을 거치므로 브라우저가 Google API에 직접 붙지 않는다. */
assert.doesNotMatch(csp,/connect-src[^;]*googleapis/);

/* ── 클라이언트 동작 ── */
assert.match(links,/playsinline:1/,'iOS 인라인 재생');
assert.match(links,/PLAYER_HOST='https:\/\/www\.youtube-nocookie\.com'/);
/* 입력 중 자동 검색 금지. 명시적인 동작에서만 보낸다. */
assert.doesNotMatch(links,/addEventListener\('input',[^)]*runSearch/);
assert.match(links,/searchGo\.addEventListener\('click',runSearch\)/);
assert.match(links,/linkButton\.setAttribute\('aria-expanded',String\(open\)\)/);
assert.match(links,/event\.key==='Enter'[\s\S]{0,80}runSearch\(\)/);
assert.match(links,/searchCache\.has\(query\)/,'같은 검색어 재요청 방지');
assert.match(links,/MIN_QUERY_LENGTH=2/);
/* 영상을 내려받거나 오디오만 빼내지 않는다. */
assert.doesNotMatch(links,/ytdl|youtube-dl|videoplayback|audio_only|getAudioOnly/i);
/* 저장 녹음 재생과 같은 취급으로 다른 재생을 정리한다. */
assert.match(links,/OliveRecorder\.stopPlayback/);
assert.match(audioRuntime,/OlivePracticeLinks[\s\S]{0,160}stopPlayback\(\)/);
assert.match(links,/window\.OlivePracticeLinks=\{/);
/* 임베드가 막힌 영상(오류 150/101)은 레이블 공식 영상에서 흔하다.
   YouTube 기본 문구만 남기지 말고 O'live가 이유를 설명해야 한다. */
assert.match(links,/onError\(event\)\{/,'플레이어 오류 처리');
assert.match(links,/case 150: return '소유자가 외부 재생을 막아 둔 영상입니다/);
assert.match(links,/case 100: return '삭제되었거나 비공개로 바뀐 영상입니다/);
/* 재생되지 않는 영상을 목록에 쌓지 않도록 저장 전에 확인한다. */
assert.match(links,/const check=await checkEmbeddable\(videoId\);/);
assert.match(links,/if\(!check\.ok\)\{/);
assert.match(links,/savePracticeLink\(videoId,trimmed,check\.durationMs\|\|0\)/);
/* 확인이 지연되면 저장을 막지 않는다. */
assert.match(links,/setTimeout\(\(\)=>finish\(\{ok:true,durationMs:0\}\),CHECK_TIMEOUT_MS\)/);
/* YouTube 진행바는 iframe 안이라 A/B를 그릴 수 없다. O'live 트랙에 표시한다. */
assert.match(links,/function createTrack\(row\)/);
assert.match(links,/record-loop-marker start/);
assert.match(links,/record-loop-marker end/);
assert.match(index,/\.link-track-fill\{/);
assert.match(index,/\.link-track-line\{[\s\S]*?height:4px/);
assert.match(index,/\.link-track-wrap\{[^}]*position:relative;[^}]*height:42px; padding-top:6px/);
assert.match(index,/\.link-track-wrap>\.record-player-times\.link-player-times\{[^}]*position:absolute;[^}]*right:2px; bottom:0;[^}]*justify-content:flex-end/);
assert.match(links,/timeline\.appendChild\(times\)/);
assert.match(index,/\.link-player\{[^}]*border:1px solid var\(--line-soft\);[^}]*background:color-mix\(in srgb,var\(--key\) 76%,transparent\)/);
assert.doesNotMatch(index,/\.link-player \.record-player-tool\{/);
assert.match(index,/\.link-time-divider\{ display:inline; \}/);
assert.match(links,/source\.textContent='YouTube'/);
assert.doesNotMatch(links,/source\.textContent='YouTube 링크'/);
/* A/B를 누를 때 목록을 다시 그리면 플레이어가 새로 만들어져 영상이 처음부터
   다시 시작한다. 제자리에서만 갱신해야 한다. */
assert.match(links,/function refreshLoopUi\(row\)/);
/* Number(null)이 0이라 지정된 적 없는 A/B가 0:00에 찍힌 것처럼 보이던 버그. */
assert.match(links,/function msOrNull\(value\)/);
assert.match(links,/a:msOrNull\(row\.loop_a_ms\)/);
assert.match(links,/b:msOrNull\(row\.loop_b_ms\)/);
assert.doesNotMatch(links,/Number\.isFinite\(Number\(row\.loop_[ab]_ms\)\)/);
assert.match(cloud,/const loopMs=value=>\{/);
assert.doesNotMatch(cloud,/Number\.isFinite\(Number\(state&&state\.loop[AB]\)\)/);
/* A 다음 B를 찍으면 곧바로 반복이 시작되어야 한다. */
assert.match(links,/loop\.enabled=loop\.a!==null && loop\.b!==null;/);
/* A/B가 없어도 반복을 켤 수 있다. 이때는 처음부터 끝까지가 구간이다.
   녹음본의 activeLoopFor와 같은 규칙이다. */
assert.match(links,/function activeLoopFor\(row\)/);
assert.match(links,/return duration>=MIN_LOOP_MS \? \{a:0,b:duration,whole:true\} : null;/);
assert.match(links,/repeat\.disabled=!canLoop\(row\)/);
assert.doesNotMatch(links,/repeat\.disabled=loop\.a===null \|\| loop\.b===null/);
assert.match(links,/'전체 반복 켜기'/);
/* 끝까지 재생되면 틱이 놓칠 수 있으므로 ENDED에서도 되돌린다. */
assert.match(links,/event\.data===YT\.PlayerState\.ENDED\)\{[\s\S]{0,320}player\.playVideo\(\)/);
/* 목록에서 한 번에 하나만 펼친다. 녹음본과 링크가 동시에 열리지 않아야 한다. */
assert.match(links,/collapse,/,'링크 모듈이 collapse를 노출');
assert.match(links,/window\.OliveRecorder\.collapse==='function'[\s\S]{0,90}OliveRecorder\.collapse\(\)/);
assert.match(recorder,/collapse:collapseExpandedRow/,'녹음 모듈이 collapse를 노출');
assert.match(recorder,/function collapsePracticeLink\(\)/);
{
  const body=recorder.match(/function toggleRowExpanded\(row\)\{[\s\S]*?\n  \}/)[0];
  assert.match(body,/collapsePracticeLink\(\)/,'녹음본을 펼치면 링크를 접는다');
}
/* 배속은 녹음본과 같은 연속 슬라이더다. setPlaybackRate는 임의 값을 그대로 받는다
   (0.85를 넣으면 0.85가 나온다). getAvailablePlaybackRates의 8단계에 묶이지 않는다. */
assert.match(links,/const PLAYBACK_RATE_MIN=\.5;/);
assert.match(links,/const PLAYBACK_RATE_MAX=1\.5;/);
assert.match(links,/const PLAYBACK_RATE_STEP=\.05;/);
assert.doesNotMatch(links,/player\.getAvailablePlaybackRates\(\)/,'단계 목록에 묶지 않는다');
assert.match(links,/function createRateControl\(row\)/);
assert.match(links,/label\.className='record-rate-control'/,'녹음본과 같은 클래스');
assert.match(links,/output\.className='record-rate-value'/);
assert.match(links,/slider\.min=String\(PLAYBACK_RATE_MIN\)/);
assert.match(links,/slider\.step=String\(PLAYBACK_RATE_STEP\)/);
assert.match(links,/player\.setPlaybackRate\(next\)/);
/* 녹음본과 같은 값이라 1배가 슬라이더 정중앙에 온다. */
{
  const min=0.5, max=1.5;
  assert.equal((1-min)/(max-min),0.5,'1배가 가운데');
}
/* 컨트롤 행이 플레이어 전체 폭을 써서 A/B가 왼쪽 끝에 붙는다. */
assert.match(index,/\.record-player-tools\{[^}]*grid-column:1 \/ -1/);
assert.match(recorder,/player\.append\(play,detail,tools\)/);
/* 손잡이를 두 번 누르면 원곡 속도로 돌아간다. */
assert.match(links,/function bindPlaybackRateReset\(slider,row\)/);
assert.match(links,/slider\.addEventListener\('dblclick',reset\)/);
assert.match(links,/setPlaybackRate\(row,1,true\)/);

/* 파형이 없으므로 시간 눈금과 숫자 표시로 위치 감각을 준다. */
assert.match(links,/function tickIntervalMs\(duration\)/);
assert.match(links,/function renderTicks\(row\)/);
assert.match(index,/\.link-track-tick\{/);
assert.match(index,/\.link-loop-times\{/);
assert.match(links,/parts\.push\(`A \$\{formatDuration\(loop\.a\)\}`\)/);
for(const fn of ['setLoopPoint','toggleLoop','clearLoop']){
  const body=links.match(new RegExp(`function ${fn}\\(row[^)]*\\)\\{[\\s\\S]*?\\n  \\}`))[0];
  assert.match(body,/refreshLoopUi\(row\)/,`${fn}는 제자리 갱신`);
  assert.doesNotMatch(body,/renderList\(\)/,`${fn}는 목록을 다시 그리지 않는다`);
}

/* 목록 길이 50개는 녹음과 링크를 합쳐서 센다. */
assert.match(recorder,/rows\.length\+practiceLinkCount\(\)/);
assert.match(recorder,/olive-practice-links-change/);
assert.match(links,/olive-practice-links-change/);

/* ── URL 파서 ── */
const source=links.match(/function extractVideoId\(raw\)\{[\s\S]*?\n  \}/)[0];
const sandbox={URL};
vm.createContext(sandbox);
vm.runInContext(source+'\nthis.extractVideoId=extractVideoId;',sandbox);
const extract=sandbox.extractVideoId;

assert.equal(extract('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),'dQw4w9WgXcQ');
assert.equal(extract('https://youtu.be/dQw4w9WgXcQ'),'dQw4w9WgXcQ');
assert.equal(extract('https://www.youtube.com/embed/dQw4w9WgXcQ'),'dQw4w9WgXcQ');
assert.equal(extract('https://www.youtube.com/shorts/dQw4w9WgXcQ'),'dQw4w9WgXcQ');
assert.equal(extract('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'),'dQw4w9WgXcQ');
assert.equal(extract('youtube.com/watch?v=dQw4w9WgXcQ'),'dQw4w9WgXcQ');
assert.equal(extract('dQw4w9WgXcQ'),'dQw4w9WgXcQ');
assert.equal(extract('  https://youtu.be/dQw4w9WgXcQ  '),'dQw4w9WgXcQ');
/* 다른 사이트나 잘못된 길이는 받지 않는다. */
assert.equal(extract('https://vimeo.com/12345678901'),'');
assert.equal(extract('https://example.com/watch?v=dQw4w9WgXcQ'),'');
assert.equal(extract('https://www.youtube.com/watch?v=short'),'');
assert.equal(extract(''),'');
assert.equal(extract('그냥 글자'),'');

/* msOrNull은 실제 동작까지 확인한다. DB의 NULL이 0으로 읽히면
   지정된 적 없는 A/B가 0:00에 활성화된 것처럼 보인다. */
const msSource=links.match(/function msOrNull\(value\)\{[\s\S]*?\n  \}/)[0];
const msBox={};
vm.createContext(msBox);
vm.runInContext(msSource+'\nthis.msOrNull=msOrNull;',msBox);
assert.equal(msBox.msOrNull(null),null,'NULL은 지정 없음');
assert.equal(msBox.msOrNull(undefined),null);
assert.equal(msBox.msOrNull(''),null);
assert.equal(msBox.msOrNull(0),0,'0ms는 유효한 지점');
assert.equal(msBox.msOrNull(1500),1500);
assert.equal(msBox.msOrNull('2400'),2400);
assert.equal(msBox.msOrNull('abc'),null);
assert.equal(msBox.msOrNull(NaN),null);

/* ── 클라우드 API ── */
for(const fn of ['listPracticeLinks','savePracticeLink','renamePracticeLink',
  'savePracticeLinkState','deletePracticeLink','searchYouTube']){
  assert.match(cloud,new RegExp(`\\n    ${fn},`),`${fn} 노출`);
}
/* 제목·채널·썸네일은 저장하지 않는다. video_id와 사용자 별칭만 남긴다. */
assert.match(cloud,/select\('id,provider,video_id,title,duration_ms,last_position_ms,loop_a_ms,loop_b_ms,loop_enabled,playback_rate,created_at'\)/);
assert.doesNotMatch(cloud,/channel_title|thumbnail_url/);

/* ── 마이그레이션 ── */
assert.match(migration,/create table if not exists public\.practice_links/);
assert.match(migration,/video_id ~ '\^\[A-Za-z0-9_-\]\{11\}\$'/);
assert.match(migration,/unique \(user_id, provider, video_id\)/);
assert.match(migration,/alter table public\.practice_links enable row level security/);
assert.match(migration,/revoke all on table public\.practice_links from anon, authenticated/);
/* YouTube 메타데이터 컬럼을 만들지 않는다. */
assert.doesNotMatch(migration,/channel_title|thumbnail|description/);
/* 목록 제한은 녹음과 합산한다. */
assert.match(migration,/from public\.practice_recordings where user_id=v_user_id\)\s*\+ \(select count\(\*\) from public\.practice_links/);
assert.match(migration,/v_count >= 50/);
/* 삭제 경로에 링크와 사용량이 포함된다. */
assert.match(migration,/delete from public\.practice_links where user_id=v_user_id/);
assert.match(migration,/delete from public\.youtube_search_usage where user_id=v_user_id/);
/* 스키마 계약이 앱과 맞는다. */
assert.match(migration,/select 12::integer/);
/* 검색 할당량은 사용자별·전체로 나눠 센다. 검색어는 저장하지 않는다. */
assert.match(migration,/create table if not exists public\.youtube_search_usage/);
assert.match(migration,/v_user_limit constant integer := 20/);
assert.match(migration,/v_global_limit constant integer := 90/);
assert.doesNotMatch(migration,/query text|search_term/);
/* ON CONFLICT DO UPDATE는 대상 테이블을 별칭으로만 참조할 수 있다.
   스키마까지 붙인 이름을 쓰면 호출 시점에 터진다. */
assert.match(migration,/insert into public\.youtube_search_usage as u/);
assert.match(migration,/set search_count=u\.search_count\+1/);
assert.doesNotMatch(migration,/set search_count=public\.youtube_search_usage/);
/* Edge Function은 service role로 호출한다. */
assert.match(migration,/grant execute on function public\.consume_youtube_search_quota\(uuid\) to service_role/);

/* ── Edge Function ── */
assert.match(edge,/Deno\.env\.get\("YOUTUBE_DATA_API_KEY"\)/);
/* 키를 저장소에 두지 않는다. */
assert.doesNotMatch(edge,/AIza[0-9A-Za-z_-]{10}/);
assert.match(edge,/videoEmbeddable", "true"/);
assert.match(edge,/videoSyndicated", "true"/);
assert.match(edge,/maxResults", String\(MAX_RESULTS\)/);
assert.match(edge,/MAX_RESULTS = 6/);
assert.match(edge,/consume_youtube_search_quota/);
assert.match(edge,/auth\.getUser\(\)/,'JWT 검증');
/* Google 원문 오류를 그대로 흘리지 않는다. */
assert.match(edge,/upstream_error/);
assert.doesNotMatch(edge,/JSON\.stringify\(body\)/);
assert.match(config,/\[functions\.youtube-search\][\s\S]*verify_jwt = true/);

console.log('practice link tests passed');

const assert=require('node:assert/strict');
const fs=require('node:fs');

const index=fs.readFileSync('index.html','utf8');
const log=fs.readFileSync('js/practice-log.js','utf8');
const audioRuntime=fs.readFileSync('js/audio-runtime.js','utf8');
const recorder=fs.readFileSync('js/recorder.js','utf8');
const jam=fs.readFileSync('js/jam-session.js','utf8');
const links=fs.readFileSync('js/practice-links.js','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

/* ---------- 시간을 무엇으로 세는가 ----------
   화면을 켜 둔 시간이 아니라 실제로 소리가 난 시간이다. 앱을 열어 두고 딴짓한
   20분이 연습으로 기록되면 숫자를 믿을 수 없게 된다. */
assert.match(audioRuntime,/function onSoundingChange\(listener\)/);
assert.match(audioRuntime,/if\(had!==Boolean\(on\)\) notifySounding\(tab,key,Boolean\(on\)\);/);
assert.match(log,/onSoundingChange\(handleSounding\)/);
assert.doesNotMatch(log,/setInterval\([^)]*visibilityState/);

/* 튜너는 세지 않는다. 줄 맞추는 시간은 준비고, 마이크가 계속 열려 있어
   시간이 부풀기 쉽다. */
assert.doesNotMatch(log,/'tuner:/);
assert.match(log,/'metronome:metronome':'met'/);
assert.match(log,/'jam:play':'jam'/);
assert.match(log,/'trainer:rhythm':'rhy'/);
assert.match(log,/'trainer:youtube':'trk'/);
assert.match(log,/'trainer:recording-playback':'trk'/);
assert.match(log,/'trainer:recorder':'rec'/);

/* 너무 짧은 소리는 연습이 아니다. 코드 하나 눌러 본 것까지 쌓이면
   '1분 연습함'이 달력을 채운다. */
assert.match(log,/const MIN_SESSION_SECONDS=3;/);
/* 탭을 닫거나 화면을 끄면 세던 것을 잃지 않게 그 자리에서 적는다. */
assert.match(log,/visibilitychange[\s\S]{0,140}accumulate\(Date\.now\(\)\); saveNow\(\);/);
assert.match(log,/pagehide[\s\S]{0,90}accumulate\(Date\.now\(\)\); saveNow\(\);/);

/* ---------- 청음은 한 벌만 쌓는다 ----------
   같은 값을 두 벌로 쌓으면 어느 쪽이 맞는지 알 수 없다. 청음 트레이너가 쓰는
   저장소를 그대로 읽는다. */
assert.match(log,/const EAR_KEY='olive-ear-history-v1';/);
assert.match(log,/const EAR_USER_PREFIX='olive-ear-history-user-v1:';/);
assert.doesNotMatch(log,/recordEarResult|byMode\[mode\]/);

/* ---------- 막대 ----------
   키는 그날 총 시간, 마디는 무엇을 했는지. 한 가지 색의 농도만 쓴다 —
   세이지는 '작동 중'일 때만이라는 규칙이 화면 전체를 지탱하므로, 활동 링처럼
   색을 셋 들여오면 앱이 다른 물건이 된다. */
const segments=['met','jam','trk','rec','rhy'];
for(const tool of segments){
  assert.match(index,new RegExp(`\\.log-seg-${tool}\\{ background:rgba\\(var\\(--signal-rgb\\),`),
    `${tool} 마디는 세이지 농도로 그린다`);
}
assert.doesNotMatch(index,/\.log-seg-[a-z]+\{ background:(?!rgba\(var\(--signal-rgb\))/);

/* 세 시간 친 날 하나 때문에 나머지가 전부 납작해지면 달력이 쓸모없어진다. */
assert.match(log,/const FULL_BAR_SECONDS=90\*60;/);
/* 2px보다 얇게 그려질 마디는 읽히지도 않으면서 막대만 흐리게 만든다. */
assert.match(log,/height\*item\.seconds\/total>=2/);
/* 반올림 보정을 마지막 마디에 떠넘기면 1px짜리 실오라기가 생긴다. */
assert.match(log,/parts\[biggest\]\.span=Math\.max\(2,parts\[biggest\]\.span\+left\);/);
/* 쉰 날은 빈칸이 아니라 바닥선으로 남긴다. */
assert.match(log,/className='log-rest'/);
assert.match(index,/\.log-rest\{ background:var\(--line\); height:2px/);

/* 정해 둔 display는 UA의 [hidden]{display:none}을 이긴다. 이 줄이 없으면
   접어 둔 상세가 그대로 펼쳐진 채로 보인다. */
assert.match(index,/\.log-more\[hidden\], \.log-full\[hidden\]\{ display:none; \}/);

/* ---------- 달력은 청음 기록 것을 그대로 쓴다 ---------- */
assert.match(index,/<div class="ear-calendar-grid log-grid" id="practiceLogGrid">/);
assert.match(log,/cell\.className='ear-day log-day'/);

/* ---------- 상단바 ----------
   하단 탭은 다섯 개 그대로다. 헤더는 폭만 늘리고 제목이 앉는 자리는 그대로 둔다. */
assert.match(index,/header\.topbar\{[^}]*position:relative; width:100%; justify-content:center;/);
assert.match(index,/\.topbar-log\{[\s\S]{0,120}position:absolute; right:12px/);
assert.match(index,/\.topbar-log\{[\s\S]{0,200}width:44px; height:44px/);
/* 세이지는 창이 열려 있는 동안만. */
assert.match(index,/\.topbar-log\[aria-expanded="true"\]\{ color:var\(--signal\); \}/);
assert.doesNotMatch(index,/data-tab="log"|data-tab="practice"/);
assert.equal((index.match(/<button class="tab-btn/g)||[]).length,5,'하단 탭은 다섯 개 그대로');

/* ---------- 값은 다른 기능이 이미 들고 있는 것을 읽어 온다 ----------
   이름표를 기록 쪽에 베껴 두면 진행이나 스타일을 고칠 때 어긋난다. */
assert.match(jam,/window\.OliveJam=\{\s*snapshot\(\)\{/);
assert.match(jam,/preset\.label\.split/);
assert.match(recorder,/nowPlaying:nowPlayingTrack,/);
/* 목록의 YouTube 기능이 전부 이 객체를 통해 오간다. 연습 기록을 붙이면서
   통째로 덮어써 목록에서 링크가 사라진 적이 있다 — 더하되 지우지 않는다. */
assert.equal((links.match(/window\.OlivePracticeLinks=/g)||[]).length,1,'링크 창구는 하나뿐');
for(const member of ['count','entries','deleteMany','isPlaying','stopPlayback','collapse','nowPlaying']){
  assert.match(links,new RegExp(`\\n\\s+${member}[,(:]`),`OlivePracticeLinks.${member} 보존`);
}
assert.match(log,/window\.OliveJam && window\.OliveJam\.snapshot\(\)/);
assert.match(log,/window\.OliveRecorder\.nowPlaying\(\)/);
assert.match(log,/window\.OlivePracticeLinks\.nowPlaying\(\)/);
/* 녹음을 저장한 개수는 저장이 성공한 자리에서만 센다. */
assert.match(recorder,/window\.OlivePracticeLog\.noteRecordingSaved\(\);/);

/* ---------- 배포에 실려야 한다 ---------- */
assert.match(index,/<script src="js\/practice-log\.js\?v=\d+"><\/script>/);
assert.match(worker,/'\.\/js\/practice-log\.js\?v=\d+',/);

console.log('practice log tests passed');

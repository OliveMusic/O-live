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
/* 손에 든 것을 통째로 덮어쓰지 않는다. 앱을 두 군데 열어 두면 먼저 열어 둔
   쪽이 닫힐 때 그 사이 쌓인 기록을 자기가 읽었던 옛 상태로 지워 버린다. */
assert.match(log,/function merge\(stored\)/);
assert.match(log,/localStorage\.setItem\(STORE_KEY,JSON\.stringify\(merge\(load\(\)\)\)\)/);
assert.equal((log.match(/localStorage\.setItem\(STORE_KEY/g)||[]).length,1,'저장하는 자리는 하나뿐');
/* 탭을 닫거나 화면을 끄면 세던 것을 잃지 않게 그 자리에서 적는다. */
assert.match(log,/visibilitychange[\s\S]{0,140}accumulate\(Date\.now\(\)\); saveNow\(\);/);
assert.match(log,/pagehide[\s\S]{0,90}accumulate\(Date\.now\(\)\); saveNow\(\);/);

/* ---------- 청음 기록은 한 군데에만 있다 ----------
   달력이 두 개면 어느 쪽이 맞는지 알 수 없다 — 실제로 두 화면의 숫자가 달랐다.
   청음 트레이너의 달력을 걷어내고 연습 기록 하나로 모았다. */
const ear=fs.readFileSync('js/ear-trainer.js','utf8');
assert.doesNotMatch(index,/id="earHistory"|id="earCalendarGrid"|id="earDayDetail"/);
assert.doesNotMatch(ear,/renderEarCalendar/);
/* 기록을 쌓고 저장하는 일은 그대로 청음 트레이너가 한다. */
assert.match(ear,/function recordEarResult\(correct\)/);
assert.match(ear,/window\.OliveEarHistory=\{/);
/* 연습 기록은 localStorage 키를 짐작하지 않는다. 로그인 여부에 따라 엉뚱한
   저장소를 집어 두 화면의 숫자가 어긋난 적이 있다. */
assert.doesNotMatch(log,/olive-ear-history/);
assert.match(log,/window\.OliveEarHistory/);
assert.doesNotMatch(log,/recordEarResult|byMode\[mode\]/);
/* 계정 줄은 잃지 않고 연습 기록 창으로 옮겼다. cloud-sync.js가 이 아이디로 찾는다. */
assert.match(index,/id="practiceLogSheet"[\s\S]*?id="earCloudAction"[\s\S]*?<\/section>/);
/* 청음은 막대에 마디를 갖지 않는다 — 시간이 아니라 문제 수로 센다. */
assert.match(index,/\.log-row \.log-sw-ear\{ background:transparent/);
assert.match(log,/swatch:'log-sw-ear'/);

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

/* ---------- 도구별로는 시간만 적는다 ----------
   몇 BPM에서 몇으로 옮겼는지, 어떤 곡을 걸었는지까지 적으면 하루를 훑어보려고
   연 화면이 읽을거리가 된다. 화면에 쓰지 않는 값은 모으지도 않는다 — 아무도
   읽지 않는 기록은 조용히 썩는다. */
assert.doesNotMatch(log,/sampleMeta|bpmLo|jamPreset|day\.tracks/);
assert.doesNotMatch(jam,/OliveJam/);
assert.doesNotMatch(recorder,/nowPlayingTrack/);
assert.doesNotMatch(links,/nowPlaying/);
/* 목록의 YouTube 기능이 전부 이 객체를 통해 오간다. 연습 기록을 붙이면서
   통째로 덮어써 목록에서 링크가 사라진 적이 있다 — 더하되 지우지 않는다. */
assert.equal((links.match(/window\.OlivePracticeLinks=/g)||[]).length,1,'링크 창구는 하나뿐');
for(const member of ['count','entries','deleteMany','isPlaying','stopPlayback','collapse']){
  assert.match(links,new RegExp(`\\n\\s+${member}[,(:]`),`OlivePracticeLinks.${member} 보존`);
}
/* 값이 두 줄이 되어도 색 표와 이름은 첫 줄에 맞는다. */
assert.match(index,/\.log-row\{[^}]*align-items:start;/);
assert.match(index,/\.log-row \.log-sw\{[^}]*margin-top:3px/);
/* 녹음을 저장한 개수는 저장이 성공한 자리에서만 센다. */
assert.match(recorder,/window\.OlivePracticeLog\.noteRecordingSaved\(\);/);

/* ---------- 배포에 실려야 한다 ---------- */
assert.match(index,/<script src="js\/practice-log\.js\?v=\d+"><\/script>/);
assert.match(worker,/'\.\/js\/practice-log\.js\?v=\d+',/);

console.log('practice log tests passed');

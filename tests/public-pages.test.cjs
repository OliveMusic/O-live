const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const read=file=>fs.readFileSync(file,'utf8');

const indexHtml=read('index.html');
const appScripts=[
  'js/audio-runtime.js','js/core.js','js/metronome.js','js/tuner-engine.js','js/tuner.js','js/scales.js',
  'js/ear-trainer.js','js/rhythm-trainer.js','js/recorder.js','js/jam-session.js','js/app-shell.js',
].map(read).join('\n');
const index=indexHtml+'\n'+appScripts;
const about=read('about.html');
const privacy=read('privacy.html');
const terms=read('terms.html');
const guide=read('guide.html');
const cloud=read('cloud-sync.js');
const worker=read('service-worker.js');
const manifest=JSON.parse(read('manifest.json'));
const sitemap=read('sitemap.xml');
const releaseContext={globalThis:{}};
vm.createContext(releaseContext);
vm.runInContext(read('app-version.js'),releaseContext,{filename:'app-version.js'});
const release=releaseContext.globalThis.OLIVE_RELEASE;

for(const [label,html] of Object.entries({index,about,privacy,terms,guide})){
  assert.match(html,/lang="ko"/,`${label}: Korean language declaration`);
  assert.match(html,/og:image/,`${label}: social preview image`);
}

for(const href of ['about.html','privacy.html','terms.html','guide.html']){
  assert.match(index,new RegExp(`href="${href}"`),`index links ${href}`);
  assert.match(worker,new RegExp(`'\\./${href}'`),`service worker caches ${href}`);
  assert.match(sitemap,new RegExp(`/O-live/${href}`),`sitemap lists ${href}`);
}

assert.match(about,/Google 계정 연결은 선택 사항/);
assert.match(about,/마이크로 음정을 확인/);
assert.match(privacy,/튜너의 마이크 오디오는/);
assert.match(privacy,/클라우드에 저장/);
assert.match(privacy,/저장하기 전에 버린 녹음은 서버로 전송되지 않습니다/);
assert.match(privacy,/Google API 서비스 사용자 데이터 정책/);
assert.match(privacy,/데이터%20삭제%20요청/);
assert.match(privacy,/클라우드 데이터 삭제/);
assert.match(privacy,/계정 삭제/);
assert.match(privacy,/개인정보의 국외 이전/);
assert.match(privacy,/싱가포르/);
assert.match(privacy,/90일이 지나면 자동 삭제/);
assert.match(privacy,/O’live \(OliveMusic\)/);
assert.match(terms,/개인정보처리방침/);
assert.match(index,/service-worker\.js\?v=['"`]\+release\.build/);
assert.match(index,new RegExp(`cloud-sync\\.js\\?v=${release.build}`));
assert.match(worker,new RegExp(`importScripts\\('\\.\\/app-version\\.js\\?v=${release.build}'\\)`));
assert.match(worker,/const VERSION='v'\+RELEASE\.build/);
assert.match(worker,new RegExp(`'\\.\\/cloud-sync\\.js\\?v=${release.build}'`));
assert.match(index,new RegExp(`js/audio-runtime\\.js\\?v=${release.build}`));
/* font 단축 속성의 글꼴 자리에 inherit을 쓰면 선언 전체가 무효가 되어
   버튼·입력이 엔진 기본 글꼴로 떨어진다. WebKit 11px, Chromium 13.33px로 갈린다. */
for(const [label,text] of [['index.html',indexHtml],['guide.html',guide]]){
  assert.doesNotMatch(text,/font:\s*[^;{}]*\s+inherit\s*;/,
    `${label}: font 단축 속성의 글꼴 자리에 inherit을 쓰지 않는다`);
}
/* 버전은 이제 아무 동작도 없다. 누를 수 있게 보이면 안 된다. */
assert.match(index,/<p class="app-version" id="appVersion"><\/p>/);
assert.match(index,/appVersion\.textContent='버전 '\+release\.version/);
assert.doesNotMatch(index,/진단 기록 복사/,'진단 복사 UI는 걷어냈다');
assert.doesNotMatch(index,/exportText/,'내보내기 경로도 남기지 않는다');
/* 추적은 메모리에만 남고 기기에 저장하지 않는다. 예전 기록은 한 번 지운다. */
assert.doesNotMatch(index,/localStorage\.setItem\('olive-audio-diagnostics-v1'/);
assert.match(index,/localStorage\.removeItem\('olive-audio-diagnostics-v1'\)/);
assert.match(index,/media-action:seekforward/);
assert.match(index,/tempo:applied/);
assert.doesNotMatch(index,new RegExp(`빌드 ${release.build}`));
assert.match(worker,/url\.origin !== self\.location\.origin/);
assert.match(worker,/documentUrl\.search = ''/);
assert.doesNotMatch(worker,/addAll\(ASSETS\)\)\.catch/);
assert.doesNotMatch(worker,/'\.\/og\.png'/);
assert.equal(manifest.id,'./');
assert.equal(manifest.start_url,'./');

assert.match(index,/id="startupSplash"/);
assert.match(index,/<svg class="startup-splash-icon" viewBox="0 0 16 16"/);
assert.match(index,/nav\.tabbar button\.sounding::after[\s\S]*left:50%; top:50%; width:44px; height:44px;/);
assert.match(index,/nav\.tabbar button\.sounding::after[\s\S]*background:radial-gradient\(circle at center,/);
assert.match(index,/rgba\(var\(--signal-rgb\),0\) 100%/);
assert.doesNotMatch(index,/nav\.tabbar button\.sounding::after[\s\S]{0,500}filter:blur/);
assert.match(index,/@keyframes tabPulseReduced\{[\s\S]*?opacity:\.65;[\s\S]*?opacity:\.22;/);
assert.match(index,/prefers-reduced-motion: reduce[\s\S]*?animation:tabPulseReduced \.36s linear forwards/);
assert.match(index,/@keyframes tabPulse\{[\s\S]*?transform:scale\(1\.18\)/);
assert.match(index,/getComputedStyle\(btn,'::after'\)\.animationName/);
assert.doesNotMatch(index,/startup-splash-icon" src=/);
assert.match(index,/const stateKey='olive-startup-state-v2'/);
assert.match(index,/const minimumVisibleMs=1500/);
assert.match(index,/window\.addEventListener\('load',leaveWhenReady,\{once:true\}\)/);
assert.match(index,/html\.skip-startup \.startup-splash\{display:none;\}/);
assert.match(index,/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\.startup-splash/);

assert.match(index,/function ensureCtx\(mode='ambient', forceFresh=false\)/);
assert.match(index,/if\(__audioSessionMode===mode\) return/);
assert.match(index,/const mode=hiddenSafe\?'playback':'ambient'/);
assert.match(index,/hasBackgroundTransportPlaying\(\) \|\| hasHiddenSafeTransportPlaying\(\)/);
assert.match(index,/await withTimeout\(resumeCtx\(ctx\),1400\)/);
assert.match(index,/const latencyHint='interactive'/);
assert.doesNotMatch(index,/audioCtx\.resume\(\)\.catch\(\(\)=>\{\}\)/);
assert.match(index,/function ensureBackgroundPlaybackCtx\(label\)/);
assert.match(index,/stopCompetingBackgroundTransports\(label\)/);
assert.match(index,/function replaceDormantBackgroundContext\(\)/);
assert.match(index,/await withTimeout\(resumeReady,4500\)/);
assert.match(index,/visibilitychange[\s\S]*?stopHiddenUnsafeTransports\(\);[\s\S]*?hasBackgroundTransportPlaying\(\)/);
assert.match(index,/function hasHiddenSafeTransportPlaying\(\)/);
assert.match(index,/startBackgroundMedia\(activeBackgroundLabel\(\)\)/);
assert.match(index,/function attachBackgroundStream\(audio,ctx\)/);
assert.match(index,/audio\.srcObject=mediaStream/);
assert.match(index,/routeAppOutput\(__backgroundStreamDestination\)/);
assert.match(index,/setActionHandler\('play',[\s\S]*?resumeBackgroundPlayback/);
assert.match(index,/setActionHandler\('pause',\(\)=>\{[\s\S]*?pauseBackgroundPlayback\(\)/);
assert.match(index,/setActionHandler\('stop',\(\)=>\{[\s\S]*?stopBackgroundTransports\(\)/);
assert.match(index,/setActionHandler\('seekbackward',[\s\S]*?adjustBackgroundTempo\(-1,details\)/);
assert.match(index,/setActionHandler\('seekforward',[\s\S]*?adjustBackgroundTempo\(1,details\)/);
assert.match(index,/setBackgroundTransportsPaused\(false\);[\s\S]*?configureBackgroundMediaSession\(activeBackgroundLabel\(\),__backgroundUsesStream\)/);
assert.match(index,/details && details\.seekOffset/);
assert.match(index,/Number\.isFinite\(requested\) && requested>0 \? Math\.max\(1,Math\.round\(requested\)\) : 10/);
assert.match(index,/getTempo:\(\)=>bpm,[\s\S]*?adjustTempo,/);
assert.match(index,/getTempo:\(\)=>jamBpm,[\s\S]*?adjustTempo:adjustJamTempo,/);
assert.match(index,/audio\.addEventListener\('pause',[\s\S]*?pauseBackgroundPlayback\(\)/);
assert.match(index,/ctx\.suspend\(\)/);
assert.match(index,/__master\.connect\(comp\)\.connect\(getAppOutput\(ctx\)\)/);
assert.match(index,/playClick\(time - metroCtx\.currentTime, level, metroCtx, metroOutput\)/);
assert.match(index,/metroOutput\.disconnect\(\)/);
assert.match(index,/if\(paused\)\{[\s\S]*?releaseMetroOutput\(\)[\s\S]*?return;[\s\S]*?createMetroOutput\(metroCtx\)[\s\S]*?currentStep=0/);
assert.match(index,/function createJamOutputs\(ctx\)\{[\s\S]*?jamOutput\.connect\(getMaster\(ctx\)\)[\s\S]*?sendTo\(jamChordOutput,0\.3\)/);
assert.match(index,/if\(paused\)\{[\s\S]*?releaseJamOutputs\(\)[\s\S]*?return;[\s\S]*?createJamOutputs\(jamCtx\)[\s\S]*?stepCursor=0/);
assert.match(index,/orbLabel\.textContent='시작 중'/);
assert.equal((index.match(/const ctx=await ensurePlaybackCtx\(\)/g)||[]).length,1);
assert.equal((index.match(/const ctx=await ensureBackgroundPlaybackCtx\(/g)||[]).length,2);
assert.match(index,/backgroundScheduleAheadTime = 2\.5/);
assert.match(index,/BACKGROUND_AHEAD=2\.5/);
assert.match(index,/let playing=false, startPending=false, startToken=0, rhythmCtx=null/);
assert.match(index,/let playing = false, startPending = false, startToken = 0, jamCtx = null/);
assert.match(index,/let listening=false, micStarting=false, micStartToken=0/);
assert.match(index,/tunerFreq\.textContent='마이크 연결 중…'/);
assert.match(index,/if\(listening \|\| micStarting\)\{ stopMic\(\); return; \}/);
assert.match(index,/await ensureCtx\('play-and-record',true\)/);
assert.match(index,/stopMic\('마이크 연결 끊김'\)/);
assert.match(index,/analyser\.connect\(monitorSink\)/);
assert.match(index,/monitorSink\.connect\(ctx\.destination\)/);
assert.match(index,/monitorSink\.gain\.value=0/);
assert.match(index,/function safeDrawScopeFrame\(/);
assert.match(index,/finally\{[\s\S]*?if\(listening\) requestAnimationFrame\(analyse\)/);
assert.match(index,/ts-zeroInputSince>1400/);
assert.match(index,/recoverMicGraph\(micStartToken\)/);
assert.match(index,/function createBandNoiseProfile\(/);
assert.match(index,/function measureHarmonics\(/);
assert.match(index,/function createPitchTracker\(/);
assert.match(index,/function createToneActivityDetector\(/);
assert.match(index,/tunerEngine\.analyzePitch\(buf,audioCtx\.sampleRate/);
assert.match(index,/r\.harmonicity>=sensitivity\.harmonicityGate/);
assert.match(index,/pitchTracker\.update\(rawAccepted/);
assert.match(index,/attackConfirmed:toneState\.onset/);
assert.match(index,/toneActivityDetector\.update\(/);
assert.match(index,/r\.humLikelihood\*0\.18-toneState\.penalty/);
assert.match(index,/toneState\.background && !toneState\.attackActive/);
assert.match(index,/id="tunerScope"/);
assert.match(index,/id="tunerInputDb"/);
assert.match(index,/id="tunerNoiseDb"/);
assert.match(index,/id="tunerMarginDb"/);
assert.match(index,/입력 파형/);
assert.match(index,/주변 소음/);
assert.match(index,/인식 문턱/);
assert.match(index,/function drawScopeFrame\(/);
assert.match(index,/updateScope\(buf,rms,gate,accepted,ts\)/);
assert.match(index,/scopeStateEl\.textContent=accepted \? '인식 중'/);
assert.doesNotMatch(index,/id="tunerSensVal"/);
assert.doesNotMatch(index,/id="tunerSensHint"/);
assert.doesNotMatch(index,/주변 소음을 자동으로 반영/);
assert.doesNotMatch(index,/튜너가 실제로 분석하는 입력이며/);
assert.match(index,/\.tuner-monitor\{margin-top:19px;\}/);
assert.match(index,/function bindRhySliderReset\(/);
assert.match(index,/bindRhySliderReset\(rhySynco,rhySyncoVal\)/);
assert.match(index,/bindRhySliderReset\(rhyDiff,rhyDiffVal\)/);

for(const degrees of ['1–3–5','1–♭3–5','1–♭3–♭5','1–3–♯5','1–3–5–7','1–♭3–5–♭7']){
  assert.match(index,new RegExp(degrees));
}
assert.match(index,/class="degrees"/);
assert.match(index,/class="choice-primary"/);
assert.match(index,/\.choice-row \.degrees\{[\s\S]*?margin-left:auto; flex:0 0 auto;/);
assert.match(index,/\.choice-row \.choice-primary\{[\s\S]*?gap:6px;/);
assert.match(index,/\.choice-row \.ko\{[\s\S]*?white-space:nowrap;/);
assert.match(index,/구성 도수 \$\{item\.degrees\}/);
assert.match(index,/const EAR_HISTORY_MODES = \[/);
assert.match(index,/class="ear-day-breakdown"/);
assert.match(index,/구분 전 기록/);
assert.match(index,/recordAnswer\(key,correct,mode\)/);

console.log('public pages tests passed');

/* 도움말 문서가 실제 동작과 어긋나면 없느니만 못하다. 숨은 동작 설명을 고정한다. */
assert.match(guide,/손잡이를 두 번 탭/,'슬라이더 초기화 안내');
assert.match(guide,/길게 누르면 삭제/,'잼 코드 삭제 안내');
assert.match(guide,/누르면 해제/,'즐겨찾기 해제 안내');
assert.match(guide,/A와 B를 지정하지 않고 반복만 켜면 <strong>처음부터 끝까지<\/strong>/);
/* 도움말은 글이 아니라 앱과 같은 컨트롤을 직접 눌러 보게 한다. */
/* 도움말은 화면을 다시 만들지 않고 앱을 그대로 띄운다. 그래야 설명이 낡지 않는다. */
assert.match(guide,/<iframe class="tour-frame" id="tourFrame" src="index\.html\?guide=1"/);
/* 설명은 화면별로 좁힌다. 메트로놈을 보는데 트랙 재생기 얘기가 나오면 안 된다. */
for(const key of ['metronome','tuner','scales','jam','trainer:ear','trainer:rhythm','trainer:record']){
  assert.match(guide,new RegExp(`data-notes="${key}"`),`${key} 설명이 있다`);
}
assert.match(guide,/#trainerSeg \.seg-btn\.active/,'트레이너는 세그먼트까지 본다');
/* 시연 모드는 도움말이 띄울 때만 켜지고 저장하지 않는다. */
assert.match(cloud,/const guideMode=\/\[\?&\]guide=1/);
assert.match(cloud,/if\(guideMode\) return guideRecordings\(\)/);
assert.match(cloud,/if\(guideMode\) return guideLinks\(\)/);
assert.match(cloud,/title:'피아노 메이저 스케일'/);
assert.match(cloud,/title:'Stand By Me 백킹 트랙'/);
assert.match(cloud,/video_id:'ibMxYyK75WI'/);
/* 잠금화면은 iPhone과 Apple Watch 목업으로 보여 준다. */
assert.match(guide,/class="mock mock-phone"/);
assert.match(guide,/class="mock mock-watch"/);
assert.match(guide,/메트로놈 · 90 BPM/,'실제 잠금화면 표시와 같은 문구');
assert.match(guide,/\.tab-btn\.active/,'프레임의 현재 탭을 읽는다');
assert.match(guide,/new MutationObserver/,'탭이 바뀌면 설명도 바뀐다');
/* 앱이 iframe 안에서 열려야 하므로 frame-ancestors로 막으면 안 된다. */
assert.doesNotMatch(indexHtml,/frame-ancestors/);
assert.match(guide,/data-demo="rate"/);
assert.match(guide,/data-demo="loop"/);
assert.match(guide,/data-demo="favorite"/);
assert.match(guide,/class="rate-control"/,'실제 슬라이더 재현');
assert.match(guide,/class="row-olive"/,'실제 올리브 재현');
/* 숨은 동작은 글로 나열하지 않고 앱의 그 부분을 확대해 직접 눌러 보게 한다. */
assert.doesNotMatch(guide,/class="gesture"/,'제스처 목록은 확대 시연으로 대체됐다');
for(const key of ['chord','wave','tap']){
  assert.match(guide,new RegExp(`data-demo="${key}"`),`${key} 확대 시연이 있다`);
}
assert.match(guide,/class="prog-bar"/,'실제 진행 카드 재현');
assert.match(guide,/class="zoom-badge">확대</,'확대한 화면임을 밝힌다');
/* 삭제 타이머는 앱과 같은 0.5초다. 코드 이름과 −/+는 앱처럼 그 타이머를 가로챈다. */
assert.match(guide,/card\.classList\.remove\('holding'\);\s*card\.hidden=true;/);
assert.match(guide,/\},500\);/,'길게 누르기 판정은 0.5초');
assert.match(guide,/name\.addEventListener\('pointerdown',event=>event\.stopPropagation\(\)\)/);
/* TAP 계산은 core.js의 bindTapTempo와 같아야 한다. */
assert.match(guide,/taps=taps\.filter\(time=>now-time<3000\)/);
assert.match(guide,/Math\.max\(30,Math\.min\(260,Math\.round\(60000\/average\)\)\)/);
/* 파형 막대는 recorder.js의 waveformPath와 같은 식으로 그린다. */
assert.match(guide,/2\.25\+value\/100\*16\.75/);
/* 두 번 탭 판정은 앱과 같은 값이어야 헷갈리지 않는다. */
assert.match(guide,/now-lastTapAt<340 && Math\.abs\(event\.clientX-lastTapX\)<28/);
assert.match(guide,/BPM을 10씩/);
assert.match(guide,/10초씩 이동/);
assert.match(guide,/잠금화면에서 재생되지 않습니다/,'YouTube 잠금화면 제약');
assert.match(worker,/'\.\/guide\.html'/,'오프라인에서도 열린다');
assert.match(sitemap,/guide\.html/);
/* 앱에서는 도움말이 나머지 링크 위 줄에 홀로 가운데 온다. */
assert.match(indexHtml,/<a class="app-help" href="guide\.html">도움말<\/a>/);
assert.match(indexHtml,/\.app-footer \.app-help\{ flex:0 0 100%; justify-content:center; \}/);
assert.match(guide,/<h1>O’live 도움말<\/h1>/);
assert.doesNotMatch(guide,/사용법/);
console.log('guide page checks passed');

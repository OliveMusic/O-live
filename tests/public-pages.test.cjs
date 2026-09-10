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
const tuner=read('js/tuner.js');
const rhythm=read('js/rhythm-trainer.js');
const earTrainer=read('js/ear-trainer.js');
const recorder=read('js/recorder.js');
const practiceLinks=read('js/practice-links.js');
const jam=read('js/jam-session.js');
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

/* 정보 페이지에서 앱으로 돌아가는 링크는 시작 화면을 한 번 더 띄운다. */
for(const [label,text] of [['about',about],['privacy',privacy],['terms',terms],['guide',guide]]){
  assert.doesNotMatch(text,/href="index\.html"/,`${label}: 앱 링크에 #splash가 붙어야 한다`);
  assert.match(text,/href="index\.html#splash"/,`${label}: 앱 링크`);
}
assert.match(indexHtml,/const reopened=location\.hash==='#splash'/);
assert.match(indexHtml,/history\.replaceState\(null,'',location\.pathname\+location\.search\)/,
  '해시는 주소창에 남기지 않는다');

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
/* 세션 종류는 지금 울리는 것이 정한다. 앞 기능이 남긴 값을 물려받으면
   청음을 하다 트랙으로 넘어갔을 때 ambient가 남아 YouTube가 묵음이 된다. */
assert.match(index,/const mode=wantsPlayback\?'playback':'ambient'/);
assert.match(index,/transportKeepsWhenHidden\(transport\) \|\| transport\.playbackSession/);
/* 소리를 내는 기능은 모두 운반자로 등록해야 튜너 진입과 화면 숨김이 닿는다. */
assert.match(practiceLinks,/registerTransport\(\{isPlaying,stop:stopPlayback,playbackSession:true\}\)/);
assert.match(practiceLinks,/if\(sounding===next\) return;/,'상태가 바뀔 때만 알린다');
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

/* 도움말은 문서가 아니라 앱이다. 진짜 앱을 띄우고 그 위에 눌러야 할 곳만 밝힌다. */
assert.match(guide,/<title>도움말<\/title>/);
assert.match(guide,/<h1>도움말<\/h1>/);
assert.doesNotMatch(guide,/사용법/);
assert.match(guide,/frame\.setAttribute\('src','index\.html\?guide=1'\)/,'투어는 진짜 앱을 띄운다');
/* 앱이 iframe 안에서 열려야 하므로 frame-ancestors로 막으면 안 된다. */
assert.doesNotMatch(indexHtml,/frame-ancestors/);
/* 미리보기 프레임은 시작 화면을 건너뛴다. 진짜 첫 실행의 시작 화면을 뺏으면 안 된다. */
assert.match(indexHtml,/const preview=\/\[\?&\]guide=1/);
assert.match(indexHtml,/skip=preview \|\| \(!reopened && state==='shown'\)/);

/* 챕터를 골라서 배우고, 전체 둘러보기도 있다. */
for(const key of ['metronome','tuner','scales','ear','rhythm','record','jam']){
  assert.match(guide,new RegExp(`key:'${key}'`),`${key} 챕터`);
}
assert.match(guide,/data-chapter="all"/,'전체 둘러보기');

/* 덮개는 네 조각이고 가운데 구멍에는 아무 요소도 없다. 그래야 터치가 앱에 닿는다.
   한 장으로 덮으면 하이라이트를 눌러도 앱이 받지 못한다. */
for(const part of ['top','right','bottom','left']){
  assert.match(guide,new RegExp(`data-part="${part}"`),`덮개 ${part}`);
}
assert.match(guide,/\.mask-part\{[\s\S]{0,120}?position:absolute; background:rgba/);
assert.match(guide,/\.halo\{[\s\S]{0,80}?pointer-events:none/,'테두리는 터치를 가로채지 않는다');

/* 미리보기 프레임은 서비스 워커를 건드리지 않는다. 갱신이 잡히면 스스로 새로고침하고,
   그 순간 도움말이 붙잡고 있던 문서가 끊겨 투어가 빈 화면에서 헛돈다. */
assert.match(index,/const oliveIsPreview=\/\[\?&\]guide=1/);
assert.match(index,/if\(!oliveIsPreview && 'serviceWorker' in navigator\)/);
/* 그래도 프레임이 다시 뜰 수 있다. 그때는 지금 단계를 그 자리에서 다시 건다. */
assert.match(guide,/frame\.addEventListener\('load',\(\)=>\{ if\(running\) runStep\(\); \}\)/);
assert.match(guide,/function readyDoc\(\)/,'문서를 붙잡지 않고 그때그때 묻는다');
assert.match(guide,/앱을 여는 중입니다/,'기다리는 동안 빈 화면을 두지 않는다');
assert.match(guide,/앱을 열지 못했습니다/,'못 열면 다시 시도할 수 있다');

/* 앱이 목록을 다시 그리면 붙잡아 둔 요소가 떨어져 나가 구멍이 얼어붙는다.
   요소가 아니라 찾는 법을 들고 매번 다시 찾아야 한다. */
assert.match(guide,/function repaint\(\)\{[\s\S]{0,240}?resolveTarget\(doc,tracked\)/);
/* 대상을 기다리는 사이 사용자가 건너뛰면 그 기다림은 버려야 한다. */
assert.match(guide,/const mine=\+\+token;/);
assert.match(guide,/if\(!running \|\| mine!==token\) return;/);

/* 가리키는 곳이 앱에 실제로 있어야 한다. 앱에서 id를 바꾸면 여기서 먼저 걸린다. */
const appSource=indexHtml+'\n'+recorder+'\n'+practiceLinks;
const targets=[...guide.matchAll(/target:'([^']+)'/g)].map(match=>match[1]);
assert.ok(targets.length>=30,'단계마다 가리키는 곳이 있다');
for(const target of new Set(targets)){
  const id=/^#([A-Za-z0-9_-]+)$/.exec(target);
  if(id){ assert.ok(appSource.includes(`id="${id[1]}"`),`앱에 없는 대상: ${target}`); continue; }
  const cls=/^\.([a-z0-9-]+)/.exec(target);
  if(cls) assert.ok(appSource.includes(cls[1]),`앱에 없는 대상: ${target}`);
}

/* 드롭다운은 눌러도 목록만 열린다. 값이 바뀌었는지 보고 넘어가야 목록이 열린 채로
   다음 단계로 밀려가지 않는다. 열린 목록은 부모 상자 밖으로 나가므로 구멍도 넓혀야 한다. */
assert.match(guide,/function ddValue\(doc,selector\)/);
assert.match(guide,/memo:doc=>ddValue\(doc,'#scaleKey'\), check:\(doc,memo\)=>ddValue\(doc,'#scaleKey'\)!==memo/);
assert.match(guide,/memo:doc=>ddValue\(doc,'#scaleType'\), check:\(doc,memo\)=>ddValue\(doc,'#scaleType'\)!==memo/);
assert.match(guide,/el\.querySelector\('\.dd-menu:not\(\[hidden\]\)'\)/,'열린 목록까지 뚫는다');

/* 녹음을 켜 둔 채 다음 단계로 가면 도움말 내내 녹음이 돈다. 그 단계를 떠나면 멈춘다. */
assert.match(guide,/function stopRecordingIn\(doc\)/);
assert.match(guide,/if\(!step\.recording\) stopRecordingIn\(doc\)/);
assert.match(guide,/target:'#recordToggle', recording:true/);
/* 파형만 뚫으면 재생을 시작할 수 없다. 왼쪽 올리브 버튼과 한 짝으로 묶는다. */
assert.match(guide,/target:'\.record-waveform', also:'\.record-player-play'/);
assert.match(guide,/function holeBox\(el,also\)/);
/* 링크를 담는 화면도 설명한다. 누르고 아무 말 없이 지나가면 안 된다. */
assert.match(guide,/target:'#linkPanel'/);
assert.match(guide,/검색하거나 주소를 붙여넣기/);
/* 시연이라도 즐겨찾기가 눌린 대로 남아야 한다. 다시 부를 때 상태를 들고 있는다. */
assert.match(cloud,/function guidePin\(list,id,pinned\)/);
assert.match(cloud,/if\(guideMode\)\{ guidePin\(guideState\(\)\.links,id,pinned\); return true; \}/);
assert.match(cloud,/if\(guideMode\)\{ guidePin\(guideState\(\)\.recordings,id,pinned\); return true; \}/);
/* 소리를 켜자마자 끄면 팍 꺼진다. 몇 초 들려주고 서서히 어두워지며 넘긴다. */
assert.match(guide,/linger:3200/);
assert.match(guide,/setTimeout\(advance,step\.linger\|\|0\)/);
assert.match(guide,/#tour\.leaving\{ opacity:0; pointer-events:none; \}/);
assert.match(guide,/function leaveTour\(then\)/);

/* 목록에는 녹음본과 링크가 섞여 있고 예시는 이름까지 같다. 구조로 갈라야 한다. */
assert.match(guide,/const prefix=kind==='link'\?'link-player-':'record-player-'/);

/* 코드 팔레트는 몸통이 미리 듣기이고 +가 담기다. 예전 설명이 이 둘을 섞어 놓았다. */
assert.match(guide,/코드 몸통을 누르면 <b>소리만<\/b>/);
assert.doesNotMatch(guide,/누르면 미리 들려주고 진행에 더해집니다/);
assert.match(jam,/cc-add[\s\S]{0,240}?addChord\(deg\)/,'실제로 +가 진행에 담는다');

/* 투어를 벗어날 때 소리를 남기지 않는다. */
assert.match(guide,/function quiet\(\)/);
assert.match(guide,/if\(metro && metro\.classList\.contains\('running'\)\) metro\.click\(\)/);

/* 시연 모드는 도움말이 띄울 때만 켜지고 저장하지 않는다. */
assert.match(cloud,/const guideMode=\/\[\?&\]guide=1/);
assert.match(cloud,/if\(guideMode\) return guideRecordings\(\)/);
assert.match(cloud,/if\(guideMode\) return guideLinks\(\)/);
assert.match(cloud,/title:'C Major Scale'/);
assert.match(cloud,/video_id:'edScGrfl50M'/);
/* 예시 녹음은 C4에서 시작하는 장음계다. 제목과 어긋나면 안 된다. */
assert.match(cloud,/const steps=\[0,2,4,5,7,9,11,12\]/);
assert.match(cloud,/261\.63\*Math\.pow\(2,semitone\/12\)/);

/* 눌러서 가르칠 수 없는 것은 마지막 카드로 남긴다. */
assert.match(guide,/무음 모드를 꺼 보세요/);
assert.match(guide,/직접 잠그면 끊길 수 있습니다/);
assert.match(guide,/잠금화면에서 재생되지 않습니다/,'YouTube 잠금화면 제약');
assert.match(guide,/저장하기 전에는 서버로 나가지 않습니다/);
/* 잠금화면 10초 버튼은 iOS와 같은 모양이다. 원을 그리고 좌우로 뒤집어 쓴다. */
assert.match(guide,/\.mock-skip\.fwd svg\{ transform:scaleX\(-1\); \}/);
assert.equal((guide.match(/M13\.66 4\.17A8 8 0 1 1 8\.75 4\.69/g)||[]).length,4,
  'iPhone 2 + Watch 2, 넷이 같은 경로다');
assert.match(guide,/M9\.94 3\.38 15\.18 1\.84 14\.1 6\.92Z/,'화살촉');
/* 숫자는 잉크 무게중심이 오른쪽으로 쏠려 있어 광학적으로 왼쪽으로 민다. */
assert.match(guide,/transform:translateX\(-\.04em\)/);
/* 목업의 올리브도 앱과 같은 비율로 씨구멍을 둔다. */
assert.match(guide,/\.mock-olive::after\{[\s\S]{0,200}?left:70%; top:50%/);
assert.match(guide,/width:calc\(var\(--olive-w\) \* \.294\)/);
assert.equal((guide.match(/class="mock-olive"/g)||[]).length,2);

assert.match(worker,/'\.\/guide\.html'/,'오프라인에서도 열린다');
assert.match(sitemap,/guide\.html/);
/* 앱에서는 도움말이 나머지 링크 위 줄에 홀로 가운데 온다. */
assert.match(indexHtml,/<a class="app-help" href="guide\.html">도움말<\/a>/);
assert.match(indexHtml,/\.app-footer \.app-help\{ flex:0 0 100%; justify-content:center; \}/);
console.log('guide page checks passed');

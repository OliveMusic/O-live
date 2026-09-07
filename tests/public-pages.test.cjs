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
const worker=read('service-worker.js');
const manifest=JSON.parse(read('manifest.json'));
const sitemap=read('sitemap.xml');
const releaseContext={globalThis:{}};
vm.createContext(releaseContext);
vm.runInContext(read('app-version.js'),releaseContext,{filename:'app-version.js'});
const release=releaseContext.globalThis.OLIVE_RELEASE;

for(const [label,html] of Object.entries({index,about,privacy,terms})){
  assert.match(html,/lang="ko"/,`${label}: Korean language declaration`);
  assert.match(html,/og:image/,`${label}: social preview image`);
}

for(const href of ['about.html','privacy.html','terms.html']){
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
assert.match(index,/<button class="app-version" id="appVersion" type="button"><\/button>/);
assert.match(index,/const versionText='버전 '\+release\.version/);
assert.match(index,/길게 눌러 오디오 진단 기록 복사/);
assert.match(index,/window\.OliveAudioDiagnostics\.exportText\(\)/);
assert.match(index,/olive-audio-diagnostics-v1/);
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

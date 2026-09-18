/* ===================== 공통 오디오 런타임 ===================== */
let audioCtx = null;
let __ctxMode = null;
let __ctxResumePromise = null;
let __ctxReadyPromise = null;
let __backgroundAudio = null;
let __backgroundAudioGeneration = 0;
let __backgroundAudioUrl = '';
let __stoppingBackgroundMedia = false;
let __backgroundMediaArmed = false;
let __backgroundMediaPaused = false;
let __backgroundSuspendPromise = null;
let __backgroundResumePromise = null;
let __backgroundResumeSequence = 0;
let __appOutput = null;
let __appOutputCtx = null;
let __backgroundStreamDestination = null;
let __backgroundStreamCtx = null;
let __backgroundUsesStream = false;
let __backgroundMediaActionMode = '';
let __audioSessionMode = '';
let __pausedClock = null, __pausedAt = 0;
let __keepAlivePlayPending = false, __keepAliveRestored = false;

/* 무음을 다시 흘려 자리를 지킨다. 소리가 끊기면 iOS가 오디오 엔진을 멈추고 이윽고
   페이지를 통째로 재워, 잠금화면에서 누른 재생이 잠금을 풀 때까지 배달되지 않는다. */
function keepBackgroundStreamFlowing(detail){
  const audio=__backgroundAudio;
  if(!audio || !audio.paused) return;
  __keepAlivePlayPending=true;
  try{
    const started=audio.play();
    if(started && typeof started.catch==='function'){
      started.catch(()=>{ __keepAlivePlayPending=false; });
    }
  }catch(e){ __keepAlivePlayPending=false; }
  recordAudioDiagnostic('media-element:keepalive',detail);
}

/* 잠금화면의 단추 그림은 iOS가 요소의 실제 재생 상태로 되돌려 놓는다. 우리가 자리를
   지키려 다시 튼 것까지 '재생 중'으로 읽으므로, playing 이벤트 뒤에 '정지'를 다시
   알린다. 이것을 빼먹으면 첫 일시정지가 헛돈다 — 소리는 멈추는데 단추는 그대로다. */
function declareBackgroundPaused(){
  try{ if(navigator.mediaSession) navigator.mediaSession.playbackState='paused'; }catch(e){}
}
let __externalMediaSessionOwner = '';

/* 잠금 화면의 원격 명령이 실제로 도착했는지, 엔진이 어떤 순서로 깨어났는지는
   화면만 봐서는 알 수 없다. 그 순서를 메모리에만 짧게 남겨 E2E가 확인한다.
   사용자에게 보여 주거나 기기에 저장하지 않는다. 오디오나 계정 정보도 담지 않는다.
   길게 눌러 복사하던 UI는 걷어냈다. 다시 필요해지면 그때 얹는다. */
const AUDIO_DIAGNOSTICS_LIMIT=100;
let audioDiagnostics=[];
function readAudioDiagnostics(){ return audioDiagnostics.slice(); }
function currentAudioDiagnosticState(){
  let transport=null, tempo=null;
  try{ transport=activeBackgroundTransport(); }catch(e){}
  try{
    if(transport && typeof transport.getTempo==='function'){
      const value=Number(transport.getTempo());
      if(Number.isFinite(value)) tempo=Math.round(value);
    }
  }catch(e){}
  const ctx=audioCtx;
  const media=__backgroundAudio;
  return {
    visibility:typeof document==='undefined' ? 'unknown' : document.visibilityState,
    context:ctx ? ctx.state : 'none',
    contextMode:__ctxMode||'none',
    baseLatency:ctx && Number.isFinite(Number(ctx.baseLatency))
      ? Number(Number(ctx.baseLatency).toFixed(4)) : null,
    outputLatency:ctx && Number.isFinite(Number(ctx.outputLatency))
      ? Number(Number(ctx.outputLatency).toFixed(4)) : null,
    media:media ? (media.paused?'paused':'playing') : 'none',
    mediaGeneration:media ? Number(media.dataset.oliveBackgroundGeneration)||null : null,
    mediaPaused:__backgroundMediaPaused,
    mediaArmed:__backgroundMediaArmed,
    stream:__backgroundUsesStream,
    actionMode:__backgroundMediaActionMode||'none',
    transport:transport ? transport.label : 'none',
    tempo,
    gain:__appOutput ? Number(__appOutput.gain.value.toFixed(3)) : null,
  };
}
function recordAudioDiagnostic(event,details={}){
  try{
    audioDiagnostics.push(Object.assign({
      at:new Date().toISOString(),
      event:String(event||'unknown'),
    },currentAudioDiagnosticState(),details));
    if(audioDiagnostics.length>AUDIO_DIAGNOSTICS_LIMIT){
      audioDiagnostics=audioDiagnostics.slice(-AUDIO_DIAGNOSTICS_LIMIT);
    }
  }catch(e){}
}
function clearAudioDiagnostics(){ audioDiagnostics=[]; }
/* 예전 버전이 기기에 남긴 기록을 한 번 지운다. 더는 저장하지 않는다. */
try{
  if(typeof localStorage!=='undefined') localStorage.removeItem('olive-audio-diagnostics-v1');
}catch(e){}
window.OliveAudioDiagnostics=Object.freeze({
  read:readAudioDiagnostics,
  clear:clearAudioDiagnostics,
  mark:recordAudioDiagnostic,
});

/* iOS는 오디오 세션에 '용도'를 붙인다.
   ambient : 다른 앱 소리와 섞인다. 음악을 틀어 놓고 메트로놈을 쓸 수 있다.
             잠금화면 위젯도 뜨지 않는다. 대신 무음 스위치를 따른다.
   playback : 잠금 화면에서도 재생할 메트로놈·잼과 녹음 파일에 쓴다.
   play-and-record : 마이크도 같이 쓴다. 튜너나 녹음을 켤 때 이쪽으로 바꾼다. */
function setAudioSession(mode){
  if(__audioSessionMode===mode) return;
  try{
    if(navigator.audioSession) navigator.audioSession.type = mode;
    __audioSessionMode=mode;
    recordAudioDiagnostic('audio-session:'+mode);
  }catch(e){}
}

/* 눌러서 들어 보는 소리 — 튜너 현음, 스케일 건반, 잼 코드 미리 듣기 — 는 ambient라
   무음 스위치를 따른다. playback으로 올리면 무음 모드에서도 들리지만 다른 앱 음악이
   끊기고 현 하나 튕길 때마다 잠금화면 위젯이 떠서, 얻는 것보다 잃는 것이 크다.
   그렇다고 무음인지 감지해 그때만 알릴 수도 없다 — navigator.audioSession은 세션을
   '설정'만 할 뿐 기기가 지금 무음인지 알려주지 않고, 웹에 그런 API가 없다.
   그래서 무음 스위치가 있는 기기에서만 미리 조용히 적어 둔다. 이 API는 WebKit에만
   있고, 거친 포인터까지 겹치면 사실상 iPhone과 iPad다. */
function revealMuteSwitchNotes(){
  const webkitSession=Boolean(navigator.audioSession);
  const touch=Boolean(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
  if(!webkitSession || !touch) return;
  document.querySelectorAll('.mute-note').forEach(el=>{ el.hidden=false; });
}
revealMuteSwitchNotes();

/* 실제 녹음 파일처럼 자체 HTMLAudioElement를 가진 기능은 공용 메트로놈
   플레이어가 Media Session 핸들러를 지우지 못하도록 소유권을 표시한다. */
function claimExternalMediaSession(owner){
  __externalMediaSessionOwner=String(owner||'');
}
function releaseExternalMediaSession(owner){
  if(!owner || __externalMediaSessionOwner===String(owner)) __externalMediaSessionOwner='';
}

/* 앱의 마스터 출력 앞에 한 번만 두는 라우터다. 평소에는 스피커로 바로 보내고,
   메트로놈·잼 재생 중에는 실제 <audio>가 가진 MediaStream으로 보낸다. 그래야
   iOS 잠금화면이 JS 콜백을 늦게 전달해도 재생기 자체를 즉시 멈출 수 있다. */
function getAppOutput(ctx){
  if(__appOutput && __appOutputCtx===ctx) return __appOutput;
  __appOutput=ctx.createGain();
  __appOutput.gain.value=1;
  __appOutputCtx=ctx;
  __appOutput.connect(ctx.destination);
  return __appOutput;
}

function routeAppOutput(destination){
  if(!audioCtx || audioCtx.state==='closed' || typeof audioCtx.createGain!=='function') return;
  const output=getAppOutput(audioCtx);
  try{ output.disconnect(); }catch(e){}
  try{ output.connect(destination||audioCtx.destination); }catch(e){}
}

function attachBackgroundStream(audio,ctx){
  if(!audio || !ctx || ctx.state==='closed' ||
     typeof ctx.createMediaStreamDestination!=='function') return false;
  try{
    if(!__backgroundStreamDestination || __backgroundStreamCtx!==ctx){
      __backgroundStreamDestination=ctx.createMediaStreamDestination();
      __backgroundStreamCtx=ctx;
    }
    const mediaStream=__backgroundStreamDestination.stream;
    if(!mediaStream || typeof mediaStream.getAudioTracks!=='function' ||
       !mediaStream.getAudioTracks().length) return false;
    if(audio.srcObject!==mediaStream){
      __stoppingBackgroundMedia=true;
      try{ audio.pause(); }catch(e){}
      audio.removeAttribute('src');
      audio.srcObject=mediaStream;
      __stoppingBackgroundMedia=false;
    }
    audio.loop=false;
    routeAppOutput(__backgroundStreamDestination);
    __backgroundUsesStream=true;
    return true;
  }catch(e){
    __stoppingBackgroundMedia=false;
    try{ audio.srcObject=null; }catch(ignore){}
    __backgroundStreamDestination=null;
    __backgroundStreamCtx=null;
    routeAppOutput();
    return false;
  }
}

function detachBackgroundStream(){
  routeAppOutput();
  if(__backgroundStreamDestination){
    try{
      __backgroundStreamDestination.stream.getTracks().forEach(track=>track.stop());
    }catch(e){}
  }
  __backgroundStreamDestination=null;
  __backgroundStreamCtx=null;
  __backgroundUsesStream=false;
}

/* MediaStream 출력을 쓸 수 없는 브라우저만 예전 무음 WAV 방식으로 돌아간다. */
function silentWavUrl(){
  if(__backgroundAudioUrl) return __backgroundAudioUrl;
  const sampleRate=8000, sampleCount=2000;
  const buffer=new ArrayBuffer(44+sampleCount);
  const view=new DataView(buffer);
  const text=(offset,value)=>{
    for(let index=0;index<value.length;index++) view.setUint8(offset+index,value.charCodeAt(index));
  };
  text(0,'RIFF'); view.setUint32(4,36+sampleCount,true); text(8,'WAVE');
  text(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true);
  view.setUint16(22,1,true); view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate,true); view.setUint16(32,1,true); view.setUint16(34,8,true);
  text(36,'data'); view.setUint32(40,sampleCount,true);
  for(let index=44;index<buffer.byteLength;index++) view.setUint8(index,128);
  __backgroundAudioUrl=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
  return __backgroundAudioUrl;
}

/* iOS 잠금 화면은 재생 전환 도중 Media Session의 지원 명령 목록을 바꾸면
   화면에는 버튼을 남겨도 그 버튼을 새 핸들러에 연결하지 않는 경우가 있다.
   따라서 한 재생 세션에서는 액션 맵을 한 번만 설치하고, 이후에는 메타데이터와
   재생 상태만 갱신한다. */
function configureBackgroundMediaSession(label,usesStream=__backgroundUsesStream){
  try{
    if(__externalMediaSessionOwner) return;
    if(!navigator.mediaSession) return;
    updateBackgroundMediaMetadata(label);
    navigator.mediaSession.playbackState=__backgroundMediaPaused?'paused':'playing';
    if(typeof navigator.mediaSession.setActionHandler!=='function') return;
    const actionMode=usesStream?'stream':'fallback';
    if(__backgroundMediaActionMode===actionMode) return;
    if(usesStream){
      // 실제 소리가 <audio>를 통과하므로 iOS의 기본 원격 제어가 가장 빠르다.
      try{ navigator.mediaSession.setActionHandler('play',()=>{
        recordAudioDiagnostic('media-action:play');
        resumeBackgroundPlayback().catch(()=>{});
      }); }catch(e){}
      /* 일시정지도 우리가 받는다. 예전에는 시스템에 맡겼는데, 그러면 iOS가 <audio>를
         직접 멈추고 잠금화면 단추도 요소의 상태를 그대로 따라간다. 이제는 멈춘 뒤에도
         무음을 계속 흘려야 하므로(그래야 iOS가 페이지를 재우지 않는다) 요소는 '재생 중'이고,
         맡겨 두면 단추가 영영 일시정지 모양으로 남는다 — 눌러도 눌러도 재생 단추가
         나오지 않던 것이 그것이다. 우리가 받으면 playbackState가 그림을 정한다. */
      try{ navigator.mediaSession.setActionHandler('pause',()=>{
        recordAudioDiagnostic('media-action:pause');
        pauseBackgroundPlayback();
      }); }catch(e){}
      try{ navigator.mediaSession.setActionHandler('stop',null); }catch(e){}
    }else{
      try{ navigator.mediaSession.setActionHandler('play',()=>{
        recordAudioDiagnostic('media-action:play');
        resumeBackgroundPlayback().catch(()=>{});
      }); }catch(e){}
      try{ navigator.mediaSession.setActionHandler('pause',()=>{
        recordAudioDiagnostic('media-action:pause');
        pauseBackgroundPlayback();
      }); }catch(e){}
      try{ navigator.mediaSession.setActionHandler('stop',()=>{
        recordAudioDiagnostic('media-action:stop');
        stopBackgroundTransports();
      }); }catch(e){}
    }
    // iOS가 원형 건너뛰기 버튼에 표시한 초 단위 값을
    // 그대로 BPM 변화량으로 쓴다. 값을 안 보내는 기기에서는 10을 쓴다.
    try{ navigator.mediaSession.setActionHandler('seekbackward',details=>{
      recordAudioDiagnostic('media-action:seekbackward',{
        seekOffset:Number(details&&details.seekOffset)||null,
      });
      adjustBackgroundTempo(-1,details);
    }); }catch(e){}
    try{ navigator.mediaSession.setActionHandler('seekforward',details=>{
      recordAudioDiagnostic('media-action:seekforward',{
        seekOffset:Number(details&&details.seekOffset)||null,
      });
      adjustBackgroundTempo(1,details);
    }); }catch(e){}
    for(const action of ['previoustrack','nexttrack']){
      try{ navigator.mediaSession.setActionHandler(action,null); }catch(e){}
    }
    __backgroundMediaActionMode=actionMode;
    recordAudioDiagnostic('media-actions:installed',{label,actionMode});
  }catch(e){}
}

async function startBackgroundMedia(label,preparedCtx){
  if(typeof Audio!=='function' || typeof URL==='undefined' || typeof Blob==='undefined') return;
  if(!__backgroundAudio){
    __backgroundAudio=createBackgroundAudioElement();
  }
  const ctx=preparedCtx||audioCtx;
  const usesStream=attachBackgroundStream(__backgroundAudio,ctx);
  if(!usesStream){
    __backgroundUsesStream=false;
    try{ __backgroundAudio.srcObject=null; }catch(e){}
    if(!__backgroundAudio.getAttribute('src')) __backgroundAudio.src=silentWavUrl();
    __backgroundAudio.loop=true;
    routeAppOutput();
  }
  if(usesStream && __backgroundAudio.paused && __backgroundMediaArmed &&
     !__backgroundMediaPaused){
    pauseBackgroundPlayback();
  }
  configureBackgroundMediaSession(label,usesStream);
  recordAudioDiagnostic('media-element:start',{label,usesStream});
  if(__backgroundMediaPaused) return;
  try{
    const result=__backgroundAudio.play();
    if(result && typeof result.then==='function') await withTimeout(result,1400);
    if(__backgroundAudio && !__backgroundAudio.paused) __backgroundMediaArmed=true;
  }catch(e){
    recordAudioDiagnostic('media-element:start-failed',{
      error:String(e&&e.name||e&&e.message||e).slice(0,80),
    });
    /* playback 오디오 세션만으로 이어갈 수 있으므로 실제 재생은 막지 않는다. */
  }
}

function createBackgroundAudioElement(){
  const audio=new Audio();
  audio.preload='auto';
  audio.playsInline=true;
  audio.hidden=true;
  audio.dataset.oliveBackground='true';
  audio.dataset.oliveBackgroundGeneration=String(++__backgroundAudioGeneration);
  audio.addEventListener('playing',()=>{
    if(audio!==__backgroundAudio) return;
    /* 자리를 지키려고 무음을 흘리는 중이다. 이것을 재개 신호로 읽으면 사용자가 누르지도
       않은 재생이 시작된다. */
    if(__keepAlivePlayPending){
      __keepAlivePlayPending=false;
      declareBackgroundPaused();
      recordAudioDiagnostic('media-element:keepalive-playing');
      return;
    }
    recordAudioDiagnostic('media-element:playing');
    // 오래 잠근 뒤에는 <audio>가 먼저 playing이 되어도 AudioContext는 아직
    // suspended일 수 있다. 박자를 먼저 열지 말고 엔진 복구가 끝날 때까지 기다린다.
    if(__backgroundMediaPaused){
      // 현재 원격 play 요청이 이미 복구 중이면 playing 이벤트가 같은 작업을
      // 한 번 더 만들지 않게 한다. 별도의 새 play 명령은 기존 시도를 교체한다.
      if(!__backgroundResumePromise) resumeBackgroundPlayback().catch(()=>{});
      return;
    }
    __backgroundMediaArmed=true;
    try{ if(navigator.mediaSession) navigator.mediaSession.playbackState='playing'; }catch(e){}
  });
  // iPhone의 잠금 화면은 Media Session 콜백 대신 실제 <audio>만
  // 일시정지시키는 경우가 있다. 그 이벤트도 앱의 재생 정지로 연결한다.
  audio.addEventListener('pause',()=>{
    if(__stoppingBackgroundMedia || audio!==__backgroundAudio ||
       !hasBackgroundTransportPlaying()) return;
    // 재생 복구가 끝나기 전에 다시 누른 pause도 무시하지 않는다. 현재 시도를
    // 무효화해 뒤늦은 resume-ready가 사용자의 새 일시정지를 덮지 않게 한다.
    if(__backgroundResumePromise && __backgroundMediaPaused){
      __backgroundResumeSequence++;
      __backgroundMediaArmed=false;
      setBackgroundTransportsPaused(true);
      try{ if(navigator.mediaSession) navigator.mediaSession.playbackState='paused'; }catch(e){}
      recordAudioDiagnostic('transport:resume-cancelled');
      return;
    }
    if(!__backgroundMediaArmed){
      /* 이미 '정지'인데 iOS가 요소를 또 멈췄다. 그대로 두면 자리를 놓쳐 페이지가
         잠들고, 잠금화면의 재생 명령이 잠금을 풀 때까지 배달되지 않는다. 한 번 쉬는
         동안 한 번만 되살린다 — 무한히 되받으면 잠금화면 그림이 깜빡인다. */
      if(__backgroundMediaPaused && __backgroundUsesStream && !__keepAliveRestored){
        __keepAliveRestored=true;
        keepBackgroundStreamFlowing({restore:true});
      }
      return;
    }
    recordAudioDiagnostic('media-element:pause');
    __backgroundMediaArmed=false;
    pauseBackgroundPlayback();
  });
  if(document.body) document.body.appendChild(audio);
  return audio;
}

/* iOS는 pause 뒤 원형 건너뛰기 명령을 휴면 네이티브 플레이어에 남겨두기도 한다.
   DOM 오디오 요소를 계속 새로 만들면 빠른 반복 중 여러 플레이어의 포커스가
   경쟁한다. 하나의 요소를 유지하고 그 내부 미디어 리소스만 다시 선택해,
   동일한 플랫폼 대상 위에서 연결을 새로 만든다. */
function refreshBackgroundAudioForResume(ctx){
  const audio=__backgroundAudio;
  const destination=__backgroundStreamDestination;
  if(!audio || !__backgroundUsesStream || !destination || __backgroundStreamCtx!==ctx){
    return audio;
  }
  const mediaStream=destination.stream;
  if(!mediaStream || typeof mediaStream.getAudioTracks!=='function' ||
     !mediaStream.getAudioTracks().length) return audio;
  const previousGeneration=Number(audio.dataset.oliveBackgroundGeneration)||null;
  /* 여기서 srcObject를 비우고 load()를 부르면 안 된다. WebKit에서 그렇게 리셋한
     요소에 같은 MediaStream을 다시 물리면 요소는 '재생 중'이라고 보고하면서도
     아무것도 내보내지 않는다 — 잠금화면에서 재개했을 때 소리가 안 나던 것이 그것이다.
     기록으로도 맞아떨어졌다: metro:click은 찍히고 track=live인데 소리만 없고, iOS는
     아무것도 안 나온다고 보고 몇 초 뒤 미디어 박스를 거둬 갔다.

     처음 시작할 때 쓰는 attachBackgroundStream()은 load()를 부르지 않는다. 그 길은
     늘 잘 된다. 재개도 같은 모양으로 맞춘다 — 요소는 하나를 그대로 유지하므로
     이 함수가 원래 막으려던 '여러 플레이어의 포커스 경쟁'도 그대로 막힌다. */
  __stoppingBackgroundMedia=true;
  try{
    /* 이미 살아 있는 스트림을 물고 있으면 아무것도 건드리지 않는다. 여기서 pause()를
       부르면 그 pause 이벤트가 비동기로 날아와 앱이 '사용자가 일시정지했다'로 읽고
       방금 건 재생을 도로 멈춘다 — __stoppingBackgroundMedia 빗장은 동기 구간에서만
       걸려 있어 그 이벤트를 덮지 못한다. 예전에는 뒤따르던 load()가 그 이벤트를
       삼켜서 가려져 있었을 뿐이다. */
    if(audio.srcObject!==mediaStream){
      audio.pause();
      audio.removeAttribute('src');
      audio.srcObject=mediaStream;
    }
    audio.loop=false;
    audio.dataset.oliveBackgroundGeneration=String(++__backgroundAudioGeneration);
  }catch(error){
    try{ audio.srcObject=mediaStream; }catch(e){}
    recordAudioDiagnostic('media-element:refresh-failed',{
      error:String(error&&error.message||error&&error.name||error).slice(0,80),
    });
  }finally{
    __stoppingBackgroundMedia=false;
  }
  __backgroundMediaArmed=false;
  recordAudioDiagnostic('media-element:refreshed',{
    previousGeneration,
    generation:Number(audio.dataset.oliveBackgroundGeneration)||null,
  });
  return audio;
}

function setBackgroundTransportsPaused(paused){
  __transports.forEach(transport=>{
    try{
      if(transport.background && transport.isPlaying() &&
         typeof transport.setPaused==='function') transport.setPaused(paused);
    }catch(e){}
  });
}

/* 잠금 화면의 일시정지는 재생 위치를 버리는 '정지'가 아니다. 실제 출력이
   미디어 요소를 통과하면 그 요소만 멈추고, 구형 무음 WAV 경로에서만 공유
   AudioContext의 시계를 잠시 멈춘다. */
function pauseBackgroundPlayback(){
  recordAudioDiagnostic('transport:pause-request');
  if(__backgroundMediaPaused || !hasBackgroundTransportPlaying()){
    recordAudioDiagnostic('transport:pause-ignored');
    return;
  }
  __backgroundMediaPaused=true;
  __backgroundResumeSequence++;
  __backgroundMediaArmed=false;
  /* 멈출 때의 오디오 시계와 벽시계를 적어 둔다. 재개할 때 둘을 견주면 엔진이 그동안
     실제로 돌았는지 알 수 있다 — 상태가 running이어도 시계가 안 흘렀으면 멈춘 것이다. */
  try{
    __pausedClock=audioCtx ? audioCtx.currentTime : null;
    __pausedAt=Date.now();
  }catch(e){ __pausedClock=null; }
  setBackgroundTransportsPaused(true);
  if(!__backgroundUsesStream && __backgroundAudio && !__backgroundAudio.paused){
    __stoppingBackgroundMedia=true;
    try{ __backgroundAudio.pause(); }catch(e){}
    __stoppingBackgroundMedia=false;
  }
  declareBackgroundPaused();
  /* iOS는 소리가 끊긴 페이지를 이윽고 통째로 재운다. 그러면 잠금화면의 재생 단추를
     눌러도 페이지가 깨어날 때까지 아무 일도 일어나지 않는다. 기록이 그대로 말해 줬다 —
     10초쯤 쉰 판에서는 play 명령이 잠긴 채로 처리되어 화면이 켜지기 8.7초·10.3초 전에
     도착했는데, 29초와 36초를 쉰 판에서는 언제나 visibility:visible **51ms·42ms 전**에야
     도착했다. 잠금화면에서 누른 순간이 아니라 잠금을 푸는 순간에 배달된 것이다.

     그래서 스트림을 끊지 않고 계속 흘려 자리를 지킨다. 트랜스포트가 멈춰 있으므로
     흐르는 것은 무음이고, 잠금화면에는 playbackState로 '정지'라고 알린다. 소리가
     이어지면 10.7초의 엔진 동결도 오지 않는다 — 그 동결 역시 소리가 끊겨서 온 것이다. */
  /* 우리가 다시 트는 그 한 번만 삼킨다. 계속 삼키면 iOS가 요소를 직접 재생해
     재개하는 길까지 막힌다 — 잠금화면이 Media Session 콜백 대신 <audio>만
     건드리는 경우가 있고, e2e가 그 회귀를 잡아 줬다. */
  __keepAliveRestored=false;
  if(__backgroundUsesStream) keepBackgroundStreamFlowing();
  if(!__backgroundUsesStream && audioCtx && audioCtx.state==='running'){
    const ctx=audioCtx;
    try{
      const suspended=Promise.resolve(ctx.suspend()).catch(()=>{
        if(__backgroundMediaPaused && ctx===audioCtx) stopBackgroundTransports();
      });
      const tracked=suspended.finally(()=>{
        if(__backgroundSuspendPromise===tracked) __backgroundSuspendPromise=null;
      });
      __backgroundSuspendPromise=tracked;
    }catch(e){ stopBackgroundTransports(); }
  }
  recordAudioDiagnostic('transport:paused');
}

function replaceDormantBackgroundContext(){
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  if(recording) throw new Error('RecordingContextUnavailable');
  const old=audioCtx;
  audioCtx=null; __ctxMode=null; __ctxResumePromise=null; __ctxReadyPromise=null;
  __backgroundSuspendPromise=null;
  __appOutput=null; __appOutputCtx=null;
  __master=null; __send=null; __gtrCache.clear();
  if(__backgroundStreamDestination){
    try{ __backgroundStreamDestination.stream.getTracks().forEach(track=>track.stop()); }catch(e){}
  }
  __backgroundStreamDestination=null;
  __backgroundStreamCtx=null;
  __backgroundUsesStream=false;
  const ctx=createCtx('playback');
  setBackgroundTransportContext(ctx);
  if(old && old.state!=='closed'){
    try{ const closing=old.close(); if(closing) closing.catch(()=>{}); }catch(e){}
  }
  return ctx;
}

function resumeBackgroundPlayback(){
  if(!__backgroundMediaPaused || !hasBackgroundTransportPlaying()){
    recordAudioDiagnostic('transport:resume-ignored');
    return Promise.resolve();
  }
  // 빠른 pause→play 반복으로 앞선 복구가 아직 끝나지 않았더라도 새 원격 play는
  // 그 사용자 제스처 안에서 즉시 audio.play()를 호출해야 한다. 앞선 Promise에
  // 합류시키지 않고 세대 번호로 무효화하면, 늦게 끝난 작업이 최신 상태를 덮지 않는다.
  __keepAlivePlayPending=false;
  __keepAliveRestored=false;
  if(__backgroundResumePromise) recordAudioDiagnostic('transport:resume-superseded');
  const resumeSequence=++__backgroundResumeSequence;
  /* 쉬는 동안 오디오 시계가 벽시계만큼 흘렀는지. 뒤처진 만큼이 엔진이 멈춰 있던
     시간이다. */
  let clockMoved=null, wallMoved=null;
  try{
    if(__pausedClock!=null && audioCtx){
      clockMoved=Number((audioCtx.currentTime-__pausedClock).toFixed(2));
      wallMoved=Number(((Date.now()-__pausedAt)/1000).toFixed(2));
    }
  }catch(e){}
  recordAudioDiagnostic('transport:resume-start',{clockMoved,wallMoved});
  /* 기록 세 판이 같은 법칙을 보여 줬다. <audio>가 멈추고 **10.7초** 뒤에 오디오 엔진이
     렌더링을 멈춘다 — 10.92 · 10.68 · 10.66초. 그런데 ctx.state는 그 뒤로도 running이라
     답하므로 상태로는 가려낼 수 없다.

     엔진이 멈추면 MediaStream에 아무것도 흐르지 않고, 그러면 <audio>는 재생을 시작하지도
     실패하지도 못한 채 매달린다(요소=멈춤 · 준비=4로 10초 넘게 그대로). play()가 매달린
     것은 원인이 아니라 결과였다.

     상태는 못 믿어도 시계는 믿을 수 있다. 멈출 때 두 시계를 적어 뒀으니 제스처 안에서
     바로 셈이 된다 — **오디오 시계가 벽시계보다 뒤처진 만큼이 엔진이 쉰 시간이다.**

     쉰 시간으로 재면 안 된다. 9.8초 쉬고 누른 판에서 시계는 9.83 대 9.8로 완벽히
     맞았다. 동결은 10.7초에 오므로 그때 엔진은 멀쩡히 살아 있었는데, 시간으로 재던
     기준이 죽었다고 단정하고 멀쩡한 엔진을 걷어찼다. 재 둔 값으로 가른다:
     성한 판은 -0.03과 0.02초, 죽은 판은 0.56과 0.87초였다. 0.3초가 그 사이에 있다.

     어긋남으로 재면 스스로 바로잡히기도 한다. 한 번 되살린 뒤 다시 누르면 그동안
     흐른 시계가 셈에 들어와 어긋남이 줄고, 성한 엔진을 두 번 걷어차지 않는다. */
  const engineStalled=wallMoved!=null && clockMoved!=null && wallMoved-clockMoved>0.3;
  const task=(async()=>{
    let audio=__backgroundAudio;
    if(!audio) throw new Error('BackgroundAudioUnavailable');
    let ctx=audioCtx;
    if(!ctx || ctx.state==='closed' || ctx.state==='interrupted'){
      ctx=replaceDormantBackgroundContext();
      attachBackgroundStream(audio,ctx);
    }
    setAudioSession('playback');
    __ctxMode='playback';
    audio=refreshBackgroundAudioForResume(ctx);
    if(!audio) throw new Error('BackgroundAudioUnavailable');
    // 동일한 플레이어와 액션 맵을 세션 내내 유지한다. 재개할 때마다 핸들러를
    // 다시 등록하면 iOS가 잠금화면의 지원 버튼 목록을 재판단할 수 있다.
    if(__backgroundUsesStream){
      configureBackgroundMediaSession(activeBackgroundLabel(),true);
    }
    let mediaReady=Promise.resolve(), firstResume=Promise.resolve();
    const startedAt=Date.now();
    /* 멈춘 엔진은 깨워 달라고 하면 이미 깨어 있다고 답한다. 그러니 상태 기계를 억지로
       한 바퀴 돌려 렌더링 스레드를 되살린다. 요소도 스트림도 건드리지 않으므로 272처럼
       잠금화면의 자리를 놓칠 일은 없다 — 그때 탈이 났던 것은 컨텍스트를 통째로 새로
       만들고 srcObject를 갈아 끼운 쪽이었다.

       기다리지 않고 걸어만 둔다. 아래 audio.play()는 같은 동기 구간에서 불려야
       제스처를 잃지 않는다. 엔진이 되살아나 스트림에 다시 소리가 흐르면, 매달려 있던
       play()도 그때 풀린다. */
    let enginePrimed=Promise.resolve();
    if(engineStalled && ctx.state==='running'){
      recordAudioDiagnostic('engine:stalled',{clockMoved,wallMoved});
      try{
        enginePrimed=Promise.resolve(ctx.suspend())
          .then(()=>ctx.resume())
          .then(
            ()=>recordAudioDiagnostic('engine:kicked',{ms:Date.now()-startedAt}),
            error=>recordAudioDiagnostic('engine:kick-failed',{
              ms:Date.now()-startedAt,
              error:String(error&&error.message||error&&error.name||error).slice(0,80),
            }));
      }catch(error){
        recordAudioDiagnostic('engine:kick-failed',{
          error:String(error&&error.message||error&&error.name||error).slice(0,80),
        });
      }
    }
    try{
      const result=audio.play();
      if(result && typeof result.then==='function') mediaReady=result;
    }catch(error){ mediaReady=Promise.reject(error); }
    /* 스트림 경로는 일시정지할 때 컨텍스트를 재우지 않는다 — 아래 pauseBackgroundPlayback의
       suspend()는 구형 경로에서만 돈다. 그러니 이미 돌고 있는 엔진에 resume()을 부를
       까닭이 없는데, 기록을 보면 바로 그 호출 언저리에서 엔진 시계가 얼어붙었다.
       쉬는 동안에는 시계가 벽시계와 나란히 갔고(10.51 / 10.53) 재개 직후부터 14.33에
       멈춘 채 <audio>만 혼자 돌았다. 화면이 가려진 채로 오디오 세션을 다시 열라고 하면
       iOS가 그 요청을 물리면서 렌더링까지 놓는 것으로 읽힌다.

       구형 경로는 그대로 둔다. 거기서는 suspend()가 아직 날고 있는 동안에도 제스처
       안에서 resume()을 먼저 걸어 두어야 하고, 그 길은 지금 잘 되고 있다. */
    const needsContextResume=!(__backgroundUsesStream && ctx.state==='running');
    if(needsContextResume){
      try{
        // 구형 경로의 suspend()가 아직 끝나지 않았어도 원격 버튼의 사용자 제스처
        // 안에서 resume()을 먼저 요청한다. 완료 뒤에도 상태를 다시 확인한다.
        firstResume=Promise.resolve(ctx.resume());
      }catch(error){ firstResume=Promise.reject(error); }
    }
    const suspendSettled=__backgroundSuspendPromise
      ? __backgroundSuspendPromise.catch(()=>{}) : Promise.resolve();
    /* 되살리는 동안은 컨텍스트가 잠깐 suspended가 된다. 그 틈에 아래 완료 검사가
       끼어들면 우리가 일부러 재운 것을 두고 실패를 선언하고, 실패 처리가 방금 건
       재생을 도로 멈춘다 — 잠금화면의 재생 단추가 안 눌리는 것처럼 보이던 것이
       그것이다. 기록으로도 6ms 차이였다: resume-failed가 35ms, engine:kicked가 41ms. */
    const contextReady=Promise.all([suspendSettled,enginePrimed,firstResume.catch(()=>{})]).then(()=>{
      if(ctx!==audioCtx) throw new Error('AudioContextChanged');
      return ctx.state==='running' ? ctx : ctx.resume();
    });
    try{
      // 긴 잠금 뒤에는 iOS가 오디오 엔진을 되살리는 데 시간이 더 걸릴 수 있다.
      // 실제 엔진이 열린 뒤에만 첫 박부터 스케줄러와 애니메이션을 함께 연다.
      let resumeReady=contextReady;
      if(__backgroundUsesStream) resumeReady=Promise.all([contextReady,mediaReady]);
      else mediaReady.catch(()=>{});
      await withTimeout(resumeReady,4500);
      if(audio!==__backgroundAudio || !hasBackgroundTransportPlaying()) return;
      if(resumeSequence!==__backgroundResumeSequence) return;
      if(__backgroundUsesStream && audio.paused) throw new Error('BackgroundAudioNotPlaying');
      if(ctx!==audioCtx || ctx.state!=='running') throw new Error('AudioContextNotRunning');
      __backgroundMediaPaused=false;
      __backgroundMediaArmed=!audio.paused;
      setBackgroundTransportsPaused(false);
      // 액션은 play() 전에 설치했으므로 여기서는 표시 상태와 메타데이터만 맞춘다.
      configureBackgroundMediaSession(activeBackgroundLabel(),__backgroundUsesStream);
      recordAudioDiagnostic('transport:resume-ready');
    }catch(error){
      if(audio!==__backgroundAudio || !hasBackgroundTransportPlaying()) return;
      // 이미 더 최신 play/pause 요청이 있다면 이 실패는 과거 작업의 결과다.
      // 현재 오디오를 다시 멈추거나 잠금화면 상태를 덮어쓰면 안 된다.
      if(resumeSequence!==__backgroundResumeSequence){
        recordAudioDiagnostic('transport:resume-obsolete');
        return;
      }
      // 한 번의 늦은 복구로 기능 자체를 종료하지 않는다. 일시정지 상태를 보존해
      // 잠금화면의 재생 버튼을 다시 누르거나 화면을 열어 재시도할 수 있게 한다.
      __backgroundMediaPaused=true;
      __backgroundMediaArmed=false;
      setBackgroundTransportsPaused(true);
      __stoppingBackgroundMedia=true;
      try{ audio.pause(); }catch(e){}
      __stoppingBackgroundMedia=false;
      try{ if(navigator.mediaSession) navigator.mediaSession.playbackState='paused'; }catch(e){}
      recordAudioDiagnostic('transport:resume-failed',{
        ms:Date.now()-startedAt,
        error:String(error&&error.message||error&&error.name||error).slice(0,80),
      });
      throw error;
    }
  })();
  const wrapped=task.finally(()=>{
    if(__backgroundResumePromise===wrapped) __backgroundResumePromise=null;
  });
  __backgroundResumePromise=wrapped;
  return wrapped;
}

function isBackgroundMediaPaused(){ return __backgroundMediaPaused; }

function stopBackgroundMedia(){
  recordAudioDiagnostic('media-element:stop');
  __keepAlivePlayPending=false;
  __keepAliveRestored=false;
  __backgroundMediaPaused=false;
  __backgroundResumeSequence++;
  __backgroundResumePromise=null;
  __backgroundMediaActionMode='';
  detachBackgroundStream();
  if(__backgroundAudio){
    const audio=__backgroundAudio;
    __stoppingBackgroundMedia=true;
    __backgroundMediaArmed=false;
    try{ audio.pause(); }catch(e){}
    try{ audio.currentTime=0; }catch(e){}
    try{ audio.srcObject=null; }catch(e){}
    try{ audio.remove(); }catch(e){}
    __backgroundAudio=null;
    __stoppingBackgroundMedia=false;
  }
  if(__backgroundAudioUrl){
    try{ URL.revokeObjectURL(__backgroundAudioUrl); }catch(e){}
    __backgroundAudioUrl='';
  }
  try{
    if(navigator.mediaSession && !__externalMediaSessionOwner){
      navigator.mediaSession.playbackState='none';
      if(typeof navigator.mediaSession.setActionHandler==='function'){
        for(const action of ['play','pause','stop','seekbackward','seekforward',
                              'previoustrack','nexttrack']){
          try{ navigator.mediaSession.setActionHandler(action,null); }catch(e){}
        }
      }
    }
  }catch(e){}
}

/* 컨텍스트를 통째로 버린다. 여기에 매달려 있던 것들도 같이 놓아야
   다음에 만들 때 새 컨텍스트의 노드로 다시 세워진다. */
const CLOSE_FADE=0.02;
function releaseCtx(){
  stopBackgroundMedia();
  if(!audioCtx) return Promise.resolve();
  const old = audioCtx;
  /* 소리가 나던 중에 close()하면 파형이 한가운데서 잘려 '툭' 소리가 난다. 20ms만
     줄이고 닫는다 — 들리지 않을 만큼 짧고, 클릭은 지울 만큼 길다. audioCtx는 먼저
     비우므로 다음 재생은 기다리지 않고 새 컨텍스트를 만든다. */
  let fade=0;
  try{
    if(old.state==='running'){
      const out=getAppOutput(old);
      const now=old.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(0.0001,out.gain.value||1),now);
      out.gain.exponentialRampToValueAtTime(0.0001,now+CLOSE_FADE);
      fade=CLOSE_FADE;
    }
  }catch(e){}
  audioCtx = null; __ctxMode = null; __ctxResumePromise = null; __backgroundSuspendPromise = null;
  __appOutput = null; __appOutputCtx = null;
  __appMeter = null; __appMeterCtx = null;
  __master = null; __send = null; __gtrCache.clear();
  const shut=()=>{
    try{
      const closing=old.close();
      return closing && typeof closing.catch==='function' ? closing.catch(()=>{}) : Promise.resolve();
    }catch(e){ return Promise.resolve(); }
  };
  if(!fade) return shut();
  return new Promise(resolve=>setTimeout(()=>resolve(shut()),Math.round(fade*1000)+6));
}

function createCtx(mode='ambient'){
  setAudioSession(mode);
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx) throw new Error('WebAudioUnavailable');
  // 메트로놈과 잼은 사용자의 탭에 즉시 반응해야 하는 실시간 도구다. 잠금 중
  // 연속성은 미리 예약하는 스케줄러가 담당하므로, 큰 버퍼를 요청하는 playback
  // 힌트 대신 모든 모드에서 저지연 interactive 힌트를 쓴다.
  const latencyHint='interactive';
  const ctx=new Ctx({latencyHint});
  audioCtx=ctx; __ctxMode=mode; __ctxResumePromise=null;
  recordAudioDiagnostic('audio-context:created',{mode,latencyHint});
  ctx.addEventListener('statechange', ()=>{
    recordAudioDiagnostic('audio-context:'+ctx.state,{mode:__ctxMode||mode});
    if(ctx!==audioCtx || !anySounding()) return;
    const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
    if(recording &&
       (ctx.state==='interrupted' || ctx.state==='closed' || ctx.state==='suspended')){
      // 녹음 파일은 원본 마이크 스트림에서 계속 받는다. 잠금 중 화면용
      // AudioContext가 쉬더라도 녹음 transport까지 함께 종료하지 않는다.
      if(ctx.state!=='closed' && !__backgroundMediaPaused && hasBackgroundTransportPlaying()){
        resumeCtx(ctx).catch(()=>{});
      }
      return;
    }
    if(__backgroundMediaPaused &&
       (ctx.state==='interrupted' || ctx.state==='suspended')) return;
    if((ctx.state==='interrupted' || ctx.state==='suspended' || ctx.state==='closed') &&
       __ctxMode==='playback' &&
       (hasBackgroundTransportPlaying() || hasHiddenSafeTransportPlaying())){
      // 네이티브 오디오 요소는 컨텍스트가 쉬어도 잠금 재생을 이어갈 수 있다.
      // Web Audio 경로는 같은 컨텍스트의 재개만 시도하고, 실패해도 재생 상태를
      // 정리하지 않아 잠금 자체가 정지 버튼처럼 동작하지 않게 한다.
      if(ctx.state!=='closed') resumeCtx(ctx).catch(()=>{});
      return;
    }
    if(ctx.state==='interrupted' || ctx.state==='closed' || ctx.state==='suspended'){
      stopAllTransports();
      releaseCtx();
    }
  });
  return ctx;
}

function resumeCtx(ctx){
  if(ctx.state==='running') return Promise.resolve(ctx);
  if(__ctxResumePromise && audioCtx===ctx) return __ctxResumePromise;
  /* iOS는 사용자 제스처가 살아 있는 동안 부른 resume()만 받아 준다. 마이크로태스크로
     한 번만 미뤄도 그 자격을 잃고, 그때 WebKit이 돌려준 프라미스는 끝나지 않는 채로 남는다.
     그러면 아래 __ctxResumePromise가 영영 비워지지 않아 getCtx()가 다음 탭부터 resume()
     자체를 건너뛴다. 놓치는 것이 첫 소리 하나가 아니라 그 뒤 모든 소리가 된다 —
     튜너의 현 음과 잼의 코드 미리 듣기가 통째로 묵음이 되던 까닭이다.
     제스처 안에서 곧바로 부르고, 끝나지 않는 시도에는 시한을 두어 다음 탭에 길을 내준다. */
  let started;
  try{ started=Promise.resolve(ctx.resume()); }
  catch(error){ started=Promise.reject(error); }
  const resume=started.then(()=>{
    if(ctx!==audioCtx || ctx.state!=='running') throw new Error('AudioContextNotRunning');
    return ctx;
  });
  const gate=withTimeout(resume,1500).finally(()=>{
    if(__ctxResumePromise===gate) __ctxResumePromise=null;
  });
  __ctxResumePromise=gate;
  return gate;
}

function withTimeout(promise, ms){
  let timer=0;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('AudioContextTimeout')),ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

/* 재생 버튼에서만 쓰는 확정 경로. resume()이 실제로 끝날 때까지 기다리고,
   iOS가 interrupted/suspended에 묶어두면 새 컨텍스트로 한 번 복구한다. */
function ensureCtx(mode='ambient', forceFresh=false){
  const previous=__ctxReadyPromise || Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    const unusable=!audioCtx || audioCtx.state==='closed' || audioCtx.state==='interrupted';
    if(forceFresh || unusable || __ctxMode!==mode){
      await releaseCtx();
      createCtx(mode);
    }else{
      setAudioSession(mode);
    }
    let ctx=audioCtx;
    try{
      await withTimeout(resumeCtx(ctx),1400);
    }catch(firstError){
      await releaseCtx();
      ctx=createCtx(mode);
      await withTimeout(resumeCtx(ctx),1400);
    }
    if(ctx!==audioCtx || ctx.state!=='running') throw new Error('AudioContextNotRunning');
    return ctx;
  });
  __ctxReadyPromise=task;
  return task.finally(()=>{
    if(__ctxReadyPromise===task) __ctxReadyPromise=null;
  });
}

/* 녹음 중에는 같은 play-and-record 컨텍스트에서 반주도 재생한다.
   컨텍스트를 갈아 끼우지 않아야 이미 울리는 메트로놈·잼이 끊기지 않는다. */
function ensureRecordingCtx(preservePlayback=false){
  const reusable=preservePlayback && audioCtx &&
    audioCtx.state!=='closed' && audioCtx.state!=='interrupted';
  if(!reusable) return ensureCtx('play-and-record',true);
  setAudioSession('play-and-record');
  __ctxMode='play-and-record';
  const ctx=audioCtx;
  return withTimeout(resumeCtx(ctx),1400).then(()=>{
    if(ctx!==audioCtx || ctx.state!=='running') throw new Error('AudioContextNotRunning');
    return ctx;
  });
}

/* 청음·리듬처럼 짧은 연습음을 새로 시작할 때, 잠금화면에서 멈춰 둔
   재생기는 더 이상 출력 대상이 아니다. 재생 중인 메트로놈·잼은 유지하지만
   일시정지된 백그라운드 재생과 저장된 녹음 재생 세션은 먼저 정리한다. */
function prepareForegroundPlaybackMode(){
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  if(__backgroundMediaPaused && hasBackgroundTransportPlaying()){
    recordAudioDiagnostic('foreground:replace-paused-background');
    stopBackgroundTransports();
  }
  if(!recording && window.OliveRecorder &&
     typeof window.OliveRecorder.stopPlayback==='function'){
    window.OliveRecorder.stopPlayback();
  }
  /* 연습 링크의 YouTube 플레이어도 저장 녹음 재생과 같은 취급이다.
     녹음 중에는 반주로 쓸 수 있으므로 건드리지 않는다. */
  if(!recording && window.OlivePracticeLinks &&
     typeof window.OlivePracticeLinks.stopPlayback==='function'){
    window.OlivePracticeLinks.stopPlayback();
  }
  return recording?'play-and-record':hasBackgroundTransportPlaying()?'playback':'ambient';
}

function beginForegroundPlaybackFromGesture(){
  return beginPlaybackFromGesture(prepareForegroundPlaybackMode());
}

function ensurePlaybackCtx(){
  return ensureCtx(prepareForegroundPlaybackMode());
}

/* 메트로놈과 잼은 잠금 화면에서도 이어져야 한다. 녹음 중이면 공유 중인
   play-and-record 컨텍스트를 보존하고, 그 밖에는 playback 세션을 쓴다. */
function ensureBackgroundPlaybackCtx(label){
  stopCompetingBackgroundTransports(label);
  stopOtherClickSources(label);
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  if(__backgroundMediaPaused){
    __backgroundMediaPaused=false;
    setBackgroundTransportsPaused(false);
  }
  if(!recording) stopForegroundTransports();
  const playback=beginPlaybackFromGesture();
  // 미디어 요소는 사용자 터치가 유효한 이 호출 스택에서 시작하되,
  // 보조 경로가 늦어져도 첫 박을 기다리게 하지는 않는다.
  startBackgroundMedia(label,playback.ctx).catch(()=>{});
  return playback.ready.then(()=>playback.ctx);
}

/* 파일 재생 탭에서 동기적으로 호출한다. resume()을 사용자 제스처 안에서
   바로 시작하고, 파일 다운로드와 디코딩은 활성화된 컨텍스트에서 이어간다. */
function beginPlaybackFromGesture(preferredMode='playback'){
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  const mode=recording?'play-and-record':preferredMode;
  const unusable=!audioCtx || audioCtx.state==='closed' || audioCtx.state==='interrupted';
  if(unusable){
    if(audioCtx) releaseCtx();
    createCtx(mode);
  }else{
    setAudioSession(mode);
    __ctxMode=mode;
  }
  const ctx=audioCtx;
  recordAudioDiagnostic('playback:gesture',{mode,reused:!unusable});
  let ready;
  try{
    ready=ctx.state==='running' ? Promise.resolve(ctx) : Promise.resolve(ctx.resume()).then(()=>{
      if(ctx!==audioCtx || ctx.state!=='running') throw new Error('AudioContextNotRunning');
      return ctx;
    });
  }catch(error){
    ready=Promise.reject(error);
  }
  return {ctx,ready:withTimeout(ready,1400)};
}

function getCtx(){
  if(!audioCtx || audioCtx.state==='closed' || audioCtx.state==='interrupted'){
    if(audioCtx) releaseCtx();
    createCtx('ambient');
  }
  if(audioCtx.state!=='running' && !__ctxResumePromise) resumeCtx(audioCtx).catch(()=>{});
  return audioCtx;
}

/* 도움말이 투어를 마칠 때 소리를 뚝 끊지 않고 천천히 줄인다. 앱의 마스터 출력을
   그대로 쓰므로 스피커로 나가든 잠금화면 스트림으로 나가든 함께 줄어든다.
   다 줄인 뒤에는 반드시 restore()로 되돌려야 다음 재생이 묵음이 되지 않는다. */
function fadeAppOutputTo(target,seconds){
  try{
    if(!audioCtx || audioCtx.state==='closed') return 0;
    const out=getAppOutput(audioCtx);
    const span=Math.max(.05,Number(seconds)||0);
    const now=audioCtx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(Math.max(.0001,out.gain.value||1),now);
    out.gain.linearRampToValueAtTime(Math.max(.0001,target),now+span);
    return span;
  }catch(e){ return 0; }
}
window.OliveAudioFade=Object.freeze({
  out(seconds){ return fadeAppOutputTo(.0001,seconds); },
  restore(){
    try{
      if(!audioCtx || audioCtx.state==='closed') return;
      const out=getAppOutput(audioCtx);
      const now=audioCtx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(1,now);
    }catch(e){}
  },
});

/* ===== 소리 나는 동안 화면 켜 두기 ===== */
let __wakeLock = null;
async function keepAwake(on){
  try{
    if(on){
      if(!__wakeLock && navigator.wakeLock){
        __wakeLock = await navigator.wakeLock.request('screen');
        __wakeLock.addEventListener('release', ()=>{ __wakeLock = null; });
      }
    }else if(__wakeLock){
      const lock=__wakeLock; __wakeLock=null; await lock.release();
    }
  }catch(e){ __wakeLock=null; }
}

/* ===== 소리 나는 탭과 재생 기능 관리 ===== */
const __sounding = {};

/* 연습 기록이 '지금 무엇이 울리는가'를 받아 가는 자리. 연습 시간은 화면을
   켜 둔 시간이 아니라 실제로 소리가 난 시간으로 세야 믿을 수 있는 숫자가 된다. */
const __soundingListeners = [];
function onSoundingChange(listener){ __soundingListeners.push(listener); }
function notifySounding(tab,key,on){
  __soundingListeners.forEach(listener=>{ try{ listener(tab,key,on); }catch(error){} });
}
function pulseTab(tab){
  const btn=document.querySelector('.tab-btn[data-tab="'+tab+'"]');
  if(!btn || !btn.classList.contains('sounding')) return;
  btn.classList.remove('beat');
  void getComputedStyle(btn,'::after').animationName;
  btn.classList.add('beat');
}

function anySounding(){
  return Object.keys(__sounding).some(key=>__sounding[key].size>0);
}

const __transports=[];
function registerTransport(transport){ __transports.push(transport); }
function hasBackgroundTransportPlaying(){
  return __transports.some(transport=>{
    try{ return Boolean(transport.background && transport.isPlaying()); }
    catch(e){ return false; }
  });
}
function activeBackgroundLabel(){
  const active=activeBackgroundTransport();
  return active ? active.label : '';
}
function activeBackgroundTransport(){
  const active=__transports.filter(transport=>{
    try{ return Boolean(transport.background && transport.isPlaying()); }
    catch(e){ return false; }
  });
  return active.length ? active[active.length-1] : null;
}
function updateBackgroundMediaMetadata(fallbackLabel=''){
  try{
    if(!navigator.mediaSession || typeof MediaMetadata!=='function') return;
    const transport=activeBackgroundTransport();
    if(!transport && !fallbackLabel) return;
    const label=(transport && transport.label) || fallbackLabel || '연습 재생';
    const rawTempo=transport && typeof transport.getTempo==='function'
      ? Number(transport.getTempo()) : NaN;
    const title=Number.isFinite(rawTempo) ? `${label} · ${Math.round(rawTempo)} BPM` : label;
    navigator.mediaSession.metadata=new MediaMetadata({
      title, artist:"O'live", album:'음악 연습',
    });
  }catch(e){}
}
function adjustBackgroundTempo(direction,details){
  const transport=activeBackgroundTransport();
  if(!transport || typeof transport.adjustTempo!=='function'){
    recordAudioDiagnostic('tempo:ignored',{direction});
    return;
  }
  const requested=Number(details && details.seekOffset);
  const step=Number.isFinite(requested) && requested>0 ? Math.max(1,Math.round(requested)) : 10;
  const before=typeof transport.getTempo==='function' ? Number(transport.getTempo()) : null;
  recordAudioDiagnostic('tempo:request',{direction,step,before});
  try{
    transport.adjustTempo(direction<0 ? -step : step);
    const after=typeof transport.getTempo==='function' ? Number(transport.getTempo()) : null;
    recordAudioDiagnostic('tempo:applied',{direction,step,before,after});
  }catch(e){
    recordAudioDiagnostic('tempo:failed',{
      direction,step,before,error:String(e&&e.name||e&&e.message||e).slice(0,80),
    });
  }
}
function stopAllTransports(){
  __transports.forEach(transport=>{
    try{ if(transport.isPlaying()) transport.stop(); }catch(e){}
  });
}
function stopForegroundTransports(){
  __transports.forEach(transport=>{
    try{ if(!transport.background && transport.isPlaying()) transport.stop(); }catch(e){}
  });
}
function transportKeepsWhenHidden(transport){
  try{
    return Boolean(typeof transport.keepWhenHidden==='function'
      ? transport.keepWhenHidden()
      : transport.keepWhenHidden);
  }catch(e){ return false; }
}
function stopHiddenUnsafeTransports(){
  __transports.forEach(transport=>{
    try{
      if(!transport.background && !transportKeepsWhenHidden(transport) && transport.isPlaying()) transport.stop();
    }catch(e){}
  });
}
function hasHiddenSafeTransportPlaying(){
  return __transports.some(transport=>{
    try{ return Boolean(transportKeepsWhenHidden(transport) && transport.isPlaying()); }
    catch(e){ return false; }
  });
}
/* 잠금화면까지 가지는 않지만 무음 스위치에 묻히면 안 되는 재생이 있다.
   YouTube 연습 링크가 그렇다. 화면이 숨으면 함께 멈추되, 소리가 나는 동안은
   세션을 playback으로 올려 둔다. ambient로 두면 iPhone 무음 모드에서 묵음이 된다. */
function hasPlaybackSessionTransportPlaying(){
  return __transports.some(transport=>{
    try{
      return Boolean((transportKeepsWhenHidden(transport) || transport.playbackSession)
        && transport.isPlaying());
    }catch(e){ return false; }
  });
}
function stopBackgroundTransports(){
  __transports.forEach(transport=>{
    try{ if(transport.background && transport.isPlaying()) transport.stop(); }catch(e){}
  });
}
/* 박을 치는 기능은 한 번에 하나만 울린다. 메트로놈·잼·리듬이 저마다 클릭을
   내므로 둘이 겹치면 서로 다른 빠르기의 클릭이 포개져 아무 도움이 안 된다.
   녹음 중이라도 마찬가지다 — 오히려 그때 제일 헷갈린다. */
function stopOtherClickSources(label){
  __transports.forEach(transport=>{
    try{
      if(transport.clicks && transport.label!==label && transport.isPlaying()) transport.stop();
    }catch(e){}
  });
}
function stopCompetingBackgroundTransports(label){
  __transports.forEach(transport=>{
    try{
      if(transport.background && transport.label!==label && transport.isPlaying()) transport.stop();
    }catch(e){}
  });
}
function setBackgroundTransportContext(ctx){
  __transports.forEach(transport=>{
    try{
      if(transport.background && transport.isPlaying() &&
         typeof transport.setContext==='function') transport.setContext(ctx);
    }catch(e){}
  });
}

function setTabSounding(tab,on,source){
  const key=source||tab;
  if(!__sounding[tab]) __sounding[tab]=new Set();
  const had=__sounding[tab].has(key);
  on ? __sounding[tab].add(key) : __sounding[tab].delete(key);
  // 같은 상태로 다시 불러도 연습 기록에는 한 번만 알린다.
  if(had!==Boolean(on)) notifySounding(tab,key,Boolean(on));
  const btn=document.querySelector('.tab-btn[data-tab="'+tab+'"]');
  if(btn) btn.classList.toggle('sounding',__sounding[tab].size>0);
  keepAwake(anySounding());
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  const hiddenSafe=hasHiddenSafeTransportPlaying();
  /* 세션 종류는 '지금 무엇이 울리는가'로 정한다. 앞 기능이 남기고 간 값을 물려받으면
     청음을 하다 트랙으로 넘어갔을 때 ambient가 남아 YouTube가 묵음이 된다. */
  const wantsPlayback=hasPlaybackSessionTransportPlaying();
  if(hasBackgroundTransportPlaying()){
    if(!recording){
      setAudioSession('playback');
      if(audioCtx && audioCtx.state!=='closed') __ctxMode='playback';
    }
    startBackgroundMedia(activeBackgroundLabel()).catch(()=>{});
  }else{
    stopBackgroundMedia();
    if(!recording){
      const mode=wantsPlayback?'playback':'ambient';
      setAudioSession(mode);
      if(audioCtx && audioCtx.state!=='closed') __ctxMode=mode;
    }
  }
  if(!anySounding() && !recording && !hiddenSafe){
    setAudioSession('ambient');
    // 잠금 중에는 몇 박을 미리 예약한다. 마지막 재생을 멈출 때 컨텍스트를
    // 닫아 두면 그 예약음도 즉시 취소되어 뒤늦게 틱 소리가 남지 않는다.
    releaseWhenQuiet();
  }
}

/* 한 번 울리고 사라지는 음(청음 문제음·튜너 기준음·지판·잼 미리듣기)은 전송
   등록부에 올라가지 않는다. 그래서 '아무것도 안 울린다'고 보고 바로 닫으면 울리던
   파형이 한가운데서 잘려 '툭' 소리가 났다 — 청음에서 문제가 나는 중에 '다시 듣기'를
   누르면 나던 그 소리다. 남은 음이 다 사라진 뒤에 닫는다. */
let __quietTimer=0;
function releaseWhenQuiet(){
  clearTimeout(__quietTimer);
  let left=0;
  try{ left=typeof voicesRinging==='function' ? voicesRinging() : 0; }catch(e){ left=0; }
  if(left<=0){ releaseCtx(); return; }
  __quietTimer=setTimeout(()=>{
    __quietTimer=0;
    /* 기다리는 사이에 뭔가 다시 울리기 시작했으면 닫지 않는다. */
    const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
    if(anySounding() || recording || hasHiddenSafeTransportPlaying()) return;
    releaseWhenQuiet();
  },Math.min(4000,Math.round(left*1000)+60));
}
function cancelQuietRelease(){
  if(__quietTimer){ clearTimeout(__quietTimer); __quietTimer=0; }
}

document.addEventListener('visibilitychange',()=>{
  recordAudioDiagnostic('visibility:'+document.visibilityState);
  if(document.visibilityState==='visible'){
    if(window.OliveRecorder && typeof window.OliveRecorder.resumeAfterVisibility==='function'){
      window.OliveRecorder.resumeAfterVisibility();
    }
    if(__backgroundMediaPaused) return;
    if(hasBackgroundTransportPlaying() && audioCtx){
      const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
      const mode=recording?'play-and-record':'playback';
      setAudioSession(mode);
      __ctxMode=mode;
      // iOS가 세션 연결을 잃었을 때 화면을 연 동작은 안전한 복구 지점이다.
      // 백그라운드 재개 중에는 액션 맵을 고정하고, 포그라운드 복귀 때만 재확인한다.
      __backgroundMediaActionMode='';
      startBackgroundMedia(activeBackgroundLabel()).catch(()=>{});
      if(audioCtx.state!=='running') resumeCtx(audioCtx).catch(()=>{});
    }
    return;
  }
  stopHiddenUnsafeTransports();
  keepAwake(false);
  if(hasBackgroundTransportPlaying()){
    if(__backgroundMediaPaused) return;
    const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
    const mode=recording?'play-and-record':'playback';
    setAudioSession(mode);
    if(audioCtx && audioCtx.state!=='closed'){
      __ctxMode=mode;
      startBackgroundMedia(activeBackgroundLabel()).catch(()=>{});
      if(audioCtx.state!=='running') resumeCtx(audioCtx).catch(()=>{});
    }
    return;
  }
  if(hasHiddenSafeTransportPlaying()){
    const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
    setAudioSession(recording?'play-and-record':'playback');
    return;
  }
  releaseCtx();
});
window.addEventListener('pagehide',()=>{
  stopAllTransports();
  releaseCtx();
});
window.addEventListener('pageshow',event=>{
  if(event.persisted) releaseCtx();
});

/* ===================== 공통 오디오 런타임 ===================== */
let audioCtx = null;
let __ctxMode = null;
let __ctxResumePromise = null;
let __ctxReadyPromise = null;
let __backgroundAudio = null;
let __backgroundAudioUrl = '';
let __stoppingBackgroundMedia = false;
let __backgroundMediaArmed = false;
let __backgroundMediaPaused = false;
let __backgroundSuspendPromise = null;
let __backgroundResumePromise = null;
let __appOutput = null;
let __appOutputCtx = null;
let __backgroundStreamDestination = null;
let __backgroundStreamCtx = null;
let __backgroundUsesStream = false;
let __backgroundMediaActionMode = '';

/* 실제 iPhone 잠금 화면의 원격 명령은 데스크톱 모의 테스트로 재현할 수 없다.
   오디오나 계정 정보 없이 명령 도착 여부와 엔진 상태만 기기 안에 짧게 남겨,
   화면을 연 뒤 원인을 구분할 수 있게 한다. */
const AUDIO_DIAGNOSTICS_KEY='olive-audio-diagnostics-v1';
const AUDIO_DIAGNOSTICS_LIMIT=100;
function readAudioDiagnostics(){
  try{
    if(typeof localStorage==='undefined') return [];
    const stored=JSON.parse(localStorage.getItem(AUDIO_DIAGNOSTICS_KEY)||'[]');
    return Array.isArray(stored) ? stored : [];
  }catch(e){ return []; }
}
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
    mediaPaused:__backgroundMediaPaused,
    mediaArmed:__backgroundMediaArmed,
    stream:__backgroundUsesStream,
    actionMode:__backgroundMediaActionMode||'none',
    transport:transport ? transport.label : 'none',
    tempo,
  };
}
function recordAudioDiagnostic(event,details={}){
  try{
    if(typeof localStorage==='undefined') return;
    const entries=readAudioDiagnostics();
    entries.push(Object.assign({
      at:new Date().toISOString(),
      event:String(event||'unknown'),
    },currentAudioDiagnosticState(),details));
    localStorage.setItem(AUDIO_DIAGNOSTICS_KEY,JSON.stringify(entries.slice(-AUDIO_DIAGNOSTICS_LIMIT)));
  }catch(e){}
}
function clearAudioDiagnostics(){
  try{ if(typeof localStorage!=='undefined') localStorage.removeItem(AUDIO_DIAGNOSTICS_KEY); }catch(e){}
}
function exportAudioDiagnostics(){
  const release=window.OLIVE_RELEASE||{version:'unknown',build:'unknown'};
  return JSON.stringify({
    format:'olive-audio-diagnostics-v1',
    release:{version:release.version,build:release.build},
    device:{
      userAgent:typeof navigator==='undefined' ? '' : navigator.userAgent,
      standalone:typeof navigator!=='undefined' && Boolean(navigator.standalone),
    },
    entries:readAudioDiagnostics(),
  },null,2);
}
window.OliveAudioDiagnostics=Object.freeze({
  read:readAudioDiagnostics,
  clear:clearAudioDiagnostics,
  exportText:exportAudioDiagnostics,
  mark:recordAudioDiagnostic,
});

/* iOS는 오디오 세션에 '용도'를 붙인다.
   ambient : 다른 앱 소리와 섞인다. 음악을 틀어 놓고 메트로놈을 쓸 수 있다.
             잠금화면 위젯도 뜨지 않는다. 대신 무음 스위치를 따른다.
   playback : 잠금 화면에서도 재생할 메트로놈·잼과 녹음 파일에 쓴다.
   play-and-record : 마이크도 같이 쓴다. 튜너나 녹음을 켤 때 이쪽으로 바꾼다. */
function setAudioSession(mode){
  try{ if(navigator.audioSession) navigator.audioSession.type = mode; }catch(e){}
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
    if(!navigator.mediaSession) return;
    updateBackgroundMediaMetadata(label);
    navigator.mediaSession.playbackState=__backgroundMediaPaused?'paused':'playing';
    if(typeof navigator.mediaSession.setActionHandler!=='function') return;
    const actionMode=usesStream?'stream':'fallback';
    if(__backgroundMediaActionMode===actionMode) return;
    if(usesStream){
      // 실제 소리가 <audio>를 통과하므로 iOS의 기본 원격 제어가 가장 빠르다.
      // 일시정지는 시스템에 맡기고, 잠든 오디오를 깨우도록 재생만 보강한다.
      try{ navigator.mediaSession.setActionHandler('play',()=>{
        recordAudioDiagnostic('media-action:play');
        resumeBackgroundPlayback().catch(()=>{});
      }); }catch(e){}
      for(const action of ['pause','stop']){
        try{ navigator.mediaSession.setActionHandler(action,null); }catch(e){}
      }
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
    const audio=new Audio();
    audio.preload='auto';
    audio.playsInline=true;
    audio.hidden=true;
    audio.dataset.oliveBackground='true';
    audio.addEventListener('playing',()=>{
      if(audio!==__backgroundAudio) return;
      recordAudioDiagnostic('media-element:playing');
      // 오래 잠근 뒤에는 <audio>가 먼저 playing이 되어도 AudioContext는 아직
      // suspended일 수 있다. 박자를 먼저 열지 말고 엔진 복구가 끝날 때까지 기다린다.
      if(__backgroundMediaPaused){
        resumeBackgroundPlayback().catch(()=>{});
        return;
      }
      __backgroundMediaArmed=true;
      try{ if(navigator.mediaSession) navigator.mediaSession.playbackState='playing'; }catch(e){}
    });
    // iPhone의 잠금 화면은 Media Session 콜백 대신 실제 <audio>만
    // 일시정지시키는 경우가 있다. 그 이벤트도 앱의 재생 정지로 연결한다.
    audio.addEventListener('pause',()=>{
      if(__stoppingBackgroundMedia || !__backgroundMediaArmed || audio!==__backgroundAudio ||
         !hasBackgroundTransportPlaying()) return;
      recordAudioDiagnostic('media-element:pause');
      __backgroundMediaArmed=false;
      pauseBackgroundPlayback();
    });
    __backgroundAudio=audio;
    if(document.body) document.body.appendChild(audio);
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
  __backgroundMediaArmed=false;
  setBackgroundTransportsPaused(true);
  if(__backgroundAudio && !__backgroundAudio.paused){
    __stoppingBackgroundMedia=true;
    try{ __backgroundAudio.pause(); }catch(e){}
    __stoppingBackgroundMedia=false;
  }
  try{ if(navigator.mediaSession) navigator.mediaSession.playbackState='paused'; }catch(e){}
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
  if(__backgroundResumePromise){
    recordAudioDiagnostic('transport:resume-joined');
    return __backgroundResumePromise;
  }
  if(!__backgroundMediaPaused || !hasBackgroundTransportPlaying()){
    recordAudioDiagnostic('transport:resume-ignored');
    return Promise.resolve();
  }
  recordAudioDiagnostic('transport:resume-start');
  const task=(async()=>{
    const audio=__backgroundAudio;
    if(!audio) throw new Error('BackgroundAudioUnavailable');
    let ctx=audioCtx;
    if(!ctx || ctx.state==='closed' || ctx.state==='interrupted'){
      ctx=replaceDormantBackgroundContext();
      attachBackgroundStream(audio,ctx);
    }
    setAudioSession('playback');
    __ctxMode='playback';
    let mediaReady=Promise.resolve(), firstResume=Promise.resolve();
    try{
      const result=audio.play();
      if(result && typeof result.then==='function') mediaReady=result;
    }catch(error){ mediaReady=Promise.reject(error); }
    try{
      // 구형 경로의 suspend()가 아직 끝나지 않았어도 원격 버튼의 사용자 제스처
      // 안에서 resume()을 먼저 요청한다. 완료 뒤에도 상태를 다시 확인한다.
      firstResume=Promise.resolve(ctx.resume());
    }catch(error){ firstResume=Promise.reject(error); }
    const suspendSettled=__backgroundSuspendPromise
      ? __backgroundSuspendPromise.catch(()=>{}) : Promise.resolve();
    const contextReady=Promise.all([suspendSettled,firstResume.catch(()=>{})]).then(()=>{
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
      if(__backgroundUsesStream && audio.paused) throw new Error('BackgroundAudioNotPlaying');
      if(ctx!==audioCtx || ctx.state!=='running') throw new Error('AudioContextNotRunning');
      __backgroundMediaPaused=false;
      __backgroundMediaArmed=!audio.paused;
      setBackgroundTransportsPaused(false);
      // 지원 명령 목록은 건드리지 않고 표시 상태만 playing으로 맞춘다.
      configureBackgroundMediaSession(activeBackgroundLabel(),__backgroundUsesStream);
      recordAudioDiagnostic('transport:resume-ready');
    }catch(error){
      if(audio!==__backgroundAudio || !hasBackgroundTransportPlaying()) return;
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
        error:String(error&&error.name||error&&error.message||error).slice(0,80),
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
  __backgroundMediaPaused=false;
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
    if(navigator.mediaSession){
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
function releaseCtx(){
  stopBackgroundMedia();
  if(!audioCtx) return Promise.resolve();
  const old = audioCtx;
  audioCtx = null; __ctxMode = null; __ctxResumePromise = null; __backgroundSuspendPromise = null;
  __appOutput = null; __appOutputCtx = null;
  __master = null; __send = null; __gtrCache.clear();
  try{
    const closing=old.close();
    return closing && typeof closing.catch==='function' ? closing.catch(()=>{}) : Promise.resolve();
  }catch(e){ return Promise.resolve(); }
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
    if((ctx.state==='interrupted' || ctx.state==='suspended') &&
       __ctxMode==='playback' && hasBackgroundTransportPlaying()){
      resumeCtx(ctx).catch(()=>{});
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
  const resume=Promise.resolve().then(()=>ctx.resume()).then(()=>{
    if(ctx!==audioCtx || ctx.state!=='running') throw new Error('AudioContextNotRunning');
    return ctx;
  });
  __ctxResumePromise=resume.finally(()=>{
    if(audioCtx===ctx) __ctxResumePromise=null;
  });
  return __ctxResumePromise;
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

function ensurePlaybackCtx(){
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  const background=hasBackgroundTransportPlaying();
  // 녹음 파일 재생은 iPhone의 playback 세션을 사용한다. 메트로놈·잼처럼
  // ambient 세션으로 돌아가는 도구가 시작되면 파일 재생 상태도 먼저 정리해야
  // 닫힌 오디오 연결 위에 재생 버튼만 남지 않는다. 실제 녹음은 건드리지 않는다.
  if(!recording && __ctxMode==='playback' && window.OliveRecorder &&
     typeof window.OliveRecorder.stopPlayback==='function'){
    window.OliveRecorder.stopPlayback();
    if(audioCtx && audioCtx.state!=='closed'){
      setAudioSession(background?'playback':'ambient');
      __ctxMode=background?'playback':'ambient';
    }
  }
  return ensureCtx(recording?'play-and-record':background?'playback':'ambient');
}

/* 메트로놈과 잼은 잠금 화면에서도 이어져야 한다. 녹음 중이면 공유 중인
   play-and-record 컨텍스트를 보존하고, 그 밖에는 playback 세션을 쓴다. */
function ensureBackgroundPlaybackCtx(label){
  stopCompetingBackgroundTransports(label);
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
function beginPlaybackFromGesture(){
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  const mode=recording?'play-and-record':'playback';
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
function stopBackgroundTransports(){
  __transports.forEach(transport=>{
    try{ if(transport.background && transport.isPlaying()) transport.stop(); }catch(e){}
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
  on ? __sounding[tab].add(key) : __sounding[tab].delete(key);
  const btn=document.querySelector('.tab-btn[data-tab="'+tab+'"]');
  if(btn) btn.classList.toggle('sounding',__sounding[tab].size>0);
  keepAwake(anySounding());
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  if(hasBackgroundTransportPlaying()){
    if(!recording){
      setAudioSession('playback');
      if(audioCtx && audioCtx.state!=='closed') __ctxMode='playback';
    }
    startBackgroundMedia(activeBackgroundLabel()).catch(()=>{});
  }else{
    stopBackgroundMedia();
    if(!recording){
      setAudioSession('ambient');
      if(audioCtx && audioCtx.state!=='closed') __ctxMode='ambient';
    }
  }
  if(!anySounding() && !recording){
    setAudioSession('ambient');
    // 잠금 중에는 몇 박을 미리 예약한다. 마지막 재생을 멈출 때 컨텍스트를
    // 닫아 두면 그 예약음도 즉시 취소되어 뒤늦게 틱 소리가 남지 않는다.
    releaseCtx();
  }
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

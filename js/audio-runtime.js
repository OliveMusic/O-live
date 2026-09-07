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
let __appOutput = null;
let __appOutputCtx = null;
let __backgroundStreamDestination = null;
let __backgroundStreamCtx = null;
let __backgroundUsesStream = false;

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

async function startBackgroundMedia(label,preparedCtx){
  if(typeof Audio!=='function' || typeof URL==='undefined' || typeof Blob==='undefined') return;
  if(!__backgroundAudio){
    const audio=new Audio();
    audio.preload='auto';
    audio.playsInline=true;
    audio.hidden=true;
    audio.dataset.oliveBackground='true';
    audio.addEventListener('playing',()=>{
      if(audio===__backgroundAudio){
        __backgroundMediaArmed=true;
        if(__backgroundMediaPaused){
          __backgroundMediaPaused=false;
          setBackgroundTransportsPaused(false);
          if(audioCtx && audioCtx.state!=='running') resumeCtx(audioCtx).catch(()=>{});
        }
        try{ if(navigator.mediaSession) navigator.mediaSession.playbackState='playing'; }catch(e){}
      }
    });
    // iPhone의 잠금 화면은 Media Session 콜백 대신 실제 <audio>만
    // 일시정지시키는 경우가 있다. 그 이벤트도 앱의 재생 정지로 연결한다.
    audio.addEventListener('pause',()=>{
      if(__stoppingBackgroundMedia || !__backgroundMediaArmed || audio!==__backgroundAudio ||
         !hasBackgroundTransportPlaying()) return;
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
  try{
    if(navigator.mediaSession){
      if(typeof MediaMetadata==='function'){
        navigator.mediaSession.metadata=new MediaMetadata({
          title:label||'연습 재생', artist:"O'live", album:'음악 연습',
        });
      }
      navigator.mediaSession.playbackState=__backgroundMediaPaused?'paused':'playing';
      if(typeof navigator.mediaSession.setActionHandler==='function'){
        if(usesStream){
          // 실제 소리가 <audio>를 통과하므로 iOS의 기본 원격 제어가 가장 빠르다.
          // 웹 프로세스가 잠든 동안에도 시스템이 미디어 요소를 직접 멈추고 재생한다.
          for(const action of ['play','pause','stop']){
            try{ navigator.mediaSession.setActionHandler(action,null); }catch(e){}
          }
        }else{
          try{ navigator.mediaSession.setActionHandler('play',()=>{
            resumeBackgroundPlayback().catch(()=>{});
          }); }catch(e){}
          try{ navigator.mediaSession.setActionHandler('pause',pauseBackgroundPlayback); }catch(e){}
          try{ navigator.mediaSession.setActionHandler('stop',stopBackgroundTransports); }catch(e){}
        }
      }
    }
  }catch(e){}
  if(__backgroundMediaPaused) return;
  try{
    const result=__backgroundAudio.play();
    if(result && typeof result.then==='function') await withTimeout(result,1400);
    if(__backgroundAudio && !__backgroundAudio.paused) __backgroundMediaArmed=true;
  }catch(e){ /* playback 오디오 세션만으로 이어갈 수 있으므로 실제 재생은 막지 않는다. */ }
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
  if(__backgroundMediaPaused || !hasBackgroundTransportPlaying()) return;
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
}

async function resumeBackgroundPlayback(){
  if(!__backgroundMediaPaused || !hasBackgroundTransportPlaying()) return;
  const audio=__backgroundAudio;
  const ctx=audioCtx;
  if(!audio || !ctx || ctx.state==='closed'){
    stopBackgroundTransports();
    return;
  }
  __backgroundMediaPaused=false;
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
    // MediaStream 경로는 실제 <audio>를, 구형 경로는 Web Audio 시계까지 연다.
    // 보조 재생 Promise만 늦게 거절되어도 이미 재개된 박자를 다시 끊지 않는다.
    mediaReady.catch(()=>{});
    await withTimeout(contextReady,1400);
    if(ctx!==audioCtx || ctx.state!=='running') throw new Error('AudioContextNotRunning');
    __backgroundMediaArmed=!audio.paused;
    try{ if(navigator.mediaSession) navigator.mediaSession.playbackState='playing'; }catch(e){}
    setBackgroundTransportsPaused(false);
  }catch(error){
    __backgroundMediaPaused=true;
    setBackgroundTransportsPaused(true);
    stopBackgroundTransports();
  }
}

function isBackgroundMediaPaused(){ return __backgroundMediaPaused; }

function stopBackgroundMedia(){
  __backgroundMediaPaused=false;
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
        for(const action of ['play','pause','stop']){
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
  // 메트로놈·잼·녹음 재생은 작은 지연보다 끊김 없는 연속 출력이 중요하다.
  // 특히 iPhone의 잠금 화면·Bluetooth 경로를 거칠 때 너무 작은 버퍼를
  // 요구하지 않도록 playback 힌트를 사용한다. 튜너·녹음 입력은 그대로
  // interactive를 써서 반응성을 유지한다.
  const latencyHint=mode==='playback' ? 'playback' : 'interactive';
  const ctx=new Ctx({latencyHint});
  audioCtx=ctx; __ctxMode=mode; __ctxResumePromise=null;
  ctx.addEventListener('statechange', ()=>{
    if(ctx!==audioCtx || !anySounding()) return;
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
  const active=__transports.filter(transport=>{
    try{ return Boolean(transport.background && transport.isPlaying()); }
    catch(e){ return false; }
  });
  return active.length ? active[active.length-1].label : '';
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
function stopBackgroundTransports(){
  __transports.forEach(transport=>{
    try{ if(transport.background && transport.isPlaying()) transport.stop(); }catch(e){}
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
  if(document.visibilityState==='visible'){
    if(__backgroundMediaPaused) return;
    if(hasBackgroundTransportPlaying() && audioCtx){
      setAudioSession('playback');
      __ctxMode='playback';
      startBackgroundMedia(activeBackgroundLabel()).catch(()=>{});
      if(audioCtx.state!=='running') resumeCtx(audioCtx).catch(()=>{});
    }
    return;
  }
  stopForegroundTransports();
  keepAwake(false);
  if(hasBackgroundTransportPlaying()){
    if(__backgroundMediaPaused) return;
    setAudioSession('playback');
    if(audioCtx && audioCtx.state!=='closed'){
      __ctxMode='playback';
      startBackgroundMedia(activeBackgroundLabel()).catch(()=>{});
      if(audioCtx.state!=='running') resumeCtx(audioCtx).catch(()=>{});
    }
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

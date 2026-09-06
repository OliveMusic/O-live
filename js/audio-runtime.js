/* ===================== 공통 오디오 런타임 ===================== */
let audioCtx = null;
let __ctxMode = null;
let __ctxResumePromise = null;
let __ctxReadyPromise = null;

/* iOS는 오디오 세션에 '용도'를 붙인다.
   ambient : 다른 앱 소리와 섞인다. 음악을 틀어 놓고 메트로놈을 쓸 수 있다.
             잠금화면 위젯도 뜨지 않는다. 대신 무음 스위치를 따른다.
   play-and-record : 마이크도 같이 쓴다. 튜너나 녹음을 켤 때 이쪽으로 바꾼다. */
function setAudioSession(mode){
  try{ if(navigator.audioSession) navigator.audioSession.type = mode; }catch(e){}
}

/* 컨텍스트를 통째로 버린다. 여기에 매달려 있던 것들도 같이 놓아야
   다음에 만들 때 새 컨텍스트의 노드로 다시 세워진다. */
function releaseCtx(){
  if(!audioCtx) return Promise.resolve();
  const old = audioCtx;
  audioCtx = null; __ctxMode = null; __ctxResumePromise = null;
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
  const ctx=new Ctx({latencyHint:'interactive'});
  audioCtx=ctx; __ctxMode=mode; __ctxResumePromise=null;
  ctx.addEventListener('statechange', ()=>{
    if(ctx!==audioCtx || !anySounding()) return;
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
  return ensureCtx(recording?'play-and-record':'ambient');
}

/* 파일 재생 탭에서 동기적으로 호출한다. resume()을 사용자 제스처 안에서
   바로 시작하고, 파일 다운로드와 디코딩은 활성화된 컨텍스트에서 이어간다. */
function beginPlaybackFromGesture(){
  const recording=Boolean(window.OliveRecorder && window.OliveRecorder.isRecording());
  const mode=recording?'play-and-record':'ambient';
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
function stopAllTransports(){
  __transports.forEach(transport=>{
    try{ if(transport.isPlaying()) transport.stop(); }catch(e){}
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
  if(!anySounding() && !recording){
    setAudioSession('ambient');
    if(audioCtx && audioCtx.state!=='closed') __ctxMode='ambient';
  }
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') return;
  stopAllTransports();
  keepAwake(false);
  releaseCtx();
});
window.addEventListener('pagehide',()=>{
  stopAllTransports();
  releaseCtx();
});
window.addEventListener('pageshow',event=>{
  if(event.persisted) releaseCtx();
});

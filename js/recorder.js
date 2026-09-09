/* ===================== 녹음 =====================
   계정에 연결한 사용자가 마이크 녹음을 확인한 뒤 비공개로 저장한다. */
(function(){
  'use strict';

  const MAX_DURATION_MS=5*60*1000;
  const MAX_RECORDINGS=50;
  const MAX_UPLOAD_BYTES=15*1024*1024;
  const MAX_UPLOAD_DURATION_MS=30*60*1000;
  const WAVEFORM_POINTS=160;
  const WAVEFORM_MAX_POINTS=240;
  const PLAYBACK_RATE_MIN=.5;
  const PLAYBACK_RATE_MAX=1.5;
  const PLAYBACK_RATE_STEP=.05;
  const SOUND_TOUCH_PROCESSOR_URL='./vendor/soundtouch/soundtouch-processor.js?v=195';
  /* 필요한 마이그레이션 번호는 릴리스 계약에서 가져온다.
     문구에 번호를 직접 적으면 스키마를 올릴 때마다 낡는다. */
  const SCHEMA_ERROR_CODE='DB-'+String(
    (window.OLIVE_RELEASE&&window.OLIVE_RELEASE.schemaVersion)||0).padStart(3,'0');
  const MIN_LOOP_SECONDS=.4;
  const TRANSPOSE_MIN=-12;
  const TRANSPOSE_MAX=12;
  const STATE_SAVE_DELAY=1200;
  // 보통 박의 0.40 → 0.0001, 45ms 감쇠 틱을 평균 낸 체감 에너지에 맞춘다.
  const METRONOME_REFERENCE_RMS=.1;
  const PLAYBACK_GAIN_MIN=.5;
  const PLAYBACK_GAIN_MAX=11.2;
  const PLAYBACK_PEAK_HEADROOM=.88;
  const RECORDING_NOISE_FLOOR=.0007;
  const INPUT_ACTIVITY_THRESHOLD=.001;
  const INPUT_ACTIVITY_HOLD_MS=180;
  const recordGuest=document.getElementById('recordGuest');
  const recordWorkspace=document.getElementById('recordWorkspace');
  const recordListCard=document.getElementById('recordListCard');
  const recordConnect=document.getElementById('recordConnect');
  const recordToggle=document.getElementById('recordToggle');
  const recordTimer=document.getElementById('recordTimer');
  const recordState=document.getElementById('recordState');
  const recordStateDot=document.getElementById('recordStateDot');
  const recordTimeProgress=document.getElementById('recordTimeProgress');
  const recordTimeFill=document.getElementById('recordTimeFill');
  const recordLevelRow=document.getElementById('recordLevelRow');
  const recordLevel=document.getElementById('recordLevelFill');
  const recordHint=document.getElementById('recordHint');
  const recordDraft=document.getElementById('recordDraft');
  const recordTitle=document.getElementById('recordTitle');
  const recordDiscard=document.getElementById('recordDiscard');
  const recordSave=document.getElementById('recordSave');
  const recordMessage=document.getElementById('recordMessage');
  const recordUsage=document.getElementById('recordUsage');
  const recordSelect=document.getElementById('recordSelect');
  const recordSelectBar=document.getElementById('recordSelectBar');
  const recordSelectCount=document.getElementById('recordSelectCount');
  const recordSelectDelete=document.getElementById('recordSelectDelete');
  const recordSelectCancel=document.getElementById('recordSelectCancel');
  const menuPin=document.getElementById('recordMenuPin');
  const recordUpload=document.getElementById('recordUpload');
  const recordUploadInput=document.getElementById('recordUploadInput');
  const recordList=document.getElementById('recordList');
  const menuBackdrop=document.getElementById('recordMenuBackdrop');
  const menuTitle=document.getElementById('recordMenuTitle');
  const menuRename=document.getElementById('recordMenuRename');
  const menuDownload=document.getElementById('recordMenuDownload');
  const menuDelete=document.getElementById('recordMenuDelete');
  const app=document.getElementById('app');
  if(!recordToggle || !window.OliveCloud) return;

  const draftAudio=new Audio();
  let cloudFallbackAudio=makeCloudFallbackAudio();
  let cloudNativeAudio=makeCloudNativeAudio();
  const cloudTransportAudio=makeCloudTransportAudio();
  let currentUser=null;
  let sessionUserId='';
  let rows=[];
  let selectedRow=null;
  let menuTrigger=null;
  let stream=null;
  let recorder=null;
  let chunks=[];
  let recording=false;
  let startPending=false;
  let startToken=0;
  let startedAt=0;
  let recordedAt='';
  let timerId=0;
  let levelFrame=0;
  let levelAnalyser=null;
  let levelSource=null;
  let levelSink=null;
  let captureMixer=null;
  let captureDestination=null;
  let recordingStream=null;
  let levelSamples=null;
  let waveformLevels=[];
  let recordingPeak=0;
  let inputActivityLastAt=0;
  let lastWaveformCaptureAt=0;
  let draft=null;
  let draftUrl='';
  let draftDecodedBuffer=null;
  let draftDecodedContext=null;
  let draftSource=null;
  let draftGainNode=null;
  let draftStartedAt=0;
  let draftStartedOffset=0;
  let draftPlayToken=0;
  let expandedRecordingId='';
  let cloudPlayingId='';
  let cloudMediaId='';
  let cloudPlaybackMode='';
  let cloudStartedAt=0;
  let cloudStartedOffset=0;
  let cloudStartedRate=1;
  let cloudDecodedBuffer=null;
  let cloudDecodedContext=null;
  let cloudDecodedId='';
  let cloudDecodedLoad=null;
  let cloudSource=null;
  let cloudGainNode=null;
  let cloudMediaSource=null;
  let cloudMediaGain=null;
  let cloudTransportDestination=null;
  let cloudTransportContext=null;
  let cloudTransportInternalPause=false;
  let cloudTransportArmed=false;
  let cloudTransportPlayPromise=null;
  let cloudTransportPlayGeneration=0;
  let cloudStretchNode=null;
  let cloudMediaUsesPersistentNative=false;
  let cloudNativeInternalPause=false;
  let cloudNativeIgnorePauseUntil=0;
  let cloudMediaSessionActive=false;
  let cloudMediaSessionActionMode='';
  let cloudMediaPositionUpdatedAt=0;
  let cloudPlayToken=0;
  let cloudProgressFrame=0;
  let cloudPositionTimer=0;
  let scrubbingRecordingId='';
  let recordingInterruptedWhileHidden=false;
  const cloudBlobs=new Map();
  const waveformCache=new Map();
  const waveformLoads=new Map();
  const playbackPositions=new Map();
  const playbackRates=new Map();
  const transposes=new Map();
  const loopRegions=new Map();
  const cloudStretchModulePromises=new WeakMap();
  let loadingList=false;
  let selecting=false;
  const selectedIds=new Set();
  let recordingListLoadPromise=null;
  let recordingListLoadUserId='';
  let recordingListLoadToken=0;
  let recordDragDepth=0;

  function makeCloudFallbackAudio(){
    const audio=new Audio();
    audio.addEventListener('ended',finishCloudPlayback);
    // iOS는 src가 준비되는 동안 playbackRate를 기본값으로 되돌리는 경우가 있다.
    // 메타데이터와 실제 재생 시작 시점에도 현재 슬라이더 값을 다시 확정한다.
    audio.addEventListener('loadedmetadata',()=>syncNativePlaybackSettings(audio));
    audio.addEventListener('canplay',()=>syncNativePlaybackSettings(audio));
    audio.addEventListener('playing',()=>syncNativePlaybackSettings(audio));
    return audio;
  }

  /* 저장된 파일의 실제 출력도 메트로놈·잼과 같은 MediaStream 운반자를
     통과시킨다. iOS 잠금화면은 이 요소를 직접 멈추므로, Media Session의
     pause 콜백이 늦거나 누락되어도 소리가 먼저 멈춘다. */
  function makeCloudTransportAudio(){
    const audio=new Audio();
    audio.preload='auto';
    audio.playsInline=true;
    audio.setAttribute('aria-hidden','true');
    audio.style.cssText='position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:.001;pointer-events:none';
    audio.dataset.oliveRecordingTransport='true';
    audio.addEventListener('playing',()=>{
      if(!cloudMediaId) return;
      cloudTransportArmed=true;
      updateCloudMediaSessionState();
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-transport:playing');
    });
    audio.addEventListener('pause',()=>{
      if(cloudTransportInternalPause || !cloudTransportArmed || !cloudPlayingId) return;
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-transport:pause');
      pauseCloudPlayback(true);
    });
    // 화면이 잠겨 requestAnimationFrame이 쉬는 동안에도 네이티브 운반자의
    // 시간 이벤트가 오면 실제 파일 위치를 잠금화면에 다시 알려 준다.
    audio.addEventListener('timeupdate',()=>refreshCloudMediaSessionPosition(750));
    audio.addEventListener('error',()=>{
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-transport:error',{
        code:audio.error&&audio.error.code||null,
      });
    });
    if(document.body) document.body.appendChild(audio);
    return audio;
  }

  /* iPhone에서는 Web Audio에 한 번이라도 연결된 미디어 요소가 재생속도를
     무시하는 WebKit 문제가 남아 있다. 잠금화면과 배속 재생은 Web Audio에
     연결하지 않는 하나의 DOM 오디오 요소가 전담한다. */
  function makeCloudNativeAudio(){
    const audio=new Audio();
    audio.preload='auto';
    audio.playsInline=true;
    // iOS 26 홈 화면 앱은 완전히 숨긴 미디어 요소를 다시 열었을 때 play()가
    // 성공했다고 응답하면서도 소리를 내지 않는 경우가 있다. 화면에는 보이지
    // 않되 렌더 트리에는 남겨, 잠금화면 재생기가 실제 미디어 요소를 유지하게 한다.
    audio.setAttribute('aria-hidden','true');
    audio.style.cssText='position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:.001;pointer-events:none';
    audio.dataset.oliveRecordingPlayback='true';
    audio.addEventListener('ended',()=>{
      if(cloudMediaUsesPersistentNative) finishCloudPlayback();
    });
    audio.addEventListener('loadedmetadata',()=>{
      if(!cloudMediaUsesPersistentNative) return;
      syncNativePlaybackSettings(audio);
      updateCloudMediaSessionPosition();
    });
    audio.addEventListener('canplay',()=>{
      if(cloudMediaUsesPersistentNative) syncNativePlaybackSettings(audio);
    });
    audio.addEventListener('playing',()=>{
      if(!cloudMediaUsesPersistentNative) return;
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media:playing');
      syncNativePlaybackSettings(audio);
      updateCloudMediaSessionState();
    });
    audio.addEventListener('ratechange',()=>{
      if(!cloudMediaUsesPersistentNative || !cloudMediaId) return;
      const row=rows.find(item=>item.id===cloudMediaId);
      if(!row) return;
      const expected=rowPlaybackRate(row);
      if(Math.abs(Number(audio.playbackRate)-expected)>.001){
        Promise.resolve().then(()=>applyNativePlaybackSettings(row,audio));
      }
      updateCloudMediaSessionPosition(row);
    });
    audio.addEventListener('timeupdate',()=>{
      if(cloudMediaUsesPersistentNative) refreshCloudMediaSessionPosition(900);
    });
    audio.addEventListener('pause',()=>{
      if(cloudMediaUsesPersistentNative && !cloudNativeInternalPause &&
         performance.now()>=cloudNativeIgnorePauseUntil){
        handleCloudNativePauseFromSystem();
      }
    });
    audio.addEventListener('error',()=>{
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media:error',{
        code:audio.error&&audio.error.code||null,
        networkState:audio.networkState,
        readyState:audio.readyState,
      });
    });
    if(document.body) document.body.appendChild(audio);
    return audio;
  }

  function replaceCloudNativeAudio(){
    const previous=cloudNativeAudio;
    if(previous){
      cloudNativeInternalPause=true;
      try{ previous.pause(); }catch(error){}
      try{ previous.removeAttribute('src'); previous.remove(); }catch(error){}
      cloudNativeInternalPause=false;
    }
    cloudNativeAudio=makeCloudNativeAudio();
    return cloudNativeAudio;
  }

  function preferPersistentNativePlayback(){
    // iOS 26 홈 화면 앱에서는 직접 재생하는 HTMLAudioElement가 play() 성공과
    // 재생 시간 증가를 보고하면서도 실제 출력은 무음이 되는 회귀가 있다.
    // 기기에서 검증됐던 Web Audio 연결 경로를 사용해 재생 자체를 우선 보장한다.
    return false;
  }

  function resetCloudTransport(){
    cloudTransportPlayGeneration++;
    cloudTransportInternalPause=true;
    try{ cloudTransportAudio.pause(); }catch(error){}
    try{ cloudTransportAudio.srcObject=null; }catch(error){}
    cloudTransportInternalPause=false;
    if(cloudTransportDestination){
      try{ cloudTransportDestination.stream.getTracks().forEach(track=>track.stop()); }catch(error){}
    }
    cloudTransportDestination=null;
    cloudTransportContext=null;
    cloudTransportArmed=false;
    cloudTransportPlayPromise=null;
  }
  function ensureCloudTransport(ctx){
    if(cloudTransportDestination && cloudTransportContext===ctx) return cloudTransportDestination;
    resetCloudTransport();
    if(!ctx || typeof ctx.createMediaStreamDestination!=='function') return null;
    try{
      const destination=makeMono(ctx.createMediaStreamDestination());
      const mediaStream=destination.stream;
      if(!mediaStream || typeof mediaStream.getAudioTracks!=='function' ||
         !mediaStream.getAudioTracks().length) return null;
      cloudTransportDestination=destination;
      cloudTransportContext=ctx;
      cloudTransportInternalPause=true;
      cloudTransportAudio.srcObject=mediaStream;
      cloudTransportInternalPause=false;
      return destination;
    }catch(error){
      cloudTransportInternalPause=false;
      resetCloudTransport();
      return null;
    }
  }
  function armCloudTransport(ctx,row){
    const destination=ensureCloudTransport(ctx);
    if(!destination) return Promise.resolve(false);
    if(cloudTransportPlayPromise){
      configureCloudMediaSession(row);
      return cloudTransportPlayPromise;
    }
    if(cloudTransportArmed){
      configureCloudMediaSession(row);
      return Promise.resolve(true);
    }
    cloudTransportArmed=true;
    configureCloudMediaSession(row);
    const generation=++cloudTransportPlayGeneration;
    const task=Promise.resolve(cloudTransportAudio.play()).then(()=>{
      if(generation!==cloudTransportPlayGeneration) return false;
      cloudTransportArmed=true;
      configureCloudMediaSession(row);
      return true;
    }).catch(error=>{
      if(generation===cloudTransportPlayGeneration) cloudTransportArmed=false;
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-transport:start-failed',{
        error:String(error&&error.name||error&&error.message||error).slice(0,80),
      });
      throw error;
    });
    const tracked=task.finally(()=>{
      if(cloudTransportPlayPromise===tracked) cloudTransportPlayPromise=null;
    });
    cloudTransportPlayPromise=tracked;
    return tracked;
  }
  function cloudOutputDestination(ctx){
    return ensureCloudTransport(ctx)||ctx.destination;
  }
  function ensureSoundTouchProcessor(ctx){
    if(!ctx || !ctx.audioWorklet || typeof AudioWorkletNode!=='function'){
      return Promise.reject(new Error('AudioWorklet unavailable'));
    }
    let loading=cloudStretchModulePromises.get(ctx);
    if(!loading){
      loading=ctx.audioWorklet.addModule(SOUND_TOUCH_PROCESSOR_URL);
      cloudStretchModulePromises.set(ctx,loading);
    }
    return loading;
  }

  function makeId(){
    if(crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=Math.random()*16|0;
      return (c==='x'?r:(r&3|8)).toString(16);
    });
  }
  function pad(value){ return String(value).padStart(2,'0'); }
  function formatDuration(ms){
    const seconds=Math.max(0,Math.floor(ms/1000));
    return Math.floor(seconds/60)+':'+pad(seconds%60);
  }
  function formatRecordingDuration(ms){
    const seconds=Math.max(0,Math.floor(ms/1000));
    return `${Math.floor(seconds/60)}:${pad(seconds%60)}`;
  }
  function formatDate(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}. ${pad(date.getMonth()+1)}. ${pad(date.getDate())}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function clamp(value,min,max){ return Math.min(max,Math.max(min,value)); }
  function makeMono(node){
    if(!node) return node;
    try{
      node.channelCount=1;
      node.channelCountMode='explicit';
      node.channelInterpretation='speakers';
    }catch(e){}
    return node;
  }
  function rowDurationSeconds(row){ return Math.max(0,Number(row&&row.duration_ms)||0)/1000; }
  /* Number(null)은 0이라 그대로 쓰면 지정된 적 없는 A/B가 0초로 읽힌다. */
  function msOrNull(value){
    if(value===null || value===undefined || value==='') return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }
  /* 연습 설정은 계정에 저장된다. 이 세션에서 바꾼 값이 있으면 그것을,
     없으면 클라우드에서 받아 온 값을 쓴다. */
  function rowPlaybackRate(row){
    const stored=playbackRates.get(row&&row.id);
    const value=Number.isFinite(Number(stored))
      ? Number(stored)
      : (Number(row&&row.playback_rate)||1);
    return clamp(Math.round(value/PLAYBACK_RATE_STEP)*PLAYBACK_RATE_STEP,
      PLAYBACK_RATE_MIN,PLAYBACK_RATE_MAX);
  }
  function rowTranspose(row){
    const stored=transposes.get(row&&row.id);
    const value=Number.isFinite(Number(stored))
      ? Number(stored)
      : (Number(row&&row.transpose)||0);
    return clamp(Math.round(value),TRANSPOSE_MIN,TRANSPOSE_MAX);
  }
  /* 반음 단위 조옮김을 재생 배율로 바꾼다. */
  function transposeRatio(semitones){
    return Math.pow(2,(Number(semitones)||0)/12);
  }
  /* 배속이 1이어도 조옮김이 있으면 SoundTouch 경로가 필요하다. */
  function needsPitchProcessing(row){
    return rowPlaybackRate(row)!==1 || rowTranspose(row)!==0;
  }
  function formatPlaybackRate(value){
    const rate=Number(value)||1;
    return `${rate.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}×`;
  }
  function loopRegionFor(row){
    let region=loopRegions.get(row&&row.id);
    if(!region){
      /* 클라우드에 저장된 구간을 초 단위로 되살린다. */
      const a=msOrNull(row&&row.loop_a_ms);
      const b=msOrNull(row&&row.loop_b_ms);
      region={
        a:a===null?null:a/1000,
        b:b===null?null:b/1000,
        enabled:Boolean(row&&row.loop_enabled),
      };
    }
    return {
      a:Number.isFinite(region.a)?clamp(region.a,0,rowDurationSeconds(row)):null,
      b:Number.isFinite(region.b)?clamp(region.b,0,rowDurationSeconds(row)):null,
      enabled:Boolean(region.enabled),
    };
  }
  function activeLoopFor(row){
    const region=loopRegionFor(row);
    if(!region.enabled) return null;
    if(region.a!==null && region.b!==null && region.b-region.a>=MIN_LOOP_SECONDS) return region;
    const duration=rowDurationSeconds(row);
    return duration>=MIN_LOOP_SECONDS ? {a:0,b:duration,enabled:true,whole:true} : null;
  }
  function isNativePlaybackMode(mode=cloudPlaybackMode){
    return mode==='native-connected' || mode==='native-direct';
  }
  function activeCloudAudio(){
    return cloudMediaUsesPersistentNative ? cloudNativeAudio : cloudFallbackAudio;
  }
  function applyNativePlaybackSettings(row,audio=activeCloudAudio()){
    const rate=rowPlaybackRate(row);
    try{ audio.defaultPlaybackRate=rate; }catch(error){}
    try{ audio.playbackRate=rate; }catch(error){}
    try{ audio.preservesPitch=true; }catch(error){}
    try{ audio.webkitPreservesPitch=true; }catch(error){}
    const region=loopRegionFor(row);
    try{
      audio.loop=Boolean(region.enabled &&
        (region.a===null || region.b===null || region.b-region.a<MIN_LOOP_SECONDS));
    }catch(error){}
  }
  function syncNativePlaybackSettings(audio){
    if(audio!==activeCloudAudio() || !cloudMediaId) return;
    const row=rows.find(item=>item.id===cloudMediaId);
    if(row) applyNativePlaybackSettings(row,audio);
  }
  function updateCloudMediaSessionPosition(row,position){
    try{
      if(!cloudMediaSessionActive || !navigator.mediaSession ||
         typeof navigator.mediaSession.setPositionState!=='function') return;
      const active=row||rows.find(item=>item.id===cloudMediaId);
      const duration=rowDurationSeconds(active);
      if(!(duration>0)) return;
      const current=clamp(Number.isFinite(position)?position:currentCloudPosition(),0,
        Math.max(0,duration-.001));
      navigator.mediaSession.setPositionState({
        duration,position:current,playbackRate:rowPlaybackRate(active),
      });
    }catch(error){}
  }
  function refreshCloudMediaSessionPosition(minInterval=750){
    if(!cloudMediaSessionActive || !cloudMediaId) return;
    const now=performance.now();
    if(now-cloudMediaPositionUpdatedAt<minInterval) return;
    const row=rows.find(item=>item.id===cloudMediaId);
    if(!row) return;
    cloudMediaPositionUpdatedAt=now;
    updateCloudMediaSessionPosition(row,currentCloudPosition());
  }
  function updateCloudMediaSessionState(row){
    try{
      if(!navigator.mediaSession) return;
      const active=row||rows.find(item=>item.id===cloudMediaId);
      if(!active) return;
      navigator.mediaSession.playbackState=cloudPlayingId===active.id?'playing':'paused';
      updateCloudMediaSessionPosition(active);
    }catch(error){}
  }
  function seekCloudPlaybackBy(seconds){
    const row=rows.find(item=>item.id===cloudMediaId);
    if(!row) return;
    const duration=rowDurationSeconds(row);
    const target=clamp(currentCloudPosition()+Number(seconds||0),0,duration);
    playbackPositions.set(row.id,target);
    if(isNativePlaybackMode()) prepareNativeOffset(target,activeCloudAudio());
    else if(cloudPlayingId===row.id && cloudPlaybackMode==='decoded' &&
            cloudDecodedBuffer && cloudDecodedContext){
      const token=++cloudPlayToken;
      startDecodedSource(cloudDecodedContext,cloudDecodedBuffer,row,token,target);
    }
    updatePlayerProgress(row.id,target);
    updateCloudMediaSessionPosition(row,target);
  }
  function resumeCloudPlaybackFromMediaSession(){
    const row=rows.find(item=>item.id===cloudMediaId);
    if(!row || (!cloudMediaUsesPersistentNative && !cloudMediaSource && !cloudDecodedBuffer)) return;
    const token=++cloudPlayToken;
    cloudPlayingId=row.id;
    setAudioSession('playback');
    const ctx=cloudDecodedContext||cloudTransportContext||audioCtx;
    const offset=Number(playbackPositions.get(row.id))||0;
    if(needsPitchProcessing(row) && !cloudMediaUsesPersistentNative && cloudMediaSource &&
       cloudPlaybackMode==='native-paused'){
      switchActivePlaybackToPitchPreserving(row,offset);
      return;
    }
    if(cloudDecodedBuffer && cloudPlaybackMode==='decoded-paused'){
      cloudPlaybackMode='decoded';
      Promise.all([
        ctx && ctx.state!=='running' ? resumeCtx(ctx) : Promise.resolve(),
        needsPitchProcessing(row) ? ensureSoundTouchProcessor(ctx) : Promise.resolve(),
        armCloudTransport(ctx,row),
      ]).then(()=>{
        if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
        startDecodedSource(ctx,cloudDecodedBuffer,row,token,offset);
      }).catch(error=>handlePlaybackFailure(playbackStageError('audio',error),row,token));
      return;
    }
    cloudPlaybackMode=cloudMediaUsesPersistentNative?'native-direct':'native-connected';
    const audio=activeCloudAudio();
    applyNativePlaybackSettings(row,audio);
    prepareNativeOffset(offset,audio);
    Promise.all([
      ctx && ctx.state!=='running' ? resumeCtx(ctx) : Promise.resolve(),
      armCloudTransport(ctx,row),
      Promise.resolve(audio.play()),
    ]).then(()=>{
      if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
      setTabSounding('trainer',true,'recording-playback');
      configureCloudMediaSession(row);
      renderList();
      startCloudProgress();
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media:play');
    }).catch(error=>handlePlaybackFailure(playbackStageError('audio',error),row,token));
  }
  function setCloudMediaAction(action,handler){
    try{
      navigator.mediaSession.setActionHandler(action,handler);
      return true;
    }catch(error){
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media-action:failed',{
        action,error:String(error&&error.name||error&&error.message||error).slice(0,80),
      });
      return false;
    }
  }
  function installCloudMediaActions(actionMode){
    const play=setCloudMediaAction('play',()=>resumeCloudPlaybackFromMediaSession());
    let pause=true;
    if(actionMode==='stream'){
      // 실제 운반자 요소가 먼저 멈추게 두면 잠금화면 버튼의 반응이 가장 빠르다.
      setCloudMediaAction('pause',null);
      setCloudMediaAction('stop',null);
    }else{
      pause=setCloudMediaAction('pause',()=>{
        if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media:pause');
        pauseCloudPlayback();
      });
      setCloudMediaAction('stop',()=>stopCloudPlayback());
    }
    const backward=setCloudMediaAction('seekbackward',details=>{
      const amount=Number(details&&details.seekOffset)||10;
      seekCloudPlaybackBy(-amount);
    });
    const forward=setCloudMediaAction('seekforward',details=>{
      const amount=Number(details&&details.seekOffset)||10;
      seekCloudPlaybackBy(amount);
    });
    for(const action of ['previoustrack','nexttrack']) setCloudMediaAction(action,null);
    const installed=play && pause && backward && forward;
    if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark(
      installed?'recording-media-actions:installed':'recording-media-actions:retry',
      {actionMode}
    );
    return installed;
  }
  function configureCloudMediaSession(row){
    try{
      if(!navigator.mediaSession || !row ||
         (!cloudMediaUsesPersistentNative && !cloudMediaSource &&
          !cloudDecodedBuffer && !cloudTransportDestination)) return;
      claimExternalMediaSession('recording-playback');
      const actionMode=cloudTransportDestination?'stream':'callbacks';
      const installActions=!cloudMediaSessionActive || cloudMediaSessionActionMode!==actionMode;
      cloudMediaSessionActive=true;
      setAudioSession('playback');
      if(typeof MediaMetadata==='function'){
        navigator.mediaSession.metadata=new MediaMetadata({
          title:String(row.title||'무제'),artist:"O'live",album:'O’live 목록',
        });
      }
      if(installActions && typeof navigator.mediaSession.setActionHandler==='function'){
        cloudMediaSessionActionMode=installCloudMediaActions(actionMode)?actionMode:'';
      }
      updateCloudMediaSessionState(row);
    }catch(error){}
  }
  function clearCloudMediaSession(){
    if(!cloudMediaSessionActive) return;
    cloudMediaSessionActive=false;
    cloudMediaSessionActionMode='';
    try{
      if(navigator.mediaSession){
        navigator.mediaSession.playbackState='none';
        navigator.mediaSession.metadata=null;
        if(typeof navigator.mediaSession.setActionHandler==='function'){
          for(const action of ['play','pause','stop','seekbackward','seekforward',
                                'previoustrack','nexttrack']){
            try{ navigator.mediaSession.setActionHandler(action,null); }catch(error){}
          }
        }
      }
    }catch(error){}
    releaseExternalMediaSession('recording-playback');
  }
  function handleCloudNativePauseFromSystem(){
    if(!cloudPlayingId || !cloudMediaUsesPersistentNative) return;
    pauseCloudPlayback();
  }
  function normalizeWaveform(values){
    if(!Array.isArray(values) || !values.length || values.length>WAVEFORM_MAX_POINTS) return [];
    return values.map(value=>Math.round(clamp(Number(value)||0,0,100)));
  }
  function compactWaveform(levels,targetPoints){
    if(!Array.isArray(levels) || !levels.length) return [];
    const points=Math.max(1,Math.min(WAVEFORM_MAX_POINTS,targetPoints||WAVEFORM_POINTS));
    const peaks=[];
    for(let index=0;index<points;index++){
      const start=Math.floor(index*levels.length/points);
      const end=Math.max(start+1,Math.floor((index+1)*levels.length/points));
      let peak=0;
      for(let sample=start;sample<end && sample<levels.length;sample++) peak=Math.max(peak,Number(levels[sample])||0);
      peaks.push(peak);
    }
    const ceiling=Math.max(.002,...peaks);
    return peaks.map(value=>Math.round(clamp(Math.sqrt(value/ceiling)*100,0,100)));
  }
  function meterLevelForRms(rms){
    const input=Math.max(0,Number(rms)||0);
    // 실제 녹음에는 영향을 주지 않고 표시만 dB 눈금으로 펼친다.
    // -60dB 부근의 약한 연주부터 반응하고 -12dB에서 가득 차며,
    // 마이크 바닥 소음 수준은 기존처럼 짧게 유지한다.
    if(input<.0006) return .018;
    const decibels=20*Math.log10(input);
    const normalized=clamp((decibels+60)/48,0,1);
    return clamp(Math.pow(normalized,.78),.018,1);
  }
  function playbackGainForRecording(levels,peak){
    const active=(Array.isArray(levels)?levels:[])
      .map(value=>Math.max(0,Number(value)||0))
      .filter(value=>value>=RECORDING_NOISE_FLOOR)
      .sort((a,b)=>a-b);
    if(!active.length) return 1;
    const representative=active[Math.floor((active.length-1)*.8)];
    const loudnessGain=METRONOME_REFERENCE_RMS/Math.max(representative,RECORDING_NOISE_FLOOR);
    const peakGain=Number(peak)>0 ? PLAYBACK_PEAK_HEADROOM/Number(peak) : PLAYBACK_GAIN_MAX;
    return Number(clamp(Math.min(loudnessGain,peakGain),PLAYBACK_GAIN_MIN,PLAYBACK_GAIN_MAX).toFixed(3));
  }
  function rowPlaybackGain(row){
    return clamp(Number(row&&(
      row.playback_gain!==undefined ? row.playback_gain : row.playbackGain
    ))||1,.25,16);
  }
  function defaultTitle(){
    return '무제';
  }
  function safeFileName(title,extension){
    const clean=String(title||'O-live 녹음').replace(/[\\/:*?"<>|]/g,' ').trim().slice(0,60);
    return `${clean||'O-live 녹음'}.${extension}`;
  }
  function extensionFor(mime){
    const type=String(mime||'').toLowerCase();
    if(type.includes('mpeg')) return 'mp3';
    if(type.includes('aac')) return 'aac';
    if(type.includes('flac')) return 'flac';
    if(type.includes('webm')) return 'webm';
    if(type.includes('ogg')) return 'ogg';
    if(type.includes('wav')) return 'wav';
    return type.includes('mp4') || type.includes('m4a') ? 'm4a' : 'webm';
  }
  function chooseMimeType(){
    if(!window.MediaRecorder || typeof MediaRecorder.isTypeSupported!=='function') return '';
    return [
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
    ].find(type=>MediaRecorder.isTypeSupported(type))||'';
  }
  function uploadMimeType(file){
    const type=String(file&&file.type||'').toLowerCase().split(';')[0];
    const allowed=['audio/mpeg','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/flac'];
    if(allowed.includes(type)) return type;
    const extension=String(file&&file.name||'').split('.').pop().toLowerCase();
    return ({mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',aac:'audio/aac',wav:'audio/wav',
      ogg:'audio/ogg',webm:'audio/webm',flac:'audio/flac'})[extension]||'';
  }
  function uploadTitle(file){
    const name=String(file&&file.name||'업로드').replace(/\.[^.]+$/,'').trim();
    return (name||'업로드').slice(0,80);
  }
  function mediaElementAudioDuration(file){
    return new Promise((resolve,reject)=>{
      const audio=document.createElement('audio');
      const url=URL.createObjectURL(file);
      let settled=false;
      const finish=(error)=>{
        if(settled) return;
        settled=true; clearTimeout(timer);
        const duration=Number(audio.duration);
        audio.removeAttribute('src');
        try{ audio.load(); }catch(e){}
        URL.revokeObjectURL(url);
        if(error || !Number.isFinite(duration) || duration<=0) reject(error||new Error('Invalid audio duration'));
        else resolve(Math.round(duration*1000));
      };
      const timer=setTimeout(()=>finish(new Error('Audio metadata timeout')),10000);
      audio.preload='metadata';
      audio.addEventListener('loadedmetadata',()=>finish(),{once:true});
      audio.addEventListener('error',()=>finish(new Error('Unsupported audio file')),{once:true});
      audio.src=url;
      try{ audio.load(); }catch(error){ finish(error); }
      if(audio.readyState>=1) Promise.resolve().then(()=>finish());
    });
  }
  async function decodedAudioFileDuration(file){
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx) throw new Error('Audio decoder unavailable');
    const ctx=new Ctx({latencyHint:'playback'});
    try{
      const decoded=await withTimeout(decodeAudioBlob(ctx,file),15000);
      const duration=Number(decoded&&decoded.duration);
      if(!Number.isFinite(duration) || duration<=0) throw new Error('Invalid decoded audio duration');
      return Math.round(duration*1000);
    }finally{
      try{
        const closing=ctx.close();
        if(closing && typeof closing.catch==='function') closing.catch(()=>{});
      }catch(e){}
    }
  }
  async function audioFileDuration(file){
    try{
      return await mediaElementAudioDuration(file);
    }catch(metadataError){
      // 일부 브라우저는 재생 가능한 MP3도 ID3/VBR 메타데이터 단계에서 먼저
      // 오류를 낸다. 실제 디코더가 읽을 수 있으면 정상 파일로 받아들인다.
      try{ return await decodedAudioFileDuration(file); }
      catch(decodeError){
        const error=new Error('Audio metadata and decode failed');
        error.cause={metadataError,decodeError};
        throw error;
      }
    }
  }
  function setMessage(message,error){
    recordMessage.textContent=message||'';
    recordMessage.classList.toggle('error',Boolean(error));
  }
  function setRecordingProgress(ms){
    const elapsed=clamp(Number(ms)||0,0,MAX_DURATION_MS);
    const progress=MAX_DURATION_MS ? elapsed/MAX_DURATION_MS : 0;
    recordTimeProgress.classList.toggle('running',recording);
    recordTimeProgress.setAttribute('aria-valuenow',String(Math.floor(elapsed/1000)));
    recordTimeProgress.setAttribute('aria-valuetext',`${formatRecordingDuration(elapsed)} / 5:00`);
    recordTimeFill.style.transform=`scaleX(${progress.toFixed(5)})`;
  }
  function setTimer(ms){
    recordTimer.textContent=formatRecordingDuration(ms);
    setRecordingProgress(ms);
  }
  function setButtonMode(mode){
    recordToggle.dataset.mode=mode;
    recordToggle.classList.toggle('on',mode==='recording');
    recordToggle.classList.toggle('playing',mode==='preview' && draftIsPlaying());
    recordToggle.setAttribute('aria-label',{
      idle:'녹음 시작',starting:'마이크 연결 취소',recording:'녹음 정지',preview:'녹음 미리 듣기',
    }[mode]||'녹음');
    recordToggle.setAttribute('aria-busy',mode==='starting'?'true':'false');
  }
  function clearInputActivity(){
    inputActivityLastAt=0;
    recordLevelRow.classList.remove('input-active');
  }
  function renderIdle(){
    setTimer(0);
    recordState.textContent='녹음 준비';
    recordStateDot.hidden=true;
    recordHint.textContent='최대 5분 · 메트로놈 또는 잼 세션과 함께 녹음할 수 있습니다';
    recordDraft.hidden=true;
    clearInputActivity();
    recordLevel.style.transform='scaleX(0)';
    setButtonMode('idle');
  }
  function renderDraft(){
    if(!draft){ renderIdle(); return; }
    setTimer(draft.durationMs);
    recordState.textContent=draftIsPlaying() ? '재생 중' : '녹음 확인';
    recordStateDot.hidden=true;
    recordHint.textContent='확인한 뒤 클라우드에 저장하세요';
    recordDraft.hidden=false;
    recordTitle.value=draft.title;
    setButtonMode('preview');
  }
  function teardownCaptureGraph(){
    try{ if(levelSource) levelSource.disconnect(); }catch(e){}
    try{ if(levelSink) levelSink.disconnect(); }catch(e){}
    try{ if(captureMixer) captureMixer.disconnect(); }catch(e){}
    if(captureDestination){
      try{ captureDestination.stream.getTracks().forEach(track=>track.stop()); }catch(e){}
    }
    captureMixer=captureDestination=null;
    recordingStream=null;
    levelSource=levelAnalyser=levelSink=levelSamples=null;
    cancelAnimationFrame(levelFrame); levelFrame=0;
    clearInputActivity();
    recordLevel.style.transform='scaleX(0)';
  }
  function stopTracks(){
    if(stream){
      stream.getTracks().forEach(track=>{ try{ track.stop(); }catch(e){} });
      stream=null;
    }
    teardownCaptureGraph();
  }
  function finishAudioSession(){
    stopTracks();
    setTabSounding('trainer',false,'recorder');
    // 메트로놈이나 잼이 계속 울리는 동안에는 공유 컨텍스트를 닫지 않는다.
    if(anySounding()){
      setAudioSession('playback');
      if(audioCtx && audioCtx.state!=='closed') __ctxMode='playback';
      return;
    }
    setAudioSession('ambient');
    releaseCtx();
  }
  function draftIsPlaying(){ return Boolean(draftSource) || !draftAudio.paused; }
  function currentDraftPosition(){
    if(draftSource && draftDecodedContext){
      return Math.max(0,draftStartedOffset+draftDecodedContext.currentTime-draftStartedAt);
    }
    return Math.max(0,Number(draftAudio.currentTime)||draftStartedOffset||0);
  }
  function releaseDraftSource(){
    const source=draftSource;
    draftSource=null;
    if(source){
      source.onended=null;
      try{ source.stop(); }catch(error){}
      try{ source.disconnect(); }catch(error){}
    }
    try{ if(draftGainNode) draftGainNode.disconnect(); }catch(error){}
    draftGainNode=null;
  }
  function pauseDraftPlayback(resetPosition){
    ++draftPlayToken;
    if(!resetPosition) draftStartedOffset=currentDraftPosition();
    else draftStartedOffset=0;
    releaseDraftSource();
    draftAudio.pause();
    if(resetPosition){
      try{ draftAudio.currentTime=0; }catch(error){}
      draftDecodedBuffer=draftDecodedContext=null;
    }
    setTabSounding('trainer',false,'recording-preview');
  }
  function startDraftDecoded(ctx,buffer,token){
    releaseDraftSource();
    const source=ctx.createBufferSource();
    const gain=makeMono(ctx.createGain());
    const startAt=clamp(draftStartedOffset,0,Math.max(0,Number(buffer.duration)||0));
    source.buffer=buffer;
    gain.gain.value=rowPlaybackGain(draft);
    source.connect(gain).connect(ctx.destination);
    source.onended=()=>{
      if(source!==draftSource || token!==draftPlayToken) return;
      try{ source.disconnect(); gain.disconnect(); }catch(error){}
      draftSource=draftGainNode=null;
      draftStartedOffset=0;
      setTabSounding('trainer',false,'recording-preview');
      renderDraft();
    };
    draftSource=source;
    draftGainNode=gain;
    draftDecodedBuffer=buffer;
    draftDecodedContext=ctx;
    draftStartedAt=ctx.currentTime;
    source.start(0,startAt);
    setTabSounding('trainer',true,'recording-preview');
    setMessage('');
    renderDraft();
  }
  function discardDraft(){
    pauseDraftPlayback(true);
    draftAudio.removeAttribute('src');
    if(draftUrl) URL.revokeObjectURL(draftUrl);
    draftUrl=''; draft=null;
    renderIdle();
  }
  function fillAnalyserSamples(analyser,samples){
    const data=samples&&samples.length===analyser.fftSize
      ? samples
      : new Float32Array(analyser.fftSize);
    if(typeof analyser.getFloatTimeDomainData==='function'){
      analyser.getFloatTimeDomainData(data);
    }else{
      const bytes=new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(bytes);
      for(let index=0;index<bytes.length;index++) data[index]=(bytes[index]-128)/128;
    }
    return data;
  }
  function samplesRms(samples){
    let sum=0;
    for(let index=0;index<samples.length;index++) sum+=samples[index]*samples[index];
    return Math.sqrt(sum/samples.length);
  }
  function drawLevel(now){
    if(!recording || !levelAnalyser) return;
    levelSamples=fillAnalyserSamples(levelAnalyser,levelSamples);
    const rms=samplesRms(levelSamples);
    for(let index=0;index<levelSamples.length;index++){
      recordingPeak=Math.max(recordingPeak,Math.abs(levelSamples[index]));
    }
    if(!lastWaveformCaptureAt || now-lastWaveformCaptureAt>=40){
      waveformLevels.push(rms);
      lastWaveformCaptureAt=now;
    }
    if(rms>=INPUT_ACTIVITY_THRESHOLD) inputActivityLastAt=now;
    recordLevelRow.classList.toggle('input-active',Boolean(inputActivityLastAt && now-inputActivityLastAt<=INPUT_ACTIVITY_HOLD_MS));
    recordLevel.style.transform=`scaleX(${meterLevelForRms(rms).toFixed(3)})`;
    levelFrame=requestAnimationFrame(drawLevel);
  }
  function updateTimer(){
    if(!recording) return;
    const elapsed=Math.min(MAX_DURATION_MS,performance.now()-startedAt);
    setTimer(elapsed);
    if(elapsed>=MAX_DURATION_MS) stopRecording();
  }
  function setupLevel(ctx,source){
    if(!source || !ctx) return;
    levelAnalyser=ctx.createAnalyser();
    levelAnalyser.fftSize=512;
    levelAnalyser.smoothingTimeConstant=.65;
    levelSink=ctx.createGain();
    levelSink.gain.value=0;
    source.connect(levelAnalyser);
    levelAnalyser.connect(levelSink);
    levelSink.connect(ctx.destination);
    levelFrame=requestAnimationFrame(drawLevel);
  }
  function setupCapture(ctx){
    levelSource=ctx.createMediaStreamSource(stream);
    setupLevel(ctx,levelSource);
    if(typeof ctx.createMediaStreamDestination!=='function') return stream;
    try{
      // iPhone PWA가 잠금 중 원본 MediaRecorder의 컨테이너 시계를 멈추는 경우가
      // 있다. 같은 play-and-record 그래프의 연속 스트림을 기록해, 잠금 뒤 입력도
      // 한 파일 안에서 이어지고 재생이 잠근 시점에서 잘리지 않게 한다.
      captureMixer=makeMono(ctx.createGain());
      captureDestination=makeMono(ctx.createMediaStreamDestination());
      levelSource.connect(captureMixer).connect(captureDestination);
      const processed=captureDestination.stream;
      if(processed && typeof processed.getAudioTracks==='function' &&
         processed.getAudioTracks().length) return processed;
    }catch(error){
      try{ if(captureMixer) captureMixer.disconnect(); }catch(ignore){}
      captureMixer=captureDestination=null;
    }
    return stream;
  }
  async function resumeAfterVisibility(){
    if(!recording || !stream || document.visibilityState!=='visible') return;
    updateTimer();
    try{
      const ctx=audioCtx;
      // MediaRecorder는 이 컨텍스트의 출력 스트림을 계속 기록 중이다.
      // 잠금 뒤 새 컨텍스트로 교체하면 기존 파일이 잠근 시점에서 끝나므로,
      // 반드시 같은 컨텍스트만 재개한다.
      if(!ctx || ctx.state==='closed') throw new Error('RecordingContextClosed');
      if(ctx.state!=='running'){
        await resumeCtx(ctx);
      }
      if(!recording || !stream || ctx!==audioCtx || ctx.state!=='running') return;
      // 기존 녹음 스트림을 다시 만들면 진행 중인 MP4 파일이 끊어진다. 잠금 중
      // 멈춘 화면용 requestAnimationFrame만 같은 입력 그래프에서 다시 시작한다.
      if(levelAnalyser){
        cancelAnimationFrame(levelFrame);
        levelFrame=requestAnimationFrame(drawLevel);
      }
      if(recordingInterruptedWhileHidden){
        setMessage('화면이 잠긴 동안 iPhone이 마이크 입력을 중단했을 수 있습니다',true);
        recordingInterruptedWhileHidden=false;
      }
    }catch(e){
      // 입력 막대 복구 실패가 진행 중인 MediaRecorder를 종료시키지는 않는다.
      if(recordingInterruptedWhileHidden){
        setMessage('잠금 중 중단된 마이크를 iPhone이 복구하지 못했습니다',true);
        recordingInterruptedWhileHidden=false;
      }
    }
  }
  async function startRecording(){
    if(!currentUser){ window.OliveCloud.openAccount(); return; }
    if(!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      setMessage('이 브라우저에서는 녹음을 사용할 수 없습니다',true); return;
    }
    if(draft) discardDraft();
    // 실제 녹음은 메트로놈·잼과 함께 쓸 수 있지만, 저장된 파일 재생과는
    // 하나의 오디오 세션을 나눠 쓰지 않는다.
    if(cloudPlayingId || cloudMediaId) stopCloudPlayback(false);
    const preservePlayback=anySounding();
    const token=++startToken;
    startPending=true;
    setMessage('');
    recordState.textContent='마이크 연결 중…';
    recordStateDot.hidden=true;
    setButtonMode('starting');
    try{
      setAudioSession('play-and-record');
      let ctx=await ensureRecordingCtx(preservePlayback);
      if(token!==startToken || !startPending){ finishAudioSession(); return; }
      stream=await navigator.mediaDevices.getUserMedia({audio:{
        channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false,
      }});
      if(token!==startToken || !startPending){ finishAudioSession(); return; }
      if(ctx!==audioCtx || ctx.state!=='running'){
        ctx=await ensureRecordingCtx(preservePlayback && anySounding());
      }
      if(token!==startToken || !startPending){ finishAudioSession(); return; }
      const mimeType=chooseMimeType();
      const options={audioBitsPerSecond:96000};
      if(mimeType) options.mimeType=mimeType;
      recordingStream=setupCapture(ctx);
      recorder=new MediaRecorder(recordingStream,options);
      chunks=[];
      waveformLevels=[];
      recordingPeak=0;
      lastWaveformCaptureAt=0;
      recordingInterruptedWhileHidden=false;
      recorder.addEventListener('dataavailable',event=>{
        if(event.data && event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener('error',()=>{
        setMessage('녹음을 완료하지 못했습니다. 다시 시도해 주세요',true);
      });
      recorder.addEventListener('stop',finalizeDraft,{once:true});
      stream.getAudioTracks().forEach(track=>{
        track.addEventListener('mute',()=>{
          if(recording) recordingInterruptedWhileHidden=true;
          if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-track:muted');
        });
        track.addEventListener('unmute',()=>{
          if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-track:unmuted');
        });
        track.addEventListener('ended',()=>{
          if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-track:ended');
          if(recording) stopRecording();
        },{once:true});
      });
      /* iPhone Safari의 MP4 MediaRecorder는 timeslice로 잘게 나눈 조각을
         다시 합쳤을 때 긴 녹음이 재생 불가능해지는 경우가 있다.
         최대 5분·96kbps면 메모리 부담이 작으므로 stop 때 한 파일로 받는다. */
      recorder.start();
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording:started',{
        processedStream:recordingStream!==stream,
      });
      recording=true; startPending=false; startedAt=performance.now(); recordedAt=new Date().toISOString();
      setTimer(0);
      timerId=setInterval(updateTimer,200);
      setTabSounding('trainer',true,'recorder');
      recordState.textContent='녹음 중';
      recordStateDot.hidden=false;
      recordHint.textContent='자동 화면 꺼짐은 방지합니다 · 녹음 중에는 직접 잠그지 마세요';
      setButtonMode('recording');
    }catch(error){
      if(token!==startToken) return;
      startPending=false; recording=false; finishAudioSession(); renderIdle();
      const message=error && error.name==='NotAllowedError' ? '마이크 권한이 필요합니다'
        : error && error.name==='NotReadableError' ? '마이크가 다른 앱에서 사용 중입니다'
        : error && error.name==='NotFoundError' ? '사용할 수 있는 마이크가 없습니다'
        : '녹음을 시작하지 못했습니다. 다시 시도해 주세요';
      setMessage(message,true);
    }
  }
  function stopRecording(){
    if(startPending){
      startPending=false; ++startToken; finishAudioSession(); renderIdle(); return;
    }
    if(!recording || !recorder) return;
    const elapsed=Math.min(MAX_DURATION_MS,performance.now()-startedAt);
    recording=false;
    clearInputActivity();
    clearInterval(timerId); timerId=0;
    setTimer(elapsed);
    recordState.textContent='녹음 처리 중…';
    recordStateDot.hidden=true;
    setButtonMode('starting');
    try{ recorder.stop(); }
    catch(e){ finishAudioSession(); renderIdle(); }
  }
  function finalizeDraft(){
    const durationMs=Math.max(0,Math.min(MAX_DURATION_MS,Math.round(performance.now()-startedAt)));
    const type=recorder && recorder.mimeType || chunks[0] && chunks[0].type || chooseMimeType() || 'audio/webm';
    const blob=new Blob(chunks,{type});
    recorder=null; chunks=[]; finishAudioSession();
    if(durationMs<1000 || !blob.size){
      renderIdle(); setMessage('1초 이상 녹음해 주세요',true); return;
    }
    draft={
      blob,durationMs,mimeType:type,title:defaultTitle(),extension:extensionFor(type),
      recordedAt:recordedAt||new Date().toISOString(),
      playbackGain:playbackGainForRecording(waveformLevels,recordingPeak),
      waveform:compactWaveform(waveformLevels,WAVEFORM_POINTS),
    };
    waveformLevels=[];
    draftUrl=URL.createObjectURL(blob);
    draftAudio.src=draftUrl;
    renderDraft();
  }
  async function toggleDraftPlayback(){
    if(!draft) return;
    if(draftIsPlaying()){
      pauseDraftPlayback(false);
      renderDraft();
      return;
    }
    stopCloudPlayback();
    const token=++draftPlayToken;
    let playback;
    try{
      playback=beginPlaybackFromGesture();
      const ctx=await playback.ready;
      const buffer=draftDecodedBuffer || await decodeAudioBlob(ctx,draft.blob);
      if(token!==draftPlayToken || !draft) return;
      startDraftDecoded(ctx,buffer,token);
    }
    catch(error){
      if(token!==draftPlayToken || !draft) return;
      try{
        setAudioSession('playback');
        draftAudio.currentTime=draftStartedOffset;
        await draftAudio.play();
      }catch(fallbackError){ setMessage('재생 버튼을 다시 눌러주세요',true); }
    }
  }
  function currentCloudPosition(){
    if(cloudPlayingId && isNativePlaybackMode()){
      return Math.max(0,Number(activeCloudAudio().currentTime)||0);
    }
    if(cloudPlayingId && cloudPlaybackMode==='decoded' && cloudDecodedContext){
      const position=Math.max(0,cloudStartedOffset+
        (cloudDecodedContext.currentTime-cloudStartedAt)*cloudStartedRate);
      const row=rows.find(item=>item.id===cloudPlayingId);
      const region=row&&activeLoopFor(row);
      if(region && position>=region.b){
        return region.a+(position-region.b)%(region.b-region.a);
      }
      return position;
    }
    return Math.max(0,Number(playbackPositions.get(cloudMediaId))||0);
  }
  function updatePlayerProgress(recordingId,position){
    if(!recordingId) return;
    const row=rows.find(item=>item.id===recordingId);
    const player=document.getElementById(`record-player-${recordingId}`);
    if(!row || !player) return;
    const duration=rowDurationSeconds(row);
    const seconds=clamp(Number(position)||0,0,duration||0);
    const waveform=player.querySelector('.record-waveform');
    const elapsed=player.querySelector('.record-player-elapsed');
    if(waveform){
      waveform.style.setProperty('--wave-progress',`${duration?seconds/duration*100:0}%`);
      waveform.setAttribute('aria-valuenow',String(Math.round(seconds)));
      waveform.setAttribute('aria-valuetext',`${formatDuration(seconds*1000)} / ${formatDuration(row.duration_ms)}`);
    }
    if(elapsed) elapsed.textContent=formatDuration(seconds*1000);
  }
  function stopCloudProgress(){
    cancelAnimationFrame(cloudProgressFrame);
    cloudProgressFrame=0;
    stopCloudPositionTimer();
  }
  function stopCloudPositionTimer(){
    if(cloudPositionTimer){ clearInterval(cloudPositionTimer); cloudPositionTimer=0; }
  }
  /* 화면이 잠기면 requestAnimationFrame이 멈춘다. 소리는 AudioBufferSourceNode의
     loop로 계속 돌지만 잠금화면에 알려 준 위치가 그대로 남아, 시간 표시가 A/B 구간을
     지나 흘러가는 것처럼 보인다. 타이머로 실제 위치를 계속 알린다. */
  function startCloudPositionTimer(){
    stopCloudPositionTimer();
    cloudPositionTimer=setInterval(()=>{
      if(!cloudPlayingId){ stopCloudPositionTimer(); return; }
      const row=rows.find(item=>item.id===cloudPlayingId);
      if(!row) return;
      const region=activeLoopFor(row);
      let position=currentCloudPosition();
      /* native 경로는 되감기도 이 루프에서 한다. 잠금 중에는 tick이 돌지 않는다. */
      if(region && isNativePlaybackMode() && !region.whole && position>=region.b){
        position=region.a;
        try{ activeCloudAudio().currentTime=region.a; }catch(error){}
      }
      playbackPositions.set(cloudPlayingId,position);
      refreshCloudMediaSessionPosition(0);
    },1000);
  }
  function startCloudProgress(){
    stopCloudProgress();
    cloudMediaPositionUpdatedAt=0;
    startCloudPositionTimer();
    const tick=()=>{
      if(!cloudPlayingId) return;
      let position=currentCloudPosition();
      const row=rows.find(item=>item.id===cloudPlayingId);
      const region=row&&activeLoopFor(row);
      if(region && isNativePlaybackMode() && !region.whole && position>=region.b){
        position=region.a;
        try{ activeCloudAudio().currentTime=region.a; }catch(error){}
      }
      playbackPositions.set(cloudPlayingId,position);
      if(scrubbingRecordingId!==cloudPlayingId) updatePlayerProgress(cloudPlayingId,position);
      // 잠금화면이 듣는 운반자 요소는 MediaStream이라 자체 재생 길이가 없다.
      // 실제 파일의 위치를 주기적으로 알려 주어 10초 이동 가능한 미디어로 유지한다.
      if(row) refreshCloudMediaSessionPosition(750);
      cloudProgressFrame=requestAnimationFrame(tick);
    };
    cloudProgressFrame=requestAnimationFrame(tick);
  }
  function releaseCloudSource(){
    const source=cloudSource;
    cloudSource=null;
    if(source){
      source.onended=null;
      try{ source.stop(); }catch(e){}
      try{ source.disconnect(); }catch(e){}
    }
    try{ if(cloudStretchNode) cloudStretchNode.disconnect(); }catch(e){}
    cloudStretchNode=null;
    try{ if(cloudGainNode) cloudGainNode.disconnect(); }catch(e){}
    cloudGainNode=null;
  }
  function resetCloudMediaElement(){
    try{ cloudFallbackAudio.pause(); }catch(error){}
    try{ cloudFallbackAudio.removeAttribute('src'); }catch(error){}
    try{ if(cloudMediaSource) cloudMediaSource.disconnect(); }catch(error){}
    try{ if(cloudMediaGain) cloudMediaGain.disconnect(); }catch(error){}
    cloudMediaSource=cloudMediaGain=null;
    cloudFallbackAudio=makeCloudFallbackAudio();
  }
  function resetCloudNativeElement(recreate=false){
    cloudNativeInternalPause=true;
    cloudNativeIgnorePauseUntil=performance.now()+250;
    try{ cloudNativeAudio.pause(); }catch(error){}
    // iOS에서는 load()를 반복 호출하면 정상 요소도 무음 상태에 빠질 수 있다.
    // 새 재생을 준비할 때는 요소 자체를 교체하고, 단순 정지에서는 src만 비운다.
    try{ cloudNativeAudio.removeAttribute('src'); }catch(error){}
    cloudNativeInternalPause=false;
    if(recreate) return replaceCloudNativeAudio();
    return cloudNativeAudio;
  }
  function stopCloudPlayback(resetPosition){
    const mediaId=cloudMediaId||cloudPlayingId;
    ++cloudPlayToken;
    stopCloudProgress();
    resetCloudMediaElement();
    resetCloudNativeElement();
    releaseCloudSource();
    resetCloudTransport();
    if(resetPosition!==false && mediaId) playbackPositions.delete(mediaId);
    cloudPlayingId='';
    cloudMediaId='';
    cloudPlaybackMode='';
    cloudStartedAt=0;
    cloudStartedOffset=0;
    cloudStartedRate=1;
    cloudDecodedBuffer=null;
    cloudDecodedContext=null;
    cloudDecodedId='';
    cloudMediaUsesPersistentNative=false;
    setTabSounding('trainer',false,'recording-playback');
    clearCloudMediaSession();
    renderList();
  }
  function pauseCloudPlayback(transportAlreadyPaused=false){
    if(!cloudPlayingId) return;
    const id=cloudPlayingId;
    playbackPositions.set(id,currentCloudPosition());
    ++cloudPlayToken;
    stopCloudProgress();
    if(isNativePlaybackMode()){
      const audio=activeCloudAudio();
      cloudNativeInternalPause=cloudMediaUsesPersistentNative;
      try{ audio.pause(); }catch(error){}
      cloudNativeInternalPause=false;
    }
    else releaseCloudSource();
    if(!transportAlreadyPaused){
      cloudTransportInternalPause=true;
      try{ cloudTransportAudio.pause(); }catch(error){}
      cloudTransportInternalPause=false;
    }
    cloudTransportPlayGeneration++;
    cloudTransportPlayPromise=null;
    cloudTransportArmed=false;
    cloudPlaybackMode=isNativePlaybackMode()?'native-paused':'decoded-paused';
    cloudPlayingId='';
    setTabSounding('trainer',false,'recording-playback');
    if(cloudMediaUsesPersistentNative || cloudMediaSource || cloudDecodedBuffer){
      const row=rows.find(item=>item.id===id);
      if(row) configureCloudMediaSession(row);
    }
    renderList();
  }
  function finishCloudPlayback(){
    const id=cloudMediaId||cloudPlayingId;
    stopCloudProgress();
    releaseCloudSource();
    cloudTransportInternalPause=true;
    try{ cloudTransportAudio.pause(); }catch(error){}
    cloudTransportInternalPause=false;
    cloudTransportPlayGeneration++;
    cloudTransportPlayPromise=null;
    cloudTransportArmed=false;
    if(id) playbackPositions.delete(id);
    cloudPlayingId='';
    cloudPlaybackMode=isNativePlaybackMode()?'native-paused':'decoded-paused';
    setTabSounding('trainer',false,'recording-playback');
    if(cloudMediaUsesPersistentNative || cloudMediaSource || cloudDecodedBuffer){
      const row=rows.find(item=>item.id===id);
      if(row) configureCloudMediaSession(row);
    }
    renderList();
  }
  function clearCloudPlaybackCache(){
    cloudBlobs.forEach(entry=>URL.revokeObjectURL(entry.url));
    cloudBlobs.clear();
  }
  function pruneCloudPlaybackCache(){
    const ids=new Set(rows.map(row=>row.id));
    cloudBlobs.forEach((entry,id)=>{
      if(ids.has(id)) return;
      URL.revokeObjectURL(entry.url);
      cloudBlobs.delete(id);
    });
    waveformCache.forEach((value,id)=>{ if(!ids.has(id)) waveformCache.delete(id); });
    playbackPositions.forEach((value,id)=>{ if(!ids.has(id)) playbackPositions.delete(id); });
    playbackRates.forEach((value,id)=>{ if(!ids.has(id)) playbackRates.delete(id); });
    loopRegions.forEach((value,id)=>{ if(!ids.has(id)) loopRegions.delete(id); });
    if(expandedRecordingId && !ids.has(expandedRecordingId)) expandedRecordingId='';
  }
  function rememberCloudBlob(row,blob){
    if(!row || !row.id || !blob) return null;
    const previous=cloudBlobs.get(row.id);
    if(previous) URL.revokeObjectURL(previous.url);
    const entry={blob,url:URL.createObjectURL(blob)};
    cloudBlobs.set(row.id,entry);
    return entry;
  }
  function forgetCloudBlob(recordingId){
    waveformCache.delete(recordingId);
    playbackPositions.delete(recordingId);
    const entry=cloudBlobs.get(recordingId);
    if(!entry) return;
    URL.revokeObjectURL(entry.url);
    cloudBlobs.delete(recordingId);
  }
  function recordingCache(){ return window.OliveRecordingCache||null; }
  function cacheRowBlob(row,blob,userId){
    const cache=recordingCache();
    const ownerId=userId||currentUser&&currentUser.id||'';
    if(!cache || !ownerId) return Promise.resolve(false);
    return cache.put(ownerId,row,blob).catch(error=>{
      console.warn('[O\'live recording cache write]',error);
      return false;
    });
  }
  async function findPlaybackBlob(row){
    const memory=cloudBlobs.get(row.id);
    if(memory) return {blob:memory.blob,cached:true};
    const cache=recordingCache();
    const userId=sessionUserId;
    if(cache && userId){
      try{
        const blob=await cache.get(userId,row);
        if(blob){ rememberCloudBlob(row,blob); return {blob,cached:true}; }
      }catch(error){ console.warn('[O\'live recording cache read]',error); }
    }
    const result=await window.OliveCloud.downloadRecording(row);
    if(sessionUserId!==userId) throw new Error('Recording session changed');
    rememberCloudBlob(row,result.blob);
    cacheRowBlob(row,result.blob,userId);
    return {blob:result.blob,cached:false};
  }
  async function hydrateCloudPlaybackCache(userId){
    const cache=recordingCache();
    if(!cache || !userId || !rows.length) return;
    try{
      const cached=await cache.getMany(userId,rows);
      if(sessionUserId!==userId) return;
      rows.forEach(row=>{
        const blob=cached.get(row.id);
        if(blob && !cloudBlobs.has(row.id)) rememberCloudBlob(row,blob);
      });
    }catch(error){ console.warn('[O\'live recording cache load]',error); }
  }
  function playbackStageError(stage,error){
    const wrapped=new Error(error&&error.message||stage);
    wrapped.oliveStage=stage;
    wrapped.cause=error;
    return wrapped;
  }
  function decodeAudioBlob(ctx,blob){
    return blob.arrayBuffer().then(buffer=>new Promise((resolve,reject)=>{
      let settled=false;
      const finish=value=>{ if(!settled){ settled=true; resolve(value); } };
      const fail=error=>{ if(!settled){ settled=true; reject(error); } };
      try{
        const result=ctx.decodeAudioData(buffer,finish,fail);
        if(result && typeof result.then==='function') result.then(finish,fail);
      }catch(error){ fail(error); }
    }));
  }
  function decodedBufferForRow(ctx,row){
    if(cloudDecodedBuffer && cloudDecodedId===row.id) return Promise.resolve(cloudDecodedBuffer);
    if(cloudDecodedLoad && cloudDecodedLoad.id===row.id && cloudDecodedLoad.ctx===ctx){
      return cloudDecodedLoad.promise;
    }
    const promise=findPlaybackBlob(row)
      .then(result=>decodeAudioBlob(ctx,result.blob))
      .finally(()=>{
        if(cloudDecodedLoad && cloudDecodedLoad.promise===promise) cloudDecodedLoad=null;
      });
    cloudDecodedLoad={id:row.id,ctx,promise};
    return promise;
  }
  function startDecodedSource(ctx,buffer,row,token,offset){
    try{
      releaseCloudSource();
      const source=ctx.createBufferSource();
      const gain=makeMono(ctx.createGain());
      const rate=rowPlaybackRate(row);
      const duration=Math.max(0,Number(buffer.duration)||rowDurationSeconds(row));
      const region=activeLoopFor(row);
      let startAt=clamp(Number(offset)||0,0,Math.max(0,duration-.02));
      if(region && startAt>=region.b) startAt=region.a;
      source.buffer=buffer;
      if(region){
        source.loop=true;
        source.loopStart=region.a;
        source.loopEnd=region.b;
      }
      gain.gain.value=rowPlaybackGain(row);
      try{ source.playbackRate.value=rate; }catch(error){}
      if(needsPitchProcessing(row) && typeof AudioWorkletNode==='function'){
        const stretch=new AudioWorkletNode(ctx,'soundtouch-processor',{
          numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],
          processorOptions:{sampleBufferType:'circular'},
        });
        const stretchRate=stretch.parameters&&stretch.parameters.get('playbackRate');
        const stretchPitch=stretch.parameters&&stretch.parameters.get('pitch');
        if(stretchRate) stretchRate.value=rate;
        if(stretchPitch) stretchPitch.value=transposeRatio(rowTranspose(row));
        source.connect(stretch).connect(gain);
        cloudStretchNode=stretch;
      }else source.connect(gain);
      gain.connect(cloudOutputDestination(ctx));
      source.onended=()=>{
        if(cloudSource!==source || token!==cloudPlayToken) return;
        try{ source.disconnect(); gain.disconnect(); }catch(e){}
        cloudSource=null;
        cloudGainNode=null;
        finishCloudPlayback();
      };
      cloudSource=source;
      cloudGainNode=gain;
      cloudDecodedBuffer=buffer;
      cloudDecodedContext=ctx;
      cloudDecodedId=row.id;
      cloudStartedOffset=startAt;
      cloudStartedAt=ctx.currentTime;
      cloudStartedRate=rate;
      cloudPlaybackMode='decoded';
      source.start(0,startAt);
      armCloudTransport(ctx,row);
      setTabSounding('trainer',true,'recording-playback');
      configureCloudMediaSession(row);
      setMessage(''); renderList(); startCloudProgress();
    }catch(error){ throw playbackStageError('audio',error); }
  }
  async function playDecodedBlob(playback,recordingBlob,row,token,offset){
    const [ctx,result]=await Promise.all([
      playback.ready.catch(error=>{ throw playbackStageError('audio',error); }),
      Promise.resolve(recordingBlob).catch(error=>{ throw playbackStageError('download',error); }),
    ]);
    if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
    let buffer;
    try{ buffer=await decodeAudioBlob(ctx,result.blob); }
    catch(error){ throw playbackStageError('decode',error); }
    if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
    if(needsPitchProcessing(row)){
      try{ await ensureSoundTouchProcessor(ctx); }
      catch(error){ throw playbackStageError('audio',error); }
    }
    if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
    startDecodedSource(ctx,buffer,row,token,offset);
  }
  function startNormalizedNative(playbackUrl,playback,row,token,offset){
    const ctx=playback.ctx;
    if(!playbackUrl || !ctx || typeof ctx.createMediaElementSource!=='function'){
      return Promise.reject(playbackStageError('audio',new Error('Media element gain unavailable')));
    }
    try{
      resetCloudMediaElement();
      cloudFallbackAudio.crossOrigin='anonymous';
      const source=ctx.createMediaElementSource(cloudFallbackAudio);
      const gain=makeMono(ctx.createGain());
      gain.gain.value=rowPlaybackGain(row);
      source.connect(gain).connect(cloudOutputDestination(ctx));
      cloudMediaSource=source;
      cloudMediaGain=gain;
      cloudFallbackAudio.src=playbackUrl;
      applyNativePlaybackSettings(row);
      cloudPlaybackMode='native-connected';
      prepareNativeOffset(offset);
      // iPhone의 사용자 제스처가 살아 있는 동안 곧바로 play()를 호출한다.
      const mediaReady=Promise.resolve(cloudFallbackAudio.play());
      const transportReady=armCloudTransport(ctx,row);
      return Promise.all([
        playback.ready.catch(error=>{ throw playbackStageError('audio',error); }),
        mediaReady.catch(error=>{ throw playbackStageError('audio',error); }),
        transportReady,
      ]).then(()=>{
        if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
        setTabSounding('trainer',true,'recording-playback');
        configureCloudMediaSession(row);
        setMessage(''); renderList(); startCloudProgress();
      });
    }catch(error){
      resetCloudMediaElement();
      return Promise.reject(playbackStageError('audio',error));
    }
  }
  async function playNormalizedBlob(playback,recordingBlob,row,token,offset){
    const result=await Promise.resolve(recordingBlob)
      .catch(error=>{ throw playbackStageError('download',error); });
    if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
    const entry=cloudBlobs.get(row.id)||rememberCloudBlob(row,result.blob);
    if(!entry) throw playbackStageError('download',new Error('Recording blob unavailable'));
    await startNormalizedNative(entry.url,playback,row,token,offset);
  }
  function handlePlaybackFailure(error,row,token){
    if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
    console.warn('[O\'live recording playback]',error);
    const stage=error&&error.oliveStage;
    stopCloudPlayback();
    setMessage(stage==='download'
      ? (!navigator.onLine?'인터넷에 연결한 뒤 다시 재생해 주세요':'녹음 파일을 불러오지 못했습니다')
      : stage==='decode'
        ? '이 녹음 파일을 재생할 수 없습니다 · 다운로드로 확인해 주세요'
        : '오디오 재생을 시작하지 못했습니다',true);
  }
  function prepareNativeOffset(offset,audio=activeCloudAudio()){
    const apply=()=>{
      const duration=Number(audio.duration)||0;
      try{ audio.currentTime=clamp(Number(offset)||0,0,Math.max(0,duration-.02)); }catch(e){}
    };
    if(audio.readyState>=1) apply();
    else audio.addEventListener('loadedmetadata',apply,{once:true});
  }
  function startNativePlayback(playbackUrl,row,token,offset,refreshList=true){
    resetCloudMediaElement();
    cloudFallbackAudio.src=playbackUrl;
    applyNativePlaybackSettings(row);
    cloudPlaybackMode='native-direct';
    prepareNativeOffset(offset);
    return Promise.resolve(cloudFallbackAudio.play()).then(()=>{
      if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
      setTabSounding('trainer',true,'recording-playback');
      setMessage('');
      if(refreshList) renderList();
      startCloudProgress();
    });
  }
  function confirmPersistentNativeProgress(audio,row,token,startedAt){
    return new Promise((resolve,reject)=>{
      setTimeout(()=>{
        if(token!==cloudPlayToken || cloudPlayingId!==row.id || audio!==cloudNativeAudio){
          resolve(); return;
        }
        const position=Number(audio.currentTime)||0;
        if(audio.ended || position>startedAt+.025){ resolve(); return; }
        if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media:stalled',{
          networkState:audio.networkState,
          readyState:audio.readyState,
        });
        reject(playbackStageError('native-stalled',new Error('Native audio did not advance')));
      },800);
    });
  }
  function startPersistentNativePlayback(playbackUrl,row,token,offset,refreshList=true){
    // iOS 26 PWA에서 이전 생명주기의 HTMLAudioElement가 무음 상태로 남는
    // 회귀를 피하기 위해, 새 파일을 시작할 때마다 사용자 탭 안에서 교체한다.
    const audio=resetCloudNativeElement(true);
    cloudMediaUsesPersistentNative=true;
    audio.src=playbackUrl;
    applyNativePlaybackSettings(row,audio);
    cloudPlaybackMode='native-direct';
    prepareNativeOffset(offset,audio);
    // play()는 Media Session 설정보다 먼저, 사용자 제스처가 살아 있는 동안 호출한다.
    return Promise.resolve(audio.play()).then(()=>{
      if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
      const progressStartedAt=Math.max(0,Number(audio.currentTime)||0);
      setTabSounding('trainer',true,'recording-playback');
      configureCloudMediaSession(row);
      setMessage('');
      if(refreshList) renderList();
      startCloudProgress();
      return confirmPersistentNativeProgress(audio,row,token,progressStartedAt);
    });
  }
  function switchActivePlaybackToDirect(row){
    if(cloudPlayingId!==row.id) return false;
    const cached=cloudBlobs.get(row.id);
    const playbackUrl=cached ? cached.url : String(row.playback_url||'');
    if(!playbackUrl) return false;
    const position=currentCloudPosition();
    const token=++cloudPlayToken;
    stopCloudProgress();
    releaseCloudSource();
    startNativePlayback(playbackUrl,row,token,position,false)
      .catch(error=>handlePlaybackFailure(playbackStageError('audio',error),row,token));
    return true;
  }
  function switchActivePlaybackToPitchPreserving(row,position){
    if(cloudPlayingId!==row.id || !audioCtx || audioCtx.state==='closed') return false;
    const ctx=audioCtx;
    const token=++cloudPlayToken;
    const offset=clamp(Number(position)||0,0,rowDurationSeconds(row));
    playbackPositions.set(row.id,offset);
    stopCloudProgress();
    resetCloudMediaElement();
    releaseCloudSource();
    cloudPlaybackMode='decoded-loading';
    Promise.all([
      ctx.state!=='running' ? resumeCtx(ctx) : Promise.resolve(),
      decodedBufferForRow(ctx,row),
      ensureSoundTouchProcessor(ctx),
      armCloudTransport(ctx,row),
    ]).then(results=>{
      if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
      startDecodedSource(ctx,results[1],row,token,offset);
    }).catch(error=>handlePlaybackFailure(playbackStageError('audio',error),row,token));
    return true;
  }
  function playRow(row,requestedOffset){
    const seeking=Number.isFinite(requestedOffset);
    const offset=clamp(seeking?requestedOffset:Number(playbackPositions.get(row.id))||0,0,rowDurationSeconds(row));
    if(recording || startPending){
      setMessage('녹음을 정지한 뒤 목록을 재생해 주세요',true);
      return;
    }
    if(cloudPlayingId===row.id && seeking){
      playbackPositions.set(row.id,offset);
      updatePlayerProgress(row.id,offset);
      if(isNativePlaybackMode()){
        prepareNativeOffset(offset);
        return;
      }
      if(cloudPlaybackMode==='decoded' && cloudDecodedBuffer && cloudDecodedContext &&
         cloudDecodedContext===audioCtx && cloudDecodedContext.state==='running'){
        const token=++cloudPlayToken;
        startDecodedSource(cloudDecodedContext,cloudDecodedBuffer,row,token,offset);
        return;
      }
    }
    if(cloudPlayingId===row.id && !seeking){ pauseCloudPlayback(); return; }
    if(cloudPlayingId===row.id) pauseCloudPlayback();
    else if(cloudPlayingId || (cloudMediaId && cloudMediaId!==row.id)) stopCloudPlayback();
    pauseDraftPlayback(false);
    const usePersistentNative=preferPersistentNativePlayback();
    if(usePersistentNative && cloudMediaUsesPersistentNative && cloudMediaId===row.id &&
       cloudNativeAudio.src){
      playbackPositions.set(row.id,offset);
      prepareNativeOffset(offset,cloudNativeAudio);
      resumeCloudPlaybackFromMediaSession();
      renderList();
      return;
    }
    let playback=null;
    if(usePersistentNative){
      // 녹음 파일이 잠금화면의 미디어 세션을 소유한다. 메트로놈·잼을 새로
      // 시작하면 기존 규칙대로 이 foreground transport를 정지한다.
      stopBackgroundTransports();
      // 네이티브 요소가 iOS PWA 회귀로 멈출 경우를 대비해, 같은 사용자 탭에서
      // 기존의 검증된 Web Audio 재생 경로도 미리 활성화해 둔다.
      try{ playback=beginPlaybackFromGesture(); }
      catch(error){ setMessage('오디오 재생을 시작하지 못했습니다',true); return; }
      playback.ready.catch(()=>{});
    }else{
      try{ playback=beginPlaybackFromGesture(); }
      catch(error){ setMessage('오디오 재생을 시작하지 못했습니다',true); return; }
      playback.ready.catch(()=>{});
    }
    playbackPositions.set(row.id,offset);
    const cached=cloudBlobs.get(row.id);
    const token=++cloudPlayToken;
    setMessage('녹음을 불러오는 중입니다');
    cloudPlayingId=row.id;
    cloudMediaId=row.id;
    if(playback && playback.ctx) armCloudTransport(playback.ctx,row).catch(()=>{});
    const recordingBlob=cached
      ? Promise.resolve({blob:cached.blob,cached:true})
      : findPlaybackBlob(row);
    // 재생과 동시에 로컬 캐시를 채운다. 데스크톱 fallback은 기존 Web Audio 정규화
    // 경로를 유지하고, iPhone은 속도·잠금화면 제어를 위해 네이티브 요소를 직접 쓴다.
    recordingBlob.catch(error=>console.warn('[O\'live recording cache fill]',error));
    const playbackUrl=cached ? cached.url : String(row.playback_url||'');
    // iPhone 홈 화면 앱에서는 직접 재생 경로가 무음이 될 수 있으므로 1배속은
    // 검증된 연결 경로를 쓴다. 배속 재생은 파일을 디코딩한 뒤 SoundTouch가
    // 음높이를 보존하며 처리하고, 출력은 같은 잠금화면 운반자로 보낸다.
    /* 조옮김도 SoundTouch가 필요하다. 판단을 needsPitchProcessing() 한 곳으로 모은다.
       여기서 놓치면 1배속 조옮김이 native 경로로 가서 아무 일도 일어나지 않는다. */
    const adjustedRate=needsPitchProcessing(row);
    const normalized=usePersistentNative
      ? (playbackUrl
        ? startPersistentNativePlayback(playbackUrl,row,token,offset)
        : recordingBlob.then(result=>{
          if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
          const entry=cloudBlobs.get(row.id)||rememberCloudBlob(row,result.blob);
          if(!entry) throw new Error('Recording blob unavailable');
          return startPersistentNativePlayback(entry.url,row,token,offset);
        }))
      : adjustedRate
        ? playDecodedBlob(playback,recordingBlob,row,token,offset)
        : playbackUrl
          ? startNormalizedNative(playbackUrl,playback,row,token,offset)
          : playNormalizedBlob(playback,recordingBlob,row,token,offset);
    normalized.catch(error=>{
      if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
      console.warn('[O\'live centered recording playback]',error);
      resetCloudMediaElement();
      cloudPlaybackMode='';
      const decodedFallback=()=>playDecodedBlob(playback,recordingBlob,row,token,offset).catch(decodeError=>{
        if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
        if(!playbackUrl){ handlePlaybackFailure(decodeError,row,token); return; }
        startNativePlayback(playbackUrl,row,token,offset)
          .catch(fallbackError=>handlePlaybackFailure(playbackStageError('audio',fallbackError),row,token));
      });
      // iOS의 네이티브 요소가 파일을 거부하거나 재생 시간이 진행되지 않으면,
      // 같은 사용자 탭에서 미리 깨워 둔 기존 Web Audio 경로로 즉시 복구한다.
      if(usePersistentNative){
        resetCloudNativeElement();
        cloudMediaUsesPersistentNative=false;
        clearCloudMediaSession();
        const stableFallback=playbackUrl
          ? startNormalizedNative(playbackUrl,playback,row,token,offset)
          : playDecodedBlob(playback,recordingBlob,row,token,offset);
        stableFallback.catch(fallbackError=>
          handlePlaybackFailure(playbackStageError('audio',fallbackError),row,token));
      }else decodedFallback();
    });
    renderList();
  }
  function waveformPath(values){
    const source=normalizeWaveform(values);
    if(!source.length) return '';
    return source.map((value,index)=>{
      const x=((index+.5)/source.length*100).toFixed(3);
      const half=(2.25+value/100*16.75).toFixed(3);
      return `M${x} ${(20-half).toFixed(3)}V${(20+Number(half)).toFixed(3)}`;
    }).join('');
  }
  function createWaveformSvg(values,className){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 100 40');
    svg.setAttribute('preserveAspectRatio','none');
    svg.setAttribute('aria-hidden','true');
    svg.classList.add('record-waveform-svg',className);
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',waveformPath(values));
    svg.appendChild(path);
    return svg;
  }
  async function waveformFromBlob(blob){
    const OfflineContext=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    const Context=OfflineContext||(window.AudioContext||window.webkitAudioContext);
    if(!Context) throw new Error('Audio decoding unavailable');
    const ctx=OfflineContext ? new OfflineContext(1,1,44100) : new Context();
    try{
      const buffer=await decodeAudioBlob(ctx,blob);
      const levels=[];
      for(let point=0;point<WAVEFORM_POINTS;point++){
        const start=Math.floor(point*buffer.length/WAVEFORM_POINTS);
        const end=Math.max(start+1,Math.floor((point+1)*buffer.length/WAVEFORM_POINTS));
        const step=Math.max(1,Math.floor((end-start)/192));
        let peak=0;
        for(let channel=0;channel<buffer.numberOfChannels;channel++){
          const samples=buffer.getChannelData(channel);
          for(let index=start;index<end;index+=step) peak=Math.max(peak,Math.abs(samples[index]||0));
        }
        levels.push(peak);
      }
      return compactWaveform(levels,WAVEFORM_POINTS);
    }finally{
      if(!OfflineContext && ctx && typeof ctx.close==='function') ctx.close().catch(()=>{});
    }
  }
  function loadRowWaveform(row){
    const supplied=normalizeWaveform(row&&row.waveform);
    if(supplied.length){ waveformCache.set(row.id,supplied); return Promise.resolve(supplied); }
    if(waveformCache.has(row.id)) return Promise.resolve(waveformCache.get(row.id));
    if(waveformLoads.has(row.id)) return waveformLoads.get(row.id);
    const userId=sessionUserId;
    const pending=findPlaybackBlob(row).then(result=>waveformFromBlob(result.blob)).then(values=>{
      if(sessionUserId!==userId || !values.length) return values;
      waveformCache.set(row.id,values);
      row.waveform=values;
      if(window.OliveCloud.saveRecordingWaveform){
        window.OliveCloud.saveRecordingWaveform(row.id,values)
          .catch(error=>console.warn('[O\'live recording waveform sync]',error));
      }
      if(expandedRecordingId===row.id) renderList();
      return values;
    }).catch(error=>{
      console.warn('[O\'live recording waveform]',error);
      return [];
    }).finally(()=>waveformLoads.delete(row.id));
    waveformLoads.set(row.id,pending);
    return pending;
  }
  function seekRow(row,ratio,playAfterSeek){
    const position=clamp(Number(ratio)||0,0,1)*rowDurationSeconds(row);
    playbackPositions.set(row.id,position);
    updatePlayerProgress(row.id,position);
    if(playAfterSeek || cloudPlayingId===row.id) playRow(row,position);
  }
  function positionAtWaveformPoint(row,waveform,clientX){
    const bounds=waveform.getBoundingClientRect();
    if(!bounds.width) return 0;
    const edgeSnap=Math.min(12,bounds.width*.04);
    let x=Number(clientX)-bounds.left;
    if(x<=edgeSnap) x=0;
    else if(x>=bounds.width-edgeSnap) x=bounds.width;
    return clamp(x/bounds.width,0,1)*rowDurationSeconds(row);
  }
  function bindWaveformScrubbing(waveform,row){
    let pointerId=null;
    let startX=0;
    let startPosition=0;
    let previewPosition=0;
    let moved=false;
    let wasPlaying=false;
    const preview=clientX=>{
      previewPosition=positionAtWaveformPoint(row,waveform,clientX);
      playbackPositions.set(row.id,previewPosition);
      updatePlayerProgress(row.id,previewPosition);
    };
    const finish=(event,cancelled)=>{
      if(pointerId===null || event.pointerId!==pointerId) return;
      try{ waveform.releasePointerCapture(pointerId); }catch(error){}
      pointerId=null;
      waveform.classList.remove('scrubbing');
      scrubbingRecordingId='';
      if(cancelled){
        const restored=wasPlaying?currentCloudPosition():startPosition;
        playbackPositions.set(row.id,restored);
        updatePlayerProgress(row.id,restored);
        return;
      }
      if(moved){
        if(wasPlaying) playRow(row,previewPosition);
        else seekRow(row,rowDurationSeconds(row)?previewPosition/rowDurationSeconds(row):0,false);
      }else playRow(row,previewPosition);
    };
    waveform.addEventListener('pointerdown',event=>{
      if(event.isPrimary===false || (event.pointerType==='mouse' && event.button!==0)) return;
      pointerId=event.pointerId;
      startX=event.clientX;
      startPosition=Number(playbackPositions.get(row.id))||0;
      wasPlaying=cloudPlayingId===row.id;
      moved=false;
      scrubbingRecordingId=row.id;
      waveform.classList.add('scrubbing');
      try{ waveform.setPointerCapture(pointerId); }catch(error){}
      preview(event.clientX);
    });
    waveform.addEventListener('pointermove',event=>{
      if(event.pointerId!==pointerId) return;
      if(Math.abs(event.clientX-startX)>=4) moved=true;
      if(moved) preview(event.clientX);
    });
    waveform.addEventListener('pointerup',event=>finish(event,false));
    waveform.addEventListener('pointercancel',event=>finish(event,true));
  }
  function applyLoopToActivePlayback(row,positionBefore){
    if(cloudPlayingId!==row.id) return;
    const region=activeLoopFor(row);
    const position=Number.isFinite(positionBefore)?positionBefore:currentCloudPosition();
    const target=region && position>=region.b-.01?region.a:position;
    // AudioBufferSourceNode의 반복을 끈 직후에는 내부 재생 위치와 표시 시간이
    // 달라질 수 있으므로, 디코딩 경로는 현재 들리던 위치에서 한 번 다시 연다.
    if(cloudPlaybackMode==='decoded'){ playRow(row,target); return; }
    if(isNativePlaybackMode() && target!==position) prepareNativeOffset(target);
  }
  function setLoopPoint(row,point){
    const current=clamp(cloudMediaId===row.id?currentCloudPosition():Number(playbackPositions.get(row.id))||0,
      0,rowDurationSeconds(row));
    const previous=loopRegionFor(row);
    const next={a:previous.a,b:previous.b,enabled:previous.enabled};
    if(point==='a'){
      next.a=current;
      if(next.b!==null && next.b-next.a<MIN_LOOP_SECONDS) next.b=null;
    }else{
      if(next.a===null) next.a=0;
      if(current-next.a<MIN_LOOP_SECONDS){
        setMessage('B 지점은 A보다 조금 뒤에 지정해 주세요',true);
        return;
      }
      next.b=current;
      next.enabled=true;
    }
    loopRegions.set(row.id,next);
    queueRecordingStateSave(row);
    applyLoopToActivePlayback(row,current);
    setMessage('');
    renderList();
  }
  function toggleLoop(row){
    const region=loopRegionFor(row);
    const current=cloudPlayingId===row.id?currentCloudPosition():Number(playbackPositions.get(row.id))||0;
    region.enabled=!region.enabled;
    loopRegions.set(row.id,region);
    queueRecordingStateSave(row);
    if(isNativePlaybackMode()) applyNativePlaybackSettings(row);
    applyLoopToActivePlayback(row,current);
    renderList();
  }
  function clearLoop(row){
    const current=cloudPlayingId===row.id?currentCloudPosition():Number(playbackPositions.get(row.id))||0;
    const region=loopRegionFor(row);
    loopRegions.set(row.id,{a:null,b:null,enabled:region.enabled});
    queueRecordingStateSave(row);
    if(isNativePlaybackMode()) applyNativePlaybackSettings(row);
    applyLoopToActivePlayback(row,current);
    renderList();
  }
  function setPlaybackRate(row,value,commit=false){
    const isActive=cloudPlayingId===row.id;
    const activePosition=isActive?currentCloudPosition():null;
    const rate=clamp(Math.round((Number(value)||1)/PLAYBACK_RATE_STEP)*PLAYBACK_RATE_STEP,
      PLAYBACK_RATE_MIN,PLAYBACK_RATE_MAX);
    playbackRates.set(row.id,rate);
    if(commit) queueRecordingStateSave(row);
    const player=document.getElementById(`record-player-${row.id}`);
    const output=player&&player.querySelector('.record-speed-control .record-rate-value');
    if(output) output.value=output.textContent=formatPlaybackRate(rate);
    if(isActive){
      if(isNativePlaybackMode()){
        if(needsPitchProcessing(row) && !cloudMediaUsesPersistentNative){
          switchActivePlaybackToPitchPreserving(row,activePosition);
          return;
        }
        applyNativePlaybackSettings(row);
        updateCloudMediaSessionPosition(row,activePosition);
        return;
      }
      if(cloudPlaybackMode==='decoded' && cloudSource && cloudDecodedContext){
        if(needsPitchProcessing(row) && !cloudStretchNode){
          switchActivePlaybackToPitchPreserving(row,activePosition);
          return;
        }
        cloudStartedOffset=activePosition;
        cloudStartedAt=cloudDecodedContext.currentTime;
        cloudStartedRate=rate;
        try{ cloudSource.playbackRate.setValueAtTime(rate,cloudDecodedContext.currentTime); }
        catch(error){ try{ cloudSource.playbackRate.value=rate; }catch(ignore){} }
        const stretchRate=cloudStretchNode&&cloudStretchNode.parameters&&
          cloudStretchNode.parameters.get('playbackRate');
        if(stretchRate){
          try{ stretchRate.setValueAtTime(rate,cloudDecodedContext.currentTime); }
          catch(error){ stretchRate.value=rate; }
        }
        updateCloudMediaSessionPosition(row,activePosition);
        return;
      }
      if(needsPitchProcessing(row)) switchActivePlaybackToPitchPreserving(row,activePosition);
      return;
    }
    if(cloudMediaId===row.id){
      if(cloudMediaUsesPersistentNative) applyNativePlaybackSettings(row,cloudNativeAudio);
      updateCloudMediaSessionPosition(row);
      if(commit) renderList();
      return;
    }
    if(commit) renderList();
  }
  function setTranspose(row,value,commit=false){
    const isActive=cloudPlayingId===row.id;
    const activePosition=isActive?currentCloudPosition():null;
    const next=clamp(Math.round(Number(value)||0),TRANSPOSE_MIN,TRANSPOSE_MAX);
    const changed=next!==rowTranspose(row);
    transposes.set(row.id,next);
    const player=document.getElementById(`record-player-${row.id}`);
    const output=player&&player.querySelector('.record-transpose-control .record-transpose-value');
    if(output) output.textContent=formatTranspose(next);
    const slider=player&&player.querySelector('.record-transpose-control input[type="range"]');
    if(slider && Number(slider.value)!==next) slider.value=String(next);
    if(changed) queueRecordingStateSave(row);
    if(isActive){
      /* 조옮김은 SoundTouch 경로에서만 된다. 없으면 그 경로로 옮긴다. */
      if(isNativePlaybackMode() || !cloudStretchNode){
        if(needsPitchProcessing(row)){
          switchActivePlaybackToPitchPreserving(row,activePosition);
          return;
        }
      }else{
        applyTransposeToStretchNode(row);
      }
      updateCloudMediaSessionPosition(row,activePosition);
      return;
    }
    if(commit) renderList();
  }
  function applyTransposeToStretchNode(row){
    const pitch=cloudStretchNode&&cloudStretchNode.parameters&&
      cloudStretchNode.parameters.get('pitch');
    if(!pitch) return;
    const value=transposeRatio(rowTranspose(row));
    try{ pitch.setValueAtTime(value,cloudDecodedContext.currentTime); }
    catch(error){ pitch.value=value; }
  }
  function formatTranspose(value){
    const semitones=Math.round(Number(value)||0);
    if(!semitones) return '0';
    return `${semitones>0?'+':''}${semitones}`;
  }
  /* 손잡이를 두 번 누르면 기준값으로 돌아간다. 배속은 1배, 조옮김은 원래 조다.
     드래그 중에는 발동하지 않는다. */
  function bindSliderReset(slider,resetValue,apply){
    let pointerId=null;
    let startX=0;
    let moved=false;
    let lastTapAt=0;
    let lastTapX=0;
    let lastResetAt=0;
    const reset=event=>{
      const now=performance.now();
      if(now-lastResetAt<120) return;
      lastResetAt=now;
      if(event) event.preventDefault();
      slider.value=String(resetValue);
      apply(resetValue);
    };
    slider.addEventListener('pointerdown',event=>{
      if(event.isPrimary===false) return;
      pointerId=event.pointerId;
      startX=event.clientX;
      moved=false;
    });
    slider.addEventListener('pointermove',event=>{
      if(event.pointerId===pointerId && Math.abs(event.clientX-startX)>5) moved=true;
    });
    slider.addEventListener('pointerup',event=>{
      if(event.pointerId!==pointerId) return;
      pointerId=null;
      if(moved){ lastTapAt=0; return; }
      const now=performance.now();
      if(now-lastTapAt<340 && Math.abs(event.clientX-lastTapX)<28) reset(event);
      else{ lastTapAt=now; lastTapX=event.clientX; }
    });
    slider.addEventListener('pointercancel',()=>{ pointerId=null; lastTapAt=0; });
    slider.addEventListener('dblclick',reset);
  }
  function bindPlaybackRateReset(slider,row){
    bindSliderReset(slider,1,value=>{
      slider.setAttribute('aria-valuetext',formatPlaybackRate(value));
      setPlaybackRate(row,value,true);
    });
  }
  function createExpandedPlayer(row){
    const player=document.createElement('div');
    player.className='record-player';
    player.id=`record-player-${row.id}`;
    player.dataset.recordingId=row.id;
    const play=document.createElement('button');
    play.type='button';
    play.className='record-player-play'+(cloudPlayingId===row.id?' playing':'');
    play.setAttribute('aria-label',`${row.title} ${cloudPlayingId===row.id?'일시 정지':'재생'}`);
    play.innerHTML='<span aria-hidden="true"></span>';
    play.addEventListener('click',()=>playRow(row));
    const detail=document.createElement('div'); detail.className='record-player-detail';
    const waveformWrap=document.createElement('div'); waveformWrap.className='record-waveform-wrap';
    const waveform=document.createElement('div'); waveform.className='record-waveform';
    waveform.tabIndex=0; waveform.setAttribute('role','slider');
    waveform.setAttribute('aria-label',`${row.title} 재생 위치`);
    waveform.setAttribute('aria-valuemin','0');
    waveform.setAttribute('aria-valuemax',String(Math.round(rowDurationSeconds(row))));
    const values=waveformCache.get(row.id)||normalizeWaveform(row.waveform);
    const shown=values.length?values:Array(WAVEFORM_POINTS).fill(8);
    if(!values.length) waveform.classList.add('loading');
    const region=loopRegionFor(row);
    const duration=rowDurationSeconds(row);
    if(region.a!==null) waveform.style.setProperty('--loop-start',`${duration?region.a/duration*100:0}%`);
    if(region.b!==null) waveform.style.setProperty('--loop-end',`${duration?region.b/duration*100:0}%`);
    waveform.classList.toggle('has-loop-start',region.a!==null);
    waveform.classList.toggle('has-loop-end',region.b!==null);
    waveform.classList.toggle('looping',Boolean(activeLoopFor(row) && region.a!==null && region.b!==null));
    const loopShade=document.createElement('span'); loopShade.className='record-loop-region';
    const markerA=document.createElement('span'); markerA.className='record-loop-marker start'; markerA.dataset.label='A';
    const markerB=document.createElement('span'); markerB.className='record-loop-marker end'; markerB.dataset.label='B';
    waveform.append(loopShade,createWaveformSvg(shown,'base'),createWaveformSvg(shown,'played'),markerA,markerB);
    waveformWrap.append(waveform);
    bindWaveformScrubbing(waveform,row);
    waveform.addEventListener('keydown',event=>{
      const duration=rowDurationSeconds(row);
      const current=Number(playbackPositions.get(row.id))||0;
      let next=current;
      if(event.key==='ArrowLeft') next=current-5;
      else if(event.key==='ArrowRight') next=current+5;
      else if(event.key==='Home') next=0;
      else if(event.key==='End') next=duration;
      else return;
      event.preventDefault();
      seekRow(row,duration?clamp(next,0,duration)/duration:0,false);
    });
    const times=document.createElement('div'); times.className='record-player-times';
    const elapsed=document.createElement('span'); elapsed.className='record-player-elapsed';
    const total=document.createElement('span'); total.textContent=formatDuration(row.duration_ms);
    times.append(elapsed,total);
    const tools=document.createElement('div'); tools.className='record-player-tools';
    const loopTools=document.createElement('div'); loopTools.className='record-loop-tools';
    const pointA=document.createElement('button'); pointA.type='button'; pointA.className='record-player-tool point'+(region.a!==null?' active':'');
    pointA.textContent='A'; pointA.setAttribute('aria-label',region.a===null?'현재 위치를 A 지점으로 지정':`A 지점 ${formatDuration(region.a*1000)}, 다시 지정`);
    pointA.addEventListener('click',()=>setLoopPoint(row,'a'));
    const pointB=document.createElement('button'); pointB.type='button'; pointB.className='record-player-tool point'+(region.b!==null?' active':'');
    pointB.textContent='B'; pointB.setAttribute('aria-label',region.b===null?'현재 위치를 B 지점으로 지정':`B 지점 ${formatDuration(region.b*1000)}, 다시 지정`);
    pointB.addEventListener('click',()=>setLoopPoint(row,'b'));
    const repeat=document.createElement('button'); repeat.type='button';
    repeat.className='record-player-tool icon repeat'+(region.enabled?' active':'');
    repeat.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 8A7 7 0 0 0 6.4 5.6L4.5 7.5M4.5 7.5V3.8M4.5 7.5h3.7M5.5 16A7 7 0 0 0 17.6 18.4l1.9-1.9M19.5 16.5v3.7M19.5 16.5h-3.7"/></svg>';
    repeat.setAttribute('aria-label',region.enabled?'반복 끄기':(region.a!==null&&region.b!==null?'A/B 구간 반복 켜기':'전체 반복 켜기'));
    repeat.setAttribute('aria-pressed',String(region.enabled));
    repeat.addEventListener('click',()=>toggleLoop(row));
    const clear=document.createElement('button'); clear.type='button'; clear.className='record-player-tool icon clear';
    clear.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
    clear.setAttribute('aria-label','A/B 지점 지우기');
    clear.disabled=region.a===null && region.b===null; clear.addEventListener('click',()=>clearLoop(row));
    loopTools.append(pointA,pointB,repeat,clear);
    const rateLabel=document.createElement('label'); rateLabel.className='record-rate-control record-speed-control';
    const rateText=document.createElement('span'); rateText.textContent='속도';
    const rateSlider=document.createElement('input'); rateSlider.type='range';
    rateSlider.min=String(PLAYBACK_RATE_MIN); rateSlider.max=String(PLAYBACK_RATE_MAX);
    rateSlider.step=String(PLAYBACK_RATE_STEP); rateSlider.value=String(rowPlaybackRate(row));
    rateSlider.setAttribute('aria-label',`${row.title} 재생 속도`);
    const rateValue=document.createElement('output'); rateValue.className='record-rate-value';
    rateValue.value=rateValue.textContent=formatPlaybackRate(rowPlaybackRate(row));
    rateSlider.addEventListener('input',()=>{
      rateSlider.setAttribute('aria-valuetext',formatPlaybackRate(rateSlider.value));
      setPlaybackRate(row,rateSlider.value,false);
    });
    rateSlider.addEventListener('change',()=>setPlaybackRate(row,rateSlider.value,true));
    bindPlaybackRateReset(rateSlider,row);
    const rateSpacer=document.createElement('span');
    rateSpacer.setAttribute('aria-hidden','true');
    rateLabel.append(rateText,rateSlider,rateSpacer,rateValue);
    tools.append(loopTools,rateLabel);
    /* 컨트롤 행은 재생 버튼 칸까지 넘어가 플레이어 전체 폭을 쓴다.
       그래야 A/B가 왼쪽 끝에 붙고 속도 슬라이더가 길어진다. */
    /* 조옮김은 속도와 같은 슬라이더로 두고 바로 위에 놓는다. 반음 단위라
       step은 1이며, 손잡이를 두 번 누르면 원래 조로 돌아간다. */
    const transposeLabel=document.createElement('label');
    transposeLabel.className='record-rate-control record-transpose-control';
    /* 왼쪽 끝은 플랫, 오른쪽 끝은 샵이라 방향이 바로 읽힌다. */
    const transposeFlat=document.createElement('span');
    transposeFlat.className='record-accidental';
    transposeFlat.setAttribute('aria-hidden','true');
    transposeFlat.textContent='♭';
    const transposeSharp=document.createElement('span');
    transposeSharp.className='record-accidental';
    transposeSharp.setAttribute('aria-hidden','true');
    transposeSharp.textContent='♯';
    const transposeSlider=document.createElement('input');
    transposeSlider.type='range';
    transposeSlider.min=String(TRANSPOSE_MIN);
    transposeSlider.max=String(TRANSPOSE_MAX);
    transposeSlider.step='1';
    transposeSlider.value=String(rowTranspose(row));
    transposeSlider.setAttribute('aria-label',`${row.title} 조옮김`);
    transposeSlider.setAttribute('aria-valuetext',formatTranspose(rowTranspose(row)));
    const transposeValue=document.createElement('output');
    transposeValue.className='record-rate-value record-transpose-value';
    transposeValue.value=transposeValue.textContent=formatTranspose(rowTranspose(row));
    transposeSlider.addEventListener('input',()=>{
      transposeSlider.setAttribute('aria-valuetext',formatTranspose(transposeSlider.value));
      setTranspose(row,transposeSlider.value,false);
    });
    transposeSlider.addEventListener('change',()=>setTranspose(row,transposeSlider.value,true));
    bindSliderReset(transposeSlider,0,value=>{
      transposeSlider.setAttribute('aria-valuetext',formatTranspose(value));
      setTranspose(row,value,true);
    });
    transposeLabel.append(transposeFlat,transposeSlider,transposeSharp,transposeValue);
    tools.insertBefore(transposeLabel,rateLabel);
    detail.append(waveformWrap,times); player.append(play,detail,tools);
    requestAnimationFrame(()=>updatePlayerProgress(row.id,
      cloudPlayingId===row.id?currentCloudPosition():Number(playbackPositions.get(row.id))||0));
    if(!values.length) loadRowWaveform(row);
    return player;
  }
  /* 목록에서 한 번에 하나만 펼친다. 연습 링크도 같은 목록에 속하므로 함께 접는다. */
  function collapseExpandedRow(){
    if(!expandedRecordingId) return;
    const id=expandedRecordingId;
    expandedRecordingId='';
    if(cloudMediaId===id) stopCloudPlayback();
    else renderList();
  }
  function collapsePracticeLink(){
    if(window.OlivePracticeLinks && typeof window.OlivePracticeLinks.collapse==='function'){
      window.OlivePracticeLinks.collapse();
    }
  }
  function toggleRowExpanded(row){
    if(expandedRecordingId===row.id){
      expandedRecordingId='';
      if(cloudMediaId===row.id) stopCloudPlayback();
      else renderList();
      return;
    }
    if(cloudMediaId && cloudMediaId!==row.id) stopCloudPlayback();
    collapsePracticeLink();
    expandedRecordingId=row.id;
    renderList();
  }
  /* 목록 길이 제한 50개는 녹음과 연습 링크를 합쳐서 센다. */
  function practiceLinkCount(){
    return window.OlivePracticeLinks && typeof window.OlivePracticeLinks.count==='function'
      ? Number(window.OlivePracticeLinks.count())||0 : 0;
  }
  function renderUsage(){
    const total=rows.length+practiceLinkCount();
    recordUsage.textContent=`${total} / ${MAX_RECORDINGS}`;
    /* 가득 차고 나서야 알게 되면 늦다. 다섯 자리 남았을 때부터 색으로 알린다. */
    recordUsage.classList.toggle('near-limit',total>=MAX_RECORDINGS-5 && total<MAX_RECORDINGS);
    recordUsage.classList.toggle('at-limit',total>=MAX_RECORDINGS);
  }
  /* 목록 맨 왼쪽의 작은 올리브. 누르면 즐겨찾기가 풀린다. */
  function createFavoriteMark(row,onRemove){
    const mark=document.createElement('button');
    mark.type='button';
    mark.className='record-row-favorite';
    mark.setAttribute('aria-label',`${row.title} 즐겨찾기 해제`);
    const olive=document.createElement('span');
    olive.className='record-row-olive';
    olive.setAttribute('aria-hidden','true');
    mark.appendChild(olive);
    mark.addEventListener('click',event=>{ event.stopPropagation(); onRemove(); });
    return mark;
  }
  function createRecordingEntry(row){
    const entry=document.createElement('div'); entry.className='record-entry';
    const item=document.createElement('div'); item.className='record-row';
    const open=document.createElement('button'); open.type='button'; open.className='record-row-open';
    open.setAttribute('aria-expanded',expandedRecordingId===row.id?'true':'false');
    open.setAttribute('aria-controls',`record-player-${row.id}`);
    open.setAttribute('aria-label',`${row.title} 녹음 ${expandedRecordingId===row.id?'접기':'열기'}`);
    const copy=document.createElement('span'); copy.className='record-row-copy';
    const title=document.createElement('strong'); title.textContent=row.title;
    const date=document.createElement('small'); date.textContent=formatDate(row.recorded_at);
    copy.append(title,date);
    const duration=document.createElement('span'); duration.className='record-row-duration'; duration.textContent=formatDuration(row.duration_ms);
    open.append(copy,duration);
    open.addEventListener('click',()=>toggleRowExpanded(row));
    const more=document.createElement('button'); more.type='button'; more.className='record-row-more';
    more.textContent='•••'; more.setAttribute('aria-label',`${row.title} 메뉴`);
    more.addEventListener('click',()=>openMenu(row,more));
    if(row.pinned){
      entry.classList.add('favorite');
      item.appendChild(createFavoriteMark(row,()=>setRecordingFavorite(row,false)));
    }
    item.append(open,more); entry.appendChild(item);
    if(expandedRecordingId===row.id) entry.appendChild(createExpandedPlayer(row));
    return entry;
  }
  /* ── 연습 설정 저장 ── */
  let stateSaveTimer=0;
  function queueRecordingStateSave(row){
    if(!row || !currentUser) return;
    if(stateSaveTimer) clearTimeout(stateSaveTimer);
    stateSaveTimer=setTimeout(()=>flushRecordingState(row),STATE_SAVE_DELAY);
  }
  async function flushRecordingState(row){
    stateSaveTimer=0;
    if(!row || !currentUser) return;
    const region=loopRegionFor(row);
    const rate=rowPlaybackRate(row);
    const transpose=rowTranspose(row);
    const loopA=region.a===null?null:Math.round(region.a*1000);
    const loopB=region.b===null?null:Math.round(region.b*1000);
    try{
      await window.OliveCloud.saveRecordingState(row.id,{
        rate,transpose,loopA,loopB,loopEnabled:region.enabled,
      });
      /* 다시 불러올 때까지 목록 행도 맞춰 둔다. */
      row.playback_rate=rate;
      row.transpose=transpose;
      row.loop_a_ms=loopA;
      row.loop_b_ms=loopB;
      row.loop_enabled=region.enabled;
    }catch(e){ /* 연습 설정 저장 실패는 재생을 막지 않는다. */ }
  }

  /* ── 여러 항목 선택 ── */
  function renderSelectionBar(){
    if(!recordSelectBar) return;
    recordSelectBar.hidden=!selecting;
    if(recordSelect) recordSelect.setAttribute('aria-pressed',String(selecting));
    if(recordSelectCount) recordSelectCount.textContent=`${selectedIds.size}개 선택`;
    if(recordSelectDelete) recordSelectDelete.disabled=!selectedIds.size;
  }
  function setSelecting(next){
    selecting=Boolean(next);
    selectedIds.clear();
    if(selecting){
      /* 펼쳐 둔 재생기는 접는다. 선택 중에는 행을 열 수 없다. */
      collapseExpandedRow();
      collapsePracticeLink();
    }
    renderSelectionBar();
    renderList();
  }
  function decorateForSelection(node,entry){
    node.classList.add('selecting');
    node.classList.remove('favorite');
    const row=node.querySelector('.record-row');
    if(!row) return;
    const mark=row.querySelector('.record-row-favorite');
    if(mark) mark.remove();
    const box=document.createElement('label');
    box.className='record-select-box';
    const input=document.createElement('input');
    input.type='checkbox';
    input.checked=selectedIds.has(entry.id);
    input.setAttribute('aria-label',`${entry.title||''} 선택`);
    input.addEventListener('change',()=>{
      if(input.checked) selectedIds.add(entry.id);
      else selectedIds.delete(entry.id);
      renderSelectionBar();
    });
    box.appendChild(input);
    row.insertBefore(box,row.firstChild);
  }
  async function deleteSelectedItems(){
    if(!selectedIds.size) return;
    const recordingRows=rows.filter(row=>selectedIds.has(row.id));
    const recordingIds=new Set(recordingRows.map(row=>row.id));
    const linkIds=[...selectedIds].filter(id=>!recordingIds.has(id));
    const total=recordingRows.length+linkIds.length;
    if(!window.confirm(`선택한 ${total}개를 삭제할까요?\n다른 기기에서도 사라지며 복구할 수 없습니다.`)) return;
    setMessage('선택한 항목을 삭제하는 중입니다');
    try{
      if(recordingRows.length) await window.OliveCloud.deleteRecordings(recordingRows);
      if(linkIds.length && window.OlivePracticeLinks &&
         typeof window.OlivePracticeLinks.deleteMany==='function'){
        await window.OlivePracticeLinks.deleteMany(linkIds);
      }
      setSelecting(false);
      await loadRecordings(true);
      setMessage(`${total}개를 삭제했습니다`);
    }catch(error){
      console.warn('[O\'live bulk delete]',error);
      setMessage('선택한 항목을 삭제하지 못했습니다',true);
    }
  }

  /* 연습 링크는 자기 행만 만들어 넘긴다. 목록 DOM은 이 파일이 소유한다. */
  function practiceLinkEntries(){
    if(!window.OlivePracticeLinks || typeof window.OlivePracticeLinks.entries!=='function') return [];
    try{ return window.OlivePracticeLinks.entries()||[]; }
    catch(e){ return []; }
  }
  /* 녹음·업로드·YouTube를 한 목록에 섞고 최신 항목을 위에 둔다. */
  function renderList(){
    renderUsage();
    recordList.innerHTML='';
    /* 목록에는 녹음·업로드·YouTube가 함께 들어간다. 문구를 녹음으로 한정하지 않는다. */
    if(loadingList){
      const state=document.createElement('p'); state.className='record-empty'; state.textContent='목록을 불러오는 중입니다';
      recordList.appendChild(state); return;
    }
    const entries=rows.map(row=>({
      id:row.id,
      title:row.title,
      at:Date.parse(row.recorded_at)||0,
      pinned:Boolean(row.pinned),
      node:()=>createRecordingEntry(row),
    })).concat(practiceLinkEntries());
    if(!entries.length){
      const state=document.createElement('p'); state.className='record-empty'; state.textContent='저장된 항목이 없습니다';
      recordList.appendChild(state); return;
    }
    /* 고정한 항목이 먼저, 그다음이 최신순이다. 두 목록을 합친 뒤 정렬해야
       녹음본과 링크의 고정이 서로 섞인다. */
    entries.sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0) || b.at-a.at);
    entries.forEach(entry=>{
      const node=entry.node();
      if(selecting) decorateForSelection(node,entry);
      recordList.appendChild(node);
    });
  }
  function waitRecordingListRetry(ms){
    return new Promise(resolve=>setTimeout(resolve,ms));
  }
  function recordingListRequestIsCurrent(userId,token){
    return token===recordingListLoadToken && Boolean(currentUser) && currentUser.id===userId;
  }
  async function requestRecordingRows(userId,token){
    const delays=[0,250,750];
    let lastError=null;
    for(let attempt=0;attempt<delays.length;attempt++){
      if(delays[attempt]) await waitRecordingListRetry(delays[attempt]);
      if(!recordingListRequestIsCurrent(userId,token)) return null;
      try{ return await window.OliveCloud.listRecordings(); }
      catch(error){
        lastError=error;
        if(!navigator.onLine) break;
      }
    }
    throw lastError||new Error('Recording list unavailable');
  }
  function loadRecordings(force=false){
    if(!currentUser){
      recordingListLoadToken++;
      recordingListLoadPromise=null;
      recordingListLoadUserId='';
      loadingList=false; rows=[]; renderList();
      return Promise.resolve();
    }
    const userId=currentUser.id;
    if(!force && recordingListLoadPromise && recordingListLoadUserId===userId){
      return recordingListLoadPromise;
    }
    const token=++recordingListLoadToken;
    recordingListLoadUserId=userId;
    loadingList=!rows.length;
    renderList();
    const task=(async()=>{
      try{
        const nextRows=await requestRecordingRows(userId,token);
        if(!nextRows || !recordingListRequestIsCurrent(userId,token)) return;
        rows=nextRows;
        rows.forEach(row=>{
          const waveform=normalizeWaveform(row.waveform);
          if(waveform.length) waveformCache.set(row.id,waveform);
        });
        pruneCloudPlaybackCache();
        await hydrateCloudPlaybackCache(userId);
        if(recordingListRequestIsCurrent(userId,token)) setMessage('');
      }catch(error){
        if(!recordingListRequestIsCurrent(userId,token)) return;
        console.warn('[O\'live recording list]',error);
        setMessage(rows.length
          ? '녹음 목록을 새로고침하지 못했습니다'
          : '녹음 목록을 불러오지 못했습니다 · 연결되면 다시 시도합니다',true);
      }finally{
        if(recordingListRequestIsCurrent(userId,token)){
          loadingList=false;
          renderList();
        }
      }
    })();
    const tracked=task.finally(()=>{
      if(recordingListLoadPromise===tracked){
        recordingListLoadPromise=null;
        recordingListLoadUserId='';
      }
    });
    recordingListLoadPromise=tracked;
    return tracked;
  }
  function setUploadButtonState(label,busy){
    recordUpload.disabled=Boolean(busy);
    recordUpload.setAttribute('aria-label',label);
  }
  async function uploadExternalFile(file){
    if(!currentUser || !file || recordUpload.disabled) return;
    if(rows.length>=MAX_RECORDINGS){
      setMessage('목록에는 최대 50개까지 저장할 수 있습니다',true); return;
    }
    const mimeType=uploadMimeType(file);
    if(!mimeType){ setMessage('지원하는 오디오 파일을 선택해 주세요',true); return; }
    if(!file.size || file.size>MAX_UPLOAD_BYTES){
      setMessage('업로드 파일은 15MB 이하여야 합니다',true); return;
    }
    setUploadButtonState('오디오 파일 확인 중',true);
    setMessage('오디오 정보를 확인하는 중입니다');
    let durationMs=0;
    try{
      durationMs=await audioFileDuration(file);
    }catch(error){
      console.warn('[O\'live recording upload metadata]',error);
      setMessage('이 오디오 파일을 확인할 수 없습니다',true);
      setUploadButtonState('오디오 파일 업로드',false);
      recordUploadInput.value='';
      return;
    }
    try{
      if(durationMs<1000 || durationMs>MAX_UPLOAD_DURATION_MS){
        setMessage('업로드 파일은 1초 이상 30분 이하여야 합니다',true); return;
      }
      const uploaded={
        id:makeId(),blob:file,title:uploadTitle(file),durationMs,mimeType,
        extension:extensionFor(mimeType),waveform:[],playbackGain:1,
        recordedAt:new Date().toISOString(),sourceType:'upload',
      };
      recordUpload.setAttribute('aria-label','오디오 파일 업로드 중');
      setMessage('클라우드에 업로드하는 중입니다');
      await window.OliveCloud.uploadRecording(uploaded);
      rememberCloudBlob(uploaded,file);
      await loadRecordings(true);
      recordListCard.open=true;
      const savedRow=rows.find(row=>row.id===uploaded.id)||uploaded;
      await cacheRowBlob(savedRow,file);
      setMessage('목록에 추가했습니다');
    }catch(error){
      const detail=String(error&&error.message||'');
      const code=String(error&&error.code||'');
      console.warn('[O\'live recording upload cloud]',code,detail);
      const message=/count limit/i.test(detail) ? '목록에는 최대 50개까지 저장할 수 있습니다'
        : /storage limit|too large|payload.*large|maximum.*size/i.test(detail) ? '녹음 저장 용량이 가득 찼습니다'
        : /^DB-|schema/i.test(code+' '+detail) ? `클라우드 저장소 업데이트가 필요합니다 · ${SCHEMA_ERROR_CODE}`
        : /mime|unsupported|not supported/i.test(detail) ? `MP3 업로드를 위한 저장소 업데이트가 필요합니다 · ${SCHEMA_ERROR_CODE}`
        : !navigator.onLine ? '인터넷에 연결한 뒤 다시 업로드해 주세요'
        : '파일을 업로드하지 못했습니다. 다시 시도해 주세요';
      setMessage(message,true);
    }finally{
      setUploadButtonState('오디오 파일 업로드',false);
      recordUploadInput.value='';
    }
  }
  function recordDragHasFiles(event){
    const transfer=event&&event.dataTransfer;
    if(!transfer) return false;
    const types=Array.from(transfer.types||[]);
    if(types.includes('Files')) return true;
    return Array.from(transfer.items||[]).some(item=>item&&item.kind==='file');
  }
  function setRecordDropActive(active){
    recordListCard.classList.toggle('record-drop-active',Boolean(active));
  }
  function resetRecordDrop(){
    recordDragDepth=0;
    setRecordDropActive(false);
  }
  function handleRecordDragEnter(event){
    if(!currentUser || recordUpload.disabled || !recordDragHasFiles(event)) return;
    event.preventDefault();
    recordDragDepth++;
    setRecordDropActive(true);
  }
  function handleRecordDragOver(event){
    if(!currentUser || recordUpload.disabled || !recordDragHasFiles(event)) return;
    event.preventDefault();
    if(event.dataTransfer) event.dataTransfer.dropEffect='copy';
    setRecordDropActive(true);
  }
  function handleRecordDragLeave(event){
    if(!recordDragDepth) return;
    recordDragDepth=Math.max(0,recordDragDepth-1);
    if(!recordDragDepth) setRecordDropActive(false);
  }
  function handleRecordDrop(event){
    if(!recordDragHasFiles(event)) return;
    event.preventDefault();
    const files=Array.from(event.dataTransfer&&event.dataTransfer.files||[]);
    resetRecordDrop();
    if(!currentUser || recordUpload.disabled || !files.length) return;
    const file=files.find(item=>uploadMimeType(item))||files[0];
    uploadExternalFile(file);
  }
  async function saveDraft(){
    if(!draft || recordSave.disabled) return;
    const title=recordTitle.value.trim();
    if(!title){ recordTitle.focus(); setMessage('녹음 이름을 입력해 주세요',true); return; }
    draft.title=title.slice(0,80);
    recordSave.disabled=recordDiscard.disabled=true;
    recordSave.textContent='저장 중…'; setMessage('클라우드에 저장하는 중입니다');
    try{
      const saved={...draft,id:makeId()};
      await window.OliveCloud.uploadRecording(saved);
      rememberCloudBlob(saved,saved.blob);
      await cacheRowBlob(saved,saved.blob);
      discardDraft(); await loadRecordings(true); recordListCard.open=true; setMessage('클라우드에 저장했습니다');
    }catch(error){
      const message=/count limit/i.test(error&&error.message||'') ? '녹음은 최대 50개까지 저장할 수 있습니다'
        : /storage limit/i.test(error&&error.message||'') ? '녹음 저장 용량이 가득 찼습니다'
        : !navigator.onLine ? '인터넷에 연결한 뒤 다시 저장해 주세요'
        : '녹음을 저장하지 못했습니다. 다시 시도해 주세요';
      setMessage(message,true);
    }finally{
      recordSave.disabled=recordDiscard.disabled=false;
      recordSave.textContent='저장';
    }
  }
  async function setRecordingFavorite(row,next){
    if(!row) return;
    try{
      await window.OliveCloud.setRecordingPinned(row.id,next);
      await loadRecordings(true);
    }catch(e){ setMessage('즐겨찾기를 바꾸지 못했습니다',true); }
  }
  async function togglePinSelected(){
    const row=selectedRow; closeMenu();
    await setRecordingFavorite(row,!(row&&row.pinned));
  }
  function openMenu(row,trigger){
    selectedRow=row; menuTrigger=trigger; menuTitle.textContent=row.title;
    if(menuPin) menuPin.textContent=row.pinned?'즐겨찾기 해제':'즐겨찾기';
    if(app) app.setAttribute('inert','');
    menuBackdrop.hidden=false;
    requestAnimationFrame(()=>menuBackdrop.classList.add('open'));
    document.body.classList.add('record-menu-open');
    setTimeout(()=>menuRename.focus(),50);
  }
  function closeMenu(){
    menuBackdrop.classList.remove('open');
    document.body.classList.remove('record-menu-open');
    setTimeout(()=>{
      if(menuBackdrop.classList.contains('open')) return;
      menuBackdrop.hidden=true;
      if(app) app.removeAttribute('inert');
      if(menuTrigger && menuTrigger.isConnected) menuTrigger.focus();
      menuTrigger=null;
    },220);
  }
  async function renameSelected(){
    const row=selectedRow; closeMenu();
    if(!row) return;
    const next=window.prompt('녹음 이름',row.title);
    if(next===null || !next.trim() || next.trim()===row.title) return;
    try{ await window.OliveCloud.renameRecording(row.id,next.trim().slice(0,80)); await loadRecordings(true); }
    catch(e){ setMessage('이름을 변경하지 못했습니다',true); }
  }
  async function downloadSelected(){
    const row=selectedRow; closeMenu();
    if(!row) return;
    setMessage('다운로드를 준비하는 중입니다');
    try{
      const result=await findPlaybackBlob(row);
      const url=URL.createObjectURL(result.blob);
      const link=document.createElement('a'); link.href=url;
      link.download=safeFileName(row.title,extensionFor(row.mime_type));
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000); setMessage('다운로드를 시작했습니다');
    }catch(e){ setMessage('녹음을 다운로드하지 못했습니다',true); }
  }
  async function deleteSelected(){
    const row=selectedRow; closeMenu();
    if(!row || !window.confirm(`“${row.title}” 녹음을 삭제할까요?\n다른 기기에서도 사라지며 복구할 수 없습니다.`)) return;
    setMessage('녹음을 삭제하는 중입니다');
    try{
      await window.OliveCloud.deleteRecording(row);
      forgetCloudBlob(row.id);
      const cache=recordingCache();
      if(cache && currentUser) await cache.remove(currentUser.id,row.id);
      await loadRecordings(true); setMessage('녹음을 삭제했습니다');
    }
    catch(e){ setMessage('녹음을 삭제하지 못했습니다',true); }
  }
  function applySession(user){
    const nextId=user&&user.id||'';
    if(sessionUserId!==nextId){
      recordingListLoadToken++;
      recordingListLoadPromise=null;
      recordingListLoadUserId='';
      loadingList=false;
    }
    if(sessionUserId && sessionUserId!==nextId){
      const previousId=sessionUserId;
      if(recording || startPending) stopRecording();
      discardDraft(); stopCloudPlayback(); clearCloudPlaybackCache();
      waveformCache.clear(); waveformLoads.clear(); playbackPositions.clear(); expandedRecordingId='';
      const cache=recordingCache();
      if(cache) cache.clearUser(previousId).catch(error=>console.warn('[O\'live recording cache clear]',error));
    }
    sessionUserId=nextId; currentUser=user||null;
    recordGuest.hidden=Boolean(currentUser);
    recordWorkspace.hidden=!currentUser;
    recordListCard.hidden=!currentUser;
    if(currentUser) loadRecordings();
    else{ resetRecordDrop(); rows=[]; renderList(); renderIdle(); }
  }

  recordConnect.addEventListener('click',()=>window.OliveCloud.openAccount());
  recordToggle.addEventListener('click',()=>{
    const mode=recordToggle.dataset.mode;
    if(mode==='recording' || mode==='starting') stopRecording();
    else if(mode==='preview') toggleDraftPlayback();
    else startRecording();
  });
  recordDiscard.addEventListener('click',discardDraft);
  recordSave.addEventListener('click',saveDraft);
  recordTitle.addEventListener('input',()=>{ if(draft) draft.title=recordTitle.value; });
  recordUpload.addEventListener('click',()=>recordUploadInput.click());
  recordUploadInput.addEventListener('change',()=>{
    const file=recordUploadInput.files&&recordUploadInput.files[0];
    if(file) uploadExternalFile(file);
  });
  recordListCard.addEventListener('dragenter',handleRecordDragEnter);
  recordListCard.addEventListener('dragover',handleRecordDragOver);
  recordListCard.addEventListener('dragleave',handleRecordDragLeave);
  recordListCard.addEventListener('drop',handleRecordDrop);
  document.addEventListener('dragend',resetRecordDrop);
  document.addEventListener('drop',resetRecordDrop);
  menuBackdrop.addEventListener('click',event=>{ if(event.target===menuBackdrop) closeMenu(); });
  menuBackdrop.addEventListener('keydown',event=>{ if(event.key==='Escape'){ event.preventDefault(); closeMenu(); } });
  if(menuPin) menuPin.addEventListener('click',togglePinSelected);
  if(recordSelect) recordSelect.addEventListener('click',()=>setSelecting(!selecting));
  if(recordSelectCancel) recordSelectCancel.addEventListener('click',()=>setSelecting(false));
  if(recordSelectDelete) recordSelectDelete.addEventListener('click',deleteSelectedItems);
  menuRename.addEventListener('click',renameSelected);
  menuDownload.addEventListener('click',downloadSelected);
  menuDelete.addEventListener('click',deleteSelected);
  draftAudio.addEventListener('play',()=>{ recordState.textContent='재생 중'; setButtonMode('preview'); setTabSounding('trainer',true,'recording-preview'); });
  draftAudio.addEventListener('pause',()=>{ if(draft){ recordState.textContent='녹음 확인'; setButtonMode('preview'); } setTabSounding('trainer',false,'recording-preview'); });
  draftAudio.addEventListener('ended',()=>{ draftStartedOffset=0; recordState.textContent='녹음 확인'; setButtonMode('preview'); setTabSounding('trainer',false,'recording-preview'); });
  registerTransport({
    isPlaying:()=>recording || startPending,
    stop:()=>{
      if(recording || startPending) stopRecording();
    },
    keepWhenHidden:true,
  });
  registerTransport({
    isPlaying:()=>draftIsPlaying() || Boolean(cloudPlayingId) || cloudMediaSessionActive,
    stop:()=>{ pauseDraftPlayback(false); stopCloudPlayback(); },
    // 저장된 파일은 자체 잠금화면 컨트롤을 유지한다. 실제 녹음을 시작할 때는
    // 위에서 이 재생 세션을 먼저 닫아 두 기능이 동시에 마이크 세션을 차지하지 않는다.
    keepWhenHidden:true,
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible' && currentUser) loadRecordings();
    if(cloudMediaSessionActive && cloudMediaId){
      cloudMediaPositionUpdatedAt=0;
      refreshCloudMediaSessionPosition(0);
    }
    if(recording && document.visibilityState==='hidden') recordingInterruptedWhileHidden=true;
  });
  window.addEventListener('online',()=>{ if(currentUser) loadRecordings(true); });
  function stopPlaybackForOtherTool(){
    pauseDraftPlayback(false);
    if(cloudPlayingId){
      playbackPositions.set(cloudPlayingId,currentCloudPosition());
    }
    if(cloudPlayingId || cloudMediaId) stopCloudPlayback(false);
  }
  document.addEventListener('olive-practice-links-change',renderList);
  window.OliveRecorder={
    isRecording:()=>recording || startPending,
    stopPlayback:stopPlaybackForOtherTool,
    collapse:collapseExpandedRow,
    resumeAfterVisibility,
  };
  window.OliveCloud.subscribeSession(applySession);
  renderIdle(); renderList();
})();

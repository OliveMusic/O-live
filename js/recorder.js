/* ===================== 녹음 =====================
   계정에 연결한 사용자가 마이크 녹음을 확인한 뒤 비공개로 저장한다. */
(function(){
  'use strict';

  const MAX_DURATION_MS=5*60*1000;
  const MAX_RECORDINGS=50;
  /* 녹음은 오디오 파일을 들고 있어 한 개마다 저장 공간을 쓴다. 연습 링크는 영상 id와
     제목뿐이고 영상은 YouTube에 있으므로 같은 칸을 나눠 쓸 까닭이 없다.
     서버(supabase/015)도 둘을 따로 센다. */
  const MAX_LINKS=200;
  const MAX_UPLOAD_BYTES=15*1024*1024;
  const MAX_UPLOAD_DURATION_MS=30*60*1000;
  const WAVEFORM_POINTS=160;
  const WAVEFORM_MAX_POINTS=240;
  const PLAYBACK_RATE_MIN=.5;
  const PLAYBACK_RATE_MAX=1.5;
  const PLAYBACK_RATE_STEP=.05;
  const SOUND_TOUCH_PROCESSOR_URL='./vendor/soundtouch/soundtouch-processor.js?v=198';
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
  const recordMetro=document.getElementById('recordMetro');
  const metroSheet=document.getElementById('recordMetroSheet');
  const metroSheetClose=document.getElementById('recordMetroClose');
  const metroSheetBpm=document.getElementById('recordMetroBpm');
  const metroSheetMinus=document.getElementById('recordMetroMinus');
  const metroSheetPlus=document.getElementById('recordMetroPlus');
  const metroSheetTap=document.getElementById('recordMetroTap');
  const metroSheetMeters=document.getElementById('recordMetroMeters');
  const metroSheetSubs=document.getElementById('recordMetroSubs');
  const metroSheetAccent=document.getElementById('recordMetroAccent');
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
  let cloudKeepAlivePending=false, cloudKeepAliveRestored=false;
  let cloudLastReportedPosition=0;
  let cloudStreamFeed=null;
  /* 임시 계측: 소리는 MediaStream을 거쳐 <audio>로 나간다. 그 통로에 얼마가 담겨
     있는지는 '만든 양'과 '내보낸 양'의 차로만 잰다 — 운반자가 돌기 시작한 순간의
     두 시계를 적어 두고 탐색할 때 견준다. 원인을 잡으면 지운다. */
  let cloudTransportClockCtx=null, cloudTransportClockEl=null;
  function transportLag(ctx){
    try{
      if(cloudTransportClockCtx==null || !ctx) return null;
      const produced=ctx.currentTime-cloudTransportClockCtx;
      const played=cloudTransportAudio.currentTime-cloudTransportClockEl;
      return {
        만든양:Number(produced.toFixed(2)),
        내보낸양:Number(played.toFixed(2)),
        통로에남은양:Number((produced-played).toFixed(3)),
      };
    }catch(error){ return null; }
  }
  let cloudTransportPlayPromise=null;
  let cloudTransportPlayGeneration=0;
  let cloudStretchNode=null;
  let cloudStretchOpenTimer=0;
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
  let switchingToPitch=false;
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
      /* 자리를 지키려고 무음을 흘리는 중이다. 이것을 재생 시작으로 읽으면 잠금화면이
         '재생 중'으로 바뀐다. 딱 한 번만 삼킨다 — 계속 삼키면 iOS가 운반자를 직접
         재생해 재개하는 길이 막힌다. */
      if(cloudKeepAlivePending){
        cloudKeepAlivePending=false;
        updateCloudMediaSessionState();
        if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark(
          'recording-transport:keepalive-playing');
        return;
      }
      if(!cloudMediaId) return;
      cloudTransportArmed=true;
      /* 임시 계측: 통로가 돌기 시작한 자리. 원인을 잡으면 지운다. */
      try{
        cloudTransportClockCtx=cloudTransportContext?cloudTransportContext.currentTime:null;
        cloudTransportClockEl=audio.currentTime;
      }catch(error){ cloudTransportClockCtx=null; }
      updateCloudMediaSessionState();
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-transport:playing');
    });
    audio.addEventListener('pause',()=>{
      if(cloudTransportInternalPause) return;
      if(!cloudTransportArmed || !cloudPlayingId){
        /* 이미 멈춘 상태인데 iOS가 운반자를 또 멈췄다. 그대로 두면 자리를 놓쳐
           페이지가 잠든다. 쉬는 동안 한 번만 되살린다 — 무한히 되받으면 잠금화면
           그림이 깜빡인다. */
        if(cloudMediaId && !cloudKeepAliveRestored && shouldKeepCloudTransportFlowing()){
          cloudKeepAliveRestored=true;
          keepCloudTransportFlowing({restore:true});
        }
        return;
      }
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
    if(cloudStreamFeed){
      try{ cloudStreamFeed.stop(); }catch(error){}
      try{ cloudStreamFeed.disconnect(); }catch(error){}
      cloudStreamFeed=null;
    }
    cloudTransportDestination=null;
    cloudTransportContext=null;
    cloudTransportArmed=false;
    cloudTransportPlayPromise=null;
  }
  /* 목적지에 아무것도 연결돼 있지 않으면 프레임이 나가지 않는다. 그런데 운반자는
     일시정지 중에도 계속 돌고 있으므로(그래야 iOS가 페이지를 재우지 않는다) 굶어서
     마지막 조각을 되풀이한다 — 구간에서 잠금화면의 일시정지를 눌렀을 때 아주 짧은
     소리가 무한히 반복되던 것이 그것이다. 재생을 멈추면 releaseCloudSource()가
     게인을 떼어 목적지의 입력이 하나도 남지 않는다.

     그래서 소리와 무관하게 무음을 끊임없이 흘려 둔다. 값이 0인 상수원이라 들리는
     것은 달라지지 않고, 통로만 살아 있게 한다. */
  function keepCloudStreamFed(ctx,destination){
    try{
      if(typeof ctx.createConstantSource==='function'){
        const idle=ctx.createConstantSource();
        idle.offset.value=0;
        idle.connect(destination);
        idle.start();
        cloudStreamFeed=idle;
        return;
      }
      const silence=ctx.createBufferSource();
      silence.buffer=ctx.createBuffer(1,128,ctx.sampleRate);
      silence.loop=true;
      silence.connect(destination);
      silence.start();
      cloudStreamFeed=silence;
    }catch(error){ cloudStreamFeed=null; }
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
      keepCloudStreamFed(ctx,destination);
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
  /* 멈춰도 운반자는 계속 흘려 둔다. 소리가 끊기면 iOS가 10.7초 뒤 오디오 엔진의
     렌더링을 멈추고 이윽고 페이지를 통째로 재운다. 그러면 잠금화면에서 누른 재생이
     잠금을 풀 때까지 배달되지 않는다 — 메트로놈에서 겪고 고친 것과 같은 사슬이다.
     재생이 멈춰 있으므로 흐르는 것은 무음이다. audio-runtime.js의
     keepBackgroundStreamFlowing()과 같은 처방이다. */
  /* 자리를 지켜야 하는 것은 **가려진** 페이지뿐이다. 앞에 있는 동안에는 iOS가 재우지
     않으므로 지킬 까닭이 없고, 오히려 해롭다 — 앞에서는 파형 탭과 AB 구간이 재생을
     쉼 없이 여닫는데 운반자를 계속 흘려 두면 요소의 버퍼가 밀려, 들리는 자리와 코드가
     아는 자리가 어긋난다. 탭한 뒤 이전 대목이 잠깐 더 들리다 옮겨 가던 것이 그것이다. */
  function shouldKeepCloudTransportFlowing(){
    return Boolean(cloudTransportDestination) &&
      typeof document!=='undefined' && document.visibilityState==='hidden';
  }
  function keepCloudTransportFlowing(detail){
    if(!cloudTransportDestination || !cloudTransportAudio.paused) return;
    cloudKeepAlivePending=true;
    try{
      const started=cloudTransportAudio.play();
      if(started && typeof started.catch==='function'){
        started.catch(()=>{ cloudKeepAlivePending=false; });
      }
    }catch(error){ cloudKeepAlivePending=false; }
    if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark(
      'recording-transport:keepalive',detail);
  }
  function armCloudTransport(ctx,row){
    cloudKeepAlivePending=false;
    cloudKeepAliveRestored=false;
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
      /* 잠금화면의 시간은 iOS가 직접 센다 — 우리가 준 자리에 배속을 곱해 흐르게 한다.
         구간 반복은 직선으로 셀 수 없는 움직임이다. 전체 길이로 주면 B를 지나서도 계속
         앞으로 가고, 잠금 중에는 타이머가 심하게 눌려 바로잡아 줄 기회도 드물다.

         구간을 전체 길이로 줘 보면 눈금은 구간 안에서 잘 도는데, iOS에는 몇 초짜리
         짧은 곡으로 보여 끝에 닿을 때마다 끝난 것으로 읽고 잠금화면 아이콘을 재생
         모양으로 그린다. 둘 다 가질 수는 없다 — 구간 반복은 직선 시간으로 표현할 수
         없는 움직임이기 때문이다.

         **두 쪽을 다 기기에서 써 보고 이쪽을 골랐다.** 구간이 걸려 있으면 자리를 아예
         알리지 않는다. 틀린 눈금보다 없는 눈금이 정직하고, 아이콘은 playbackState가
         정한다. 눈금 쪽으로 되돌리려면 구간일 때 duration을 region.b-region.a로,
         position을 current-region.a로 주면 된다. 앞뒤 10초 이동은 실제 자리로
         셈하므로 어느 쪽이든 영향이 없다. */
      const region=activeLoopFor(active);
      if(region && !region.whole && region.b-region.a>0){
        navigator.mediaSession.setPositionState();
        return;
      }
      navigator.mediaSession.setPositionState({
        duration,position:current,playbackRate:rowPlaybackRate(active),
      });
    }catch(error){}
  }
  function refreshCloudMediaSessionPosition(minInterval=750){
    if(!cloudMediaSessionActive || !cloudMediaId) return;
    const row=rows.find(item=>item.id===cloudMediaId);
    if(!row) return;
    const position=currentCloudPosition();
    /* 자리가 뒤로 갔으면 구간을 한 바퀴 돈 것이다. 그때는 기다리지 않고 바로 알린다 —
       늦게 알릴수록 잠금화면이 지나간 자리를 더 오래 그린다. */
    const wrapped=position+.05<cloudLastReportedPosition;
    const now=performance.now();
    if(!wrapped && now-cloudMediaPositionUpdatedAt<minInterval) return;
    cloudMediaPositionUpdatedAt=now;
    cloudLastReportedPosition=position;
    updateCloudMediaSessionPosition(row,position);
  }
  function updateCloudMediaSessionState(row){
    try{
      if(!navigator.mediaSession) return;
      const active=row||rows.find(item=>item.id===cloudMediaId);
      if(!active) return;
      const state=cloudPlayingId===active.id?'playing':'paused';
      navigator.mediaSession.playbackState=state;
      /* 임시 계측: 잠금화면 아이콘이 어긋나는 것을 쫓는다. 마지막에 무엇을 썼는지와
         그때의 두 id를 함께 남긴다. 원인을 잡으면 지운다. */
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media:state',{
        상태:state,
        재생중id:cloudPlayingId||'없음',
        화면id:cloudMediaId||'없음',
        같은가:cloudPlayingId===active.id?'예':'아니오',
        모드:cloudPlaybackMode||'없음',
      });
      updateCloudMediaSessionPosition(active);
    }catch(error){}
  }
  function seekCloudPlaybackBy(seconds){
    const row=rows.find(item=>item.id===cloudMediaId);
    if(!row) return;
    const duration=rowDurationSeconds(row);
    let target=clamp(currentCloudPosition()+Number(seconds||0),0,duration);
    /* 구간을 돌고 있으면 구간 밖으로 나가지 않는다. 밖으로 나가면 다음 바퀴에 어차피
       끌려 들어오므로, 듣는 사람에게는 건너뛰기가 먹지 않은 것처럼 보인다.
       구간 안으로 감아 넣어 10초만큼 실제로 움직이게 한다. */
    const loop=activeLoopFor(row);
    const span=loop && !loop.whole ? loop.b-loop.a : 0;
    if(span>0) target=loop.a+((((target-loop.a)%span)+span)%span);
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
    /* 이미 소리가 나고 있으면 새로 열지 않는다. 잠금화면이 어떤 까닭으로 '정지'로
       보여 재생을 눌러도, 두 벌이 겹쳐 나는 것보다 현재 것을 이어 두는 편이 낫다.
       겹쳐 나면 하나는 처음부터, 하나는 원래 자리에서 흐른다. */
    if(cloudPlayingId){
      updateCloudMediaSessionState();
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media:already-playing');
      return;
    }
    cloudKeepAlivePending=false;
    cloudKeepAliveRestored=false;
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
    /* 재생 중에 조옮김을 처음 건드리면 여기서 SoundTouch 경로로 통째로 갈아탄다.
       그 자리에서 워클릿 모듈을 처음 받아 오면 갈아타는 사이가 '렉'처럼 들린다.
       모듈은 컨텍스트마다 한 번이면 되니 재생을 시작할 때 미리 받아 둔다. */
    if(ctx) ensureSoundTouchProcessor(ctx).catch(()=>{});
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
  /* A–B 구간을 돌 때 잠금화면 단추를 죽여 두려고 세 가지를 해 봤고 셋 다 막혔다.

     핸들러를 비우면 iOS가 운반자 요소를 직접 건드려 자리 지키기가 깨진다(메트로놈에서
     겪은 그 문제다). 구간이 걸리고 풀릴 때마다 다시 깔면 iOS가 이 페이지의 잠금화면
     자리를 놓아 버린다. 등록은 두고 속만 비워도 마찬가지다 — 재생·일시정지를 보냈는데
     앱이 따르지 않으면(소리는 그대로 나고 상태도 안 바뀌면) iOS가 미디어 박스를 거둔다.
     실제로 구간에서 단추를 누른 뒤 구간을 풀면 박스가 사라졌다.

     그러니 명령은 반드시 따라야 한다. 대신 구간 안에서 얌전히 굴게 한다 — 재생·일시정지는
     그대로 듣고, 앞뒤 10초는 구간을 벗어나지 않도록 구간 안으로 감는다. 두 벌이 겹쳐
     나는 것은 resumeCloudPlaybackFromMediaSession()에서 따로 막는다. */
  function installCloudMediaActions(actionMode){
    const play=setCloudMediaAction('play',()=>resumeCloudPlaybackFromMediaSession());
    /* 일시정지도 우리가 받는다. 예전에는 스트림 모드에서 시스템에 맡겼는데, 맡기면
       iOS가 운반자 요소를 직접 멈추고 잠금화면 단추 그림도 요소의 상태를 그대로
       따라간다. 이제는 멈춘 뒤에도 무음을 계속 흘려야 하므로 요소는 '재생 중'이고,
       맡겨 두면 단추가 영영 일시정지 모양으로 남는다. 우리가 받으면 playbackState가
       그림을 정한다. */
    const pause=setCloudMediaAction('pause',()=>{
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording-media:pause');
      pauseCloudPlayback();
    });
    if(actionMode==='stream') setCloudMediaAction('stop',null);
    else setCloudMediaAction('stop',()=>stopCloudPlayback());
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
  /* ---------- 녹음할 때 함께 울리는 메트로놈 ----------
     버튼을 켜 두면 녹음을 누를 때 한 마디를 세고 시작하고, 녹음하는 동안
     박이 계속 들린다. 꺼 두면 예전과 똑같이 바로 녹음만 한다.

     소리를 내는 주체는 메트로놈 탭과 같은 하나뿐이다. 여기서는 켜고 끄기와
     마디 세기만 맡는다. 두 벌의 메트로놈이 따로 돌면 왜 아까와 빠르기가
     다른지 아무도 설명할 수 없게 된다.

     클릭음은 녹음 파일에 들어가지 않는다. setupCapture가 잇는 것은 마이크
     입력뿐이고 메트로놈은 다른 출력 버스로 나가기 때문이다. 귀로 듣고 박에
     맞춰 칠 수는 있지만 파일에는 남지 않는다. */
  const METRO_ARMED_KEY='olive-record-metronome';
  /* 메트로놈을 켜고 첫 박까지 두는 여유. iPhone은 오디오 경로가 막 열린 직후의
     첫 소리를 작게 내므로, 그 사이에 들리지 않는 소리로 경로를 깨워 둔다.
     자바스크립트 타이머가 아니라 오디오 시계 위에 얹혀 예약되므로 정확하다.
     그동안 화면은 첫 숫자를 들고 기다려 멈춘 것처럼 보이지 않는다. */
  const METRO_LEAD_IN_MS=1000;
  let metroArmed=false;
  let metroStartedByRecorder=false;
  let metroBeatOff=null;
  let countInAbort=null;

  function metronome(){ return window.OliveMetronome||null; }
  function loadMetroArmed(){
    try{ return localStorage.getItem(METRO_ARMED_KEY)==='1'; }
    catch(error){ return false; }
  }
  function saveMetroArmed(){
    try{ localStorage.setItem(METRO_ARMED_KEY,metroArmed?'1':'0'); }
    catch(error){}
  }
  function renderMetroButton(){
    if(!recordMetro) return;
    recordMetro.setAttribute('aria-pressed',metroArmed?'true':'false');
  }
  /* 물드는 시간. 90 BPM의 한 박(667ms)보다 충분히 짧아야 박과 박 사이가 보인다. */
  const BEAT_FLASH_MS=150;
  let beatFlashTimer=0;
  function attachMetroBeat(){
    const metro=metronome();
    if(!metro || metroBeatOff || !recordMetro) return;
    metroBeatOff=metro.onBeat(()=>{
      if(!recordMetro) return;
      clearTimeout(beatFlashTimer);
      recordMetro.classList.remove('beat');
      void recordMetro.offsetWidth;           // 퍼지는 테를 처음부터 다시
      recordMetro.classList.add('beat');
      beatFlashTimer=setTimeout(()=>{
        beatFlashTimer=0;
        if(recordMetro) recordMetro.classList.remove('beat');
      },BEAT_FLASH_MS);
    });
  }
  function detachMetroBeat(){
    if(metroBeatOff){ metroBeatOff(); metroBeatOff=null; }
    clearTimeout(beatFlashTimer); beatFlashTimer=0;
    if(recordMetro) recordMetro.classList.remove('beat');
  }
  /* 이미 돌고 있어도 처음부터 다시 켠다. 마디 중간에서 그대로 이어받으면
     클릭이 그냥 계속 들릴 뿐이라 어디가 카운트인인지 귀로 알 수 없고, 다음
     마디 첫 박을 기다리느라 최대 두 마디가 지나간다. 다시 켜면 첫 박이 곧
     마디 첫 박이라 세는 길이가 언제나 한 마디다. */
  async function startRecorderMetronome(token){
    const metro=metronome();
    if(!metro) return false;
    attachMetroBeat();
    if(metro.isPlaying()) metro.stop();
    try{ await metro.start({leadIn:METRO_LEAD_IN_MS}); }catch(error){ return false; }
    if(token!==undefined && (token!==startToken || !startPending)) return false;
    if(!metro.isPlaying()) return false;
    metroStartedByRecorder=true;
    return true;
  }
  function stopRecorderMetronome(){
    detachMetroBeat();
    const metro=metronome();
    // 사용자가 메트로놈 탭에서 직접 켜 둔 것이라면 녹음이 끝나도 두고 나온다.
    if(metro && metroStartedByRecorder) metro.stop();
    metroStartedByRecorder=false;
  }
  function setMetroArmed(on){
    metroArmed=Boolean(on);
    saveMetroArmed();
    renderMetroButton();
    if(!metroArmed) stopRecorderMetronome();
    else if(recording) startRecorderMetronome();
    /* 안내 문구가 곧바로 따라와야 한다. 켜 두고도 "메트로놈과 함께 녹음할 수
       있습니다"가 남아 있으면 무엇이 달라졌는지 알 수 없다. 대기 중일 때만
       다시 그린다 — 확인 화면에서 부르면 들어 보던 녹음이 사라진다. */
    if(recordToggle.dataset.mode==='idle') renderIdle();
  }
  function showCountIn(left){
    recordTimer.textContent=String(left);
    recordTimer.classList.add('counting');
    recordState.textContent='카운트인';
    recordStateDot.hidden=true;
  }
  function clearCountIn(){
    recordTimer.classList.remove('counting');
  }
  function cancelCountIn(){
    if(countInAbort){ const abort=countInAbort; countInAbort=null; abort(); }
    clearCountIn();
    if(!recording) setTimer(0);
  }
  /* 한 마디를 세고 나서 녹음을 시작한다.

     리스너는 메트로놈을 켜기 '전에' 건다. 켠 뒤에 걸면 첫 박을 놓쳐 다음 마디
     첫 박까지 한 바퀴를 더 기다리게 된다 — 카운트인이 네 박 늦게 시작하던 원인이다.

     녹음을 시작할 때 메트로놈을 언제나 다시 켜므로, 처음 듣는 박이 곧 마디
     첫 박이다. 그래서 기다리지 않고 바로 센다.

     세는 기준은 예약 시각이 아니라 실제로 소리가 난 박이라, 화면의 숫자와
     귀에 들리는 클릭이 어긋나지 않는다. */
  function armCountIn(token){
    const metro=metronome();
    if(!metro) return null;
    const beats=Math.max(1,metro.beatsPerBar());
    showCountIn(beats);
    return new Promise(resolve=>{
      let counted=0, done=false, off=null, guard=0;
      const finish=()=>{
        if(done) return;
        done=true;
        if(off){ off(); off=null; }
        if(guard){ clearTimeout(guard); guard=0; }
        if(countInAbort===finish) countInAbort=null;
        resolve();
      };
      countInAbort=finish;
      off=metro.onBeat(()=>{
        if(token!==startToken || !startPending){ finish(); return; }
        counted++;
        if(counted>beats){ finish(); return; }
        showCountIn(beats-counted+1);
      });
      // 박이 오지 않으면(오디오가 막히는 등) 무한정 기다리지 않는다.
      guard=setTimeout(finish,METRO_LEAD_IN_MS+(beats+2)*metro.secondsPerBeat()*1000+2500);
    });
  }

  /* ---------- 메트로놈 설정 창 ----------
     창은 스스로 상태를 갖지 않는다. 열 때마다 OliveMetronome에서 값을 읽어
     그리고, 탭에서 값이 바뀌면 onChange로 다시 그린다. */
  let metroSheetTrigger=null;
  let metroSheetOff=null;

  function renderMetroSheet(){
    const metro=metronome();
    if(!metro || !metroSheet) return;
    metroSheetBpm.textContent=String(metro.getBpm());
    const meterNow=metro.meterLabel();
    metroSheetMeters.querySelectorAll('.pill').forEach(pill=>{
      pill.classList.toggle('active',pill.dataset.meter===meterNow);
    });
    const subNow=metro.subKey();
    metroSheetSubs.querySelectorAll('.note-btn').forEach(button=>{
      button.classList.toggle('active',button.dataset.sub===subNow);
    });
    const on=metro.accent();
    metroSheetAccent.textContent=on?'ON':'OFF';
    metroSheetAccent.setAttribute('aria-pressed',on?'true':'false');
  }
  function buildMetroSheet(){
    const metro=metronome();
    if(!metro || !metroSheetMeters || metroSheetMeters.childElementCount) return;
    metro.meters().forEach(label=>{
      const pill=document.createElement('button');
      pill.type='button'; pill.className='pill'; pill.dataset.meter=label;
      pill.textContent=label;
      pill.addEventListener('click',()=>metro.setMeter(label));
      metroSheetMeters.appendChild(pill);
    });
    metro.subs().forEach(item=>{
      const button=document.createElement('button');
      button.type='button'; button.className='note-btn'; button.dataset.sub=item.key;
      button.innerHTML=item.glyph;
      button.setAttribute('aria-label',item.name);
      button.title=item.name;
      button.addEventListener('click',()=>metro.setSub(item.key));
      metroSheetSubs.appendChild(button);
    });
    // 탭의 조작과 같은 것들 — 길게 누르면 ±10, 숫자를 두 번 누르면 기본값.
    bindTempoKeys(metroSheetMinus,metroSheetPlus,()=>metro.getBpm(),v=>metro.setBpm(v));
    bindTapTempo(metroSheetTap,v=>metro.setBpm(v));
    bindResetOnDouble(metroSheetBpm,()=>metro.setBpm(metro.defaultBpm()));
    metroSheetAccent.addEventListener('click',()=>metro.setAccent(!metro.accent()));
  }
  function openMetroSheet(){
    const metro=metronome();
    if(!metro || !metroSheet) return;
    buildMetroSheet();
    metroSheetTrigger=document.activeElement && typeof document.activeElement.focus==='function'
      ? document.activeElement : null;
    if(app) app.setAttribute('inert','');
    metroSheet.hidden=false;
    requestAnimationFrame(()=>metroSheet.classList.add('open'));
    document.body.classList.add('cloud-sheet-open');
    if(!metroSheetOff) metroSheetOff=metro.onChange(renderMetroSheet);
    renderMetroSheet();
    setTimeout(()=>{ try{ metroSheetClose.focus(); }catch(error){} },50);
  }
  function closeMetroSheet(){
    if(!metroSheet || metroSheet.hidden) return;
    metroSheet.classList.remove('open');
    document.body.classList.remove('cloud-sheet-open');
    if(metroSheetOff){ metroSheetOff(); metroSheetOff=null; }
    setTimeout(()=>{
      if(metroSheet.classList.contains('open')) return;
      metroSheet.hidden=true;
      if(app) app.removeAttribute('inert');
      if(metroSheetTrigger && metroSheetTrigger.isConnected) metroSheetTrigger.focus();
      metroSheetTrigger=null;
    },220);
  }

  function renderIdle(){
    clearCountIn();
    setTimer(0);
    recordState.textContent='녹음 준비';
    recordStateDot.hidden=true;
    recordHint.textContent=metroArmed
      ? '최대 5분 · 한 마디 세고 시작합니다 · 길게 눌러 메트로놈 설정'
      : '최대 5분 · 메트로놈 또는 잼 세션과 함께 녹음할 수 있습니다';
    recordDraft.hidden=true;
    clearInputActivity();
    recordLevel.style.transform='scaleX(0)';
    setButtonMode('idle');
  }
  function renderDraft(){
    if(!draft){ renderIdle(); return; }
    clearCountIn();
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
    /* 그림 루프는 여기서 걸지 않는다. drawLevel은 recording이 아니면 그 자리에서
       돌아가고 다음 프레임을 예약하지 않는데, 카운트인이 붙으면서 그래프를 세운
       뒤 실제 녹음이 시작되기까지 한 마디가 비게 되었다. 그 사이에 첫 프레임이
       돌면 루프가 그대로 죽어 입력 레벨이 끝까지 움직이지 않는다. */
  }
  function startLevelLoop(){
    if(!levelAnalyser) return;
    cancelAnimationFrame(levelFrame);
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
    const token=++startToken;
    startPending=true;
    setMessage('');
    recordStateDot.hidden=true;
    setButtonMode('starting');
    try{
      setAudioSession('play-and-record');

      /* 마이크부터 받는다. 권한 창이 뜨는 동안 카운트인이 먼저 돌면, 허용을 누를
         즈음 한 마디가 이미 지나가 있다. 세는 소리를 듣고 들어와야 할 사람에게는
         그 녹음이 통째로 어긋난 것이다. 거절당했을 때 메트로놈을 켰다 끄는 헛일도
         하지 않는다. */
      recordState.textContent='마이크 연결 중…';
      stream=await navigator.mediaDevices.getUserMedia({audio:{
        channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false,
      }});
      if(token!==startToken || !startPending){ finishAudioSession(); return; }

      /* 메트로놈은 캡처 그래프보다 '먼저' 켠다. 그래프를 다 세운 뒤에 켜면
         메트로놈이 오디오 컨텍스트를 갈아 끼우면서 방금 만든 그래프가 끊어진다.
         입력 레벨 막대가 죽고, MediaRecorder가 끊긴 스트림을 물고 있게 된다.
         스트림은 아직 어느 컨텍스트에도 붙지 않았으므로 여기서 켜도 안전하다. */
      let counting=null;
      if(metroArmed){
        counting=armCountIn(token);
        const beating=await startRecorderMetronome(token);
        if(!beating){ cancelCountIn(); counting=null; }
        if(token!==startToken || !startPending){
          cancelCountIn(); finishAudioSession(); return;
        }
      }

      // 메트로놈까지 켜진 상태에서 재야 어느 소리를 이어 갈지 제대로 판단한다.
      const preservePlayback=anySounding();
      let ctx=await ensureRecordingCtx(preservePlayback);
      if(token!==startToken || !startPending){ cancelCountIn(); finishAudioSession(); return; }
      if(ctx!==audioCtx || ctx.state!=='running'){
        ctx=await ensureRecordingCtx(preservePlayback && anySounding());
      }
      if(token!==startToken || !startPending){ cancelCountIn(); finishAudioSession(); return; }
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
      /* 마디를 다 셀 때까지 기다린다. 마이크는 세는 동안 이미 붙었으므로
         숫자가 0에 닿는 순간이 곧 녹음이 시작되는 순간이다.
         클릭음은 setupCapture가 잇는 마이크 입력을 거치지 않으므로 파일 앞에
         빈 한 마디가 붙지 않는다. */
      if(counting){
        await counting;
        if(token!==startToken || !startPending){ cancelCountIn(); finishAudioSession(); return; }
      }
      /* iPhone Safari의 MP4 MediaRecorder는 timeslice로 잘게 나눈 조각을
         다시 합쳤을 때 긴 녹음이 재생 불가능해지는 경우가 있다.
         최대 5분·96kbps면 메모리 부담이 작으므로 stop 때 한 파일로 받는다. */
      recorder.start();
      if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('recording:started',{
        processedStream:recordingStream!==stream,
      });
      recording=true; startPending=false; startedAt=performance.now(); recordedAt=new Date().toISOString();
      startLevelLoop();
      clearCountIn();
      setTimer(0);
      timerId=setInterval(updateTimer,200);
      setTabSounding('trainer',true,'recorder');
      recordState.textContent='녹음 중';
      recordStateDot.hidden=false;
      recordHint.textContent='자동 화면 꺼짐은 방지합니다 · 녹음 중에는 직접 잠그지 마세요';
      setButtonMode('recording');
    }catch(error){
      if(token!==startToken) return;
      startPending=false; recording=false;
      cancelCountIn(); stopRecorderMetronome();
      finishAudioSession(); renderIdle();
      if(error && error.name==='NotAllowedError'){ explainMicDenied(); return; }
      const message=error && error.name==='NotReadableError' ? '마이크가 다른 앱에서 사용 중입니다'
        : error && error.name==='NotFoundError' ? '사용할 수 있는 마이크가 없습니다'
        : '녹음을 시작하지 못했습니다. 다시 시도해 주세요';
      setMessage(message,true);
    }
  }
  /* 권한 창을 앱이 다시 띄울 수는 없다. 한 번 '허용 안 함'을 누르면 브라우저가
     기억해 두고, 그다음부터 getUserMedia는 창도 없이 곧바로 거절한다. 그래서
     둘을 갈라 말해 준다 — 창을 닫아 버린 것뿐이면 다시 누르면 또 물어보고,
     막아 둔 것이면 설정에서 풀어야 한다. Permissions API가 없는 브라우저
     (사파리 다수)에서는 가릴 수 없으므로 다시 눌러 보라고 한다. */
  function explainMicDenied(){
    const askAgain='마이크 권한이 필요합니다 · 다시 눌러 허용해 주세요';
    const blocked='마이크가 차단되어 있습니다 · 브라우저 설정에서 이 사이트의 마이크를 허용해 주세요';
    setMessage(askAgain,true);
    let query=null;
    try{ query=navigator.permissions && navigator.permissions.query({name:'microphone'}); }catch(e){}
    if(!query || typeof query.then!=='function') return;
    query.then(status=>{
      if(status && status.state==='denied') setMessage(blocked,true);
    }).catch(()=>{});
  }
  function stopRecording(){
    if(startPending){
      startPending=false; ++startToken;
      cancelCountIn(); stopRecorderMetronome();
      finishAudioSession(); renderIdle(); return;
    }
    if(!recording || !recorder) return;
    stopRecorderMetronome();
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
  /* native 경로의 A/B 되감기.
     <audio>의 currentTime은 seek이 끝날 때까지 예전 값을 돌려준다. 그래서 매
     프레임 검사하면 한 번 B를 넘긴 뒤 몇 프레임 동안 조건이 계속 참이고, 그
     사이 되감기가 겹겹이 쌓여 '아주 짧게 여러 번 처음으로 돌아가는' 소리가 난다.
     구간이 짧을수록(도움말의 예시가 그렇다) 더 자주 걸린다.
     한 번 되감으면 seek이 자리를 잡을 때까지 다시 부르지 않는다. */
  const LOOP_SEEK_SETTLE=140;
  let loopSeekAt=0;
  function rewindNativeLoop(region){
    const now=performance.now();
    if(now-loopSeekAt<LOOP_SEEK_SETTLE) return;
    loopSeekAt=now;
    try{ activeCloudAudio().currentTime=region.a; }catch(error){}
  }
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
        rewindNativeLoop(region);
        position=region.a;
      }
      playbackPositions.set(cloudPlayingId,position);
      refreshCloudMediaSessionPosition(0);
    },1000);
  }
  function startCloudProgress(){
    stopCloudProgress();
    cloudMediaPositionUpdatedAt=0;
    loopSeekAt=0;
    startCloudPositionTimer();
    const tick=()=>{
      if(!cloudPlayingId) return;
      let position=currentCloudPosition();
      const row=rows.find(item=>item.id===cloudPlayingId);
      const region=row&&activeLoopFor(row);
      if(region && isNativePlaybackMode() && !region.whole && position>=region.b){
        rewindNativeLoop(region);
        position=region.a;
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
    // 열어 주기로 한 예약도 함께 거둔다. 놓아 준 게인을 뒤늦게 열면 안 된다.
    clearTimeout(cloudStretchOpenTimer); cloudStretchOpenTimer=0;
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
    forgetSettles();
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
    /* 가려진 동안에는 운반자를 멈추지 않는다. 멈추면 iOS가 엔진을, 이어서 페이지를
       거두어 가고 잠금화면의 재생 단추가 먹지 않는다. 앞에 있을 때는 예전 그대로
       멈춘다 — 앞에서 겪는 탐색과 구간 반복을 건드리지 않기 위해서다. */
    const keepCarrier=shouldKeepCloudTransportFlowing();
    if(!keepCarrier && !transportAlreadyPaused){
      cloudTransportInternalPause=true;
      try{ cloudTransportAudio.pause(); }catch(error){}
      cloudTransportInternalPause=false;
    }
    cloudTransportPlayGeneration++;
    cloudTransportPlayPromise=null;
    cloudTransportArmed=false;
    cloudPlaybackMode=isNativePlaybackMode()?'native-paused':'decoded-paused';
    cloudPlayingId='';
    cloudKeepAliveRestored=false;
    if(keepCarrier) keepCloudTransportFlowing();
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
  /* 도움말 미리보기의 시연 녹음은 기기에 남기지 않는다. 프레임이 사는 동안은 메모리에
     들고 있어 그대로 들리고, 챕터를 다시 시작하면 어차피 사라지는 줄이다. 캐시는
     자리가 정해져 있어, 시연이 들어가면 진짜 녹음이 그만큼 밀려난다. */
  const guidePreview=/[?&]guide=1(?:&|$)/.test(location.search);
  function cacheRowBlob(row,blob,userId){
    if(guidePreview) return Promise.resolve(false);
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
  /* SoundTouch 파이프는 빈 출력 버퍼로 시작한다. 타임스트레처는 한 블록을 내놓기
     전에 입력을 몇 블록 모아야 하므로, 처음 ¼초쯤은 요청한 128프레임을 채우지
     못하고 굶는다. 굶은 스트레처는 그레인을 되풀이하는데 그게 '아주 짧게 여러 번
     처음으로 돌아가는' 소리다.

     재 보니 1300블록 중 언더런 60회가 났고 그중 54회가 첫 100블록(약 270ms)에
     몰려 있었다. 그래서 그동안은 소리를 닫아 두고 파이프를 실제 소리로 채운 뒤에
     연다. 조옮김을 처음 걸 때만 두드러졌던 이유는, 그 뒤로는 노드가 이미 있어
     파라미터만 바뀌기 때문이다. */
  const STRETCH_PRIME_SECONDS=.28;
  /* 다 찼다고 볼 프레임 수.

     여덟 블록(1024프레임)으로 잡았더니 되풀이 잡음은 사라졌는데, 갓 세운 스트레처가
     음높이를 제자리로 끌어오는 데는 그보다 더 걸린다 — 구간 반복을 처음 걸 때 음이
     살짝 낮았다가 따라 올라오는 것이 그것이다. 되풀이는 굶어서 나는 것이고 이쪽은
     내부 상태가 아직 자리를 못 잡아서 나는 것이라, 같은 문턱으로 둘 다 덮이지 않는다.

     서른두 블록으로 올려 더 채운 뒤에 연다. 물러서 둔 0.28초보다 늦게 열리는 만큼
     들리기 시작하는 자리가 조금 뒤로 가지만, 음이 미끄러지는 것보다는 낫다.
     seek:소리엶의 닫아둔시간ms로 실제 얼마나 걸리는지 볼 수 있다. */
  const STRETCH_READY_FRAMES=4096;
  /* 워클릿이 끝내 아무 말이 없어도 소리는 나야 한다. */
  const STRETCH_PRIME_MAX_MS=700;
  function startDecodedSource(ctx,buffer,row,token,offset,fadeIn){
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
      const level=rowPlaybackGain(row);
      gain.gain.value=level;
      const stretching=needsPitchProcessing(row) && typeof AudioWorkletNode==='function';
      /* 네이티브 재생에서 갈아탈 때는 이미 스피커로 나간 소리와 새 소스의 첫 프레임이
         겹쳐 아주 짧게 되울린 것처럼 들린다. 30여 밀리초만 열어 주면 그 이음매가 사라진다.
         스트레처를 새로 세울 때는 파이프가 찰 때까지 더 오래 닫아 둔다. */
      /* 닫아 두는 시간과 물러서는 거리는 다른 값이다. 파이프는 언제나 채워야
         하므로 닫는 시간은 늘 같고, 물러서는 것은 버퍼에 앞이 남아 있을 때만
         할 수 있다. 물러설 수 있으면 귀에 들리기 시작하는 자리가 원래 자리와
         같아지고, 파일 맨 앞이라 물러설 데가 없으면 그만큼 늦게 들어온다.
         구간 앞으로 물러서도 된다 — loopEnd에 닿으면 정상적으로 구간을 돈다. */
      const prime=stretching ? STRETCH_PRIME_SECONDS : 0;
      const backUp=Math.min(prime,Math.max(0,startAt));
      startAt-=backUp;
      if(fadeIn || stretching){
        const open=ctx.currentTime;
        try{
          gain.gain.setValueAtTime(.0001,open);
          /* 스트레처는 다 찼다는 기별이 올 때 연다. 아래에서 예약한다. */
          if(!stretching) gain.gain.linearRampToValueAtTime(Math.max(.0001,level),open+.035);
        }catch(error){ if(!stretching) gain.gain.value=level; }
      }
      try{ source.playbackRate.value=rate; }catch(error){}
      if(stretching){
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
        /* 파이프가 찼다고 알려 올 때 소리를 연다. 차는 데 걸리는 시간은 기기마다
           다르므로 고정한 시간으로 맞히면 어디선가는 모자라고 어디선가는 길다.
           워클릿은 100블록마다 버퍼 상태를 보내 온다. 기별이 끝내 없으면 한도
           뒤에 그냥 연다 — 소리가 영영 닫혀 있는 것이 제일 나쁘다. */
        let opened=false;
        const openedFrom=ctx.currentTime;
        const openOutput=()=>{
          if(opened || cloudGainNode!==gain) return;
          opened=true;
          clearTimeout(cloudStretchOpenTimer); cloudStretchOpenTimer=0;
          const now=ctx.currentTime;
          /* 임시 계측: 늘임 경로에서 소리를 실제로 연 시각. 원인을 잡으면 지운다. */
          if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('seek:소리엶',{
            닫아둔시간ms:Math.round((now-openedFrom)*1000),
          });
          try{
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(.0001,now);
            gain.gain.linearRampToValueAtTime(Math.max(.0001,level),now+.035);
          }catch(error){ gain.gain.value=level; }
        };
        /* 기별을 듣는 것은 곁다리다. 창구가 없다고 재생이 통째로 무너지면 안 된다. */
        try{
          stretch.port.onmessage=event=>{
            const data=event.data;
            if(!data || data.type!=='metrics') return;
            if(Number(data.framesBuffered)>=STRETCH_READY_FRAMES) openOutput();
          };
          if(typeof stretch.port.start==='function') stretch.port.start();
        }catch(error){}
        clearTimeout(cloudStretchOpenTimer);
        cloudStretchOpenTimer=setTimeout(openOutput,STRETCH_PRIME_MAX_MS);
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
      /* 임시 계측: 탐색 한 번에 두 갈래를 함께 가른다. 통로에남은양이 크면 이미
         통로에 들어간 소리가 마저 나는 것이고, 물러선양이 크면 일부러 앞에서 시작한
         쪽이다. 원인을 잡으면 지운다. */
      if(window.OliveAudioDiagnostics){
        window.OliveAudioDiagnostics.mark('seek:열기',Object.assign({
          누른자리:Number((Number(offset)||0).toFixed(2)),
          연자리:Number(startAt.toFixed(2)),
          물러선양:Number(backUp.toFixed(3)),
          늘임:stretching?'예':'아니오',
          페이드:fadeIn?'예':'아니오',
          구간:region?(region.a.toFixed(2)+'~'+region.b.toFixed(2)):'없음',
          배속:rate,
        },transportLag(ctx)||{}));
      }
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
      /* 파형을 탐색하면 디코딩 경로로 갈아탄다. 그때 기다리지 않도록 미리 받아 둔다 —
         재생 자체는 이 결과를 기다리지 않으므로 늦어도 손해가 없다. */
      decodedBufferForRow(ctx,row).then(buffer=>{
        if(cloudDecodedId===row.id && cloudDecodedBuffer) return;
        cloudDecodedBuffer=buffer;
        cloudDecodedContext=ctx;
        cloudDecodedId=row.id;
      }).catch(()=>{});
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
      /* 임시 계측: iOS에서 currentTime을 바꾸면 탐색이 끝날 때까지 이전 자리가 계속
         난다. 걸린 시간을 잰다 — 1초에 가까우면 이것이 원인이다. 잡으면 지운다. */
      const asked=Date.now();
      const before=Number(audio.currentTime)||0;
      try{
        audio.addEventListener('seeked',()=>{
          if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('seek:네이티브끝',{
            걸린ms:Date.now()-asked,
            이전자리:Number(before.toFixed(2)),
            새자리:Number((Number(audio.currentTime)||0).toFixed(2)),
            멈춤:audio.paused?'예':'아니오',
          });
        },{once:true});
      }catch(error){}
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
    return switchActivePlaybackToDecoded(row,position,false);
  }
  /* exact=true는 파형 탐색이다. 누른 자리를 그대로 연다 — 이어 붙이는 것이 아니므로
     이미 귀로 나간 만큼을 건너뛸 까닭이 없다. */
  function switchActivePlaybackToDecoded(row,position,exact){
    if(cloudPlayingId!==row.id || !audioCtx || audioCtx.state==='closed') return false;
    /* 갈아타는 데는 디코딩과 워클릿 적재가 걸린다. 그 사이에 또 부르면 세우던 그래프를
       도로 헐고 처음부터 다시 한다. 한 번에 한 번만 갈아탄다. */
    if(switchingToPitch) return true;
    switchingToPitch=true;
    const ctx=audioCtx;
    const token=++cloudPlayToken;
    /* 네이티브 요소의 currentTime은 스피커가 이미 내보낸 자리보다 뒤에 있다. 그 값에서
       그대로 이어 붙이면 방금 귀로 들은 몇십 ms를 한 번 더 듣게 된다 — 조옮김을 처음
       걸 때 '짧게 되풀이'로 들리던 것이 이것이다. 이미 나간 만큼을 건너뛰고 잇는다.
       출력 지연은 기기마다 다르고 iOS가 특히 크다. 터무니없는 값은 잘라 쓴다. */
    const heard=exact ? 0
      : Math.max(0,Math.min(.4,Number(ctx.outputLatency)||Number(ctx.baseLatency)||0));
    const offset=clamp((Number(position)||0)+heard,0,rowDurationSeconds(row));
    playbackPositions.set(row.id,offset);
    stopCloudProgress();
    cloudPlaybackMode='decoded-loading';
    /* 옛 소리를 여기서 끊지 않는다. 디코딩을 기다리는 동안 스트림에 무음이 흘러
       들어가면, 살아 있는 MediaStream을 받는 쪽이 굶어 늘여 메꾸며 음이 흔들린다 —
       조옮김이 없는데도 처음 탭할 때만 음이 낮아졌다 돌아오던 것이 그것이다.
       아래에서 새 소리를 여는 같은 동기 구간에서 끊는다. */
    Promise.all([
      ctx.state!=='running' ? resumeCtx(ctx) : Promise.resolve(),
      decodedBufferForRow(ctx,row),
      /* 워클릿은 조옮김·배속을 쓸 때만 필요하다. 기본값으로 듣다 탐색해 갈아타는
         길에서까지 모듈 적재를 기다릴 까닭이 없다. */
      needsPitchProcessing(row) ? ensureSoundTouchProcessor(ctx) : Promise.resolve(),
      armCloudTransport(ctx,row),
    ]).then(results=>{
      if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
      // 끊고 여는 것을 한 호흡에 한다. 사이에 무음이 끼지 않는다.
      resetCloudMediaElement();
      startDecodedSource(ctx,results[1],row,token,offset,true);
    }).catch(error=>handlePlaybackFailure(playbackStageError('audio',error),row,token))
      .finally(()=>{ switchingToPitch=false; });
    return true;
  }
  function playRow(row,requestedOffset){
    const seeking=Number.isFinite(requestedOffset);
    const offset=clamp(seeking?requestedOffset:Number(playbackPositions.get(row.id))||0,0,rowDurationSeconds(row));
    /* 임시 계측: 탐색이 어느 갈래로 가는지. 원인을 잡으면 지운다. */
    if(seeking && window.OliveAudioDiagnostics){
      window.OliveAudioDiagnostics.mark('seek:탭',{
        자리:Number(offset.toFixed(2)),
        모드:cloudPlaybackMode,
        네이티브:isNativePlaybackMode()?'예':'아니오',
        재생중:cloudPlayingId===row.id?'예':'아니오',
      });
    }
    if(recording || startPending){
      setMessage('녹음을 정지한 뒤 목록을 재생해 주세요',true);
      return;
    }
    if(cloudPlayingId===row.id && seeking){
      playbackPositions.set(row.id,offset);
      updatePlayerProgress(row.id,offset);
      if(isNativePlaybackMode()){
        /* 네이티브 연결 경로는 탐색이 즉각적이지 않다. createMediaElementSource가 요소에서
           미리 당겨 온 소리를 안에 물고 있어, 요소가 68ms 만에 정확히 옮겨 가도 귀에는
           1초 뒤에 온다. 기기에서 잰 값이 그대로 가리켰다 — 같은 파일을 디코딩 경로로
           재생하면 같은 탭이 270ms에 제자리로 간다.

           그래서 처음 탐색할 때 디코딩 경로로 갈아탄다. 버퍼는 재생을 시작할 때 미리
           받아 두므로 대개 그 자리에서 바로 바뀐다. 갈아타지 못하는 판(요소를 그래프에
           물리지 않는 native-direct 등)에서는 예전 그대로 요소를 옮긴다. */
        const decodedReady=cloudDecodedBuffer && cloudDecodedId===row.id &&
          cloudDecodedContext===audioCtx;
        if(decodedReady && !cloudMediaUsesPersistentNative &&
           switchActivePlaybackToDecoded(row,offset,true)) return;
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
    /* 네이티브 경로에서 A–B 반복은 타이머가 되감는다. 요소의 탐색만 50~70ms가 걸리고
       그동안 소리는 B를 지나 계속 나므로, 한 바퀴마다 구간 끝이 조금씩 샌다. 화면이
       잠기면 타이머가 눌려 더 나빠진다 — 아예 안 돌 수도 있다.

       디코딩 경로는 오디오 엔진이 반복을 지므로 샘플 단위로 정확하고 잠금에도 흔들리지
       않는다. 버퍼가 준비돼 있으면 구간을 걸 때 그리로 갈아탄다. 준비되지 않았으면
       예전 그대로 둔다 — 디코딩을 기다리다 재생이 멎는 일은 만들지 않는다. */
    if(isNativePlaybackMode()){
      const decodedReady=cloudDecodedBuffer && cloudDecodedId===row.id &&
        cloudDecodedContext===audioCtx;
      if(region && !region.whole && decodedReady && !cloudMediaUsesPersistentNative &&
         switchActivePlaybackToDecoded(row,target,true)) return;
      if(target!==position) prepareNativeOffset(target);
    }
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
  /* SoundTouch 워클릿은 렌더 프레임마다 pitch·playbackRate를 파이프라인에 다시 꽂고,
     값이 바뀌면 스테이지를 다시 엮는다. 슬라이더를 끄는 동안 매 프레임 바꾸면 버퍼가
     따라오지 못해(_underrunCount) 아주 짧은 조각이 되풀이된다 — 첫 조옮김에서 '퍼퍼퍽'
     하고 들리던 소리가 이것이다. 숫자는 곧바로 보여 주되 소리에 거는 것은 손이 멎은
     뒤로 미룬다. 손을 떼면(commit) 기다리지 않는다. */
  const SLIDER_SETTLE=140;
  let transposeSettle=0, rateSettle=0;
  function settle(timer,apply,commit){
    clearTimeout(timer);
    if(commit){ apply(); return 0; }
    return setTimeout(()=>apply(),SLIDER_SETTLE);
  }
  function forgetSettles(){
    clearTimeout(transposeSettle); transposeSettle=0;
    clearTimeout(rateSettle); rateSettle=0;
  }

  function setPlaybackRate(row,value,commit=false){
    const isActive=cloudPlayingId===row.id;
    const rate=clamp(Math.round((Number(value)||1)/PLAYBACK_RATE_STEP)*PLAYBACK_RATE_STEP,
      PLAYBACK_RATE_MIN,PLAYBACK_RATE_MAX);
    playbackRates.set(row.id,rate);
    if(commit) queueRecordingStateSave(row);
    const player=document.getElementById(`record-player-${row.id}`);
    const output=player&&player.querySelector('.record-speed-control .record-rate-value');
    if(output) output.value=output.textContent=formatPlaybackRate(rate);
    if(isActive){
      rateSettle=settle(rateSettle,()=>applyRateToPlayback(row),commit);
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
  function applyRateToPlayback(row){
    if(cloudPlayingId!==row.id) return;
    const activePosition=currentCloudPosition();
    const rate=rowPlaybackRate(row);
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
      glideParam(cloudSource.playbackRate,rate);
      glideParam(cloudStretchNode&&cloudStretchNode.parameters&&
        cloudStretchNode.parameters.get('playbackRate'),rate);
      updateCloudMediaSessionPosition(row,activePosition);
      return;
    }
    if(needsPitchProcessing(row)) switchActivePlaybackToPitchPreserving(row,activePosition);
  }
  function setTranspose(row,value,commit=false){
    const isActive=cloudPlayingId===row.id;
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
      transposeSettle=settle(transposeSettle,()=>applyTransposeToPlayback(row),commit);
      return;
    }
    if(commit) renderList();
  }
  function applyTransposeToPlayback(row){
    if(cloudPlayingId!==row.id) return;
    const activePosition=currentCloudPosition();
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
  }
  /* 값을 한 번에 튀기면 스트레처가 그 점프를 받아내지 못하고 굶는다. 굶은 스트레처는
     그레인을 되풀이하는데, 그것이 배속·조옮김을 바꿀 때 아주 짧은 구간이 되풀이되며
     렉처럼 들리던 소리다. 짧게 미끄러뜨리면 받아낸다. 손잡이를 끄는 동안에는 값이
     계속 들어오므로, 먼저 예약을 거두고 지금 값에서 이어 간다. */
  const PARAM_GLIDE=.06;
  function glideParam(param,value){
    if(!param || !cloudDecodedContext) return;
    const now=cloudDecodedContext.currentTime;
    try{
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value,now);
      param.linearRampToValueAtTime(value,now+PARAM_GLIDE);
    }catch(error){ try{ param.value=value; }catch(ignore){} }
  }
  function applyTransposeToStretchNode(row){
    const pitch=cloudStretchNode&&cloudStretchNode.parameters&&
      cloudStretchNode.parameters.get('pitch');
    if(!pitch) return;
    glideParam(pitch,transposeRatio(rowTranspose(row)));
  }
  function formatTranspose(value){
    const semitones=Math.round(Number(value)||0);
    if(!semitones) return '0';
    return `${semitones>0?'+':''}${semitones}`;
  }
  /* 손잡이를 두 번 누르면 기준값으로 돌아간다. 배속은 1배, 조옮김은 원래 조다.
     드래그 중에는 발동하지 않는다. */
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
  function practiceLinkCount(){
    return window.OlivePracticeLinks && typeof window.OlivePracticeLinks.count==='function'
      ? Number(window.OlivePracticeLinks.count())||0 : 0;
  }
  function renderUsage(){
    const links=practiceLinkCount();
    recordUsage.textContent=`녹음 ${rows.length}/${MAX_RECORDINGS} · YouTube ${links}/${MAX_LINKS}`;
    /* 가득 차고 나서야 알게 되면 늦다. 다섯 자리 남았을 때부터 색으로 알린다. */
    /* 링크는 꽉 차면 즐겨찾기가 아닌 오래된 것부터 비워 자리를 만든다. 사용자가 직접
       치워야 하는 것은 녹음뿐이라 눈에 띄게 하는 것도 녹음 쪽이다. */
    recordUsage.classList.toggle('near-limit',rows.length>=MAX_RECORDINGS-5 && rows.length<MAX_RECORDINGS);
    recordUsage.classList.toggle('at-limit',rows.length>=MAX_RECORDINGS);
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
      setMessage('녹음은 최대 50개까지 저장할 수 있습니다',true); return;
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
      const message=/count limit/i.test(detail) ? '녹음은 최대 50개까지 저장할 수 있습니다'
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
  /* 짧게 누르면 켜고 끄기, 누르고 있으면 설정. 길게 누른 뒤에 켜짐이
     같이 뒤집히면 설정을 열 때마다 원하지 않는 상태가 된다. */
  bindLongPress(recordMetro,()=>setMetroArmed(!metroArmed),openMetroSheet);
  if(metroSheetClose) metroSheetClose.addEventListener('click',closeMetroSheet);
  if(metroSheet){
    metroSheet.addEventListener('click',event=>{
      if(event.target===metroSheet) closeMetroSheet();
    });
    metroSheet.addEventListener('keydown',event=>{
      if(event.key==='Escape'){ event.preventDefault(); closeMetroSheet(); }
    });
  }
  metroArmed=loadMetroArmed();
  renderMetroButton();
  /* 잼이나 리듬이 메트로놈을 밀어내면 박도 끊긴다. 버튼만 계속 빛나고 있으면
     무엇이 도는지 알 수 없으므로, 멈춘 것을 듣고 흔적을 거둔다.
     켜 둔 표시(aria-pressed)는 그대로다 — 그건 '다음에 녹음할 때 들을지'다. */
  if(window.OliveMetronome && typeof window.OliveMetronome.onPlaying==='function'){
    window.OliveMetronome.onPlaying(on=>{
      if(on) return;
      /* 녹음을 시작하는 중이라면 우리가 카운트인을 위해 방금 멈춘 것이다.
         여기서 거두면 걸어 둔 박 리스너까지 떨어져 세지 못한다. */
      if(startPending) return;
      metroStartedByRecorder=false;
      detachMetroBeat();
      cancelCountIn();
    });
  }

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
    /* 멈춘 채로 화면이 가려지는 순간이 자리를 지켜야 하는 때다. 앞에 있는 동안
       멈춰 두었다가 잠그는 길도 여기로 들어온다. */
    if(document.visibilityState==='hidden' && cloudMediaId && !cloudPlayingId){
      cloudKeepAliveRestored=false;
      keepCloudTransportFlowing({onHide:true});
    }
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

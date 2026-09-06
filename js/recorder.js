/* ===================== 녹음 =====================
   계정에 연결한 사용자가 마이크 녹음을 확인한 뒤 비공개로 저장한다. */
(function(){
  'use strict';

  const MAX_DURATION_MS=5*60*1000;
  const MAX_RECORDINGS=50;
  const WAVEFORM_POINTS=160;
  const WAVEFORM_MAX_POINTS=240;
  const CAPTURE_GAIN=2;
  const recordGuest=document.getElementById('recordGuest');
  const recordWorkspace=document.getElementById('recordWorkspace');
  const recordListCard=document.getElementById('recordListCard');
  const recordConnect=document.getElementById('recordConnect');
  const recordToggle=document.getElementById('recordToggle');
  const recordTimer=document.getElementById('recordTimer');
  const recordState=document.getElementById('recordState');
  const recordStateDot=document.getElementById('recordStateDot');
  const recordLevel=document.getElementById('recordLevelFill');
  const recordHint=document.getElementById('recordHint');
  const recordDraft=document.getElementById('recordDraft');
  const recordTitle=document.getElementById('recordTitle');
  const recordDiscard=document.getElementById('recordDiscard');
  const recordSave=document.getElementById('recordSave');
  const recordMessage=document.getElementById('recordMessage');
  const recordUsage=document.getElementById('recordUsage');
  const recordList=document.getElementById('recordList');
  const menuBackdrop=document.getElementById('recordMenuBackdrop');
  const menuTitle=document.getElementById('recordMenuTitle');
  const menuRename=document.getElementById('recordMenuRename');
  const menuDownload=document.getElementById('recordMenuDownload');
  const menuDelete=document.getElementById('recordMenuDelete');
  const menuCancel=document.getElementById('recordMenuCancel');
  const app=document.getElementById('app');
  if(!recordToggle || !window.OliveCloud) return;

  const draftAudio=new Audio();
  const cloudFallbackAudio=new Audio();
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
  let captureGain=null;
  let captureCompressor=null;
  let captureDestination=null;
  let levelSamples=null;
  let waveformLevels=[];
  let lastWaveformCaptureAt=0;
  let draft=null;
  let draftUrl='';
  let expandedRecordingId='';
  let cloudPlayingId='';
  let cloudMediaId='';
  let cloudPlaybackMode='';
  let cloudStartedAt=0;
  let cloudStartedOffset=0;
  let cloudDecodedBuffer=null;
  let cloudDecodedContext=null;
  let cloudSource=null;
  let cloudPlayToken=0;
  let cloudProgressFrame=0;
  const cloudBlobs=new Map();
  const waveformCache=new Map();
  const waveformLoads=new Map();
  const playbackPositions=new Map();
  let loadingList=false;

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
    return pad(Math.floor(seconds/60))+':'+pad(seconds%60);
  }
  function formatDate(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}. ${pad(date.getMonth()+1)}. ${pad(date.getDate())}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function clamp(value,min,max){ return Math.min(max,Math.max(min,value)); }
  function rowDurationSeconds(row){ return Math.max(0,Number(row&&row.duration_ms)||0)/1000; }
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
  function defaultTitle(){
    return '무제';
  }
  function safeFileName(title,extension){
    const clean=String(title||'O-live 녹음').replace(/[\\/:*?"<>|]/g,' ').trim().slice(0,60);
    return `${clean||'O-live 녹음'}.${extension}`;
  }
  function extensionFor(mime){
    const type=String(mime||'').toLowerCase();
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
  function setMessage(message,error){
    recordMessage.textContent=message||'';
    recordMessage.classList.toggle('error',Boolean(error));
  }
  function setTimer(ms){ recordTimer.textContent=formatDuration(ms); }
  function setButtonMode(mode){
    recordToggle.dataset.mode=mode;
    recordToggle.classList.toggle('on',mode==='recording');
    recordToggle.classList.toggle('playing',mode==='preview' && !draftAudio.paused);
    recordToggle.setAttribute('aria-label',{
      idle:'녹음 시작',starting:'마이크 연결 취소',recording:'녹음 정지',preview:'녹음 미리 듣기',
    }[mode]||'녹음');
    recordToggle.setAttribute('aria-busy',mode==='starting'?'true':'false');
  }
  function renderIdle(){
    setTimer(0);
    recordState.textContent='새 녹음';
    recordStateDot.hidden=true;
    recordHint.textContent='최대 5분 · 저장하기 전에 먼저 들어볼 수 있습니다';
    recordDraft.hidden=true;
    recordLevel.style.transform='scaleX(0)';
    setButtonMode('idle');
  }
  function renderDraft(){
    if(!draft){ renderIdle(); return; }
    setTimer(draft.durationMs);
    recordState.textContent=draftAudio.paused ? '녹음 확인' : '재생 중';
    recordStateDot.hidden=true;
    recordHint.textContent='확인한 뒤 클라우드에 저장하세요';
    recordDraft.hidden=false;
    recordTitle.value=draft.title;
    setButtonMode('preview');
  }
  function teardownCaptureGraph(){
    if(captureDestination && captureDestination.stream){
      captureDestination.stream.getTracks().forEach(track=>{ try{ track.stop(); }catch(e){} });
    }
    try{ if(levelSource) levelSource.disconnect(); }catch(e){}
    try{ if(captureGain) captureGain.disconnect(); }catch(e){}
    try{ if(captureCompressor) captureCompressor.disconnect(); }catch(e){}
    try{ if(captureDestination) captureDestination.disconnect(); }catch(e){}
    try{ if(levelSink) levelSink.disconnect(); }catch(e){}
    levelSource=levelAnalyser=levelSink=levelSamples=null;
    captureGain=captureCompressor=captureDestination=null;
    cancelAnimationFrame(levelFrame); levelFrame=0;
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
    if(anySounding()) return;
    setAudioSession('ambient');
    releaseCtx();
  }
  function discardDraft(){
    draftAudio.pause();
    draftAudio.removeAttribute('src');
    if(draftUrl) URL.revokeObjectURL(draftUrl);
    draftUrl=''; draft=null;
    renderIdle();
  }
  function drawLevel(now){
    if(!recording || !levelAnalyser) return;
    const data=levelSamples&&levelSamples.length===levelAnalyser.fftSize
      ? levelSamples
      : (levelSamples=new Float32Array(levelAnalyser.fftSize));
    if(typeof levelAnalyser.getFloatTimeDomainData==='function'){
      levelAnalyser.getFloatTimeDomainData(data);
    }else{
      const bytes=new Uint8Array(levelAnalyser.fftSize);
      levelAnalyser.getByteTimeDomainData(bytes);
      for(let index=0;index<bytes.length;index++) data[index]=(bytes[index]-128)/128;
    }
    let sum=0;
    for(let i=0;i<data.length;i++){
      const sample=data[i];
      sum+=sample*sample;
    }
    const rms=Math.sqrt(sum/data.length);
    if(!lastWaveformCaptureAt || now-lastWaveformCaptureAt>=40){
      waveformLevels.push(rms);
      lastWaveformCaptureAt=now;
    }
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
    if(typeof ctx.createMediaStreamDestination!=='function' || typeof ctx.createDynamicsCompressor!=='function'){
      setupLevel(ctx,levelSource);
      return stream;
    }
    captureGain=ctx.createGain();
    captureGain.gain.value=CAPTURE_GAIN;
    captureCompressor=ctx.createDynamicsCompressor();
    captureCompressor.threshold.value=-8;
    captureCompressor.knee.value=8;
    captureCompressor.ratio.value=4;
    captureCompressor.attack.value=.005;
    captureCompressor.release.value=.18;
    captureDestination=ctx.createMediaStreamDestination();
    levelSource.connect(captureGain);
    captureGain.connect(captureCompressor);
    captureCompressor.connect(captureDestination);
    setupLevel(ctx,captureCompressor);
    return captureDestination.stream;
  }
  async function startRecording(){
    if(!currentUser){ window.OliveCloud.openAccount(); return; }
    if(!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      setMessage('이 브라우저에서는 녹음을 사용할 수 없습니다',true); return;
    }
    if(draft) discardDraft();
    stopCloudPlayback();
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
        channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:true,
      }});
      if(token!==startToken || !startPending){ finishAudioSession(); return; }
      if(ctx!==audioCtx || ctx.state!=='running'){
        ctx=await ensureRecordingCtx(preservePlayback && anySounding());
      }
      if(token!==startToken || !startPending){ finishAudioSession(); return; }
      const mimeType=chooseMimeType();
      const options={audioBitsPerSecond:96000};
      if(mimeType) options.mimeType=mimeType;
      const processedStream=setupCapture(ctx);
      try{
        recorder=new MediaRecorder(processedStream,options);
      }catch(error){
        if(processedStream===stream) throw error;
        // 일부 구형 Safari가 Web Audio에서 만든 스트림의 MediaRecorder 생성을
        // 거부하면 녹음 자체는 기존 마이크 스트림으로 계속 사용할 수 있게 한다.
        teardownCaptureGraph();
        levelSource=ctx.createMediaStreamSource(stream);
        setupLevel(ctx,levelSource);
        recorder=new MediaRecorder(stream,options);
      }
      chunks=[];
      waveformLevels=[];
      lastWaveformCaptureAt=0;
      recorder.addEventListener('dataavailable',event=>{
        if(event.data && event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener('error',()=>{
        setMessage('녹음을 완료하지 못했습니다. 다시 시도해 주세요',true);
      });
      recorder.addEventListener('stop',finalizeDraft,{once:true});
      stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{
        if(recording) stopRecording();
      },{once:true}));
      /* iPhone Safari의 MP4 MediaRecorder는 timeslice로 잘게 나눈 조각을
         다시 합쳤을 때 긴 녹음이 재생 불가능해지는 경우가 있다.
         최대 5분·96kbps면 메모리 부담이 작으므로 stop 때 한 파일로 받는다. */
      recorder.start();
      recording=true; startPending=false; startedAt=performance.now(); recordedAt=new Date().toISOString();
      timerId=setInterval(updateTimer,200);
      setTabSounding('trainer',true,'recorder');
      recordState.textContent='녹음 중';
      recordStateDot.hidden=false;
      recordHint.textContent='메트로놈·잼과 함께 사용할 수 있습니다 · 튜너 또는 앱을 벗어나면 중지됩니다';
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
    recording=false;
    clearInterval(timerId); timerId=0;
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
      waveform:compactWaveform(waveformLevels,WAVEFORM_POINTS),
    };
    waveformLevels=[];
    draftUrl=URL.createObjectURL(blob);
    draftAudio.src=draftUrl;
    renderDraft();
  }
  async function toggleDraftPlayback(){
    if(!draft) return;
    if(!draftAudio.paused){ draftAudio.pause(); return; }
    stopCloudPlayback();
    try{
      setAudioSession('playback');
      await draftAudio.play();
    }
    catch(e){ setMessage('재생 버튼을 다시 눌러주세요',true); }
  }
  function currentCloudPosition(){
    if(cloudPlayingId && cloudPlaybackMode==='native'){
      return Math.max(0,Number(cloudFallbackAudio.currentTime)||0);
    }
    if(cloudPlayingId && cloudPlaybackMode==='decoded' && cloudDecodedContext){
      return Math.max(0,cloudStartedOffset+cloudDecodedContext.currentTime-cloudStartedAt);
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
  }
  function startCloudProgress(){
    stopCloudProgress();
    const tick=()=>{
      if(!cloudPlayingId) return;
      const position=currentCloudPosition();
      playbackPositions.set(cloudPlayingId,position);
      updatePlayerProgress(cloudPlayingId,position);
      cloudProgressFrame=requestAnimationFrame(tick);
    };
    cloudProgressFrame=requestAnimationFrame(tick);
  }
  function releaseCloudSource(){
    const source=cloudSource;
    cloudSource=null;
    if(!source) return;
    source.onended=null;
    try{ source.stop(); }catch(e){}
    try{ source.disconnect(); }catch(e){}
  }
  function stopCloudPlayback(resetPosition){
    const mediaId=cloudMediaId||cloudPlayingId;
    ++cloudPlayToken;
    stopCloudProgress();
    cloudFallbackAudio.pause();
    cloudFallbackAudio.removeAttribute('src');
    releaseCloudSource();
    if(resetPosition!==false && mediaId) playbackPositions.delete(mediaId);
    cloudPlayingId='';
    cloudMediaId='';
    cloudPlaybackMode='';
    cloudStartedAt=0;
    cloudStartedOffset=0;
    cloudDecodedBuffer=null;
    cloudDecodedContext=null;
    setTabSounding('trainer',false,'recording-playback');
    renderList();
  }
  function pauseCloudPlayback(){
    if(!cloudPlayingId) return;
    const id=cloudPlayingId;
    playbackPositions.set(id,currentCloudPosition());
    ++cloudPlayToken;
    stopCloudProgress();
    if(cloudPlaybackMode==='native') cloudFallbackAudio.pause();
    else releaseCloudSource();
    cloudPlaybackMode=cloudPlaybackMode==='native'?'native-paused':'decoded-paused';
    cloudPlayingId='';
    setTabSounding('trainer',false,'recording-playback');
    renderList();
  }
  function finishCloudPlayback(){
    const id=cloudMediaId||cloudPlayingId;
    stopCloudProgress();
    releaseCloudSource();
    if(id) playbackPositions.delete(id);
    cloudPlayingId='';
    cloudPlaybackMode=cloudPlaybackMode==='native'?'native-paused':'decoded-paused';
    setTabSounding('trainer',false,'recording-playback');
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
  function startDecodedSource(ctx,buffer,row,token,offset){
    try{
      releaseCloudSource();
      const source=ctx.createBufferSource();
      const duration=Math.max(0,Number(buffer.duration)||rowDurationSeconds(row));
      const startAt=clamp(Number(offset)||0,0,Math.max(0,duration-.02));
      source.buffer=buffer;
      source.connect(ctx.destination);
      source.onended=()=>{
        if(cloudSource!==source || token!==cloudPlayToken) return;
        try{ source.disconnect(); }catch(e){}
        cloudSource=null;
        finishCloudPlayback();
      };
      cloudSource=source;
      cloudDecodedBuffer=buffer;
      cloudDecodedContext=ctx;
      cloudStartedOffset=startAt;
      cloudStartedAt=ctx.currentTime;
      cloudPlaybackMode='decoded';
      source.start(0,startAt);
      setTabSounding('trainer',true,'recording-playback');
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
    startDecodedSource(ctx,buffer,row,token,offset);
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
  function prepareNativeOffset(offset){
    const apply=()=>{
      const duration=Number(cloudFallbackAudio.duration)||0;
      try{ cloudFallbackAudio.currentTime=clamp(Number(offset)||0,0,Math.max(0,duration-.02)); }catch(e){}
    };
    if(cloudFallbackAudio.readyState>=1) apply();
    else cloudFallbackAudio.addEventListener('loadedmetadata',apply,{once:true});
  }
  function playRow(row,requestedOffset){
    const seeking=Number.isFinite(requestedOffset);
    if(cloudPlayingId===row.id && !seeking){ pauseCloudPlayback(); return; }
    if(cloudPlayingId===row.id) pauseCloudPlayback();
    else if(cloudPlayingId || (cloudMediaId && cloudMediaId!==row.id)) stopCloudPlayback();
    draftAudio.pause();
    let playback;
    try{ playback=beginPlaybackFromGesture(); }
    catch(error){ setMessage('오디오 재생을 시작하지 못했습니다',true); return; }
    // 네이티브 재생이 성공하면 Web Audio 준비 결과를 기다리지 않으므로
    // 그 경로의 실패도 처리된 Promise로 남겨 콘솔 오류를 만들지 않는다.
    playback.ready.catch(()=>{});
    const offset=clamp(seeking?requestedOffset:Number(playbackPositions.get(row.id))||0,0,rowDurationSeconds(row));
    playbackPositions.set(row.id,offset);
    if(cloudMediaId===row.id && cloudPlaybackMode==='native-paused' && cloudFallbackAudio.getAttribute('src')){
      const token=++cloudPlayToken;
      cloudPlayingId=row.id;
      cloudPlaybackMode='native';
      prepareNativeOffset(offset);
      Promise.resolve(cloudFallbackAudio.play()).then(()=>{
        if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
        setTabSounding('trainer',true,'recording-playback');
        setMessage(''); renderList(); startCloudProgress();
      }).catch(error=>handlePlaybackFailure(playbackStageError('audio',error),row,token));
      renderList(); return;
    }
    if(cloudMediaId===row.id && cloudPlaybackMode==='decoded-paused' && cloudDecodedBuffer && cloudDecodedContext){
      const token=++cloudPlayToken;
      cloudPlayingId=row.id;
      startDecodedSource(cloudDecodedContext,cloudDecodedBuffer,row,token,offset);
      return;
    }
    const cached=cloudBlobs.get(row.id);
    const token=++cloudPlayToken;
    setMessage('녹음을 불러오는 중입니다');
    cloudPlayingId=row.id;
    cloudMediaId=row.id;
    const recordingBlob=cached
      ? Promise.resolve({blob:cached.blob,cached:true})
      : findPlaybackBlob(row);
    // 서명 주소로 바로 재생되는 동안에는 다운로드가 캐시를 채우는 역할만 한다.
    // 실패해도 네이티브 재생을 방해하지 않고, 필요하면 아래 대체 경로가 다시 받는다.
    recordingBlob.catch(error=>console.warn('[O\'live recording cache fill]',error));
    const playbackUrl=cached ? cached.url : String(row.playback_url||'');
    if(playbackUrl){
      cloudFallbackAudio.src=playbackUrl;
      cloudPlaybackMode='native';
      prepareNativeOffset(offset);
      const playPromise=cloudFallbackAudio.play();
      Promise.resolve(playPromise).then(()=>{
        if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
        setTabSounding('trainer',true,'recording-playback');
        setMessage(''); renderList(); startCloudProgress();
      }).catch(error=>{
        if(token!==cloudPlayToken || cloudPlayingId!==row.id) return;
        console.warn('[O\'live native recording playback]',error);
        cloudFallbackAudio.pause();
        cloudFallbackAudio.removeAttribute('src');
        cloudPlaybackMode='';
        playDecodedBlob(playback,recordingBlob,row,token,offset)
          .catch(fallbackError=>handlePlaybackFailure(fallbackError,row,token));
      });
      renderList();
      return;
    }
    playDecodedBlob(playback,recordingBlob,row,token,offset)
      .catch(error=>handlePlaybackFailure(error,row,token));
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
    const waveform=document.createElement('div'); waveform.className='record-waveform';
    waveform.tabIndex=0; waveform.setAttribute('role','slider');
    waveform.setAttribute('aria-label',`${row.title} 재생 위치`);
    waveform.setAttribute('aria-valuemin','0');
    waveform.setAttribute('aria-valuemax',String(Math.round(rowDurationSeconds(row))));
    const values=waveformCache.get(row.id)||normalizeWaveform(row.waveform);
    const shown=values.length?values:Array(WAVEFORM_POINTS).fill(8);
    if(!values.length) waveform.classList.add('loading');
    waveform.append(createWaveformSvg(shown,'base'),createWaveformSvg(shown,'played'));
    waveform.addEventListener('click',event=>{
      const bounds=waveform.getBoundingClientRect();
      seekRow(row,bounds.width?(event.clientX-bounds.left)/bounds.width:0,true);
    });
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
    detail.append(waveform,times); player.append(play,detail);
    requestAnimationFrame(()=>updatePlayerProgress(row.id,
      cloudPlayingId===row.id?currentCloudPosition():Number(playbackPositions.get(row.id))||0));
    if(!values.length) loadRowWaveform(row);
    return player;
  }
  function toggleRowExpanded(row){
    if(expandedRecordingId===row.id){
      expandedRecordingId='';
      if(cloudMediaId===row.id) stopCloudPlayback();
      else renderList();
      return;
    }
    if(cloudMediaId && cloudMediaId!==row.id) stopCloudPlayback();
    expandedRecordingId=row.id;
    renderList();
  }
  function renderList(){
    recordUsage.textContent=`${rows.length} / ${MAX_RECORDINGS}`;
    recordList.innerHTML='';
    if(loadingList){
      const state=document.createElement('p'); state.className='record-empty'; state.textContent='녹음을 불러오는 중입니다';
      recordList.appendChild(state); return;
    }
    if(!rows.length){
      const state=document.createElement('p'); state.className='record-empty'; state.textContent='저장된 녹음이 없습니다';
      recordList.appendChild(state); return;
    }
    rows.forEach(row=>{
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
      item.append(open,more); entry.appendChild(item);
      if(expandedRecordingId===row.id) entry.appendChild(createExpandedPlayer(row));
      recordList.appendChild(entry);
    });
  }
  async function loadRecordings(){
    if(!currentUser){ rows=[]; renderList(); return; }
    const userId=currentUser.id;
    loadingList=true; renderList();
    try{
      rows=await window.OliveCloud.listRecordings();
      rows.forEach(row=>{
        const waveform=normalizeWaveform(row.waveform);
        if(waveform.length) waveformCache.set(row.id,waveform);
      });
      pruneCloudPlaybackCache();
      await hydrateCloudPlaybackCache(userId);
      setMessage('');
    }
    catch(error){ rows=[]; setMessage('녹음 저장소를 준비한 뒤 다시 시도해 주세요',true); }
    finally{ loadingList=false; renderList(); }
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
      discardDraft(); await loadRecordings(); setMessage('클라우드에 저장했습니다');
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
  function openMenu(row,trigger){
    selectedRow=row; menuTrigger=trigger; menuTitle.textContent=row.title;
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
    try{ await window.OliveCloud.renameRecording(row.id,next.trim().slice(0,80)); await loadRecordings(); }
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
      await loadRecordings(); setMessage('녹음을 삭제했습니다');
    }
    catch(e){ setMessage('녹음을 삭제하지 못했습니다',true); }
  }
  function applySession(user){
    const nextId=user&&user.id||'';
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
    else{ rows=[]; renderList(); renderIdle(); }
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
  menuBackdrop.addEventListener('click',event=>{ if(event.target===menuBackdrop) closeMenu(); });
  menuBackdrop.addEventListener('keydown',event=>{ if(event.key==='Escape'){ event.preventDefault(); closeMenu(); } });
  menuRename.addEventListener('click',renameSelected);
  menuDownload.addEventListener('click',downloadSelected);
  menuDelete.addEventListener('click',deleteSelected);
  menuCancel.addEventListener('click',closeMenu);
  draftAudio.addEventListener('play',()=>{ recordState.textContent='재생 중'; setButtonMode('preview'); setTabSounding('trainer',true,'recording-preview'); });
  draftAudio.addEventListener('pause',()=>{ if(draft){ recordState.textContent='녹음 확인'; setButtonMode('preview'); } setTabSounding('trainer',false,'recording-preview'); });
  draftAudio.addEventListener('ended',()=>{ recordState.textContent='녹음 확인'; setButtonMode('preview'); setTabSounding('trainer',false,'recording-preview'); });
  cloudFallbackAudio.addEventListener('ended',finishCloudPlayback);
  registerTransport({
    isPlaying:()=>recording || startPending || !draftAudio.paused || Boolean(cloudPlayingId),
    stop:()=>{
      if(recording || startPending) stopRecording();
      draftAudio.pause(); stopCloudPlayback();
    },
  });
  window.OliveRecorder={
    isRecording:()=>recording || startPending,
  };
  window.OliveCloud.subscribeSession(applySession);
  renderIdle(); renderList();
})();

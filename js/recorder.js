/* ===================== 녹음 =====================
   계정에 연결한 사용자가 마이크 녹음을 확인한 뒤 비공개로 저장한다. */
(function(){
  'use strict';

  const MAX_DURATION_MS=5*60*1000;
  const MAX_RECORDINGS=50;
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
  const cloudAudio=new Audio();
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
  let timerId=0;
  let levelFrame=0;
  let levelAnalyser=null;
  let levelSource=null;
  let levelSink=null;
  let draft=null;
  let draftUrl='';
  let cloudPlayingId='';
  let cloudUrl='';
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
    return `${date.getFullYear()}. ${pad(date.getMonth()+1)}. ${pad(date.getDate())}`;
  }
  function defaultTitle(){
    const date=new Date();
    return `${date.getMonth()+1}월 ${date.getDate()}일 녹음`;
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
  function stopTracks(){
    if(stream){
      stream.getTracks().forEach(track=>{ try{ track.stop(); }catch(e){} });
      stream=null;
    }
    try{ if(levelSource) levelSource.disconnect(); }catch(e){}
    try{ if(levelSink) levelSink.disconnect(); }catch(e){}
    levelSource=levelAnalyser=levelSink=null;
    cancelAnimationFrame(levelFrame); levelFrame=0;
    recordLevel.style.transform='scaleX(0)';
  }
  function finishAudioSession(){
    stopTracks();
    setTabSounding('trainer',false,'recorder');
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
  function drawLevel(){
    if(!recording || !levelAnalyser) return;
    const data=new Uint8Array(levelAnalyser.fftSize);
    levelAnalyser.getByteTimeDomainData(data);
    let sum=0;
    for(let i=0;i<data.length;i++){
      const sample=(data[i]-128)/128;
      sum+=sample*sample;
    }
    const rms=Math.sqrt(sum/data.length);
    recordLevel.style.transform=`scaleX(${Math.min(1,Math.max(.018,rms*7)).toFixed(3)})`;
    levelFrame=requestAnimationFrame(drawLevel);
  }
  function updateTimer(){
    if(!recording) return;
    const elapsed=Math.min(MAX_DURATION_MS,performance.now()-startedAt);
    setTimer(elapsed);
    if(elapsed>=MAX_DURATION_MS) stopRecording();
  }
  function setupLevel(ctx){
    if(!stream || !ctx) return;
    levelSource=ctx.createMediaStreamSource(stream);
    levelAnalyser=ctx.createAnalyser();
    levelAnalyser.fftSize=512;
    levelAnalyser.smoothingTimeConstant=.65;
    levelSink=ctx.createGain();
    levelSink.gain.value=0;
    levelSource.connect(levelAnalyser);
    levelAnalyser.connect(levelSink);
    levelSink.connect(ctx.destination);
    levelFrame=requestAnimationFrame(drawLevel);
  }
  async function startRecording(){
    if(!currentUser){ window.OliveCloud.openAccount(); return; }
    if(!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      setMessage('이 브라우저에서는 녹음을 사용할 수 없습니다',true); return;
    }
    if(draft) discardDraft();
    stopAllTransports();
    const token=++startToken;
    startPending=true;
    setMessage('');
    recordState.textContent='마이크 연결 중…';
    recordStateDot.hidden=true;
    setButtonMode('starting');
    try{
      setAudioSession('play-and-record');
      await ensureCtx('play-and-record',true);
      if(token!==startToken || !startPending){ finishAudioSession(); return; }
      stream=await navigator.mediaDevices.getUserMedia({audio:{
        channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false,
      }});
      if(token!==startToken || !startPending){ finishAudioSession(); return; }
      const ctx=await ensureCtx('play-and-record',true);
      if(token!==startToken || !startPending){ finishAudioSession(); return; }
      const mimeType=chooseMimeType();
      const options={audioBitsPerSecond:96000};
      if(mimeType) options.mimeType=mimeType;
      recorder=new MediaRecorder(stream,options);
      chunks=[];
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
      setupLevel(ctx);
      recorder.start(1000);
      recording=true; startPending=false; startedAt=performance.now();
      timerId=setInterval(updateTimer,200);
      setTabSounding('trainer',true,'recorder');
      recordState.textContent='녹음 중';
      recordStateDot.hidden=false;
      recordHint.textContent='화면을 나가면 녹음이 중지됩니다';
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
    draft={blob,durationMs,mimeType:type,title:defaultTitle(),extension:extensionFor(type)};
    draftUrl=URL.createObjectURL(blob);
    draftAudio.src=draftUrl;
    renderDraft();
  }
  async function toggleDraftPlayback(){
    if(!draft) return;
    if(!draftAudio.paused){ draftAudio.pause(); return; }
    stopCloudPlayback();
    try{ await draftAudio.play(); }
    catch(e){ setMessage('재생 버튼을 다시 눌러주세요',true); }
  }
  function stopCloudPlayback(){
    cloudAudio.pause();
    cloudAudio.removeAttribute('src');
    if(cloudUrl) URL.revokeObjectURL(cloudUrl);
    cloudUrl=''; cloudPlayingId='';
    setTabSounding('trainer',false,'recording-playback');
    renderList();
  }
  async function playRow(row){
    if(cloudPlayingId===row.id && !cloudAudio.paused){ stopCloudPlayback(); return; }
    stopCloudPlayback();
    draftAudio.pause();
    setMessage('녹음을 불러오는 중입니다');
    try{
      const result=await window.OliveCloud.downloadRecording(row);
      cloudUrl=URL.createObjectURL(result.blob);
      cloudPlayingId=row.id;
      cloudAudio.src=cloudUrl;
      await cloudAudio.play();
      setTabSounding('trainer',true,'recording-playback');
      setMessage(''); renderList();
    }catch(error){
      stopCloudPlayback(); setMessage('녹음을 재생하지 못했습니다',true);
    }
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
      const item=document.createElement('div'); item.className='record-row';
      const play=document.createElement('button');
      play.type='button'; play.className='record-row-play'+(cloudPlayingId===row.id&&!cloudAudio.paused?' playing':'');
      play.setAttribute('aria-label',`${row.title} ${cloudPlayingId===row.id&&!cloudAudio.paused?'정지':'재생'}`);
      play.innerHTML='<span aria-hidden="true"></span>';
      play.addEventListener('click',()=>playRow(row));
      const copy=document.createElement('span'); copy.className='record-row-copy';
      const title=document.createElement('strong'); title.textContent=row.title;
      const date=document.createElement('small'); date.textContent=formatDate(row.recorded_at);
      copy.append(title,date);
      const duration=document.createElement('span'); duration.className='record-row-duration'; duration.textContent=formatDuration(row.duration_ms);
      const more=document.createElement('button'); more.type='button'; more.className='record-row-more';
      more.textContent='•••'; more.setAttribute('aria-label',`${row.title} 메뉴`);
      more.addEventListener('click',()=>openMenu(row,more));
      item.append(play,copy,duration,more); recordList.appendChild(item);
    });
  }
  async function loadRecordings(){
    if(!currentUser){ rows=[]; renderList(); return; }
    loadingList=true; renderList();
    try{ rows=await window.OliveCloud.listRecordings(); setMessage(''); }
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
      await window.OliveCloud.uploadRecording({...draft,id:makeId()});
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
      const result=await window.OliveCloud.downloadRecording(row);
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
    try{ await window.OliveCloud.deleteRecording(row); await loadRecordings(); setMessage('녹음을 삭제했습니다'); }
    catch(e){ setMessage('녹음을 삭제하지 못했습니다',true); }
  }
  function applySession(user){
    const nextId=user&&user.id||'';
    if(sessionUserId && sessionUserId!==nextId){
      if(recording || startPending) stopRecording();
      discardDraft(); stopCloudPlayback();
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
  cloudAudio.addEventListener('pause',()=>{ setTabSounding('trainer',false,'recording-playback'); renderList(); });
  cloudAudio.addEventListener('ended',stopCloudPlayback);
  registerTransport({
    isPlaying:()=>recording || startPending || !draftAudio.paused || !cloudAudio.paused,
    stop:()=>{
      if(recording || startPending) stopRecording();
      draftAudio.pause(); stopCloudPlayback();
    },
  });
  window.OliveRecorder={
    isRecording:()=>recording || startPending,
    stopForNavigation:()=>{ if(recording || startPending) stopRecording(); },
  };
  window.OliveCloud.subscribeSession(applySession);
  renderIdle(); renderList();
})();

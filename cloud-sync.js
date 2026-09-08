(function(){
  'use strict';

  const ANON_HISTORY_KEY='olive-ear-history-v1';
  const USER_HISTORY_PREFIX='olive-ear-history-user-v1:';
  const QUEUE_PREFIX='olive-ear-sync-queue-v1:';
  const INSTALL_ID_KEY='olive-install-id-v1';
  const HISTORY_MODES=['interval','chord','scale'];

  const config=window.OLIVE_CLOUD_CONFIG||{};
  const EXPECTED_SCHEMA_VERSION=Math.max(0,Number(
    window.OLIVE_RELEASE&&window.OLIVE_RELEASE.schemaVersion
  )||0);
  const configured=Boolean(
    /^https:\/\/[^/]+\.supabase\.co\/?$/.test(config.supabaseUrl||'') &&
    config.supabasePublishableKey
  );

  let client=null;
  let currentUser=null;
  let activeUserId='';
  let syncing=false;
  let preferenceTimer=null;
  let preferenceReady=true;
  let handlers=null;
  let ui={};
  let sheetTrigger=null;
  let schemaContract={ready:false,version:0,checkedAt:0};
  const sessionSubscribers=new Set();

  function readJSON(key,fallback){
    try{
      const value=JSON.parse(localStorage.getItem(key)||'null');
      return value===null ? fallback : value;
    }catch(e){ return fallback; }
  }
  function writeJSON(key,value){
    try{ localStorage.setItem(key,JSON.stringify(value)); return true; }
    catch(e){ return false; }
  }
  function makeId(){
    if(crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=Math.random()*16|0;
      return (c==='x'?r:(r&3|8)).toString(16);
    });
  }
  function installationId(){
    let id=localStorage.getItem(INSTALL_ID_KEY);
    if(!id){
      id=makeId();
      try{ localStorage.setItem(INSTALL_ID_KEY,id); }catch(e){}
    }
    return id;
  }
  function sanitizeHistory(value){
    const clean={};
    if(!value || typeof value!=='object' || Array.isArray(value)) return clean;
    Object.entries(value).forEach(([date,rec])=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !rec || typeof rec!=='object') return;
      const total=Math.max(0,Math.floor(Number(rec.total)||0));
      const correct=Math.max(0,Math.min(total,Math.floor(Number(rec.correct)||0)));
      const source=rec.byMode && typeof rec.byMode==='object' ? rec.byMode : {};
      const byMode={};
      HISTORY_MODES.forEach(mode=>{
        const part=source[mode] && typeof source[mode]==='object' ? source[mode] : {};
        const modeTotal=Math.max(0,Math.floor(Number(part.total)||0));
        const modeCorrect=Math.max(0,Math.min(modeTotal,Math.floor(Number(part.correct)||0)));
        byMode[mode]={correct:modeCorrect,total:modeTotal};
      });
      if(total) clean[date]={correct,total,byMode};
    });
    return clean;
  }
  function historyRows(history){
    return Object.entries(sanitizeHistory(history)).map(([score_date,rec])=>({
      score_date,
      correct_count:rec.correct,
      total_count:rec.total,
      interval_correct_count:rec.byMode.interval.correct,
      interval_total_count:rec.byMode.interval.total,
      chord_correct_count:rec.byMode.chord.correct,
      chord_total_count:rec.byMode.chord.total,
      scale_correct_count:rec.byMode.scale.correct,
      scale_total_count:rec.byMode.scale.total,
    }));
  }
  function queueKey(){ return activeUserId ? QUEUE_PREFIX+activeUserId : ''; }
  function readQueue(){
    const value=readJSON(queueKey(),[]);
    return Array.isArray(value) ? value : [];
  }
  function writeQueue(queue){ if(queueKey()) writeJSON(queueKey(),queue); }
  function providerLabel(user){
    const provider=user && user.app_metadata && user.app_metadata.provider;
    return provider==='google' ? 'Google' : '계정';
  }
  function avatarUrl(user){
    const metadata=user && user.user_metadata;
    return metadata && (metadata.avatar_url || metadata.picture) || '';
  }
  function accountInitial(user){
    const metadata=user && user.user_metadata || {};
    const source=metadata.full_name || metadata.name || user && user.email || 'G';
    return Array.from(String(source).trim())[0] || 'G';
  }
  function renderAccountAction(view){
    if(!view || !view.action) return;
    const signedIn=Boolean(currentUser);
    view.action.classList.toggle('has-account',signedIn);
    view.actionLabel.hidden=signedIn;
    view.action.setAttribute('aria-label',signedIn ? providerLabel(currentUser)+' 계정 열기' : '계정 연결');
    if(!signedIn){
      view.avatar.hidden=true;
      view.avatarFallback.hidden=true;
      view.avatar.removeAttribute('src');
      return;
    }
    const url=avatarUrl(currentUser);
    view.avatarFallback.textContent=accountInitial(currentUser);
    view.avatarFallback.hidden=Boolean(url);
    view.avatar.hidden=!url;
    if(url) view.avatar.src=url;
    else view.avatar.removeAttribute('src');
  }
  function redirectUrl(){
    return config.redirectUrl || new URL('./',location.href).href;
  }

  function setState(state,detail){
    if(!ui.accountViews || !ui.accountViews.length) return;
    const copy={
      unconfigured:['클라우드 저장 설정 필요','현재 이 기기에만 기록 중'],
      signedout:['계정에 기록 보관','Google 계정으로 연결'],
      syncing:['데이터 동기화 중','잠시만 기다려 주세요'],
      synced:['클라우드에 저장됨',detail||'다른 기기에서도 이어서 연습할 수 있어요'],
      offline:['오프라인 기록 중',detail||'연결되면 자동으로 동기화됩니다'],
      upgrade:['클라우드 업데이트 필요',detail||'저장소 준비 상태를 확인해 주세요'],
      error:['동기화 확인 필요',detail||'계정 화면에서 다시 시도해 주세요'],
    }[state]||['클라우드 저장',''];
    ui.accountViews.forEach(view=>{
      view.title.textContent=copy[0];
      view.status.textContent=copy[1];
      view.dot.dataset.state=state;
      renderAccountAction(view);
    });
    if(ui.sheetSync) ui.sheetSync.textContent=copy[1];
  }
  function setMessage(message,isError){
    if(!ui.message) return;
    ui.message.textContent=message||'';
    ui.message.classList.toggle('error',Boolean(isError));
  }
  function schemaErrorCode(){
    return 'DB-'+String(EXPECTED_SCHEMA_VERSION||0).padStart(3,'0');
  }
  function isSchemaMismatchError(error){
    const code=String(error&&error.code||'');
    const message=String(error&&error.message||'');
    return ['42703','42883','PGRST202','PGRST204'].includes(code) ||
      /olive_schema_version|record_ear_answer|p_training_mode|interval_correct_count|chord_correct_count|scale_correct_count|practice_recordings|practice_recording|schema cache/i.test(message);
  }
  function showSchemaUpgrade(fromButton){
    const code=schemaErrorCode();
    setState('upgrade',`클라우드 저장소 준비 필요 · ${code}`);
    if(fromButton){
      setMessage(`클라우드 저장소 업데이트가 필요합니다 · 오류 코드 ${code}`,true);
    }
  }
  async function checkSchemaContract(force){
    if(!EXPECTED_SCHEMA_VERSION) return true;
    if(!force && schemaContract.ready && Date.now()-schemaContract.checkedAt<300000){
      return true;
    }
    const {data,error}=await client.rpc('olive_schema_version');
    if(error){
      if(isSchemaMismatchError(error)){
        schemaContract={ready:false,version:0,checkedAt:Date.now()};
        return false;
      }
      throw error;
    }
    const version=Math.max(0,Math.floor(Number(data)||0));
    schemaContract={
      ready:version>=EXPECTED_SCHEMA_VERSION,
      version,
      checkedAt:Date.now(),
    };
    return schemaContract.ready;
  }
  function friendlySyncFailure(error){
    const code=String(error&&error.code||'');
    if(!navigator.onLine) return '인터넷 연결을 확인해 주세요 · 오류 코드 NET-001';
    if(code==='401' || code==='PGRST301'){
      return '로그인 정보가 만료되었습니다. 다시 로그인해 주세요 · 오류 코드 AUTH-401';
    }
    if(code==='42501'){
      return '클라우드 접근 권한을 확인해 주세요 · 오류 코드 AUTH-403';
    }
    return '네트워크 또는 서버 응답을 확인해 주세요 · 오류 코드 SYNC-001';
  }
  function openSheet(){
    if(!ui.sheet) return;
    sheetTrigger=document.activeElement && typeof document.activeElement.focus==='function'
      ? document.activeElement
      : null;
    if(ui.app) ui.app.setAttribute('inert','');
    ui.sheet.hidden=false;
    requestAnimationFrame(()=>ui.sheet.classList.add('open'));
    document.body.classList.add('cloud-sheet-open');
    renderSheet();
    setTimeout(()=>ui.close.focus(),50);
  }
  function closeSheet(){
    if(!ui.sheet) return;
    ui.sheet.classList.remove('open');
    document.body.classList.remove('cloud-sheet-open');
    setTimeout(()=>{
      if(ui.sheet.classList.contains('open')) return;
      ui.sheet.hidden=true;
      if(ui.app) ui.app.removeAttribute('inert');
      if(sheetTrigger && sheetTrigger.isConnected) sheetTrigger.focus();
      sheetTrigger=null;
    },220);
  }
  function handleSheetKeydown(event){
    if(ui.sheet.hidden) return;
    if(event.key==='Escape'){
      event.preventDefault();
      closeSheet();
      return;
    }
    if(event.key!=='Tab') return;
    const focusable=Array.from(ui.sheet.querySelectorAll(
      'button:not([disabled]),a[href],summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(element=>!element.hidden && element.offsetParent!==null);
    if(!focusable.length){
      event.preventDefault();
      ui.close.focus();
      return;
    }
    const first=focusable[0];
    const last=focusable[focusable.length-1];
    if(event.shiftKey && document.activeElement===first){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey && document.activeElement===last){
      event.preventDefault();
      first.focus();
    }
  }
  function renderSheet(){
    if(!ui.loggedOut) return;
    ui.loggedOut.hidden=Boolean(currentUser);
    ui.loggedIn.hidden=!currentUser;
    ui.google.disabled=!configured || syncing;
    if(ui.sync) ui.sync.disabled=syncing;
    if(ui.logout) ui.logout.disabled=syncing;
    if(ui.deleteData) ui.deleteData.disabled=syncing;
    if(ui.deleteAccount) ui.deleteAccount.disabled=syncing;
    ui.setupHint.hidden=configured;
    if(currentUser){
      ui.provider.textContent=providerLabel(currentUser)+'로 연결됨';
      ui.identity.textContent=currentUser.email || '이메일을 공유하지 않은 계정';
    }
  }
  function bindUI(){
    ui={
      app:document.getElementById('app'),
      sheet:document.getElementById('cloudAuthSheet'),
      close:document.getElementById('cloudAuthClose'),
      loggedOut:document.getElementById('cloudLoggedOut'),
      loggedIn:document.getElementById('cloudLoggedIn'),
      google:document.getElementById('cloudGoogleLogin'),
      logout:document.getElementById('cloudLogout'),
      sync:document.getElementById('cloudSyncNow'),
      deleteData:document.getElementById('cloudDeleteData'),
      deleteAccount:document.getElementById('cloudDeleteAccount'),
      provider:document.getElementById('cloudProviderName'),
      identity:document.getElementById('cloudIdentity'),
      sheetSync:document.getElementById('cloudSheetSync'),
      setupHint:document.getElementById('cloudSetupHint'),
      message:document.getElementById('cloudAuthMessage'),
    };
    ui.accountViews=['earCloud','recordCloud'].map(prefix=>({
      title:document.getElementById(prefix+'Title'),
      status:document.getElementById(prefix+'Status'),
      dot:document.getElementById(prefix+'Dot'),
      action:document.getElementById(prefix+'Action'),
      actionLabel:document.getElementById(prefix+'ActionLabel'),
      avatar:document.getElementById(prefix+'Avatar'),
      avatarFallback:document.getElementById(prefix+'AvatarFallback'),
    })).filter(view=>view.title && view.status && view.dot && view.action &&
      view.actionLabel && view.avatar && view.avatarFallback);
    if(!ui.accountViews.length || !ui.sheet) return;
    ui.accountViews.forEach(view=>{
      view.action.addEventListener('click',openSheet);
      view.avatar.addEventListener('error',()=>{
        view.avatar.hidden=true;
        view.avatarFallback.hidden=!currentUser;
      });
    });
    ui.close.addEventListener('click',closeSheet);
    ui.sheet.addEventListener('click',e=>{ if(e.target===ui.sheet) closeSheet(); });
    ui.sheet.addEventListener('keydown',handleSheetKeydown);
    ui.google.addEventListener('click',signInWithGoogle);
    ui.logout.addEventListener('click',signOut);
    ui.sync.addEventListener('click',()=>syncAndRefresh(true));
    if(ui.deleteData) ui.deleteData.addEventListener('click',deleteCloudData);
    if(ui.deleteAccount) ui.deleteAccount.addEventListener('click',deleteAccount);
  }

  async function signInWithGoogle(){
    if(!client || syncing) return;
    syncing=true;
    renderSheet();
    setMessage('로그인 화면을 여는 중입니다');
    const options={redirectTo:redirectUrl()};
    options.queryParams={prompt:'select_account'};
    const {error}=await client.auth.signInWithOAuth({provider:'google',options});
    syncing=false;
    renderSheet();
    if(error) setMessage(error.message,true);
  }
  async function signOut(){
    if(!client || syncing) return;
    const userId=activeUserId;
    syncing=true;
    renderSheet();
    setMessage('연결을 해제하는 중입니다');
    const {error}=await client.auth.signOut();
    if(!error) await clearRecordingAudioCache(userId);
    syncing=false;
    renderSheet();
    if(error) setMessage(error.message,true);
  }
  async function migrateAnonymousHistory(){
    const anonymous=sanitizeHistory(handlers.getAnonymousHistory());
    const rows=historyRows(anonymous);
    if(!rows.length) return;
    const {error}=await client.rpc('import_ear_history',{
      p_install_id:installationId(),
      p_days:rows,
    });
    if(error) throw error;
    handlers.clearAnonymousHistory();
  }
  async function syncQueue(){
    if(!client || !currentUser || syncing || !navigator.onLine) return false;
    const queue=readQueue();
    if(!queue.length) return true;
    const processedIds=new Set();
    let completed=false;
    syncing=true;
    setState('syncing');
    renderSheet();
    try{
      for(let i=0;i<queue.length;i++){
        const item=queue[i];
        const {error}=await client.rpc('record_ear_answer',{
          p_event_id:item.id,
          p_score_date:item.date,
          p_is_correct:item.correct,
          p_training_mode:HISTORY_MODES.includes(item.mode)?item.mode:'unclassified',
        });
        if(error){
          throw error;
        }
        processedIds.add(item.id);
        writeQueue(readQueue().filter(pending=>!processedIds.has(pending.id)));
      }
      completed=true;
      return true;
    }finally{
      syncing=false;
      renderSheet();
      if(completed && currentUser && navigator.onLine && readQueue().length){
        setTimeout(()=>syncQueue().then(ok=>{ if(ok) setState('synced'); }).catch(error=>{
          setState('error');
          console.warn('[O\'live queued sync]',error);
        }),0);
      }
    }
  }
  async function fetchHistory(){
    if(!client || !currentUser) return;
    const {data,error}=await client
      .from('ear_daily_scores')
      .select('score_date,correct_count,total_count,interval_correct_count,interval_total_count,chord_correct_count,chord_total_count,scale_correct_count,scale_total_count')
      .order('score_date',{ascending:true});
    if(error) throw error;
    const history={};
    (data||[]).forEach(row=>{
      history[row.score_date]={
        correct:Number(row.correct_count)||0,
        total:Number(row.total_count)||0,
        byMode:{
          interval:{
            correct:Number(row.interval_correct_count)||0,
            total:Number(row.interval_total_count)||0,
          },
          chord:{
            correct:Number(row.chord_correct_count)||0,
            total:Number(row.chord_total_count)||0,
          },
          scale:{
            correct:Number(row.scale_correct_count)||0,
            total:Number(row.scale_total_count)||0,
          },
        },
      };
    });
    writeJSON(USER_HISTORY_PREFIX+activeUserId,history);
    handlers.useUserHistory(activeUserId,history);
  }
  function validPreferenceRecord(record){
    return record && typeof record==='object' &&
      record.data && typeof record.data==='object' && !Array.isArray(record.data) &&
      typeof record.updatedAt==='string' && Number.isFinite(Date.parse(record.updatedAt));
  }
  function isPreferenceSetupMissing(error){
    return Boolean(error && (
      error.code==='42P01' ||
      error.code==='PGRST205' ||
      /user_preferences|schema cache/i.test(error.message||'')
    ));
  }
  async function uploadPreferences(record){
    if(!preferenceReady || !validPreferenceRecord(record) || !client || !currentUser) return;
    const {error}=await client.from('user_preferences').upsert({
      user_id:activeUserId,
      preferences:record.data,
      client_updated_at:record.updatedAt,
      updated_at:new Date().toISOString(),
    },{onConflict:'user_id'});
    if(error){
      if(isPreferenceSetupMissing(error)){ preferenceReady=false; return; }
      throw error;
    }
  }
  async function syncPreferences(){
    if(!handlers.getPreferences || !client || !currentUser) return;
    const local=handlers.getPreferences();
    const {data,error}=await client
      .from('user_preferences')
      .select('preferences,client_updated_at')
      .eq('user_id',activeUserId)
      .maybeSingle();
    if(error){
      if(isPreferenceSetupMissing(error)){ preferenceReady=false; return; }
      throw error;
    }
    preferenceReady=true;

    const remoteTime=data && typeof data.client_updated_at==='string'
      ? Date.parse(data.client_updated_at) : NaN;
    const localTime=validPreferenceRecord(local) ? Date.parse(local.updatedAt) : NaN;
    if(Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime>=localTime)){
      handlers.applyPreferences(data.preferences||{},data.client_updated_at);
    }else if(Number.isFinite(localTime)){
      await uploadPreferences(local);
    }
  }
  async function clearRecordingAudioCache(userId){
    const cache=window.OliveRecordingCache;
    if(!userId || !cache || typeof cache.clearUser!=='function') return;
    try{ await cache.clearUser(userId); }
    catch(error){ console.warn('[O\'live recording cache clear]',error); }
  }
  async function clearLocalAccountData(){
    const userId=activeUserId;
    if(userId){
      try{
        localStorage.removeItem(USER_HISTORY_PREFIX+userId);
        localStorage.removeItem(QUEUE_PREFIX+userId);
      }catch(e){}
    }
    if(handlers.clearPreferences) handlers.clearPreferences();
    await clearRecordingAudioCache(userId);
  }
  function notifySession(){
    sessionSubscribers.forEach(listener=>{
      try{ listener(currentUser); }catch(error){ console.warn('[O\'live cloud session]',error); }
    });
  }
  function subscribeSession(listener){
    if(typeof listener!=='function') return ()=>{};
    sessionSubscribers.add(listener);
    Promise.resolve().then(()=>listener(currentUser));
    return ()=>sessionSubscribers.delete(listener);
  }
  async function ensureRecordingAccess(){
    if(!client || !currentUser){
      const error=new Error('Authentication required'); error.code='AUTH-401'; throw error;
    }
    if(!navigator.onLine){
      const error=new Error('Network unavailable'); error.code='NET-001'; throw error;
    }
    if(!await checkSchemaContract(false)){
      const error=new Error('Recording schema is not ready'); error.code=schemaErrorCode(); throw error;
    }
  }
  async function listRecordings(){
    await ensureRecordingAccess();
    const {data,error}=await client.from('practice_recordings')
      .select('id,title,object_path,duration_ms,byte_size,mime_type,waveform,playback_gain,source_type,recorded_at,created_at')
      .eq('status','ready')
      .order('recorded_at',{ascending:false})
      .limit(50);
    if(error) throw error;
    const recordings=data||[];
    if(!recordings.length) return recordings;
    /* iPhone에서는 재생 버튼의 사용자 제스처 안에서 HTMLAudioElement.play()를
       바로 호출할 수 있도록 목록을 불러올 때 비공개 재생 주소도 준비한다.
       주소 발급이 실패해도 인증 다운로드 + Web Audio 경로는 계속 사용할 수 있다. */
    try{
      const {data:signedRows,error:signedError}=await client.storage.from('practice-recordings')
        .createSignedUrls(recordings.map(row=>row.object_path),60*60);
      if(signedError) return recordings;
      return recordings.map((row,index)=>{
        const signed=(signedRows||[]).find(item=>item&&item.path===row.object_path) || (signedRows||[])[index];
        return {...row,playback_url:signed&&!signed.error&&signed.signedUrl||''};
      });
    }catch(error){ return recordings; }
  }
  async function uploadRecording(recording){
    await ensureRecordingAccess();
    const id=String(recording&&recording.id||'');
    const extension=String(recording&&recording.extension||'').toLowerCase();
    const objectPath=`${activeUserId}/${id}.${extension}`;
    const mimeType=String(recording&&recording.mimeType||'').toLowerCase();
    const {error:reserveError}=await client.rpc('reserve_practice_recording',{
      p_recording_id:id,
      p_title:String(recording&&recording.title||''),
      p_object_path:objectPath,
      p_duration_ms:Math.round(Number(recording&&recording.durationMs)||0),
      p_byte_size:Number(recording&&recording.blob&&recording.blob.size)||0,
      p_mime_type:mimeType,
      p_waveform:Array.isArray(recording&&recording.waveform)?recording.waveform:[],
      p_recorded_at:String(recording&&recording.recordedAt||new Date().toISOString()),
      p_playback_gain:Number(recording&&recording.playbackGain)||1,
      p_source_type:String(recording&&recording.sourceType||'recording'),
    });
    if(reserveError) throw reserveError;
    let uploaded=false;
    try{
      const {error:uploadError}=await client.storage.from('practice-recordings').upload(
        objectPath,recording.blob,{contentType:mimeType,cacheControl:'3600',upsert:false}
      );
      if(uploadError) throw uploadError;
      uploaded=true;
      const {data,error:finalizeError}=await client.rpc('finalize_practice_recording',{
        p_recording_id:id,
      });
      if(finalizeError) throw finalizeError;
      if(!data) throw new Error('Recording finalize failed');
      return true;
    }catch(error){
      if(uploaded){
        try{ await client.storage.from('practice-recordings').remove([objectPath]); }catch(e){}
      }
      try{ await client.rpc('cancel_practice_recording',{p_recording_id:id}); }catch(e){}
      throw error;
    }
  }
  async function renameRecording(id,title){
    await ensureRecordingAccess();
    const {data,error}=await client.rpc('rename_practice_recording',{
      p_recording_id:id,p_title:title,
    });
    if(error) throw error;
    if(!data) throw new Error('Recording was not found');
    return true;
  }
  async function saveRecordingWaveform(id,waveform){
    await ensureRecordingAccess();
    const {data,error}=await client.rpc('save_practice_recording_waveform',{
      p_recording_id:id,
      p_waveform:Array.isArray(waveform)?waveform:[],
    });
    if(error) throw error;
    if(!data) throw new Error('Recording was not found');
    return true;
  }
  async function deleteRecording(recording){
    await ensureRecordingAccess();
    const path=String(recording&&recording.object_path||'');
    const id=String(recording&&recording.id||'');
    const {error:storageError}=await client.storage.from('practice-recordings').remove([path]);
    if(storageError) throw storageError;
    const {error}=await client.rpc('remove_practice_recording',{p_recording_id:id});
    if(error) throw error;
    return true;
  }
  async function downloadRecording(recording){
    await ensureRecordingAccess();
    const {data,error}=await client.storage.from('practice-recordings')
      .download(String(recording&&recording.object_path||''));
    if(error) throw error;
    return {blob:data};
  }
  async function deleteAllRecordingObjects(){
    if(!client || !currentUser || !client.storage) return;
    const {data,error}=await client.storage.from('practice-recordings')
      .list(activeUserId,{limit:100,offset:0});
    if(error){
      if(isSchemaMismatchError(error) || /bucket not found/i.test(String(error.message||''))) return;
      throw error;
    }
    const paths=(data||[]).filter(item=>item&&item.name).map(item=>`${activeUserId}/${item.name}`);
    if(!paths.length) return;
    const {error:removeError}=await client.storage.from('practice-recordings').remove(paths);
    if(removeError) throw removeError;
  }
  async function deleteCloudData(){
    if(!client || !currentUser || syncing) return;
    const accepted=window.confirm(
      '클라우드의 녹음, 청음 기록과 연습 설정을 모두 삭제할까요? 계정은 유지되며, 삭제한 데이터는 복구할 수 없습니다.'
    );
    if(!accepted) return;
    syncing=true;
    renderSheet();
    setMessage('클라우드 데이터를 삭제하는 중입니다');
    try{
      await deleteAllRecordingObjects();
      const {error}=await client.rpc('delete_my_cloud_data');
      if(error) throw error;
      await clearLocalAccountData();
      handlers.useUserHistory(activeUserId,{});
      setMessage('클라우드 데이터를 삭제했습니다');
      if(location.reload) location.reload();
    }catch(error){
      setMessage('데이터를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요',true);
      console.warn('[O\'live data deletion]',error);
    }finally{
      syncing=false;
      renderSheet();
    }
  }
  async function deleteAccount(){
    if(!client || !currentUser || syncing) return;
    const accepted=window.confirm(
      'O’live 계정을 완전히 삭제할까요? 녹음, 청음 기록과 연습 설정도 함께 삭제되며 복구할 수 없습니다.'
    );
    if(!accepted) return;
    syncing=true;
    renderSheet();
    setMessage('계정을 삭제하는 중입니다');
    try{
      const {error}=await client.functions.invoke('delete-account',{body:{confirm:true}});
      if(error) throw error;
      await clearLocalAccountData();
      try{ await client.auth.signOut({scope:'local'}); }catch(e){}
      if(location.reload) location.reload();
    }catch(error){
      setMessage('계정을 삭제하지 못했습니다. 관리자 설정을 확인해 주세요',true);
      console.warn('[O\'live account deletion]',error);
    }finally{
      syncing=false;
      renderSheet();
    }
  }
  async function syncAndRefresh(fromButton){
    if(!currentUser || syncing) return;
    if(!navigator.onLine){
      setState('offline');
      if(fromButton) setMessage('인터넷에 연결되면 자동으로 동기화됩니다');
      return;
    }
    try{
      setMessage('');
      const schemaReady=await checkSchemaContract(Boolean(fromButton));
      if(!schemaReady){
        showSchemaUpgrade(fromButton);
        return;
      }
      try{ await migrateAnonymousHistory(); }
      catch(error){
        console.warn('[O\'live migration]',error);
        setMessage('이 기기의 이전 기록은 다음 동기화 때 다시 옮깁니다',true);
      }
      await syncQueue();
      await fetchHistory();
      await syncPreferences();
      setState('synced',preferenceReady ? '' : '청음 기록 저장됨 · 설정 동기화 준비 필요');
      if(fromButton) setMessage('최신 기록으로 동기화했습니다');
    }catch(error){
      if(isSchemaMismatchError(error)){
        schemaContract={ready:false,version:0,checkedAt:Date.now()};
        showSchemaUpgrade(fromButton);
        console.warn('[O\'live schema]',error&&error.code||'',error&&error.message||error);
        return;
      }
      setState('error');
      setMessage(friendlySyncFailure(error),true);
      console.warn('[O\'live cloud]',error && error.code || '',error && error.message || error);
    }
  }
  async function applySession(session){
    const user=session && session.user;
    if(!user){
      currentUser=null;
      activeUserId='';
      handlers.useAnonymousHistory();
      setState(configured?'signedout':'unconfigured');
      setMessage('');
      renderSheet();
      notifySession();
      return;
    }
    currentUser=user;
    activeUserId=user.id;
    const cached=sanitizeHistory(readJSON(USER_HISTORY_PREFIX+user.id,{}));
    handlers.useUserHistory(user.id,cached);
    setState(navigator.onLine?'syncing':'offline');
    renderSheet();
    notifySession();
    await syncAndRefresh(false);
  }
  function recordAnswer(date,correct,mode){
    if(!currentUser || !activeUserId) return;
    const queue=readQueue();
    queue.push({
      id:makeId(),date,correct:Boolean(correct),
      mode:HISTORY_MODES.includes(mode)?mode:'unclassified',createdAt:Date.now(),
    });
    writeQueue(queue);
    if(navigator.onLine){
      if(!schemaContract.ready){
        syncAndRefresh(false);
      }else{
        syncQueue().then(ok=>{ if(ok) setState('synced'); }).catch(error=>{
          if(isSchemaMismatchError(error)){
            schemaContract={ready:false,version:0,checkedAt:Date.now()};
            showSchemaUpgrade(false);
          }else{
            setState('error',friendlySyncFailure(error));
          }
          console.warn('[O\'live answer sync]',error);
        });
      }
    }
    else setState('offline');
  }

  async function init(nextHandlers){
    handlers=nextHandlers;
    bindUI();
    renderSheet();
    if(!configured || !window.supabase){
      setState('unconfigured');
      return;
    }
    client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'},
    });
    client.auth.onAuthStateChange((event,session)=>{
      setTimeout(()=>applySession(session),0);
    });
    const {data,error}=await client.auth.getSession();
    if(error){
      setState('error');
      setMessage(error.message,true);
      return;
    }
    await applySession(data.session);
    window.addEventListener('online',()=>syncAndRefresh(false));
    window.addEventListener('offline',()=>{ if(currentUser) setState('offline'); });
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible' && currentUser) syncAndRefresh(false);
    });
    window.addEventListener('olive-preferences-change',()=>{
      clearTimeout(preferenceTimer);
      preferenceTimer=setTimeout(()=>{
        if(!currentUser || !navigator.onLine || syncing) return;
        uploadPreferences(handlers.getPreferences()).then(()=>{
          setState('synced',preferenceReady ? '' : '청음 기록 저장됨 · 설정 동기화 준비 필요');
        }).catch(error=>{
          setState('error');
          console.warn('[O\'live preference sync]',error && error.code || '',error && error.message || error);
        });
      },700);
    });
    if(location.search && /[?&](code|error|error_description)=/.test(location.search)){
      const url=new URL(location.href);
      ['code','error','error_code','error_description'].forEach(k=>url.searchParams.delete(k));
      history.replaceState({},'',url.pathname+(url.search?'?'+url.searchParams.toString():'')+url.hash);
    }
  }

  /* ===================== 연습 링크 =====================
     YouTube API 개발자 정책상 영상 제목·채널명·설명은 30일 안에 갱신하거나
     삭제해야 한다. 그래서 클라우드에는 video_id와 사용자가 정한 별칭, 연습
     설정만 남긴다. 검색 결과의 제목·채널·썸네일은 화면에 보여줄 때만 쓰고
     저장하지 않는다. */
  async function listPracticeLinks(){
    await ensureRecordingAccess();
    const {data,error}=await client.from('practice_links')
      .select('id,provider,video_id,title,duration_ms,last_position_ms,loop_a_ms,loop_b_ms,loop_enabled,playback_rate,created_at')
      .order('created_at',{ascending:false})
      .limit(50);
    if(error) throw error;
    return data||[];
  }
  async function savePracticeLink(videoId,title,durationMs){
    await ensureRecordingAccess();
    const id=makeId();
    const {data,error}=await client.rpc('save_practice_link',{
      p_link_id:id,
      p_video_id:String(videoId||''),
      p_title:String(title||''),
      p_duration_ms:Math.max(0,Math.round(Number(durationMs)||0)),
    });
    if(error) throw error;
    if(!data) throw new Error('Practice link was not saved');
    return id;
  }
  async function renamePracticeLink(id,title){
    await ensureRecordingAccess();
    const {data,error}=await client.rpc('rename_practice_link',{
      p_link_id:String(id||''),p_title:String(title||''),
    });
    if(error) throw error;
    if(!data) throw new Error('Practice link was not found');
    return true;
  }
  /* 마지막 위치·A/B·배속은 연습 중 자주 바뀌므로 한 번에 저장한다. */
  async function savePracticeLinkState(id,state){
    await ensureRecordingAccess();
    /* Number(null)이 0이므로 빈 값을 먼저 걸러야 지정되지 않은 A/B가 0으로 저장되지 않는다. */
    const loopMs=value=>{
      if(value===null || value===undefined || value==='') return null;
      const number=Number(value);
      return Number.isFinite(number)?Math.round(number):null;
    };
    const loopA=loopMs(state&&state.loopA);
    const loopB=loopMs(state&&state.loopB);
    const {data,error}=await client.rpc('save_practice_link_state',{
      p_link_id:String(id||''),
      p_last_position_ms:Math.max(0,Math.round(Number(state&&state.position)||0)),
      p_loop_a_ms:loopA,
      p_loop_b_ms:loopB,
      p_loop_enabled:Boolean(state&&state.loopEnabled),
      p_playback_rate:Number(state&&state.rate)||1,
      p_duration_ms:Math.max(0,Math.round(Number(state&&state.duration)||0)),
    });
    if(error) throw error;
    if(!data) throw new Error('Practice link was not found');
    return true;
  }
  async function deletePracticeLink(id){
    await ensureRecordingAccess();
    const {data,error}=await client.rpc('delete_practice_link',{p_link_id:String(id||'')});
    if(error) throw error;
    if(!data) throw new Error('Practice link was not found');
    return true;
  }
  /* 검색은 Edge Function을 거친다. 브라우저가 Google API를 직접 부르지 않으므로
     API 키가 노출되지 않고 CSP의 connect-src도 Supabase로 유지된다. */
  async function searchYouTube(query){
    await ensureRecordingAccess();
    const {data,error}=await client.functions.invoke('youtube-search',{
      body:{query:String(query||'')},
    });
    if(error){
      /* Edge Function이 돌려준 오류 코드를 그대로 살려서 화면 문구를 나눈다. */
      let code='';
      try{
        const body=error.context&&typeof error.context.json==='function'
          ? await error.context.json() : null;
        code=String(body&&body.error||'');
      }catch(e){}
      const failure=new Error(code||'search_failed');
      failure.code=code||'search_failed';
      throw failure;
    }
    return {
      results:Array.isArray(data&&data.results)?data.results:[],
      remaining:Number.isFinite(Number(data&&data.remaining))?Number(data.remaining):null,
    };
  }
  window.OliveCloud={
    init,
    recordAnswer,
    openAccount:openSheet,
    isConfigured:()=>configured,
    getUser:()=>currentUser,
    subscribeSession,
    listRecordings,
    uploadRecording,
    saveRecordingWaveform,
    renameRecording,
    deleteRecording,
    downloadRecording,
    listPracticeLinks,
    savePracticeLink,
    renamePracticeLink,
    savePracticeLinkState,
    deletePracticeLink,
    searchYouTube,
  };
})();

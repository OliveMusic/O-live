(function(){
  'use strict';

  const ANON_HISTORY_KEY='olive-ear-history-v1';
  const USER_HISTORY_PREFIX='olive-ear-history-user-v1:';
  const QUEUE_PREFIX='olive-ear-sync-queue-v1:';
  const INSTALL_ID_KEY='olive-install-id-v1';

  const config=window.OLIVE_CLOUD_CONFIG||{};
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
      if(total) clean[date]={correct,total};
    });
    return clean;
  }
  function historyRows(history){
    return Object.entries(sanitizeHistory(history)).map(([score_date,rec])=>({
      score_date,
      correct_count:rec.correct,
      total_count:rec.total,
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
  function renderAccountAction(){
    if(!ui.action) return;
    const signedIn=Boolean(currentUser);
    ui.action.classList.toggle('has-account',signedIn);
    ui.actionLabel.hidden=signedIn;
    ui.action.setAttribute('aria-label',signedIn ? providerLabel(currentUser)+' 계정 열기' : '계정 연결');
    if(!signedIn){
      ui.avatar.hidden=true;
      ui.avatarFallback.hidden=true;
      ui.avatar.removeAttribute('src');
      return;
    }
    const url=avatarUrl(currentUser);
    ui.avatarFallback.textContent=accountInitial(currentUser);
    ui.avatarFallback.hidden=Boolean(url);
    ui.avatar.hidden=!url;
    if(url) ui.avatar.src=url;
    else ui.avatar.removeAttribute('src');
  }
  function redirectUrl(){
    return config.redirectUrl || location.origin+location.pathname;
  }

  function setState(state,detail){
    if(!ui.title) return;
    const copy={
      unconfigured:['클라우드 저장 설정 필요','현재 이 기기에만 기록 중'],
      signedout:['계정에 기록 보관','Google 계정으로 연결'],
      syncing:['데이터 동기화 중','잠시만 기다려 주세요'],
      synced:['클라우드에 저장됨',detail||'다른 기기에서도 이어서 연습할 수 있어요'],
      offline:['오프라인 기록 중',detail||'연결되면 자동으로 동기화됩니다'],
      error:['동기화 확인 필요',detail||'계정 화면에서 다시 시도해 주세요'],
    }[state]||['클라우드 저장',''];
    ui.title.textContent=copy[0];
    ui.status.textContent=copy[1];
    ui.dot.dataset.state=state;
    renderAccountAction();
    if(ui.sheetSync) ui.sheetSync.textContent=copy[1];
  }
  function setMessage(message,isError){
    if(!ui.message) return;
    ui.message.textContent=message||'';
    ui.message.classList.toggle('error',Boolean(isError));
  }
  function openSheet(){
    if(!ui.sheet) return;
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
    setTimeout(()=>{ if(!ui.sheet.classList.contains('open')) ui.sheet.hidden=true; },220);
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
      title:document.getElementById('earCloudTitle'),
      status:document.getElementById('earCloudStatus'),
      dot:document.getElementById('earCloudDot'),
      action:document.getElementById('earCloudAction'),
      actionLabel:document.getElementById('earCloudActionLabel'),
      avatar:document.getElementById('earCloudAvatar'),
      avatarFallback:document.getElementById('earCloudAvatarFallback'),
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
    if(!ui.action || !ui.sheet) return;
    ui.action.addEventListener('click',openSheet);
    ui.close.addEventListener('click',closeSheet);
    ui.sheet.addEventListener('click',e=>{ if(e.target===ui.sheet) closeSheet(); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !ui.sheet.hidden) closeSheet(); });
    ui.avatar.addEventListener('error',()=>{
      ui.avatar.hidden=true;
      ui.avatarFallback.hidden=!currentUser;
    });
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
    syncing=true;
    renderSheet();
    setMessage('연결을 해제하는 중입니다');
    const {error}=await client.auth.signOut();
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
      .select('score_date,correct_count,total_count')
      .order('score_date',{ascending:true});
    if(error) throw error;
    const history={};
    (data||[]).forEach(row=>{
      history[row.score_date]={
        correct:Number(row.correct_count)||0,
        total:Number(row.total_count)||0,
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
  function clearLocalAccountData(){
    if(activeUserId){
      try{
        localStorage.removeItem(USER_HISTORY_PREFIX+activeUserId);
        localStorage.removeItem(QUEUE_PREFIX+activeUserId);
      }catch(e){}
    }
    if(handlers.clearPreferences) handlers.clearPreferences();
  }
  async function deleteCloudData(){
    if(!client || !currentUser || syncing) return;
    const accepted=window.confirm(
      '클라우드의 청음 기록과 연습 설정을 모두 삭제할까요? 계정은 유지되며, 삭제한 데이터는 복구할 수 없습니다.'
    );
    if(!accepted) return;
    syncing=true;
    renderSheet();
    setMessage('클라우드 데이터를 삭제하는 중입니다');
    try{
      const {error}=await client.rpc('delete_my_cloud_data');
      if(error) throw error;
      clearLocalAccountData();
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
      'O’live 계정을 완전히 삭제할까요? 청음 기록과 연습 설정도 함께 삭제되며 복구할 수 없습니다.'
    );
    if(!accepted) return;
    syncing=true;
    renderSheet();
    setMessage('계정을 삭제하는 중입니다');
    try{
      const {error}=await client.functions.invoke('delete-account',{body:{confirm:true}});
      if(error) throw error;
      clearLocalAccountData();
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
      await syncQueue();
      await fetchHistory();
      await syncPreferences();
      setState('synced',preferenceReady ? '' : '청음 기록 저장됨 · 설정 동기화 준비 필요');
      if(fromButton) setMessage('최신 기록으로 동기화했습니다');
    }catch(error){
      setState('error');
      setMessage('동기화하지 못했습니다. 잠시 후 다시 시도해 주세요',true);
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
      return;
    }
    currentUser=user;
    const isNewUser=activeUserId!==user.id;
    activeUserId=user.id;
    const cached=sanitizeHistory(readJSON(USER_HISTORY_PREFIX+user.id,{}));
    handlers.useUserHistory(user.id,cached);
    setState(navigator.onLine?'syncing':'offline');
    renderSheet();
    if(isNewUser && navigator.onLine){
      try{ await migrateAnonymousHistory(); }
      catch(error){
        console.warn('[O\'live migration]',error);
        setMessage('이 기기의 이전 기록은 다음 동기화 때 다시 옮깁니다',true);
      }
    }
    await syncAndRefresh(false);
  }
  function recordAnswer(date,correct){
    if(!currentUser || !activeUserId) return;
    const queue=readQueue();
    queue.push({id:makeId(),date,correct:Boolean(correct),createdAt:Date.now()});
    writeQueue(queue);
    if(navigator.onLine) syncQueue().then(ok=>{ if(ok) setState('synced'); }).catch(error=>{
      setState('error');
      console.warn('[O\'live answer sync]',error);
    });
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

  window.OliveCloud={
    init,
    recordAnswer,
    openAccount:openSheet,
    isConfigured:()=>configured,
  };
})();

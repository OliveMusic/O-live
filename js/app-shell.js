/* ===== 트레이너: 청음 / 리듬 전환 ===== */
(function(){
  const seg=document.getElementById('trainerSeg');
  if(!seg) return;
  seg.querySelectorAll('.seg-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      const m=b.dataset.mode;
      seg.querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.trainer-pane').forEach(p=>
        p.classList.toggle('active', p.id==='pane-'+m));
      // 리듬 그리드는 보이게 된 뒤에야 폭을 잴 수 있다
      if(m==='rhythm') setTimeout(()=>window.dispatchEvent(new Event('resize')),0);
    });
  });
})();

/* ===== 스크롤 시 탭바 축소 (iOS 26 리퀴드 글라스 거동) ===== */
(function(){
  const mainEl = document.querySelector('main');
  const tabbar = document.querySelector('nav.tabbar');
  let lastY = 0, ticking = false;
  mainEl.addEventListener('scroll', ()=>{
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{
      const y = mainEl.scrollTop;
      // 아래로 스크롤하면 축소, 위로 올리거나 최상단이면 복원
      if(y > lastY + 4 && y > 40) tabbar.classList.add('shrunk');
      else if(y < lastY - 4 || y <= 40) tabbar.classList.remove('shrunk');
      lastY = y;
      ticking = false;
    });
  }, {passive:true});
})();

/* ===================== 시작 화면 =====================
   첫 페인트부터 최소 1.5초를 채우고, 로딩이 더 길면 준비가 끝날 때까지 기다린다.
   0.28초 페이드까지 합치면 일반적인 실행에서는 약 1.8초 보인다. */
(function(){
  const splash=document.getElementById('startupSplash');
  const startup=window.__OLIVE_STARTUP__||{};
  if(!splash || startup.skip){
    if(splash) splash.hidden=true;
    document.documentElement.classList.remove('startup-active');
    return;
  }

  const minimumVisibleMs=1500;
  let leaving=false;
  function rememberCompletion(){
    try{
      sessionStorage.setItem(startup.stateKey,'shown');
      sessionStorage.removeItem(startup.timeKey);
    }catch(e){}
  }
  function leave(){
    if(leaving) return;
    leaving=true;
    splash.classList.add('is-leaving');
    setTimeout(()=>{
      splash.hidden=true;
      document.documentElement.classList.remove('startup-active');
      rememberCompletion();
    },300);
  }
  function leaveWhenReady(){
    const elapsed=Date.now()-(startup.startedAt||Date.now());
    setTimeout(leave,Math.max(0,minimumVisibleMs-elapsed));
  }

  if(document.readyState==='complete') leaveWhenReady();
  else window.addEventListener('load',leaveWhenReady,{once:true});
})();

/* ===================== 서비스워커 등록 ===================== */
const release=window.OLIVE_RELEASE||{version:'0.0.0',build:'dev'};
const appVersion=document.getElementById('appVersion');
if(appVersion){
  const versionText='버전 '+release.version;
  const versionLabel='현재 앱 버전 '+release.version+', 길게 눌러 오디오 진단 기록 복사';
  let holdStartedAt=0, holdX=0, holdY=0, holdMoved=false, restoreTimer=0;
  appVersion.textContent=versionText;
  appVersion.setAttribute('aria-label',versionLabel);
  appVersion.title='길게 눌러 오디오 진단 기록 복사';
  if(window.OliveAudioDiagnostics){
    window.OliveAudioDiagnostics.mark('app:ready');
  }
  function restoreVersionText(){
    clearTimeout(restoreTimer);
    appVersion.textContent=versionText;
    appVersion.setAttribute('aria-label',versionLabel);
  }
  function fallbackCopy(text){
    try{
      const field=document.createElement('textarea');
      field.value=text;
      field.setAttribute('readonly','');
      field.style.position='fixed';
      field.style.opacity='0';
      document.body.appendChild(field);
      field.select();
      field.setSelectionRange(0,field.value.length);
      const copied=document.execCommand('copy');
      field.remove();
      return copied;
    }catch(e){ return false; }
  }
  async function copyAudioDiagnostics(){
    if(!window.OliveAudioDiagnostics) return;
    const text=window.OliveAudioDiagnostics.exportText();
    let copied=false;
    try{
      if(navigator.clipboard && typeof navigator.clipboard.writeText==='function'){
        await navigator.clipboard.writeText(text);
        copied=true;
      }
    }catch(e){}
    if(!copied) copied=fallbackCopy(text);
    if(!copied){
      window.prompt('아래 진단 기록을 복사해 주세요.',text);
      return;
    }
    appVersion.textContent='진단 기록 복사됨';
    appVersion.setAttribute('aria-label','오디오 진단 기록 복사됨');
    restoreTimer=setTimeout(restoreVersionText,1800);
  }
  appVersion.addEventListener('pointerdown',event=>{
    holdStartedAt=Date.now();
    holdX=event.clientX; holdY=event.clientY; holdMoved=false;
    appVersion.classList.add('is-holding');
  });
  appVersion.addEventListener('pointermove',event=>{
    if(!holdStartedAt) return;
    if(Math.hypot(event.clientX-holdX,event.clientY-holdY)>12){
      holdMoved=true;
      appVersion.classList.remove('is-holding');
    }
  });
  appVersion.addEventListener('pointerup',()=>{
    const heldFor=Date.now()-holdStartedAt;
    appVersion.classList.remove('is-holding');
    holdStartedAt=0;
    if(!holdMoved && heldFor>=700) copyAudioDiagnostics();
  });
  for(const eventName of ['pointercancel','lostpointercapture']){
    appVersion.addEventListener(eventName,()=>{
      holdStartedAt=0; holdMoved=false;
      appVersion.classList.remove('is-holding');
    });
  }
  appVersion.addEventListener('contextmenu',event=>event.preventDefault());
  appVersion.addEventListener('keydown',event=>{
    if(event.key!=='Enter' && event.key!==' ') return;
    event.preventDefault();
    copyAudioDiagnostics();
  });
}
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js?v='+release.build).then(reg=>{
      // 새 버전이 올라왔는지 확인하고, 준비되면 한 번만 자동 새로고침한다
      reg.update().catch(()=>{});
      reg.addEventListener('updatefound', ()=>{
        const sw=reg.installing;
        if(!sw) return;
        sw.addEventListener('statechange', ()=>{
          if(sw.state==='installed' && navigator.serviceWorker.controller){
            sw.postMessage('skipWaiting');
          }
        });
      });
    }).catch(()=>{});
    // 최초 설치 때도 claim()이 controllerchange를 일으킨다.
    // 그때 새로고침하면 첫 방문에 화면이 한 번 깜빡인다.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded=false;
    navigator.serviceWorker.addEventListener('controllerchange', ()=>{
      if(!hadController || reloaded) return;   // 첫 설치 / 무한 새로고침 방지
      reloaded=true;
      location.reload();
    });
  });
}

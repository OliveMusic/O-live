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
  appVersion.textContent='버전 '+release.version;
  if(window.OliveAudioDiagnostics) window.OliveAudioDiagnostics.mark('app:ready');
}
/* 도움말이 띄우는 미리보기 프레임은 서비스 워커를 건드리지 않는다.
   갱신이 잡히면 스스로 새로고침하는데, 그러면 도움말이 붙잡고 있던 문서가 끊겨
   투어가 빈 화면에서 헛돈다. 워커는 부모 창이 이미 관리한다. */
const oliveIsPreview=/[?&]guide=1(?:&|$)/.test(location.search);
if(!oliveIsPreview && 'serviceWorker' in navigator){
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

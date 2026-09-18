/* ===== 트레이너: 트랙 / 청음 / 리듬 전환 ===== */
(function(){
  const seg=document.getElementById('trainerSeg');
  if(!seg) return;
  let touched=false;
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
  /* 세그먼트 차례는 트랙이 맨 앞이지만, 트랙은 계정이 있어야 쓸 수 있다.
     로그인 전에 트레이너를 열면 '계정 연결' 화면부터 마주치므로 그때만 청음으로
     연다 — 계정 없이 바로 연습할 수 있는 자리다.

     세션을 '읽어 본 뒤'에 판단해야 한다. subscribeSession은 붙자마자 한 번
     알려 주는데 그때는 아직 읽기 전이라 로그인한 사람에게도 null이다. 그 값으로
     옮겼다가 되돌리면 화면이 한 번 튄다. 그리고 사람이 세그먼트를 이미 만졌으면
     손대지 않는다 — 기다리는 사이에 직접 고른 것을 빼앗는 꼴이 된다. */
  const ready=window.OliveCloud && window.OliveCloud.whenSessionReady;
  if(!ready) return;
  window.OliveCloud.whenSessionReady().then(user=>{
    if(user || touched) return;
    const ear=seg.querySelector('.seg-btn[data-mode="ear"]');
    if(ear && !ear.classList.contains('active')) ear.click();
  }).catch(()=>{});
  seg.addEventListener('click',event=>{
    if(event.target.closest('.seg-btn')) touched=true;
  },true);
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

/* ===================== 임시: 오디오 기록 보기 =====================
   잠금화면에서 오래 쉰 뒤 재생이 안 되는 것을 쫓는 동안만 둔다. 기록은
   audio-runtime이 메모리에만 남기는 것이고, 소리·계정·개인정보는 담기지 않는다.
   원인을 잡으면 이 블록과 index.html의 창을 함께 지운다.

   보이는 단추를 두지 않는다 — 버전 줄을 1.5초 꾹 눌러야 열린다. 평소 쓰는 사람에게는
   없는 것과 같고, 그 자리를 눌러 무엇이 되는 일도 없다. */
const PAGE_OPENED_AT=Date.now();
function bindAudioDiagnostics(trigger){
  const sheet=document.getElementById('audioDiagSheet');
  const head=document.getElementById('audioDiagHead');
  const log=document.getElementById('audioDiagLog');
  const copy=document.getElementById('audioDiagCopy');
  const close=document.getElementById('audioDiagClose');
  if(!trigger || !sheet || !head || !log || !copy || !close) return;

  function text(){
    const release=window.OLIVE_RELEASE||{};
    const alive=Math.round((Date.now()-PAGE_OPENED_AT)/1000);
    const entries=(window.OliveAudioDiagnostics
      ? window.OliveAudioDiagnostics.read() : []) || [];
    const lines=entries.map(entry=>{
      const at=String(entry.at||'').slice(11,23);
      const bits=[entry.event];
      if(entry.context) bits.push('ctx='+entry.context);
      if(entry.contextMode) bits.push('mode='+entry.contextMode);
      if(entry.media) bits.push('media='+entry.media);
      if(entry.mediaPaused) bits.push('mediaPaused');
      if(entry.mediaArmed) bits.push('armed');
      if(entry.stream) bits.push('stream');
      if(entry.transport && entry.transport!=='none') bits.push(entry.transport);
      if(entry.tempo!=null) bits.push(entry.tempo+'bpm');
      if(entry.track) bits.push('track='+entry.track);
      if(entry.out) bits.push('out='+entry.out);
      if(entry.same===false) bits.push('ctx다름');
      if(entry.visibility) bits.push(entry.visibility);
      if(entry.error) bits.push('ERR '+entry.error);
      return at+'  '+bits.join(' · ');
    });
    return 'O\'live '+(release.version||'?')+' b'+(release.build||'?')
      +' · 이 화면이 열린 지 '+alive+'초 · 기록 '+entries.length+'개\n'
      +'(이 화면이 열린 지가 짧으면 잠금 중에 페이지가 새로 뜬 것이다)\n\n'
      +(lines.length?lines.join('\n'):'기록 없음');
  }
  function render(){
    const body=text();
    head.textContent=body.split('\n').slice(0,2).join(' ');
    log.textContent=body.split('\n').slice(2).join('\n').trim();
  }
  function open(){
    render();
    sheet.hidden=false;
    requestAnimationFrame(()=>sheet.classList.add('open'));
    document.body.classList.add('cloud-sheet-open');
  }
  function shut(){
    sheet.classList.remove('open');
    document.body.classList.remove('cloud-sheet-open');
    setTimeout(()=>{ sheet.hidden=true; },200);
  }
  let timer=0;
  const cancel=()=>{ if(timer){ clearTimeout(timer); timer=0; } };
  trigger.addEventListener('pointerdown',event=>{
    if(event.isPrimary===false) return;
    cancel();
    timer=setTimeout(()=>{ timer=0; open(); },1500);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(type=>{
    trigger.addEventListener(type,cancel);
  });
  trigger.addEventListener('contextmenu',event=>event.preventDefault());
  close.addEventListener('click',shut);
  sheet.addEventListener('click',event=>{ if(event.target===sheet) shut(); });
  copy.addEventListener('click',async()=>{
    const body=text();
    try{
      await navigator.clipboard.writeText(body);
      copy.textContent='복사했습니다';
    }catch(error){
      copy.textContent='복사 실패 — 위 글을 길게 눌러 직접 선택해 주세요';
    }
    setTimeout(()=>{ copy.textContent='기록 복사하기'; },2200);
  });
}

/* ===================== 서비스워커 등록 ===================== */
const release=window.OLIVE_RELEASE||{version:'0.0.0',build:'dev'};
const appVersion=document.getElementById('appVersion');
if(appVersion){
  /* 버전만 적는다. 빌드는 캐시를 가르는 내부 번호이고, 배포할 때마다 버전도 함께
     올리므로 화면에 둘을 같이 적으면 같은 말을 두 번 하는 셈이다. */
  appVersion.textContent='버전 '+release.version;
  bindAudioDiagnostics(appVersion);
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
      /* 새 버전이 올라왔다고 그 자리에서 새로고침하면 연습 중이던 소리가 뚝 끊긴다.
         YouTube를 틀어 놓고 있으면 재생이 통째로 사라진다. 울리는 것도 녹음도 없을
         때까지 기다렸다 바꾼다. 끝내 조용해지지 않으면 다음에 열 때 바뀐다. */
      const quiet=()=>{
        try{
          if(typeof anySounding==='function' && anySounding()) return false;
          if(window.OliveRecorder && window.OliveRecorder.isRecording()) return false;
        }catch(e){}
        return true;
      };
      if(quiet()){ location.reload(); return; }
      const waiting=setInterval(()=>{
        if(!quiet()) return;
        clearInterval(waiting);
        location.reload();
      },1000);
    });
  });
}

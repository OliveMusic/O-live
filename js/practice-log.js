/* ===================== 연습 기록 =====================
   무엇을 얼마나 연습했는지 날짜별로 모아 상단바의 달력에서 보여 준다.

   시간은 '화면을 켜 둔 시간'이 아니라 '실제로 소리가 난 시간'이다.
   audio-runtime의 소리 등록부가 켜지고 꺼질 때를 그대로 받아 센다. 앱을 열어
   두고 딴짓한 20분이 연습으로 기록되면 숫자를 믿을 수 없게 되고, 믿을 수 없는
   기록은 없느니만 못하다.

   튜너는 세지 않는다. 줄 맞추는 시간은 연습이라기보다 준비고, 마이크가 계속
   열려 있어 시간이 부풀기 쉽다.

   청음은 분이 아니라 문제 수로 센다. 짧은 소리라 소리 등록부에 올라오지 않고,
   정답률은 이미 청음 기록에 날짜별로 쌓여 있다. 그 값을 읽어 함께 보여 준다.

   달력 칸의 세로 막대는 키가 그날 총 시간, 마디가 무엇을 했는지다. 활동 링처럼
   색으로 나누지 않는 이유는 이 앱에 색이 하나뿐이기 때문이다 — 세이지는
   '작동 중'일 때만 쓴다는 규칙이 화면 전체를 지탱한다. 그래서 색 대신 높이와
   농도로 나눈다. */
(function(){
  'use strict';

  const logButton=document.getElementById('practiceLogBtn');
  const sheet=document.getElementById('practiceLogSheet');
  if(!logButton || !sheet) return;

  const signInButton=document.getElementById('topbarSignIn');
  const sheetClose=document.getElementById('practiceLogClose');
  const monthEl=document.getElementById('practiceLogMonth');
  const prevEl=document.getElementById('practiceLogPrev');
  const nextEl=document.getElementById('practiceLogNext');
  const gridEl=document.getElementById('practiceLogGrid');
  const legendEl=document.getElementById('practiceLogLegend');
  const totalEl=document.getElementById('practiceLogTotal');
  const fullEl=document.getElementById('practiceLogFull');
  const app=document.getElementById('app');

  const STORE_KEY='olive-practice-log-v1';
  /* 가장 진한 칸이 되는 기준. 세 시간 친 날 하나 때문에 나머지 날이 전부
     옅어지면 달력이 쓸모없어지므로, 넘어가도 더 진해지지 않는다. */
  const FULL_BAR_SECONDS=90*60;
  /* 농도는 이어지지 않고 다섯 단계로 끊는다. 이어진 농도는 서로 견줄 수가 없다 —
     두 칸을 나란히 놓고도 어느 쪽이 더 진한지 눈으로 가리기 어렵다. */
  const LEVELS=[.12,.3,.55,.85];
  const TICK_MS=10000;
  /* 너무 짧은 소리는 연습이 아니다. 코드 하나 눌러 본 것까지 쌓이면
     "1분 연습함" 같은 기록이 달력을 채운다. */
  const MIN_SESSION_SECONDS=3;
  const KEEP_DAYS=800;

  /* 소리 등록부의 (탭:출처)를 도구로 옮긴다. 트레이너 탭 하나에 청음·리듬·
     트랙·녹음이 모두 들어 있어서, 탭만으로는 무엇을 했는지 알 수 없다. */
  const TOOLS={
    'metronome:metronome':'met',
    'jam:play':'jam',
    'trainer:rhythm':'rhy',
    'trainer:youtube':'trk',
    'trainer:recording-playback':'trk',
    'trainer:recording-preview':'trk',
    'trainer:recorder':'rec',
  };
  const TOOL_ORDER=['met','jam','trk','rec','rhy'];
  const TOOL_NAMES={met:'메트로놈',jam:'잼',trk:'트랙',rec:'녹음',rhy:'리듬'};

  /* ---------- 날짜 ---------- */
  function dateKey(date){
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,'0');
    const d=String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  function todayKey(){ return dateKey(new Date()); }

  function formatSpan(seconds){
    const total=Math.round(Number(seconds)||0);
    if(total<60) return '1분 미만';
    const minutes=Math.round(total/60);
    if(minutes<60) return `${minutes}분`;
    const hours=Math.floor(minutes/60);
    const rest=minutes%60;
    return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
  }

  /* ---------- 저장 ---------- */
  let store=load();

  function load(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
      return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : {};
    }catch(error){ return {}; }
  }
  let saveTimer=0;
  /* 손에 든 것을 통째로 덮어쓰지 않는다. 앱을 두 군데 열어 두면 먼저 열어 둔
     쪽이 닫힐 때 그 사이 쌓인 기록을 자기가 읽었던 옛 상태로 지워 버린다.
     값은 늘기만 하므로 저장 직전에 다시 읽어 큰 쪽을 남긴다. */
  function merge(stored){
    if(!stored || typeof stored!=='object') return store;
    Object.keys(stored).forEach(key=>{
      const theirs=stored[key];
      if(!theirs || typeof theirs!=='object') return;
      const ours=store[key];
      if(!ours){ store[key]=theirs; return; }
      Object.keys(theirs).forEach(field=>{
        const a=Number(ours[field]), bv=Number(theirs[field]);
        if(Number.isFinite(bv) && (!Number.isFinite(a) || bv>a)) ours[field]=bv;
      });
    });
    /* 오래된 날은 합친 뒤에 걷는다. 먼저 걷으면 저장소에 남은 날이 합칠 때 도로 들어온다. */
    prune();
    return store;
  }
  /* 도움말은 진짜 앱을 띄워 눌러 보게 한다. 거기서 켠 메트로놈이 실제 연습
     기록에 쌓이면 안 된다. 도움말은 읽기만 한다. */
  const preview=/[?&]guide=1(?:&|$)/.test(location.search);
  function write(){
    if(preview) return;
    try{
      localStorage.setItem(STORE_KEY,JSON.stringify(merge(load())));
    }catch(error){}
  }
  function save(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{ saveTimer=0; write(); },400);
  }
  function saveNow(){
    clearTimeout(saveTimer); saveTimer=0;
    write();
  }
  function prune(){
    const keys=Object.keys(store).sort();
    if(keys.length<=KEEP_DAYS) return;
    keys.slice(0,keys.length-KEEP_DAYS).forEach(key=>{ delete store[key]; });
  }
  function dayFor(key){
    let day=store[key];
    if(!day || typeof day!=='object'){
      day=store[key]={};
      prune();
    }
    return day;
  }
  function totalSeconds(day){
    if(!day) return 0;
    const all=Number(day.all);
    if(Number.isFinite(all)) return all;
    return TOOL_ORDER.reduce((sum,tool)=>sum+(Number(day[tool])||0),0);
  }

  /* ---------- 시간 재기 ----------
     소리마다 시작한 때(startedAt)와 어디까지 적었는지(creditedTo)를 든다.
     · 3초는 소리 하나를 통째로 보고 가린다. 예전에는 마지막 틱 뒤의 꼬리만 보고
       가려서, 틱을 건넌 짧은 소리가 반쯤 적히고 긴 소리의 꼬리가 잘렸다.
     · 자정을 넘긴 소리는 날짜마다 나눠 적는다. 잠금화면에서 타이머가 멈춘 사이
       울린 시간이 통째로 다음 날로 넘어갔다.
     · 잠금화면에서 멈춘 메트로놈·잼은 세지 않는다. 멈춰도 소리 등록부에서는
       빠지지 않으므로(그래야 재개가 된다) 여기서 따로 거른다. */
  const openSources=new Map();      // '탭:출처' → {startedAt, creditedTo, pausedAt}
  const PAUSABLE=new Set(['metronome:metronome','jam:play']);
  let backgroundPaused=false;
  /* 하루 합계는 도구별 시간을 더한 값이 아니라 '무엇이든 울린 시간'이다.
     메트로놈을 켜고 10분 녹음하면 도구별로는 각각 10분이지만 연습은 10분이다. */
  let union=null;
  let ticker=0;

  function counting(id){ return !(backgroundPaused && PAUSABLE.has(id)); }
  function anyCounting(){
    for(const id of openSources.keys()) if(counting(id)) return true;
    return false;
  }
  function legacyTotal(day){
    return TOOL_ORDER.reduce((sum,tool)=>sum+(Number(day[tool])||0),0);
  }
  function addSpan(field,from,to){
    let at=from;
    while(at<to){
      const date=new Date(at);
      const midnight=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime();
      const until=Math.min(to,midnight);
      const day=dayFor(dateKey(date));
      /* 합계를 따로 적기 전의 날은 도구별 합이 곧 합계였다. 새로 적기 전에 그 값을
         합계로 옮겨 두고 거기서 이어 간다. */
      if(!Number.isFinite(Number(day.all))) day.all=legacyTotal(day);
      day[field]=(Number(day[field])||0)+(until-at)/1000;
      at=until;
    }
  }
  function credit(entry,field,now){
    if(!entry || entry.pausedAt) return false;
    if(now-entry.startedAt<MIN_SESSION_SECONDS*1000) return false;
    if(now-entry.creditedTo<1) return false;
    addSpan(field,entry.creditedTo,now);
    entry.creditedTo=now;
    return true;
  }
  function syncUnion(now){
    const active=anyCounting();
    if(active && !union) union={startedAt:now,creditedTo:now,pausedAt:0};
    else if(!active && union){ credit(union,'all',now); union=null; }
  }

  function accumulate(now){
    let touched=false;
    openSources.forEach((entry,id)=>{
      if(counting(id) && credit(entry,TOOLS[id],now)) touched=true;
    });
    if(union && credit(union,'all',now)) touched=true;
    if(touched) save();
    return touched;
  }
  function startTicker(){
    if(ticker) return;
    ticker=setInterval(()=>accumulate(Date.now()),TICK_MS);
  }
  function stopTicker(){
    if(!ticker) return;
    clearInterval(ticker); ticker=0;
  }

  function handleSounding(tab,key,on){
    const id=`${tab}:${key}`;
    if(!TOOLS[id]) return;
    const now=Date.now();
    if(on){
      if(!openSources.has(id)){
        openSources.set(id,{startedAt:now,creditedTo:now,pausedAt:backgroundPaused&&PAUSABLE.has(id)?now:0});
      }
      syncUnion(now);
      startTicker();
      return;
    }
    const entry=openSources.get(id);
    openSources.delete(id);
    if(entry && counting(id) && credit(entry,TOOLS[id],now)) saveNow();
    if(union){
      const credited=credit(union,'all',now);
      syncUnion(now);
      if(credited) saveNow();
    }
    if(!openSources.size) stopTicker();
    if(!sheet.hidden) render();
  }

  /* 잠금화면·제어 센터·이어폰 빼기로 멈추고 다시 틀 때. 멈춘 사이는 시계를 밀어
     없던 시간으로 친다. 3초 문턱도 그만큼 밀려 멈추기 전 몫이 그대로 이어진다. */
  function handleBackgroundPaused(paused){
    paused=Boolean(paused);
    if(paused===backgroundPaused) return;
    const now=Date.now();
    if(paused){
      accumulate(now);
      backgroundPaused=true;
      openSources.forEach((entry,id)=>{ if(PAUSABLE.has(id) && !entry.pausedAt) entry.pausedAt=now; });
      syncUnion(now);
      saveNow();
      return;
    }
    backgroundPaused=false;
    openSources.forEach((entry,id)=>{
      if(!PAUSABLE.has(id) || !entry.pausedAt) return;
      const gap=Math.max(0,now-entry.pausedAt);
      entry.startedAt+=gap; entry.creditedTo+=gap; entry.pausedAt=0;
    });
    syncUnion(now);
  }

  if(typeof onSoundingChange==='function') onSoundingChange(handleSounding);
  if(typeof onBackgroundPausedChange==='function') onBackgroundPausedChange(handleBackgroundPaused);
  // 탭을 닫거나 화면을 끄면 세던 것을 잃지 않게 그 자리에서 적는다.
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){ accumulate(Date.now()); saveNow(); }
  });
  window.addEventListener('pagehide',()=>{ accumulate(Date.now()); saveNow(); });

  /* ---------- 청음 기록 ----------
     청음 트레이너가 들고 있는 것을 그대로 읽는다. 예전에는 localStorage 키를
     짐작해 읽었는데, 로그인 여부에 따라 엉뚱한 저장소를 집어 청음 트레이너가
     보여 주는 숫자와 어긋났다. 창구는 하나여야 한다. */
  function earFor(key){
    const source=window.OliveEarHistory;
    return source ? source.forDate(key) : null;
  }
  function earModes(){
    const source=window.OliveEarHistory;
    return source ? source.modes() : [];
  }

  /* ---------- 달력 ---------- */
  let shownMonth=new Date();
  shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth(),1);
  let selectedKey=todayKey();

  /* 색 표 대신 눈금 하나. 칸 하나가 한 가지 농도이므로 도구별 색을 읽을 일이
     없어졌고, 남는 것은 '옅으면 적게, 진하면 많이'뿐이다. */
  function buildLegend(){
    if(legendEl.childElementCount) return;
    const low=document.createElement('span');
    low.className='log-scale-end';
    low.textContent='적게';
    legendEl.appendChild(low);
    for(let level=1;level<=LEVELS.length+1;level++){
      const mark=document.createElement('i');
      mark.dataset.level=String(level);
      legendEl.appendChild(mark);
    }
    const high=document.createElement('span');
    high.className='log-scale-end';
    high.textContent='많이';
    legendEl.appendChild(high);
  }

  /* 그날 총 시간을 다섯 단계 중 하나로 옮긴다. 소리 없이 청음만 한 날도
     연습한 날이므로 가장 옅은 단계를 준다 — 빈칸으로 두면 쉰 날과 같아진다. */
  function tintLevel(seconds,hasEar){
    const total=Number(seconds)||0;
    if(total<=0) return hasEar?1:0;
    const ratio=Math.min(1,total/FULL_BAR_SECONDS);
    let level=1;
    LEVELS.forEach(edge=>{ if(ratio>=edge) level+=1; });
    return level;
  }

  function renderCalendar(){
    const year=shownMonth.getFullYear();
    const month=shownMonth.getMonth();
    monthEl.textContent=`${year}년 ${month+1}월`;
    const now=new Date();
    const thisMonth=new Date(now.getFullYear(),now.getMonth(),1);
    nextEl.disabled=shownMonth>=thisMonth;

    gridEl.innerHTML='';
    const first=new Date(year,month,1).getDay();
    const last=new Date(year,month+1,0).getDate();
    for(let i=0;i<first;i++) gridEl.appendChild(document.createElement('div'));
    for(let date=1;date<=last;date++){
      const key=dateKey(new Date(year,month,date));
      const day=store[key];
      const cell=document.createElement('button');
      cell.type='button';
      cell.className='ear-day log-day';
      cell.dataset.key=key;
      const total=totalSeconds(day);
      const level=tintLevel(total,Boolean(earFor(key)));
      if(level>0) cell.dataset.level=String(level);
      if(key===todayKey()) cell.classList.add('today');
      if(key===selectedKey) cell.classList.add('selected');
      if(key>todayKey()) cell.classList.add('log-future');
      cell.setAttribute('aria-label',
        `${month+1}월 ${date}일 ${total>0?formatSpan(total)+' 연습':(level?'소리 없는 연습':'기록 없음')}`);
      const number=document.createElement('span');
      number.className='d';
      number.textContent=String(date);
      cell.appendChild(number);
      gridEl.appendChild(cell);
    }
  }

  /* 도구별로는 얼마나 붙잡고 있었는지만 적는다. 몇 BPM에서 몇으로 옮겼는지,
     어떤 곡을 걸었는지까지 적으면 하루를 훑어보려고 연 화면이 읽을거리가 된다.

     청음만 예외다. 나머지 도구는 시간이 곧 연습의 양이지만, 청음은 몇 문제를
     어느 모드에서 몇 개 맞혔는지가 곧 연습의 내용이다. */
  function detailLines(day,ear){
    const lines=TOOL_ORDER
      .filter(tool=>Number(day[tool]))
      .map(tool=>({tool,name:TOOL_NAMES[tool],text:formatSpan(day[tool])}));
    if(ear){
      const accuracy=Math.round(ear.correct/ear.total*100);
      const counted=earModes().reduce((sum,item)=>{
        const part=ear.byMode[item.key];
        return {
          correct:sum.correct+(part&&Number(part.correct)||0),
          total:sum.total+(part&&Number(part.total)||0),
        };
      },{correct:0,total:0});
      const rest={
        correct:Math.max(0,ear.correct-counted.correct),
        total:Math.max(0,ear.total-counted.total),
      };
      const modes=earModes().map(item=>{
        const part=ear.byMode[item.key];
        return part && Number(part.total)
          ? `${item.label} ${part.correct}/${part.total}` : '';
      }).filter(Boolean);
      if(rest.total) modes.push(`구분 전 ${rest.correct}/${rest.total}`);
      lines.push({swatch:'log-sw-ear',name:'청음',
        text:`${ear.correct}/${ear.total} 정답 · ${accuracy}%`
          +(modes.length?`<br><em>${modes.join(' · ')}</em>`:'')});
    }
    return lines;
  }
  function renderDetail(){
    const day=store[selectedKey];
    const ear=earFor(selectedKey);
    const total=totalSeconds(day);
    const [year,month,date]=selectedKey.split('-').map(Number);

    if(!total && !ear){
      totalEl.textContent=`${month}월 ${date}일 · 기록 없음`;
      totalEl.classList.add('log-empty');
      fullEl.hidden=true; fullEl.innerHTML='';
      return;
    }
    totalEl.textContent=`${month}월 ${date}일 · ${total>0?formatSpan(total):'소리 없는 연습'}`;
    totalEl.classList.remove('log-empty');

    /* 접었다 펴지 않는다. 하루를 훑어보려고 연 화면인데 한 번 더 눌러야
       내용이 나오면 그만큼 멀다. 앞에 세 개만 따로 적던 줄도 함께 걷었다 —
       바로 아래에 전부 있는데 그 셋만 두 번 적히고 있었다. */
    const lines=detailLines(day||{},ear);
    fullEl.hidden=!lines.length;
    fullEl.innerHTML=lines.map(line=>(
      `<div class="log-row"><i class="log-sw ${line.swatch||('log-seg-'+line.tool)}"></i>`+
      `<span class="log-who">${line.name}</span>`+
      `<span class="log-what">${line.text}</span></div>`
    )).join('');
  }

  function render(){
    buildLegend();
    renderCalendar();
    renderDetail();
  }

  /* ---------- 창 ---------- */
  let sheetTrigger=null;

  function openSheet(){
    accumulate(Date.now());
    selectedKey=todayKey();
    shownMonth=new Date();
    shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth(),1);
    sheetTrigger=document.activeElement && typeof document.activeElement.focus==='function'
      ? document.activeElement : null;
    render();
    if(app) app.setAttribute('inert','');
    sheet.hidden=false;
    requestAnimationFrame(()=>sheet.classList.add('open'));
    document.body.classList.add('cloud-sheet-open');
    logButton.setAttribute('aria-expanded','true');
    setTimeout(()=>{ try{ sheetClose.focus(); }catch(error){} },50);
  }
  function closeSheet(){
    if(sheet.hidden) return;
    sheet.classList.remove('open');
    document.body.classList.remove('cloud-sheet-open');
    logButton.setAttribute('aria-expanded','false');
    setTimeout(()=>{
      if(sheet.classList.contains('open')) return;
      sheet.hidden=true;
      if(app) app.removeAttribute('inert');
      if(sheetTrigger && sheetTrigger.isConnected) sheetTrigger.focus();
      sheetTrigger=null;
    },220);
  }

  /* 계정을 연결하기 전에는 달력 대신 로그인 버튼을 둔다. 기록이 쌓일 곳이
     없는데 빈 달력을 열어 주면 무엇이 잘못됐는지 알 수 없다.
     도움말은 가상의 계정으로 도니 그쪽에서는 늘 달력이 뜬다. */
  function showFor(user){
    const signedIn=Boolean(user);
    logButton.hidden=!signedIn;
    if(signInButton) signInButton.hidden=signedIn;
    if(!signedIn) closeSheet();
  }
  showFor(null);
  if(window.OliveCloud && typeof window.OliveCloud.subscribeSession==='function'){
    window.OliveCloud.subscribeSession(showFor);
  }else{
    showFor(true);
  }
  if(signInButton){
    signInButton.addEventListener('click',()=>{
      if(window.OliveCloud && typeof window.OliveCloud.openAccount==='function'){
        window.OliveCloud.openAccount();
      }
    });
  }

  /* 위를 잡고 아래로 끌면 닫힌다. 손이 닿는 곳이 화면 위쪽이라 ×까지
     올라가는 것보다 가깝다. 달력을 옆으로 넘기려다 닫히지 않도록 세로로
     확실히 끌었을 때만 받는다. */
  (function bindDragToClose(){
    const card=sheet.querySelector('.cloud-sheet');
    if(!card) return;
    let pointerId=null, startY=0, startX=0, dragging=false;
    const reset=()=>{
      pointerId=null; dragging=false;
      card.style.transition='';
      card.style.transform='';
    };
    card.addEventListener('pointerdown',event=>{
      if(event.isPrimary===false || event.button>0) return;
      // 달력이나 버튼을 누르는 중이면 끌기로 보지 않는다.
      if(event.target.closest('button, input, a, .ear-cloud')) return;
      // 창 안을 스크롤해 내려간 상태에서는 스크롤이 먼저다.
      if(card.scrollTop>0) return;
      pointerId=event.pointerId; startY=event.clientY; startX=event.clientX;
    });
    card.addEventListener('pointermove',event=>{
      if(event.pointerId!==pointerId) return;
      const dy=event.clientY-startY, dx=event.clientX-startX;
      if(!dragging){
        if(dy<10 || Math.abs(dx)>Math.abs(dy)) return;
        dragging=true;
        card.style.transition='none';
      }
      card.style.transform='translateY('+Math.max(0,dy)+'px)';
    });
    card.addEventListener('pointerup',event=>{
      if(event.pointerId!==pointerId) return;
      const dy=event.clientY-startY;
      const far=dragging && dy>90;
      reset();
      if(far) closeSheet();
    });
    card.addEventListener('pointercancel',reset);
  })();

  logButton.setAttribute('aria-expanded','false');
  logButton.addEventListener('click',openSheet);
  sheetClose.addEventListener('click',closeSheet);
  sheet.addEventListener('click',event=>{ if(event.target===sheet) closeSheet(); });
  sheet.addEventListener('keydown',event=>{
    if(event.key==='Escape'){ event.preventDefault(); closeSheet(); }
  });
  prevEl.addEventListener('click',()=>{
    shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1);
    render();
  });
  nextEl.addEventListener('click',()=>{
    shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1);
    render();
  });
  gridEl.addEventListener('click',event=>{
    const cell=event.target.closest('.log-day');
    if(!cell || !cell.dataset.key) return;
    selectedKey=cell.dataset.key;
    render();
  });

  window.OlivePracticeLog={
    /* 청음 트레이너가 답을 적을 때마다 부른다. 창이 닫혀 있으면 할 일이 없다. */
    refresh(){ if(!sheet.hidden) render(); },
    open:openSheet,
    /* 검사와 진단용. 값은 읽기만 한다. */
    snapshot:()=>JSON.parse(JSON.stringify(store)),
  };
})();

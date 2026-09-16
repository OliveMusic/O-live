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
  const leadEl=document.getElementById('practiceLogLead');
  const monthEl=document.getElementById('practiceLogMonth');
  const prevEl=document.getElementById('practiceLogPrev');
  const nextEl=document.getElementById('practiceLogNext');
  const gridEl=document.getElementById('practiceLogGrid');
  const legendEl=document.getElementById('practiceLogLegend');
  const totalEl=document.getElementById('practiceLogTotal');
  const fullEl=document.getElementById('practiceLogFull');
  const app=document.getElementById('app');

  const STORE_KEY='olive-practice-log-v1';
  /* 하루치 막대가 꽉 차는 기준. 세 시간 친 날 하나 때문에 나머지 날이 전부
     납작해지면 달력이 쓸모없어지므로, 넘어가도 막대는 더 자라지 않는다. */
  const FULL_BAR_SECONDS=90*60;
  const COLUMN_PX=25;
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
    return store;
  }
  function write(){
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
    return TOOL_ORDER.reduce((sum,tool)=>sum+(Number(day[tool])||0),0);
  }

  /* ---------- 시간 재기 ---------- */
  const openSources=new Map();      // '탭:출처' → 마지막으로 셈한 시각
  let ticker=0;

  function addSeconds(tool,seconds,key){
    const day=dayFor(key);
    day[tool]=(Number(day[tool])||0)+seconds;
  }

  function accumulate(now){
    let touched=false;
    openSources.forEach((since,id)=>{
      const tool=TOOLS[id];
      const span=(now-since)/1000;
      if(!tool || span<1) return;
      openSources.set(id,now);
      const key=todayKey();
      addSeconds(tool,span,key);
      touched=true;
    });
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
      if(!openSources.has(id)) openSources.set(id,now);
      startTicker();
      return;
    }
    const since=openSources.get(id);
    openSources.delete(id);
    if(Number.isFinite(since)){
      const span=(now-since)/1000;
      if(span>=MIN_SESSION_SECONDS){
        const dayAt=todayKey();
        addSeconds(TOOLS[id],span,dayAt);
        saveNow();
      }
    }
    if(!openSources.size) stopTicker();
    if(!sheet.hidden) render();
  }

  if(typeof onSoundingChange==='function') onSoundingChange(handleSounding);
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
  function earDays(){
    const source=window.OliveEarHistory;
    return source ? source.days() : [];
  }

  /* ---------- 달력 ---------- */
  let shownMonth=new Date();
  shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth(),1);
  let selectedKey=todayKey();

  function buildLegend(){
    if(legendEl.childElementCount) return;
    TOOL_ORDER.forEach(tool=>{
      const item=document.createElement('span');
      const swatch=document.createElement('i');
      swatch.className='log-seg-'+tool;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(TOOL_NAMES[tool]));
      legendEl.appendChild(item);
    });
  }

  function makeColumn(day){
    const wrap=document.createElement('span');
    wrap.className='log-col-wrap';
    const column=document.createElement('span');
    column.className='log-col';
    const total=totalSeconds(day);
    if(total>0){
      const height=Math.max(4,Math.round(Math.min(1,total/FULL_BAR_SECONDS)*COLUMN_PX));
      /* 2px보다 얇게 그려질 도구는 마디로 그리지 않는다. 그렇게 얇은 띠는 읽히지도
         않으면서 막대만 흐리게 만든다. 정확한 시간은 아래 상세에 그대로 있고,
         막대의 전체 키는 언제나 그날 총 시간을 뜻한다. */
      const parts=TOOL_ORDER
        .map(tool=>({tool,seconds:Number(day[tool])||0}))
        .filter(item=>item.seconds>0 && height*item.seconds/total>=2);
      if(!parts.length){
        // 전부 얇으면 가장 오래 잡은 것 하나로 막대를 채운다.
        const top=TOOL_ORDER.reduce((at,tool)=>
          (Number(day[tool])||0)>(Number(day[at])||0)?tool:at,TOOL_ORDER[0]);
        parts.push({tool:top,seconds:total});
      }
      const sum=parts.reduce((at,item)=>at+item.seconds,0)||total;
      let left=height;
      parts.forEach(item=>{
        item.span=Math.max(2,Math.round(height*item.seconds/sum));
        left-=item.span;
      });
      // 반올림으로 남거나 모자란 만큼은 가장 긴 마디가 흡수한다. 마지막 마디에
      // 떠넘기면 1px짜리 실오라기가 다시 생긴다.
      if(left!==0){
        let biggest=0;
        parts.forEach((item,index)=>{ if(item.span>parts[biggest].span) biggest=index; });
        parts[biggest].span=Math.max(2,parts[biggest].span+left);
      }
      parts.forEach(item=>{
        const segment=document.createElement('i');
        segment.className='log-seg-'+item.tool;
        segment.style.height=item.span+'px';
        column.appendChild(segment);
      });
    }else{
      const rest=document.createElement('i');
      rest.className='log-rest';
      column.appendChild(rest);
    }
    wrap.appendChild(column);
    return wrap;
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
      if(totalSeconds(day)>0 || earFor(key)) cell.classList.add('has-record');
      if(key===todayKey()) cell.classList.add('today');
      if(key===selectedKey) cell.classList.add('selected');
      if(key>todayKey()) cell.classList.add('log-future');
      const total=totalSeconds(day);
      cell.setAttribute('aria-label',
        `${month+1}월 ${date}일 ${total>0?formatSpan(total)+' 연습':'기록 없음'}`);
      const number=document.createElement('span');
      number.className='d';
      number.textContent=String(date);
      cell.appendChild(number);
      cell.appendChild(makeColumn(day));
      gridEl.appendChild(cell);
    }
  }

  function renderLead(){
    const prefix=`${shownMonth.getFullYear()}-${String(shownMonth.getMonth()+1).padStart(2,'0')}-`;
    let days=0, seconds=0;
    const counted=new Set();
    Object.keys(store).forEach(key=>{
      if(key.indexOf(prefix)!==0) return;
      const total=totalSeconds(store[key]);
      if(total<=0) return;
      counted.add(key); seconds+=total;
    });
    // 소리 없이 청음만 한 날도 연습한 날이다.
    earDays().forEach(key=>{ if(key.indexOf(prefix)===0 && earFor(key)) counted.add(key); });
    days=counted.size;
    leadEl.innerHTML=days
      ? `${shownMonth.getMonth()+1}월에 <b>${days}일 · ${formatSpan(seconds)}</b>`
      : `${shownMonth.getMonth()+1}월에는 아직 기록이 없습니다`;
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
    renderLead();
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

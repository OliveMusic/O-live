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

  const sheetClose=document.getElementById('practiceLogClose');
  const leadEl=document.getElementById('practiceLogLead');
  const monthEl=document.getElementById('practiceLogMonth');
  const prevEl=document.getElementById('practiceLogPrev');
  const nextEl=document.getElementById('practiceLogNext');
  const gridEl=document.getElementById('practiceLogGrid');
  const legendEl=document.getElementById('practiceLogLegend');
  const totalEl=document.getElementById('practiceLogTotal');
  const moreEl=document.getElementById('practiceLogMore');
  const briefEl=document.getElementById('practiceLogBrief');
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
  function formatClock(seconds){
    const total=Math.max(0,Math.round(Number(seconds)||0));
    return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
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
  function save(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      saveTimer=0;
      try{ localStorage.setItem(STORE_KEY,JSON.stringify(store)); }catch(error){}
    },400);
  }
  function saveNow(){
    clearTimeout(saveTimer); saveTimer=0;
    try{ localStorage.setItem(STORE_KEY,JSON.stringify(store)); }catch(error){}
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

  /* 무엇을 어떻게 연습했는지도 함께 남긴다. 값은 전부 다른 기능이 이미 들고
     있는 것을 읽어 온 것이고, 여기서 새로 만들어 내는 숫자는 없다. */
  function sampleMeta(tool,day){
    if(tool==='met'){
      const metro=window.OliveMetronome;
      if(!metro) return;
      const bpm=Number(metro.getBpm());
      if(Number.isFinite(bpm)){
        day.bpmLo=Number.isFinite(day.bpmLo) ? Math.min(day.bpmLo,bpm) : bpm;
        day.bpmHi=Number.isFinite(day.bpmHi) ? Math.max(day.bpmHi,bpm) : bpm;
      }
      day.meter=metro.meterLabel();
      return;
    }
    if(tool==='jam'){
      const jam=window.OliveJam && window.OliveJam.snapshot();
      if(!jam) return;
      day.jamKey=jam.key;
      day.jamPreset=jam.preset;
      day.jamStyle=jam.style;
      const bpm=Number(jam.bpm);
      if(Number.isFinite(bpm)){
        day.jamBpmLo=Number.isFinite(day.jamBpmLo) ? Math.min(day.jamBpmLo,bpm) : bpm;
        day.jamBpmHi=Number.isFinite(day.jamBpmHi) ? Math.max(day.jamBpmHi,bpm) : bpm;
      }
      return;
    }
    if(tool==='trk'){
      const track=(window.OliveRecorder && window.OliveRecorder.nowPlaying())
        || (window.OlivePracticeLinks && window.OlivePracticeLinks.nowPlaying());
      if(!track || !track.title) return;
      const seen=Array.isArray(day.tracks) ? day.tracks : (day.tracks=[]);
      const note={
        title:track.title,
        rate:Number.isFinite(track.rate)&&track.rate!==1 ? track.rate : null,
        loop:track.loop ? [Math.round(track.loop.a),Math.round(track.loop.b)] : null,
      };
      const at=seen.findIndex(item=>item.title===note.title);
      if(at>=0) seen[at]=note;
      else if(seen.length<6) seen.push(note);
    }
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
      sampleMeta(tool,dayFor(key));
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
        sampleMeta(TOOLS[id],dayFor(dayAt));
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

  /* ---------- 저장한 녹음 ---------- */
  function noteRecordingSaved(){
    const key=todayKey();
    const day=dayFor(key);
    day.saved=(Number(day.saved)||0)+1;
    saveNow();
    if(!sheet.hidden) render();
  }

  /* ---------- 달력 ---------- */
  let shownMonth=new Date();
  shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth(),1);
  let selectedKey=todayKey();
  let expanded=false;

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
      if(totalSeconds(day)>0 || Number(day&&day.saved) || earFor(key)) cell.classList.add('has-record');
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

  function trackLine(note){
    const parts=[];
    if(note.loop) parts.push(`${formatClock(note.loop[0])}–${formatClock(note.loop[1])} 반복`);
    if(note.rate) parts.push(`${String(note.rate.toFixed(2)).replace(/0+$/,'').replace(/\.$/,'')}×`);
    return note.title+(parts.length?` <em>${parts.join(' · ')}</em>`:'');
  }

  function detailLines(day,ear){
    const lines=[];
    if(Number(day.met)){
      const extra=[];
      if(Number.isFinite(day.bpmLo)){
        extra.push(day.bpmLo===day.bpmHi ? `${day.bpmLo} BPM` : `${day.bpmLo}→${day.bpmHi} BPM`);
      }
      if(day.meter) extra.push(day.meter);
      lines.push({tool:'met',name:'메트로놈',
        text:formatSpan(day.met)+(extra.length?` <em>· ${extra.join(' · ')}</em>`:'')});
    }
    if(Number(day.jam)){
      const extra=[day.jamKey,day.jamPreset,day.jamStyle].filter(Boolean);
      if(Number.isFinite(day.jamBpmLo)){
        extra.push(day.jamBpmLo===day.jamBpmHi
          ? `${day.jamBpmLo} BPM` : `${day.jamBpmLo}→${day.jamBpmHi} BPM`);
      }
      lines.push({tool:'jam',name:'잼',
        text:formatSpan(day.jam)+(extra.length?` <em>· ${extra.join(' · ')}</em>`:'')});
    }
    if(Number(day.trk)){
      const titles=Array.isArray(day.tracks)?day.tracks:[];
      lines.push({tool:'trk',name:'트랙',
        text:formatSpan(day.trk)+(titles.length?` · ${titles.map(trackLine).join(' · ')}`:'')});
    }
    if(Number(day.rec) || Number(day.saved)){
      const extra=[];
      if(Number(day.rec)) extra.push(formatSpan(day.rec)+' 녹음');
      if(Number(day.saved)) extra.push(`${day.saved}개 저장`);
      lines.push({tool:'rec',name:'녹음',text:extra.join(' · ')});
    }
    if(Number(day.rhy)){
      lines.push({tool:'rhy',name:'리듬',text:formatSpan(day.rhy)});
    }
    if(ear){
      /* 청음만 시간이 아니라 문제 수로 센다. 나머지 도구는 얼마나 붙잡고
         있었는지가 전부지만, 청음은 몇 문제를 어느 모드에서 몇 개 맞혔는지가
         곧 연습의 내용이다. 그래서 여기만 한 줄 더 쓴다. */
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

    if(!total && !ear && !Number(day&&day.saved)){
      totalEl.textContent=`${month}월 ${date}일 · 기록 없음`;
      totalEl.classList.add('log-empty');
      moreEl.hidden=true;
      briefEl.innerHTML='';
      fullEl.hidden=true; fullEl.innerHTML='';
      return;
    }
    totalEl.textContent=`${month}월 ${date}일 · ${total>0?formatSpan(total):'소리 없는 연습'}`;
    totalEl.classList.remove('log-empty');

    briefEl.innerHTML=TOOL_ORDER
      .filter(tool=>Number(day&&day[tool]))
      .slice(0,3)
      .map(tool=>`<span><b>${TOOL_NAMES[tool]}</b>${formatSpan(day[tool])}</span>`)
      .join('');

    const lines=detailLines(day||{},ear);
    moreEl.hidden=!lines.length;
    moreEl.setAttribute('aria-expanded',expanded?'true':'false');
    moreEl.textContent=expanded?'접기':'자세히';
    fullEl.hidden=!expanded;
    fullEl.innerHTML=expanded
      ? lines.map(line=>(
          `<div class="log-row"><i class="log-sw ${line.swatch||('log-seg-'+line.tool)}"></i>`+
          `<span class="log-who">${line.name}</span>`+
          `<span class="log-what">${line.text}</span></div>`
        )).join('')
      : '';
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
    expanded=false;
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
    if(cell.dataset.key===selectedKey) expanded=!expanded;
    else{ selectedKey=cell.dataset.key; expanded=false; }
    render();
  });
  moreEl.addEventListener('click',()=>{ expanded=!expanded; renderDetail(); });

  window.OlivePracticeLog={
    noteRecordingSaved,
    /* 청음 트레이너가 답을 적을 때마다 부른다. 창이 닫혀 있으면 할 일이 없다. */
    refresh(){ if(!sheet.hidden) render(); },
    open:openSheet,
    /* 검사와 진단용. 값은 읽기만 한다. */
    snapshot:()=>JSON.parse(JSON.stringify(store)),
  };
})();

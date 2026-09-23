/* ===================== 청음 트레이너 ===================== */
(function(){
  /* ---------- 문제 은행 ---------- */
  const INTERVALS = [
    {ko:'단2도',   en:'Minor 2nd',   semis:1,  lv:3},
    {ko:'장2도',   en:'Major 2nd',   semis:2,  lv:1},
    {ko:'단3도',   en:'Minor 3rd',   semis:3,  lv:2},
    {ko:'장3도',   en:'Major 3rd',   semis:4,  lv:1},
    {ko:'완전4도', en:'Perfect 4th', semis:5,  lv:1},
    {ko:'증4도',   en:'Tritone',     semis:6,  lv:3},
    {ko:'완전5도', en:'Perfect 5th', semis:7,  lv:1},
    {ko:'단6도',   en:'Minor 6th',   semis:8,  lv:3},
    {ko:'장6도',   en:'Major 6th',   semis:9,  lv:2},
    {ko:'단7도',   en:'Minor 7th',   semis:10, lv:2},
    {ko:'장7도',   en:'Major 7th',   semis:11, lv:3},
    {ko:'옥타브',  en:'Octave',      semis:12, lv:1},
  ];
  const CHORDS = [
    {ko:'메이저',       en:'Major',       degrees:'1–3–5',       iv:[0,4,7],     lv:1},
    {ko:'마이너',       en:'Minor',       degrees:'1–♭3–5',      iv:[0,3,7],     lv:1},
    {ko:'디미니시',     en:'Diminished',  degrees:'1–♭3–♭5',     iv:[0,3,6],     lv:2},
    {ko:'어그멘티드',   en:'Augmented',   degrees:'1–3–♯5',      iv:[0,4,8],     lv:2},
    {ko:'메이저 7',     en:'Major 7th',   degrees:'1–3–5–7',     iv:[0,4,7,11],  lv:2},
    {ko:'마이너 7',     en:'Minor 7th',   degrees:'1–♭3–5–♭7',   iv:[0,3,7,10],  lv:2},
    {ko:'도미넌트 7',   en:'Dominant 7th',degrees:'1–3–5–♭7',    iv:[0,4,7,10],  lv:3},
    {ko:'하프 디미니시',en:'Half-dim 7th',degrees:'1–♭3–♭5–♭7', iv:[0,3,6,10],  lv:3},
    {ko:'sus4',         en:'Suspended 4th',degrees:'1–4–5',      iv:[0,5,7],    lv:3},
  ];
  const SCALES = [
    {ko:'메이저',           en:'Major',            iv:[0,2,4,5,7,9,11,12], lv:1},
    {ko:'내추럴 마이너',    en:'Natural minor',    iv:[0,2,3,5,7,8,10,12], lv:1},
    {ko:'메이저 펜타토닉',  en:'Major pentatonic', iv:[0,2,4,7,9,12],      lv:1},
    {ko:'마이너 펜타토닉',  en:'Minor pentatonic', iv:[0,3,5,7,10,12],     lv:2},
    {ko:'블루스',           en:'Blues',            iv:[0,3,5,6,7,10,12],   lv:2},
    {ko:'도리안',           en:'Dorian',           iv:[0,2,3,5,7,9,10,12], lv:2},
    {ko:'믹소리디안',       en:'Mixolydian',       iv:[0,2,4,5,7,9,10,12], lv:3},
    {ko:'하모닉 마이너',    en:'Harmonic minor',   iv:[0,2,3,5,7,8,11,12], lv:3},
    {ko:'리디안',           en:'Lydian',           iv:[0,2,4,6,7,9,11,12], lv:3},
  ];

  const MODES = [
    {key:'interval', label:'음정', bank:INTERVALS},
    {key:'chord',    label:'화음', bank:CHORDS},
    {key:'scale',    label:'음계', bank:SCALES},
  ];
  const LEVELS = [
    {key:1, label:'초급'},
    {key:2, label:'중급'},
    {key:3, label:'고급'},
  ];

  /* 도움말 미리보기에서만 정답 보기에 표시를 남긴다. 맞혔을 때와 틀렸을 때를
     나눠서 가르치려면 어느 쪽을 누르라고 가리킬 수 있어야 한다. 앱에서는 붙지
     않으므로 화면을 뜯어봐도 정답이 새지 않는다. */
  const guidePreview = /[?&]guide=1(?:&|$)/.test(location.search);

  let mode = 'interval', level = 1;
  let focusMissed = true;           // '틀린 것 다시 내기'
  let current = null, answered = false, reviewingWrong = false, nextTimer = null, playFlash = null;
  let score = 0, total = 0, streak = 0;

  const earModes    = document.getElementById('earModes');
  const earLevels   = document.getElementById('earLevels');
  const earAcc      = document.getElementById('earAcc');
  const earStreak   = document.getElementById('earStreak');
  const earTotal    = document.getElementById('earTotal');
  const earPlayBtn  = document.getElementById('earPlayBtn');
  const earReplay   = document.getElementById('earReplay');
  const earPrompt   = document.getElementById('earPrompt');
  const earFeedback = document.getElementById('earFeedback');
  const earChoices  = document.getElementById('earChoices');
  const earFocus    = document.getElementById('earFocus');

  /* ---------- 날짜별 청음 기록 ----------
     달력은 하루 기록을 합산하고 상세에는 음정·화음·음계를 나눠 보여준다.
     로그인 전에는 익명 키, 로그인 후에는 계정별 로컬 캐시를 사용한다. */
  const EAR_HISTORY_KEY = 'olive-ear-history-v1';
  const EAR_USER_HISTORY_PREFIX = 'olive-ear-history-user-v1:';
  const EAR_HISTORY_MODES = [
    {key:'interval',label:'음정'},
    {key:'chord',label:'화음'},
    {key:'scale',label:'음계'},
  ];
  let activeEarHistoryKey=EAR_HISTORY_KEY;
  function normalizeEarCount(value){
    const total=Math.max(0,Math.floor(Number(value&&value.total)||0));
    const correct=Math.max(0,Math.min(total,Math.floor(Number(value&&value.correct)||0)));
    return {correct,total};
  }
  function normalizeEarRecord(value){
    const total=normalizeEarCount(value);
    const source=value && typeof value.byMode==='object' ? value.byMode : {};
    const byMode={};
    EAR_HISTORY_MODES.forEach(item=>{ byMode[item.key]=normalizeEarCount(source[item.key]); });
    return {correct:total.correct,total:total.total,byMode};
  }
  function loadEarHistory(storageKey=activeEarHistoryKey){
    try{
      const parsed=JSON.parse(localStorage.getItem(storageKey)||'{}');
      if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) return {};
      const clean={};
      Object.entries(parsed).forEach(([key,value])=>{
        if(/^\d{4}-\d{2}-\d{2}$/.test(key)){
          const rec=normalizeEarRecord(value);
          if(rec.total) clean[key]=rec;
        }
      });
      return clean;
    }catch(e){ return {}; }
  }
  let earHistoryData = loadEarHistory();

  function dateKey(date){
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,'0');
    const d=String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  function saveEarHistory(){
    try{ localStorage.setItem(activeEarHistoryKey, JSON.stringify(earHistoryData)); }catch(e){}
  }
  /* 달력은 상단바의 연습 기록 하나로 모았다. 여기서는 기록을 쌓고 저장하는
     일만 하고, 그리는 것은 js/practice-log.js가 맡는다. 같은 값을 두 군데에서
     그리면 어느 쪽이 맞는지 알 수 없게 된다 — 실제로 두 화면의 숫자가 달랐다. */
  function notifyHistoryChanged(){
    if(window.OlivePracticeLog && typeof window.OlivePracticeLog.refresh==='function'){
      window.OlivePracticeLog.refresh();
    }
  }
  function recordEarResult(correct){
    const key=dateKey(new Date());
    const rec=normalizeEarRecord(earHistoryData[key]);
    rec.total=(Number(rec.total)||0)+1;
    rec.correct=(Number(rec.correct)||0)+(correct?1:0);
    const part=rec.byMode[mode] || (rec.byMode[mode]={correct:0,total:0});
    part.total++;
    if(correct) part.correct++;
    earHistoryData[key]=rec;
    saveEarHistory();
    notifyHistoryChanged();
    if(window.OliveCloud) window.OliveCloud.recordAnswer(key,correct,mode);
  }

  /* ---------- 틀린 것 다시 내기 ----------
     문항마다 얼마나 자주 틀렸는지를 0~1의 '약함'으로 들고, 약한 문항일수록 더 자주
     낸다(최대 다섯 배). 맞히면 약함이 줄어 저절로 원래 비율로 돌아간다.
     틀렸을 때는 무엇을 무엇으로 들었는지(단3도를 장3도로) 그날 몫으로 센다. 연습 기록이
     '자주 헷갈림' 한 줄로 보여 준다. 이 기록은 기기에만 둔다. */
  const EAR_ITEMS_PREFIX = 'olive-ear-items-v1:';
  const ITEM_DAYS_KEPT = 60;
  function itemId(modeKey,item){ return modeKey==='interval' ? String(item.semis) : String(item.en); }
  function itemLabel(modeKey,id){
    const bankFor=(MODES.find(item=>item.key===modeKey)||{}).bank||[];
    const item=bankFor.find(entry=>itemId(modeKey,entry)===id);
    if(!item) return '';
    // 음정은 '도'를 떼어 짧게 쓴다(단3↔장3). 짝으로 늘어놓으면 '도'가 반복돼 읽기 어렵다.
    return modeKey==='interval' ? item.ko.replace(/도$/,'') : item.ko;
  }
  function itemsKey(){
    return EAR_ITEMS_PREFIX+(activeEarHistoryKey===EAR_HISTORY_KEY
      ? 'anon' : activeEarHistoryKey.slice(EAR_USER_HISTORY_PREFIX.length));
  }
  function loadItemStats(){
    try{
      const parsed=JSON.parse(localStorage.getItem(itemsKey())||'{}');
      return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : {};
    }catch(e){ return {}; }
  }
  let itemStats = loadItemStats();
  function saveItemStats(){
    if(guidePreview) return;          // 도움말은 읽기만 한다
    try{ localStorage.setItem(itemsKey(), JSON.stringify(itemStats)); }catch(e){}
  }
  function weakness(modeKey,id){
    const table=itemStats.weak && itemStats.weak[modeKey];
    return table ? Math.max(0,Math.min(1,Number(table[id])||0)) : 0;
  }
  function noteItemResult(answer,picked,correct){
    itemStats.weak = itemStats.weak && typeof itemStats.weak==='object' ? itemStats.weak : {};
    const table = itemStats.weak[mode] = itemStats.weak[mode] && typeof itemStats.weak[mode]==='object' ? itemStats.weak[mode] : {};
    const id=itemId(mode,answer);
    const before=weakness(mode,id);
    const after=correct ? before*0.55 : Math.min(1,before*0.6+0.5);
    if(after<0.02) delete table[id];
    else table[id]=Math.round(after*1000)/1000;
    if(!correct && picked){
      const day=dateKey(new Date());
      itemStats.days = itemStats.days && typeof itemStats.days==='object' ? itemStats.days : {};
      const record = itemStats.days[day] = itemStats.days[day] && typeof itemStats.days[day]==='object' ? itemStats.days[day] : {};
      // 짝은 순서를 가리지 않는다. 장3을 단3으로 들은 것과 그 반대는 같은 헷갈림이다.
      const pair=mode+':'+[id,itemId(mode,picked)].sort().join('|');
      record[pair]=(Number(record[pair])||0)+1;
      const days=Object.keys(itemStats.days).sort();
      days.slice(0,Math.max(0,days.length-ITEM_DAYS_KEPT)).forEach(key=>{ delete itemStats.days[key]; });
    }
    saveItemStats();
  }
  /* 그날 두 번 이상 헷갈린 짝을 많은 순으로 셋까지. 한 번 틀린 것은 실수일 수 있다. */
  function confusionsFor(day){
    const record=itemStats.days && itemStats.days[day];
    if(!record || typeof record!=='object') return [];
    return Object.entries(record)
      .map(([key,count])=>{
        const [modeKey,pair]=key.split(':');
        const [a,b]=String(pair||'').split('|');
        const labels=[itemLabel(modeKey,a),itemLabel(modeKey,b)];
        return {label:labels.join('↔'),count:Number(count)||0,ok:labels.every(Boolean)};
      })
      .filter(item=>item.ok && item.count>=2)
      .sort((a,b)=>b.count-a.count)
      .slice(0,3)
      .map(({label,count})=>({label,count}));
  }

  /* 청음 기록의 유일한 창구. 연습 기록이 localStorage 키를 짐작해 읽던 때는
     로그인 여부에 따라 엉뚱한 저장소를 집어 두 화면의 숫자가 어긋났다. */
  window.OliveEarHistory={
    modes:()=>EAR_HISTORY_MODES.map(item=>({key:item.key,label:item.label})),
    forDate(key){
      const rec=earHistoryData[key];
      if(!rec || !Number(rec.total)) return null;
      return {
        total:Number(rec.total)||0,
        correct:Number(rec.correct)||0,
        byMode:rec.byMode&&typeof rec.byMode==='object' ? rec.byMode : {},
        confusions:confusionsFor(key),
      };
    },
    days:()=>Object.keys(earHistoryData),
  };
  if(window.OliveCloud){
    window.OliveCloud.init({
      getAnonymousHistory:()=>loadEarHistory(EAR_HISTORY_KEY),
      clearAnonymousHistory:()=>{
        try{ localStorage.removeItem(EAR_HISTORY_KEY); }catch(e){}
      },
      useUserHistory:(userId,history)=>{
        activeEarHistoryKey=EAR_USER_HISTORY_PREFIX+userId;
        earHistoryData=history && typeof history==='object' ? history : {};
        itemStats=loadItemStats();
        saveEarHistory();
        notifyHistoryChanged();
      },
      useAnonymousHistory:()=>{
        activeEarHistoryKey=EAR_HISTORY_KEY;
        earHistoryData=loadEarHistory(EAR_HISTORY_KEY);
        itemStats=loadItemStats();
        notifyHistoryChanged();
      },
      getPreferences:()=>window.OlivePreferences.getRecord(),
      applyPreferences:(data,updatedAt)=>window.OlivePreferences.applyRecord(data,updatedAt),
      clearPreferences:()=>window.OlivePreferences.clearLocal(),
    }).catch(error=>console.warn('[O\'live cloud init]',error));
  }

  MODES.forEach(m=>{
    const b=document.createElement('button');
    b.className='pill'+(m.key===mode?' active':'');
    b.textContent=m.label; b.dataset.mode=m.key;
    b.addEventListener('click', ()=>{
      mode=m.key;
      earModes.querySelectorAll('.pill').forEach(x=>x.classList.toggle('active', x.dataset.mode===mode));
      resetStats(); newQuestion(false);
      window.OlivePreferences.changed();
    });
    earModes.appendChild(b);
  });
  LEVELS.forEach(l=>{
    const b=document.createElement('button');
    b.className='pill'+(l.key===level?' active':'');
    b.textContent=l.label; b.dataset.level=l.key;
    b.addEventListener('click', ()=>{
      level=l.key;
      earLevels.querySelectorAll('.pill').forEach(x=>x.classList.toggle('active', +x.dataset.level===level));
      resetStats(); newQuestion(false);
      window.OlivePreferences.changed();
    });
    earLevels.appendChild(b);
  });

  function renderFocus(){
    earFocus.textContent=focusMissed?'ON':'OFF';
    earFocus.classList.toggle('active',focusMissed);
    earFocus.setAttribute('aria-pressed',String(focusMissed));
  }
  earFocus.addEventListener('click',()=>{
    focusMissed=!focusMissed;
    renderFocus();
    window.OlivePreferences.changed();
  });
  renderFocus();

  window.OlivePreferences.register('earTrainer',
    ()=>({mode,level,focus:focusMissed}),
    value=>{
      if(!value || typeof value!=='object') return;
      if(typeof value.focus==='boolean' && value.focus!==focusMissed){
        focusMissed=value.focus;
        renderFocus();
      }
      const previousMode=mode, previousLevel=level;
      if(MODES.some(item=>item.key===value.mode)) mode=value.mode;
      const nextLevel=Math.round(Number(value.level));
      if(LEVELS.some(item=>item.key===nextLevel)) level=nextLevel;
      /* 바뀐 것이 없으면 점수와 풀던 문제를 그대로 둔다. 동기화가 같은 값을 다시
         적용할 때마다 정확도·연속 정답이 0으로 돌아가고 문제가 바뀌었다. */
      if(mode===previousMode && level===previousLevel && current) return;
      earModes.querySelectorAll('.pill')
        .forEach(button=>button.classList.toggle('active',button.dataset.mode===mode));
      earLevels.querySelectorAll('.pill')
        .forEach(button=>button.classList.toggle('active',Number(button.dataset.level)===level));
      resetStats();
      newQuestion(false);
    }
  );

  function resetStats(){
    score=0; total=0; streak=0; renderStats();
  }
  function renderStats(){
    earAcc.textContent = total ? Math.round(score/total*100)+'%' : '0%';
    earStreak.textContent = streak;
    earTotal.textContent = total;
  }
  function bank(){
    const m = MODES.find(x=>x.key===mode);
    return m.bank.filter(x=>x.lv<=level);
  }
  function shuffle(a){
    const r=a.slice();
    for(let i=r.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [r[i],r[j]]=[r[j],r[i]]; }
    return r;
  }

  /* ---------- 문제 ----------
     바로 앞 문제와 같은 답은 네 배 덜 나오게 한다. 초급 음정은 보기가 다섯뿐이라 같은
     답이 연달아 나오는 일이 잦았다(다섯에 하나). 아예 막지는 않는다. 막으면 그것도
     단서가 된다. '틀린 것 다시 내기'가 켜져 있으면 약한 문항에 무게를 더 준다. */
  function pickAnswer(pool){
    if(pool.length<2) return pool[0];
    const previous=current && current.answer;
    const weights=pool.map(item=>{
      let weight=focusMissed ? 1+4*weakness(mode,itemId(mode,item)) : 1;
      if(item===previous) weight*=0.25;
      return weight;
    });
    let roll=Math.random()*weights.reduce((sum,value)=>sum+value,0);
    for(let index=0;index<pool.length;index++){
      roll-=weights[index];
      if(roll<0) return pool[index];
    }
    return pool[pool.length-1];
  }
  function newQuestion(autoPlay){
    clearTimeout(nextTimer); nextTimer=null;
    answered=false;
    reviewingWrong=false;
    earFeedback.textContent='';
    earFeedback.className='feedback-msg';
    earPrompt.textContent='소리를 듣고 정답을 선택하세요';
    earPlayBtn.setAttribute('aria-label','문제 듣기');

    const pool = bank();
    const answer = pickAnswer(pool);
    // 휴대폰 스피커는 300Hz 아래를 12~21dB나 깎는다.
    // 예전 음역(165~277Hz)은 측정상 충분해도 실제로는 작게 들렸다.
    const root = (mode==='scale' ? 60 : mode==='chord' ? 57 : 60) + Math.floor(Math.random()*7);
    current = {answer, root};

    // 보기: 정답 + 오답 3개 (풀이 작으면 있는 만큼)
    const others = shuffle(pool.filter(x=>x!==answer)).slice(0, Math.min(3, pool.length-1));
    renderChoices(shuffle([answer, ...others]), answer);

    if(autoPlay) playCurrent();
  }

  function renderChoices(list, answer){
    earChoices.innerHTML='';
    list.forEach(item=>{
      const b=document.createElement('button');
      b.className='choice-row';
      const degrees=mode==='chord' && item.degrees
        ? `<span class="degrees">${item.degrees}</span>` : '';
      b.innerHTML = `<span class="choice-primary"><span class="ko">${item.ko}</span>${degrees}</span>`+
        `<span class="en">${item.en}</span>`;
      b.setAttribute('aria-label',item.ko+', '+item.en+(degrees?`, 구성 도수 ${item.degrees}`:''));
      if(guidePreview && item===answer) b.dataset.answer='1';
      b.addEventListener('click', ()=>check(item, answer, b));
      earChoices.appendChild(b);
    });
  }

  function check(picked, answer, el){
    // 오답을 확인한 뒤에는 선택지를 같은 루트로 자유롭게 비교한다.
    // 채점과 기록은 첫 선택에서만 일어난다.
    if(answered){
      if(reviewingWrong) playAnswer(picked);
      return;
    }
    answered=true;
    total++;
    const correct=picked===answer;
    if(correct){
      earChoices.querySelectorAll('.choice-row').forEach(b=>b.disabled=true);
      score++; streak++;
      el.classList.add('correct');
      earFeedback.textContent='정답';
      earFeedback.className='feedback-msg ok';
    } else {
      reviewingWrong=true;
      streak=0;
      el.classList.add('wrong');
      earFeedback.textContent='오답';
      earFeedback.className='feedback-msg no';
      earPrompt.textContent='선택지를 눌러 비교 · 올리브로 다음 문제';
      earPlayBtn.setAttribute('aria-label','다음 문제');
      Array.from(earChoices.children).forEach(b=>{
        if(b.querySelector('.ko').textContent===answer.ko) b.classList.add('correct');
      });
      playAnswer(picked);
    }
    renderStats();
    noteItemResult(answer,picked,correct);
    recordEarResult(correct);
    if(correct) nextTimer=setTimeout(()=>newQuestion(true), 1500);
  }

  /* ---------- 재생 ---------- */
  function playAnswer(answer, flashButton=false){
    if(!current) return;
    /* 앞 문제가 아직 울리는 중에 '다시 듣기'를 누르면 두 소리가 겹치거나, 잘려서
       '툭' 튄다. 자르지 말고 짧게 줄여서 끈다 — 새 음의 어택과 겹쳐 이어진다.
       지판의 글리산도처럼 겹쳐야 뜻이 있는 곳에서는 부르지 않는다. */
    if(typeof stopVoices==='function') stopVoices();
    let playback;
    try{
      playback=beginForegroundPlaybackFromGesture();
      playback.ready.catch(()=>{});
    }catch(error){ return; }
    const ctx=playback.ctx;
    const {root}=current;
    if(flashButton){
      earPlayBtn.classList.add('playing');
      clearTimeout(playFlash);               // 연타하면 앞 타이머가 먼저 꺼버렸다
      playFlash=setTimeout(()=>earPlayBtn.classList.remove('playing'), 900);
    }
    /* 갓 깨어난 컨텍스트는 state가 'running'이 된 뒤에도 시계가 0에 멈춰 있다. playTone은
       currentTime에 바로 얹으므로 그 사이에 잡으면 오디오 유닛이 열리는 순간 이미 지나간
       시각이 되어 통째로 사라진다. 튜너 현음·잼 코드를 고친 것과 같은 자리다. */
    whenClockAwake(ctx,()=>{
      if(mode==='interval'){
        playTone(midiToFreq(root), 0.5, 0, 'triangle', 0.98, ctx);
        playTone(midiToFreq(root+answer.semis), 0.5, 0.6, 'triangle', 0.98, ctx);
      } else if(mode==='chord'){
        // 아르페지오 후 동시 울림 — 구성음이 잘 들리도록
        answer.iv.forEach((iv,i)=> playTone(midiToFreq(root+iv), 0.36, i*0.17, 'triangle', 0.64, ctx));
        const after = answer.iv.length*0.17 + 0.12;
        answer.iv.forEach(iv=> playTone(midiToFreq(root+iv), 1.1, after, 'sine', 0.44, ctx));
      } else {
        answer.iv.forEach((iv,i)=> playTone(midiToFreq(root+iv), 0.3, i*0.23, 'triangle', 0.84, ctx));
      }
    });
  }
  function playCurrent(){
    if(!current) return;
    playAnswer(current.answer,true);
  }
  // 다음 문제가 예약돼 있는 동안도 '소리 낼 예정'인 상태다.
  // 화면이 꺼질 때 같이 세우지 않으면 세션 밖에서 울린다.
  registerTransport({
    isPlaying: ()=> nextTimer !== null,
    stop: ()=>{
      const wasWaiting=nextTimer !== null;
      clearTimeout(nextTimer); nextTimer=null;
      // 정답 직후 튜너로 갔다 돌아와도 비활성화된 보기에 갇히지 않게
      // 소리는 재생하지 않고 다음 문제만 준비한다.
      if(wasWaiting) newQuestion(false);
    }
  });

  earPlayBtn.addEventListener('click', ()=>{
    if(reviewingWrong) newQuestion(true);
    else playCurrent();
  });
  earReplay.addEventListener('click', playCurrent);

  renderStats();
  notifyHistoryChanged();
  newQuestion(false);
})();

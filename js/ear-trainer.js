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

  let mode = 'interval', level = 1;
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
  const earHistory  = document.getElementById('earHistory');
  const earMonthLabel = document.getElementById('earMonthLabel');
  const earMonthPrev = document.getElementById('earMonthPrev');
  const earMonthNext = document.getElementById('earMonthNext');
  const earCalendarGrid = document.getElementById('earCalendarGrid');
  const earDayDetail = document.getElementById('earDayDetail');

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
  const now = new Date();
  let historyMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let selectedHistoryKey = '';

  function dateKey(date){
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,'0');
    const d=String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  function saveEarHistory(){
    try{ localStorage.setItem(activeEarHistoryKey, JSON.stringify(earHistoryData)); }catch(e){}
  }
  function dayLabel(y,m,d){
    return `${y}년 ${m+1}월 ${d}일`;
  }
  function showEarDay(key, y, m, d){
    selectedHistoryKey=key;
    const rec=earHistoryData[key];
    if(rec && rec.total){
      const acc=Math.round(rec.correct/rec.total*100);
      const classified=EAR_HISTORY_MODES.reduce((sum,item)=>{
        const part=rec.byMode&&rec.byMode[item.key];
        return {correct:sum.correct+(part&&part.correct||0),total:sum.total+(part&&part.total||0)};
      },{correct:0,total:0});
      const legacy={
        correct:Math.max(0,rec.correct-classified.correct),
        total:Math.max(0,rec.total-classified.total),
      };
      const breakdown=EAR_HISTORY_MODES.map(item=>{
        const part=rec.byMode&&rec.byMode[item.key] || {correct:0,total:0};
        return `<span><b>${item.label}</b>${part.total?`${part.correct}/${part.total}`:'—'}</span>`;
      }).join('');
      earDayDetail.innerHTML=
        `<span class="ear-day-total">${m+1}월 ${d}일 · 전체 ${rec.correct}/${rec.total} 정답 · ${acc}%</span>`+
        `<span class="ear-day-breakdown">${breakdown}</span>`+
        (legacy.total?`<small class="ear-day-legacy">구분 전 기록 ${legacy.correct}/${legacy.total}</small>`:'');
      const detail=EAR_HISTORY_MODES.map(item=>{
        const part=rec.byMode&&rec.byMode[item.key] || {correct:0,total:0};
        return `${item.label} ${part.total?`${part.total}문제 중 ${part.correct}개 정답`:'기록 없음'}`;
      });
      if(legacy.total) detail.push(`구분 전 기록 ${legacy.total}문제 중 ${legacy.correct}개 정답`);
      earDayDetail.setAttribute('aria-label',
        `${m+1}월 ${d}일, 전체 ${rec.total}문제 중 ${rec.correct}개 정답, ${detail.join(', ')}`);
    }else{
      earDayDetail.textContent=`${m+1}월 ${d}일 · 기록 없음`;
      earDayDetail.removeAttribute('aria-label');
    }
    earCalendarGrid.querySelectorAll('.ear-day').forEach(b=>
      b.classList.toggle('selected', b.dataset.date===key));
  }
  function renderEarCalendar(){
    const y=historyMonth.getFullYear(), m=historyMonth.getMonth();
    const today=new Date();
    const currentMonth=new Date(today.getFullYear(), today.getMonth(), 1);
    earMonthLabel.textContent=`${y}년 ${m+1}월`;
    earMonthNext.disabled=historyMonth>=currentMonth;
    earCalendarGrid.innerHTML='';

    const firstDay=new Date(y,m,1).getDay();
    const days=new Date(y,m+1,0).getDate();
    for(let i=0;i<firstDay;i++){
      const blank=document.createElement('span');
      blank.className='ear-day-empty';
      blank.setAttribute('aria-hidden','true');
      earCalendarGrid.appendChild(blank);
    }

    for(let d=1;d<=days;d++){
      const date=new Date(y,m,d);
      const key=dateKey(date);
      const rec=earHistoryData[key];
      const b=document.createElement('button');
      b.type='button';
      b.className='ear-day'+(rec&&rec.total?' has-record':'');
      b.dataset.date=key;
      if(key===dateKey(today)) b.classList.add('today');
      if(key===selectedHistoryKey) b.classList.add('selected');
      const scoreText=rec&&rec.total ? `${rec.correct}/${rec.total}` : '';
      b.innerHTML=`<span class="d">${d}</span><span class="s">${scoreText}</span>`;
      b.setAttribute('aria-label', rec&&rec.total
        ? `${dayLabel(y,m,d)}, ${rec.total}문제 중 ${rec.correct}개 정답`
        : `${dayLabel(y,m,d)}, 기록 없음`);
      b.addEventListener('click', ()=>showEarDay(key,y,m,d));
      earCalendarGrid.appendChild(b);
    }

    const selected=selectedHistoryKey && selectedHistoryKey.startsWith(
      `${y}-${String(m+1).padStart(2,'0')}-`);
    if(selected){
      // 선택된 날짜의 점수도 답변 직후 다시 계산해 하단 설명에 즉시 반영한다.
      showEarDay(selectedHistoryKey,y,m,Number(selectedHistoryKey.slice(-2)));
    }else{
      const todayKey=dateKey(today);
      if(y===today.getFullYear() && m===today.getMonth()){
        showEarDay(todayKey,y,m,today.getDate());
      }else{
        selectedHistoryKey='';
        earDayDetail.textContent='날짜를 누르면 기록을 볼 수 있습니다';
        earDayDetail.removeAttribute('aria-label');
      }
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
    renderEarCalendar();
    if(window.OliveCloud) window.OliveCloud.recordAnswer(key,correct,mode);
  }
  earMonthPrev.addEventListener('click', ()=>{
    historyMonth=new Date(historyMonth.getFullYear(),historyMonth.getMonth()-1,1);
    selectedHistoryKey='';
    renderEarCalendar();
  });
  earMonthNext.addEventListener('click', ()=>{
    if(earMonthNext.disabled) return;
    historyMonth=new Date(historyMonth.getFullYear(),historyMonth.getMonth()+1,1);
    selectedHistoryKey='';
    renderEarCalendar();
  });
  earHistory.addEventListener('toggle', ()=>{ if(earHistory.open) renderEarCalendar(); });
  if(window.OliveCloud){
    window.OliveCloud.init({
      getAnonymousHistory:()=>loadEarHistory(EAR_HISTORY_KEY),
      clearAnonymousHistory:()=>{
        try{ localStorage.removeItem(EAR_HISTORY_KEY); }catch(e){}
      },
      useUserHistory:(userId,history)=>{
        activeEarHistoryKey=EAR_USER_HISTORY_PREFIX+userId;
        earHistoryData=history && typeof history==='object' ? history : {};
        saveEarHistory();
        renderEarCalendar();
      },
      useAnonymousHistory:()=>{
        activeEarHistoryKey=EAR_HISTORY_KEY;
        earHistoryData=loadEarHistory(EAR_HISTORY_KEY);
        renderEarCalendar();
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

  window.OlivePreferences.register('earTrainer',
    ()=>({mode,level}),
    value=>{
      if(!value || typeof value!=='object') return;
      if(MODES.some(item=>item.key===value.mode)) mode=value.mode;
      const nextLevel=Math.round(Number(value.level));
      if(LEVELS.some(item=>item.key===nextLevel)) level=nextLevel;
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

  /* ---------- 문제 ---------- */
  function newQuestion(autoPlay){
    clearTimeout(nextTimer); nextTimer=null;
    answered=false;
    reviewingWrong=false;
    earFeedback.textContent='';
    earFeedback.className='feedback-msg';
    earPrompt.textContent='소리를 듣고 정답을 선택하세요';
    earPlayBtn.setAttribute('aria-label','문제 듣기');

    const pool = bank();
    const answer = pool[Math.floor(Math.random()*pool.length)];
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
    recordEarResult(correct);
    if(correct) nextTimer=setTimeout(()=>newQuestion(true), 1500);
  }

  /* ---------- 재생 ---------- */
  function playAnswer(answer, flashButton=false){
    if(!current) return;
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
  renderEarCalendar();
  newQuestion(false);
})();

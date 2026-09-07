/* ===================== 메트로놈 ===================== */
(function(){
  const BPM_DEFAULT = 90;
  let bpm = BPM_DEFAULT, accentOn = true;

  /* ---------- 박자 ----------
     겹박자는 묶음 첫 박에 중간 세기를 준다. 그래야 6/8이 3/4와 다르게 들린다.
     groups의 합이 한 마디의 박 수다. */
  const METERS = [
    {label:'2/4',  beats:2,  groups:[2]},
    {label:'3/4',  beats:3,  groups:[3]},
    {label:'4/4',  beats:4,  groups:[4]},
    {label:'5/4',  beats:5,  groups:[3,2]},
    {label:'6/8',  beats:6,  groups:[3,3]},
    {label:'7/8',  beats:7,  groups:[2,2,3]},
    {label:'9/8',  beats:9,  groups:[3,3,3]},
    {label:'12/8', beats:12, groups:[3,3,3,3]},
  ];
  let meter = METERS[2];                     // 4/4
  let midBeats = new Set();                  // 중간 강세가 붙는 박
  function computeGroups(){
    midBeats = new Set(); let at = 0;
    meter.groups.forEach((g,i)=>{ if(i>0) midBeats.add(at); at += g; });
  }

  /* ---------- 세분화 ----------
     한 박을 div로 쪼개고 hits 자리에서만 소리를 낸다.
     균등 분할(8분·3연음·16분)과 불균등(셔플·점8분+16분)을 같은 틀로 다룬다. */
  const SUBS = [
    {key:'q',   div:1, hits:[0],       name:'4분음표'},
    {key:'e',   div:2, hits:[0,1],     name:'8분음표'},
    {key:'t',   div:3, hits:[0,1,2],   name:'3연음'},
    {key:'sh',  div:3, hits:[0,2],     name:'셔플'},
    {key:'s',   div:4, hits:[0,1,2,3], name:'16분음표'},
    {key:'ds',  div:4, hits:[0,3],     name:'점8분+16분'},
    {key:'es',  div:4, hits:[0,2,3],   name:'8분+16분2'},
    {key:'se',  div:4, hits:[0,1,2],   name:'16분2+8분'},
  ];
  let sub = SUBS[0];
  let isPlaying = false;
  let startPending = false, startToken = 0, metroCtx = null, metroOutput = null;
  let currentStep = 0, nextNoteTime = 0.0, timerID = null;
  let rollBeat = 0;
  const scheduleAheadTime = 0.12, backgroundScheduleAheadTime = 2.5, lookahead = 25;
  let scheduledBeats = [];

  const bpmNum = document.getElementById('bpmNum');
  const beatDotsEl = document.getElementById('beatDots');
  const metroStart = document.getElementById('metroStart');
  const orbLabel   = document.getElementById('orbLabel');

  function releaseMetroOutput(){
    if(!metroOutput) return;
    try{ metroOutput.gain.value=0; }catch(e){}
    try{ metroOutput.disconnect(); }catch(e){}
    metroOutput=null;
  }
  function createMetroOutput(ctx){
    releaseMetroOutput();
    metroOutput=ctx.createGain();
    metroOutput.connect(getMaster(ctx));
  }

  /* ---------- 오브 안 올리브 ----------
     올리브가 오브 안쪽 곡면을 따라 좌우로 굴러간다.
     한쪽 끝에서 반대쪽까지 딱 한 박이 걸리므로, 끝에 닿는 순간이 곧 소리가 나는 순간이다.
     진자와 같은 사인 감속을 써서 양끝에서 느려진다 — 실제 메트로놈도 끝점에서 소리가 난다.
     위치를 프레임 수가 아니라 오디오 시계에서 뽑으므로 프레임이 밀려도 어긋나지 않는다. */
  const mdOlive = document.getElementById('mdOlive');
  const OLIVE = { rx:9.6, ry:7.9, track:45.4, a0:148, a1:32 };
  let rollRight = false;
  let beatAt = 0, beatSpan = 0.6;

  function drawRoll(p){
    p = p<0 ? 0 : p>1 ? 1 : p;
    const e = (1 - Math.cos(Math.PI*p))/2;          // 양끝에서 느려진다
    const t = rollRight ? e : 1-e;
    const phi = OLIVE.a0 + t*(OLIVE.a1-OLIVE.a0);

    // 미끄러지지 않고 구른다. 원 안쪽을 도는 경우의 자전량이다.
    const r    = (OLIVE.rx+OLIVE.ry)/2;
    const spin = (OLIVE.a0-phi) * (OLIVE.track-r)/r;

    // 타원이라 자전하는 동안 중심 높이가 오르내린다 — 그 흔들림이 리듬처럼 보인다
    const th  = spin*Math.PI/180;
    const wob = Math.hypot(OLIVE.rx*Math.sin(th), OLIVE.ry*Math.cos(th));

    // 여기는 박자를 보는 곳이라 튀는 움직임이 오히려 방해가 된다.
    // 통통거림은 튜너에만 두고, 메트로놈에서는 매끄럽게 굴린다.
    const rad = OLIVE.track - wob;
    const f   = phi*Math.PI/180;
    const x   = 50 + rad*Math.cos(f);
    const y   = 50 + rad*Math.sin(f);
    mdOlive.setAttribute('transform',
      `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${spin.toFixed(1)})`);
  }
  function parkOlive(){ const k=rollRight; rollRight=true; drawRoll(0); rollRight=k; }
  parkOlive();

  function renderDots(){
    beatDotsEl.innerHTML = '';
    let i = 0;
    meter.groups.forEach(g=>{
      const wrap = document.createElement('div');
      wrap.className = 'dot-group';
      for(let k=0; k<g; k++, i++){
        const d = document.createElement('div');
        d.className = 'beat-dot';
        d.dataset.idx = i;
        wrap.appendChild(d);
      }
      beatDotsEl.appendChild(wrap);
    });
  }
  renderDots();

  function updateBpmUI(){ bpmNum.textContent = bpm; }
  function setBpm(v){
    if(!Number.isFinite(Number(v))) return;
    bpm = Math.max(30, Math.min(260, Math.round(v)));
    updateBpmUI();
    window.OlivePreferences.changed();
  }

  bindTempoKeys(document.getElementById('bpmMinus'),
                document.getElementById('bpmPlus'),
                ()=>bpm, setBpm);
  bindResetOnDouble(bpmNum, ()=>setBpm(BPM_DEFAULT));

  bindTapTempo(document.getElementById('tapTempoBtn'), setBpm);

  /* ---------- 음표 그림 ----------
     글자 대신 실제 악보 기호를 그린다. {div, hits}만 주면
     음표 길이·빔·점·잇단음표 괄호가 따라 나오므로 패턴을 늘려도 그림이 저절로 맞는다. */
  function noteGlyph(div, hits){
    const W=46, H=28, LEFT=6, SPAN=32;
    const yHead=20, yStemTop=6.5, yBeam=5.6, yBeam2=9.2;
    const x = slot => LEFT + (slot/div)*SPAN;
    // 각 음표의 길이(칸 수)로 빔 개수와 점을 정한다
    const notes = hits.map((h,i)=>{
      const dur = (i+1<hits.length ? hits[i+1] : div) - h;
      let beams = 0, dot = false;
      if(div===2 && dur===1) beams=1;
      else if(div===3){ beams = dur===1 ? 1 : 0; }
      else if(div===4){ beams = dur===1 ? 2 : 1; dot = dur===3; }
      return {slot:h, dur, beams, dot, cx:x(h), sx:x(h)+3.2};
    });
    const beamed = notes.filter(n=>n.beams>0);
    const g=[];
    // 잇단음표 괄호
    if(div===3){
      const a=notes[0].sx, b=notes[notes.length-1].sx;
      const mid=(a+b)/2;
      g.push(`<path d="M${a} 4.2 V1.8 H${mid-3.4} M${mid+3.4} 1.8 H${b} V4.2" `+
             `fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>`);
      g.push(`<text x="${mid}" y="4.1" font-size="7.4" font-style="italic" text-anchor="middle" `+
             `fill="currentColor" font-family="Georgia,serif">3</text>`);
    }
    notes.forEach((n,i)=>{
      g.push(`<ellipse cx="${n.cx}" cy="${yHead}" rx="3.6" ry="2.7" `+
             `transform="rotate(-20 ${n.cx} ${yHead})" fill="currentColor"/>`);
      g.push(`<rect x="${n.sx-0.55}" y="${yStemTop}" width="1.1" height="${yHead-1.2-yStemTop}" fill="currentColor"/>`);
      if(n.dot) g.push(`<circle cx="${n.cx+6.6}" cy="${yHead}" r="1" fill="currentColor"/>`);
    });
    // 빔: 이어진 음표끼리 묶고, 혼자면 깃발을 단다
    if(beamed.length>=2){
      const a=beamed[0].sx-0.55, b=beamed[beamed.length-1].sx+0.55;
      g.push(`<rect x="${a}" y="${yBeam}" width="${b-a}" height="2.5" fill="currentColor"/>`);
      // 두 번째 빔은 16분음표가 이어진 구간에만
      let run=[];
      const flush=()=>{
        if(run.length>=2){
          const p=run[0].sx-0.55, q=run[run.length-1].sx+0.55;
          g.push(`<rect x="${p}" y="${yBeam2}" width="${q-p}" height="2.2" fill="currentColor"/>`);
        } else if(run.length===1){                      // 외톨이 16분음표는 반쪽 빔
          const n=run[0], idx=beamed.indexOf(n);
          const back = idx>0;
          const p = back ? n.sx-4.6 : n.sx-0.55;
          g.push(`<rect x="${p}" y="${yBeam2}" width="5.2" height="2.2" fill="currentColor"/>`);
        }
        run=[];
      };
      beamed.forEach(n=>{ if(n.beams>=2) run.push(n); else flush(); });
      flush();
    } else if(beamed.length===1){
      const n=beamed[0];
      g.push(`<path d="M${n.sx+0.55} ${yStemTop} c 3.6 1.6 4.2 4 2.4 6.6 c 1-3-0.4-4.2-2.4-5.2 Z" fill="currentColor"/>`);
    }
    // 그린 것의 실제 좌우 끝을 재서 가운데로 옮긴다.
    // 4분음표처럼 음표가 하나뿐일 때 왼쪽으로 치우치던 것을 막는다.
    let minX = notes[0].cx - 3.6;
    let maxX = notes[notes.length-1].sx + 0.55;
    const last = notes[notes.length-1];
    if(last.dot) maxX = Math.max(maxX, last.cx + 7.6);
    if(beamed.length===1) maxX = Math.max(maxX, beamed[0].sx + 3.6);   // 깃발
    const dx = (W - (minX + maxX)) / 2;
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">`+
           `<g transform="translate(${dx.toFixed(2)} 0)">${g.join('')}</g></svg>`;
  }

  /* ---------- 박자 · 세분화 버튼 ---------- */
  const subdivGroup = document.getElementById('subdivGroup');
  const meterDD = makeSplitDropdown(
    document.getElementById('beatsSelect'),
    METERS.map(m=>({ main:m.label, sub: m.groups.length>1 ? m.groups.join('+') : '' })),
    METERS.indexOf(meter),
    i=>{
      meter=METERS[i]; computeGroups(); renderDots();
      window.OlivePreferences.changed();
    }
  );
  SUBS.forEach(v=>{
    const b=document.createElement('button');
    b.className='note-btn'+(v===sub?' active':'');
    b.innerHTML=noteGlyph(v.div, v.hits);
    b.setAttribute('aria-label', v.name);
    b.title=v.name;
    b.addEventListener('click', ()=>{
      sub=v;
      subdivGroup.querySelectorAll('.note-btn').forEach(x=>x.classList.toggle('active', x===b));
      window.OlivePreferences.changed();
    });
    subdivGroup.appendChild(b);
  });
  computeGroups();
  const accentToggle=document.getElementById('accentToggle');
  accentToggle.addEventListener('click', (e)=>{
    accentOn = !accentOn;
    e.target.textContent = accentOn?'ON':'OFF';
    e.target.classList.toggle('active', accentOn);
    window.OlivePreferences.changed();
  });

  function scheduleNote(step, time){
    const pos = step % sub.div;
    const isBeatStart = pos === 0;
    const beatIndex = Math.floor(step/sub.div) % meter.beats;
    // 0 약 · 1 중(묶음 첫 박) · 2 강(마디 첫 박)
    const level = !isBeatStart || !accentOn ? 0
                : beatIndex === 0 ? 2
                : midBeats.has(beatIndex) ? 1 : 0;
    if(sub.hits.indexOf(pos) >= 0)
      playClick(time - metroCtx.currentTime, level, metroCtx, metroOutput);
    scheduledBeats.push({step, time, isBeatStart, beatIndex, level});
  }
  function advanceNote(){
    const secondsPerBeat = 60.0/bpm;
    nextNoteTime += secondsPerBeat/sub.div;
    currentStep = (currentStep+1) % (meter.beats*sub.div);
  }
  function scheduler(){
    const ctx = metroCtx;
    if(!isPlaying || !ctx || ctx!==audioCtx){
      stopMetro('재시도');
      return;
    }
    if(isBackgroundMediaPaused()){
      timerID=setTimeout(scheduler,250);
      return;
    }
    if(ctx.state!=='running'){
      if(document.visibilityState!=='visible'){
        timerID=setTimeout(scheduler,250);
        return;
      }
      stopMetro('재시도');
      return;
    }
    // 밀린 시간만 버리고 박 위치는 그대로 둔다.
    // currentStep을 0으로 되돌리면 보정이 반복될 때마다 첫박 강세만 울린다.
    if(nextNoteTime < ctx.currentTime - 0.25){
      nextNoteTime = ctx.currentTime + 0.05;
      scheduledBeats.length = 0;
    }
    if(document.visibilityState!=='visible'){
      while(scheduledBeats.length && scheduledBeats[0].time < ctx.currentTime-0.25){
        scheduledBeats.shift();
      }
    }
    const ahead=document.visibilityState==='visible' ? scheduleAheadTime : backgroundScheduleAheadTime;
    while(nextNoteTime < ctx.currentTime + ahead){
      scheduleNote(currentStep, nextNoteTime);
      advanceNote();
    }
    if(isPlaying) timerID = setTimeout(scheduler,
      document.visibilityState==='visible' ? lookahead : 250);
  }
  let visualGen = 0;
  function visualLoop(gen){
    if(!isPlaying || gen !== visualGen) return;   // 예전 루프는 여기서 끝난다
    const ctx = metroCtx;
    if(isBackgroundMediaPaused()){
      requestAnimationFrame(()=>visualLoop(gen));
      return;
    }
    if(!ctx || ctx!==audioCtx || ctx.state!=='running'){
      stopMetro('재시도');
      return;
    }
    const now = ctx.currentTime;
    while(scheduledBeats.length && scheduledBeats[0].time <= now){
      const b = scheduledBeats.shift();
      if(b.isBeatStart){
        // 너무 빠르면 눈이 못 따라간다. 두 박에 한 번씩 굴린다.
        const spb = 60/bpm;
        const perRally = spb < 0.36 ? 2 : 1;
        if(rollBeat % perRally === 0){
          rollRight = !rollRight;
          beatAt = b.time;
          beatSpan = spb * perRally;
        }
        rollBeat++;
        metroStart.classList.remove('flash');
        void metroStart.offsetWidth;      // 애니메이션 재시작
        metroStart.classList.add('flash');
        pulseTab('metronome');
        const dots = beatDotsEl.querySelectorAll('.beat-dot');
        dots.forEach(d=>d.classList.remove('on','mid-on','accent-on'));
        if(dots[b.beatIndex])
          dots[b.beatIndex].classList.add(b.level===2?'accent-on':b.level===1?'mid-on':'on');
      }
    }
    if(beatSpan>0) drawRoll((now-beatAt)/beatSpan);
    requestAnimationFrame(()=>visualLoop(gen));
  }

  async function startMetro(){
    if(isPlaying || startPending) return;
    const token=++startToken;
    startPending=true;
    orbLabel.textContent='시작 중';
    metroStart.classList.add('starting');
    metroStart.setAttribute('aria-busy','true');
    try{
      const ctx=await ensureBackgroundPlaybackCtx('메트로놈');
      if(token!==startToken || !startPending){
        if(audioCtx===ctx && !anySounding()) releaseCtx();
        return;
      }
      if(document.visibilityState!=='visible') throw new Error('PageNotVisible');
      metroCtx=ctx;
      createMetroOutput(ctx);
      isPlaying=true;
      currentStep=0;
      rollBeat=0;
      scheduledBeats=[];
      nextNoteTime=ctx.currentTime+0.05;
      orbLabel.textContent='정지';
      metroStart.classList.remove('starting');
      metroStart.classList.remove('media-paused');
      metroStart.classList.add('running');
      metroStart.setAttribute('aria-busy','false');
      setTabSounding('metronome',true);
      scheduler();
      visualLoop(++visualGen);
    }catch(error){
      if(token!==startToken) return;
      startPending=false;
      metroCtx=null;
      releaseMetroOutput();
      orbLabel.textContent='재시도';
      metroStart.classList.remove('starting','running','flash');
      metroStart.setAttribute('aria-busy','false');
      setTabSounding('metronome',false);
      releaseCtx();
    }finally{
      if(token===startToken) startPending=false;
    }
  }
  function stopMetro(label='시작'){
    if(!isPlaying && !startPending) return;
    startToken++;
    startPending=false;
    isPlaying=false;
    // 백그라운드에서 미리 예약해 둔 클릭음도 이 출력 버스를 끊는 순간
    // 바로 무음이 된다. 다른 반주가 같은 AudioContext를 써도 영향을 주지 않는다.
    releaseMetroOutput();
    metroCtx=null;
    clearTimeout(timerID);
    orbLabel.textContent=label;
    metroStart.classList.remove('starting','running','flash','media-paused');
    metroStart.setAttribute('aria-busy','false');
    rollRight = false; parkOlive();    // 왼쪽 끝에 멈춰 쉰다
    setTabSounding('metronome', false);
    beatDotsEl.querySelectorAll('.beat-dot').forEach(d=>d.classList.remove('on','mid-on','accent-on'));
  }
  function setMediaPaused(paused){
    if(!isPlaying) return;
    metroStart.classList.toggle('media-paused',paused);
    metroStart.classList.toggle('running',!paused);
    metroStart.classList.remove('flash');
    orbLabel.textContent=paused?'재생':'정지';
    clearTimeout(timerID);
    if(paused){
      // 잠금 전에 예약해 둔 클릭음을 출력에서 떼어 재개 때 겹치지 않게 한다.
      releaseMetroOutput();
      scheduledBeats=[];
      beatDotsEl.querySelectorAll('.beat-dot')
        .forEach(d=>d.classList.remove('on','mid-on','accent-on'));
      rollRight=false; parkOlive();
      return;
    }
    if(!metroCtx || metroCtx!==audioCtx || metroCtx.state!=='running') return;
    createMetroOutput(metroCtx);
    currentStep=0;
    rollBeat=0;
    scheduledBeats=[];
    nextNoteTime=metroCtx.currentTime+0.05;
    scheduler();
  }
  metroStart.addEventListener('click', ()=>{
    if((isPlaying || startPending) && isBackgroundMediaPaused()){
      resumeBackgroundPlayback().catch(()=>{});
      return;
    }
    (isPlaying || startPending) ? stopMetro() : startMetro();
  });
  registerTransport({
    isPlaying:()=>isPlaying || startPending,
    stop:stopMetro,
    setPaused:setMediaPaused,
    setContext:ctx=>{ metroCtx=ctx; },
    background:true,
    label:'메트로놈',
  });

  document.addEventListener('visibilitychange',()=>{
    if(!isPlaying || document.visibilityState==='visible') return;
    clearTimeout(timerID);
    scheduler();
  });

  window.OlivePreferences.register('metronome',
    ()=>({bpm,meter:meter.label,subdivision:sub.key,accent:accentOn}),
    value=>{
      if(!value || typeof value!=='object') return;
      setBpm(value.bpm);
      const meterIndex=METERS.findIndex(item=>item.label===value.meter);
      if(meterIndex>=0){
        meter=METERS[meterIndex]; meterDD.set(meterIndex);
        computeGroups(); renderDots();
      }
      const subIndex=SUBS.findIndex(item=>item.key===value.subdivision);
      if(subIndex>=0){
        sub=SUBS[subIndex];
        subdivGroup.querySelectorAll('.note-btn')
          .forEach((button,index)=>button.classList.toggle('active',index===subIndex));
      }
      accentOn=value.accent!==false;
      accentToggle.textContent=accentOn?'ON':'OFF';
      accentToggle.classList.toggle('active',accentOn);
    }
  );
  updateBpmUI();
  window.__metronome = { getBpm:()=>bpm };
})();

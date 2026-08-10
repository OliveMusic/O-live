/* ===================== 리듬 =====================
   채점이 아니라 '반복 재생'이 목적이다.
   설정한 리듬을 정확한 타이밍으로 끊김 없이 루프한다.
   ================================================= */
(function(){
  const beatGrid   = document.getElementById('beatGrid');
  const rhySigEl   = document.getElementById('rhySig');
  const RHY_SIGS   = [{b:4,label:'4/4'},{b:3,label:'3/4'},{b:2,label:'2/4'},{b:6,label:'6/8'}];
  const sigIndex   = b => Math.max(0, RHY_SIGS.findIndex(x=>x.b===b));
  let rhySigDD = null;
  const rhySynco   = document.getElementById('rhySynco');
  const rhyDiff    = document.getElementById('rhyDiff');
  const rhySyncoVal= document.getElementById('rhySyncoVal');
  const rhyDiffVal = document.getElementById('rhyDiffVal');
  const rhyGen     = document.getElementById('rhyGen');
  const rhyClear   = document.getElementById('rhyClear');
  const rhyPlay    = document.getElementById('rhyPlay');
  const rhyBpm     = document.getElementById('rhyBpm');
  const rhyBpmVal  = document.getElementById('rhyBpmVal');
  const rhyTap     = document.getElementById('rhyTap');
  const rhyToggles = document.getElementById('rhyToggles');
  const rhyPresets = document.getElementById('rhyPresets');

  let opts={metro:true, drum:true, swing:false, accent:true};
  [['metro','메트로놈'],['drum','드럼'],['swing','스윙'],['accent','첫박 강세']].forEach(([k,label])=>{
    const b=document.createElement('button');
    b.className='pill'+(opts[k]?' active':'');
    b.textContent=label; b.dataset.option=k;
    b.addEventListener('click', ()=>{
      opts[k]=!opts[k]; b.classList.toggle('active', opts[k]);
      window.OlivePreferences.changed();
    });
    rhyToggles.appendChild(b);
  });

  /* ---------- 자주 쓰는 기타 스트로크 패턴 ---------- */
  const PRESETS = {
    down8:   {label:'8비트',       beats:4, p:[1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]},
    rock:    {label:'기본 락',     beats:4, p:[1,0,0,0, 1,0,1,0, 0,0,1,0, 1,0,1,0]},
    folk:    {label:'포크 스트럼', beats:4, p:[1,0,1,0, 0,0,1,0, 1,0,1,0, 0,0,1,0]},
    shuffle: {label:'셔플',        beats:4, p:[1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1]},
    bossa:   {label:'보사노바',    beats:4, p:[1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1]},
    reggae:  {label:'레게',        beats:4, p:[0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]},
    waltz:   {label:'왈츠',        beats:3, p:[1,0,0,0, 1,0,0,0, 1,0,0,0]},
  };

  let pattern=[], beats=4;

  /* ---------- 생성 ---------- */
  function generate(){
    const synco=parseInt(rhySynco.value)/10;
    const dens =parseInt(rhyDiff.value)/10;
    const steps=beats*4;
    const p=new Array(steps).fill(0);
    for(let i=0;i<steps;i++){
      const pos=i%4;
      let prob;
      if(pos===0)      prob=0.90-synco*0.30;
      else if(pos===2) prob=0.28+synco*0.45;
      else             prob=(0.05+synco*0.30)*(0.30+dens*0.95);
      if(pos%2===1 && dens<0.25) prob*=0.25;
      prob *= (0.55+dens*0.75);
      p[i]=Math.random()<prob?1:0;
    }
    p[0]=1;
    if(p.reduce((a,b)=>a+b,0)<3){ p[Math.floor(steps/2)]=1; p[steps-2]=1; }
    setPattern(p, beats);
  }

  function setPattern(p, b){
    pattern=p.slice(); beats=b;
    if(rhySigDD) rhySigDD.set(sigIndex(b));
    renderGrid();
    window.OlivePreferences.changed();
  }

  function renderGrid(){
    // 가로 한 줄 진행이 직관적이다. 잘리지 않도록 칸 크기를 폭에 맞춰 계산한다.
    beatGrid.innerHTML='';
    const row=document.createElement('div');
    row.className='grid-row';
    const steps=pattern.length;
    const w=beatGrid.clientWidth || 330;
    const gap=3;
    // 정박 동그라미는 1.32배로 커서 그만큼을 셈에 넣지 않으면 양끝이 잘린다.
    // 전체폭 = size*(일반칸 수) + 1.32*size*(정박 수) + 간격 + 좌우 여유
    const nBeat=Math.ceil(steps/4);
    const pad=6;
    // 최소값을 10으로 묶어 두면 6/8(24칸)에서 계산상 9.5가 나와도 10으로 올라가
    // 실제 폭을 넘겨 끝이 잘렸다. 들어갈 만큼 줄어들게 둔다.
    const size=Math.max(7, Math.min(30,
      Math.floor((w - pad - gap*(steps-1)) / (steps + 0.32*nBeat))));
    row.style.setProperty('--gc', size+'px');
    row.style.gap=gap+'px';
    pattern.forEach((on,i)=>{
      const isBeat=i%4===0;
      const c=document.createElement('div');
      c.className='gcell'+(isBeat?' beat':'')+(on?' on':'');
      c.dataset.i=i;
      if(isBeat){                             // 숫자는 칸 위쪽 바깥에
        const n=document.createElement('i'); n.className='bn'; n.textContent=i/4+1;
        c.appendChild(n);
      }
      c.addEventListener('click', ()=>{
        pattern[i]=pattern[i]?0:1;
        c.classList.toggle('on', !!pattern[i]);
        window.OlivePreferences.changed();
      });
      row.appendChild(c);
    });
    beatGrid.appendChild(row);
  }
  let __rsz=null;
  window.addEventListener('resize', ()=>{
    clearTimeout(__rsz);
    __rsz=setTimeout(()=>{ if(pattern.length) renderGrid(); }, 120);
  });
  // 트레이너 탭 또는 '리듬' 하위 모드로 들어올 때 폭을 다시 잰다
  const trainerTab=document.querySelector('.tab-btn[data-tab="trainer"]');
  if(trainerTab) trainerTab.addEventListener('click', ()=> setTimeout(renderGrid,0));

  Object.entries(PRESETS).forEach(([k,v])=>{
    const b=document.createElement('button');
    b.className='pill';
    b.textContent=v.label;
    b.addEventListener('click', ()=>{
      rhyPresets.querySelectorAll('.pill').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      setPattern(v.p.slice(), v.beats);
    });
    rhyPresets.appendChild(b);
  });

  rhySynco.addEventListener('input', ()=>{
    rhySyncoVal.textContent=rhySynco.value;
    window.OlivePreferences.changed();
  });
  rhyDiff.addEventListener('input', ()=>{
    rhyDiffVal.textContent=rhyDiff.value;
    window.OlivePreferences.changed();
  });
  rhyBpm.addEventListener('input', ()=>setRhyBpm(rhyBpm.value));
  rhyGen  .addEventListener('click', ()=>{ getCtx(); generate(); });
  rhyClear.addEventListener('click', ()=>{
    setPattern(new Array(beats*4).fill(0), beats);
  });
  rhySigDD = makeSplitDropdown(rhySigEl, RHY_SIGS.map(x=>({main:x.label,sub:''})), 0, i=>{
    const b=RHY_SIGS[i].b;
    setPattern(new Array(b*4).fill(0).map((_,k)=>k%4===0?1:0), b);
  });

  const RHY_BPM_DEFAULT = 90;
  function setRhyBpm(v){
    if(!Number.isFinite(Number(v))) return;
    const b=Math.max(40, Math.min(200, Math.round(v)));
    rhyBpm.value=b; rhyBpmVal.textContent=b;
    window.OlivePreferences.changed();
  }
  bindTempoKeys(document.getElementById('rhyMinus'),
                document.getElementById('rhyPlus'),
                ()=>parseInt(rhyBpm.value), setRhyBpm);
  bindTapTempo(rhyTap, setRhyBpm);
  bindResetOnDouble(rhyBpmVal, ()=>setRhyBpm(RHY_BPM_DEFAULT));

  /* ---------- 소리 ---------- */
  function kick(ctx,t){
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sine';
    o.frequency.setValueAtTime(155,t);
    o.frequency.exponentialRampToValueAtTime(48,t+0.10);
    g.gain.setValueAtTime(0.58,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.22);
    o.connect(g).connect(getMaster(ctx)); o.start(t); o.stop(t+0.24);
  }
  function snare(ctx,t){
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='triangle'; o.frequency.setValueAtTime(240,t);
    g.gain.setValueAtTime(0.46,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.10);
    o.connect(g).connect(getMaster(ctx)); o.start(t); o.stop(t+0.12);
    const o2=ctx.createOscillator(), g2=ctx.createGain();
    o2.type='square'; o2.frequency.setValueAtTime(1750,t);
    g2.gain.setValueAtTime(0.14,t);
    g2.gain.exponentialRampToValueAtTime(0.0001,t+0.06);
    o2.connect(g2).connect(getMaster(ctx)); o2.start(t); o2.stop(t+0.07);
  }

  /* ---------- 루프 스케줄러 ----------
     setTimeout이 아니라 오디오 클럭에 예약한다.
     탭을 전환하거나 화면이 잠깐 멈춰도 박자가 밀리지 않는다.
  ----------------------------------- */
  let playing=false, startPending=false, startToken=0, rhythmCtx=null;
  let timerID=null, nextTime=0, cursor=0, marks=[];
  const AHEAD=0.16, TICK=25;

  function stepDur(){ return (60/parseInt(rhyBpm.value))/4; }
  function swingOff(i){ return (opts.swing && i%4===2) ? stepDur()*0.55 : 0; }

  function schedule(){
    const ctx=rhythmCtx;
    if(!playing || !ctx || ctx!==audioCtx || ctx.state!=='running'){
      stop();
      return;
    }
    const steps=pattern.length || 1;
    if(nextTime < ctx.currentTime - 0.25){      // 밀린 시간만 버리고 자리는 유지
      nextTime = ctx.currentTime + 0.05;
      marks.length = 0;
    }
    while(nextTime < ctx.currentTime + AHEAD){
      const i=cursor%steps;
      const when=nextTime+swingOff(i);
      const isBeat=i%4===0;
      const isFirst=i===0;

      if(opts.metro && isBeat) playClick(when-ctx.currentTime, opts.accent && isFirst, ctx);
      if(pattern[i] && opts.drum){
        isBeat ? kick(ctx,when) : snare(ctx,when);
      } else if(pattern[i] && !opts.drum){
        playClick(when-ctx.currentTime, opts.accent && isFirst, ctx);
      }
      marks.push({time:when, i});
      nextTime += stepDur();
      cursor++;
    }
    if(playing) timerID=setTimeout(schedule, TICK);
  }

  let visualGen=0, lastCursorEl=null;
  function visual(gen){
    if(!playing || gen!==visualGen) return;
    const ctx=rhythmCtx;
    if(!ctx || ctx!==audioCtx || ctx.state!=='running'){
      stop();
      return;
    }
    while(marks.length && marks[0].time <= ctx.currentTime){
      const m=marks.shift();
      // 매번 전체를 훑지 않고 직전 칸만 되돌린다
      if(lastCursorEl) lastCursorEl.classList.remove('cursor');
      const c=beatGrid.querySelector(`.gcell[data-i="${m.i}"]`);
      if(c) c.classList.add('cursor');
      lastCursorEl=c;
      if(m.i%4===0) pulseTab('trainer');
    }
    requestAnimationFrame(()=>visual(gen));
  }

  async function start(){
    if(playing || startPending) return;
    if(pattern.length===0) generate();
    const token=++startToken;
    startPending=true;
    rhyPlay.setAttribute('aria-label','시작 중');
    rhyPlay.setAttribute('aria-busy','true');
    try{
      const ctx=await ensureCtx('ambient');
      if(token!==startToken || !startPending){
        if(audioCtx===ctx && !anySounding()) releaseCtx();
        return;
      }
      rhythmCtx=ctx;
      playing=true;
      cursor=0; marks=[];
      nextTime=ctx.currentTime+0.06;
      rhyPlay.classList.add('on');
      rhyPlay.setAttribute('aria-label','정지');
      rhyPlay.setAttribute('aria-busy','false');
      rhyPlay.querySelector('svg').innerHTML='<rect x="7" y="6" width="3.6" height="12" rx="1.2"/><rect x="13.4" y="6" width="3.6" height="12" rx="1.2"/>';
      setTabSounding('trainer',true,'rhythm');
      schedule(); visual(++visualGen);
    }catch(error){
      if(token===startToken){
        stop();
        releaseCtx();
      }
    }finally{
      if(token===startToken) startPending=false;
    }
  }
  function stop(){
    if(!playing && !startPending) return;
    startToken++;
    startPending=false;
    playing=false;
    rhythmCtx=null;
    clearTimeout(timerID); marks=[]; lastCursorEl=null;
    rhyPlay.classList.remove('on');
    rhyPlay.setAttribute('aria-label','재생');
    rhyPlay.setAttribute('aria-busy','false');
    rhyPlay.querySelector('svg').innerHTML='<path d="M8 5.5v13l11-6.5z"/>';
    setTabSounding('trainer', false, 'rhythm');
    beatGrid.querySelectorAll('.gcell').forEach(c=>c.classList.remove('cursor'));
  }
  rhyPlay.addEventListener('click', ()=> (playing || startPending)?stop():start());
  registerTransport({ isPlaying:()=>playing || startPending, stop });

  // 초기 패턴: 기본 락
  setPattern(PRESETS.rock.p.slice(), 4);
  rhyPresets.querySelectorAll('.pill')[1].classList.add('active');
  window.OlivePreferences.register('rhythmTrainer',
    ()=>({
      bpm:Number(rhyBpm.value),
      beats,
      pattern:pattern.slice(),
      options:{...opts},
      syncopation:Number(rhySynco.value),
      difficulty:Number(rhyDiff.value),
    }),
    value=>{
      if(!value || typeof value!=='object') return;
      setRhyBpm(value.bpm);
      const nextBeats=RHY_SIGS.some(item=>item.b===Number(value.beats)) ? Number(value.beats) : beats;
      const nextPattern=Array.isArray(value.pattern) && value.pattern.length===nextBeats*4
        ? value.pattern.map(item=>item?1:0) : pattern;
      setPattern(nextPattern,nextBeats);
      if(value.options && typeof value.options==='object'){
        Object.keys(opts).forEach(key=>{ if(typeof value.options[key]==='boolean') opts[key]=value.options[key]; });
      }
      rhyToggles.querySelectorAll('.pill').forEach(button=>
        button.classList.toggle('active',Boolean(opts[button.dataset.option])));
      const synco=Math.max(0,Math.min(10,Math.round(Number(value.syncopation))));
      const difficulty=Math.max(0,Math.min(10,Math.round(Number(value.difficulty))));
      if(Number.isFinite(synco)){ rhySynco.value=synco; rhySyncoVal.textContent=synco; }
      if(Number.isFinite(difficulty)){ rhyDiff.value=difficulty; rhyDiffVal.textContent=difficulty; }
      rhyPresets.querySelectorAll('.pill').forEach(button=>button.classList.remove('active'));
    }
  );
})();


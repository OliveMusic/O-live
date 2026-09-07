/* ===================== 잼 세션 ===================== */
(function(){
  /* ---------- 이론 ---------- */
  const MAJOR = [0,2,4,5,7,9,11];
  const MINOR = [0,2,3,5,7,8,10];
  // 다이어토닉 3화음 성질 + 화성 기능(T=토닉, S=서브도미넌트, D=도미넌트)
  const MAJOR_Q = [
    {q:'maj', rn:'I',   fn:'T'}, {q:'min', rn:'ii',  fn:'S'}, {q:'min', rn:'iii', fn:'T'},
    {q:'maj', rn:'IV',  fn:'S'}, {q:'maj', rn:'V',   fn:'D'}, {q:'min', rn:'vi',  fn:'T'},
    {q:'dim', rn:'vii°',fn:'D'},
  ];
  const MINOR_Q = [
    {q:'min', rn:'i',   fn:'T'}, {q:'dim', rn:'ii°', fn:'S'}, {q:'maj', rn:'III', fn:'T'},
    {q:'min', rn:'iv',  fn:'S'}, {q:'min', rn:'v',   fn:'D'}, {q:'maj', rn:'VI',  fn:'S'},
    {q:'maj', rn:'VII', fn:'D'},
  ];
  /* 코드 구성음은 표로 적지 않고 스케일에서 한 칸 건너 쌓아 만든다.
     그래야 3화음이든 7화음이든, 메이저든 마이너든 성질이 저절로 맞는다. */
  function stackThirds(idx, scale, n){
    const at = i => scale[i%7] + 12*Math.floor(i/7);
    const r = at(idx);
    const out = [];
    for(let k=0; k<n; k++) out.push(at(idx + 2*k) - r);
    return out;
  }
  // 구성음만 보고 이름을 정한다
  function chordSuffix(iv){
    const [,t3,t5,t7] = iv;
    if(t7 === undefined) return t3===3 ? (t5===6?'dim':'m') : (t5===8?'aug':'');
    if(t3===3 && t5===6) return t7===9 ? 'dim7' : 'm7♭5';
    if(t3===3)           return t7===10 ? 'm7'  : 'mM7';
    if(t5===8)           return t7===11 ? 'maj7♯5' : '7♯5';
    return t7===11 ? 'maj7' : '7';
  }
  // 로마숫자는 대소문자로 이미 성질을 담고 있으니 자릿수만 덧붙인다
  function chordFigure(iv){
    const [,t3,t5,t7] = iv;
    if(t7 === undefined) return '';
    if(t3===3 && t5===6) return t7===9 ? '°7' : 'ø7';
    if(t3===4 && t5===7 && t7===11) return 'maj7';
    return '7';
  }

  /* 스케일에서 쌓아 만든 코드로는 표현할 수 없는 것들이 있다.
     블루스의 I7·IV7(다이어토닉이면 Imaj7·IVmaj7이 된다),
     안달루시안 종지의 장3화음 V(내추럴 마이너면 v단화음이다) 같은 것.
     그런 자리는 프리셋이 성질을 직접 지정한다. 3화음↔7화음 토글을
     눌러도 성격이 남도록 짝으로 묶어 둔다. */
  const FAMILY = {
    maj: {tri:[0,4,7], sev:[0,4,7,11]},   // C   / Cmaj7
    dom: {tri:[0,4,7], sev:[0,4,7,10]},   // C   / C7
    min: {tri:[0,3,7], sev:[0,3,7,10]},   // Cm  / Cm7
    dim: {tri:[0,3,6], sev:[0,3,6,10]},   // Cdim/ Cm7♭5
    dim7:{tri:[0,3,6], sev:[0,3,6,9]},    // Cdim/ Cdim7
    aug: {tri:[0,4,8], sev:[0,4,8,11]},
  };

  /* ---------- 진행 프리셋 ---------- */
  const PRESETS = {
    pop:      {label:'팝 스탠다드   I–V–vi–IV',   deg:[1,5,6,4], mode:'major'},
    ballad:   {label:'감성 발라드   vi–IV–I–V',   deg:[6,4,1,5], mode:'major'},
    money:    {label:'머니코드   I–vi–IV–V',      deg:[1,6,4,5], mode:'major'},
    royal:    {label:'왕도 진행   IV–V–iii–vi',   deg:[4,5,3,6], mode:'major'},
    jazz251:  {label:'재즈 2–5–1   iim7–V7–Imaj7', deg:[2,5,1],  mode:'major', seventh:true},
    canon:    {label:'캐논   I–V–vi–iii–IV–I–IV–V', deg:[1,5,6,3,4,1,4,5], mode:'major'},
    // 블루스는 I·IV·V가 모두 도미넌트7이다. 다이어토닉으로는 나오지 않는다.
    blues:    {label:'12마디 블루스   I7–IV7–V7',  deg:[1,1,1,1,4,4,1,1,5,4,1,1], mode:'major', seventh:true,
               fam:['dom','dom','dom','dom','dom','dom','dom','dom','dom','dom','dom','dom']},
    minorLoop:{label:'마이너 루프   i–VI–III–VII', deg:[1,6,3,7], mode:'minor'},
    // 안달루시안 종지의 마지막은 장3화음 V다. 내추럴 마이너의 v단화음으로는 끌어당기는 맛이 없다.
    andalusia:{label:'안달루시안   i–VII–VI–V',   deg:[1,7,6,5], mode:'minor', fam:[null,null,null,'dom']},
  };

  /* ---------- 반주 스타일 (16분음표 16스텝 = 1마디) ---------- */
  const S = i => i;  // 가독성용
  const STYLES = {
    rock:{
      label:'Rock',
      kick:[0,6,8,14], snare:[4,12], hat:[0,2,4,6,8,10,12,14],
      bass:'root5', chord:'block', swing:0,
    },
    pop:{
      label:'Pop',
      kick:[0,8], snare:[4,12], hat:[0,2,4,6,8,10,12,14],
      bass:'drive', chord:'beat4', swing:0,
    },
    ballad:{
      label:'Ballad',
      kick:[0], snare:[8], hat:[0,4,8,12],
      bass:'sustain', chord:'sustain', swing:0,
    },
    funk:{
      label:'Funk',
      kick:[0,3,10], snare:[4,12], hat:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
      bass:'synco', chord:'synco', swing:0,
    },
    shuffle:{
      label:'Shuffle',
      kick:[0,8], snare:[4,12], hat:[0,3,4,7,8,11,12,15],
      bass:'walk', chord:'beat4', swing:.18,
    },
  };

  // 반음 수를 고정하면 코드 성질(장/단/감)을 무시해 틀린 음이 나온다.
  // 'R/3/5/6/8' 기호로 두고 실제 코드 구성음에서 꺼내 쓴다.
  const BASS_PATTERNS = {
    sustain:[{s:0, d:16, t:'R'}],
    root5:  [{s:0, d:8, t:'R'},{s:8, d:8, t:'5'}],
    drive:  [0,2,4,6,8,10,12,14].map(s=>({s, d:2, t:'R'})),
    walk:   [{s:0,d:4,t:'R'},{s:4,d:4,t:'3'},{s:8,d:4,t:'5'},{s:12,d:4,t:'6'}],
    synco:  [{s:0,d:3,t:'R'},{s:3,d:3,t:'R'},{s:6,d:2,t:'5'},{s:10,d:2,t:'R'},{s:14,d:2,t:'8'}],
  };
  // 코드의 실제 3도·5도를 쓴다. 감화음이면 5도가 6반음(감5도)이다.
  function bassIv(t, c){
    const iv = c.intervals;                 // [0, 3도, 5도]
    switch(t){
      case 'R': return 0;
      case '3': return iv[1];
      case '5': return iv[2];
      case '6': return iv.length>3 ? iv[3]                 // 7화음이면 코드의 7음
                     : (c.quality==='maj' ? 9 : 10);        // 3화음이면 6도 / ♭7 경과음
      case '8': return 12;
      default:  return 0;
    }
  }
  const CHORD_PATTERNS = {
    block:   [{s:0, d:15}],
    sustain: [{s:0, d:16}],
    beat4:   [{s:0,d:3},{s:4,d:3},{s:8,d:3},{s:12,d:3}],
    synco:   [{s:2,d:2},{s:6,d:2},{s:9,d:2},{s:14,d:2}],
  };

  /* ---------- 상태 ---------- */
  let seventh = false;         // 팔레트가 지금 무엇을 쌓을지. 이미 놓인 마디는 건드리지 않는다
  let progression = [];        // [{deg:1..7, beats:4, sev:false}]
  let styleKey = 'rock';
  let tracks = {drum:true, bass:true, chord:true, click:false};
  let playing = false, startPending = false, startToken = 0, jamCtx = null;
  let jamOutput = null, jamChordOutput = null;

  /* ---------- DOM ---------- */
  const jamKeyEl      = document.getElementById('jamKey');
  const jamModeEl     = document.getElementById('jamMode');
  const jamPresetEl   = document.getElementById('jamPreset');
  const PRESET_KEYS   = ['custom', ...Object.keys(PRESETS)];
  let jamRoot=0, jamModeVal='major', jamPresetKey='custom';
  let jamKeyDD, jamModeDD, jamPresetDD;
  const progTimeline  = document.getElementById('progTimeline');
  const progMeta      = document.getElementById('progMeta');
  const chordPalette  = document.getElementById('chordPalette');
  const stylePresets  = document.getElementById('stylePresets');
  const trackToggles  = document.getElementById('trackToggles');
  const jamBpmVal     = document.getElementById('jamBpmVal');
  const jamBpmBox     = document.getElementById('jamBpmBox');
  const jamMinus      = document.getElementById('jamMinus');
  const jamPlus       = document.getElementById('jamPlus');

  function releaseJamOutputs(){
    for(const output of [jamChordOutput,jamOutput]){
      if(!output) continue;
      try{ output.gain.value=0; }catch(e){}
      try{ output.disconnect(); }catch(e){}
    }
    jamChordOutput=null;
    jamOutput=null;
  }
  function createJamOutputs(ctx){
    releaseJamOutputs();
    jamOutput=ctx.createGain();
    jamOutput.connect(getMaster(ctx));
    // 코드의 공간감은 유지하되, 일시정지할 때 드라이·리버브 입력을
    // 한꺼번에 끊을 수 있도록 별도 버스에 모은다.
    jamChordOutput=ctx.createGain();
    jamChordOutput.connect(jamOutput);
    sendTo(jamChordOutput,0.3);
  }
  const jamTap        = document.getElementById('jamTap');
  const JAM_BPM_DEFAULT = 90;
  let jamBpm = JAM_BPM_DEFAULT;
  const jamStart      = document.getElementById('jamStart');

  jamKeyDD = makeSplitDropdown(jamKeyEl, Array.from({length:12},(_,i)=>({main:pcName(i),sub:''})),
    0, i=>{
      jamRoot=i; renderPalette(); renderTimeline();
      window.OlivePreferences.changed();
    });
  jamModeDD = makeSplitDropdown(jamModeEl, [{main:'Major',sub:''},{main:'Minor',sub:''}],
    0, i=>{
      jamModeVal = i===1?'minor':'major'; renderPalette(); renderTimeline();
      window.OlivePreferences.changed();
    });
  // 프리셋: 이름은 왼쪽, 진행은 오른쪽 (라벨의 여러 칸 공백으로 나뉘어 있다)
  const presetItems = PRESET_KEYS.map(k=>{
    if(k==='custom') return {main:'커스텀', sub:''};
    const parts = PRESETS[k].label.split(/\s{2,}/);
    return {main:parts[0], sub:parts.slice(1).join(' ')};
  });
  jamPresetDD = makeSplitDropdown(jamPresetEl, presetItems, 0, i=>{
    jamPresetKey = PRESET_KEYS[i]; loadPreset();
    window.OlivePreferences.changed();
  });

  Object.entries(STYLES).forEach(([k,v])=>{
    const b=document.createElement('button');
    b.className='pill'+(k===styleKey?' active':'');
    b.textContent=v.label; b.dataset.style=k;
    b.addEventListener('click', ()=>{
      styleKey=k;
      stylePresets.querySelectorAll('.pill').forEach(x=>x.classList.toggle('active', x.dataset.style===k));
      window.OlivePreferences.changed();
    });
    stylePresets.appendChild(b);
  });

  [['drum','드럼'],['bass','베이스'],['chord','코드'],['click','메트로놈']].forEach(([k,label])=>{
    const b=document.createElement('button');
    b.className='pill'+(tracks[k]?' active':'');
    b.textContent=label; b.dataset.track=k;
    b.addEventListener('click', ()=>{
      tracks[k]=!tracks[k];
      b.classList.toggle('active', tracks[k]);
      window.OlivePreferences.changed();
    });
    trackToggles.appendChild(b);
  });

  function setJamBpm(v){
    if(!Number.isFinite(Number(v))) return;
    jamBpm = Math.max(40, Math.min(220, Math.round(v)));
    jamBpmVal.textContent = jamBpm;
    window.OlivePreferences.changed();
    updateBackgroundMediaMetadata();
    return jamBpm;
  }

  function adjustJamTempo(delta){
    setJamBpm(jamBpm+delta);
    const ctx=jamCtx;
    if(!playing || isBackgroundMediaPaused() || !ctx || ctx!==audioCtx ||
       ctx.state!=='running') return jamBpm;
    const now=ctx.currentTime;
    const next=scheduledMarks.find(mark=>mark.time>=now+0.02);
    clearTimeout(timerID);
    releaseJamOutputs();
    createJamOutputs(ctx);
    stepCursor=next ? next.step : stepCursor;
    scheduledMarks=[];
    nextStepTime=now+0.05;
    scheduler();
    return jamBpm;
  }
  bindTempoKeys(jamMinus, jamPlus, ()=>jamBpm, setJamBpm);
  bindTapTempo(jamTap, setJamBpm);
  bindResetOnDouble(jamBpmVal, ()=>setJamBpm(JAM_BPM_DEFAULT));

  /* ---------- 코드 계산 ---------- */
  function qualitiesFor(mode){ return mode==='minor' ? MINOR_Q : MAJOR_Q; }
  function scaleFor(mode){ return mode==='minor' ? MINOR : MAJOR; }

  function chordInfo(deg, sev, fam){
    if(sev === undefined) sev = seventh;
    const mode = jamModeVal;
    const rootPc = jamRoot;
    const idx = (deg-1) % 7;
    const semis = scaleFor(mode)[idx];
    const info = qualitiesFor(mode)[idx];
    const pc = (rootPc + semis) % 12;
    const intervals = (fam && FAMILY[fam])
      ? FAMILY[fam][sev ? 'sev' : 'tri']
      : stackThirds(idx, scaleFor(mode), sev ? 4 : 3);
    // 성질을 갈아끼웠으면 로마숫자의 대소문자·기호도 실제 구성음을 따라가야 한다
    const quality = intervals[1]===3 ? (intervals[2]===6 ? 'dim' : 'min') : 'maj';
    let rn = info.rn;
    if(fam){
      rn = quality==='min' || quality==='dim' ? rn.toLowerCase() : rn.toUpperCase();
      if(quality!=='dim') rn = rn.replace('°','');
    }
    const fig = chordFigure(intervals);
    return {
      pc, semis,
      name: pcName(pc) + chordSuffix(intervals),
      rn: fig ? rn.replace('°','') + fig : rn,
      fn: info.fn,
      quality,
      intervals,
    };
  }

  /* ---------- 렌더 ---------- */
  function addChord(deg){
    progression.push({deg, beats:4, sev:seventh});
    markCustom();
    renderTimeline();
    window.OlivePreferences.changed();
  }
  function renderPalette(){
    chordPalette.innerHTML='';
    for(let deg=1; deg<=7; deg++){
      const c = chordInfo(deg);
      const cell = document.createElement('div');
      cell.className = 'chord-cell fn-'+c.fn;
      cell.innerHTML =
        `<button type="button" class="chord-preview" aria-label="${c.name} 코드 미리 듣기">`+
          `<span class="rn">${c.rn}</span><span class="nm">${c.name}</span>`+
        `</button>`+
        `<button type="button" class="cc-add" aria-label="${c.name} 진행에 추가">+</button>`;
      // 코드 몸통을 누르면 소리만 들어본다 (진행에는 넣지 않는다)
      cell.querySelector('.chord-preview').addEventListener('click', ()=> previewChord(deg));
      // + 를 누르면 진행에 담는다
      cell.querySelector('.cc-add').addEventListener('click', ()=>{
        addChord(deg);
        previewChord(deg);
      });
      chordPalette.appendChild(cell);
    }
  }

  // 사용자가 손대는 순간 프리셋 이름을 붙들고 있지 않는다
  function markCustom(){ if(jamPresetKey!=='custom'){ jamPresetKey='custom'; jamPresetDD.set(0); } }

  function renderTimeline(){
    progTimeline.innerHTML='';
    if(progression.length===0){
      const e=document.createElement('p');
      e.className='hint'; e.style.margin='6px 0';
      e.textContent='코드를 눌러 진행을 만들어보세요';
      progTimeline.appendChild(e);
      progMeta.textContent='비어 있음';
      return;
    }
    progression.forEach((item, i)=>{
      const c = chordInfo(item.deg, item.sev, item.fam);
      const el = document.createElement('div');
      el.className='prog-bar';
      el.dataset.idx=i;
      el.innerHTML =
        `<span class="bar-no">${i+1}</span>`+
        `<span class="rn">${c.rn}</span>`+
        `<button type="button" class="nm" aria-label="${c.name}, 3화음과 7화음 전환" title="눌러서 3↔7화음">${c.name}</button>`+
        `<span class="beats">`+
          `<button type="button" class="stp" data-act="dec" aria-label="${i+1}마디 박자 줄이기">−</button>`+
          `<span class="bv">${item.beats}</span>`+
          `<button type="button" class="stp" data-act="inc" aria-label="${i+1}마디 박자 늘리기">+</button>`+
        `</span>`;
      // 코드 이름 = 3화음/7화음 전환
      const nm = el.querySelector('.nm');
      nm.addEventListener('click', ev=>{
        ev.stopPropagation();
        item.sev = !item.sev;
        markCustom();
        renderTimeline();
        previewChord(item.deg, item.sev, item.fam);
        window.OlivePreferences.changed();
      });
      nm.addEventListener('mousedown', ev=> ev.stopPropagation());
      nm.addEventListener('touchstart', ev=> ev.stopPropagation(), {passive:true});
      // 박자 조절
      el.querySelectorAll('.stp').forEach(btn=>{
        btn.addEventListener('click', ev=>{
          ev.stopPropagation();
          const d = btn.dataset.act==='inc' ? 1 : -1;
          item.beats = Math.max(1, Math.min(8, item.beats + d));
          markCustom();
          renderTimeline();
          window.OlivePreferences.changed();
        });
        // 누르고 있는 동안 마디 삭제 타이머가 도는 것을 막는다
        btn.addEventListener('mousedown',  ev=> ev.stopPropagation());
        btn.addEventListener('touchstart', ev=> ev.stopPropagation(), {passive:true});
      });
      // 길게 눌러 삭제
      let holdTimer=null;
      const startHold = ()=>{ holdTimer=setTimeout(()=>{
        progression.splice(i,1); markCustom(); renderTimeline();
        window.OlivePreferences.changed();
      }, 500); };
      const cancelHold = ()=> clearTimeout(holdTimer);
      el.addEventListener('touchstart', startHold, {passive:true});
      el.addEventListener('touchend', cancelHold);
      el.addEventListener('touchmove', cancelHold);
      el.addEventListener('mousedown', startHold);
      el.addEventListener('mouseup', cancelHold);
      el.addEventListener('mouseleave', cancelHold);
      el.addEventListener('click', ()=> previewChord(item.deg, item.sev, item.fam));
      progTimeline.appendChild(el);
    });
    const totalBeats = progression.reduce((a,b)=>a+b.beats,0);
    progMeta.textContent = `${progression.length}마디 · ${totalBeats}박`;
  }

  function loadPreset(){
    if(jamPresetKey==='custom'){          // 빈 상태에서 직접 쌓아 올린다
      progression = [];
      renderPalette(); renderTimeline();
      return;
    }
    const p = PRESETS[jamPresetKey];
    if(!p) return;
    jamModeVal = p.mode; jamModeDD.set(p.mode==='minor'?1:0);
    setVoicing(p.seventh);
    progression = p.deg.map((d,i)=>({
      deg:d, beats:4, sev:!!p.seventh, fam:(p.fam ? p.fam[i] : null)
    }));
    renderPalette();
    renderTimeline();
  }
  // 한 번에 비우고 커스텀으로 — loadPreset이 'custom'에서 하는 일과 같으므로 거기에 맡긴다
  document.getElementById('jamClear').addEventListener('click', ()=>{
    if(playing) stop();
    jamPresetKey = 'custom'; jamPresetDD.set(0);
    loadPreset();
    window.OlivePreferences.changed();
  });
  document.getElementById('jamVoicing').addEventListener('click', e=>{
    const b = e.target.closest('.pill'); if(!b) return;
    seventh = b.dataset.seventh === '1';
    document.querySelectorAll('#jamVoicing .pill')
      .forEach(x=> x.classList.toggle('active', x===b));
    renderPalette();          // 팔레트만 바뀐다. 이미 놓인 마디는 그대로.
    window.OlivePreferences.changed();
  });
  function setVoicing(on){
    seventh = !!on;
    document.querySelectorAll('#jamVoicing .pill')
      .forEach(x=> x.classList.toggle('active', (x.dataset.seventh==='1')===seventh));
  }
  // (조·모드 변경은 각 드롭다운 콜백에서 renderPalette/renderTimeline을 부른다)

  /* ---------- 사운드 ---------- */
  function noiseBuffer(ctx, dur){
    const n = Math.floor(ctx.sampleRate*dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<n;i++) data[i] = Math.random()*2-1;
    return buf;
  }
  // 컨텍스트가 새로 만들어지면 예전 버퍼는 버린다
  let noiseCache = null, noiseCtx = null;
  function getNoise(ctx){
    if(!noiseCache || noiseCtx !== ctx){ noiseCache = noiseBuffer(ctx, 1.0); noiseCtx = ctx; }
    return noiseCache;
  }

  function kick(ctx, t){
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sine';
    o.frequency.setValueAtTime(165,t);
    o.frequency.exponentialRampToValueAtTime(44,t+0.09);   // 피치 엔벨로프
    g.gain.setValueAtTime(0.60,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.30);
    o.connect(g).connect(jamOutput);
    o.start(t); o.stop(t+0.32);
    // 비터 클릭 — 작은 스피커에서 킥이 들리게 하는 성분
    const c=ctx.createOscillator(), cg=ctx.createGain();
    c.type='triangle'; c.frequency.setValueAtTime(1100,t);
    cg.gain.setValueAtTime(0.10,t);
    cg.gain.exponentialRampToValueAtTime(0.0001,t+0.022);
    c.connect(cg).connect(jamOutput);
    c.start(t); c.stop(t+0.03);
  }

  function snare(ctx, t){
    const src=ctx.createBufferSource(); src.buffer=getNoise(ctx);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1900; bp.Q.value=0.8;
    const g=ctx.createGain();
    g.gain.setValueAtTime(0.50,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.16);
    src.connect(bp).connect(g).connect(jamOutput);
    src.start(t); src.stop(t+0.18);
    // 몸통
    const o=ctx.createOscillator(), og=ctx.createGain();
    o.type='triangle'; o.frequency.setValueAtTime(190,t);
    og.gain.setValueAtTime(0.26,t);
    og.gain.exponentialRampToValueAtTime(0.0001,t+0.09);
    o.connect(og).connect(jamOutput);
    o.start(t); o.stop(t+0.1);
  }
  function hat(ctx, t, open){
    const src=ctx.createBufferSource(); src.buffer=getNoise(ctx);
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=8200;
    const g=ctx.createGain();
    const d = open?0.16:0.045;
    g.gain.setValueAtTime(0.20,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+d);
    src.connect(hp).connect(g).connect(jamOutput);
    src.start(t); src.stop(t+d+0.02);
  }
  function bassNote(ctx, t, midi, dur){
    // 톱니파를 필터로 깎으면 손가락으로 뜯은 베이스의 어택이 산다.
    // 서브 사인을 아래에 깔아 두께를 준다.
    const f=midiToFreq(midi);
    const bus=ctx.createGain(); bus.gain.value=1;
    bus.connect(jamOutput);

    const lp=ctx.createBiquadFilter();
    lp.type='lowpass'; lp.Q.value=6;
    lp.frequency.setValueAtTime(Math.min(2600,f*13),t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120,f*2.2),t+Math.min(0.28,dur));
    lp.connect(bus);

    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sawtooth'; o.frequency.value=f;
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.30,t+0.010);
    g.gain.exponentialRampToValueAtTime(0.0001,t+Math.max(dur,0.09));
    o.connect(g).connect(lp);
    o.start(t); o.stop(t+dur+0.06);

    const sub=ctx.createOscillator(), sg=ctx.createGain();
    sub.type='sine'; sub.frequency.value=f;
    sg.gain.setValueAtTime(0.0001,t);
    sg.gain.exponentialRampToValueAtTime(0.26,t+0.012);
    sg.gain.exponentialRampToValueAtTime(0.0001,t+Math.max(dur,0.09));
    sub.connect(sg).connect(bus);
    sub.start(t); sub.stop(t+dur+0.06);
  }

  function chordVoice(ctx, t, midis, dur){
    // 잼 전용 코드 버스에서 한 번만 리버브를 보내 예약음을 완전히 지울 수 있다.
    pianoChord(midis, t, dur, 0.28, jamChordOutput, 0);
  }

  function previewChord(deg, sev, fam){
    const ctx=getCtx();
    const c=chordInfo(deg, sev, fam);
    const base = 48 + c.pc;                // 조성 반영
    pianoChord(c.intervals.map(iv=>base+iv), ctx.currentTime+0.01, 1.5, 0.30);
  }

  /* ---------- 스케줄러 ---------- */
  let timerID=null, nextStepTime=0, stepCursor=0;
  const START_LEAD_TIME=0.01;
  const LOOKAHEAD=25, AHEAD=0.14, BACKGROUND_AHEAD=2.5;
  let scheduledMarks=[];

  // 스텝마다 다시 만들면 1초에 수백 개의 객체가 버려진다. 바뀔 때만 다시 만든다.
  let __flat=null, __flatKey='';
  function flatSteps(){
    const key = progression.map(x=>x.beats).join(',');
    if(__flat && __flatKey===key) return __flat;
    const out=[];
    progression.forEach((item, barIdx)=>{
      const steps = item.beats*4;
      for(let s=0;s<steps;s++) out.push({barIdx, stepInBar:s, stepsInBar:steps});
    });
    __flat=out; __flatKey=key;
    return out;
  }

  function scheduleStep(step, when){
    const ctx=jamCtx;
    if(!ctx || ctx!==audioCtx || ctx.state!=='running'){ stop(); return; }
    const all=flatSteps();
    if(all.length===0){ stop(); return; }   // 마디가 다 지워졌으면 멈춘다
    const cell=all[step % all.length];
    const st=STYLES[styleKey];
    const item=progression[cell.barIdx];
    const c=chordInfo(item.deg, item.sev, item.fam);
    const s=cell.stepInBar % 16;

    if(tracks.drum){
      if(st.kick.includes(s))  kick(ctx, when);
      if(st.snare.includes(s)) snare(ctx, when);
      if(st.hat.includes(s))   hat(ctx, when, s%8===4 && styleKey==='ballad');
    }
    if(tracks.click && s%4===0){
      playClick(when - ctx.currentTime, cell.stepInBar===0, ctx, jamOutput);
    }
    const secPerStep = (60/jamBpm)/4;
    if(tracks.bass){
      BASS_PATTERNS[st.bass].forEach(p=>{
        // c.pc는 조성이 반영된 실제 음이름. 36+pc = C2~B2 (베이스 음역)
        if(p.s===s) bassNote(ctx, when, 36 + c.pc + bassIv(p.t, c), p.d*secPerStep*0.9);
      });
    }
    if(tracks.chord){
      CHORD_PATTERNS[st.chord].forEach(p=>{
        if(p.s===s){
          const base = 48 + c.pc;            // 조성이 반영된 음. C3~B3
          chordVoice(ctx, when, c.intervals.map(iv=>base+iv), p.d*secPerStep*0.92);
        }
      });
    }
    scheduledMarks.push({time:when, barIdx:cell.barIdx, step});
  }

  function scheduler(){
    const ctx=jamCtx;
    if(!playing || !ctx || ctx!==audioCtx){
      stop();
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
      stop();
      return;
    }
    const bpm=jamBpm;
    const secPerStep=(60/bpm)/4;
    const st=STYLES[styleKey];
    if(nextStepTime < ctx.currentTime - 0.25){  // 밀린 시간만 버리고 자리는 유지
      nextStepTime = ctx.currentTime + 0.05;
      scheduledMarks.length = 0;
    }
    if(document.visibilityState!=='visible'){
      while(scheduledMarks.length && scheduledMarks[0].time < ctx.currentTime-0.25){
        scheduledMarks.shift();
      }
    }
    // scheduleStep 안에서 stop()이 불릴 수 있으므로 매 바퀴 playing을 다시 본다
    const ahead=document.visibilityState==='visible' ? AHEAD : BACKGROUND_AHEAD;
    while(playing && nextStepTime < ctx.currentTime + ahead){
      // 셔플 필: 홀수 16분을 뒤로 민다
      const swingOff = (st.swing && stepCursor%2===1) ? secPerStep*st.swing : 0;
      scheduleStep(stepCursor, nextStepTime + swingOff);
      nextStepTime += secPerStep;
      stepCursor++;
    }
    if(playing) timerID=setTimeout(scheduler,
      document.visibilityState==='visible' ? LOOKAHEAD : 250);
  }

  let visualGen=0, visualBarIdx=-1;
  function revealActiveBar(cur){
    if(!cur) return;
    const view=progTimeline;
    const viewRect=view.getBoundingClientRect();
    const curRect=cur.getBoundingClientRect();
    const viewCenter=viewRect.left + viewRect.width/2;
    const curCenter=curRect.left + curRect.width/2;

    // 실제 화면 좌표의 두 중심을 맞춘다. 활성 코드 뒤의 다음 코드까지
    // 미리 보이면서도 iOS Safari의 offsetLeft 기준 차이를 피할 수 있다.
    const next=view.scrollLeft + (curCenter - viewCenter);
    const max=Math.max(0, view.scrollWidth - view.clientWidth);
    const want=Math.max(0, Math.min(max, next));
    if(Math.abs(view.scrollLeft - want)<=1) return;
    const behavior=window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    view.scrollTo({left:want, behavior});
  }
  function visualLoop(gen){
    if(!playing || gen!==visualGen) return;
    const ctx=jamCtx;
    if(isBackgroundMediaPaused()){
      requestAnimationFrame(()=>visualLoop(gen));
      return;
    }
    if(!ctx || ctx!==audioCtx || ctx.state!=='running'){
      stop();
      return;
    }
    while(scheduledMarks.length && scheduledMarks[0].time <= ctx.currentTime){
      const m=scheduledMarks.shift();
      const bars=progTimeline.querySelectorAll('.prog-bar');
      bars.forEach((b,i)=> b.classList.toggle('now', i===m.barIdx));
      pulseTab('jam');
      // 같은 마디 안의 16분음표마다 스크롤을 덮어쓰지 않는다.
      // 마디가 바뀔 때만 활성 카드를 가운데로 옮겨 다음 코드도 보여준다.
      if(m.barIdx!==visualBarIdx){
        visualBarIdx=m.barIdx;
        revealActiveBar(bars[m.barIdx]);
      }
    }
    requestAnimationFrame(()=>visualLoop(gen));
  }

  function stop(){
    if(!playing && !startPending) return;
    startToken++;
    startPending=false;
    playing=false;
    releaseJamOutputs();
    jamCtx=null;
    clearTimeout(timerID);
    scheduledMarks=[];
    visualBarIdx=-1;
    jamStart.classList.remove('on','media-paused');
    jamStart.setAttribute('aria-label','재생');
    jamStart.setAttribute('aria-busy','false');
    jamStart.querySelector('svg').innerHTML='<path d="M8 5.5v13l11-6.5z"/>';
    setTabSounding('jam', false, 'play');
    progTimeline.querySelectorAll('.prog-bar').forEach(b=>b.classList.remove('now'));
  }

  function setMediaPaused(paused){
    if(!playing) return;
    jamStart.classList.toggle('media-paused',paused);
    jamStart.classList.toggle('on',!paused);
    jamStart.setAttribute('aria-label',paused?'재생':'정지');
    jamStart.querySelector('svg').innerHTML=paused
      ? '<path d="M8 5.5v13l11-6.5z"/>'
      : '<rect x="7" y="6" width="3.6" height="12" rx="1.2"/><rect x="13.4" y="6" width="3.6" height="12" rx="1.2"/>';
    clearTimeout(timerID);
    if(paused){
      // 잠금 전에 미리 예약된 반주를 버린다. 재개할 때 첫 마디와 섞이지 않는다.
      releaseJamOutputs();
      scheduledMarks=[];
      // 활성 코드를 따라가던 부드러운 스크롤도 현재 위치에서 즉시 멈춘다.
      try{ progTimeline.scrollTo({left:progTimeline.scrollLeft,behavior:'auto'}); }catch(e){}
      return;
    }
    if(!jamCtx || jamCtx!==audioCtx || jamCtx.state!=='running') return;
    createJamOutputs(jamCtx);
    stepCursor=0;
    scheduledMarks=[];
    visualBarIdx=-1;
    progTimeline.querySelectorAll('.prog-bar').forEach(b=>b.classList.remove('now'));
    nextStepTime=jamCtx.currentTime+START_LEAD_TIME;
    scheduler();
  }

  jamStart.addEventListener('click', async ()=>{
    if((playing || startPending) && isBackgroundMediaPaused()){
      resumeBackgroundPlayback().catch(()=>{});
      return;
    }
    if(playing || startPending){ stop(); return; }
    if(progression.length===0) return;
    const token=++startToken;
    startPending=true;
    jamStart.setAttribute('aria-label','시작 중');
    jamStart.setAttribute('aria-busy','true');
    try{
      const ctx=await ensureBackgroundPlaybackCtx('잼 세션');
      if(token!==startToken || !startPending){
        if(audioCtx===ctx && !anySounding()) releaseCtx();
        return;
      }
      jamCtx=ctx;
      createJamOutputs(ctx);
      playing=true;
      stepCursor=0; scheduledMarks=[];
      visualBarIdx=-1;
      // 터치 직후 반주가 시작되면서도 첫 스텝이 잘리지 않을 최소 여유만 둔다.
      nextStepTime=ctx.currentTime+START_LEAD_TIME;
      jamStart.classList.add('on');
      jamStart.classList.remove('media-paused');
      jamStart.setAttribute('aria-label','정지');
      jamStart.setAttribute('aria-busy','false');
      jamStart.querySelector('svg').innerHTML='<rect x="7" y="6" width="3.6" height="12" rx="1.2"/><rect x="13.4" y="6" width="3.6" height="12" rx="1.2"/>';
      setTabSounding('jam',true,'play');
      scheduler();
      visualLoop(++visualGen);
    }catch(error){
      if(token===startToken){
        stop();
        releaseCtx();
      }
    }finally{
      if(token===startToken) startPending=false;
    }
  });

  registerTransport({
    isPlaying:()=>playing || startPending,
    stop,
    setPaused:setMediaPaused,
    setContext:ctx=>{ jamCtx=ctx; },
    getTempo:()=>jamBpm,
    adjustTempo:adjustJamTempo,
    background:true,
    label:'잼 세션',
  });

  document.addEventListener('visibilitychange',()=>{
    if(!playing || document.visibilityState==='visible') return;
    clearTimeout(timerID);
    scheduler();
  });

  /* ---------- 초기화 ---------- */
  jamPresetKey='pop'; jamPresetDD.set(PRESET_KEYS.indexOf('pop'));
  loadPreset();
  window.OlivePreferences.register('jam',
    ()=>({
      root:jamRoot,
      mode:jamModeVal,
      preset:jamPresetKey,
      bpm:jamBpm,
      seventh,
      style:styleKey,
      tracks:{...tracks},
      progression:progression.map(item=>({
        deg:item.deg,beats:item.beats,sev:Boolean(item.sev),fam:item.fam||null,
      })),
    }),
    value=>{
      if(!value || typeof value!=='object') return;
      const root=Math.round(Number(value.root));
      if(Number.isFinite(root) && root>=0 && root<12){ jamRoot=root; jamKeyDD.set(root); }
      if(value.mode==='major' || value.mode==='minor'){
        jamModeVal=value.mode; jamModeDD.set(value.mode==='minor'?1:0);
      }
      const presetIndex=PRESET_KEYS.indexOf(value.preset);
      jamPresetKey=presetIndex>=0 ? PRESET_KEYS[presetIndex] : 'custom';
      jamPresetDD.set(Math.max(0,presetIndex));
      setJamBpm(value.bpm);
      setVoicing(Boolean(value.seventh));
      if(Object.prototype.hasOwnProperty.call(STYLES,value.style)) styleKey=value.style;
      stylePresets.querySelectorAll('.pill')
        .forEach(button=>button.classList.toggle('active',button.dataset.style===styleKey));
      if(value.tracks && typeof value.tracks==='object'){
        Object.keys(tracks).forEach(key=>{ if(typeof value.tracks[key]==='boolean') tracks[key]=value.tracks[key]; });
      }
      trackToggles.querySelectorAll('.pill')
        .forEach(button=>button.classList.toggle('active',Boolean(tracks[button.dataset.track])));
      if(Array.isArray(value.progression)){
        const familyKeys=new Set(Object.keys(FAMILY));
        progression=value.progression.slice(0,64).map(item=>({
          deg:Math.max(1,Math.min(7,Math.round(Number(item&&item.deg)||1))),
          beats:Math.max(1,Math.min(8,Math.round(Number(item&&item.beats)||4))),
          sev:Boolean(item&&item.sev),
          fam:item&&familyKeys.has(item.fam)?item.fam:null,
        }));
      }else if(jamPresetKey!=='custom'){
        loadPreset();
      }
      renderPalette();
      renderTimeline();
    }
  );
})();

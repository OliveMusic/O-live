/* ===================== 튜너 ===================== */
(function(){
  const TUNINGS = {
    guitar:{label:'기타 표준', strings:[40,45,50,55,59,64]},
    dropd:{label:'기타 드롭 D', strings:[38,45,50,55,59,64]},
    bass:{label:'베이스 4현', strings:[28,33,38,43]},
    ukulele:{label:'우쿨렐레', strings:[67,60,64,69]},
    mandolin:{label:'만돌린', strings:[55,62,69,76]},
  };
  const TUNING_ORDER = ['guitar','dropd','bass','ukulele','mandolin'];
  const tunerNote   = document.getElementById('tunerNote');
  const tunerFreq   = document.getElementById('tunerFreq');
  const tunerStart  = document.getElementById('tunerStart');
  const stringBtns  = document.getElementById('stringBtns');
  const tuningSelect= document.getElementById('tuningSelect');
  const strobe      = document.getElementById('strobe');
  const strobeRing  = document.getElementById('strobeWheel');
  const strobeOlive = document.getElementById('strobeOlive');
  const strobeDir   = document.getElementById('strobeDir');
  const levelEl     = document.getElementById('tunerLevel');
  const scopeCanvas = document.getElementById('tunerScope');
  const scopeStateEl= document.getElementById('tunerScopeState');
  const inputDbEl   = document.getElementById('tunerInputDb');
  const noiseDbEl   = document.getElementById('tunerNoiseDb');
  const marginDbEl  = document.getElementById('tunerMarginDb');
  const tunerEngine = window.OliveTunerEngine;

  let currentTuning='guitar';
  let listening=false, micStarting=false, micStartToken=0;
  let stream=null, analyser=null, buf=null, srcNode=null, micBoost=null, monitorSink=null;
  let micChain=[];              // 껐을 때 확실히 끊기 위해 들고 있는다
  let micRecovering=false, inputRecoveryUsed=false, zeroInputSince=0;
  let strobeCents=0, strobeAngle=0, strobeLast=0;
  let spin=0, lock=0;            // 화면에 실제로 그려지는 값. 목표를 향해 천천히 따라간다.
  let lastNote=null, quietFrames=0, inLevel=0;
  let freqLo=70, freqHi=1400;   // 선택된 튜닝에 따라 정해진다

  /* 감도는 명확도·최소 음량·주변 소음 대비·입력 증폭을 함께 조절한다. */
  const SENS_DEFAULT = 50;
  let sensitivity=tunerEngine.sensitivityProfile(SENS_DEFAULT);
  let clarityGate=sensitivity.clarityGate;
  const signalGate=tunerEngine.createSignalGate();
  const bandNoiseProfile=tunerEngine.createBandNoiseProfile();
  const pitchTracker=tunerEngine.createPitchTracker();
  const toneActivityDetector=tunerEngine.createToneActivityDetector();
  let spectralFrame=0;

  /* ---------- 감도 설정용 실시간 입력 모니터 ---------- */
  const scopeCtx=scopeCanvas ? scopeCanvas.getContext('2d') : null;
  let scopeWidth=0,scopeHeight=0,scopeSizeDirty=true,scopeDrawingDisabled=false;
  let lastScopeDraw=0,lastScopeText=0;
  let scopeColors={line:'#777',dim:'#777',signal:'#687c52',signalRgb:'104,124,82'};

  function fitScopeCanvas(){
    if(!scopeCanvas || !scopeCtx) return false;
    const rect=scopeCanvas.getBoundingClientRect();
    if(rect.width<1 || rect.height<1) return false;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const pixelWidth=Math.max(1,Math.round(rect.width*dpr));
    const pixelHeight=Math.max(1,Math.round(rect.height*dpr));
    if(scopeSizeDirty || scopeCanvas.width!==pixelWidth || scopeCanvas.height!==pixelHeight){
      scopeCanvas.width=pixelWidth;
      scopeCanvas.height=pixelHeight;
      scopeCtx.setTransform(dpr,0,0,dpr,0,0);
      scopeWidth=rect.width;
      scopeHeight=rect.height;
      const style=getComputedStyle(document.documentElement);
      scopeColors={
        line:style.getPropertyValue('--line-soft').trim()||'#777',
        dim:style.getPropertyValue('--ink-3').trim()||'#777',
        signal:style.getPropertyValue('--signal').trim()||'#687c52',
        signalRgb:style.getPropertyValue('--signal-rgb').trim()||'104,124,82',
      };
      scopeSizeDirty=false;
    }
    return true;
  }

  function scopeAmplitude(value,halfHeight){
    return Math.min(0.92,Math.sqrt(Math.max(0,Math.abs(value))*30))*halfHeight;
  }

  function levelDb(value){
    return Math.max(-96,Math.min(0,20*Math.log10(Math.max(1e-7,value))));
  }

  function drawScopeFrame(samples,gate,accepted){
    if(!fitScopeCanvas()) return;
    const width=scopeWidth,height=scopeHeight,center=height/2,half=height*0.46;
    scopeCtx.clearRect(0,0,width,height);

    scopeCtx.strokeStyle=scopeColors.line;
    scopeCtx.lineWidth=1;
    scopeCtx.beginPath();
    scopeCtx.moveTo(0,center+0.5);
    scopeCtx.lineTo(width,center+0.5);
    scopeCtx.stroke();

    if(gate){
      const noiseHeight=Math.max(1.5,scopeAmplitude(gate.noiseFloor,half));
      const gateHeight=Math.max(2,scopeAmplitude(gate.effectiveThreshold,half));
      scopeCtx.fillStyle=`rgba(${scopeColors.signalRgb},0.09)`;
      scopeCtx.fillRect(0,center-noiseHeight,width,noiseHeight*2);

      scopeCtx.save();
      scopeCtx.setLineDash([3,4]);
      scopeCtx.strokeStyle=`rgba(${scopeColors.signalRgb},0.52)`;
      scopeCtx.beginPath();
      scopeCtx.moveTo(0,center-gateHeight);
      scopeCtx.lineTo(width,center-gateHeight);
      scopeCtx.moveTo(0,center+gateHeight);
      scopeCtx.lineTo(width,center+gateHeight);
      scopeCtx.stroke();
      scopeCtx.restore();
    }

    scopeCtx.strokeStyle=accepted ? scopeColors.signal : scopeColors.dim;
    scopeCtx.lineWidth=accepted ? 1.45 : 1.05;
    scopeCtx.beginPath();
    if(!samples || !samples.length){
      scopeCtx.moveTo(0,center);
      scopeCtx.lineTo(width,center);
    }else{
      const last=samples.length-1;
      const columns=Math.max(2,Math.floor(width));
      for(let x=0;x<columns;x++){
        const sample=samples[Math.min(last,Math.floor(x*last/(columns-1)))];
        const y=center-Math.sign(sample)*scopeAmplitude(sample,half);
        if(x===0) scopeCtx.moveTo(x,y);
        else scopeCtx.lineTo(x,y);
      }
    }
    scopeCtx.stroke();
  }

  /* 파형은 보조 표시다. 일부 iOS Safari 버전에서 Canvas 호출이 실패해도
     실제 음정 분석까지 함께 멈추지 않도록 별도로 격리한다. */
  function safeDrawScopeFrame(samples,gate,accepted){
    if(scopeDrawingDisabled) return;
    try{
      drawScopeFrame(samples,gate,accepted);
    }catch(e){
      scopeDrawingDisabled=true;
    }
  }

  function updateScope(samples,rms,gate,accepted,ts){
    if(!scopeCtx || ts-lastScopeDraw<40) return;
    lastScopeDraw=ts;
    safeDrawScopeFrame(samples,gate,accepted);
    if(ts-lastScopeText<160) return;
    lastScopeText=ts;
    const margin=20*Math.log10(Math.max(1e-7,rms)/Math.max(1e-7,gate.effectiveThreshold));
    if(inputDbEl) inputDbEl.textContent=Math.round(levelDb(rms))+' dB';
    if(noiseDbEl) noiseDbEl.textContent=Math.round(levelDb(gate.noiseFloor))+' dB';
    if(marginDbEl) marginDbEl.textContent=(margin>=0?'+':'')+Math.round(Math.max(-60,Math.min(60,margin)))+' dB';
    if(scopeStateEl){
      scopeStateEl.textContent=accepted ? '인식 중' : gate.open ? '음정 확인 중' : '문턱 아래';
      scopeStateEl.classList.toggle('active',accepted);
    }
  }

  function resetScope(label='마이크 꺼짐'){
    lastScopeDraw=0; lastScopeText=0;
    safeDrawScopeFrame(null,null,false);
    if(inputDbEl) inputDbEl.textContent='—';
    if(noiseDbEl) noiseDbEl.textContent='—';
    if(marginDbEl) marginDbEl.textContent='—';
    if(scopeStateEl){
      scopeStateEl.textContent=label;
      scopeStateEl.classList.remove('active');
    }
  }

  window.addEventListener('resize',()=>{
    scopeSizeDirty=true;
    if(!listening) requestAnimationFrame(()=>resetScope());
  });

  function applyInputGain(){
    if(!micBoost || !micBoost.gain) return;
    const gain=micBoost.gain;
    const ctx=typeof audioCtx!=='undefined' ? audioCtx : null;
    if(typeof gain.setTargetAtTime==='function' && ctx){
      gain.setTargetAtTime(sensitivity.inputGain,ctx.currentTime,0.025);
    }else{
      gain.value=sensitivity.inputGain;
    }
  }

  function setSens(v){
    if(!Number.isFinite(Number(v))) return;
    v = Math.max(0, Math.min(100, Math.round(v)));
    sensitivity=tunerEngine.sensitivityProfile(v);
    clarityGate=sensitivity.clarityGate;
    const el = document.getElementById('tunerSens');
    if(el){
      el.value = v;
      el.setAttribute('aria-valuetext',v+' '+sensitivity.label);
    }
    signalGate.reset();
    bandNoiseProfile.reset();
    pitchTracker.reset();
    toneActivityDetector.reset();
    applyInputGain();
    window.OlivePreferences.changed();
  }

  const N=tunerEngine.FRAME_SIZE;

  function disconnectMicGraph(){
    micChain.forEach(n=>{ try{ n.disconnect(); }catch(e){} });
    micChain=[];
    srcNode=null; analyser=null; micBoost=null; monitorSink=null; buf=null;
  }

  function buildMicGraph(ctx){
    disconnectMicGraph();
    srcNode=ctx.createMediaStreamSource(stream);

    // 대역 제한: 럼블과 고차 배음을 걷어내 검출 안정성을 높인다
    const hp=ctx.createBiquadFilter();
    hp.type='highpass'; hp.frequency.value=55; hp.Q.value=0.7;
    const lp=ctx.createBiquadFilter();
    lp.type='lowpass'; lp.frequency.value=2200; lp.Q.value=0.7;

    analyser=ctx.createAnalyser();
    analyser.fftSize=N;
    analyser.smoothingTimeConstant=0;
    buf=new Float32Array(N);

    // 기기 마이크가 조용한 경우가 많아 분석 전에 키워준다.
    micBoost=ctx.createGain();
    micBoost.gain.value=sensitivity.inputGain;

    /* AnalyserNode는 원칙상 출력 연결 없이도 동작하지만, 일부 iOS WebKit에서는
       그래프가 끌려가지 않아 계속 0만 반환하는 경우가 있다. 0 gain 경로를
       destination까지 연결해 분석은 활성화하되 마이크 소리는 절대 재생하지 않는다. */
    monitorSink=ctx.createGain();
    monitorSink.gain.value=0;

    srcNode.connect(hp);
    hp.connect(lp);
    lp.connect(micBoost);
    micBoost.connect(analyser);
    analyser.connect(monitorSink);
    monitorSink.connect(ctx.destination);
    micChain=[srcNode,hp,lp,micBoost,analyser,monitorSink];
    signalGate.reset();
    bandNoiseProfile.reset();
    pitchTracker.reset();
    toneActivityDetector.reset();
    spectralFrame=0;
  }

  async function recoverMicGraph(token){
    if(micRecovering || !listening || !stream || token!==micStartToken) return;
    micRecovering=true;
    if(scopeStateEl){
      scopeStateEl.textContent='입력 다시 연결 중';
      scopeStateEl.classList.remove('active');
    }
    try{
      const ctx=await ensureCtx('play-and-record',true);
      if(!listening || !stream || token!==micStartToken) return;
      buildMicGraph(ctx);
      zeroInputSince=0;
      lastRun=0;
      if(scopeStateEl) scopeStateEl.textContent='입력 측정 중';
    }catch(e){
      if(listening && token===micStartToken){
        stopMic('입력 연결 실패 · 다시 눌러주세요');
      }
    }finally{
      micRecovering=false;
    }
  }

  /* ---------- 안정화: 고립된 튐 제거 + 최근 입력 우선 평활 ---------- */
  const hist=[];
  let smoothCents=0, haveLock=false, wasInTune=false;
  function stabilize(freq){
    hist.push(freq);
    if(hist.length>3) hist.shift();
    if(hist.length<3) return freq;

    const [older,previous,current]=hist;
    const recentGap=Math.abs(1200*Math.log2(current/previous));
    const earlierGap=Math.abs(1200*Math.log2(previous/older));
    if(recentGap<=5){
      // 최근 두 값이 동의하면 최신값 쪽을 따라가 중앙값의 한 프레임 지연을 없앤다.
      return previous*Math.pow(current/previous,0.78);
    }
    if(earlierGap<=5) return previous;   // 최신값 하나만 튀었으면 직전값을 유지
    const sorted=hist.slice().sort((a,b)=>a-b);
    return sorted[1];                    // 급격한 전환 중에는 중앙값으로 보호
  }

  /* ---------- 표시 ---------- */
  function renderStringButtons(){
    stringBtns.innerHTML='';
    const t=TUNINGS[currentTuning];
    // 이 악기가 낼 수 있는 음역 밖은 아예 보지 않는다.
    // 기타를 고르면 하한이 약 72Hz라 선풍기 소리(28~70Hz)가 구조적으로 걸러진다.
    const lo=Math.min(...t.strings), hi=Math.max(...t.strings);
    freqLo=midiToFreq(lo)*0.87;      // 많이 풀린 줄도 잡을 만큼의 여유
    freqHi=midiToFreq(hi+26);        // 하이 프렛까지
    const count = t.strings.length;
    stringBtns.style.gridTemplateColumns=`repeat(${count},1fr)`;
    t.strings.forEach((midi,idx)=>{
      const b=document.createElement('button');
      b.className='string-btn';
      // 줄 번호: 가장 낮은(굵은) 줄이 가장 큰 번호. 기타 6번 ~ 1번.
      const num = count - idx;
      const name = midiToName(midi);
      b.innerHTML = `<span class="sn">${num}</span><span class="nn">${name}</span>`;
      b.dataset.midi=midi;
      b.setAttribute('aria-label', num+'번 줄 '+name);
      b.addEventListener('click', ()=> referenceTone(midi, 2.6));
      stringBtns.appendChild(b);
    });
  }
  const tunerTuningDD = makeSplitDropdown(
    tuningSelect,
    TUNING_ORDER.map(k=>({ main:TUNINGS[k].label, sub:TUNINGS[k].strings.map(m=>pcName(m)).join('') })),
    0,
    i=>{
      currentTuning=TUNING_ORDER[i]; renderStringButtons();
      window.OlivePreferences.changed();
    }
  );
  renderStringButtons();

  function update(freq){
    const midi=69+12*Math.log2(freq/440);
    const nearest=Math.round(midi);
    const cents=(midi-nearest)*100;

    // 새 현을 치면 즉시 따라가고, 미세 조정 중일 때만 부드럽게 한다.
    // 항상 느리게 평활하면 줄을 바꿔도 바늘이 천천히 기어가 답답하다.
    const jumped = !haveLock || nearest!==lastNote || Math.abs(cents-smoothCents)>35;
    smoothCents = jumped ? cents : smoothCents + (cents-smoothCents)*0.58;
    lastNote = nearest;
    haveLock = true;

    tunerNote.textContent=midiToName(nearest);
    tunerFreq.textContent=freq.toFixed(1)+' Hz';

    strobeCents=Math.max(-50,Math.min(50,smoothCents));
    // 3센트는 스트로보 튜너 기준이라 실제 연습엔 너무 빡빡했다.
    // 일반 기타 튜너와 같은 ±5센트로 하고, 경계에서 깜빡이지 않도록
    // 한 번 들어오면 8센트를 넘을 때까지 유지한다.
    const a=Math.abs(smoothCents);
    const inTune = wasInTune ? a<8 : a<5;
    wasInTune = inTune;
    strobe.classList.toggle('in-tune', inTune);
    strobeDir.textContent = inTune ? '정확함'
      : (smoothCents>0 ? '높음 ▶ '+smoothCents.toFixed(0)+'¢'
                       : '◀ 낮음 '+Math.abs(smoothCents).toFixed(0)+'¢');

    stringBtns.querySelectorAll('.string-btn').forEach(b=>{
      b.classList.toggle('match', +b.dataset.midi===nearest && Math.abs(smoothCents)<10);
    });
  }

  function idle(){
    haveLock=false; hist.length=0; lastNote=null; wasInTune=false;
    pitchTracker.reset();
    tunerNote.textContent='--';
    tunerFreq.textContent='연주해보세요';
    strobeCents=0;
    strobe.classList.remove('in-tune');
    strobeDir.textContent='— 조율 대기 —';
    stringBtns.querySelectorAll('.string-btn').forEach(b=>b.classList.remove('match'));
  }

  /* ---------- 분석 루프 (약 45Hz — 반응성과 모바일 배터리의 균형) ---------- */
  let lastRun=0;
  function analyse(ts){
    if(!listening) return;
    try{
      if(ts-lastRun > 22){                 // 약 45Hz
        lastRun=ts;
        if(!analyser || !buf || !audioCtx) return;
        analyser.getFloatTimeDomainData(buf);
        const rms=tunerEngine.frameRms(buf,4);

        /* 정상 마이크는 조용한 방에서도 아주 작은 바닥 잡음이 들어온다.
           정확한 0만 1.4초 이상 계속되면 iOS 오디오 그래프가 멈춘 것으로 보고
           컨텍스트와 분석 경로를 한 번만 새로 만든다. */
        if(rms>1e-7){
          zeroInputSince=0;
        }else if(!inputRecoveryUsed){
          if(!zeroInputSince) zeroInputSince=ts;
          else if(ts-zeroInputSince>1400){
            inputRecoveryUsed=true;
            recoverMicGraph(micStartToken);
          }
        }

        // 적응형 문턱보다 훨씬 작은 무음에서는 FFT를 생략해 배터리를 아낀다.
        const minimumDetectLevel=sensitivity.absoluteFloor*(haveLock ? 0.55 : 0.85);
        spectralFrame=(spectralFrame+1)%4;
        const shouldDetectPitch=rms>=minimumDetectLevel;
        const frameAnalysis=(shouldDetectPitch || spectralFrame===0)
          ? tunerEngine.analyzePitch(buf,audioCtx.sampleRate,{
              minFrequency:freqLo,
              maxFrequency:freqHi,
              skipPitch:!shouldDetectPitch,
            })
          : null;
        const r=frameAnalysis ? frameAnalysis.pitch : null;
        const toneState=toneActivityDetector.update(
          r,
          frameAnalysis ? frameAnalysis.bands : null,
          rms,
          ts,
        );
        const inRange=Boolean(r && r.freq>freqLo && r.freq<freqHi);
        const likelyPitch=Boolean(
          inRange &&
          r.clarity>Math.max(0.50,clarityGate-0.10) &&
          r.harmonicity>sensitivity.harmonicityGate*0.65
        );
        const bandState=bandNoiseProfile.evaluate(
          frameAnalysis ? frameAnalysis.bands : null,
          sensitivity,
          {pitched:likelyPitch,locked:haveLock},
        );
        const gate=signalGate.evaluate(rms,sensitivity,{pitched:likelyPitch,locked:haveLock});
        const harmonicPass=Boolean(r && r.harmonicity>=sensitivity.harmonicityGate);
        const cleanWeakSignal=Boolean(
          sensitivity.value>=67 && inRange &&
          r.clarity>Math.min(0.96,clarityGate+0.13) &&
          harmonicPass &&
          rms>=sensitivity.absoluteFloor
        );
        const rawAccepted=Boolean(
          inRange && harmonicPass && r.clarity>clarityGate &&
          (gate.open || cleanWeakSignal)
        );
        const pitchConfidence=r ? Math.max(0,Math.min(1,
          r.clarity*0.62+r.harmonicity*0.24+bandState.confidence*0.14-
          r.humLikelihood*0.18-toneState.penalty
        )) : 0;
        const tracked=pitchTracker.update(rawAccepted ? {
          freq:r.freq,
          clarity:r.clarity,
          harmonicity:r.harmonicity,
          confidence:pitchConfidence,
        } : null,{
          minConfidence:sensitivity.value>=67 ? 0.43 : 0.48,
          attackConfirmed:toneState.onset,
        });
        let accepted=Boolean(tracked);
        // 어택 없이 오래 유지된 음높이는 팬·모터 배경음으로 보고 즉시 표시를 놓는다.
        if(toneState.background && !toneState.attackActive){
          accepted=false;
          if(haveLock){
            idle();
            quietFrames=0;
          }
        }
        updateScope(buf,rms,gate,accepted,ts);

        // 로그에 가까운 반응으로 작은 입력도 막대에서 확인할 수 있게 한다.
        const meterRatio=rms/Math.max(gate.threshold,1e-8);
        const meterTarget=Math.min(1,Math.sqrt(meterRatio)*0.55);
        inLevel=inLevel*0.72+meterTarget*0.28;
        if(levelEl){
          levelEl.style.transform='scaleX('+inLevel.toFixed(3)+')';
          levelEl.classList.toggle('ready',accepted);
        }

        // 주기성·악기 음역·적응형 소음 문턱을 모두 통과한 경우만 표시한다.
        if(accepted){
          const nRaw=Math.round(69+12*Math.log2(tracked.freq/440));
          if(nRaw!==lastNote) hist.length=0;
          update(stabilize(tracked.freq));
          quietFrames=0;
        } else if(++quietFrames > 45) {
          quietFrames=0;
          idle();
        }
      }
    }catch(e){
      // 일시적인 iOS 오디오 경로 오류가 분석 루프 자체를 끝내지 않게 한다.
      if(!inputRecoveryUsed){
        inputRecoveryUsed=true;
        recoverMicGraph(micStartToken);
      }
    }finally{
      if(listening) requestAnimationFrame(analyse);
    }
  }

  /* ---------- 스트로보 회전 ---------- */
  // 마이크가 꺼져 있으면 돌 이유가 없다. 매 프레임 도는 것은 배터리만 먹는다.
  let strobeRunning=false;

  /* 값이 목표로 곧장 튀지 않고 지수적으로 다가가게 한다.
     0.10초면 발광이 빠르게 따라오면서도 프레임 사이가 딱딱해 보이지 않는다. */
  const TAU = 0.10;
  const SPIN_FULL = 330;   // deg/s. 약 24센트 어긋나면 최대 밝기에 닿는다.

  /* ---------- 링 안쪽을 구르는 올리브 ----------
     파선 링의 안쪽 가장자리(반지름 63.5)에 올리브가 얹혀 구른다.
     음이름 원판을 투명하게 뒀으므로 글자 뒤로 지나가도 잘리지 않는다.
     미끄러지지 않는다면 자전은 바퀴의 8배가 되는데, 그 속도로는 그냥 뭉개져 보인다.
     보고 즐기라고 넣은 것이니 기어를 내려 눈이 따라갈 만한 속도로 돌린다. */
  const WHEEL = { ri:63.5, orx:18.2, ory:15.0, rungs:12, gear:2.8 };
  let oliveSpin = 0;

  function drawOlive(vel){
    // 바퀴가 도는 만큼 올리브가 반대로 구른다
    oliveSpin = (strobeAngle * WHEEL.gear) % 360;

    // 파선 마디가 하나씩 밑을 지날 때마다 턱에 걸리듯 살짝 들린다.
    // 매번 똑같이 튀면 기계 같아서, 마디마다 세기를 조금씩 다르게 준다.
    const step  = 360 / WHEEL.rungs;
    const idx   = Math.floor(((strobeAngle % 360) + 360) % 360 / step);
    const phase = (((strobeAngle % step) + step) % step) / step;
    // 살 위를 타고 넘는다. max()로 자르면 살에 닿기 직전이 뚝 끊겨 순간이동처럼 보인다.
    // 제곱만 하면 양쪽으로 매끄럽게 오르내린다.
    const ride  = Math.pow(Math.cos(Math.PI*phase), 2);
    const jag   = 1 + 0.8*((idx*5 % 7 < 2) ? 1 : 0);                   // 가끔 크게 걸린다
    const force = Math.min(1, Math.abs(vel)/120);                      // 느리면 얌전하다

    // 많이 어긋나 바퀴가 빨리 돌면 살이 1초에 수십 개씩 지나간다.
    // 화면이 못 따라가 그냥 지직거리는 잡음이 되고, 실제로도 그쯤이면
    // 올리브가 살을 하나하나 타넘지 못하고 스치듯 지나간다. 그래서 잦아들게 둔다.
    const dashHz = Math.abs(vel) / step;
    const damp   = Math.max(0, Math.min(1, (14 - dashHz)/9));

    const hop   = ride * jag * force * damp * 1.7;

    const cy = 86 + (WHEEL.ri - WHEEL.ory - hop);
    strobeOlive.setAttribute('transform',
      `translate(86 ${cy.toFixed(2)}) rotate(${oliveSpin.toFixed(1)})`);
  }
  drawOlive(0);

  function strobeLoop(ts){
    if(!strobeLast) strobeLast=ts;
    const dt=Math.min((ts-strobeLast)/1000, 0.05);
    strobeLast=ts;

    const vel = listening ? strobeCents*14 : 0;      // deg/s, 부호가 방향
    strobeAngle=(strobeAngle+vel*dt)%360;
    strobeRing.style.transform=`rotate(${strobeAngle}deg)`;
    drawOlive(vel);

    // 속도를 밝기로. 제곱근 쪽으로 굽혀야 작은 어긋남도 눈에 들어온다.
    const tSpin = listening ? Math.pow(Math.min(1, Math.abs(vel)/SPIN_FULL), 0.62) : 0;
    const tLock = (listening && strobe.classList.contains('in-tune')) ? 1 : 0;

    const k = 1 - Math.exp(-dt/TAU);
    spin += (tSpin-spin)*k;
    lock += (tLock-lock)*k;
    strobe.style.setProperty('--spin', spin.toFixed(3));
    strobe.style.setProperty('--lock', lock.toFixed(3));

    // 마이크를 끄면 곧장 멈추지 않고 잦아든 뒤에 루프를 놓는다
    if(!listening && spin<0.004 && lock<0.004){
      spin=0; lock=0;
      strobe.style.setProperty('--spin','0');
      strobe.style.setProperty('--lock','0');
      strobeRunning=false; strobeLast=0;
      return;
    }
    requestAnimationFrame(strobeLoop);
  }
  function startStrobe(){
    if(strobeRunning) return;
    strobeRunning=true; strobeLast=0;
    requestAnimationFrame(strobeLoop);
  }

  /* ---------- 마이크 ---------- */
  function stopMic(message='마이크 꺼짐'){
    if(!listening && !micStarting && !stream) return;
    micStartToken++;
    listening=false;
    micStarting=false;
    // 트랙을 완전히 멈춰 마이크를 놓아준다 → iOS "사용중" 표시가 꺼진다.
    if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
    disconnectMicGraph();
    micRecovering=false; inputRecoveryUsed=false; zeroInputSince=0;
    bandNoiseProfile.reset(); pitchTracker.reset(); spectralFrame=0;
    toneActivityDetector.reset();
    signalGate.reset();
    setAudioSession('ambient');
    // play-and-record에서 돌아온 컨텍스트는 state가 running이어도 무음일 수 있다.
    // 메트로놈은 다음 탭에서 새 ambient 컨텍스트로 시작하게 한다.
    releaseCtx();
    startStrobe();
    setTabSounding('tuner',false,'mic');
    tunerStart.classList.remove('starting','on');
    tunerStart.setAttribute('aria-label','마이크 켜기');
    tunerStart.setAttribute('aria-pressed','false');
    tunerStart.setAttribute('aria-busy','false');
    idle();
    tunerFreq.textContent=message;
    inLevel=0;
    if(levelEl){
      levelEl.style.transform='scaleX(0)';
      levelEl.classList.remove('ready');
    }
    resetScope();
  }
  registerTransport({ isPlaying:()=>listening || micStarting, stop:stopMic });

  // 튜너가 아닌 다른 탭으로 넘어가면 마이크를 자동으로 끈다
  document.querySelectorAll('.tab-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(b.dataset.tab !== 'tuner') stopMic();
      else if(!listening && !micStarting) requestAnimationFrame(()=>resetScope());
    });
  });

  // 감도 슬라이더 — 실시간으로 게이트를 조절. 손잡이 더블클릭/더블탭이면 기본값.
  const sensEl = document.getElementById('tunerSens');
  if(sensEl){
    sensEl.addEventListener('input', ()=> setSens(sensEl.value));
    // 손잡이(thumb)를 정확히 누르면 range의 click은 드래그로 취급돼 안 뜬다.
    // 손잡이 위에서도 잡히도록 pointerdown 두 번(400ms 이내)으로 더블탭을 감지한다.
    let sensTapLast = -1e9;   // 첫 탭이 오검출되지 않도록 먼 과거로 초기화
    sensEl.addEventListener('pointerdown', ()=>{
      const now = performance.now();
      if(now - sensTapLast < 400){ setSens(SENS_DEFAULT); sensTapLast = -1e9; }
      else sensTapLast = now;
    });
    setSens(SENS_DEFAULT);
  }

  window.OlivePreferences.register('tuner',
    ()=>({
      tuning:currentTuning,
      sensitivity:sensEl ? Number(sensEl.value) : SENS_DEFAULT,
    }),
    value=>{
      if(!value || typeof value!=='object') return;
      const tuningIndex=TUNING_ORDER.indexOf(value.tuning);
      if(tuningIndex>=0){
        currentTuning=TUNING_ORDER[tuningIndex];
        tunerTuningDD.set(tuningIndex);
        renderStringButtons();
      }
      setSens(value.sensitivity);
    }
  );

  tunerStart.addEventListener('click', async ()=>{
    if(listening || micStarting){ stopMic(); return; }
    const token=++micStartToken;
    let requestedStream=null;
    micStarting=true;
    tunerStart.classList.add('starting');
    tunerStart.setAttribute('aria-label','마이크 연결 취소');
    tunerStart.setAttribute('aria-pressed','false');
    tunerStart.setAttribute('aria-busy','true');
    tunerFreq.textContent='마이크 연결 중…';
    resetScope('연결 중');
    try{
      setAudioSession('play-and-record');
      // 사용자 탭 안에서 먼저 컨텍스트를 활성화해 iOS 자동재생 제한을 통과한다.
      await ensureCtx('play-and-record',true);
      if(token!==micStartToken || !micStarting){ releaseCtx(); return; }

      requestedStream=await navigator.mediaDevices.getUserMedia({audio:{
        echoCancellation:false, noiseSuppression:false, autoGainControl:false
      }});
      if(token!==micStartToken || !micStarting){
        requestedStream.getTracks().forEach(t=>t.stop());
        releaseCtx();
        return;
      }
      stream=requestedStream;
      requestedStream=null;

      // 마이크가 실제로 열린 뒤 컨텍스트를 다시 만들어 오디오 경로 변경 중 생긴
      // interrupted 및 running-but-silent 상태를 제거한다.
      const ctx=await ensureCtx('play-and-record',true);
      if(token!==micStartToken || !micStarting){ stopMic(); return; }
      buildMicGraph(ctx);
      inputRecoveryUsed=false;
      zeroInputSince=0;
      scopeDrawingDisabled=false;

      listening=true;
      micStarting=false;
      setTabSounding('tuner', true, 'mic');
      tunerStart.classList.remove('starting');
      tunerStart.classList.add('on');
      tunerStart.setAttribute('aria-label','마이크 끄기');
      tunerStart.setAttribute('aria-pressed','true');
      tunerStart.setAttribute('aria-busy','false');
      tunerFreq.textContent='연주해보세요';
      resetScope('입력 측정 중');
      stream.getAudioTracks().forEach(track=>{
        track.addEventListener('ended',()=>{
          if(listening && token===micStartToken) stopMic('마이크 연결 끊김');
        },{once:true});
        track.addEventListener('mute',()=>{
          if(listening && token===micStartToken && scopeStateEl){
            scopeStateEl.textContent='마이크 입력 대기 중';
            scopeStateEl.classList.remove('active');
          }
        });
        track.addEventListener('unmute',()=>{
          if(listening && token===micStartToken){
            zeroInputSince=0;
            if(scopeStateEl) scopeStateEl.textContent='입력 측정 중';
          }
        });
      });
      requestAnimationFrame(analyse);
      startStrobe();
    }catch(err){
      if(requestedStream) requestedStream.getTracks().forEach(t=>t.stop());
      if(token!==micStartToken) return;
      const message = err && err.name==='NotAllowedError' ? '마이크 권한 거부됨'
        : err && err.name==='NotReadableError' ? '마이크가 다른 앱에서 사용 중'
        : err && err.name==='NotFoundError' ? '사용 가능한 마이크 없음'
        : '오디오 연결 실패 · 다시 눌러주세요';
      stopMic(message);
    }
  });
})();

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

  let currentTuning='guitar';
  let listening=false, micStarting=false, micStartToken=0;
  let stream=null, analyser=null, buf=null, srcNode=null;
  let micChain=[];              // 껐을 때 확실히 끊기 위해 들고 있는다
  let strobeCents=0, strobeAngle=0, strobeLast=0;
  let spin=0, lock=0;            // 화면에 실제로 그려지는 값. 목표를 향해 천천히 따라간다.
  let lastNote=null, quietFrames=0, inLevel=0;
  let freqLo=70, freqHi=1400;   // 선택된 튜닝에 따라 정해진다

  /* 감도(민감도): 슬라이더 0~100 → clarity 게이트 0.95~0.61 (기본 50=0.78 중심).
     값이 클수록 게이트가 낮아 더 예민하게 잡는다(조용한 곳).
     값이 작으면 게이트가 높아 소음 환경에서 오검출이 준다.
     양 끝 차이가 눈에 띄도록 폭을 ±0.17로 넓혔다. */
  const SENS_DEFAULT = 50;
  let clarityGate = 0.78;
  function setSens(v){
    if(!Number.isFinite(Number(v))) return;
    v = Math.max(0, Math.min(100, Math.round(v)));
    clarityGate = 0.78 + ((50 - v)/100)*0.34;
    const el = document.getElementById('tunerSens');
    const val = document.getElementById('tunerSensVal');
    if(el) el.value = v;
    if(val) val.textContent = v;
    window.OlivePreferences.changed();
  }

  /* =========================================================
     YIN 피치 검출 (de Cheveigné & Kawahara, 2002)
     모노포닉 악기 피치 검출의 표준. 옥타브 오류에 강하다.
     차분함수는 FFT 기반으로 계산해 O(n log n)으로 낮춘다.
     ========================================================= */
  const N = 4096;          // 분석 창 (저음 E 82Hz도 여유 있게 담긴다)
  const W = N >> 1;        // 적분 구간 = 최대 지연(tau)
  const FS = 8192;         // FFT 크기 (>= N + W)
  const YIN_THRESHOLD = 0.15;

  // ---- radix-2 FFT ----
  const LEVELS = Math.round(Math.log2(FS));
  const cosT = new Float32Array(FS/2), sinT = new Float32Array(FS/2);
  for(let i=0;i<FS/2;i++){ cosT[i]=Math.cos(2*Math.PI*i/FS); sinT[i]=Math.sin(2*Math.PI*i/FS); }
  const revT = new Uint16Array(FS);
  for(let i=0;i<FS;i++){ let j=0,x=i; for(let k=0;k<LEVELS;k++){ j=(j<<1)|(x&1); x>>=1; } revT[i]=j; }

  function fft(re, im){
    for(let i=0;i<FS;i++){
      const j=revT[i];
      if(j>i){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; }
    }
    for(let sz=2; sz<=FS; sz<<=1){
      const half=sz>>1, step=FS/sz;
      for(let i=0;i<FS;i+=sz){
        for(let j=i,k=0;j<i+half;j++,k+=step){
          const l=j+half;
          const tre= re[l]*cosT[k] + im[l]*sinT[k];
          const tim=-re[l]*sinT[k] + im[l]*cosT[k];
          re[l]=re[j]-tre; im[l]=im[j]-tim;
          re[j]+=tre;      im[j]+=tim;
        }
      }
    }
  }
  function ifft(re, im){
    for(let i=0;i<FS;i++) im[i]=-im[i];
    fft(re, im);
    const inv=1/FS;
    for(let i=0;i<FS;i++){ re[i]*=inv; im[i]*=-inv; }
  }

  // 작업 버퍼 (매 프레임 재할당하지 않는다)
  const aRe=new Float32Array(FS), aIm=new Float32Array(FS);
  const bRe=new Float32Array(FS), bIm=new Float32Array(FS);
  const diff=new Float32Array(W), cmnd=new Float32Array(W);
  const cum=new Float32Array(N+1);

  function yin(x, sampleRate){
    // --- 진폭 게이트: 무음이면 즉시 반환 ---
    let rms=0;
    for(let i=0;i<N;i++) rms += x[i]*x[i];
    rms=Math.sqrt(rms/N);
    if(rms < 0.0015) return null;   // 실측: 이 아래는 YIN도 못 잡는다. 위로는 암소음 오검출 0건

    // --- 교차상관을 FFT로 (a=앞 W샘플, b=전체 N샘플) ---
    aRe.fill(0); aIm.fill(0); bRe.fill(0); bIm.fill(0);
    for(let i=0;i<W;i++) aRe[i]=x[i];
    for(let i=0;i<N;i++) bRe[i]=x[i];
    fft(aRe,aIm); fft(bRe,bIm);
    // conj(A) * B
    for(let i=0;i<FS;i++){
      const ar=aRe[i], ai=-aIm[i], br=bRe[i], bi=bIm[i];
      aRe[i]=ar*br - ai*bi;
      aIm[i]=ar*bi + ai*br;
    }
    ifft(aRe,aIm);   // aRe[tau] = sum_j x[j]*x[j+tau]

    // --- 제곱합 누적 (P2를 O(1)로 얻기 위해) ---
    cum[0]=0;
    for(let i=0;i<N;i++) cum[i+1]=cum[i]+x[i]*x[i];
    const P1=cum[W];

    // --- 차분함수 d(tau) ---
    for(let tau=0; tau<W; tau++){
      const P2 = cum[tau+W]-cum[tau];
      diff[tau] = P1 + P2 - 2*aRe[tau];
      if(diff[tau] < 0) diff[tau]=0;
    }

    // --- 누적평균 정규화 (YIN의 핵심: 옥타브 오류를 막는다) ---
    cmnd[0]=1;
    let running=0;
    for(let tau=1; tau<W; tau++){
      running += diff[tau];
      cmnd[tau] = running>0 ? diff[tau]*tau/running : 1;
    }

    // --- 절대 임계값: 임계 아래 첫 국소최소 ---
    const minTau = Math.floor(sampleRate/1500);  // 상한 1500Hz
    const maxTau = Math.min(W-2, Math.floor(sampleRate/28)); // 하한 28Hz
    let tauEst=-1;
    for(let tau=minTau; tau<=maxTau; tau++){
      if(cmnd[tau] < YIN_THRESHOLD){
        while(tau+1<=maxTau && cmnd[tau+1] < cmnd[tau]) tau++;
        tauEst=tau; break;
      }
    }
    if(tauEst===-1){
      // 임계 미달이면 전역 최소로 대체
      let best=Infinity;
      for(let tau=minTau; tau<=maxTau; tau++){
        if(cmnd[tau]<best){ best=cmnd[tau]; tauEst=tau; }
      }
      if(tauEst===-1 || best>0.55) return null;   // 신뢰도 부족
    }

    // --- 배수 되짚기 ---
    // 차분함수는 참주기뿐 아니라 그 배수마다 골이 생기고, 그 깊이가 서로 비슷하다.
    // (실측: E4에서 134·267·401·535·669 모두 0.13~0.20) 임계값을 어느 골이 먼저
    // 넘느냐는 운에 가까워서, 배수 쪽이 걸리면 몇 옥타브씩 낮게 잡힌다.
    // 골이 비슷하게 깊다면 가장 짧은 주기가 진짜다.
    {
      let sel = tauEst;
      for(let k=2; k<=8; k++){
        const t2 = Math.round(tauEst/k);
        if(t2 < minTau) break;
        let cand = t2;
        for(let j=Math.max(minTau,t2-2); j<=Math.min(maxTau,t2+2); j++)
          if(cmnd[j] < cmnd[cand]) cand = j;
        // 절대 상한을 같이 둬야, 진짜 저음일 때 엉뚱하게 접히지 않는다
        if(cmnd[cand] < Math.min(0.40, cmnd[tauEst] + 0.16)) sel = cand;
      }
      tauEst = sel;
    }

    // --- 포물선 보간: 샘플 사이 정밀도를 얻어 센트 단위 해상도를 확보 ---
    let better=tauEst;
    if(tauEst>0 && tauEst<W-1){
      const s0=cmnd[tauEst-1], s1=cmnd[tauEst], s2=cmnd[tauEst+1];
      const denom=2*(2*s1-s2-s0);
      if(Math.abs(denom)>1e-12) better = tauEst + (s2-s0)/denom;
    }
    if(better<=0) return null;

    return { freq: sampleRate/better, clarity: 1-cmnd[tauEst] };
  }

  /* ---------- 안정화: 중앙값 + 지수 평활 ---------- */
  const hist=[];
  let smoothCents=0, haveLock=false, wasInTune=false;
  function stabilize(freq){
    hist.push(freq);
    if(hist.length>3) hist.shift();     // 5개는 지연이 200ms나 됐다
    const s=hist.slice().sort((a,b)=>a-b);
    return s[s.length>>1];              // 중앙값 — 튀는 값 제거
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
    smoothCents = jumped ? cents : smoothCents + (cents-smoothCents)*0.45;
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
    tunerNote.textContent='--';
    tunerFreq.textContent='연주해보세요';
    strobeCents=0;
    strobe.classList.remove('in-tune');
    strobeDir.textContent='— 조율 대기 —';
    stringBtns.querySelectorAll('.string-btn').forEach(b=>b.classList.remove('match'));
  }

  /* ---------- 분석 루프 (25Hz로 제한 — 60fps로 돌릴 이유가 없다) ---------- */
  let lastRun=0;
  function analyse(ts){
    if(!listening) return;
    if(ts-lastRun > 22){                 // 25Hz -> 45Hz
      lastRun=ts;
      analyser.getFloatTimeDomainData(buf);
      // 입력 세기 (마이크가 소리를 받고 있는지 눈으로 확인할 수 있게)
      let rms=0;
      for(let i=0;i<buf.length;i+=4) rms+=buf[i]*buf[i];
      rms=Math.sqrt(rms/(buf.length/4));
      inLevel = inLevel*0.7 + Math.min(1, rms*14)*0.3;
      if(levelEl) levelEl.style.transform='scaleX('+inLevel.toFixed(3)+')';

      const r=yin(buf, audioCtx.sampleRate);
      // 선풍기·에어컨은 '음정이 있는' 소음이라 게이트로는 못 거른다.
      // 주기성(clarity)과 악기의 실제 음역으로 판별한다. (실측: 소음 오검출 0/40)
      // 배수 되짚기로 값이 안정돼서 게이트를 조금 올릴 여유가 생겼다.
      // 실측(신호 480 · 소음 200): 0.72는 검출 66%/틀린음 18, 0.78은 53%/7.
      // 분석이 초당 45번 도니 53%면 초당 24번 갱신 — 눈에는 끊김 없이 이어진다.
      // 검출률보다 틀린 값이 덜 뜨는 쪽이 튜닝에는 낫다.
      if(r && r.clarity>clarityGate && r.freq>freqLo && r.freq<freqHi){
        const nRaw=Math.round(69+12*Math.log2(r.freq/440));
        if(nRaw!==lastNote) hist.length=0;   // 다른 음이면 이력을 비워 즉시 반응
        update(stabilize(r.freq));
        quietFrames=0;
      } else {
        // 소리가 끊기면 잠시 뒤 대기 상태로 (마지막 값이 계속 떠 있지 않게)
        if(++quietFrames > 45) { quietFrames=0; idle(); }
      }
    }
    requestAnimationFrame(analyse);
  }

  /* ---------- 스트로보 회전 ---------- */
  // 마이크가 꺼져 있으면 돌 이유가 없다. 매 프레임 도는 것은 배터리만 먹는다.
  let strobeRunning=false;

  /* 값이 목표로 곧장 튀지 않고 지수적으로 다가가게 한다.
     TAU가 크면 굼뜨고 작으면 딱딱하다. 0.13초면 대략 3~4프레임 안에 반쯤 따라가
     '서서히 변한다'고 느끼면서도 굼뜨지 않는다. */
  const TAU = 0.13;
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
    micChain.forEach(n=>{ try{ n.disconnect(); }catch(e){} });
    micChain=[]; srcNode=null; analyser=null;
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
    if(levelEl) levelEl.style.transform='scaleX(0)';
  }
  registerTransport({ isPlaying:()=>listening || micStarting, stop:stopMic });

  // 튜너가 아닌 다른 탭으로 넘어가면 마이크를 자동으로 끈다
  document.querySelectorAll('.tab-btn').forEach(b=>{
    b.addEventListener('click', ()=>{ if(b.dataset.tab !== 'tuner') stopMic(); });
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
      srcNode=ctx.createMediaStreamSource(stream);

      // 대역 제한: 럼블과 고차 배음을 걷어내 검출 안정성을 높인다
      const hp=ctx.createBiquadFilter();
      hp.type='highpass'; hp.frequency.value=55; hp.Q.value=0.7;
      const lp=ctx.createBiquadFilter();
      lp.type='lowpass';  lp.frequency.value=2200; lp.Q.value=0.7;

      analyser=ctx.createAnalyser();
      analyser.fftSize=N;
      analyser.smoothingTimeConstant=0;
      buf=new Float32Array(N);

      // 기기 마이크가 조용한 경우가 많아 분석 전에 키워준다.
      // YIN은 신호 크기와 무관하지만 게이트 통과와 수치 정밀도에 도움이 된다.
      const boost=ctx.createGain();
      boost.gain.value=4;

      srcNode.connect(hp); hp.connect(lp); lp.connect(boost); boost.connect(analyser);
      micChain=[srcNode, hp, lp, boost, analyser];

      listening=true;
      micStarting=false;
      setTabSounding('tuner', true, 'mic');
      tunerStart.classList.remove('starting');
      tunerStart.classList.add('on');
      tunerStart.setAttribute('aria-label','마이크 끄기');
      tunerStart.setAttribute('aria-pressed','true');
      tunerStart.setAttribute('aria-busy','false');
      tunerFreq.textContent='연주해보세요';
      stream.getAudioTracks().forEach(track=>{
        track.addEventListener('ended',()=>{
          if(listening && token===micStartToken) stopMic('마이크 연결 끊김');
        },{once:true});
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


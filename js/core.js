/* ===================== 공통 유틸 ===================== */
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function midiToName(midi){ return NOTE_NAMES[((midi%12)+12)%12] + (Math.floor(midi/12)-1); }
function midiToFreq(midi){ return 440 * Math.pow(2, (midi-69)/12); }
function pcName(pc){ return NOTE_NAMES[((pc%12)+12)%12]; }

/* 앱의 연습 설정은 기능별 제공자가 자기 상태를 읽고 적용한다.
   변경 즉시 로컬에 저장하고, 로그인 중이면 cloud-sync.js가 같은 레코드를 자동 전송한다. */
(function(){
  const KEY='olive-preferences-v1';
  const providers=new Map();
  let applying=false, saveTimer=null;

  function read(){
    try{
      const value=JSON.parse(localStorage.getItem(KEY)||'null');
      if(!value || typeof value!=='object' || Array.isArray(value)) return {data:{},updatedAt:''};
      return {
        data:value.data && typeof value.data==='object' && !Array.isArray(value.data) ? value.data : {},
        updatedAt:typeof value.updatedAt==='string' ? value.updatedAt : '',
      };
    }catch(e){ return {data:{},updatedAt:''}; }
  }
  function write(record){
    try{ localStorage.setItem(KEY,JSON.stringify(record)); return true; }
    catch(e){ return false; }
  }
  function capture(){
    const data={};
    providers.forEach((provider,name)=>{
      try{ data[name]=provider.get(); }catch(e){}
    });
    return data;
  }
  function save(){
    if(applying) return;
    const record={data:capture(),updatedAt:new Date().toISOString()};
    if(write(record)){
      window.dispatchEvent(new CustomEvent('olive-preferences-change',{detail:record}));
    }
  }

  window.OlivePreferences={
    register(name,get,apply){
      providers.set(name,{get,apply});
      const record=read();
      if(Object.prototype.hasOwnProperty.call(record.data,name)){
        applying=true;
        try{ apply(record.data[name]); }catch(e){}
        finally{ applying=false; }
      }
    },
    changed(){
      if(applying) return;
      clearTimeout(saveTimer);
      saveTimer=setTimeout(save,160);
    },
    getRecord:read,
    applyRecord(data,updatedAt){
      if(!data || typeof data!=='object' || Array.isArray(data)) return;
      applying=true;
      try{
        providers.forEach((provider,name)=>{
          if(Object.prototype.hasOwnProperty.call(data,name)) provider.apply(data[name]);
        });
        write({data,updatedAt:typeof updatedAt==='string'?updatedAt:new Date().toISOString()});
      }finally{ applying=false; }
    },
    clearLocal(){
      clearTimeout(saveTimer);
      try{ localStorage.removeItem(KEY); }catch(e){}
    },
  };
})();

/* iOS 네이티브 select은 휠 피커로 열려 옵션 안을 좌우로 나눌 수 없다.
   그래서 직접 만든다. items: [{main, sub}] — main은 왼쪽, sub는 오른쪽. */
function splitParen(label){
  const m=/^(.*?)\s*\((.+)\)\s*$/.exec(label);
  return m ? {main:m[1], sub:m[2]} : {main:label, sub:''};
}
function makeSplitDropdown(mount, items, selected, onSelect){
  mount.classList.add('dd');
  mount.innerHTML='';
  const btn=document.createElement('button');
  btn.type='button'; btn.className='dd-btn';
  btn.setAttribute('aria-haspopup','listbox');
  btn.setAttribute('aria-expanded','false');
  btn.innerHTML='<span class="dd-main"></span><span class="dd-sub"></span>';
  const menu=document.createElement('div');
  menu.className='dd-menu'; menu.setAttribute('role','listbox'); menu.hidden=true;
  items.forEach((it,i)=>{
    const o=document.createElement('button');
    o.type='button'; o.className='dd-item'; o.setAttribute('role','option'); o.dataset.i=i;
    o.innerHTML='<span class="dd-main">'+it.main+'</span><span class="dd-sub">'+(it.sub||'')+'</span>';
    o.addEventListener('click', ()=>{ choose(i); close(); });
    menu.appendChild(o);
  });
  mount.appendChild(btn); mount.appendChild(menu);
  let cur=selected;
  function render(){
    btn.querySelector('.dd-main').textContent=items[cur].main;
    btn.querySelector('.dd-sub').textContent=items[cur].sub||'';
    btn.setAttribute('aria-label', items[cur].main + (items[cur].sub ? ' '+items[cur].sub : ''));
    menu.querySelectorAll('.dd-item').forEach((o,i)=>o.setAttribute('aria-selected', i===cur?'true':'false'));
  }
  const outside=e=>{ if(!mount.contains(e.target)) close(); };
  function open(){ menu.hidden=false; btn.setAttribute('aria-expanded','true');
    setTimeout(()=>document.addEventListener('pointerdown',outside),0); }
  function close(){ if(menu.hidden) return; menu.hidden=true; btn.setAttribute('aria-expanded','false');
    document.removeEventListener('pointerdown',outside); }
  function choose(i){ cur=i; render(); onSelect(i); }
  btn.addEventListener('click', ()=> menu.hidden ? open() : close());
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') close(); });
  render();
  return { set(i){ cur=i; render(); }, get:()=>cur, close };
}

function playTone(freq, duration=0.6, when=0, type='sine', gainVal=0.43){
  const ctx = getCtx();
  const t0 = ctx.currentTime + Math.max(when,0);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainVal, t0+0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0+duration);
  osc.connect(gain).connect(getMaster());
  osc.start(t0);
  osc.stop(t0+duration+0.05);
  return {osc, gain};
}
// level: 0 약 · 1 중(묶음 첫 박) · 2 강(마디 첫 박). true/false도 받는다.
function playClick(when, accent, preparedCtx){
  const lv = accent === true ? 2 : accent === false ? 0 : (accent|0);
  const ctx = preparedCtx || getCtx();
  const t0 = ctx.currentTime + Math.max(when,0);
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = lv===2 ? 1500 : lv===1 ? 1180 : 900;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(lv===2 ? 0.62 : lv===1 ? 0.50 : 0.40, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0+0.045);
  osc.connect(gain).connect(getMaster(ctx));
  osc.start(t0);
  osc.stop(t0+0.06);
}

/* ===================== 악기 음색 =====================
   싸구려로 들리는 원인은 대개 세 가지다.
   (1) 배음 구조가 단순하다  (2) 공간감이 없다  (3) 음마다 음량이 들쭉날쭉하다
   각각 물리 모델 · 리버브 · 실측 정규화로 해결한다.
   ===================================================== */

/* ---- 마스터: 드라이 + 리버브 센드 ---- */
let __master=null, __send=null;
function makeIR(ctx, dur, decay){
  const n=Math.floor(ctx.sampleRate*dur);
  const b=ctx.createBuffer(2,n,ctx.sampleRate);
  for(let ch=0; ch<2; ch++){
    const d=b.getChannelData(ch);
    for(let i=0;i<n;i++){
      const t=i/n;
      d[i]=(Math.random()*2-1)*Math.pow(1-t,decay);
    }
    // 초기 반사 — 이게 있어야 '방' 느낌이 난다
    [0.0113,0.0197,0.0291,0.0431,0.0617].forEach((tt,k)=>{
      const idx=Math.floor(tt*ctx.sampleRate*(1+ch*0.07));
      if(idx<n) d[idx]+=(0.55-k*0.09)*(Math.random()>0.5?1:-1);
    });
  }
  return b;
}
function getMaster(preparedCtx){
  const ctx=preparedCtx || getCtx();
  if(!__master){
    __master=ctx.createGain(); __master.gain.value=0.9;
    const comp=ctx.createDynamicsCompressor();
    comp.threshold.value=-15; comp.knee.value=24; comp.ratio.value=4.5;
    comp.attack.value=0.005; comp.release.value=0.25;
    __master.connect(comp).connect(ctx.destination);

    // 리버브 센드
    try{
      const conv=ctx.createConvolver();
      conv.buffer=makeIR(ctx,1.9,2.8);
      const wet=ctx.createGain(); wet.gain.value=0.5;
      const pre=ctx.createBiquadFilter();
      pre.type='highpass'; pre.frequency.value=260;   // 저역은 울리지 않게
      __send=ctx.createGain(); __send.gain.value=1;
      __send.connect(pre).connect(conv).connect(wet).connect(comp);
    }catch(e){ __send=null; }
  }
  return __master;
}
function sendTo(node, amount){
  if(!__send || !amount) return;
  const ctx=getCtx();
  const g=ctx.createGain(); g.gain.value=amount;
  node.connect(g).connect(__send);
}

/* ---- JS 바이쿼드 (버퍼를 미리 가공하고 음량을 실측하기 위해) ---- */
function __bq(type,f0,Q,gDb,sr){
  f0=Math.min(Math.max(f0,20),sr/2.2);
  const w=2*Math.PI*f0/sr,c=Math.cos(w),s=Math.sin(w),al=s/(2*Q),A=Math.pow(10,(gDb||0)/40);
  let b0,b1,b2,a0,a1,a2;
  if(type==='highpass'){b0=(1+c)/2;b1=-(1+c);b2=(1+c)/2;a0=1+al;a1=-2*c;a2=1-al;}
  else if(type==='peaking'){b0=1+al*A;b1=-2*c;b2=1-al*A;a0=1+al/A;a1=-2*c;a2=1-al/A;}
  else {b0=(1-c)/2;b1=1-c;b2=(1-c)/2;a0=1+al;a1=-2*c;a2=1-al;}
  return{b0:b0/a0,b1:b1/a0,b2:b2/a0,a1:a1/a0,a2:a2/a0};
}
function __filt(x,co){
  let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<x.length;i++){
    const v=co.b0*x[i]+co.b1*x1+co.b2*x2-co.a1*y1-co.a2*y2;
    x2=x1;x1=x[i];y2=y1;y1=v;x[i]=v;
  }
  return x;
}

/* ---- 어쿠스틱 기타 (Karplus-Strong + 통울림 포먼트) ----
   소수점 지연으로 음정을 정확히 맞추고(정수 반올림 시 최대 5센트 오차),
   드레드넛 바디의 공진(헬름홀츠 100Hz · 톱 204Hz · 중역 430Hz)을 얹는다.
   마지막에 '휴대폰 스피커가 실제로 낼 수 있는 대역'의 에너지를 재서 정규화하므로
   저음 6번줄과 고음 1번줄의 음량이 같아진다. */
const __gtrCache=new Map();
const __GTR_MAX=48;                 // 버퍼 하나가 수백 KB다. 무한정 쌓이게 두지 않는다.
function makeGuitarBuffer(ctx, freq, dur){
  const key=freq.toFixed(2)+'@'+dur;
  if(__gtrCache.has(key)){
    const b=__gtrCache.get(key);
    __gtrCache.delete(key); __gtrCache.set(key,b);   // 최근 쓴 것을 뒤로 (LRU)
    return b;
  }
  const sr=ctx.sampleRate, n=Math.floor(sr*dur);
  const buf=ctx.createBuffer(1,n,sr);
  const out=buf.getChannelData(0);

  const P=sr/freq, L=Math.max(4,Math.ceil(P)+2);
  const line=new Float32Array(L);
  // 낮은 음일수록 밝게 뜯어 스피커가 낼 수 있는 대역을 확보한다
  const lpAmt=0.62-0.30*Math.min(1,Math.max(0,(330-freq)/300));
  let p0=0;
  const fill=Math.min(L,Math.floor(P));
  for(let i=0;i<fill;i++){ const w=Math.random()*2-1; p0=p0*lpAmt+w*(1-lpAmt); line[i]=p0; }

  const delay=P-0.5;
  const damping=0.9995-Math.min(0.0035,9/P);
  let wp=fill%L, prev=0;
  for(let i=0;i<n;i++){
    const rp=wp-delay, r0=Math.floor(rp), fr=rp-r0;
    const a=line[((r0%L)+L)%L], b=line[(((r0+1)%L)+L)%L];
    const s=a+(b-a)*fr;
    out[i]=s;
    const f=(s+prev)*0.5*damping; prev=s; line[wp]=f; wp=(wp+1)%L;
  }
  const fade=Math.min(3000,(n/8)|0);
  for(let i=0;i<fade;i++) out[n-1-i]*=i/fade;

  // 통울림
  __filt(out,__bq('peaking',100,1.2,5,sr));
  __filt(out,__bq('peaking',204,1.6,4,sr));
  __filt(out,__bq('peaking',430,1.4,3,sr));
  __filt(out,__bq('lowpass',4800,0.7,0,sr));
  __filt(out,__bq('highpass',75,0.7,0,sr));

  // 스피커 대역(300Hz 이상) 에너지를 실측해 정규화 → 음역 전체 음량 통일
  const probe=Float32Array.from(out);
  __filt(probe,__bq('highpass',300,0.7,0,sr));
  __filt(probe,__bq('highpass',300,0.7,0,sr));
  let e=0; for(let i=0;i<probe.length;i++) e+=probe[i]*probe[i];
  const level=Math.sqrt(e/probe.length);
  const g=Math.min(3.5, 0.05/Math.max(level,1e-6));
  let pk=0; for(let i=0;i<n;i++){ const v=Math.abs(out[i]*g); if(v>pk) pk=v; }
  const k=g*Math.min(1, 0.85/Math.max(pk,1e-6));
  for(let i=0;i<n;i++) out[i]*=k;

  __gtrCache.set(key,buf);
  if(__gtrCache.size>__GTR_MAX) __gtrCache.delete(__gtrCache.keys().next().value);
  return buf;
}
function guitarPluck(midi, dur=2.4, vol=0.62){
  const ctx=getCtx(), t=ctx.currentTime+0.005;
  const src=ctx.createBufferSource();
  src.buffer=makeGuitarBuffer(ctx, midiToFreq(midi), dur);
  const g=ctx.createGain(); g.gain.value=vol;
  src.connect(g).connect(getMaster());
  sendTo(g, 0.24);
  src.start(t); src.stop(t+dur+0.05);
}
function referenceTone(midi, dur=2.6){ guitarPluck(midi, dur, 0.78); }

/* ---- 어쿠스틱 피아노 ----
   실제 피아노는 한 음에 현이 2~3개이고 서로 미세하게 어긋나 있다.
   그 맥놀이가 '두껍고 살아있는' 소리를 만든다. 여기에
   현 강성에 의한 비조화성과, 고차 배음이 먼저 사라지는 감쇠를 더한다. */
function pianoNote(midi, when, dur, vol=0.19){
  const ctx=getCtx();
  const t=(when!=null?when:ctx.currentTime)+0.004;
  const f0=midiToFreq(midi);
  const B=0.0004;
  const nyq=ctx.sampleRate/2.2;

  const bus=ctx.createGain(); bus.gain.value=vol;
  const tone=ctx.createBiquadFilter();
  tone.type='lowpass';
  tone.frequency.setValueAtTime(Math.min(7000, f0*16), t);
  tone.frequency.exponentialRampToValueAtTime(Math.max(700, f0*5), t+0.7); // 밝기가 가라앉는다
  tone.Q.value=0.5;
  tone.connect(bus);
  bus.connect(getMaster());
  sendTo(bus, 0.3);

  // 현 2개를 미세하게 어긋나게 (맥놀이)
  [-1, 1].forEach(side=>{
    const det=side*(1.2 + Math.random()*1.4);   // ±1.2~2.6센트
    for(let n=1;n<=14;n++){
      const fn=f0*n*Math.sqrt(1+B*n*n);
      if(fn>nyq) break;
      const amp=(1/Math.pow(n,1.18))*(n%2===0?0.82:1)*0.5;  // 홀수 배음이 조금 강하다
      if(amp<0.004) continue;
      const dec=Math.max(0.12, dur/(1+0.5*(n-1)));
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=fn; o.detune.value=det;
      g.gain.setValueAtTime(0.0001,t);
      g.gain.exponentialRampToValueAtTime(amp,t+0.006);
      g.gain.exponentialRampToValueAtTime(amp*0.30,t+Math.min(dec*0.32,0.35));
      g.gain.exponentialRampToValueAtTime(0.0001,t+dec);
      o.connect(g).connect(tone);
      o.start(t); o.stop(t+dec+0.06);
    }
  });

  // 해머 타건음
  const nb=ctx.createBuffer(1,Math.floor(ctx.sampleRate*0.03),ctx.sampleRate);
  const nd=nb.getChannelData(0);
  for(let i=0;i<nd.length;i++) nd[i]=(Math.random()*2-1)*Math.pow(1-i/nd.length,2.5);
  const ns=ctx.createBufferSource(); ns.buffer=nb;
  const nf=ctx.createBiquadFilter(); nf.type='bandpass';
  nf.frequency.value=Math.min(4200,f0*6); nf.Q.value=0.9;
  const ng=ctx.createGain();
  ng.gain.setValueAtTime(0.13,t);
  ng.gain.exponentialRampToValueAtTime(0.0001,t+0.05);
  ns.connect(nf).connect(ng).connect(tone);
  ns.start(t); ns.stop(t+0.06);
}
function pianoChord(midis, when, dur, vol=0.28){
  midis.forEach((m,i)=> pianoNote(m,(when||getCtx().currentTime)+i*0.010, dur, vol));
}

/* ===== 템포 조작 공통 =====
   메트로놈·리듬·잼이 같은 방식으로 동작하도록 한곳에 모은다. */

// 짧게 누르면 1, 길게 누르고 있으면 10씩 연속 변화
function bindTempoKeys(minusEl, plusEl, get, set){
  [[minusEl,-1],[plusEl,1]].forEach(([el,dir])=>{
    if(!el) return;
    let holdTimer=null, repTimer=null, didHold=false;
    const start=()=>{
      didHold=false;
      holdTimer=setTimeout(()=>{
        didHold=true;
        set(get()+dir*10);
        repTimer=setInterval(()=>set(get()+dir*10), 150);
      }, 450);
    };
    const end=()=>{ clearTimeout(holdTimer); clearInterval(repTimer); holdTimer=repTimer=null; };
    el.addEventListener('pointerdown', e=>{ e.preventDefault(); start(); });
    el.addEventListener('pointerup', ()=>{ if(!didHold) set(get()+dir); end(); });
    el.addEventListener('pointerleave', end);
    el.addEventListener('pointercancel', end);
  });
}

// 두드린 간격의 평균으로 템포를 잡는다
function bindTapTempo(el, set){
  if(!el) return;
  let taps=[];
  el.addEventListener('click', ()=>{
    const now=performance.now();
    taps.push(now);
    taps=taps.filter(t=>now-t<3000);
    if(taps.length>1){
      const iv=[];
      for(let i=1;i<taps.length;i++) iv.push(taps[i]-taps[i-1]);
      set(60000/(iv.reduce((a,b)=>a+b,0)/iv.length));
    }
  });
}

// 숫자를 두 번 누르면 기본값으로
function bindResetOnDouble(el, reset){
  if(!el) return;
  let last=0;
  const hit=()=>{
    const now=performance.now();
    if(now-last<400){ reset(); last=0; } else last=now;
  };
  el.addEventListener('click', hit);
  el.style.cursor='pointer';
  el.style.userSelect='none';
}

/* ===================== 탭 전환 ===================== */
const tabTitles = {metronome:'메트로놈', tuner:'튜너', scales:'스케일', trainer:'트레이너', jam:'잼 세션'};
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const id = btn.dataset.tab;
    const enteringTuner = id === 'tuner' && !btn.classList.contains('active');
    if(enteringTuner){
      // 튜닝을 방해하지 않도록 루프와 예약된 다음 문제를 모두 멈춘다.
      // 이미 오디오 클럭에 예약된 짧은 소리도 남지 않게 컨텍스트를 닫는다.
      stopAllTransports();
      if(audioCtx) releaseCtx();
    }
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tabpanel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-'+id).classList.add('active');
    document.getElementById('pageTitle').textContent = tabTitles[id];
    // main은 탭들이 공유하는 스크롤 컨테이너다. 긴 탭에서 내려둔 스크롤이
    // 짧은 탭으로 넘어오면 위가 잘려 보인다. 탭을 바꿀 때 맨 위로 올린다.
    const mainEl = document.querySelector('main');
    if(mainEl) mainEl.scrollTop = 0;
  });
});

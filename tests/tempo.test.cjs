const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const core=fs.readFileSync('js/core.js','utf8');
const jam=fs.readFileSync('js/jam-session.js','utf8');
const rhythm=fs.readFileSync('js/rhythm-trainer.js','utf8');
const metronome=fs.readFileSync('js/metronome.js','utf8');

/* ---------- 탭 템포 ----------
   쉬었다 다시 치면 처음부터 센다. 쉰 틈까지 평균에 넣으면 120으로 치다 2초쯤
   쉬고 다시 쳤을 때 41이 먼저 나와, 재생 중이면 빠르기가 출렁였다. */
{
  const source=core.match(/function bindTapTempo\(el, set\)\{[\s\S]*?\n\}/);
  assert.ok(source,'bindTapTempo is present');
  let now=0;
  const context={performance:{now:()=>now}};
  vm.createContext(context);
  vm.runInContext(source[0]+';this.bindTapTempo=bindTapTempo;',context);
  let handler=null;
  const values=[];
  context.bindTapTempo({addEventListener:(type,fn)=>{ if(type==='click') handler=fn; }},value=>values.push(Math.round(value)));
  const press=at=>{ now=at; handler(); };
  [0,500,1000,1500].forEach(press);                       // 120
  assert.deepEqual(values,[120,120,120]);
  values.length=0;
  [3900,4400,4900].forEach(press);                         // 2.4초 쉬고 다시 120
  assert.deepEqual(values,[120,120],'a pause starts a fresh count instead of averaging the gap');
  values.length=0;
  // 박이 느려지면(두 배를 넘는 간격) 새로 센다.
  [6000,6250,6500,7200,7900].forEach(press);
  assert.equal(values.at(-1),86,'slowing down by more than double restarts the count');
  // 최근 여섯 간격만 평균한다.
  values.length=0;
  let at=20000;
  for(let i=0;i<8;i++){ press(at); at+=600; }              // 100
  for(let i=0;i<7;i++){ press(at); at+=500; }              // 120으로 옮겨 감
  assert.equal(values.at(-1),120,'only the latest six intervals count');
}

/* ---------- 첫 소리 ----------
   막 열린 출력 경로의 첫 소리는 iOS가 작게 낸다. 메트로놈에서 고친 것을 잼과
   리듬에도 똑같이 건다. */
for(const [name,source] of [['metronome',metronome],['jam',jam],['rhythm',rhythm]]){
  assert.match(source,/primeAudioOutput\((ctx)\)/,`${name} primes the output path before its first sound`);
  assert.match(source,/noteStart\(ctx,/,`${name} gives a waking clock enough lead time`);
}

/* ---------- 잼 셔플 ----------
   셔플은 셋잇단이다. 뒷박이 박의 2/3 자리에 와야 한다. 예전에는 16분 넷째 칸을
   더 밀어 0.8 자리에 떨어졌다. */
{
  const style=jam.match(/shuffle:\{[\s\S]*?\n\s{4}\}/);
  assert.ok(style,'shuffle style is present');
  const hats=JSON.parse(style[0].match(/hat:(\[[^\]]*\])/)[1]);
  const shuffle=Function(`return ${style[0].match(/\bshuffle:(\d[^,}\s]*)/)[1]}`)();
  assert.match(jam,/st\.shuffle && stepCursor%4===2\) \? secPerStep\*st\.shuffle/);
  const offbeats=hats.filter(step=>step%4!==0).map(step=>(step%4+(step%4===2?shuffle:0))/4);
  assert.ok(offbeats.length>0);
  offbeats.forEach(position=>assert.ok(Math.abs(position-2/3)<1e-9,'shuffle offbeat lands on the triplet'));
}

/* ---------- 세분화 ----------
   재생 중에 고른 세분화는 다음 박 머리에서 갈아 끼운다(실제 박 위치는 e2e가 잰다). */
assert.match(metronome,/if\(pendingSub && currentStep % sub\.div === 0\)\{/);
assert.match(metronome,/currentStep = beat\*sub\.div;/);

console.log('tempo tests passed');

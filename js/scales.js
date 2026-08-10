/* ===================== 스케일 ===================== */
(function(){
  const SCALE_TYPES = {
    major:{label:'메이저 (Ionian)', intervals:[0,2,4,5,7,9,11]},
    minor:{label:'내추럴 마이너 (Aeolian)', intervals:[0,2,3,5,7,8,10]},
    majpent:{label:'메이저 펜타토닉', intervals:[0,2,4,7,9]},
    minpent:{label:'마이너 펜타토닉', intervals:[0,3,5,7,10]},
    blues:{label:'블루스', intervals:[0,3,5,6,7,10]},
    dorian:{label:'도리안', intervals:[0,2,3,5,7,9,10]},
    phrygian:{label:'프리지안', intervals:[0,1,3,5,7,8,10]},
    lydian:{label:'리디안', intervals:[0,2,4,6,7,9,11]},
    mixolydian:{label:'믹소리디안', intervals:[0,2,4,5,7,9,10]},
    locrian:{label:'로크리안', intervals:[0,1,3,5,6,8,10]},
    harmonicminor:{label:'하모닉 마이너', intervals:[0,2,3,5,7,8,11]},
    melodicminor:{label:'멜로딕 마이너', intervals:[0,2,3,5,7,9,11]},
  };
  const TUNINGS = {
    guitar:{strings:[40,45,50,55,59,64]},
    dropd:{strings:[38,45,50,55,59,64]},
    bass:{strings:[28,33,38,43]},
    ukulele:{strings:[67,60,64,69]},
    mandolin:{strings:[55,62,69,76]},
  };
  // 루트로부터의 반음 거리를 도수 표기로
  const DEGREE = ['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];

  const scaleKeyEl  = document.getElementById('scaleKey');
  const scaleTypeEl = document.getElementById('scaleType');
  const scaleTuneEl = document.getElementById('scaleTuning');
  const TUNE_LABEL={guitar:'기타 표준',dropd:'기타 드롭 D',bass:'베이스 4현',ukulele:'우쿨렐레',mandolin:'만돌린'};
  const TUNE_ORDER=['guitar','dropd','bass','ukulele','mandolin'];
  const SC_KEYS=Object.keys(SCALE_TYPES);
  let scaleRoot=0, scaleTypeKey=SC_KEYS[0], scaleTuneKey='guitar';
  const fretboard  = document.getElementById('fretboard');
  const fretScroll = document.getElementById('fretScroll');
  const fretZoom   = document.getElementById('fretZoom');
  const scaleNotesList = document.getElementById('scaleNotesList');

  // 맞춤: 화면 폭에 전부 담는다 / 확대: 고정 크기로 키우고 가로 스크롤
  // 맞춤: 전체를 화면 안에 / 확대: 보드 자체를 키우고 좌우로 밀어 본다
  const ZOOMS = [
    {key:'fit',  label:'맞춤', visible:null},  // 들어가는 만큼 전부
    {key:'zoom', label:'확대', visible:8},     // 화면에 8칸만 채우고 나머지는 스크롤
  ];
  let zoom = 'fit';

  const scaleKeyDD=makeSplitDropdown(scaleKeyEl, Array.from({length:12},(_,i)=>({main:pcName(i),sub:''})),
    0, i=>{ scaleRoot=i; render(); window.OlivePreferences.changed(); });
  const SCALE_EN = {
    major:'Ionian', minor:'Aeolian',
    majpent:'Major Pent.', minpent:'Minor Pent.',
    blues:'Blues', dorian:'Dorian', phrygian:'Phrygian', lydian:'Lydian',
    mixolydian:'Mixolydian', locrian:'Locrian',
    harmonicminor:'Harmonic Min.', melodicminor:'Melodic Min.',
  };
  const scaleTypeDD=makeSplitDropdown(scaleTypeEl,
    SC_KEYS.map(k=>({ main:splitParen(SCALE_TYPES[k].label).main, sub:SCALE_EN[k]||'' })),
    0, i=>{ scaleTypeKey=SC_KEYS[i]; render(); window.OlivePreferences.changed(); });
  const scaleTuneDD=makeSplitDropdown(scaleTuneEl, TUNE_ORDER.map(k=>({main:TUNE_LABEL[k], sub:TUNINGS[k].strings.map(m=>pcName(m)).join('')})),
    0, i=>{ scaleTuneKey=TUNE_ORDER[i]; render(); window.OlivePreferences.changed(); });
  ZOOMS.forEach(z=>{
    const b=document.createElement('button');
    b.className='pill'+(z.key===zoom?' active':'');
    b.textContent=z.label; b.dataset.zoom=z.key;
    b.addEventListener('click', ()=>{
      zoom=z.key;
      fretZoom.querySelectorAll('.pill').forEach(x=>x.classList.toggle('active', x.dataset.zoom===zoom));
      render();
      window.OlivePreferences.changed();
    });
    fretZoom.appendChild(b);
  });

  // 맞춤 모드: 읽을 수 있는 최소 칸 크기(26px)를 지키면서 들어갈 만큼만 프렛을 보인다
  function layout(){
    const z   = ZOOMS.find(x=>x.key===zoom);
    const gap = 3;
    // clientWidth에는 좌우 패딩이 포함되고, .fretboard 자체도 1px씩 패딩이 있다
    const w   = (fretScroll.clientWidth || 330) - 6;

    if(z.visible){
      // 확대: 화면 폭을 z.visible칸이 꽉 채우도록 칸을 키운다.
      // 프렛은 15까지 모두 그리므로 좌우로 밀어서 볼 수 있다 = 보드가 확대된 것.
      const cell = Math.floor((w - gap*(z.visible-1)) / z.visible);
      return {cell, frets:15};   // 1~15프렛, 화면엔 z.visible칸만 보이고 나머지는 스크롤
    }
    // 맞춤: 1~15프렛을 화면 안에 전부 담는다.
    // 0프렛은 그리지 않는다 — 개방현은 맨 왼쪽 현 이름이 그 역할을 한다.
    const FIT_FRETS = 15;
    const cols = FIT_FRETS + 1;           // 현 이름 라벨 1칸 + 1~15프렛
    const cell = Math.floor((w - gap*(cols-1)) / cols);
    return {cell, frets: FIT_FRETS};
  }

  /* 한 옥타브 피아노. 스케일에 든 건반만 세이지로 칠하고 루트를 가장 진하게.
     아이폰에서 누르기 좋게 흰건반 7개가 카드 폭을 꽉 채운다. */
  const WHITE_PC = [0,2,4,5,7,9,11];
  const BLACK = [ {pc:1,after:0}, {pc:3,after:1}, {pc:6,after:3}, {pc:8,after:4}, {pc:10,after:5} ];
  function renderPiano(rootPc, scaleSet){
    scaleNotesList.className='piano';
    scaleNotesList.innerHTML='';
    const bw = 'calc(100% / 7 * 0.58)';
    const mk = (pc, black) => {
      const el=document.createElement('button');
      el.type='button';
      el.className='pkey '+(black?'black':'white');
      const inScale = scaleSet.has(pc);
      if(inScale) el.classList.add('in');
      if(pc===rootPc) el.classList.add('root');
      const label = inScale ? DEGREE[scaleSet.get(pc)] : (black ? '' : pcName(pc));
      el.innerHTML = `<span>${label}</span>`;
      el.setAttribute('aria-label', pcName(pc)+(inScale?' '+DEGREE[scaleSet.get(pc)]+'도':''));
      if(inScale){
        el.addEventListener('click', ()=> guitarPluck(60+pc, 1.8, 0.55));
      }else{
        el.classList.add('mute');       // 스케일 밖은 눌러도 소리 안 남
        el.setAttribute('aria-disabled','true');
      }
      return el;
    };
    WHITE_PC.forEach(pc=> scaleNotesList.appendChild(mk(pc,false)));
    BLACK.forEach(b=>{
      const el=mk(b.pc,true);
      el.style.width=bw;
      el.style.left=`calc(100% / 7 * ${b.after+1} - (${bw}) / 2)`;
      scaleNotesList.appendChild(el);
    });
  }

  function render(){
    const rootPc = scaleRoot;
    const type   = SCALE_TYPES[scaleTypeKey];
    const tuning = TUNINGS[scaleTuneKey];
    const lay    = layout();
    const FRETS  = lay.frets;
    const size   = lay.cell;
    const showText = size >= 14;   // 15프렛을 다 담으면 칸이 15~17px이 된다

    const scaleSet = new Map();
    type.intervals.forEach(iv=> scaleSet.set((rootPc+iv)%12, iv));

    fretboard.style.setProperty('--fc', size+'px');
    fretboard.classList.toggle('compact', !showText);
    fretboard.classList.toggle('zoomed', zoom==='zoom');
    fretboard.classList.toggle('tight', size < 20);
    fretboard.classList.toggle('xtight', size < 17);
    fretScroll.classList.toggle('fit', zoom==='fit');

    fretboard.innerHTML='';
    const head=document.createElement('div');
    head.className='fret-row';
    const corner=document.createElement('div'); corner.className='fret-num'; head.appendChild(corner);
    for(let f=1; f<=FRETS; f++){        // 0프렛(개방현)은 왼쪽 현 이름이 대신한다
      const n=document.createElement('div');
      n.className='fret-num'+([3,5,7,9,12,15].includes(f)?' mark':'');
      n.textContent=f;
      head.appendChild(n);
    }
    fretboard.appendChild(head);

    for(let s=tuning.strings.length-1; s>=0; s--){
      const row=document.createElement('div'); row.className='fret-row';
      const lab=document.createElement('div'); lab.className='fret-num';
      lab.textContent=pcName(tuning.strings[s]%12);
      row.appendChild(lab);
      for(let f=1; f<=FRETS; f++){
        const midi=tuning.strings[s]+f;
        const pc=((midi%12)+12)%12;
        const c=document.createElement('div');
        c.className='fret-cell';
        if(scaleSet.has(pc)){
          const isRoot = pc===rootPc;
          c.classList.add(isRoot?'root':'scale');
          if(showText) c.textContent = pcName(pc);
          c.title = pcName(pc)+' · '+DEGREE[scaleSet.get(pc)]+'도';
        } else {
          c.classList.add('note');
        }
        row.appendChild(c);
      }
      fretboard.appendChild(row);
    }

    // 구성음을 피아노 건반으로. scaleSet: pc → 루트로부터의 반음.
    renderPiano(rootPc, scaleSet);
  }

  // (조·종류·튜닝 변경은 각 드롭다운 콜백에서 render를 부른다)
  let __rsz=null;
  window.addEventListener('resize', ()=>{
    clearTimeout(__rsz);
    __rsz=setTimeout(()=>{ if(zoom==='fit') render(); }, 120);
  });
  // 탭이 처음 열릴 때 컨테이너 폭이 잡히므로 다시 계산한다
  document.querySelector('.tab-btn[data-tab="scales"]')
    .addEventListener('click', ()=> setTimeout(render, 0));
  window.OlivePreferences.register('scales',
    ()=>({root:scaleRoot,type:scaleTypeKey,tuning:scaleTuneKey,zoom}),
    value=>{
      if(!value || typeof value!=='object') return;
      const root=Math.round(Number(value.root));
      if(Number.isFinite(root) && root>=0 && root<12){ scaleRoot=root; scaleKeyDD.set(root); }
      const typeIndex=SC_KEYS.indexOf(value.type);
      if(typeIndex>=0){ scaleTypeKey=SC_KEYS[typeIndex]; scaleTypeDD.set(typeIndex); }
      const tuneIndex=TUNE_ORDER.indexOf(value.tuning);
      if(tuneIndex>=0){ scaleTuneKey=TUNE_ORDER[tuneIndex]; scaleTuneDD.set(tuneIndex); }
      if(ZOOMS.some(item=>item.key===value.zoom)) zoom=value.zoom;
      fretZoom.querySelectorAll('.pill')
        .forEach(button=>button.classList.toggle('active',button.dataset.zoom===zoom));
      render();
    }
  );
  render();
})();


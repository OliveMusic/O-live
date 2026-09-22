/* ===================== 코드 찾기 =====================
   세로 코드표 지판에 짚은 모양으로 코드 이름을 찾고, 아래 칸을 쓸어 친다.
   이름을 찾는 계산은 chord-engine.js가 맡고 여기서는 그리기·손짓·소리만 한다. */
(function(){
  'use strict';
  const engine=window.OliveChordEngine;
  const board=document.getElementById('chordBoard');
  const nameEl=document.getElementById('chordName');
  const tonesEl=document.getElementById('chordTones');
  const altsEl=document.getElementById('chordAlts');
  const posEl=document.getElementById('chordPos');
  const lowerBtn=document.getElementById('chordLower');
  const higherBtn=document.getElementById('chordHigher');
  const strumBtn=document.getElementById('chordStrum');
  const clearBtn=document.getElementById('chordClear');
  if(!engine || !board || !nameEl) return;

  const SVG_NS='http://www.w3.org/2000/svg';
  const TUNING=engine.GUITAR_STANDARD;
  const STRINGS=TUNING.length;
  const FRETS=4, MIN_BASE=1, MAX_BASE=12;
  const OPEN='open';
  /* 처음 여는 사람에게는 빈 지판보다 짚힌 코드 하나가 무엇을 하는 화면인지 더 빨리
     보여 준다. 가장 먼저 배우는 C(x32010)로 둔다. 그 뒤로는 마지막 모양을 기억한다. */
  const DEFAULT_SHAPE=Object.freeze([null,2,1,OPEN,0,OPEN]);

  /* viewBox 좌표. 줄은 6번(낮은 E)이 왼쪽 — 코드북 표기 그대로다. */
  const VIEW_W=300, VIEW_H=372;
  const X0=40, DX=44;            // 줄 사이
  const MARK_Y=25;                // ✕·○ 자리
  const Y0=48, DY=46;             // 너트와 프렛 사이
  const BOARD_BOTTOM=Y0+FRETS*DY;
  const NOTE_Y=BOARD_BOTTOM+20, DEGREE_Y=BOARD_BOTTOM+34;
  const STRUM_TOP=276, STRUM_BOTTOM=366;

  let base=MIN_BASE;
  let shape=DEFAULT_SHAPE.slice();
  let strums=0;

  function midiOf(index){
    const value=shape[index];
    if(value===null) return null;
    if(value===OPEN) return TUNING[index];
    return TUNING[index]+base+value;
  }
  function sounding(){
    return shape.map((_,index)=>midiOf(index));
  }

  /* ---------- 그리기 ---------- */
  function el(tag,attrs,text){
    const node=document.createElementNS(SVG_NS,tag);
    Object.keys(attrs||{}).forEach(key=>node.setAttribute(key,attrs[key]));
    if(text!==undefined) node.textContent=text;
    return node;
  }
  function stringX(index){ return X0+index*DX; }
  /* 올리브 한 알이 손가락 하나다. 즐겨찾기 표시와 같은 모양이다. */
  function olive(x,y){
    const group=el('g',{class:'cf-dot',transform:`translate(${x} ${y}) rotate(-12)`});
    group.appendChild(el('ellipse',{rx:15,ry:12.2}));
    group.appendChild(el('circle',{class:'cf-seed',cx:5.9,r:4.5}));
    return group;
  }

  function render(){
    const found=engine.identifyChord(sounding());
    board.textContent='';
    /* 치는 칸은 한 묶음으로 그린다 — 사각형·글씨·그 위를 지나는 줄 토막까지. 도움말이
       이 칸을 강조할 때 묶음 안의 무엇을 눌러도 칸을 누른 것으로 쳐야 하는데, 줄이
       사각형 밖의 요소면 줄 위에서 시작한 쓸기가 막힌다. */
    const zone=el('g',{id:'chordStrumZone',class:'cf-strum'});
    zone.appendChild(el('rect',{class:'cf-strum-zone',x:X0-18,y:STRUM_TOP,
      width:DX*(STRINGS-1)+36,height:STRUM_BOTTOM-STRUM_TOP,rx:12}));
    zone.appendChild(el('text',{class:'cf-strum-label',x:VIEW_W/2,y:STRUM_BOTTOM-10,
      'text-anchor':'middle'},'여기를 좌우로 쓸어서 치기'));
    for(let index=0; index<STRINGS; index++){
      const x=stringX(index);
      const attrs={
        class:'cf-string'+(shape[index]===null?' muted':''), 'data-string':index,
        x1:x,x2:x,
        /* 낮은 줄일수록 굵게 — 실제 줄 두께의 차례를 따른다. */
        'stroke-width':(1+(STRINGS-1-index)*0.35).toFixed(2),
      };
      board.appendChild(el('line',Object.assign({},attrs,{y1:Y0,y2:STRUM_TOP})));
      zone.appendChild(el('line',Object.assign({},attrs,{y1:STRUM_TOP,y2:STRUM_BOTTOM-22})));
    }
    board.appendChild(zone);
    for(let fret=0; fret<=FRETS; fret++){
      const y=Y0+fret*DY;
      const nut=fret===0 && base===MIN_BASE;
      board.appendChild(el('line',{class:nut?'cf-nut':'cf-fret',
        x1:X0,y1:y,x2:stringX(STRINGS-1),y2:y}));
    }
    if(base>MIN_BASE){
      board.appendChild(el('text',{class:'cf-base',x:X0-14,y:Y0+DY/2+5,'text-anchor':'end'},String(base)));
    }
    for(let index=0; index<STRINGS; index++){
      const x=stringX(index), value=shape[index];
      if(value===null) board.appendChild(el('text',{class:'cf-mute',x,y:MARK_Y+5,'text-anchor':'middle'},'✕'));
      else if(value===OPEN) board.appendChild(el('circle',{class:'cf-open',cx:x,cy:MARK_Y,r:7.5}));
      else board.appendChild(olive(x,Y0+value*DY+DY/2));
      const midi=midiOf(index);
      board.appendChild(el('text',{class:'cf-note'+(midi===null?' muted':''),x,y:NOTE_Y,
        'text-anchor':'middle'},midi===null?'–':engine.noteName(midi)));
      if(midi!==null && found && !found.kind){
        const tone=found.tones.find(item=>item.pc===((midi%12)+12)%12);
        if(tone) board.appendChild(el('text',{class:'cf-degree',x,y:DEGREE_Y,'text-anchor':'middle'},tone.degree));
      }
    }
    board.setAttribute('aria-label',describe(found));
    posEl.textContent=base+'프렛';
    lowerBtn.disabled=base<=MIN_BASE;
    higherBtn.disabled=base>=MAX_BASE;
    renderName(found);
  }

  function renderName(found){
    if(!found){
      nameEl.textContent='—';
      tonesEl.textContent='소리 나는 줄이 없습니다';
      altsEl.textContent='';
      return;
    }
    nameEl.textContent=found.name;
    if(found.kind==='두 음') tonesEl.textContent='두 음 · '+found.interval;
    else if(found.kind==='이름 없음') tonesEl.textContent='이름이 붙지 않는 조합';
    else if(found.kind) tonesEl.textContent=found.kind;
    /* 음과 도수는 좁은 공백으로 붙여 한 짝으로 읽히게 한다. 보통 공백을 쓰면 'C 1 · E 3'이
       짝 없이 흩어져, 어느 숫자가 어느 음의 것인지 한 번 더 세어야 한다. */
    else tonesEl.textContent=found.tones.map(tone=>tone.name+'\u2009'+tone.degree).join(' · ');
    altsEl.textContent='';
    if(found.alternatives.length){
      altsEl.append('다르게 부르면');
      altsEl.appendChild(document.createElement('br'));
      altsEl.append(found.alternatives.join(' · '));
    }
  }

  /* 화면을 못 보는 사람에게는 줄마다 무엇을 짚었는지를 읽어 준다. */
  function describe(found){
    const parts=shape.map((value,index)=>{
      const label=(STRINGS-index)+'번 줄';
      if(value===null) return label+' 뮤트';
      if(value===OPEN) return label+' 개방';
      return label+' '+(base+value)+'프렛';
    });
    return '코드 지판, '+(found?found.name:'소리 없음')+'. '+parts.join(', ');
  }

  /* ---------- 소리 ---------- */
  /* 스케일 건반과 같은 기타 소리를 쓴다. 여러 줄을 한꺼번에 칠 때는 조금 작게 —
     여섯 줄이 겹치면 한 줄 칠 때보다 훨씬 커진다. */
  const SINGLE_VOLUME=0.55, STRUM_VOLUME=0.42, RING=1.8;
  function pluck(index,volume){
    const midi=midiOf(index);
    if(midi===null) return;
    if(typeof guitarPluck==='function') guitarPluck(midi,RING,volume||SINGLE_VOLUME);
    /* 줄은 지판 쪽과 치는 칸 쪽 두 토막이다. 함께 빛낸다. */
    board.querySelectorAll(`.cf-string[data-string="${index}"]`).forEach(line=>{
      line.classList.add('ringing');
      setTimeout(()=>line.classList.remove('ringing'),180);
    });
  }
  let strumTimers=[];
  function strumAll(){
    strumTimers.forEach(clearTimeout);
    /* 내려 치는 차례, 곧 6번 줄부터. 28ms 간격이면 한 번에 긁은 것처럼 들린다. */
    strumTimers=shape.map((_,index)=>setTimeout(()=>pluck(index,STRUM_VOLUME),index*28));
  }

  /* ---------- 손짓 ---------- */
  function point(event){
    const box=board.getBoundingClientRect();
    return {
      x:(event.clientX-box.left)*VIEW_W/box.width,
      y:(event.clientY-box.top)*VIEW_H/box.height,
    };
  }
  function stringAt(x){
    return Math.max(0,Math.min(STRINGS-1,Math.round((x-X0)/DX)));
  }
  function changed(){
    render();
    if(window.OlivePreferences) window.OlivePreferences.changed();
  }

  let strum=null;
  board.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse' && event.button!==0) return;
    const {x,y}=point(event);
    const index=stringAt(x);
    if(y>=STRUM_TOP-6){
      /* 치는 칸. 손가락이 지나가는 줄마다 한 번씩 울린다. 붙잡아 두어야 칸 밖으로
         나가도 움직임이 계속 들어온다. */
      strum={id:event.pointerId,last:index};
      board.dataset.strums=String(++strums);
      pluck(index,STRUM_VOLUME);
      try{ board.setPointerCapture(event.pointerId); }catch(e){}
      return;
    }
    if(y<Y0-6){
      /* 너트 위 칸은 ✕(뮤트)와 ○(개방)을 오간다. 짚어 둔 올리브가 있으면 개방으로 연다. */
      shape[index]=shape[index]===OPEN?null:OPEN;
      changed();
      if(shape[index]===OPEN) pluck(index);
      return;
    }
    if(y<=BOARD_BOTTOM){
      const row=Math.floor((y-Y0)/DY);
      if(row<0 || row>=FRETS) return;
      /* 한 줄에 손가락은 하나다. 같은 자리를 다시 누르면 뗀다 — 뗀 줄은 뮤트로 둔다.
         개방이 아니라 뮤트인 것은, 실수로 누른 것을 지웠는데 소리가 새로 나면 안 되기
         때문이다. */
      shape[index]=shape[index]===row?null:row;
      changed();
      pluck(index);
    }
  });
  board.addEventListener('pointermove',event=>{
    if(!strum || event.pointerId!==strum.id) return;
    const index=stringAt(point(event).x);
    if(index===strum.last) return;
    /* 빠르게 쓸면 움직임 사이에 줄을 건너뛴다. 사이에 있는 줄도 차례대로 울린다. */
    const step=index>strum.last?1:-1;
    for(let at=strum.last+step; at!==index+step; at+=step) pluck(at,STRUM_VOLUME);
    strum.last=index;
  });
  function endStrum(event){
    if(strum && event.pointerId===strum.id) strum=null;
  }
  board.addEventListener('pointerup',endStrum);
  board.addEventListener('pointercancel',endStrum);

  lowerBtn.addEventListener('click',()=>{ if(base>MIN_BASE){ base--; changed(); } });
  higherBtn.addEventListener('click',()=>{ if(base<MAX_BASE){ base++; changed(); } });
  strumBtn.addEventListener('click',strumAll);
  clearBtn.addEventListener('click',()=>{
    shape=new Array(STRINGS).fill(null);
    changed();
  });

  /* ---------- 기억 ---------- */
  function validShape(value){
    return Array.isArray(value) && value.length===STRINGS && value.every(item=>
      item===null || item===OPEN || (Number.isInteger(item) && item>=0 && item<FRETS));
  }
  if(window.OlivePreferences){
    window.OlivePreferences.register('chords',
      ()=>({base,shape:shape.slice()}),
      value=>{
        if(!value || typeof value!=='object') return;
        const nextBase=Math.round(Number(value.base));
        if(Number.isFinite(nextBase) && nextBase>=MIN_BASE && nextBase<=MAX_BASE) base=nextBase;
        if(validShape(value.shape)) shape=value.shape.slice();
        render();
      });
  }
  render();
})();

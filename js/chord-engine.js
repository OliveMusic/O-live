/* O'live chord engine: 소리 나는 음들로 코드 이름을 찾는다. 화면과 소리는 chords.js가 맡는다. */
(function(root){
  'use strict';

  const NOTE_NAMES=Object.freeze(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']);
  const DEGREE=Object.freeze(['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7']);
  const INTERVAL_NAMES=Object.freeze([
    '완전1도','단2도','장2도','단3도','장3도','완전4도','증4도','완전5도','단6도','장6도','단7도','장7도',
  ]);
  /* 6번 줄(낮은 E)부터 1번 줄(높은 E)까지. 스케일 탭의 기타 표준과 같은 값이다. */
  const GUITAR_STANDARD=Object.freeze([40,45,50,55,59,64]);

  /* [접미사, 루트로부터의 반음]. 앞에 있을수록 흔한 코드라 동점이면 앞의 것을 고른다.
     기호는 잼 세션과 맞춘다 — mM7, 7♯5, m7♭5. 같은 앱에서 같은 코드를 두 가지로
     적으면 어느 쪽이 맞는지 헷갈린다. */
  const CHORDS=Object.freeze([
    ['',[0,4,7]],
    ['m',[0,3,7]],
    ['7',[0,4,7,10]],
    ['m7',[0,3,7,10]],
    ['maj7',[0,4,7,11]],
    ['5',[0,7]],
    ['sus4',[0,5,7]],
    ['sus2',[0,2,7]],
    ['add9',[0,2,4,7]],
    ['6',[0,4,7,9]],
    ['m6',[0,3,7,9]],
    ['7sus4',[0,5,7,10]],
    ['dim',[0,3,6]],
    ['aug',[0,4,8]],
    ['m7♭5',[0,3,6,10]],
    ['dim7',[0,3,6,9]],
    ['mM7',[0,3,7,11]],
    ['madd9',[0,2,3,7]],
    ['9',[0,2,4,7,10]],
    ['m9',[0,2,3,7,10]],
    ['maj9',[0,2,4,7,11]],
    ['6/9',[0,2,4,7,9]],
    ['add11',[0,4,5,7]],
    ['m11',[0,3,5,7,10]],
    /* sus2와 add11 계열. 줄 몇 개를 개방으로 두고 모양을 올려 잡으면 자주 나온다 —
       예를 들어 x5440x를 3프렛에서 잡으면 E·F#·B·D가 되는데, 이 넷이 없으면
       '이름 없음'으로 떨어진다. */
    ['7sus2',[0,2,7,10]],
    ['madd11',[0,3,5,7]],
    ['9sus4',[0,2,5,7,10]],
    ['m6/9',[0,2,3,7,9]],
    ['13',[0,4,7,9,10]],
    ['7♭9',[0,1,4,7,10]],
    ['7♯9',[0,3,4,7,10]],
    ['7♭5',[0,4,6,10]],
    ['7♯5',[0,4,8,10]],
    ['maj7♯5',[0,4,8,11]],
  ].map(([suffix,tones])=>Object.freeze([suffix,Object.freeze(tones)])));

  const EXACT=100;
  /* 기타에서는 5음을 빼고 잡는 일이 흔하다(쉘 보이싱). 다만 7음이 있는 코드에서만 뺀다 —
     3화음에서 5음을 빼면 C·E·A가 'C6(5음 없음)'이 되어 버리는데, 같은 음은 Am/C로
     온전하게 읽힌다. 빠진 쪽은 조금 낮게 쳐서 온전한 해석이 있으면 그쪽이 이긴다. */
  const NO_FIFTH=88;
  /* 베이스가 루트인 해석을 앞세운다. Am7과 C6/A는 같은 음이지만 A를 가장 낮게 짚었다면
     듣는 사람에게 그것은 Am7이다. */
  const BASS_IS_ROOT=25;

  function pcOf(midi){ return ((Math.round(Number(midi))%12)+12)%12; }
  function noteName(pc){ return NOTE_NAMES[pcOf(pc)]; }

  /* ---------- 음 이름의 철자 ----------
     같은 건반도 조와 도수에 따라 이름이 다르다. F 메이저의 4음은 A#이 아니라 B♭이고,
     Cm의 단3도는 D#이 아니라 E♭이다. 글자는 도수가 정한다. 3도면 루트에서 세 번째
     글자, ♭3도면 그 글자에 ♭. 겹올림·겹내림(F𝄪, B𝄫)은 기기마다 글꼴이 달라 흔한
     이름(G, A)으로 적는다. 튜너는 조가 없으므로 여기를 쓰지 않는다. */
  const LETTERS=Object.freeze(['C','D','E','F','G','A','B']);
  const LETTER_PC=Object.freeze([0,2,4,5,7,9,11]);
  const MAJOR_STEPS=Object.freeze([0,2,4,5,7,9,11]);
  const SHARP='♯', FLAT='♭';
  /* 조가 없을 때 검은 건반 하나를 부르는 이름. 피아노 교재에서 흔히 쓰는 쪽이다. */
  const PLAIN_FLAT=Object.freeze({1:false,3:true,6:false,8:true,10:true});   // C♯ E♭ F♯ A♭ B♭
  /* 장조 으뜸음 → 조표가 플랫인가. 6(F♯/G♭)은 기타에서 더 자주 만나는 F♯으로 둔다. */
  const FLAT_MAJORS=Object.freeze(new Set([5,10,3,8,1]));
  /* 스케일마다 조표를 빌려 오는 장조까지의 반음. 도리안은 온음 아래 장조의 조표를 쓴다. */
  const PARENT_SHIFT=Object.freeze({
    major:0, minor:3, majpent:0, minpent:3, blues:3,
    dorian:10, phrygian:8, lydian:7, mixolydian:5, locrian:1,
    harmonicminor:3, melodicminor:3,
  });

  function accidentalText(count){ return count>0 ? SHARP.repeat(count) : FLAT.repeat(-count); }
  function spellAt(letter,pc){
    let shift=pcOf(pc-LETTER_PC[letter]);
    if(shift>6) shift-=12;
    return {letter,acc:shift};
  }
  function spellingText(spelling){ return LETTERS[spelling.letter]+accidentalText(spelling.acc); }
  function plainSpelling(pc,preferFlat){
    const value=pcOf(pc);
    const natural=LETTER_PC.indexOf(value);
    if(natural>=0) return {letter:natural,acc:0};
    const flat=preferFlat===undefined ? PLAIN_FLAT[value] : preferFlat;
    return flat ? {letter:LETTER_PC.indexOf(pcOf(value+1)),acc:-1}
                : {letter:LETTER_PC.indexOf(pcOf(value-1)),acc:1};
  }
  function plainName(pc,preferFlat){ return spellingText(plainSpelling(pc,preferFlat)); }
  function degreeNumber(label){
    const match=String(label||'').match(/(\d+)$/);
    return match ? Number(match[1]) : 1;
  }
  /* 루트의 철자에서 도수만큼 글자를 세어 그 음의 철자를 정한다. */
  function spellFrom(root,interval,degree,preferFlat){
    const pc=pcOf(LETTER_PC[root.letter]+root.acc+interval);
    const letter=(root.letter+Math.max(1,degree)-1)%7;
    const spelled=spellAt(letter,pc);
    return Math.abs(spelled.acc)>1 ? plainSpelling(pc,preferFlat) : spelled;
  }
  /* 스케일(또는 조)의 도수 이름. 일곱 음 스케일은 장음계와 견줘 ♭·♯을 붙인다.
     리디안의 4는 ♭5가 아니라 ♯4다. 다섯·여섯 음 스케일은 흔한 이름을 쓴다(블루스 ♭5). */
  function scaleDegrees(intervals){
    const list=(intervals||[]).map(pcOf);
    if(list.length===7) return list.map((interval,index)=>{
      let shift=interval-MAJOR_STEPS[index];
      if(shift>6) shift-=12;
      if(shift<-6) shift+=12;
      return accidentalText(shift)+String(index+1);
    });
    return list.map(interval=>DEGREE[interval]);
  }
  /* 조의 으뜸음을 어떻게 적을지. 조표가 플랫인 장조에 기대면 플랫으로. */
  function keySpelling(rootPc,type){
    const shift=PARENT_SHIFT[type]===undefined ? 0 : PARENT_SHIFT[type];
    const flats=FLAT_MAJORS.has(pcOf(rootPc+shift));
    return {root:plainSpelling(rootPc,flats),preferFlat:flats};
  }
  function keyName(rootPc,type){ return spellingText(keySpelling(rootPc,type).root); }
  /* 스케일의 구성음을 도수와 함께 적는다. [{pc, interval, degree, name}] */
  function spellScale(rootPc,type,intervals){
    const key=keySpelling(rootPc,type);
    const degrees=scaleDegrees(intervals);
    return (intervals||[]).map((interval,index)=>({
      pc:pcOf(rootPc+interval), interval:pcOf(interval), degree:degrees[index],
      name:spellingText(spellFrom(key.root,interval,degreeNumber(degrees[index]),key.preferFlat)),
    }));
  }
  /* 조 안의 한 음. 잼 세션이 코드 루트를 적을 때 쓴다. */
  function spellInKey(rootPc,type,interval,degree){
    const key=keySpelling(rootPc,type);
    return spellingText(spellFrom(key.root,interval,degree,key.preferFlat));
  }
  /* 조가 없는 코드(코드 찾기)의 루트 철자. 두 가지로 적어 보고 올림·내림이 적은 쪽을
     고른다. C#은 D♭(D♭·F·A♭)으로, C#m은 C#m(C#·E·G#)으로. 같으면 흔한 쪽. */
  function chordRootSpelling(rootPc,tones){
    const natural=LETTER_PC.indexOf(pcOf(rootPc));
    if(natural>=0) return {letter:natural,acc:0};
    const options=[plainSpelling(rootPc,false),plainSpelling(rootPc,true)];
    const cost=root=>tones.reduce((sum,tone)=>{
      const pc=pcOf(LETTER_PC[root.letter]+root.acc+tone.interval);
      const spelled=spellAt((root.letter+degreeNumber(tone.degree)-1)%7,pc);
      return sum+(Math.abs(spelled.acc)>1 ? 3 : Math.abs(spelled.acc));
    },0);
    const sharpCost=cost(options[0]), flatCost=cost(options[1]);
    if(sharpCost!==flatCost) return sharpCost<flatCost ? options[0] : options[1];
    return PLAIN_FLAT[pcOf(rootPc)] ? options[1] : options[0];
  }

  function allowsOmittedFifth(tones){
    return tones.includes(7) && (tones.includes(10) || tones.includes(11));
  }
  function sameSet(a,b){
    if(a.size!==b.size) return false;
    for(const value of a) if(!b.has(value)) return false;
    return true;
  }
  function isSubset(a,b){
    for(const value of a) if(!b.has(value)) return false;
    return true;
  }

  /* 도수는 코드 이름을 따른다. add9의 2도는 9로, 7♯9의 ♭3은 ♯9로, aug의 ♭6은 ♯5로
     적어야 이름과 구성음이 같은 말을 한다. */
  function degreeLabel(interval,suffix){
    const d=pcOf(interval);
    const name=String(suffix||'');
    if(d===1 && name.includes('♭9')) return '♭9';
    if(d===2 && name.includes('9')) return '9';
    if(d===3 && name.includes('♯9')) return '♯9';
    if(d===5 && name.includes('11')) return '11';
    if(d===8 && (name.includes('♯5') || name.includes('aug'))) return '♯5';
    if(d===9 && name.includes('13')) return '13';
    if(d===9 && name==='dim7') return '♭♭7';
    return DEGREE[d];
  }

  /* 코드의 구성음을 루트의 철자에 맞춰 적는다. 이름이 없는 모음은 흔한 이름으로. */
  function tonesFor(pcs,rootPc,suffix,named){
    const raw=pcs
      .map(pc=>({pc,interval:pcOf(pc-rootPc)}))
      .sort((a,b)=>a.interval-b.interval)
      .map(({pc,interval})=>({pc,interval,degree:degreeLabel(interval,suffix)}));
    const root=named ? chordRootSpelling(rootPc,raw) : plainSpelling(rootPc);
    const preferFlat=root.acc<0 || (root.acc===0 && PLAIN_FLAT[pcOf(rootPc)]);
    return raw.map(tone=>Object.freeze({
      pc:tone.pc, degree:tone.degree,
      name:named ? spellingText(spellFrom(root,tone.interval,degreeNumber(tone.degree),preferFlat))
                 : plainName(tone.pc),
    }));
  }
  function chordName(rootPc,suffix,bassPc,allPcs){
    const tones=tonesFor(allPcs||[rootPc],rootPc,suffix,true);
    const nameOf=pc=>{
      const tone=tones.find(item=>item.pc===pcOf(pc));
      return tone ? tone.name : plainName(pc);
    };
    return nameOf(rootPc)+suffix+(rootPc!==bassPc?'/'+nameOf(bassPc):'');
  }

  /* 소리 나는 MIDI 음들로 코드를 찾는다. 순서는 상관없고 가장 낮은 음이 베이스다.
     아무 음도 없으면 null. */
  function identifyChord(notes){
    /* 뮤트한 줄은 null로 온다. Number(null)은 0이라 그대로 바꾸면 MIDI 0번, 곧 C가
       끼어든다 — A 코드가 'C + A + E + C#'이 되던 것이 그것이다. 먼저 걸러 낸다. */
    const sounding=(Array.isArray(notes)?notes:[])
      .filter(note=>note!==null && note!==undefined && note!=='')
      .map(Number).filter(Number.isFinite).map(Math.round);
    if(!sounding.length) return null;
    const bass=pcOf(Math.min(...sounding));
    const pcs=[...new Set(sounding.map(pcOf))];

    if(pcs.length===1){
      return Object.freeze({
        name:plainName(pcs[0]), root:pcs[0], bass, suffix:'',
        kind:sounding.length>1?'옥타브':'단음', interval:'',
        tones:Object.freeze(tonesFor(pcs,pcs[0],'',false)), alternatives:Object.freeze([]),
      });
    }

    const found=[];
    pcs.forEach(rootPc=>{
      const intervals=new Set(pcs.map(pc=>pcOf(pc-rootPc)));
      CHORDS.forEach(([suffix,tones],index)=>{
        const template=new Set(tones);
        let score=null;
        if(sameSet(intervals,template)) score=EXACT;
        else if(allowsOmittedFifth(tones) && !intervals.has(7) &&
                intervals.size===template.size-1 && isSubset(intervals,template)) score=NO_FIFTH;
        if(score===null) return;
        score+=(rootPc===bass?BASS_IS_ROOT:0)-tones.length*2-index*0.05;
        found.push({rootPc,suffix,score});
      });
    });

    if(!found.length){
      /* 이름이 붙지 않는 모음이다. 두 음이면 음정이라도 알려 준다. */
      const other=pcs.find(pc=>pc!==bass);
      return Object.freeze({
        name:[bass].concat(pcs.filter(pc=>pc!==bass)).map(pc=>plainName(pc)).join(' + '),
        root:bass, bass, suffix:'',
        kind:pcs.length===2?'두 음':'이름 없음',
        interval:pcs.length===2?INTERVAL_NAMES[pcOf(other-bass)]:'',
        tones:Object.freeze(tonesFor(pcs,bass,'',false)), alternatives:Object.freeze([]),
      });
    }

    found.sort((a,b)=>b.score-a.score);
    const best=found[0];
    const name=chordName(best.rootPc,best.suffix,bass,pcs);
    const seen=new Set([name]);
    const alternatives=[];
    for(const candidate of found.slice(1)){
      const other=chordName(candidate.rootPc,candidate.suffix,bass,pcs);
      if(seen.has(other)) continue;
      seen.add(other);
      alternatives.push(other);
      if(alternatives.length>=2) break;
    }
    return Object.freeze({
      name, root:best.rootPc, bass, suffix:best.suffix, kind:'', interval:'',
      tones:Object.freeze(tonesFor(pcs,best.rootPc,best.suffix,true)),
      alternatives:Object.freeze(alternatives),
    });
  }

  /* 줄마다 짚은 프렛(null=뮤트, 0=개방, n=프렛)을 MIDI 음으로. */
  function stringNotes(frets,tuning=GUITAR_STANDARD){
    return tuning.map((open,index)=>{
      const fret=frets[index];
      if(fret===null || fret===undefined) return null;
      const value=Math.round(Number(fret));
      return Number.isFinite(value) && value>=0 ? open+value : null;
    });
  }

  root.OliveChordEngine=Object.freeze({
    NOTE_NAMES,
    GUITAR_STANDARD,
    INTERVAL_NAMES,
    degreeLabel,
    identifyChord,
    noteName,
    stringNotes,
    plainName,
    scaleDegrees,
    keyName,
    spellScale,
    spellInKey,
  });
})(globalThis);

const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('js/ear-trainer.js','utf8');

function bankOf(name){
  const match=source.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n  \\]);`));
  assert.ok(match,`${name} 표를 찾는다`);
  return JSON.parse(JSON.stringify(vm.runInNewContext(match[1])));
}

/* 도수 글자를 장음계 기준 반음 수로 읽는다. */
const SEMIS={'1':0,'♭2':1,'2':2,'♭3':3,'3':4,'4':5,'♯4':6,'♭5':6,'5':7,'♯5':8,'♭6':8,'6':9,'♭7':10,'7':11};
function semisOf(tokens){
  return tokens.map(token=>{
    assert.ok(token in SEMIS,`알 수 있는 도수: ${token}`);
    return SEMIS[token];
  });
}

/* 화면에 적힌 도수와 실제로 울리는 음이 같아야 한다. 하나라도 어긋나면 보기가 거짓말을 한다. */
const chords=bankOf('CHORDS');
assert.equal(chords.length,9);
for(const chord of chords){
  assert.deepEqual(semisOf(chord.degrees.split('–')),chord.iv,`${chord.ko} 도수`);
}
const scales=bankOf('SCALES');
assert.equal(scales.length,9);
for(const scale of scales){
  assert.equal(scale.iv[scale.iv.length-1],12,`${scale.ko}는 옥타브까지 울린다`);
  // 옥타브는 적지 않는다.
  assert.deepEqual(semisOf(scale.degrees.split(' ')),scale.iv.slice(0,-1),`${scale.ko} 도수`);
  assert.doesNotMatch(scale.degrees,/[b#]/,'화음과 같은 ♭·♯ 기호를 쓴다');
}
assert.equal(scales.find(item=>item.en==='Blues').degrees,'1 ♭3 4 ♭5 5 ♭7','블루 노트는 ♭5');
assert.equal(scales.find(item=>item.en==='Lydian').degrees,'1 2 3 ♯4 5 6 7','리디안은 ♯4');

/* 보기: 이름 아래 한 줄, ♭·♯이 붙은 음만 진하게. 화음은 –로 잇고 음계는 띄운다. */
assert.match(source,/function degreesHtml\(degrees\)\{/);
assert.match(source,/\/\[♭♯\]\/\.test\(token\)\?'deg-alt':'deg'/);
assert.match(source,/join\(scale\?' ':'<span class="deg-sep">–<\/span>'\)/);
assert.match(source,/const degrees=mode!=='interval' && item\.degrees/);

/* 소리: 잼과 같은 합성 피아노. 삼각파·사인파는 더 쓰지 않는다. */
const play=source.slice(source.indexOf('function playAnswer('),source.indexOf('function playCurrent('));
assert.doesNotMatch(play,/playTone\(/);
assert.match(source,/function earNote\(midi, at, hold, vol=EAR_PIANO_VOL\)\{\s*\n\s*pianoNote\(midi, at, Math\.max\(1\.2, hold\+0\.9\), vol\);/);
assert.match(play,/const t0=noteStart\(ctx,0\.02\);/);
assert.match(play,/earNote\(root, t0, 0\.55\);\s*\n\s*earNote\(root\+answer\.semis, t0\+0\.6, 0\.75\);/);

console.log('ear trainer tests passed');

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

/* 소리: 그랜드 피아노 녹음. 삼각파·사인파는 더 쓰지 않는다. 녹음이 아직이면 잠깐 기다리고,
   그동안 다시 누르면 마지막 것만 낸다. */
const play=source.slice(source.indexOf('function playAnswer('),source.indexOf('function playCurrent('));
assert.doesNotMatch(play,/playTone\(/);
assert.match(source,/function earNote\(midi, at, hold, vol=EAR_PIANO_VOL\)\{\s*\n\s*grandPianoNote\(midi, at, hold, vol\);/);
assert.match(source,/const EAR_PIANO_VOL=1\.9;/);
assert.match(play,/const token=\+\+playToken;/);
assert.match(play,/Promise\.race\(\[loadGrandPiano\(\), new Promise\(resolve=>setTimeout\(resolve,PIANO_WAIT_MS\)\)\]\)/);
assert.match(play,/if\(token===playToken\) whenClockAwake\(ctx,/);
assert.match(play,/const t0=noteStart\(ctx,0\.02\);/);
assert.match(play,/earNote\(root, t0, 0\.55\);\s*\n\s*earNote\(root\+answer\.semis, t0\+0\.6, 0\.75\);/);
// 청음을 열면 미리 받아 둔다.
assert.match(source,/new MutationObserver\(warmIfShown\)\.observe\(pane,\{attributes:true,attributeFilter:\['class'\]\}\)/);
assert.match(source,/earPlayBtn\.addEventListener\('pointerdown',warmPiano\)/);

/* 녹음 파일: 단3도마다 여덟 개라 청음 음역(57~78)의 어느 음도 반음 하나 안에서 옮긴다. */
const core=fs.readFileSync('js/core.js','utf8');
const midis=JSON.parse(core.match(/const GRAND_PIANO_MIDIS=Object\.freeze\((\[[^\]]+\])\);/)[1]);
assert.deepEqual(midis,[57,60,63,66,69,72,75,78]);
for(let midi=57;midi<=78;midi++){
  const nearest=Math.min(...midis.map(m=>Math.abs(m-midi)));
  assert.ok(nearest<=1,`${midi}는 반음 하나 안에서 낸다`);
}
const version=core.match(/const GRAND_PIANO_VERSION=(\d+);/)[1];
const worker=fs.readFileSync('service-worker.js','utf8');
for(const midi of midis){
  const file=`audio/piano/grand-${midi}.mp3`;
  const size=fs.statSync(file).size;
  assert.ok(size>10000 && size<40000,`${file} 크기 ${size}`);
  assert.equal(fs.readFileSync(file).subarray(0,3).toString('latin1'),'ID3',`${file}은 MP3`);
  // 앱이 부르는 주소 그대로 미리 받아야 오프라인에서도 녹음 피아노가 난다.
  assert.ok(worker.includes(`'./${file}?v=${version}',`),`서비스 워커가 ${file}?v=${version}을 받아 둔다`);
}
assert.match(core,/function grandPianoUrl\(midi\)\{ return `\.\/audio\/piano\/grand-\$\{midi\}\.mp3\?v=\$\{GRAND_PIANO_VERSION\}`; \}/);
// 녹음이 없으면 합성 피아노로, 같은 크기로 낸다.
assert.match(core,/if\(!__grandBuffers\)\{\s*\n\s*pianoNote\(midi, when, Math\.max\(1\.2,hold\+0\.9\), vol\*GRAND_FALLBACK_RATIO/);
assert.match(core,/const GRAND_FALLBACK_RATIO=0\.36\/1\.9;/);
// 실패한 받기를 붙잡아 두지 않는다.
assert.match(core,/\.finally\(\(\)=>\{ __grandLoading=null; \}\)/);
assert.match(core,/g\.gain\.setTargetAtTime\(0\.0001,t\+hold,0\.07\);/);
assert.match(core,/keepVoice\(ctx,g,end\+0\.02\);/);

/* CC BY 3.0: 출처와 라이선스, 바꾼 것을 밝힌다. */
const about=fs.readFileSync('about.html','utf8');
assert.match(about,/Salamander Grand Piano V3<\/a>\(Alexander Holm,/);
assert.match(about,/href="https:\/\/creativecommons\.org\/licenses\/by\/3\.0\/"/);
assert.match(about,/모노로 합치고 길이와 음량을 다듬어 사용합니다/);
const readme=fs.readFileSync('audio/piano/README.md','utf8');
assert.match(readme,/Creative Commons Attribution 3\.0/);
assert.match(readme,/## 바꾼 것/);

console.log('ear trainer tests passed');

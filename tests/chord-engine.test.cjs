const assert=require('node:assert/strict');

require('../js/chord-engine.js');
const engine=globalThis.OliveChordEngine;

/* 기타 코드표 표기 그대로 적는다 — 6번 줄(낮은 E)부터, x는 뮤트. */
function shape(text){
  const frets=text.split('').map(ch=>ch==='x'?null:Number(ch));
  return engine.identifyChord(engine.stringNotes(frets));
}
function name(text){
  const found=shape(text);
  return found && found.name;
}

/* 흔한 개방 코드와 바레 코드는 모두 제 이름으로 읽혀야 한다. */
const COMMON={
  'x32010':'C', 'x02220':'A', '320003':'G', '022100':'E', 'xx0232':'D',
  'x02210':'Am', '022000':'Em', 'xx0231':'Dm',
  '133211':'F', 'x24432':'Bm', 'x35543':'Cm',
  '020100':'E7', 'x02020':'A7', 'xx0212':'D7', '320001':'G7', 'x21202':'B7', 'x32310':'C7',
  'x32000':'Cmaj7', 'xx3210':'Fmaj7',
  'x32030':'Cadd9', 'xx0233':'Dsus4', 'xx0230':'Dsus2', 'x02230':'Asus4',
};
for(const [frets,expected] of Object.entries(COMMON)){
  assert.equal(name(frets),expected,`${frets}는 ${expected}`);
}

/* 같은 음을 두 가지로 부를 수 있으면 베이스가 루트인 쪽이 앞선다. Am7과 C6/A는 같은
   네 음이지만 A를 가장 낮게 짚었으니 Am7이고, 다른 이름은 함께 알려 준다. */
const am7=shape('x02010');
assert.equal(am7.name,'Am7');
assert.ok(am7.alternatives.includes('C6/A'),'Am7은 C6/A로도 부를 수 있다');
const em7=shape('022030');
assert.equal(em7.name,'Em7');
assert.ok(em7.alternatives.includes('G6/E'));
/* sus 코드는 서로의 자리바꿈이다. */
assert.ok(shape('xx0233').alternatives.includes('Gsus2/D'));

/* 베이스가 루트가 아니면 슬래시 코드다. */
assert.equal(name('x20033'),'G/B');
assert.equal(name('2x0232'),'D/F#');
assert.equal(name('332010'),'C/G');
/* 3화음이 온전하면 5음이 빠진 해석보다 앞선다. C·E·A는 'C6에서 5음을 뺀 것'이 아니라
   Am/C다 — 5음 생략은 7음이 있는 코드에만 허락한다. */
assert.equal(name('x32210'),'Am/C');

/* 파워 코드와 쉘 보이싱. 쉘은 5음을 빼고 잡는다. */
assert.equal(name('022xxx'),'E5');
assert.equal(name('x355xx'),'C5');
assert.equal(name('x3x45x'),'Cmaj7','C·B·E — 5음 없는 maj7');
assert.equal(name('x3x35x'),'C7','C·B♭·E — 5음 없는 7');
assert.equal(name('x3x34x'),'Cm7','C·B♭·E♭ — 5음 없는 m7');
assert.equal(name('x3233x'),'C9','C·E·B♭·D — 5음 없는 9');
assert.equal(name('x7678x'),'E7♯9','지미 헨드릭스 코드');

/* 개방현을 끼고 모양을 올려 잡으면 sus2·add11 계열이 흔히 나온다. 사전에 없으면
   '이름 없음'으로 떨어진다 — 앱에서 C를 3프렛으로 밀어 올렸을 때 그랬다. */
assert.equal(engine.identifyChord(engine.stringNotes([0,5,4,4,3,0])).name,'E7sus2');
assert.equal(name('x02200'),'Asus2');

/* 그 밖의 성질. 대칭인 코드(dim7·aug)는 베이스가 이름을 정한다. */
assert.equal(name('x2343x'),'Bdim');
assert.equal(name('x3424x'),'Cdim7');
assert.equal(name('x3211x'),'Caug');

/* 도수는 코드 이름을 따른다. */
const degrees=found=>found.tones.map(tone=>tone.name+tone.degree).join(' ');
assert.equal(degrees(shape('x32010')),'C1 E3 G5');
assert.equal(degrees(shape('x02010')),'A1 C♭3 E5 G♭7');
assert.equal(degrees(shape('x32030')),'C1 D9 E3 G5','add9의 2도는 9로 적는다');
assert.equal(degrees(shape('xx0233')),'D1 G4 A5','sus4의 4도는 4로 적는다');
assert.equal(degrees(shape('x7678x')),'E1 G♯9 G#3 D♭7','7♯9의 ♭3은 ♯9로 적는다');
assert.equal(degrees(shape('x3211x')),'C1 E3 G#♯5','aug의 ♭6은 ♯5로 적는다');
assert.equal(engine.degreeLabel(9,'dim7'),'♭♭7');
assert.equal(engine.degreeLabel(9,'13'),'13');
assert.equal(engine.degreeLabel(9,'6'),'6');

/* 뮤트한 줄(null)이 MIDI 0번, 곧 C로 끼어들면 안 된다. 처음 짰을 때 A 코드가
   'C + A + E + C#'으로 읽혔다 — Number(null)이 0이기 때문이다. */
assert.equal(engine.identifyChord([null,45,52,57,61,64]).name,'A');

/* 코드가 아닌 것. */
assert.equal(engine.identifyChord([]),null,'소리 나는 줄이 없으면 이름도 없다');
assert.equal(shape('xxxxxx'),null);
const single=shape('xxxxx0');
assert.equal(single.name,'E');
assert.equal(single.kind,'단음');
const octave=shape('xx2xx0');
assert.equal(octave.name,'E');
assert.equal(octave.kind,'옥타브','E를 두 번 — 같은 음이다');
const third=shape('x32xxx');
assert.equal(third.kind,'두 음');
assert.equal(third.name,'C + E');
assert.equal(third.interval,'장3도');

/* 어떤 튜닝이든 같은 규칙으로 읽는다. 우쿨렐레 C(0003). */
const ukulele=[67,60,64,69];
assert.equal(engine.identifyChord(engine.stringNotes([0,0,0,3],ukulele)).name,'C');

console.log('chord engine tests passed');

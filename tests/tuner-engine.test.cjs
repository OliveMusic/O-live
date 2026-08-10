const assert=require('node:assert/strict');

require('../js/tuner-engine.js');
const engine=globalThis.OliveTunerEngine;
const sampleRate=48000;

function generator(seed=42){
  let state=seed>>>0;
  return ()=>{
    state=(state*1664525+1013904223)>>>0;
    return state/4294967296*2-1;
  };
}

function guitarSignal(frequency,amplitude,noiseAmplitude=0){
  const random=generator(Math.round(frequency*100));
  const samples=new Float32Array(engine.FRAME_SIZE);
  for(let i=0;i<samples.length;i++){
    const phase=2*Math.PI*frequency*i/sampleRate;
    const guitarWave=
      Math.sin(phase)+
      Math.sin(phase*2)*0.42+
      Math.sin(phase*3)*0.24+
      Math.sin(phase*4)*0.12;
    samples[i]=guitarWave*amplitude+random()*noiseAmplitude;
  }
  return samples;
}

function roomFrame(seed,{noteFrequency=0,noteAmplitude=0}={}){
  const random=generator(seed);
  const samples=new Float32Array(engine.FRAME_SIZE);
  for(let i=0;i<samples.length;i++){
    let value=random()*0.0005+Math.sin(2*Math.PI*60*i/sampleRate)*0.00035;
    if(noteFrequency){
      const phase=2*Math.PI*noteFrequency*i/sampleRate;
      value+=noteAmplitude*(Math.sin(phase)+Math.sin(phase*2)*0.4+Math.sin(phase*3)*0.2);
    }
    samples[i]=value;
  }
  return samples;
}

function mainsHum(frequency,amplitude){
  const samples=new Float32Array(engine.FRAME_SIZE);
  for(let i=0;i<samples.length;i++){
    for(let harmonic=1;harmonic<=6;harmonic++){
      samples[i]+=Math.sin(2*Math.PI*frequency*harmonic*i/sampleRate)*amplitude/harmonic;
    }
  }
  return samples;
}

function tonalFrame(frequency,frameIndex,components,noiseAmplitude=0){
  const random=generator(5000+frameIndex);
  const samples=new Float32Array(engine.FRAME_SIZE);
  const offset=frameIndex*engine.FRAME_SIZE;
  for(let i=0;i<samples.length;i++){
    const phase=2*Math.PI*frequency*(offset+i)/sampleRate;
    let value=0;
    for(let harmonic=0;harmonic<components.length;harmonic++){
      value+=Math.sin(phase*(harmonic+1))*components[harmonic];
    }
    samples[i]=value+random()*noiseAmplitude;
  }
  return samples;
}

function addFrames(first,second){
  const result=new Float32Array(first.length);
  for(let i=0;i<result.length;i++) result[i]=first[i]+second[i];
  return result;
}

function centsBetween(actual,expected){
  return 1200*Math.log2(actual/expected);
}

const low=engine.sensitivityProfile(15);
const balanced=engine.sensitivityProfile(50);
const weakInput=engine.sensitivityProfile(80);
assert.ok(weakInput.absoluteFloor<balanced.absoluteFloor);
assert.ok(balanced.absoluteFloor<low.absoluteFloor);
assert.ok(weakInput.inputGain>balanced.inputGain);
assert.ok(weakInput.clarityGate<balanced.clarityGate);
assert.ok(weakInput.harmonicityGate<balanced.harmonicityGate);
assert.equal(weakInput.label,'약한 입력');

const quietElectric=guitarSignal(82.4069,0.00022,0.00004);
assert.ok(engine.frameRms(quietElectric)<0.0015,'signal is below the former fixed cutoff');
const electricPitch=engine.detectPitch(quietElectric,sampleRate,{minFrequency:70,maxFrequency:1400});
assert.ok(electricPitch,'quiet harmonic-rich electric guitar is detected');
assert.ok(Math.abs(centsBetween(electricPitch.freq,82.4069))<8,'quiet E2 stays within tuner accuracy');
assert.ok(electricPitch.clarity>weakInput.clarityGate);
assert.ok(electricPitch.harmonicity>weakInput.harmonicityGate,'quiet guitar retains a clear harmonic structure');

const acoustic=guitarSignal(329.6276,0.02,0.0002);
const acousticPitch=engine.detectPitch(acoustic,sampleRate,{minFrequency:70,maxFrequency:1400});
assert.ok(acousticPitch);
assert.ok(Math.abs(centsBetween(acousticPitch.freq,329.6276))<3,'loud input accuracy is retained');

const random=generator(7);
const noise=new Float32Array(engine.FRAME_SIZE);
for(let i=0;i<noise.length;i++) noise[i]=random()*0.001;
assert.equal(engine.detectPitch(noise,sampleRate,{minFrequency:70,maxFrequency:1400}),null,'broadband noise is rejected');

const spectrum=engine.analyzePitch(quietElectric,sampleRate,{minFrequency:70,maxFrequency:1400});
assert.equal(spectrum.bands.length,engine.BAND_EDGES.length-1);
assert.ok(spectrum.bands.some(level=>level>0),'frequency bands contain measured energy');
assert.ok(spectrum.pitch.harmonicity>0.75,'guitar harmonics receive high confidence');

for(const frequency of [50,60]){
  assert.equal(
    engine.detectPitch(mainsHum(frequency,0.002),sampleRate,{minFrequency:70,maxFrequency:1400}),
    null,
    frequency+' Hz mains hum is not mistaken for a guitar note',
  );
}

const quietGate=engine.createSignalGate();
for(let i=0;i<80;i++) quietGate.evaluate(0.00004,weakInput,{pitched:false,locked:false});
assert.equal(quietGate.evaluate(0.00024,weakInput,{pitched:true,locked:false}).open,true,'weak-input mode opens for a quiet note');

const lowGate=engine.createSignalGate();
for(let i=0;i<80;i++) lowGate.evaluate(0.00004,low,{pitched:false,locked:false});
assert.equal(lowGate.evaluate(0.00024,low,{pitched:true,locked:false}).open,false,'noise-suppression mode keeps the same weak level closed');

const noisyRoomGate=engine.createSignalGate();
let noisyRoom;
for(let i=0;i<180;i++) noisyRoom=noisyRoomGate.evaluate(0.001,balanced,{pitched:false,locked:false});
assert.equal(noisyRoom.open,false,'adaptive floor learns steady room noise');
assert.equal(noisyRoomGate.evaluate(0.004,balanced,{pitched:true,locked:false}).open,true,'a note clearly above room noise still opens');

const bandProfile=engine.createBandNoiseProfile();
let learnedNoise;
for(let i=0;i<120;i++){
  const analysis=engine.analyzePitch(roomFrame(100+i),sampleRate,{
    minFrequency:70,maxFrequency:1400,skipPitch:true,
  });
  learnedNoise=bandProfile.evaluate(analysis.bands,balanced,{pitched:false,locked:false});
}
assert.ok(learnedNoise.confidence<0.2,'steady room noise becomes the per-band baseline');

const noisyNote=engine.analyzePitch(roomFrame(999,{noteFrequency:110,noteAmplitude:0.002}),sampleRate,{
  minFrequency:70,maxFrequency:1400,
});
const noisyNoteState=bandProfile.evaluate(noisyNote.bands,balanced,{pitched:true,locked:false});
assert.ok(noisyNote.pitch,'a guitar note over the learned room noise is detected');
assert.ok(Math.abs(centsBetween(noisyNote.pitch.freq,110))<18);
assert.ok(noisyNoteState.confidence>0.7,'the note stands out from its learned frequency bands');

const tracker=engine.createPitchTracker();
const a2={freq:110,clarity:0.95,harmonicity:0.82,confidence:0.82};
assert.equal(tracker.update(a2),null,'a new moderate-confidence pitch waits for confirmation');
assert.equal(tracker.update(a2),a2,'two matching frames acquire the pitch');
assert.equal(tracker.update({...a2,freq:220}),null,'one octave-jump frame is ignored');
const confirmedOctave={...a2,freq:220};
assert.deepEqual(tracker.update(confirmedOctave),confirmedOctave,'a real new note is accepted on the second frame');
tracker.reset();
assert.equal(tracker.isLocked(),false);

const activity=engine.createToneActivityDetector();
let firstBackground=-1,fanAnalysis,fanState;
for(let frame=0;frame<90;frame++){
  const fan=tonalFrame(93,frame,[0.001,0.00035],0.00002);
  fanAnalysis=engine.analyzePitch(fan,sampleRate,{minFrequency:70,maxFrequency:1400});
  fanState=activity.update(
    fanAnalysis.pitch,fanAnalysis.bands,engine.frameRms(fan,4),frame*22.2,
  );
  if(firstBackground<0 && fanState.background) firstBackground=frame;
}
assert.ok(firstBackground>=45 && firstBackground<=65,'steady fan tone becomes background in about one second');
assert.ok(fanState.penalty>0.58,'persistent fan receives enough confidence penalty');
const maximumFanConfidence=fanAnalysis.pitch.clarity*0.62+
  fanAnalysis.pitch.harmonicity*0.24+0.14-
  fanAnalysis.pitch.humLikelihood*0.18-fanState.penalty;
assert.ok(maximumFanConfidence<0.48,'even maximum band confidence cannot reopen the learned fan');

const fanAtAttack=tonalFrame(93,90,[0.001,0.00035],0.00002);
const guitarAttack=tonalFrame(93,90,[0.004,0.00168,0.00096,0.00048],0);
const mixedAttack=addFrames(fanAtAttack,guitarAttack);
const attackAnalysis=engine.analyzePitch(mixedAttack,sampleRate,{minFrequency:70,maxFrequency:1400});
const attackState=activity.update(
  attackAnalysis.pitch,attackAnalysis.bands,engine.frameRms(mixedAttack,4),90*22.2,
);
assert.equal(attackState.onset,true,'a pluck over the same fan frequency is recognized as a new attack');
assert.equal(attackState.attackActive,true);
assert.equal(attackState.background,false);
assert.equal(attackState.penalty,0);

const immediateActivity=engine.createToneActivityDetector();
let startupAttackSeen=false,startupState;
for(let frame=0;frame<50;frame++){
  const decay=Math.exp(-frame/25);
  const pluck=tonalFrame(110,frame,[0.003*decay,0.00126*decay,0.00072*decay],0.00001);
  const analysis=engine.analyzePitch(pluck,sampleRate,{minFrequency:70,maxFrequency:1400});
  startupState=immediateActivity.update(
    analysis.pitch,analysis.bands,engine.frameRms(pluck,4),frame*22.2,
  );
  startupAttackSeen ||= startupState.onset;
}
assert.equal(startupAttackSeen,true,'a pluck made immediately after microphone start is recovered from its decay');
assert.equal(startupState.attackActive,true);
assert.equal(startupState.background,false);

console.log('tuner engine tests passed');

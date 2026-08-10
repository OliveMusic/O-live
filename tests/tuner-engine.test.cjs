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
assert.equal(weakInput.label,'약한 입력');

const quietElectric=guitarSignal(82.4069,0.00022,0.00004);
assert.ok(engine.frameRms(quietElectric)<0.0015,'signal is below the former fixed cutoff');
const electricPitch=engine.detectPitch(quietElectric,sampleRate,{minFrequency:70,maxFrequency:1400});
assert.ok(electricPitch,'quiet harmonic-rich electric guitar is detected');
assert.ok(Math.abs(centsBetween(electricPitch.freq,82.4069))<8,'quiet E2 stays within tuner accuracy');
assert.ok(electricPitch.clarity>weakInput.clarityGate);

const acoustic=guitarSignal(329.6276,0.02,0.0002);
const acousticPitch=engine.detectPitch(acoustic,sampleRate,{minFrequency:70,maxFrequency:1400});
assert.ok(acousticPitch);
assert.ok(Math.abs(centsBetween(acousticPitch.freq,329.6276))<3,'loud input accuracy is retained');

const random=generator(7);
const noise=new Float32Array(engine.FRAME_SIZE);
for(let i=0;i<noise.length;i++) noise[i]=random()*0.001;
assert.equal(engine.detectPitch(noise,sampleRate,{minFrequency:70,maxFrequency:1400}),null,'broadband noise is rejected');

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

console.log('tuner engine tests passed');

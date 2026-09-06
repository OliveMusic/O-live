const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('js/audio-runtime.js','utf8');
const start=html.indexOf('let audioCtx = null;');
const end=html.indexOf('/* ===== 소리 나는 동안 화면 켜 두기 =====');
assert.ok(start>=0 && end>start,'audio lifecycle source is present');

class FakeAudioContext{
  static instances=[];
  static rejectNextResume=false;
  constructor(options){
    this.options=options;
    this.state='suspended';
    this.resumeCalls=0;
    this.closeCalls=0;
    this.listeners=new Map();
    FakeAudioContext.instances.push(this);
  }
  addEventListener(type,listener){ this.listeners.set(type,listener); }
  emit(type){ const listener=this.listeners.get(type); if(listener) listener(); }
  async resume(){
    this.resumeCalls++;
    if(FakeAudioContext.rejectNextResume){
      FakeAudioContext.rejectNextResume=false;
      throw new Error('resume failed');
    }
    this.state='running';
    this.emit('statechange');
  }
  async close(){
    this.closeCalls++;
    this.state='closed';
    this.emit('statechange');
  }
}

let sounding=false;
let stopCalls=0;
let stopForegroundCalls=0;
const sandbox={
  window:{AudioContext:FakeAudioContext},
  navigator:{audioSession:{type:'auto'}},
  setTimeout,
  clearTimeout,
  Promise,
  Error,
  console,
  __master:null,
  __send:null,
  __gtrCache:new Map(),
  anySounding:()=>sounding,
  hasBackgroundTransportPlaying:()=>false,
  stopAllTransports:()=>{ stopCalls++; },
  stopForegroundTransports:()=>{ stopForegroundCalls++; },
};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(
  html.slice(start,end)+
  '\n;globalThis.audioRuntime={ensureCtx,ensureRecordingCtx,ensurePlaybackCtx,ensureBackgroundPlaybackCtx,beginPlaybackFromGesture,resumeCtx,releaseCtx,getCtx,'+
  'getContext:()=>audioCtx,getMode:()=>__ctxMode};',
  sandbox
);

(async()=>{
  const runtime=sandbox.audioRuntime;
  const first=await runtime.ensureCtx('ambient');
  assert.equal(first.state,'running');
  assert.equal(first.options.latencyHint,'interactive');
  assert.equal(runtime.getMode(),'ambient');
  assert.equal(sandbox.navigator.audioSession.type,'ambient');
  assert.equal(FakeAudioContext.instances.length,1);

  const preserved=await runtime.ensureRecordingCtx(true);
  assert.equal(preserved,first,'recording reuses an active backing-track context');
  assert.equal(runtime.getMode(),'play-and-record');
  sandbox.window.OliveRecorder={isRecording:()=>true};
  assert.equal(await runtime.ensurePlaybackCtx(),first,'playback shares the recording context');

  first.state='suspended';
  const beforeGestureResume=first.resumeCalls;
  const gesturePlayback=runtime.beginPlaybackFromGesture();
  assert.equal(gesturePlayback.ctx,first);
  assert.equal(first.resumeCalls,beforeGestureResume+1,'gesture playback resumes synchronously');
  await gesturePlayback.ready;

  sandbox.window.OliveRecorder={isRecording:()=>false};
  const recordingPlayback=runtime.beginPlaybackFromGesture();
  assert.equal(recordingPlayback.ctx,first);
  assert.equal(runtime.getMode(),'playback');
  assert.equal(sandbox.navigator.audioSession.type,'playback');
  await recordingPlayback.ready;

  first.state='suspended';
  const beforeResumeCalls=first.resumeCalls;
  await Promise.all([runtime.resumeCtx(first),runtime.resumeCtx(first)]);
  assert.equal(first.resumeCalls,beforeResumeCalls+1,'parallel resume calls are deduplicated');

  let recorderStopPlaybackCalls=0;
  sandbox.window.OliveRecorder={
    isRecording:()=>false,
    stopPlayback:()=>{ recorderStopPlaybackCalls++; },
  };
  await runtime.ensurePlaybackCtx();
  assert.equal(recorderStopPlaybackCalls,1,'ambient tools stop stale recording playback state');

  const fresh=await runtime.ensureCtx('play-and-record',true);
  assert.notEqual(fresh,first);
  assert.equal(first.closeCalls,1);
  assert.equal(fresh.state,'running');
  assert.equal(runtime.getMode(),'play-and-record');

  FakeAudioContext.rejectNextResume=true;
  const instanceCount=FakeAudioContext.instances.length;
  const recovered=await runtime.ensureCtx('ambient',true);
  assert.equal(FakeAudioContext.instances.length,instanceCount+2,'failed resume recreates once');
  assert.equal(recovered.state,'running');
  assert.equal(runtime.getContext(),recovered);

  sounding=true;
  recovered.state='interrupted';
  recovered.emit('statechange');
  await Promise.resolve();
  assert.equal(runtime.getContext(),null);
  assert.equal(stopCalls,1,'interrupted playback stops registered transports');
  assert.equal(recovered.closeCalls,1);

  sounding=false;
  const background=await runtime.ensureBackgroundPlaybackCtx('메트로놈');
  assert.equal(background.state,'running');
  assert.equal(runtime.getMode(),'playback');
  assert.equal(sandbox.navigator.audioSession.type,'playback');
  assert.equal(stopForegroundCalls,1,'background playback stops only foreground transports');

  console.log('audio lifecycle tests passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});

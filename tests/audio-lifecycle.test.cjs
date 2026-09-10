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
  static hangNextResume=false;
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
    if(FakeAudioContext.hangNextResume){
      FakeAudioContext.hangNextResume=false;
      await new Promise(()=>{});   // WebKit이 제스처 밖 resume()에 하는 짓
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
  stopCompetingBackgroundTransports:()=>{},
  setBackgroundTransportContext:()=>{},
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
  assert.equal(background.options.latencyHint,'interactive','background tools request low latency');
  assert.equal(runtime.getMode(),'playback');
  assert.equal(sandbox.navigator.audioSession.type,'playback');
  assert.equal(stopForegroundCalls,1,'background playback stops only foreground transports');

  /* iOS는 사용자 제스처가 살아 있는 동안 부른 resume()만 받아 준다. 마이크로태스크로
     한 번만 미뤄도 자격을 잃으므로 제스처 안에서 곧바로 불러야 한다. */
  sounding=false;
  await runtime.releaseCtx();
  const gesture=runtime.getCtx();
  assert.equal(gesture.resumeCalls,1,'resume()는 제스처와 같은 실행 안에서 불린다');

  /* 그 자격을 잃으면 WebKit은 끝나지 않는 프라미스를 준다. 그것이 빗장을 걸어 두면
     놓치는 것이 첫 소리 하나가 아니라 그 뒤 모든 소리가 된다. 시한을 두어 풀어 준다. */
  await runtime.releaseCtx();
  FakeAudioContext.hangNextResume=true;
  const stuck=runtime.getCtx();
  assert.equal(stuck.resumeCalls,1);
  assert.equal(stuck.state,'suspended','끝나지 않은 시도는 컨텍스트를 열지 못한다');
  await new Promise(done=>setTimeout(done,1700));
  assert.equal(runtime.getCtx(),stuck,'같은 컨텍스트를 다시 쓴다');
  assert.equal(stuck.resumeCalls,2,'끝나지 않은 시도가 다음 소리까지 막지 않는다');
  await new Promise(done=>setTimeout(done,0));
  assert.equal(stuck.state,'running','다음 탭이 컨텍스트를 연다');

  console.log('audio lifecycle tests passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});

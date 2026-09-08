const {test,expect}=require('playwright/test');

const pageErrors=new WeakMap();

async function preparePage(page,{
  cloudClient=false,preferences=null,microphone='native',recordings=[],cloudUploadError='',
  mediaActionFailOnce='',recordingListFailOnce=false,
}={}){
  const errors=[];
  pageErrors.set(page,errors);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:'',
  }));
  await page.addInitScript(({
    withCloud,storedPreferences,micMode,recordingRows,recordingUploadError,failMediaActionOnce,
    failRecordingListOnce,
  })=>{
    sessionStorage.setItem('olive-startup-state-v2','shown');
    const audioSession={type:'auto'};
    try{ Object.defineProperty(navigator,'audioSession',{configurable:true,value:audioSession}); }
    catch(error){}
    window.__testAudioSession=audioSession;
    const mediaActions={};
    const mediaActionRegistrations={};
    const mediaActionClearances={};
    let pendingMediaActionFailure=String(failMediaActionOnce||'');
    const mediaSession={
      metadata:null,
      playbackState:'none',
      positionState:null,
      setActionHandler(action,handler){
        if(handler && action===pendingMediaActionFailure){
          pendingMediaActionFailure='';
          throw new Error('simulated transient Media Session failure');
        }
        if(handler){
          mediaActions[action]=handler;
          mediaActionRegistrations[action]=(mediaActionRegistrations[action]||0)+1;
        }
        else{
          delete mediaActions[action];
          mediaActionClearances[action]=(mediaActionClearances[action]||0)+1;
        }
      },
      setPositionState(state){ this.positionState=state?{...state}:null; },
    };
    try{ Object.defineProperty(navigator,'mediaSession',{configurable:true,value:mediaSession}); }
    catch(error){}
    window.__testMediaActions=mediaActions;
    window.__testMediaActionRegistrations=mediaActionRegistrations;
    window.__testMediaActionClearances=mediaActionClearances;
    window.__testMediaSession=mediaSession;
    if(storedPreferences){
      localStorage.setItem('olive-preferences-v1',JSON.stringify(storedPreferences));
    }
    if(withCloud==='recordings'){
      const serverRows=recordingRows.slice();
      let pendingRecording=null;
      let remainingRecordingListFailures=failRecordingListOnce?1:0;
      const user={
        id:'recording-browser-user',email:'recording@example.com',
        app_metadata:{provider:'google'},user_metadata:{full_name:'Recording Test'},
      };
      const client={
        auth:{
          onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
          async getSession(){ return {data:{session:{user}},error:null}; },
        },
        async rpc(name,args){
          if(name==='olive_schema_version') return {data:11,error:null};
          if(name==='reserve_practice_recording') pendingRecording=args;
          if(name==='finalize_practice_recording' && pendingRecording &&
             pendingRecording.p_recording_id===args.p_recording_id){
            serverRows.unshift({
              id:pendingRecording.p_recording_id,title:pendingRecording.p_title,
              object_path:pendingRecording.p_object_path,duration_ms:pendingRecording.p_duration_ms,
              byte_size:pendingRecording.p_byte_size,mime_type:pendingRecording.p_mime_type,
              waveform:pendingRecording.p_waveform,playback_gain:pendingRecording.p_playback_gain,
              source_type:pendingRecording.p_source_type,recorded_at:pendingRecording.p_recorded_at,
              created_at:pendingRecording.p_recorded_at,
            });
            pendingRecording=null;
          }
          return {data:true,error:null};
        },
        from(table){
          if(table==='practice_recordings') return {
            select(){ return {eq(){ return {order(){ return {async limit(){
              window.__recordingListRequests=(window.__recordingListRequests||0)+1;
              if(remainingRecordingListFailures>0){
                remainingRecordingListFailures--;
                return {data:null,error:{message:'temporary recording list failure'}};
              }
              return {data:serverRows,error:null};
            }}; }}; }}; },
          };
          if(table==='user_preferences') return {
            select(){ return {eq(){ return {async maybeSingle(){ return {data:null,error:null}; }}; }}; },
            async upsert(){ return {data:null,error:null}; },
          };
          return {select(){ return {async order(){ return {data:[],error:null}; }}; }};
        },
        storage:{from(){ return {
          async upload(path,blob,options){
            if(recordingUploadError) return {data:null,error:{message:recordingUploadError}};
            window.__uploadedRecording={path,size:blob.size,type:blob.type,options};
            return {data:{path},error:null};
          },
          async createSignedUrls(paths){
            return {data:paths.map(path=>({path,signedUrl:`https://storage.example.com/${path}?token=test`})),error:null};
          },
          async download(){
            if(micMode==='playback') return new Promise(resolve=>{
              window.__resolveRecordingDownload=()=>resolve({
                data:new Blob(['recording'],{type:'audio/mp4'}),error:null,
              });
            });
            return {data:new Blob(['recording'],{type:'audio/mp4'}),error:null};
          },
        }; }},
      };
      window.supabase={createClient:()=>client};
      Object.defineProperty(HTMLMediaElement.prototype,'duration',{configurable:true,get(){ return 69; }});
      Object.defineProperty(HTMLMediaElement.prototype,'readyState',{configurable:true,get(){ return 1; }});
      HTMLMediaElement.prototype.play=function(){
        window.__mediaPlayCalls=(window.__mediaPlayCalls||0)+1;
        window.__lastPlayedMedia=this;
        if(this.dataset.oliveRecordingTransport==='true') window.__recordingTransportMedia=this;
        else window.__lastRecordingContentMedia=this;
        const media=this;
        if(micMode!=='playback-stalled' || media.dataset.oliveRecordingPlayback!=='true'){
          setTimeout(()=>{
            if(window.__lastPlayedMedia===media) media.currentTime=(Number(media.currentTime)||0)+.1;
          },80);
        }
        window.__lastMediaSettings={
          playbackRate:this.playbackRate,
          preservesPitch:this.preservesPitch,
          webkitPreservesPitch:this.webkitPreservesPitch,
        };
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause=function(){};
    }else if(withCloud){
      const client={
        auth:{
          onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
          async getSession(){
            return {data:{session:{user:{
              id:'browser-schema-user',
              email:'schema@example.com',
              app_metadata:{provider:'google'},
              user_metadata:{full_name:'Schema Test'},
            }}},error:null};
          },
        },
        async rpc(){
          return {data:null,error:{
            code:'PGRST202',
            message:'Could not find public.olive_schema_version in the schema cache',
          }};
        },
        from(){ throw new Error('schema contract should stop data access'); },
      };
      window.supabase={createClient:()=>client};
    }
    if(micMode!=='native'){
      let analyserSampleCursor=0,analyserFrame=0;
      Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{
        configurable:true,
        get(){ return this.__testSrcObject||null; },
        set(value){ this.__testSrcObject=value; },
      });
      const harness={
        requests:0,stops:0,pending:false,contexts:0,zeroGainConnections:0,
        gainNodes:[],scheduledStarts:[],
      };
      class FakeNode{
        connect(next){
          if(this.gain && this.gain.value===0) harness.zeroGainConnections++;
          this.lastConnection=next||null;
          return next||this;
        }
        disconnect(){ this.lastConnection=null; }
      }
      class FakeAudioContext{
        constructor(){
          harness.contexts++;
          this.state='suspended';
          this.currentTime=0;
          this.sampleRate=48000;
          this.destination=new FakeNode();
          this.listeners=new Map();
          this.audioWorklet={addModule:async url=>{ harness.workletModule=url; }};
        }
        addEventListener(type,listener){ this.listeners.set(type,listener); }
        async resume(){ this.state='running'; }
        async suspend(){ this.state='suspended'; }
        async close(){ this.state='closed'; }
        createMediaStreamSource(){ return new FakeNode(); }
        createBiquadFilter(){
          const node=new FakeNode();
          node.frequency={value:0}; node.Q={value:0};
          return node;
        }
        createAnalyser(){
          const node=new FakeNode();
          node.fftSize=4096;
          node.smoothingTimeConstant=0;
          node.getFloatTimeDomainData=array=>{
            if(micMode==='meter-signal'){
              for(let i=0;i<array.length;i++){
                const phase=2*Math.PI*220*(analyserSampleCursor+i)/48000;
                array[i]=Math.sin(phase)*.003;
              }
              analyserSampleCursor+=array.length;
              return;
            }
            if(micMode!=='weak-signal' && micMode!=='scope-error' && micMode!=='fan-tone'){
              array.fill(0);
              return;
            }
            const pluckFrame=analyserFrame%40;
            const pluckEnvelope=Math.exp(-pluckFrame/24);
            for(let i=0;i<array.length;i++){
              const frequency=micMode==='fan-tone' ? 93 : 82.4069;
              const phase=2*Math.PI*frequency*(analyserSampleCursor+i)/48000;
              array[i]=micMode==='fan-tone'
                ? Math.sin(phase)*0.001+Math.sin(phase*2)*0.00035
                : pluckEnvelope*0.0003*(
                    Math.sin(phase)+
                    Math.sin(phase*2)*0.42+
                    Math.sin(phase*3)*0.24+
                    Math.sin(phase*4)*0.12
                  );
            }
            analyserSampleCursor+=array.length;
            analyserFrame++;
          };
          return node;
        }
        createGain(){
          const node=new FakeNode();
          node.gain={
            value:1,
            setValueAtTime(value){ this.value=value; },
            exponentialRampToValueAtTime(value){ this.value=value; },
            setTargetAtTime(value){ this.value=value; },
            cancelScheduledValues(){},
          };
          harness.gainNodes.push(node);
          return node;
        }
        createOscillator(){
          const node=new FakeNode();
          node.type='sine';
          node.frequency={
            value:0,
            setValueAtTime(value){ this.value=value; },
            exponentialRampToValueAtTime(value){ this.value=value; },
          };
          node.start=when=>{ harness.scheduledStarts.push(Number(when)||0); };
          node.stop=()=>{};
          return node;
        }
        createBufferSource(){
          const node=new FakeNode();
          node.playbackRate={
            value:1,
            setValueAtTime(value){ this.value=value; },
          };
          node.start=(when,offset)=>{ harness.lastSourceOffset=offset; };
          node.stop=()=>{};
          harness.bufferSource=node;
          return node;
        }
        createMediaElementSource(){
          harness.mediaElementGain=true;
          return new FakeNode();
        }
        decodeAudioData(buffer,success){
          const decoded={duration:69,length:48000,numberOfChannels:1,getChannelData:()=>new Float32Array(48000)};
          if(success) Promise.resolve().then(()=>success(decoded));
          return Promise.resolve(decoded);
        }
        createDynamicsCompressor(){
          const node=new FakeNode();
          node.threshold={value:0}; node.knee={value:0}; node.ratio={value:0};
          node.attack={value:0}; node.release={value:0};
          harness.compressor=node;
          return node;
        }
        createMediaStreamDestination(){
          const node=new FakeNode();
          const track={stop(){ harness.processedStops=(harness.processedStops||0)+1; },addEventListener(){}};
          node.stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
          harness.processedStream=node.stream;
          return node;
        }
      }
      class FakeAudioWorkletNode extends FakeNode{
        constructor(context,name){
          super();
          const makeParam=()=>({
            value:1,
            setValueAtTime(value){ this.value=value; },
          });
          this.parameters=new Map([
            ['pitch',makeParam()],['pitchSemitones',makeParam()],['playbackRate',makeParam()],
          ]);
          harness.workletNode=this;
          harness.workletName=name;
        }
      }
      if(micMode==='scope-error'){
        const nativeGetContext=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(...args){
          const context=nativeGetContext.apply(this,args);
          if(this.id==='tunerScope' && context){
            context.setLineDash=()=>{ throw new Error('simulated iOS canvas failure'); };
          }
          return context;
        };
      }
      const makeStream=()=>{
        const listeners=new Map();
        const track={
          stop(){ harness.stops++; },
          addEventListener(type,listener){ listeners.set(type,listener); },
        };
        window.__endMic=()=>{
          const listener=listeners.get('ended');
          if(listener) listener();
        };
        return {getTracks:()=>[track],getAudioTracks:()=>[track]};
      };
      const getUserMedia=async constraints=>{
        harness.requests++;
        harness.lastConstraints=constraints;
        if(micMode==='denied'){
          const error=new Error('permission denied');
          error.name='NotAllowedError';
          throw error;
        }
        if(micMode==='deferred'){
          harness.pending=true;
          return new Promise(resolve=>{
            window.__resolveMic=()=>{ harness.pending=false; resolve(makeStream()); };
          });
        }
        const input=makeStream();
        harness.inputStream=input;
        return input;
      };
      window.AudioContext=FakeAudioContext;
      window.webkitAudioContext=FakeAudioContext;
      window.AudioWorkletNode=FakeAudioWorkletNode;
      if(micMode==='meter-signal'){
        class FakeMediaRecorder extends EventTarget{
          static isTypeSupported(){ return true; }
          constructor(input){
            super(); this.mimeType='audio/mp4'; this.state='inactive';
            harness.recorderStream=input; harness.mediaRecorder=this;
          }
          start(){ this.state='recording'; }
          stop(){ this.state='inactive'; this.dispatchEvent(new Event('stop')); }
        }
        window.MediaRecorder=FakeMediaRecorder;
      }
      window.__micHarness=harness;
      Object.defineProperty(navigator,'mediaDevices',{
        configurable:true,
        value:{getUserMedia},
      });
    }
  },{
    withCloud:cloudClient,storedPreferences:preferences,micMode:microphone,
    recordingRows:recordings,recordingUploadError:cloudUploadError,
    failMediaActionOnce:mediaActionFailOnce,failRecordingListOnce:recordingListFailOnce,
  });
  const response=await page.goto('/',{waitUntil:'domcontentloaded'});
  expect(response && response.ok()).toBeTruthy();
  await expect(page.locator('#appVersion')).toHaveText('버전 1.3.43');
}

test.afterEach(async({page})=>{
  expect(pageErrors.get(page)||[]).toEqual([]);
});

test('분리된 앱이 모바일 화면에서 모든 탭과 서비스 워커를 시작한다',async({page})=>{
  await preparePage(page);
  const tabs=[
    ['metronome','메트로놈'],
    ['tuner','튜너'],
    ['scales','스케일'],
    ['trainer','트레이너'],
    ['jam','잼 세션'],
  ];
  for(const [id,title] of tabs){
    await page.locator(`.tab-btn[data-tab="${id}"]`).click();
    await expect(page.locator('#pageTitle')).toHaveText(title);
    await expect(page.locator(`#tab-${id}`)).toBeVisible();
  }
  const workerUrl=await page.evaluate(async()=>{
    if(!('serviceWorker' in navigator)) return '';
    const registration=await navigator.serviceWorker.ready;
    return registration.active ? registration.active.scriptURL : '';
  });
  expect(workerUrl).toContain('service-worker.js?v=173');
});

test('버전을 길게 누르면 기기 내 오디오 진단 기록을 복사한다',async({page})=>{
  await preparePage(page);
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'clipboard',{
      configurable:true,
      value:{writeText:async text=>{ window.__testCopiedDiagnostics=text; }},
    });
  });
  const version=page.locator('#appVersion');
  await version.dispatchEvent('pointerdown',{clientX:10,clientY:10});
  await page.waitForTimeout(720);
  await version.dispatchEvent('pointerup',{clientX:10,clientY:10});
  await expect(version).toHaveText('진단 기록 복사됨');
  const payload=await page.evaluate(()=>JSON.parse(window.__testCopiedDiagnostics));
  expect(payload.release).toEqual({version:'1.3.43',build:173});
  expect(payload.entries.some(entry=>entry.event==='app:ready')).toBeTruthy();
});

test('녹음 탭이 기존 올리브 버튼 비율과 계정 연결 흐름을 유지한다',async({page})=>{
  await preparePage(page);
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await expect(page.locator('#trainerSeg .seg-btn')).toHaveCount(3);
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await expect(page.locator('#pane-record')).toBeVisible();
  await expect(page.locator('#recordTimer')).toHaveText('0:00');
  await expect(page.locator('#recordState')).toHaveText('녹음 준비');
  await expect(page.locator('#recordTimeProgress')).toHaveAttribute('aria-valuetext','0:00 / 5:00');
  await expect(page.locator('#recordTimeOlive')).toHaveCSS('left','0%');
  await expect(page.locator('#recordGuest')).toBeVisible();
  await expect(page.locator('#recordWorkspace')).toBeHidden();
  await expect(page.locator('#recordUsage')).toHaveText('0 / 50');

  const olive=await page.locator('.record-olive-static').evaluate(element=>{
    const style=getComputedStyle(element);
    const seed=getComputedStyle(element,'::after');
    return {width:parseFloat(style.width),height:parseFloat(style.height),transform:style.transform,
      seedWidth:seed.width,seedHeight:seed.height};
  });
  expect(olive.width).toBeCloseTo(76,1);
  expect(olive.height).toBeCloseTo(62.5,1);
  expect(olive.transform).not.toBe('none');
  expect(olive.seedWidth).toBe('23px');
  expect(olive.seedHeight).toBe('23px');

  await page.locator('#recordConnect').click();
  await expect(page.locator('#cloudAuthSheet')).toBeVisible();
});

test('내 녹음 목록 요청이 잠시 실패해도 자동으로 다시 불러온다',async({page})=>{
  await preparePage(page,{
    cloudClient:'recordings',
    microphone:'controls',
    recordingListFailOnce:true,
    recordings:[{
      id:'recording-after-retry',title:'다시 불러온 녹음',
      object_path:'recording-browser-user/recording-after-retry.m4a',
      duration_ms:42000,byte_size:1000,mime_type:'audio/mp4',waveform:[25,40,65,35],
      playback_gain:2.5,
      recorded_at:'2026-09-08T01:00:00.000Z',created_at:'2026-09-08T01:00:00.000Z',
    }],
  });
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();

  await expect(page.locator('.record-row-copy strong')).toHaveText('다시 불러온 녹음');
  await expect(page.locator('#recordMessage')).toBeEmpty();
  await expect.poll(()=>page.evaluate(()=>window.__recordingListRequests||0)).toBeGreaterThanOrEqual(2);
});

test('녹음 줄을 열면 올리브 재생 버튼과 탐색 가능한 파형이 나타난다',async({page})=>{
  const waveform=Array.from({length:80},(_,index)=>18+(index*17)%82);
  await preparePage(page,{
    cloudClient:'recordings',
    microphone:'playback',
    mediaActionFailOnce:'seekbackward',
    recordings:[{
      id:'recording-1',title:'9월 6일 녹음',object_path:'recording-browser-user/recording-1.m4a',
      duration_ms:69000,byte_size:1000,mime_type:'audio/mp4',waveform,
      playback_gain:3.25,
      recorded_at:'2026-09-06T09:00:00.000Z',created_at:'2026-09-06T09:00:00.000Z',
    }],
  });
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await expect(page.locator('.record-row-open')).toHaveCount(1);
  await expect(page.locator('.record-player')).toHaveCount(0);
  await page.locator('.record-row-open').click();
  await expect(page.locator('.record-player')).toBeVisible();
  await expect(page.locator('.record-player-play')).toBeVisible();
  await expect(page.locator('.record-waveform[role="slider"]')).toBeVisible();
  await expect(page.locator('.record-waveform-svg.base path')).toHaveAttribute('d',/M/);
  await expect(page.locator('.record-player-tool.point')).toHaveCount(2);
  await expect(page.locator('.record-player-tool.repeat')).toBeEnabled();
  await expect(page.locator('.record-player-tool.repeat svg')).toBeVisible();
  await expect(page.locator('.record-rate-control input[type="range"]')).toHaveValue('1');
  await expect(page.locator('.record-row-copy small')).toHaveText(/2026\. 09\. 06\. \d{2}:\d{2}/);

  const waveformControl=page.locator('.record-waveform');
  const box=await waveformControl.boundingBox();
  expect(box).toBeTruthy();
  const waveformSvgBox=await page.locator('.record-waveform-svg.base').boundingBox();
  const playBox=await page.locator('.record-player-play').boundingBox();
  expect(box.height).toBeCloseTo(44,0);
  expect(waveformSvgBox.y-box.y).toBeCloseTo(2,0);
  expect((box.y+box.height)-(waveformSvgBox.y+waveformSvgBox.height)).toBeCloseTo(2,0);
  expect(playBox.y+playBox.height/2).toBeCloseTo(box.y+box.height/2,0);
  await waveformControl.click({position:{x:box.width*.75,y:box.height/2}});
  expect(await page.evaluate(()=>window.__mediaPlayCalls||0)).toBeGreaterThan(0);
  await page.evaluate(()=>window.__resolveRecordingDownload());
  await expect(page.locator('.record-player-play')).toHaveClass(/playing/);
  expect(await page.evaluate(()=>Boolean(
    window.__recordingTransportMedia &&
    window.__recordingTransportMedia.dataset.oliveRecordingTransport==='true'
  ))).toBeTruthy();
  expect(await page.evaluate(()=>Boolean(window.__micHarness.mediaElementGain))).toBeTruthy();
  expect(await page.evaluate(()=>window.__testAudioSession.type)).toBe('playback');
  expect(await page.evaluate(()=>({
    play:typeof window.__testMediaActions.play,
    pause:typeof window.__testMediaActions.pause,
    backward:typeof window.__testMediaActions.seekbackward,
    forward:typeof window.__testMediaActions.seekforward,
  }))).toEqual({play:'function',pause:'undefined',backward:'function',forward:'function'});
  expect(await page.evaluate(()=>window.OliveAudioDiagnostics.read()
    .map(entry=>entry.event))).toEqual(expect.arrayContaining([
    'recording-media-actions:retry','recording-media-actions:installed',
  ]));
  await expect(page.locator('.record-waveform')).toHaveAttribute('aria-valuenow',/5[01-3]/);
  await expect(page.locator('.record-player-elapsed')).toHaveText('00:51');
  const playCallsBeforeSeek=await page.evaluate(()=>window.__mediaPlayCalls||0);
  await page.locator('.record-waveform').click({position:{x:box.width*.25,y:box.height/2}});
  await expect(page.locator('.record-player-play')).toHaveClass(/playing/);
  await expect(page.locator('.record-waveform')).toHaveAttribute('aria-valuenow',/1[67-8]/);
  await expect(page.locator('.record-player-elapsed')).toHaveText('00:17');
  expect(await page.evaluate(()=>window.__mediaPlayCalls||0)).toBe(playCallsBeforeSeek);

  await page.locator('.record-player-tool.point').nth(0).click();
  await waveformControl.click({position:{x:box.width*.5,y:box.height/2}});
  await page.locator('.record-player-tool.point').nth(1).click();
  await expect(page.locator('.record-waveform')).toHaveClass(/has-loop-start/);
  await expect(page.locator('.record-waveform')).toHaveClass(/has-loop-end/);
  const loopLabelSizes=await page.evaluate(()=>({
    marker:parseFloat(getComputedStyle(document.querySelector('.record-loop-marker.start'),'::before').fontSize),
    button:parseFloat(getComputedStyle(document.querySelector('.record-player-tool.point')).fontSize),
    markerTop:parseFloat(getComputedStyle(document.querySelector('.record-loop-marker.start'),'::before').top),
    waveformTopPadding:parseFloat(getComputedStyle(document.querySelector('.record-waveform-wrap')).paddingTop),
  }));
  expect(loopLabelSizes.marker).toBeLessThanOrEqual(loopLabelSizes.button);
  expect(loopLabelSizes.button-loopLabelSizes.marker).toBeLessThan(3);
  expect(loopLabelSizes.markerTop).toBe(-15);
  expect(loopLabelSizes.waveformTopPadding).toBe(16);
  await expect(page.locator('.record-player-tool.repeat')).toHaveClass(/active/);
  await expect(page.locator('.record-player-tool.repeat')).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>{ window.__lastRecordingContentMedia.currentTime=35; });
  await expect(page.locator('.record-player-elapsed')).toHaveText('00:17');
  await page.locator('.record-player-tool.repeat').click();
  await expect(page.locator('.record-player-tool.repeat')).not.toHaveClass(/active/);
  await page.locator('.record-player-tool.repeat').click();
  await expect(page.locator('.record-player-tool.repeat')).toHaveClass(/active/);
  await page.locator('.record-player-tool.clear').click();
  await expect(page.locator('.record-waveform')).not.toHaveClass(/has-loop-start/);
  await expect(page.locator('.record-player-tool.repeat')).toBeEnabled();
  await expect(page.locator('.record-player-tool.repeat')).toHaveClass(/active/);
  expect(await page.evaluate(()=>window.__lastRecordingContentMedia.loop)).toBeTruthy();
  await page.evaluate(()=>{ window.__lastRecordingContentMedia.currentTime=23; });
  await expect.poll(()=>page.evaluate(()=>(
    window.__testMediaSession.positionState&&window.__testMediaSession.positionState.position
  ))).toBeGreaterThan(22);

  await page.locator('.record-rate-control input[type="range"]').fill('0.75');
  await expect(page.locator('.record-rate-control input[type="range"]')).toHaveValue('0.75');
  await expect(page.locator('.record-rate-value')).toHaveText('0.75×');
  await expect.poll(()=>page.evaluate(()=>({
    module:window.__micHarness.workletModule,
    processor:window.__micHarness.workletName,
    sourceRate:window.__micHarness.bufferSource&&window.__micHarness.bufferSource.playbackRate.value,
    stretchRate:window.__micHarness.workletNode&&
      window.__micHarness.workletNode.parameters.get('playbackRate').value,
  }))).toMatchObject({
    module:'./vendor/soundtouch/soundtouch-processor.js?v=173',
    processor:'soundtouch-processor',sourceRate:.75,stretchRate:.75,
  });
  await page.locator('.record-rate-control input[type="range"]').dblclick();
  await expect(page.locator('.record-rate-control input[type="range"]')).toHaveValue('1');
  await expect(page.locator('.record-rate-value')).toHaveText('1×');
  await expect.poll(()=>page.evaluate(()=>([
    window.__micHarness.bufferSource.playbackRate.value,
    window.__micHarness.workletNode.parameters.get('playbackRate').value,
  ]))).toEqual([1,1]);
  const beforeRemoteSeek=await page.evaluate(()=>window.__testMediaSession.positionState.position);
  await page.evaluate(()=>window.__testMediaActions.seekforward({seekOffset:10}));
  await expect.poll(()=>page.evaluate(()=>window.__micHarness.lastSourceOffset))
    .toBeCloseTo(beforeRemoteSeek+10,3);
  await page.evaluate(()=>window.__testMediaActions.seekbackward({seekOffset:10}));
  await expect.poll(()=>page.evaluate(()=>window.__micHarness.lastSourceOffset))
    .toBeCloseTo(beforeRemoteSeek,3);
  const actionRegistrations=await page.evaluate(()=>({
    play:window.__testMediaActionRegistrations.play,
    backward:window.__testMediaActionRegistrations.seekbackward,
    forward:window.__testMediaActionRegistrations.seekforward,
  }));
  await page.evaluate(()=>window.__recordingTransportMedia.dispatchEvent(new Event('pause')));
  await expect(page.locator('.record-player-play')).not.toHaveClass(/playing/);
  await expect.poll(()=>page.evaluate(()=>window.__testMediaSession.playbackState)).toBe('paused');
  await page.evaluate(()=>window.__testMediaActions.play());
  await expect(page.locator('.record-player-play')).toHaveClass(/playing/);
  expect(await page.evaluate(()=>({
    play:window.__testMediaActionRegistrations.play,
    backward:window.__testMediaActionRegistrations.seekbackward,
    forward:window.__testMediaActionRegistrations.seekforward,
  }))).toEqual(actionRegistrations);
  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.record-player-play')).toHaveClass(/playing/);
  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('.record-player-play').click();
  await expect(page.locator('.record-player-play')).not.toHaveClass(/playing/);

  const dragWaveform=page.locator('.record-waveform');
  const dragBox=await dragWaveform.boundingBox();
  await page.mouse.move(dragBox.x+dragBox.width*.6,dragBox.y+dragBox.height/2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x+1,dragBox.y+dragBox.height/2,{steps:4});
  await page.mouse.up();
  await expect(page.locator('.record-player-elapsed')).toHaveText('00:00');
  await expect(page.locator('.record-waveform')).toHaveAttribute('aria-valuenow','0');
  await expect(page.locator('.record-player-play')).not.toHaveClass(/playing/);

  const playCallsBeforeResume=await page.evaluate(()=>window.__mediaPlayCalls||0);
  await page.locator('.record-player-play').click();
  await expect(page.locator('.record-player-play')).toHaveClass(/playing/);
  expect(await page.evaluate(()=>window.__mediaPlayCalls||0)).toBeGreaterThan(playCallsBeforeResume);
  await page.locator('.record-player-play').click();
  await expect(page.locator('.record-player-play')).not.toHaveClass(/playing/);

  await page.locator('.record-row-more').click();
  await expect(page.locator('#recordMenuBackdrop')).toBeVisible();
  await expect(page.locator('#recordMenuCancel')).toHaveCount(0);
  await expect(page.locator('.record-row-open')).toHaveAttribute('aria-expanded','true');
  await page.locator('#recordMenuBackdrop').click({position:{x:4,y:4}});
  await expect(page.locator('#recordMenuBackdrop')).toBeHidden();
});

test('녹음 재생 중 메트로놈을 시작하면 녹음 버튼도 정지 상태로 돌아간다',async({page})=>{
  await preparePage(page,{
    cloudClient:'recordings',
    microphone:'playback',
    recordings:[{
      id:'recording-transition',title:'무제',
      object_path:'recording-browser-user/recording-transition.m4a',
      duration_ms:69000,byte_size:1000,mime_type:'audio/mp4',waveform:[30,55,75,40],
      playback_gain:3.25,
      recorded_at:'2026-09-06T09:00:00.000Z',created_at:'2026-09-06T09:00:00.000Z',
    }],
  });
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await page.locator('.record-row-open').click();
  const recordingPlay=page.locator('.record-player-play');
  await recordingPlay.click();
  await expect(recordingPlay).toHaveClass(/playing/);
  await page.evaluate(()=>window.__resolveRecordingDownload());

  await page.locator('.tab-btn[data-tab="metronome"]').click();
  await page.locator('#metroStart').click();
  await expect(page.locator('#metroStart')).toHaveClass(/running/);
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await expect(recordingPlay).not.toHaveClass(/playing/);
  await expect(recordingPlay).toHaveAttribute('aria-label','무제 재생');
});

test('iPhone PWA는 무음이 되는 직접 재생기 대신 검증된 오디오 경로를 쓴다',async({page})=>{
  await preparePage(page,{
    cloudClient:'recordings',
    microphone:'playback-stalled',
    recordings:[{
      id:'recording-stalled',title:'무제',
      object_path:'recording-browser-user/recording-stalled.m4a',
      duration_ms:69000,byte_size:1000,mime_type:'audio/mp4',waveform:[30,55,75,40],
      playback_gain:3.25,
      recorded_at:'2026-09-06T09:00:00.000Z',created_at:'2026-09-06T09:00:00.000Z',
    }],
  });
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await page.locator('.record-row-open').click();
  await page.locator('.record-player-play').click();
  await expect.poll(()=>page.evaluate(()=>(
    window.__mediaPlayCalls||0
  )),{timeout:3000}).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(()=>Boolean(
    window.__lastRecordingContentMedia &&
    window.__lastRecordingContentMedia.dataset.oliveRecordingPlayback!=='true' &&
    window.__recordingTransportMedia &&
    window.__recordingTransportMedia.dataset.oliveRecordingTransport==='true'
  ))).toBeTruthy();
  expect(await page.evaluate(()=>Boolean(window.__micHarness.mediaElementGain))).toBeTruthy();
  await expect(page.locator('.record-player-play')).toHaveClass(/playing/);
  await expect(page.locator('#recordMessage')).not.toHaveClass(/error/);
});

test('메트로놈과 잼은 서로 교대하고 진행 중인 녹음은 유지한다',async({page})=>{
  const progression=[1,5,6,4].map(deg=>({deg,beats:1,sev:false,fam:null}));
  await preparePage(page,{
    cloudClient:'recordings',
    microphone:'meter-signal',
    preferences:{
      data:{jam:{
        root:0,mode:'major',preset:'custom',bpm:90,seventh:false,style:'rock',
        tracks:{drum:false,bass:false,chord:false,click:false},progression,
      }},
      updatedAt:'2026-09-07T00:00:00.000Z',
    },
  });
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  const recorder=page.locator('#recordToggle');
  await recorder.click();
  await expect(recorder).toHaveClass(/on/);

  const metro=page.locator('#metroStart');
  const jam=page.locator('#jamStart');
  await page.locator('.tab-btn[data-tab="metronome"]').click();
  await metro.click();
  await expect(metro).toHaveClass(/running/);
  await expect(recorder).toHaveClass(/on/);

  await page.locator('.tab-btn[data-tab="jam"]').click();
  await jam.click();
  await expect(jam).toHaveClass(/on/);
  await expect(metro).not.toHaveClass(/running|starting|media-paused/);
  await expect(recorder).toHaveClass(/on/);

  await page.locator('.tab-btn[data-tab="metronome"]').click();
  await metro.click();
  await expect(metro).toHaveClass(/running/);
  await expect(jam).not.toHaveClass(/on|media-paused/);
  await expect(recorder).toHaveClass(/on/);

  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await expect(recorder).toHaveClass(/on/);
  await recorder.click();
  await page.locator('.tab-btn[data-tab="metronome"]').click();
  await metro.click();
});

test('녹음 배속 처리기가 실제 브라우저 AudioWorklet에 등록된다',async({page})=>{
  await preparePage(page);
  const result=await page.evaluate(async()=>{
    const Context=window.AudioContext||window.webkitAudioContext;
    const ctx=new Context();
    try{
      await ctx.audioWorklet.addModule('./vendor/soundtouch/soundtouch-processor.js?v=173');
      const node=new AudioWorkletNode(ctx,'soundtouch-processor');
      return {
        pitch:Boolean(node.parameters.get('pitch')),
        playbackRate:Boolean(node.parameters.get('playbackRate')),
      };
    }finally{
      await ctx.close();
    }
  });
  expect(result).toEqual({pitch:true,playbackRate:true});
});

test('내 녹음 재생은 녹음 시작 시 정지되고 잠금화면에서도 녹음 상태를 유지한다',async({page})=>{
  await preparePage(page,{cloudClient:'recordings',microphone:'meter-signal'});
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();

  await expect(page.locator('#recordUpload')).toBeVisible();
  await page.locator('#recordUploadInput').setInputFiles({
    name:'연습 반주.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('olive backing track'),
  });
  await expect(page.locator('.record-row-copy strong')).toHaveText('연습 반주');
  expect(await page.evaluate(()=>window.__uploadedRecording)).toMatchObject({
    type:'audio/mpeg',options:{contentType:'audio/mpeg'},
  });
  await page.locator('.record-row-open').click();
  const backingPlay=page.locator('.record-player-play');
  await backingPlay.click();
  await expect(backingPlay).toHaveClass(/playing/);

  const recorder=page.locator('#recordToggle');
  await recorder.click();
  await expect(recorder).toHaveClass(/on/);
  await expect(backingPlay).not.toHaveClass(/playing/);
  expect(await page.evaluate(()=>window.__micHarness.recorderStream===window.__micHarness.processedStream)).toBeTruthy();
  expect(await page.evaluate(()=>window.__testAudioSession.type)).toBe('play-and-record');
  await backingPlay.click();
  await expect(backingPlay).not.toHaveClass(/playing/);
  await expect(page.locator('#recordMessage')).toHaveText('녹음을 정지한 뒤 내 녹음을 재생해 주세요');

  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(350);
  await expect(recorder).toHaveClass(/on/);
  await expect(backingPlay).not.toHaveClass(/playing/);
  expect(await page.evaluate(()=>window.__micHarness.mediaRecorder.state)).toBe('recording');

  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(recorder).toHaveClass(/on/);

  await page.locator('.tab-btn[data-tab="tuner"]').click();
  await expect(recorder).not.toHaveClass(/on/);
  await expect(backingPlay).not.toHaveClass(/playing/);
});

test('데스크톱에서는 오디오 파일을 내 녹음 카드에 놓아 업로드한다',async({page})=>{
  await preparePage(page,{cloudClient:'recordings',microphone:'controls'});
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();

  const accept=await page.locator('#recordUploadInput').getAttribute('accept');
  expect(accept).toContain('.mp3');
  expect(accept).not.toContain('audio/*');
  await page.evaluate(()=>{
    const file=new File([new Uint8Array([1,2,3,4])],'드롭 반주.mp3',{type:'audio/mpeg'});
    window.__recordingDropTransfer={
      types:['Files'],items:[{kind:'file'}],files:[file],dropEffect:'none',
    };
    const event=new Event('dragenter',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'dataTransfer',{value:window.__recordingDropTransfer});
    document.getElementById('recordListCard').dispatchEvent(event);
  });
  await expect(page.locator('#recordListCard')).toHaveClass(/record-drop-active/);
  await page.evaluate(()=>{
    const event=new Event('drop',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'dataTransfer',{value:window.__recordingDropTransfer});
    document.getElementById('recordListCard').dispatchEvent(event);
  });
  await expect(page.locator('#recordListCard')).not.toHaveClass(/record-drop-active/);
  await expect(page.locator('.record-row-copy strong')).toHaveText('드롭 반주');
  expect(await page.evaluate(()=>window.__uploadedRecording)).toMatchObject({
    type:'audio/mpeg',options:{contentType:'audio/mpeg'},
  });
});

test('MP3 메타데이터 판독이 실패하면 오디오 디코더로 길이를 다시 확인한다',async({page})=>{
  await preparePage(page,{cloudClient:'recordings',microphone:'controls'});
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await page.evaluate(()=>{
    Object.defineProperty(HTMLMediaElement.prototype,'duration',{
      configurable:true,get(){ return Number.NaN; },
    });
    Object.defineProperty(HTMLMediaElement.prototype,'readyState',{
      configurable:true,get(){ return 0; },
    });
    HTMLMediaElement.prototype.load=function(){
      Promise.resolve().then(()=>this.dispatchEvent(new Event('error')));
    };
  });
  await page.locator('#recordUploadInput').setInputFiles({
    name:'Paper Hearts.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('mp3 with metadata fallback'),
  });
  await expect(page.locator('.record-row-copy strong')).toHaveText('Paper Hearts');
  expect(await page.evaluate(()=>window.__uploadedRecording)).toMatchObject({
    type:'audio/mpeg',options:{contentType:'audio/mpeg'},
  });
});

test('Storage가 MP3 MIME을 거절하면 DB 업데이트 안내를 표시한다',async({page})=>{
  await preparePage(page,{
    cloudClient:'recordings',
    cloudUploadError:'mime type audio/mpeg is not supported',
  });
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await page.locator('#recordUploadInput').setInputFiles({
    name:'Paper Hearts.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('mp3 upload'),
  });
  await expect(page.locator('#recordMessage'))
    .toHaveText('MP3 업로드를 위한 저장소 업데이트가 필요합니다 · DB-011');
});

test('보통보다 약한 녹음 입력도 음량 막대에 충분히 보인다',async({page})=>{
  await preparePage(page,{cloudClient:'recordings',microphone:'meter-signal'});
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  const progressBar=await page.locator('#recordTimeTrack').boundingBox();
  const levelBar=await page.locator('.record-level').boundingBox();
  const timeLabels=await page.locator('.record-time-labels').boundingBox();
  expect(progressBar.width).toBeCloseTo(levelBar.width,0);
  expect(progressBar.height).toBeCloseTo(levelBar.height,0);
  expect(timeLabels.y+timeLabels.height).toBeLessThan(progressBar.y);
  const barColors=await page.evaluate(()=>({
    progress:getComputedStyle(document.getElementById('recordTimeFill')).backgroundColor,
    level:getComputedStyle(document.getElementById('recordLevelFill')).backgroundColor,
  }));
  expect(barColors.progress).toBe(barColors.level);
  await page.locator('#recordToggle').click();
  await expect(page.locator('#recordToggle')).toHaveClass(/on/);
  await expect(page.locator('#recordTimeProgress')).toHaveClass(/running/);
  await expect.poll(()=>page.locator('#recordTimeProgress').evaluate(element=>(
    Number(element.getAttribute('aria-valuenow'))
  ))).toBeGreaterThan(0);
  await expect.poll(()=>page.locator('#recordTimeOlive').evaluate(element=>(
    parseFloat(element.style.left)
  ))).toBeGreaterThan(0);
  await expect.poll(()=>page.locator('#recordTimeFill').evaluate(element=>{
    const transform=getComputedStyle(element).transform;
    return transform==='none'?0:new DOMMatrix(transform).a;
  })).toBeGreaterThan(0);
  await expect.poll(()=>page.locator('#recordTimeOlive').evaluate(element=>{
    const match=element.style.transform.match(/rotate\(([-\d.]+)deg\)/);
    return match?Math.abs(Number(match[1])):0;
  })).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.__micHarness.lastConstraints.audio)).toMatchObject({
    echoCancellation:false,noiseSuppression:false,autoGainControl:false,
  });
  expect(await page.evaluate(()=>(
    window.__micHarness.recorderStream===window.__micHarness.processedStream
  ))).toBeTruthy();
  await expect.poll(()=>page.locator('#recordLevelFill').evaluate(element=>{
    const transform=getComputedStyle(element).transform;
    return transform==='none'?0:new DOMMatrix(transform).a;
  })).toBeGreaterThan(.18);
  await page.locator('#recordToggle').click();
  await expect(page.locator('#recordTimeProgress')).not.toHaveClass(/running/);
});

test('녹음 캐시가 앱을 다시 열어도 모바일 기기에 남는다',async({page})=>{
  await preparePage(page);
  const beforeReload=await page.evaluate(async()=>{
    const payload=new TextEncoder().encode('olive-recording-cache');
    const blob=new Blob([payload],{type:'audio/webm'});
    const row={
      id:'cached-recording',byte_size:blob.size,mime_type:blob.type,
      object_path:'cache-user/cached-recording.webm',
    };
    await window.OliveRecordingCache.put('cache-user',row,blob);
    const cached=await window.OliveRecordingCache.get('cache-user',row,{touch:false});
    return cached && cached.size;
  });
  expect(beforeReload).toBeGreaterThan(0);

  await page.reload({waitUntil:'domcontentloaded'});
  const afterReload=await page.evaluate(async()=>{
    const size=new TextEncoder().encode('olive-recording-cache').byteLength;
    const row={
      id:'cached-recording',byte_size:size,mime_type:'audio/webm',
      object_path:'cache-user/cached-recording.webm',
    };
    const cached=await window.OliveRecordingCache.get('cache-user',row,{touch:false});
    await window.OliveRecordingCache.clearUser('cache-user');
    return cached && cached.size;
  });
  expect(afterReload).toBe(beforeReload);
});

test('화음 도수가 같은 줄 오른쪽에 놓이고 선택지 높이가 유지된다',async({page})=>{
  await preparePage(page);
  await page.locator('.tab-btn[data-tab="trainer"]').click();

  const intervalHeight=await page.locator('#earChoices .choice-row').first().evaluate(
    element=>element.getBoundingClientRect().height,
  );
  await page.locator('#earModes .pill',{hasText:'화음'}).click();
  const chordRows=page.locator('#earChoices .choice-row');
  await expect(chordRows).toHaveCount(2);
  const metrics=await chordRows.first().evaluate(element=>{
    const primary=element.querySelector('.choice-primary').getBoundingClientRect();
    const name=element.querySelector('.ko').getBoundingClientRect();
    const degrees=element.querySelector('.degrees').getBoundingClientRect();
    return {
      height:element.getBoundingClientRect().height,
      rightGap:Math.abs(primary.right-degrees.right),
      baselineGap:Math.abs(name.bottom-degrees.bottom),
    };
  });
  expect(metrics.rightGap).toBeLessThanOrEqual(1);
  expect(metrics.baselineGap).toBeLessThanOrEqual(3);
  expect(Math.abs(metrics.height-intervalHeight)).toBeLessThanOrEqual(1);
});

test('청음 오답 후 선택지를 같은 루트로 비교하고 올리브로 다음 문제를 시작한다',async({page})=>{
  await preparePage(page);
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.evaluate(()=>{
    Math.random=()=>0;
    window.__earTones=[];
    window.playTone=(...args)=>{ window.__earTones.push(args); return {}; };
  });
  await page.locator('#earModes .pill',{hasText:'음정'}).click();

  const choices=page.locator('#earChoices .choice-row');
  const wrong=choices.first();
  const correct=page.locator('#earChoices .choice-row',{hasText:'장2도'});
  await wrong.click();

  await expect(wrong).toHaveClass(/wrong/);
  await expect(correct).toHaveClass(/correct/);
  await expect(page.locator('#earFeedback')).toHaveText('오답');
  await expect(page.locator('#earPlayBtn')).toHaveAttribute('aria-label','다음 문제');
  for(let i=0;i<await choices.count();i++) await expect(choices.nth(i)).toBeEnabled();
  await expect(page.locator('#earTotal')).toHaveText('1');
  await expect.poll(()=>page.evaluate(()=>window.__earTones.length)).toBe(2);

  await correct.click();
  await expect.poll(()=>page.evaluate(()=>window.__earTones.length)).toBe(4);
  await expect(page.locator('#earTotal')).toHaveText('1');
  await page.locator('#earReplay').click();
  await expect.poll(()=>page.evaluate(()=>window.__earTones.length)).toBe(6);

  await page.locator('#earPlayBtn').click();
  await expect(page.locator('#earFeedback')).toBeEmpty();
  await expect(page.locator('#earPlayBtn')).toHaveAttribute('aria-label','문제 듣기');
  await expect(choices.first()).not.toHaveClass(/wrong|correct/);
  await expect.poll(()=>page.evaluate(()=>window.__earTones.length)).toBe(8);
});

test('메트로놈 재생 중 튜너로 가면 방해 음원이 즉시 정지한다',async({page})=>{
  await preparePage(page);
  const start=page.locator('#metroStart');
  await start.click();
  await expect(start).toHaveClass(/running/);
  await expect(page.locator('.tab-btn[data-tab="metronome"]')).toHaveClass(/sounding/);

  await page.locator('.tab-btn[data-tab="tuner"]').click();
  await expect(start).not.toHaveClass(/running|starting/);
  await expect(page.locator('.tab-btn[data-tab="metronome"]')).not.toHaveClass(/sounding/);
  await expect(page.locator('#tab-tuner')).toBeVisible();
});

test('잠금 화면에서 메트로놈을 일시정지하고 다시 재생한다',async({page})=>{
  await preparePage(page);
  const setVisibility=value=>page.evaluate(next=>{
    window.__testVisibility=next;
    if(!Object.prototype.hasOwnProperty.call(document,'visibilityState')){
      Object.defineProperty(document,'visibilityState',{
        configurable:true,
        get:()=>window.__testVisibility,
      });
    }
    document.dispatchEvent(new Event('visibilitychange'));
  },value);

  const metro=page.locator('#metroStart');
  await metro.click();
  await expect(metro).toHaveClass(/running/);
  await expect.poll(()=>page.evaluate(()=>window.__testAudioSession.type)).toBe('playback');
  await setVisibility('hidden');
  await page.waitForTimeout(350);
  await expect(metro).toHaveClass(/running/);
  await expect(page.locator('.tab-btn[data-tab="metronome"]')).toHaveClass(/sounding/);
  await expect.poll(()=>page.evaluate(()=>typeof window.__testMediaActions.pause)).toBe('undefined');
  await expect.poll(()=>page.evaluate(()=>typeof window.__testMediaActions.play)).toBe('function');
  await page.locator('audio[data-olive-background="true"]').evaluate(audio=>audio.pause());
  await expect(metro).toHaveClass(/media-paused/);
  await expect(metro).not.toHaveClass(/running/);
  await expect(page.locator('#orbLabel')).toHaveText('재생');
  await expect.poll(()=>page.evaluate(()=>window.__testMediaSession.playbackState)).toBe('paused');
  await page.evaluate(()=>window.__testMediaActions.play());
  await expect(metro).toHaveClass(/running/);
  await expect(metro).not.toHaveClass(/media-paused/);
  await expect(page.locator('#orbLabel')).toHaveText('정지');
  await expect.poll(()=>page.evaluate(()=>window.__testMediaSession.playbackState)).toBe('playing');
  await page.locator('audio[data-olive-background="true"]').evaluate(audio=>{
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('pause'));
  });
  await expect(metro).toHaveClass(/media-paused/);
  await page.evaluate(()=>stopBackgroundTransports());
  await expect(metro).not.toHaveClass(/running|starting|media-paused/);
  await expect(page.locator('.tab-btn[data-tab="metronome"]')).not.toHaveClass(/sounding/);
  await setVisibility('visible');
});

test('멈춰 둔 메트로놈 뒤 리듬 트레이너가 일반 출력으로 재생된다',async({page})=>{
  await preparePage(page,{microphone:'controls'});
  const metro=page.locator('#metroStart');
  await metro.click();
  await expect(metro).toHaveClass(/running/);
  await page.evaluate(()=>pauseBackgroundPlayback());
  await expect(metro).toHaveClass(/media-paused/);

  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'리듬'}).click();
  await page.locator('#rhyPlay').click();

  await expect(page.locator('#rhyPlay')).toHaveClass(/on/);
  await expect(metro).not.toHaveClass(/running|media-paused/);
  await expect(page.locator('audio[data-olive-background="true"]')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.__testAudioSession.type)).toBe('ambient');
  expect(await page.evaluate(()=>(
    Boolean(__appOutput && audioCtx && __appOutput.lastConnection===audioCtx.destination)
  ))).toBeTruthy();
  await page.locator('#rhyPlay').click();
});

test('멈춰 둔 내 녹음 뒤 청음 트레이너가 일반 출력으로 재생된다',async({page})=>{
  await preparePage(page,{
    cloudClient:'recordings',microphone:'playback',
    recordings:[{
      id:'recording-before-ear',title:'무제',
      object_path:'recording-browser-user/recording-before-ear.m4a',
      duration_ms:69000,byte_size:1000,mime_type:'audio/mp4',waveform:[30,55,75,40],
      playback_gain:3.25,
      recorded_at:'2026-09-06T09:00:00.000Z',created_at:'2026-09-06T09:00:00.000Z',
    }],
  });
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await page.locator('.record-row-open').click();
  await page.locator('.record-player-play').click();
  await page.evaluate(()=>window.__resolveRecordingDownload());
  await expect(page.locator('.record-player-play')).toHaveClass(/playing/);
  await page.evaluate(()=>window.__recordingTransportMedia.dispatchEvent(new Event('pause')));
  await expect(page.locator('.record-player-play')).not.toHaveClass(/playing/);

  const tonesBefore=await page.evaluate(()=>window.__micHarness.scheduledStarts.length);
  await page.locator('#trainerSeg .seg-btn',{hasText:'청음'}).click();
  await page.locator('#earPlayBtn').click();

  await expect.poll(()=>page.evaluate(()=>window.__micHarness.scheduledStarts.length))
    .toBeGreaterThanOrEqual(tonesBefore+2);
  await expect.poll(()=>page.evaluate(()=>window.__testAudioSession.type)).toBe('ambient');
  await expect.poll(()=>page.evaluate(()=>window.__testMediaSession.playbackState)).toBe('none');
  expect(await page.evaluate(()=>(
    Boolean(__appOutput && audioCtx && __appOutput.lastConnection===audioCtx.destination)
  ))).toBeTruthy();
});

test('잠금 화면의 원형 건너뛰기 버튼으로 BPM을 바꾼다',async({page})=>{
  const progression=[1,5,6,4].map(deg=>({deg,beats:1,sev:false,fam:null}));
  await preparePage(page,{preferences:{
    data:{jam:{
      root:0,mode:'major',preset:'custom',bpm:90,seventh:false,style:'rock',
      tracks:{drum:false,bass:false,chord:false,click:false},progression,
    }},
    updatedAt:'2026-09-07T00:00:00.000Z',
  }});

  const metro=page.locator('#metroStart');
  await metro.click();
  await expect(metro).toHaveClass(/running/);
  const backgroundAudio=page.locator('audio[data-olive-background="true"]');
  await expect.poll(()=>backgroundAudio.evaluate(audio=>Boolean(
    audio.srcObject && audio.srcObject.getAudioTracks().length
  ))).toBeTruthy();
  await expect.poll(()=>page.evaluate(()=>([
    typeof window.__testMediaActions.seekbackward,
    typeof window.__testMediaActions.seekforward,
    typeof window.__testMediaActions.previoustrack,
    typeof window.__testMediaActions.nexttrack,
  ]))).toEqual(['function','function','undefined','undefined']);
  await expect.poll(()=>page.evaluate(()=>window.__testMediaSession.metadata&&
    window.__testMediaSession.metadata.title)).toBe('메트로놈 · 90 BPM');

  await page.evaluate(()=>window.__testMediaActions.seekforward({seekOffset:10}));
  await expect(page.locator('#bpmNum')).toHaveText('100');
  await expect.poll(()=>page.evaluate(()=>window.__testMediaSession.metadata.title))
    .toBe('메트로놈 · 100 BPM');
  await page.evaluate(()=>window.__testMediaActions.seekbackward({seekOffset:5}));
  await expect(page.locator('#bpmNum')).toHaveText('95');
  await page.evaluate(()=>window.__testMediaActions.seekforward({}));
  await expect(page.locator('#bpmNum')).toHaveText('105');

  const registrationsBeforeResume=await page.evaluate(()=>(
    window.__testMediaActionRegistrations.seekforward
  ));
  await backgroundAudio.evaluate(audio=>{
    window.__testBackgroundAudioBeforeResume=audio;
    audio.pause();
  });
  await expect(metro).toHaveClass(/media-paused/);
  await expect.poll(()=>page.evaluate(()=>([
    typeof window.__testMediaActions.seekbackward,
    typeof window.__testMediaActions.seekforward,
  ]))).toEqual(['function','function']);
  await expect.poll(()=>page.evaluate(()=>([
    window.__testMediaActionClearances.seekbackward||0,
    window.__testMediaActionClearances.seekforward||0,
  ]))).toEqual([0,0]);
  // 실제 iPhone에서는 pause→play 뒤 원형 버튼의 명령이 휴면 플레이어에 남는다.
  // 같은 오디오 스트림을 새 미디어 요소에 연결해 플랫폼의 활성 세션을 갱신한다.
  await page.evaluate(()=>window.__testMediaActions.play());
  await expect(metro).toHaveClass(/running/);
  await expect.poll(()=>page.evaluate(()=>(
    __backgroundAudio===window.__testBackgroundAudioBeforeResume
  ))).toBe(true);
  await expect(backgroundAudio).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>(
    window.__testMediaActionRegistrations.seekforward
  ))).toBe(registrationsBeforeResume);
  await expect.poll(()=>page.evaluate(()=>typeof window.__testMediaActions.seekforward))
    .toBe('function');
  await page.evaluate(()=>window.__testMediaActions.seekforward({seekOffset:10}));
  await expect(page.locator('#bpmNum')).toHaveText('115');
  const resumedTempoTrace=await page.evaluate(()=>window.OliveAudioDiagnostics.read());
  expect(resumedTempoTrace.map(entry=>entry.event)).toEqual(expect.arrayContaining([
    'media-action:play','media-element:refreshed','transport:resume-ready',
    'media-action:seekforward','tempo:applied',
  ]));
  const firstRefreshIndex=resumedTempoTrace.findIndex(entry=>entry.event==='media-element:refreshed');
  const firstPlayingIndex=resumedTempoTrace.findIndex((entry,index)=>
    index>firstRefreshIndex && entry.event==='media-element:playing'
  );
  expect(firstPlayingIndex).toBeGreaterThan(firstRefreshIndex);
  expect(resumedTempoTrace.filter(entry=>entry.event==='tempo:applied').at(-1).after).toBe(115);

  // 빠르게 반복해도 DOM 플레이어는 하나를 유지하고 내부 리소스 세대만 갱신한다.
  for(const expectedBpm of [125,135,145,155,165,175,185,195]){
    const before=await backgroundAudio.evaluate(audio=>(
      Number(audio.dataset.oliveBackgroundGeneration)
    ));
    const registrations=await page.evaluate(()=>(
      window.__testMediaActionRegistrations.seekforward
    ));
    await backgroundAudio.evaluate(audio=>audio.pause());
    await expect(metro).toHaveClass(/media-paused/);
    await page.evaluate(()=>window.__testMediaActions.play());
    await expect(metro).toHaveClass(/running/);
    await expect(backgroundAudio).toHaveCount(1);
    await expect.poll(()=>page.evaluate(()=>(
      __backgroundAudio===window.__testBackgroundAudioBeforeResume
    ))).toBe(true);
    await expect.poll(()=>backgroundAudio.evaluate(audio=>(
      Number(audio.dataset.oliveBackgroundGeneration)
    ))).toBe(before+1);
    await expect.poll(()=>page.evaluate(()=>(
      window.__testMediaActionRegistrations.seekforward
    ))).toBe(registrations);
    await page.evaluate(()=>window.__testMediaActions.seekforward({seekOffset:10}));
    await expect(page.locator('#bpmNum')).toHaveText(String(expectedBpm));
  }

  // 앞선 resume의 play Promise가 끝나기 전에 pause→play가 다시 들어와도
  // 최신 사용자 명령이 즉시 새 복구를 시작하고, 과거 결과가 이를 덮지 않는다.
  await backgroundAudio.evaluate(audio=>audio.pause());
  await expect(metro).toHaveClass(/media-paused/);
  await page.evaluate(()=>{
    const audio=__backgroundAudio;
    const nativePlay=audio.play.bind(audio);
    let resolveOldPlay;
    audio.play=()=>new Promise(resolve=>{ resolveOldPlay=resolve; });
    window.__testMediaActions.play();
    audio.dispatchEvent(new Event('pause'));
    audio.play=nativePlay;
    window.__testMediaActions.play();
    resolveOldPlay();
  });
  await expect(metro).toHaveClass(/running/);
  await expect(backgroundAudio).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>typeof window.__testMediaActions.seekforward))
    .toBe('function');
  await page.evaluate(()=>window.__testMediaActions.seekforward({seekOffset:10}));
  await expect(page.locator('#bpmNum')).toHaveText('205');
  const rapidResumeTrace=await page.evaluate(()=>window.OliveAudioDiagnostics.read());
  expect(rapidResumeTrace.map(entry=>entry.event)).toEqual(expect.arrayContaining([
    'transport:resume-cancelled','transport:resume-superseded','transport:resume-ready',
  ]));

  await page.locator('.tab-btn[data-tab="jam"]').click();
  const jam=page.locator('#jamStart');
  await jam.click();
  await expect(jam).toHaveClass(/on/);
  await expect(metro).not.toHaveClass(/running|starting/);
  await page.evaluate(()=>window.__testMediaActions.seekforward({seekOffset:15}));
  await expect(page.locator('#jamBpmVal')).toHaveText('105');
  await expect.poll(()=>page.evaluate(()=>window.__testMediaSession.metadata.title))
    .toBe('잼 세션 · 105 BPM');
  await jam.click();
});

test('메트로놈과 잼 세션은 터치 직후 첫 소리를 예약한다',async({page})=>{
  const progression=[1,5,6,4].map(deg=>({deg,beats:1,sev:false,fam:null}));
  await preparePage(page,{
    microphone:'controls',
    preferences:{
      data:{jam:{
        root:0,mode:'major',preset:'custom',bpm:90,seventh:false,style:'rock',
        tracks:{drum:false,bass:false,chord:false,click:true},progression,
      }},
      updatedAt:'2026-09-07T00:00:00.000Z',
    },
  });

  const metro=page.locator('#metroStart');
  await metro.click();
  await expect.poll(()=>page.evaluate(()=>Math.min(...window.__micHarness.scheduledStarts)))
    .toBeLessThanOrEqual(0.01);
  await metro.click();

  await page.locator('.tab-btn[data-tab="jam"]').click();
  await page.evaluate(()=>{ window.__micHarness.scheduledStarts=[]; });
  const jam=page.locator('#jamStart');
  await jam.click();
  await expect.poll(()=>page.evaluate(()=>Math.min(...window.__micHarness.scheduledStarts)))
    .toBeLessThanOrEqual(0.01);
  await jam.click();
});

test('화면이 잠긴 상태에서도 잼 재생 상태를 유지한다',async({page})=>{
  const fastProgression=[1,5,6,4].map(deg=>({deg,beats:1,sev:false,fam:null}));
  await preparePage(page,{preferences:{
    data:{jam:{
      root:0,mode:'major',preset:'custom',bpm:220,seventh:false,style:'rock',
      tracks:{drum:false,bass:false,chord:false,click:false},progression:fastProgression,
    }},
    updatedAt:'2026-09-07T00:00:00.000Z',
  }});
  const setVisibility=value=>page.evaluate(next=>{
    window.__testVisibility=next;
    if(!Object.prototype.hasOwnProperty.call(document,'visibilityState')){
      Object.defineProperty(document,'visibilityState',{
        configurable:true,
        get:()=>window.__testVisibility,
      });
    }
    document.dispatchEvent(new Event('visibilitychange'));
  },value);
  await page.locator('.tab-btn[data-tab="jam"]').click();
  const jam=page.locator('#jamStart');
  await jam.click();
  await expect(jam).toHaveClass(/on/);
  await expect.poll(()=>page.evaluate(()=>window.__testAudioSession.type)).toBe('playback');
  await expect.poll(()=>page.locator('#progTimeline').evaluate(view=>{
    const active=view.querySelector('.prog-bar.now');
    return active?Array.from(active.parentElement.children).indexOf(active):-1;
  })).toBeGreaterThanOrEqual(0);
  await setVisibility('hidden');
  await page.waitForTimeout(350);
  await expect(jam).toHaveClass(/on/);
  await expect(page.locator('.tab-btn[data-tab="jam"]')).toHaveClass(/sounding/);
  const backgroundAudio=page.locator('audio[data-olive-background="true"]');
  await expect.poll(()=>backgroundAudio.evaluate(audio=>Boolean(
    audio.srcObject && audio.srcObject.getAudioTracks().length
  ))).toBeTruthy();
  await expect.poll(()=>page.evaluate(()=>(
    typeof window.__testMediaActions.play==='function' &&
    typeof window.__testMediaActions.pause==='undefined'
  ))).toBeTruthy();
  await backgroundAudio.evaluate(audio=>audio.pause());
  await expect(jam).toHaveClass(/media-paused/);
  await expect(jam).not.toHaveClass(/on/);
  await setVisibility('visible');
  const pausedState=await page.locator('#progTimeline').evaluate(view=>{
    const active=view.querySelector('.prog-bar.now');
    return {
      bar:Array.from(active.parentElement.children).indexOf(active),
      scrollLeft:view.scrollLeft,
    };
  });
  await page.waitForTimeout(700);
  const stillPaused=await page.locator('#progTimeline').evaluate(view=>{
    const active=view.querySelector('.prog-bar.now');
    return {
      bar:Array.from(active.parentElement.children).indexOf(active),
      scrollLeft:view.scrollLeft,
    };
  });
  expect(stillPaused.bar).toBe(pausedState.bar);
  expect(Math.abs(stillPaused.scrollLeft-pausedState.scrollLeft)).toBeLessThan(1);
  // 오래 잠근 iPhone처럼 Web Audio만 절전 상태가 된 뒤 잠금화면 재생을 누른다.
  await page.evaluate(async()=>{
    if(audioCtx && audioCtx.state==='running') await audioCtx.suspend();
  });
  await expect.poll(()=>page.evaluate(()=>audioCtx&&audioCtx.state)).toBe('suspended');
  await page.evaluate(()=>window.__testMediaActions.play());
  await expect(jam).toHaveClass(/on/);
  await expect(jam).not.toHaveClass(/media-paused/);
  await expect.poll(()=>page.locator('#progTimeline').evaluate(view=>{
    const active=view.querySelector('.prog-bar.now');
    return active?Array.from(active.parentElement.children).indexOf(active):-1;
  })).toBe(0);
  await jam.click();
  await expect(jam).not.toHaveClass(/on/);
});

test('잠금 해제 후에도 일시정지한 메트로놈 애니메이션이 멈춘다',async({page})=>{
  await preparePage(page);
  const setVisibility=value=>page.evaluate(next=>{
    window.__testVisibility=next;
    if(!Object.prototype.hasOwnProperty.call(document,'visibilityState')){
      Object.defineProperty(document,'visibilityState',{
        configurable:true,
        get:()=>window.__testVisibility,
      });
    }
    document.dispatchEvent(new Event('visibilitychange'));
  },value);
  const metro=page.locator('#metroStart');
  await metro.click();
  await expect(metro).toHaveClass(/running/);
  await setVisibility('hidden');
  const backgroundAudio=page.locator('audio[data-olive-background="true"]');
  await expect.poll(()=>backgroundAudio.evaluate(audio=>Boolean(
    audio.srcObject && audio.srcObject.getAudioTracks().length
  ))).toBeTruthy();
  await page.waitForTimeout(250);
  await backgroundAudio.evaluate(audio=>audio.pause());
  await expect(metro).toHaveClass(/media-paused/);
  await setVisibility('visible');
  const pausedTransform=await page.locator('#mdOlive').getAttribute('transform');
  await page.waitForTimeout(450);
  await expect(page.locator('#mdOlive')).toHaveAttribute('transform',pausedTransform);
  await backgroundAudio.evaluate(audio=>audio.play());
  await expect(metro).toHaveClass(/running/);
  await expect.poll(()=>page.locator('.beat-dot').first().evaluate(dot=>
    dot.classList.contains('accent-on')
  )).toBeTruthy();
  await metro.click();
});

test('튜너가 마이크를 연결하고 정지할 때 트랙을 확실히 놓는다',async({page})=>{
  await preparePage(page,{microphone:'success'});
  await page.locator('.tab-btn[data-tab="tuner"]').click();
  const mic=page.locator('#tunerStart');
  await mic.click();
  await expect(mic).toHaveClass(/on/);
  await expect(mic).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#tunerFreq')).toHaveText('연주해보세요');
  await mic.click();
  await expect(mic).not.toHaveClass(/on|starting/);
  await expect(page.locator('#tunerFreq')).toHaveText('마이크 꺼짐');
  expect(await page.evaluate(()=>window.__micHarness)).toMatchObject({requests:1,stops:1});
});

test('iOS형 무음 오디오 그래프를 출력 없이 한 번 자동 복구한다',async({page})=>{
  await preparePage(page,{microphone:'success'});
  await page.locator('.tab-btn[data-tab="tuner"]').click();
  const mic=page.locator('#tunerStart');
  await mic.click();
  await expect(mic).toHaveClass(/on/);
  await expect.poll(()=>page.evaluate(()=>window.__micHarness.contexts),{timeout:5000})
    .toBeGreaterThanOrEqual(3);
  const state=await page.evaluate(()=>window.__micHarness);
  expect(state.requests).toBe(1);
  expect(state.zeroGainConnections).toBeGreaterThanOrEqual(2);
  await expect(mic).toHaveClass(/on/);
  await mic.click();
});

test('파형 Canvas 오류가 나도 튜너 음정 분석은 계속된다',async({page})=>{
  await preparePage(page,{microphone:'scope-error'});
  await page.locator('.tab-btn[data-tab="tuner"]').click();
  await page.locator('#tunerSens').fill('80');
  await page.locator('#tunerStart').click();
  await expect(page.locator('#tunerNote')).toHaveText('E2',{timeout:5000});
  await expect(page.locator('#tunerLevel')).toHaveClass(/ready/);
  await page.locator('#tunerStart').click();
});

test('지속적인 팬 음높이는 배경으로 놓고 새 플럭을 기다린다',async({page})=>{
  await preparePage(page,{microphone:'fan-tone'});
  await page.locator('.tab-btn[data-tab="tuner"]').click();
  const mic=page.locator('#tunerStart');
  const note=page.locator('#tunerNote');
  await mic.click();
  await expect(note).not.toHaveText('--',{timeout:2000});
  await expect(note).toHaveText('--',{timeout:4000});
  await expect(page.locator('#tunerFreq')).toHaveText('연주해보세요');
  await expect(mic).toHaveClass(/on/);
  await mic.click();
});

test('튜너 약한 입력 모드가 기존 음량 문턱 아래의 일렉기타 신호를 잡는다',async({page})=>{
  await preparePage(page,{microphone:'weak-signal'});
  await page.locator('.tab-btn[data-tab="tuner"]').click();
  const sensitivity=page.locator('#tunerSens');
  await sensitivity.fill('80');
  await expect(sensitivity).toHaveAttribute('aria-valuetext','80 약한 입력');
  await expect(page.locator('#tunerSensVal')).toHaveCount(0);
  await expect(page.locator('#tunerSensHint')).toHaveCount(0);

  const mic=page.locator('#tunerStart');
  await mic.click();
  await expect(page.locator('#tunerNote')).toHaveText('E2',{timeout:5000});
  await expect(page.locator('#tunerLevel')).toHaveClass(/ready/);
  await expect(page.locator('#tunerScopeState')).toHaveText('인식 중');
  await expect(page.locator('#tunerInputDb')).not.toHaveText('—');
  await expect(page.locator('#tunerNoiseDb')).not.toHaveText('—');
  await expect(page.locator('#tunerMarginDb')).not.toHaveText('—');
  const scopeSize=await page.locator('#tunerScope').evaluate(canvas=>({
    width:canvas.width,
    height:canvas.height,
  }));
  expect(scopeSize.width).toBeGreaterThan(0);
  expect(scopeSize.height).toBeGreaterThan(0);
  await mic.click();
  await expect(page.locator('#tunerScopeState')).toHaveText('마이크 꺼짐');
});

test('리듬 트레이너 슬라이더를 두 번 누르면 기본값으로 돌아간다',async({page})=>{
  await preparePage(page);
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn[data-mode="rhythm"]').click();

  for(const [sliderId,valueId] of [['rhySynco','rhySyncoVal'],['rhyDiff','rhyDiffVal']]){
    const slider=page.locator('#'+sliderId);
    await slider.fill('8');
    await expect(page.locator('#'+valueId)).toHaveText('8');
    await slider.evaluate(element=>{
      element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    });
    await expect(slider).toHaveValue('5');
    await expect(slider).toHaveAttribute('aria-valuetext','5');
    await expect(page.locator('#'+valueId)).toHaveText('5');
  }
});

test('튜너 연결 중 취소하면 늦게 열린 마이크도 즉시 닫는다',async({page})=>{
  await preparePage(page,{microphone:'deferred'});
  await page.locator('.tab-btn[data-tab="tuner"]').click();
  const mic=page.locator('#tunerStart');
  await mic.click();
  await expect.poll(()=>page.evaluate(()=>window.__micHarness.pending)).toBe(true);
  await mic.click();
  await page.evaluate(()=>window.__resolveMic());
  await expect.poll(()=>page.evaluate(()=>window.__micHarness.stops)).toBe(1);
  await expect(mic).not.toHaveClass(/on|starting/);
  await expect(mic).toHaveAttribute('aria-busy','false');
});

test('튜너 마이크 권한 거부 이유를 사용자가 알 수 있게 표시한다',async({page})=>{
  await preparePage(page,{microphone:'denied'});
  await page.locator('.tab-btn[data-tab="tuner"]').click();
  const mic=page.locator('#tunerStart');
  await mic.click();
  await expect(page.locator('#tunerFreq')).toHaveText('마이크 권한 거부됨');
  await expect(mic).not.toHaveClass(/on|starting/);
  await expect(mic).toHaveAttribute('aria-busy','false');
});

test('튜너 마이크 연결이 끊기면 재생 상태와 트랙을 정리한다',async({page})=>{
  await preparePage(page,{microphone:'success'});
  await page.locator('.tab-btn[data-tab="tuner"]').click();
  const mic=page.locator('#tunerStart');
  await mic.click();
  await expect(mic).toHaveClass(/on/);
  await page.evaluate(()=>window.__endMic());
  await expect(page.locator('#tunerFreq')).toHaveText('마이크 연결 끊김');
  await expect(mic).not.toHaveClass(/on|starting/);
  expect(await page.evaluate(()=>window.__micHarness.stops)).toBe(1);
});

test('긴 잼 진행의 활성 코드를 가운데로 따라간다',async({page})=>{
  const canon=[1,5,6,3,4,1,4,5].map(deg=>({deg,beats:1,sev:false,fam:null}));
  await preparePage(page,{preferences:{
    data:{jam:{
      root:0,mode:'major',preset:'canon',bpm:120,seventh:false,style:'rock',
      tracks:{drum:false,bass:false,chord:false,click:false},progression:canon,
    }},
    updatedAt:'2026-08-10T00:00:00.000Z',
  }});
  await page.locator('.tab-btn[data-tab="jam"]').click();
  await expect(page.locator('#progTimeline .prog-bar')).toHaveCount(8);
  await page.locator('#jamStart').click();
  await expect(page.locator('#jamStart')).toHaveClass(/on/);
  await expect.poll(()=>page.locator('#progTimeline').evaluate(view=>{
    const active=view.querySelector('.prog-bar.now');
    if(!active) return Number.POSITIVE_INFINITY;
    const index=Array.from(active.parentElement.children).indexOf(active);
    if(index<2) return Number.POSITIVE_INFINITY;
    const vr=view.getBoundingClientRect();
    const ar=active.getBoundingClientRect();
    return Math.abs((vr.left+vr.width/2)-(ar.left+ar.width/2));
  })).toBeLessThan(12);
  await page.locator('#jamStart').click();
});

test('클라우드 스키마가 오래되면 저장 대신 구체적인 업데이트 코드를 보여준다',async({page})=>{
  await preparePage(page,{cloudClient:true});
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await expect(page.locator('#earCloudTitle')).toHaveText('클라우드 업데이트 필요');
  await expect(page.locator('#earCloudStatus')).toContainText('DB-011');
  await page.locator('#earCloudAction').evaluate(element=>element.click());
  await page.locator('#cloudSyncNow').click();
  await expect(page.locator('#cloudAuthMessage')).toContainText('오류 코드 DB-011');
});

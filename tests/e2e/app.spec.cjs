const {test,expect}=require('playwright/test');

const pageErrors=new WeakMap();

async function preparePage(page,{cloudClient=false,preferences=null,microphone='native',recordings=[]}={}){
  const errors=[];
  pageErrors.set(page,errors);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:'',
  }));
  await page.addInitScript(({withCloud,storedPreferences,micMode,recordingRows})=>{
    sessionStorage.setItem('olive-startup-state-v2','shown');
    const audioSession={type:'auto'};
    try{ Object.defineProperty(navigator,'audioSession',{configurable:true,value:audioSession}); }
    catch(error){}
    window.__testAudioSession=audioSession;
    if(storedPreferences){
      localStorage.setItem('olive-preferences-v1',JSON.stringify(storedPreferences));
    }
    if(withCloud==='recordings'){
      const user={
        id:'recording-browser-user',email:'recording@example.com',
        app_metadata:{provider:'google'},user_metadata:{full_name:'Recording Test'},
      };
      const client={
        auth:{
          onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
          async getSession(){ return {data:{session:{user}},error:null}; },
        },
        async rpc(name){ return {data:name==='olive_schema_version'?9:true,error:null}; },
        from(table){
          if(table==='practice_recordings') return {
            select(){ return {eq(){ return {order(){ return {async limit(){ return {data:recordingRows,error:null}; }}; }}; }}; },
          };
          if(table==='user_preferences') return {
            select(){ return {eq(){ return {async maybeSingle(){ return {data:null,error:null}; }}; }}; },
            async upsert(){ return {data:null,error:null}; },
          };
          return {select(){ return {async order(){ return {data:[],error:null}; }}; }};
        },
        storage:{from(){ return {
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
      const harness={requests:0,stops:0,pending:false,contexts:0,zeroGainConnections:0,gainNodes:[]};
      class FakeNode{
        connect(next){
          if(this.gain && this.gain.value===0) harness.zeroGainConnections++;
          return next||this;
        }
        disconnect(){}
      }
      class FakeAudioContext{
        constructor(){
          harness.contexts++;
          this.state='suspended';
          this.currentTime=0;
          this.sampleRate=48000;
          this.destination=new FakeNode();
          this.listeners=new Map();
        }
        addEventListener(type,listener){ this.listeners.set(type,listener); }
        async resume(){ this.state='running'; }
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
          node.frequency={value:0};
          node.start=()=>{};
          node.stop=()=>{};
          return node;
        }
        createBufferSource(){
          const node=new FakeNode();
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
      if(micMode==='meter-signal'){
        class FakeMediaRecorder extends EventTarget{
          static isTypeSupported(){ return true; }
          constructor(input){ super(); this.mimeType='audio/mp4'; harness.recorderStream=input; }
          start(){}
          stop(){ this.dispatchEvent(new Event('stop')); }
        }
        window.MediaRecorder=FakeMediaRecorder;
      }
      window.__micHarness=harness;
      Object.defineProperty(navigator,'mediaDevices',{
        configurable:true,
        value:{getUserMedia},
      });
    }
  },{withCloud:cloudClient,storedPreferences:preferences,micMode:microphone,recordingRows:recordings});
  const response=await page.goto('/',{waitUntil:'domcontentloaded'});
  expect(response && response.ok()).toBeTruthy();
  await expect(page.locator('#appVersion')).toHaveText('버전 1.3.13');
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
  expect(workerUrl).toContain('service-worker.js?v=143');
});

test('녹음 탭이 기존 올리브 버튼 비율과 계정 연결 흐름을 유지한다',async({page})=>{
  await preparePage(page);
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await expect(page.locator('#trainerSeg .seg-btn')).toHaveCount(3);
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await expect(page.locator('#pane-record')).toBeVisible();
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

test('녹음 줄을 열면 올리브 재생 버튼과 탐색 가능한 파형이 나타난다',async({page})=>{
  const waveform=Array.from({length:80},(_,index)=>18+(index*17)%82);
  await preparePage(page,{
    cloudClient:'recordings',
    microphone:'playback',
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
  await expect(page.locator('.record-row-copy small')).toHaveText(/2026\. 09\. 06\. \d{2}:\d{2}/);

  const box=await page.locator('.record-waveform').boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box.x+box.width*.75,box.y+box.height/2);
  expect(await page.evaluate(()=>window.__mediaPlayCalls||0)).toBeGreaterThan(0);
  await page.evaluate(()=>window.__resolveRecordingDownload());
  await expect(page.locator('.record-player-play')).toHaveClass(/playing/);
  await expect.poll(()=>page.evaluate(()=>(
    window.__micHarness.gainNodes.some(node=>node.gain.value===3.25)
  ))).toBeTruthy();
  expect(await page.evaluate(()=>window.__micHarness.mediaElementGain)).toBeTruthy();
  await expect(page.locator('.record-waveform')).toHaveAttribute('aria-valuenow',/5[01-3]/);
  await expect(page.locator('.record-player-elapsed')).toHaveText('00:51');
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

test('보통보다 약한 녹음 입력도 음량 막대에 충분히 보인다',async({page})=>{
  await preparePage(page,{cloudClient:'recordings',microphone:'meter-signal'});
  await page.locator('.tab-btn[data-tab="trainer"]').click();
  await page.locator('#trainerSeg .seg-btn',{hasText:'녹음'}).click();
  await page.locator('#recordToggle').click();
  await expect(page.locator('#recordToggle')).toHaveClass(/on/);
  expect(await page.evaluate(()=>window.__micHarness.lastConstraints.audio)).toMatchObject({
    echoCancellation:false,noiseSuppression:false,autoGainControl:false,
  });
  expect(await page.evaluate(()=>(
    window.__micHarness.recorderStream===window.__micHarness.inputStream
  ))).toBeTruthy();
  await expect.poll(()=>page.locator('#recordLevelFill').evaluate(element=>{
    const transform=getComputedStyle(element).transform;
    return transform==='none'?0:new DOMMatrix(transform).a;
  })).toBeGreaterThan(.18);
  await page.locator('#recordToggle').click();
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

test('화면이 잠긴 상태에서도 메트로놈과 잼 재생 상태를 유지한다',async({page})=>{
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
  await setVisibility('visible');
  await metro.click();
  await expect(metro).not.toHaveClass(/running/);

  await page.locator('.tab-btn[data-tab="jam"]').click();
  const jam=page.locator('#jamStart');
  await jam.click();
  await expect(jam).toHaveClass(/on/);
  await expect.poll(()=>page.evaluate(()=>window.__testAudioSession.type)).toBe('playback');
  await setVisibility('hidden');
  await page.waitForTimeout(350);
  await expect(jam).toHaveClass(/on/);
  await expect(page.locator('.tab-btn[data-tab="jam"]')).toHaveClass(/sounding/);
  await setVisibility('visible');
  await jam.click();
  await expect(jam).not.toHaveClass(/on/);
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
  await expect(page.locator('#earCloudStatus')).toContainText('DB-009');
  await page.locator('#earCloudAction').evaluate(element=>element.click());
  await page.locator('#cloudSyncNow').click();
  await expect(page.locator('#cloudAuthMessage')).toContainText('오류 코드 DB-009');
});

const {test,expect}=require('playwright/test');

const pageErrors=new WeakMap();

async function preparePage(page,{cloudClient=false,preferences=null,microphone='native'}={}){
  const errors=[];
  pageErrors.set(page,errors);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:'',
  }));
  await page.addInitScript(({withCloud,storedPreferences,micMode})=>{
    sessionStorage.setItem('olive-startup-state-v2','shown');
    if(storedPreferences){
      localStorage.setItem('olive-preferences-v1',JSON.stringify(storedPreferences));
    }
    if(withCloud){
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
      let analyserSampleCursor=0;
      const harness={requests:0,stops:0,pending:false,contexts:0,zeroGainConnections:0};
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
            if(micMode!=='weak-signal' && micMode!=='scope-error' && micMode!=='fan-tone'){
              array.fill(0);
              return;
            }
            for(let i=0;i<array.length;i++){
              const frequency=micMode==='fan-tone' ? 93 : 82.4069;
              const phase=2*Math.PI*frequency*(analyserSampleCursor+i)/48000;
              array[i]=micMode==='fan-tone'
                ? Math.sin(phase)*0.001+Math.sin(phase*2)*0.00035
                : Math.sin(phase)*0.0003;
            }
            analyserSampleCursor+=array.length;
          };
          return node;
        }
        createGain(){
          const node=new FakeNode();
          node.gain={value:1};
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
      const getUserMedia=async()=>{
        harness.requests++;
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
        return makeStream();
      };
      window.AudioContext=FakeAudioContext;
      window.webkitAudioContext=FakeAudioContext;
      window.__micHarness=harness;
      Object.defineProperty(navigator,'mediaDevices',{
        configurable:true,
        value:{getUserMedia},
      });
    }
  },{withCloud:cloudClient,storedPreferences:preferences,micMode:microphone});
  const response=await page.goto('/',{waitUntil:'domcontentloaded'});
  expect(response && response.ok()).toBeTruthy();
  await expect(page.locator('#appVersion')).toHaveText('버전 1.2.6');
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
  expect(workerUrl).toContain('service-worker.js?v=126');
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
  await expect(page.locator('#tunerNote')).toHaveText('E',{timeout:5000});
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
  await expect(page.locator('#tunerNote')).toHaveText('E',{timeout:5000});
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
  await expect(page.locator('#earCloudStatus')).toContainText('DB-005');
  await page.locator('#earCloudAction').click();
  await page.locator('#cloudSyncNow').click();
  await expect(page.locator('#cloudAuthMessage')).toContainText('오류 코드 DB-005');
});

const {test,expect}=require('playwright/test');

const pageErrors=new WeakMap();

async function preparePage(page,{cloudClient=false,preferences=null}={}){
  const errors=[];
  pageErrors.set(page,errors);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:'',
  }));
  await page.addInitScript(({withCloud,storedPreferences})=>{
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
  },{withCloud:cloudClient,storedPreferences:preferences});
  const response=await page.goto('/',{waitUntil:'domcontentloaded'});
  expect(response && response.ok()).toBeTruthy();
  await expect(page.locator('#appVersion')).toHaveText('버전 1.1.0');
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
  expect(workerUrl).toContain('service-worker.js?v=110');
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

test('긴 잼 진행의 활성 코드를 가운데로 따라간다',async({page})=>{
  const canon=[1,5,6,3,4,1,4,5].map(deg=>({deg,beats:1,sev:false,fam:null}));
  await preparePage(page,{preferences:{
    data:{jam:{
      root:0,mode:'major',preset:'canon',bpm:260,seventh:false,style:'rock',
      tracks:{drum:false,bass:false,chord:false,click:false},progression:canon,
    }},
    updatedAt:'2026-08-10T00:00:00.000Z',
  }});
  await page.locator('.tab-btn[data-tab="jam"]').click();
  await expect(page.locator('#progTimeline .prog-bar')).toHaveCount(8);
  await page.locator('#jamStart').click();
  await expect(page.locator('#jamStart')).toHaveClass(/on/);
  await expect.poll(()=>page.locator('#progTimeline .prog-bar.now').evaluateAll(bars=>{
    if(!bars.length) return -1;
    return Array.from(bars[0].parentElement.children).indexOf(bars[0]);
  })).toBeGreaterThanOrEqual(2);
  const centered=await page.locator('#progTimeline').evaluate(view=>{
    const active=view.querySelector('.prog-bar.now');
    const vr=view.getBoundingClientRect();
    const ar=active.getBoundingClientRect();
    return Math.abs((vr.left+vr.width/2)-(ar.left+ar.width/2));
  });
  expect(centered).toBeLessThan(12);
  await page.locator('#jamStart').click();
});

test('클라우드 스키마가 오래되면 저장 대신 구체적인 업데이트 코드를 보여준다',async({page})=>{
  await preparePage(page,{cloudClient:true});
  await expect(page.locator('#earCloudTitle')).toHaveText('클라우드 업데이트 필요');
  await expect(page.locator('#earCloudStatus')).toContainText('DB-005');
  await page.locator('#earCloudAction').click();
  await page.locator('#cloudSyncNow').click();
  await expect(page.locator('#cloudAuthMessage')).toContainText('오류 코드 DB-005');
});

const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

class FakeClassList{
  constructor(){ this.values=new Set(); }
  add(...names){ names.forEach(name=>this.values.add(name)); }
  remove(...names){ names.forEach(name=>this.values.delete(name)); }
  contains(name){ return this.values.has(name); }
  toggle(name,force){
    if(force===undefined) force=!this.values.has(name);
    force ? this.values.add(name) : this.values.delete(name);
    return force;
  }
}
class FakeElement{
  constructor(){
    this.textContent='';
    this.disabled=false;
    this.hidden=false;
    this.dataset={};
    this.classList=new FakeClassList();
    this.listeners={};
    this.attributes=new Map();
  }
  addEventListener(name,handler){ this.listeners[name]=handler; }
  setAttribute(name,value){ this.attributes.set(name,String(value)); }
  getAttribute(name){ return this.attributes.has(name)?this.attributes.get(name):null; }
  removeAttribute(name){ this.attributes.delete(name); }
  focus(){}
}
class FakeStorage{
  constructor(seed={}){ this.values=new Map(Object.entries(seed)); }
  getItem(key){ return this.values.has(key)?this.values.get(key):null; }
  setItem(key,value){ this.values.set(key,String(value)); }
  removeItem(key){ this.values.delete(key); }
}

const elementIds=[
  'earCloudTitle','earCloudStatus','earCloudDot','earCloudAction',
  'earCloudActionLabel','earCloudAvatar','earCloudAvatarFallback',
  'cloudAuthSheet','cloudAuthClose','cloudLoggedOut','cloudLoggedIn',
  'cloudGoogleLogin','cloudLogout','cloudSyncNow','cloudDeleteData','cloudDeleteAccount',
  'cloudProviderName','cloudIdentity','cloudSheetSync','cloudSetupHint',
  'cloudAuthMessage',
];

function makeContext({config,storage,supabase}){
  const elements=Object.fromEntries(elementIds.map(id=>[id,new FakeElement()]));
  elements.cloudAuthSheet.hidden=true;
  const documentListeners={};
  const windowListeners={};
  const context={
    console,
    crypto:webcrypto,
    URL,
    setTimeout,
    clearTimeout,
    requestAnimationFrame:callback=>callback(),
    navigator:{onLine:true},
    location:{
      origin:'http://127.0.0.1:8765',
      pathname:'/index.html',
      search:'',
      hash:'',
      href:'http://127.0.0.1:8765/index.html',
      reload(){},
    },
    confirm:()=>true,
    history:{replaceState(){}},
    localStorage:storage,
    document:{
      body:{classList:new FakeClassList()},
      visibilityState:'visible',
      getElementById:id=>elements[id]||null,
      addEventListener:(name,handler)=>{ documentListeners[name]=handler; },
    },
    addEventListener:(name,handler)=>{ windowListeners[name]=handler; },
    OLIVE_CLOUD_CONFIG:config,
    supabase,
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('cloud-sync.js','utf8'),context,{filename:'cloud-sync.js'});
  return {context,elements,documentListeners,windowListeners};
}

async function testUnconfigured(){
  const storage=new FakeStorage();
  const {context,elements}=makeContext({
    config:{supabaseUrl:'',supabasePublishableKey:'',redirectUrl:''},
    storage,
    supabase:undefined,
  });
  await context.OliveCloud.init({
    getAnonymousHistory:()=>({}),
    clearAnonymousHistory(){},
    useUserHistory(){},
    useAnonymousHistory(){},
  });
  assert.equal(elements.earCloudTitle.textContent,'클라우드 저장 설정 필요');
  assert.equal(elements.earCloudStatus.textContent,'현재 이 기기에만 기록 중');
  assert.equal(elements.cloudGoogleLogin.disabled,true);
  context.OliveCloud.openAccount();
  assert.equal(elements.cloudAuthSheet.hidden,false);
}

async function testConfiguredQueueAndMigration(){
  const storage=new FakeStorage({
    'olive-ear-history-v1':JSON.stringify({'2026-07-24':{correct:1,total:2}}),
  });
  const rpcCalls=[];
  const preferenceUpserts=[];
  const functionCalls=[];
  let recordCount=0;
  const client={
    auth:{
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){
        return {data:{session:{user:{
          id:'user-1',
          email:'music@example.com',
          app_metadata:{provider:'google'},
          user_metadata:{
            full_name:'O’live',
            avatar_url:'https://example.com/olive-avatar.png',
          },
        }}},error:null};
      },
      async signOut(){ return {error:null}; },
      async signInWithOAuth(){ return {error:null}; },
    },
    functions:{async invoke(name,args){
      functionCalls.push({name,args});
      return {data:{deleted:true},error:null};
    }},
    async rpc(name,args){
      rpcCalls.push({name,args});
      if(name==='record_ear_answer'){
        recordCount++;
        if(recordCount===1) await new Promise(resolve=>setTimeout(resolve,20));
      }
      return {data:true,error:null};
    },
    from(table){
      if(table==='user_preferences'){
        return {
          select(){
            return {
              eq(){
                return {
                  async maybeSingle(){
                    return {data:{
                      preferences:{metronome:{bpm:112}},
                      client_updated_at:'2026-07-25T00:00:00.000Z',
                    },error:null};
                  },
                };
              },
            };
          },
          async upsert(row){
            preferenceUpserts.push(row);
            return {data:null,error:null};
          },
        };
      }
      return {
        select(){
          return {
            async order(){
              return {data:[{
                score_date:'2026-07-24',
                correct_count:1,
                total_count:2,
              }],error:null};
            },
          };
        },
      };
    },
  };
  const supabase={createClient:()=>client};
  let anonymousCleared=false;
  let renderedHistory={};
  let appliedPreferences=null;
  let preferencesCleared=false;
  const {context,elements}=makeContext({
    config:{
      supabaseUrl:'https://olive-test.supabase.co',
      supabasePublishableKey:'publishable-test-key',
      redirectUrl:'',
    },
    storage,
    supabase,
  });
  await context.OliveCloud.init({
    getAnonymousHistory:()=>JSON.parse(storage.getItem('olive-ear-history-v1')||'{}'),
    clearAnonymousHistory(){
      anonymousCleared=true;
      storage.removeItem('olive-ear-history-v1');
    },
    useUserHistory(userId,history){ renderedHistory=history; },
    useAnonymousHistory(){},
    getPreferences:()=>({
      data:{metronome:{bpm:90}},
      updatedAt:'2026-07-24T00:00:00.000Z',
    }),
    applyPreferences(data,updatedAt){ appliedPreferences={data,updatedAt}; },
    clearPreferences(){ preferencesCleared=true; },
  });

  assert.equal(anonymousCleared,true);
  assert.equal(
    JSON.stringify(renderedHistory),
    JSON.stringify({'2026-07-24':{correct:1,total:2}})
  );
  assert.equal(elements.earCloudTitle.textContent,'클라우드에 저장됨');
  assert.equal(elements.earCloudAction.classList.contains('has-account'),true);
  assert.equal(elements.earCloudActionLabel.hidden,true);
  assert.equal(elements.earCloudAvatar.hidden,false);
  assert.equal(elements.earCloudAvatar.src,'https://example.com/olive-avatar.png');
  assert.equal(elements.earCloudAvatarFallback.textContent,'O');
  assert.equal(rpcCalls.filter(call=>call.name==='import_ear_history').length,1);
  assert.equal(appliedPreferences.data.metronome.bpm,112);
  assert.equal(appliedPreferences.updatedAt,'2026-07-25T00:00:00.000Z');
  assert.equal(preferenceUpserts.length,0);

  context.OliveCloud.recordAnswer('2026-07-24',true);
  context.OliveCloud.recordAnswer('2026-07-24',false);
  await new Promise(resolve=>setTimeout(resolve,100));

  const answerCalls=rpcCalls.filter(call=>call.name==='record_ear_answer');
  assert.equal(answerCalls.length,2);
  assert.notEqual(answerCalls[0].args.p_event_id,answerCalls[1].args.p_event_id);
  assert.deepEqual(
    JSON.parse(storage.getItem('olive-ear-sync-queue-v1:user-1')||'[]'),
    []
  );

  await elements.cloudDeleteData.listeners.click();
  assert.equal(rpcCalls.filter(call=>call.name==='delete_my_cloud_data').length,1);
  assert.equal(preferencesCleared,true);
  assert.equal(storage.getItem('olive-ear-history-user-v1:user-1'),null);

  await elements.cloudDeleteAccount.listeners.click();
  assert.equal(functionCalls.filter(call=>call.name==='delete-account').length,1);
}

(async()=>{
  await testUnconfigured();
  await testConfiguredQueueAndMigration();
  console.log('cloud-sync tests passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});

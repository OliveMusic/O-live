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
    this.inert=false;
    this.isConnected=true;
  }
  addEventListener(name,handler){ this.listeners[name]=handler; }
  setAttribute(name,value){ this.attributes.set(name,String(value)); }
  getAttribute(name){ return this.attributes.has(name)?this.attributes.get(name):null; }
  removeAttribute(name){ this.attributes.delete(name); }
  querySelectorAll(){ return []; }
  focus(){ this.focused=true; }
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
  'cloudAuthMessage','app',
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
    OLIVE_RELEASE:{version:'1.3.13',build:143,schemaVersion:9},
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
  assert.equal(elements.app.getAttribute('inert'),'');
  elements.cloudAuthClose.listeners.click();
  await new Promise(resolve=>setTimeout(resolve,230));
  assert.equal(elements.app.getAttribute('inert'),null);
}

async function testConfiguredQueueAndMigration(){
  const storage=new FakeStorage({
    'olive-ear-history-v1':JSON.stringify({'2026-07-24':{correct:1,total:2}}),
  });
  const rpcCalls=[];
  const preferenceUpserts=[];
  const functionCalls=[];
  const oauthCalls=[];
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
      async signInWithOAuth(options){ oauthCalls.push(options); return {error:null}; },
    },
    functions:{async invoke(name,args){
      functionCalls.push({name,args});
      return {data:{deleted:true},error:null};
    }},
    storage:{
      from(bucket){
        assert.equal(bucket,'practice-recordings');
        return {
          async list(){ return {data:[],error:null}; },
          async remove(){ return {data:[],error:null}; },
          async createSignedUrls(paths,expiresIn){
            assert.deepEqual(paths,['user-1/recording-1.m4a']);
            assert.equal(expiresIn,3600);
            return {data:paths.map(path=>({path,signedUrl:`https://storage.example.com/${path}?token=test`})),error:null};
          },
        };
      },
    },
    async rpc(name,args){
      rpcCalls.push({name,args});
      if(name==='olive_schema_version') return {data:9,error:null};
      if(name==='record_ear_answer'){
        recordCount++;
        if(recordCount===1) await new Promise(resolve=>setTimeout(resolve,20));
      }
      return {data:true,error:null};
    },
    from(table){
      if(table==='practice_recordings'){
        return {
          select(){
            return {
              eq(){
                return {
                  order(){
                    return {
                      async limit(){
                        return {data:[{
                          id:'recording-1',title:'9월 6일 녹음',object_path:'user-1/recording-1.m4a',
                          duration_ms:69000,byte_size:1000,mime_type:'audio/mp4',
                          playback_gain:3.25,
                          recorded_at:'2026-09-06T09:00:00.000Z',created_at:'2026-09-06T09:00:00.000Z',
                        }],error:null};
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
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
                interval_correct_count:1,
                interval_total_count:1,
                chord_correct_count:0,
                chord_total_count:1,
                scale_correct_count:0,
                scale_total_count:0,
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
  const recordingCacheClears=[];
  const {context,elements}=makeContext({
    config:{
      supabaseUrl:'https://olive-test.supabase.co',
      supabasePublishableKey:'publishable-test-key',
      redirectUrl:'',
    },
    storage,
    supabase,
  });
  context.OliveRecordingCache={
    async clearUser(userId){ recordingCacheClears.push(userId); },
  };
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
    JSON.stringify({'2026-07-24':{
      correct:1,total:2,
      byMode:{
        interval:{correct:1,total:1},
        chord:{correct:0,total:1},
        scale:{correct:0,total:0},
      },
    }})
  );
  assert.equal(elements.earCloudTitle.textContent,'클라우드에 저장됨');
  assert.equal(elements.earCloudAction.classList.contains('has-account'),true);
  assert.equal(elements.earCloudActionLabel.hidden,true);
  assert.equal(elements.earCloudAvatar.hidden,false);
  assert.equal(elements.earCloudAvatar.src,'https://example.com/olive-avatar.png');
  assert.equal(elements.earCloudAvatarFallback.textContent,'O');
  assert.equal(rpcCalls.filter(call=>call.name==='import_ear_history').length,1);
  const imported=rpcCalls.find(call=>call.name==='import_ear_history').args.p_days[0];
  assert.equal(imported.interval_total_count,0);
  assert.equal(imported.chord_total_count,0);
  assert.equal(imported.scale_total_count,0);
  assert.equal(appliedPreferences.data.metronome.bpm,112);
  assert.equal(appliedPreferences.updatedAt,'2026-07-25T00:00:00.000Z');
  assert.equal(preferenceUpserts.length,0);

  const recordings=await context.OliveCloud.listRecordings();
  assert.equal(recordings[0].object_path,'user-1/recording-1.m4a');
  assert.equal(recordings[0].playback_gain,3.25);
  assert.equal(recordings[0].playback_url,'https://storage.example.com/user-1/recording-1.m4a?token=test');

  await elements.cloudGoogleLogin.listeners.click();
  assert.equal(oauthCalls[0].options.redirectTo,'http://127.0.0.1:8765/');

  context.OliveCloud.recordAnswer('2026-07-24',true,'chord');
  context.OliveCloud.recordAnswer('2026-07-24',false,'scale');
  await new Promise(resolve=>setTimeout(resolve,100));

  const answerCalls=rpcCalls.filter(call=>call.name==='record_ear_answer');
  assert.equal(answerCalls.length,2);
  assert.notEqual(answerCalls[0].args.p_event_id,answerCalls[1].args.p_event_id);
  assert.equal(answerCalls[0].args.p_training_mode,'chord');
  assert.equal(answerCalls[1].args.p_training_mode,'scale');
  assert.deepEqual(
    JSON.parse(storage.getItem('olive-ear-sync-queue-v1:user-1')||'[]'),
    []
  );

  await elements.cloudLogout.listeners.click();
  assert.deepEqual(recordingCacheClears,['user-1']);

  await elements.cloudDeleteData.listeners.click();
  assert.equal(rpcCalls.filter(call=>call.name==='delete_my_cloud_data').length,1);
  assert.equal(preferencesCleared,true);
  assert.equal(storage.getItem('olive-ear-history-user-v1:user-1'),null);
  assert.deepEqual(recordingCacheClears,['user-1','user-1']);

  await elements.cloudDeleteAccount.listeners.click();
  assert.equal(functionCalls.filter(call=>call.name==='delete-account').length,1);
  assert.deepEqual(recordingCacheClears,['user-1','user-1','user-1']);
}

async function testSchemaUpgradeMessage(){
  const storage=new FakeStorage();
  let dataReadCount=0;
  const client={
    auth:{
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){
        return {data:{session:{user:{
          id:'schema-user',email:'schema@example.com',
          app_metadata:{provider:'google'},user_metadata:{},
        }}},error:null};
      },
    },
    async rpc(name){
      assert.equal(name,'olive_schema_version');
      return {data:null,error:{
        code:'PGRST202',
        message:'Could not find the function public.olive_schema_version in the schema cache',
      }};
    },
    from(){
      dataReadCount++;
      throw new Error('schema mismatch must stop before reading cloud data');
    },
  };
  const {context,elements}=makeContext({
    config:{
      supabaseUrl:'https://olive-test.supabase.co',
      supabasePublishableKey:'publishable-test-key',
      redirectUrl:'',
    },
    storage,
    supabase:{createClient:()=>client},
  });

  await context.OliveCloud.init({
    getAnonymousHistory:()=>({}),
    clearAnonymousHistory(){},
    useUserHistory(){},
    useAnonymousHistory(){},
  });

  assert.equal(elements.earCloudTitle.textContent,'클라우드 업데이트 필요');
  assert.match(elements.earCloudStatus.textContent,/DB-009/);
  assert.equal(dataReadCount,0);
  await elements.cloudSyncNow.listeners.click();
  assert.match(elements.cloudAuthMessage.textContent,/오류 코드 DB-009/);
  assert.equal(elements.cloudAuthMessage.classList.contains('error'),true);
}

(async()=>{
  await testUnconfigured();
  await testConfiguredQueueAndMigration();
  await testSchemaUpgradeMessage();
  console.log('cloud-sync tests passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});

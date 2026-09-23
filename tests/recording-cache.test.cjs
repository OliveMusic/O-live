const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

class FakeNameList{
  constructor(values=[]){ this.values=new Set(values); }
  contains(value){ return this.values.has(value); }
  add(value){ this.values.add(value); }
}
class FakeTransaction{
  constructor(database){
    this.database=database;
    this.pending=0;
    this.oncomplete=null;
    this.onerror=null;
    this.onabort=null;
    this.error=null;
  }
  objectStore(){ return new FakeObjectStore(this); }
  request(action){
    const request={result:undefined,error:null,onsuccess:null,onerror:null};
    this.pending++;
    queueMicrotask(()=>{
      try{
        request.result=action();
        if(request.onsuccess) request.onsuccess();
      }catch(error){
        request.error=error;
        this.error=error;
        if(request.onerror) request.onerror();
        if(this.onerror) this.onerror();
      }finally{
        this.pending--;
        if(!this.pending) setTimeout(()=>{ if(this.oncomplete) this.oncomplete(); },0);
      }
    });
    return request;
  }
}
class FakeObjectStore{
  constructor(transaction){
    this.transaction=transaction;
    this.indexNames=this.transaction.database.indexNames;
  }
  createIndex(name){ this.indexNames.add(name); }
  get(key){ return this.transaction.request(()=>this.transaction.database.values.get(key)); }
  getAll(){ return this.transaction.request(()=>Array.from(this.transaction.database.values.values())); }
  put(value){ return this.transaction.request(()=>this.transaction.database.values.set(value.key,value)); }
  delete(key){ return this.transaction.request(()=>this.transaction.database.values.delete(key)); }
}
class FakeDatabase{
  constructor(){
    this.values=new Map();
    this.objectStoreNames=new FakeNameList();
    this.indexNames=new FakeNameList();
    this.onversionchange=null;
  }
  createObjectStore(name){
    this.objectStoreNames.add(name);
    return new FakeObjectStore(new FakeTransaction(this));
  }
  transaction(){ return new FakeTransaction(this); }
  close(){}
}
class FakeIndexedDB{
  /* 이름마다 따로 된 데이터베이스다. 초안은 캐시와 다른 데이터베이스에 산다. */
  constructor(){ this.databases=new Map(); }
  open(name){
    const request={result:null,error:null,transaction:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
    queueMicrotask(()=>{
      const needsUpgrade=!this.databases.has(name);
      if(needsUpgrade) this.databases.set(name,new FakeDatabase());
      const database=this.databases.get(name);
      request.result=database;
      request.transaction=new FakeTransaction(database);
      if(needsUpgrade && request.onupgradeneeded) request.onupgradeneeded();
      if(request.onsuccess) request.onsuccess();
    });
    return request;
  }
}

let clock=1000;
class FakeDate extends Date{
  static now(){ return ++clock; }
}

let persistCalls=0;
const context={
  console,
  indexedDB:new FakeIndexedDB(),
  navigator:{storage:{
    async persisted(){ return false; },
    async persist(){ persistCalls++; return true; },
  }},
  Date:FakeDate,
  Map,
  Set,
  Promise,
  Object,
  Number,
  String,
  Boolean,
  Error,
  Blob,
  Uint8Array,
  ArrayBuffer,
  setTimeout,
  clearTimeout,
  queueMicrotask,
};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/recording-cache.js','utf8'),context,{filename:'recording-cache.js'});

function row(id,size=1){
  return {id,byte_size:size,mime_type:'audio/mp4',object_path:`user-1/${id}.m4a`};
}
function blob(size=1){
  return {size,type:'audio/mp4',async arrayBuffer(){ return new ArrayBuffer(Math.min(size,8)); }};
}

(async()=>{
  const cache=context.OliveRecordingCache;
  assert.equal(cache.limits.maxEntries,10);
  assert.equal(cache.limits.maxBytes,50*1024*1024);
  assert.equal(await cache.requestPersistence(),true);
  assert.ok(persistCalls>=1);

  const rows=[];
  for(let index=1;index<=11;index++){
    const item=row(`recording-${index}`);
    rows.push(item);
    assert.equal(await cache.put('user-1',item,blob()),true);
  }
  const recent=await cache.getMany('user-1',rows);
  assert.equal(recent.size,10,'only the ten most recent recordings remain');
  assert.equal(recent.has('recording-1'),false,'the oldest recording is evicted first');
  assert.equal(recent.has('recording-11'),true);

  assert.equal(await cache.get('user-1',row('recording-11',2)),null,'changed cloud metadata invalidates cache');
  await cache.clearUser('user-1');
  assert.equal((await cache.getMany('user-1',rows)).size,0);

  const largeRows=[];
  for(let index=1;index<=9;index++){
    const item=row(`large-${index}`,6*1024*1024);
    largeRows.push(item);
    await cache.put('user-2',item,blob(6*1024*1024));
  }
  assert.equal((await cache.getMany('user-2',largeRows)).size,8,'the 50MB byte limit evicts old entries');
  await cache.remove('user-2','large-9');
  assert.equal(await cache.get('user-2',largeRows[8]),null);

  /* ---------- 저장하지 않은 초안 ----------
     오프라인에서 저장하지 못한 채 앱이 내려가도 테이크가 남는다. 계정마다 하나,
     캐시 정리(10개·50MB)와는 따로 산다. */
  const take={
    blob:new Blob([new Uint8Array([1,2,3,4])],{type:'audio/mp4'}),
    durationMs:4200,mimeType:'audio/mp4',title:'연습실',extension:'m4a',
    recordedAt:'2026-09-23T10:00:00.000Z',playbackGain:1.4,waveform:[0.1,0.5,0.2],
  };
  assert.equal(await cache.putDraft('user-3',take),true);
  for(let index=1;index<=12;index++) await cache.put('user-3',row(`crowd-${index}`),blob());
  const restored=await cache.getDraft('user-3');
  assert.ok(restored,'the draft survives cache eviction');
  assert.equal(restored.title,'연습실');
  assert.equal(restored.durationMs,4200);
  assert.equal(restored.blob.size,4);
  assert.deepEqual(Array.from(restored.waveform),[0.1,0.5,0.2]);
  assert.equal(await cache.getDraft('user-4'),null,'another account never sees the draft');
  await cache.clearUser('user-3');
  assert.ok(await cache.getDraft('user-3'),'clearing the playback cache keeps the unsaved draft');
  await cache.putDraft('user-4',take);
  await cache.keepOnlyDraftOf('user-4');
  assert.equal(await cache.getDraft('user-3'),null,'a different account signing in removes earlier drafts');
  assert.ok(await cache.getDraft('user-4'));
  await cache.removeDraft('user-4');
  assert.equal(await cache.getDraft('user-4'),null);
  // 남기기가 늦게 끝나도 곧이어 부탁한 지우기가 이긴다.
  const slowTake={...take,blob:{size:4,type:'audio/mp4',async arrayBuffer(){
    await new Promise(resolve=>setTimeout(resolve,30));
    return new Uint8Array([1,2,3,4]).buffer;
  }}};
  const writing=cache.putDraft('user-5',slowTake);
  const removing=cache.removeDraft('user-5');
  await Promise.all([writing,removing]);
  assert.equal(await cache.getDraft('user-5'),null,'a saved take is never restored by a late draft write');

  console.log('recording cache tests passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});

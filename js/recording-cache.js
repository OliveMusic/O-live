/* ===================== 녹음 기기 캐시 =====================
   비공개 녹음의 Blob만 IndexedDB에 보관한다. 서비스 워커나 만료되는
   다운로드 주소를 캐시하지 않으며, 최근 10개·50MB 안에서 자동 정리한다. */
(function(root){
  'use strict';

  const DB_NAME='olive-recording-cache-v1';
  const DB_VERSION=1;
  const STORE_NAME='recordings';
  const MAX_ENTRIES=10;
  const MAX_BYTES=50*1024*1024;
  let databasePromise=null;
  let writeQueue=Promise.resolve();

  function cacheKey(userId,recordingId){ return `${userId}:${recordingId}`; }
  function rowValue(row,snake,camel){
    if(!row || typeof row!=='object') return '';
    return row[snake]!==undefined ? row[snake] : row[camel];
  }
  function rowId(row){ return String(row&&row.id||''); }
  function rowBytes(row){ return Math.max(0,Number(rowValue(row,'byte_size','byteSize'))||0); }
  function rowMime(row){ return String(rowValue(row,'mime_type','mimeType')||''); }
  function rowPath(row){ return String(rowValue(row,'object_path','objectPath')||''); }
  function entryBlob(entry){
    if(!entry) return null;
    if(entry.blob) return entry.blob;
    if(entry.data && root.Blob) return new root.Blob([entry.data],{type:entry.mimeType||''});
    return null;
  }
  function entryMatches(entry,row){
    if(!entry || (!entry.data && !entry.blob) || entry.recordingId!==rowId(row)) return false;
    const expectedBytes=rowBytes(row);
    const expectedMime=rowMime(row);
    const expectedPath=rowPath(row);
    return (!expectedBytes || entry.byteSize===expectedBytes) &&
      (!expectedMime || !entry.mimeType || entry.mimeType===expectedMime) &&
      (!expectedPath || !entry.objectPath || entry.objectPath===expectedPath);
  }
  function requestResult(request){
    return new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB request failed'));
    });
  }
  function transactionDone(transaction){
    return new Promise((resolve,reject)=>{
      let operationError=null;
      transaction.oncomplete=()=>resolve();
      transaction.onerror=event=>{
        operationError=event&&event.target&&event.target.error||transaction.error||operationError;
      };
      transaction.onabort=()=>reject(operationError||transaction.error||new Error('IndexedDB transaction aborted'));
    });
  }
  function openDatabase(){
    if(databasePromise) return databasePromise;
    if(!root.indexedDB) return Promise.resolve(null);
    databasePromise=new Promise((resolve,reject)=>{
      const request=root.indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const database=request.result;
        const store=database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME,{keyPath:'key'});
        if(!store.indexNames.contains('userId')) store.createIndex('userId','userId',{unique:false});
      };
      request.onsuccess=()=>{
        const database=request.result;
        database.onversionchange=()=>{
          database.close();
          databasePromise=null;
        };
        resolve(database);
      };
      request.onerror=()=>{
        databasePromise=null;
        reject(request.error||new Error('Recording cache unavailable'));
      };
      request.onblocked=()=>{
        databasePromise=null;
        reject(new Error('Recording cache upgrade blocked'));
      };
    });
    return databasePromise;
  }
  function enqueueWrite(action){
    const queued=writeQueue.then(action,action);
    writeQueue=queued.catch(()=>{});
    return queued;
  }
  async function allEntries(database){
    const transaction=database.transaction(STORE_NAME,'readonly');
    return requestResult(transaction.objectStore(STORE_NAME).getAll());
  }
  async function deleteKeys(database,keys){
    if(!keys.length) return;
    const transaction=database.transaction(STORE_NAME,'readwrite');
    const done=transactionDone(transaction);
    const store=transaction.objectStore(STORE_NAME);
    keys.forEach(key=>store.delete(key));
    await done;
  }
  async function get(userId,row,options){
    const recordingId=rowId(row);
    if(!userId || !recordingId) return null;
    const database=await openDatabase();
    if(!database) return null;
    const transaction=database.transaction(STORE_NAME,'readonly');
    const entry=await requestResult(transaction.objectStore(STORE_NAME).get(cacheKey(userId,recordingId)));
    if(!entryMatches(entry,row)){
      if(entry) await remove(userId,recordingId);
      return null;
    }
    if(!options || options.touch!==false){
      enqueueWrite(async()=>{
        const next={...entry,lastPlayedAt:Date.now()};
        if(!next.data && next.blob && typeof next.blob.arrayBuffer==='function'){
          next.data=await next.blob.arrayBuffer();
          delete next.blob;
        }
        const update=database.transaction(STORE_NAME,'readwrite');
        const done=transactionDone(update);
        update.objectStore(STORE_NAME).put(next);
        await done;
      }).catch(()=>{});
    }
    return entryBlob(entry);
  }
  async function getMany(userId,rows){
    if(!userId || !Array.isArray(rows) || !rows.length) return new Map();
    const database=await openDatabase();
    if(!database) return new Map();
    const byId=new Map(rows.map(row=>[rowId(row),row]));
    const entries=await allEntries(database);
    const found=new Map();
    const stale=[];
    entries.forEach(entry=>{
      if(entry.userId!==userId) return;
      const row=byId.get(entry.recordingId);
      if(!row || !entryMatches(entry,row)) stale.push(entry.key);
      else found.set(entry.recordingId,entryBlob(entry));
    });
    if(stale.length) enqueueWrite(()=>deleteKeys(database,stale)).catch(()=>{});
    return found;
  }
  async function put(userId,row,blob){
    const recordingId=rowId(row);
    const byteSize=Math.max(0,Number(blob&&blob.size)||rowBytes(row));
    if(!userId || !recordingId || !blob || !byteSize || byteSize>MAX_BYTES) return false;
    if(typeof blob.arrayBuffer!=='function') return false;
    const data=await blob.arrayBuffer();
    return enqueueWrite(async()=>{
      const database=await openDatabase();
      if(!database) return false;
      const key=cacheKey(userId,recordingId);
      const now=Date.now();
      const entry={
        key,userId,recordingId,data,byteSize,
        mimeType:rowMime(row)||String(blob.type||''),
        objectPath:rowPath(row),
        cachedAt:now,lastPlayedAt:now,
      };
      const existing=(await allEntries(database)).filter(item=>item.key!==key);
      const candidates=[entry,...existing].sort((a,b)=>{
        if(a.key===key) return -1;
        if(b.key===key) return 1;
        return Number(b.lastPlayedAt||b.cachedAt||0)-Number(a.lastPlayedAt||a.cachedAt||0);
      });
      const keep=new Set();
      let totalBytes=0;
      candidates.forEach(item=>{
        const size=Math.max(0,Number(item.byteSize)||Number(item.data&&item.data.byteLength)||Number(item.blob&&item.blob.size)||0);
        if(keep.size>=MAX_ENTRIES || totalBytes+size>MAX_BYTES) return;
        keep.add(item.key);
        totalBytes+=size;
      });
      const transaction=database.transaction(STORE_NAME,'readwrite');
      const done=transactionDone(transaction);
      const store=transaction.objectStore(STORE_NAME);
      candidates.forEach(item=>{ if(!keep.has(item.key)) store.delete(item.key); });
      if(keep.has(key)) store.put(entry);
      await done;
      return keep.has(key);
    });
  }
  async function remove(userId,recordingId){
    if(!userId || !recordingId) return;
    return enqueueWrite(async()=>{
      const database=await openDatabase();
      if(!database) return;
      await deleteKeys(database,[cacheKey(userId,recordingId)]);
    });
  }
  async function clearUser(userId){
    if(!userId) return;
    return enqueueWrite(async()=>{
      const database=await openDatabase();
      if(!database) return;
      const entries=await allEntries(database);
      await deleteKeys(database,entries.filter(entry=>entry.userId===userId).map(entry=>entry.key));
    });
  }
  async function requestPersistence(){
    const storage=root.navigator&&root.navigator.storage;
    if(!storage || typeof storage.persist!=='function') return false;
    try{
      if(typeof storage.persisted==='function' && await storage.persisted()) return true;
      return Boolean(await storage.persist());
    }catch(error){ return false; }
  }

  root.OliveRecordingCache=Object.freeze({
    get,getMany,put,remove,clearUser,requestPersistence,
    limits:Object.freeze({maxEntries:MAX_ENTRIES,maxBytes:MAX_BYTES}),
  });
  requestPersistence();
})(globalThis);

const assert=require('node:assert/strict');
const fs=require('node:fs');

const index=fs.readFileSync('index.html','utf8');
const recorder=fs.readFileSync('js/recorder.js','utf8');
const cloud=fs.readFileSync('cloud-sync.js','utf8');
const migration=fs.readFileSync('supabase/006_recordings.sql','utf8');
const edge=fs.readFileSync('supabase/functions/delete-account/index.ts','utf8');

assert.match(index,/grid-template-columns:repeat\(3,1fr\)/);
for(const label of ['청음','리듬','녹음']) assert.match(index,new RegExp(`data-mode="[^"]+">${label}<`));
assert.match(index,/id="pane-record"/);
assert.match(index,/id="recordUsage">0 \/ 50</);
assert.match(index,/id="recordMenuRename"[^>]*>이름 변경</);
assert.match(index,/id="recordMenuDownload"[^>]*>다운로드</);
assert.match(index,/id="recordMenuDelete"[^>]*>삭제</);
assert.doesNotMatch(index,/id="pane-record"[\s\S]*?<h2>연주 녹음<\/h2>/);

// 튜너·청음과 같은 올리브 기울기, 비율, 씨 위치를 사용한다.
assert.match(index,/\.record-olive-static,\.record-olive\{[\s\S]*?width:76px; height:62\.5px;[\s\S]*?transform:rotate\(-11deg\)/);
assert.match(index,/\.record-olive::after,\.record-olive-static::after\{[\s\S]*?left:calc\(50% \+ 15px\);[\s\S]*?width:23px; height:23px;/);
assert.match(index,/\.record-row-play\{[\s\S]*?transform:rotate\(-11deg\)/);

assert.match(recorder,/const MAX_DURATION_MS=5\*60\*1000/);
assert.match(recorder,/const MAX_RECORDINGS=50/);
assert.match(recorder,/audioBitsPerSecond:96000/);
assert.match(recorder,/echoCancellation:false,noiseSuppression:false,autoGainControl:false/);
assert.match(recorder,/MediaRecorder\.isTypeSupported/);
assert.match(recorder,/registerTransport\(/);
assert.match(recorder,/stopForNavigation/);
assert.match(recorder,/window\.confirm\(`“\$\{row\.title\}” 녹음을 삭제할까요/);

assert.match(cloud,/subscribeSession/);
assert.match(cloud,/from\('practice-recordings'\)\.upload/);
assert.match(cloud,/rpc\('reserve_practice_recording'/);
assert.match(cloud,/rpc\('finalize_practice_recording'/);
assert.match(cloud,/storage\.from\('practice-recordings'\)\s*\.download/);
assert.match(cloud,/await deleteAllRecordingObjects\(\)/);

assert.match(migration,/create table if not exists public\.practice_recordings/);
assert.match(migration,/status in \('pending','ready'\)/);
assert.match(migration,/v_count >= 50/);
assert.match(migration,/v_bytes\+p_byte_size > 262144000/);
assert.match(migration,/values \('practice-recordings','practice-recordings',false,15728640\)/);
assert.match(migration,/Users upload reserved recording objects/);
assert.match(migration,/Users read their own recording objects/);
assert.match(migration,/Users delete their own recording objects/);
assert.match(migration,/delete from public\.practice_recordings where user_id=v_user_id/);
assert.match(migration,/select 6::integer/);

assert.match(edge,/from\("practice-recordings"\)/);
assert.match(edge,/\.remove\(recordingPaths\)/);
assert.ok(edge.indexOf('.remove(recordingPaths)')<edge.indexOf('auth.admin.deleteUser(user.id)'),
  'recording objects are removed before the auth user');

console.log('recording feature tests passed');

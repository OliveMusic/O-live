const assert=require('node:assert/strict');
const fs=require('node:fs');

const index=fs.readFileSync('index.html','utf8');
const recorder=fs.readFileSync('js/recorder.js','utf8');
const audioRuntime=fs.readFileSync('js/audio-runtime.js','utf8');
const core=fs.readFileSync('js/core.js','utf8');
const appShell=fs.readFileSync('js/app-shell.js','utf8');
const metronome=fs.readFileSync('js/metronome.js','utf8');
const rhythm=fs.readFileSync('js/rhythm-trainer.js','utf8');
const jam=fs.readFileSync('js/jam-session.js','utf8');
const cloud=fs.readFileSync('cloud-sync.js','utf8');
const recordingCache=fs.readFileSync('js/recording-cache.js','utf8');
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
assert.match(index,/\.record-draft-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(index,/\.record-row\{[\s\S]*?min-height:54px;[\s\S]*?grid-template-columns:44px/);
assert.match(index,/\.record-row-play\{[\s\S]*?width:44px; height:44px;/);
assert.match(index,/\.record-row-play::before\{[\s\S]*?width:34px; height:28px;/);

assert.match(recorder,/const MAX_DURATION_MS=5\*60\*1000/);
assert.match(recorder,/const MAX_RECORDINGS=50/);
assert.match(recorder,/audioBitsPerSecond:96000/);
assert.match(recorder,/echoCancellation:false,noiseSuppression:false,autoGainControl:false/);
assert.match(recorder,/MediaRecorder\.isTypeSupported/);
assert.match(recorder,/registerTransport\(/);
assert.match(recorder,/ensureRecordingCtx\(preservePlayback\)/);
assert.doesNotMatch(recorder,/stopAllTransports\(\)/);
assert.doesNotMatch(recorder,/stopForNavigation/);
assert.match(recorder,/메트로놈·잼과 함께 사용할 수 있습니다 · 튜너 또는 앱을 벗어나면 중지됩니다/);
assert.match(recorder,/window\.confirm\(`“\$\{row\.title\}” 녹음을 삭제할까요/);

assert.match(audioRuntime,/function ensurePlaybackCtx\(\)/);
assert.match(audioRuntime,/recording\?'play-and-record':'ambient'/);
assert.match(audioRuntime,/function beginPlaybackFromGesture\(\)/);
assert.match(audioRuntime,/ctx\.resume\(\)/);
assert.match(audioRuntime,/if\(!anySounding\(\) && !recording\)[\s\S]*?setAudioSession\('ambient'\)/);
for(const source of [metronome,rhythm,jam]) assert.match(source,/await ensurePlaybackCtx\(\)/);
assert.doesNotMatch(core,/leavingTrainer|stopForNavigation/);
assert.match(core,/enteringTuner[\s\S]*?stopAllTransports\(\)/);
assert.doesNotMatch(appShell,/stopForNavigation/);

assert.match(cloud,/subscribeSession/);
assert.match(cloud,/from\('practice-recordings'\)\.upload/);
assert.match(cloud,/rpc\('reserve_practice_recording'/);
assert.match(cloud,/rpc\('finalize_practice_recording'/);
assert.doesNotMatch(cloud,/createSignedUrls/);
assert.match(cloud,/storage\.from\('practice-recordings'\)\s*\.download/);
assert.match(cloud,/await deleteAllRecordingObjects\(\)/);
assert.match(cloud,/await clearRecordingAudioCache\(userId\)/);

assert.match(recordingCache,/const MAX_ENTRIES=10/);
assert.match(recordingCache,/const MAX_BYTES=50\*1024\*1024/);
assert.match(recordingCache,/root\.indexedDB\.open/);
assert.match(recordingCache,/storage\.persist\(\)/);
assert.match(recorder,/cache\.getMany\(userId,rows\)/);
assert.match(recorder,/findPlaybackBlob\(row\)/);
assert.match(recorder,/await cacheRowBlob\(saved,saved\.blob\)/);
assert.match(recorder,/await cache\.remove\(currentUser\.id,row\.id\)/);

// iOS Safari에서 제스처로 컨텍스트를 먼저 연 뒤 인증 다운로드·디코딩·재생을 잇는다.
const playRow=recorder.match(/function playRow\(row\)\{[\s\S]*?\n  \}/)?.[0]||'';
assert.match(playRow,/beginPlaybackFromGesture\(\)/);
assert.match(playRow,/findPlaybackBlob\(row\)/);
assert.match(recorder,/const result=await window\.OliveCloud\.downloadRecording\(row\)/);
assert.match(playRow,/decodeAudioBlob\(ctx,result\.blob\)/);
assert.match(playRow,/ctx\.createBufferSource\(\)/);
assert.match(playRow,/cloudFallbackAudio\.play\(\)/);
assert.match(recorder,/재생 준비가 끝났습니다 · 버튼을 다시 눌러주세요/);
assert.doesNotMatch(recorder,/const cloudAudio=new Audio\(\)/);

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

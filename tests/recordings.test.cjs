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
const baseMigration=fs.readFileSync('supabase/006_recordings.sql','utf8');
const waveformMigration=fs.readFileSync('supabase/007_recording_waveforms.sql','utf8');
const timestampMigration=fs.readFileSync('supabase/008_recording_timestamps.sql','utf8');
const playbackGainMigration=fs.readFileSync('supabase/009_recording_playback_gain.sql','utf8');
const migration=baseMigration+'\n'+waveformMigration+'\n'+timestampMigration+'\n'+playbackGainMigration;
const edge=fs.readFileSync('supabase/functions/delete-account/index.ts','utf8');

assert.match(index,/grid-template-columns:repeat\(3,1fr\)/);
for(const label of ['청음','리듬','녹음']) assert.match(index,new RegExp(`data-mode="[^"]+">${label}<`));
assert.match(index,/id="pane-record"/);
assert.match(index,/id="recordUsage">0 \/ 50</);
assert.match(index,/id="recordMenuRename"[^>]*>이름 변경</);
assert.match(index,/id="recordMenuDownload"[^>]*>다운로드</);
assert.match(index,/id="recordMenuDelete"[^>]*>삭제</);
assert.doesNotMatch(index,/id="recordMenuCancel"/);
assert.doesNotMatch(index,/id="pane-record"[\s\S]*?<h2>연주 녹음<\/h2>/);

// 튜너·청음과 같은 올리브 기울기, 비율, 씨 위치를 사용한다.
assert.match(index,/\.record-olive-static,\.record-olive\{[\s\S]*?width:76px; height:62\.5px;[\s\S]*?transform:rotate\(-11deg\)/);
assert.match(index,/\.record-olive::after,\.record-olive-static::after\{[\s\S]*?left:calc\(50% \+ 15px\);[\s\S]*?width:23px; height:23px;/);
assert.match(index,/\.record-player-play\{[\s\S]*?transform:rotate\(-11deg\)/);
assert.match(index,/\.record-draft-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(index,/\.record-row\{[\s\S]*?min-height:54px;[\s\S]*?grid-template-columns:minmax\(0,1fr\) 44px/);
assert.match(index,/\.record-player-play\{[\s\S]*?width:44px; height:44px;/);
assert.match(index,/\.record-player-play::before\{[\s\S]*?width:34px; height:28px;/);
assert.match(index,/\.record-player\{[\s\S]*?grid-template-columns:44px minmax\(0,1fr\)/);
assert.match(index,/\.record-waveform\{[\s\S]*?height:44px/);
assert.match(index,/\.record-waveform-svg\.played\{[\s\S]*?clip-path:inset/);

assert.match(recorder,/const MAX_DURATION_MS=5\*60\*1000/);
assert.match(recorder,/const MAX_RECORDINGS=50/);
assert.match(recorder,/audioBitsPerSecond:96000/);
assert.match(recorder,/echoCancellation:false,noiseSuppression:false,autoGainControl:false/);
assert.match(recorder,/const METRONOME_REFERENCE_RMS=\.1/);
assert.match(recorder,/const PLAYBACK_GAIN_MAX=11\.2/);
assert.match(recorder,/function playbackGainForRecording\(levels,peak\)/);
assert.match(recorder,/METRONOME_REFERENCE_RMS\/Math\.max\(representative,RECORDING_NOISE_FLOOR\)/);
assert.match(recorder,/const recordingStream=setupCapture\(ctx\)/);
assert.match(recorder,/recorder=new MediaRecorder\(recordingStream,options\)/);
assert.match(recorder,/channelCountMode='explicit'/);
assert.match(recorder,/captureDestination=makeMono\(ctx\.createMediaStreamDestination\(\)\)/);
assert.match(recorder,/levelSource\.connect\(captureMixer\)\.connect\(captureDestination\)/);
assert.doesNotMatch(recorder,/Math\.abs\(rowPlaybackGain\(row\)-1\)/);
assert.doesNotMatch(recorder,/updateCaptureNormalization/);
assert.match(recorder,/function meterLevelForRms\(rms\)/);
assert.match(recorder,/getFloatTimeDomainData\(data\)/);
assert.match(recorder,/Math\.pow\(normalized,\.78\)/);
assert.doesNotMatch(recorder,/rms\*7/);
assert.match(recorder,/MediaRecorder\.isTypeSupported/);
assert.match(recorder,/function defaultTitle\(\)\{\s*return '무제';/);
assert.match(recorder,/recordedAt=new Date\(\)\.toISOString\(\)/);
assert.match(recorder,/date\.getHours\(\)/);
assert.match(recorder,/recorder\.start\(\);/);
assert.doesNotMatch(recorder,/recorder\.start\(1000\)/);
assert.match(recorder,/registerTransport\(/);
assert.match(recorder,/ensureRecordingCtx\(preservePlayback\)/);
assert.doesNotMatch(recorder,/stopAllTransports\(\)/);
assert.doesNotMatch(recorder,/stopForNavigation/);
assert.match(recorder,/메트로놈·잼과 함께 사용할 수 있습니다 · 튜너 또는 앱을 벗어나면 중지됩니다/);
assert.match(recorder,/window\.confirm\(`“\$\{row\.title\}” 녹음을 삭제할까요/);

assert.match(audioRuntime,/function ensurePlaybackCtx\(\)/);
assert.match(audioRuntime,/recording\?'play-and-record':background\?'playback':'ambient'/);
assert.match(audioRuntime,/function ensureBackgroundPlaybackCtx\(label\)/);
assert.match(audioRuntime,/function ensureBackgroundPlaybackCtx\(label\)\{[\s\S]*?stopCompetingBackgroundTransports\(label\)/);
assert.match(audioRuntime,/function resumeBackgroundPlayback\(\)[\s\S]*?await withTimeout\(resumeReady,4500\)[\s\S]*?setBackgroundTransportsPaused\(false\)/);
assert.match(audioRuntime,/navigator\.audioSession\.type = mode/);
assert.match(audioRuntime,/function startBackgroundMedia\(label,preparedCtx\)/);
assert.match(audioRuntime,/function beginPlaybackFromGesture\(\)/);
assert.match(audioRuntime,/function beginPlaybackFromGesture\(\)\{[\s\S]*?recording\?'play-and-record':'playback'/);
assert.match(audioRuntime,/ctx\.resume\(\)/);
assert.match(audioRuntime,/if\(!anySounding\(\) && !recording\)[\s\S]*?setAudioSession\('ambient'\)/);
assert.match(rhythm,/await ensurePlaybackCtx\(\)/);
for(const source of [metronome,jam]) assert.match(source,/await ensureBackgroundPlaybackCtx\(/);
assert.doesNotMatch(core,/leavingTrainer|stopForNavigation/);
assert.match(core,/enteringTuner[\s\S]*?stopAllTransports\(\)/);
assert.doesNotMatch(appShell,/stopForNavigation/);

assert.match(cloud,/subscribeSession/);
assert.match(cloud,/from\('practice-recordings'\)\.upload/);
assert.match(cloud,/rpc\('reserve_practice_recording'/);
assert.match(cloud,/rpc\('finalize_practice_recording'/);
assert.match(cloud,/createSignedUrls\(recordings\.map\(row=>row\.object_path\),60\*60\)/);
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

// iOS Safari에서는 서명 주소를 네이티브 플레이어로 즉시 재생하고,
// 실패할 때만 제스처에서 미리 연 Web Audio 디코딩 경로를 사용한다.
const playRow=recorder.match(/function playRow\(row,requestedOffset\)\{[\s\S]*?\n  \}/)?.[0]||'';
assert.match(playRow,/beginPlaybackFromGesture\(\)/);
assert.match(playRow,/findPlaybackBlob\(row\)/);
assert.match(playRow,/row\.playback_url/);
assert.match(playRow,/cloudPlayingId===row\.id && seeking/);
assert.match(playRow,/prepareNativeOffset\(offset\)/);
assert.match(playRow,/startNormalizedNative\(playbackUrl,playback,row,token,offset\)/);
assert.doesNotMatch(playRow,/cloudPlaybackMode==='native-paused'/);
assert.match(playRow,/playDecodedBlob\(playback,recordingBlob,row,token/);
assert.match(recorder,/function createExpandedPlayer\(row\)/);
assert.match(recorder,/waveform\.setAttribute\('role','slider'\)/);
assert.match(recorder,/seekRow\(row,bounds\.width\?/);
assert.match(recorder,/async function waveformFromBlob\(blob\)/);
assert.match(recorder,/waveform:compactWaveform\(waveformLevels,WAVEFORM_POINTS\)/);
assert.match(recorder,/playbackGain:playbackGainForRecording\(waveformLevels,recordingPeak\)/);
assert.match(recorder,/gain\.gain\.value=rowPlaybackGain\(row\)/);
assert.match(recorder,/gain\.gain\.value=rowPlaybackGain\(draft\)/);
assert.match(recorder,/const gain=makeMono\(ctx\.createGain\(\)\)/);
assert.match(recorder,/ctx\.createMediaElementSource\(cloudFallbackAudio\)/);
assert.match(recorder,/stopPlayback:stopPlaybackForOtherTool/);
assert.match(recorder,/saveRecordingWaveform\(row\.id,values\)/);
assert.match(cloud,/p_waveform:Array\.isArray/);
assert.match(cloud,/p_recorded_at:String\(recording&&recording\.recordedAt/);
assert.match(cloud,/p_playback_gain:Number\(recording&&recording\.playbackGain\)/);
assert.match(cloud,/rpc\('save_practice_recording_waveform'/);
assert.match(recorder,/const result=await window\.OliveCloud\.downloadRecording\(row\)/);
assert.match(recorder,/decodeAudioBlob\(ctx,result\.blob\)/);
assert.match(recorder,/ctx\.createBufferSource\(\)/);
assert.match(recorder,/이 녹음 파일을 재생할 수 없습니다 · 다운로드로 확인해 주세요/);
assert.doesNotMatch(recorder,/const cloudAudio=new Audio\(\)/);
for(const source of [metronome,jam]){
  assert.match(source,/function scheduler\(\)\{[\s\S]*?if\(isBackgroundMediaPaused\(\)\)/);
  assert.match(source,/function visualLoop\(gen\)\{[\s\S]*?if\(isBackgroundMediaPaused\(\)\)/);
  assert.match(source,/function setMediaPaused\(paused\)\{[\s\S]*?clearTimeout\(timerID\)/);
  assert.match(source,/setContext:ctx=>\{/);
}

assert.match(migration,/create table if not exists public\.practice_recordings/);
assert.match(migration,/status in \('pending','ready'\)/);
assert.match(migration,/v_count >= 50/);
assert.match(migration,/v_bytes\+p_byte_size > 262144000/);
assert.match(migration,/values \('practice-recordings','practice-recordings',false,15728640\)/);
assert.match(migration,/Users upload reserved recording objects/);
assert.match(migration,/Users read their own recording objects/);
assert.match(migration,/Users delete their own recording objects/);
assert.match(migration,/delete from public\.practice_recordings where user_id=v_user_id/);
assert.match(waveformMigration,/add column if not exists waveform smallint\[\]/);
assert.match(waveformMigration,/create or replace function public\.save_practice_recording_waveform/);
assert.match(waveformMigration,/select 7::integer/);
assert.match(timestampMigration,/p_recorded_at timestamptz/);
assert.match(timestampMigration,/recorded_at\s*\n\s*\) values/);
assert.match(timestampMigration,/select 8::integer/);
assert.match(playbackGainMigration,/add column if not exists playback_gain real/);
assert.match(playbackGainMigration,/p_playback_gain real/);
assert.match(playbackGainMigration,/select 9::integer/);

assert.match(edge,/from\("practice-recordings"\)/);
assert.match(edge,/\.remove\(recordingPaths\)/);
assert.ok(edge.indexOf('.remove(recordingPaths)')<edge.indexOf('auth.admin.deleteUser(user.id)'),
  'recording objects are removed before the auth user');

console.log('recording feature tests passed');

const assert=require('node:assert/strict');
const fs=require('node:fs');

const index=fs.readFileSync('index.html','utf8');
const sync=fs.readFileSync('cloud-sync.js','utf8');
const migration=fs.readFileSync('supabase/002_preferences_and_deletion.sql','utf8');
const retention=fs.readFileSync('supabase/003_sync_event_retention.sql','utf8');
const edge=fs.readFileSync('supabase/functions/delete-account/index.ts','utf8');

for(const section of ['metronome','tuner','scales','earTrainer','rhythmTrainer','jam']){
  assert.match(index,new RegExp(`OlivePreferences\\.register\\('${section}'`));
}

assert.match(index,/Content-Security-Policy/);
assert.match(index,/script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net/);
assert.match(index,/connect-src 'self' https:\/\/mowbkjoccuylfisbypvi\.supabase\.co/);
assert.match(index,/crossorigin="anonymous" referrerpolicy="no-referrer"/);
for(const color of ['#4285F4','#34A853','#FBBC05','#EA4335']){
  assert.match(index,new RegExp(color));
}
assert.match(index,/<details class="cloud-danger">/);
assert.match(index,/<summary>데이터 및 계정 관리<\/summary>/);
assert.match(index,/\.cloud-danger-actions button\{\s*min-height:44px/);

assert.match(sync,/from\('user_preferences'\)/);
assert.match(sync,/rpc\('delete_my_cloud_data'\)/);
assert.match(sync,/functions\.invoke\('delete-account'/);
assert.match(sync,/window\.confirm/);
assert.match(sync,/new URL\('\.\/',location\.href\)\.href/);
assert.match(sync,/ui\.app\.setAttribute\('inert',''\)/);
assert.match(sync,/ui\.app\.removeAttribute\('inert'\)/);
assert.match(sync,/querySelectorAll\(/);

assert.match(migration,/create table if not exists public\.user_preferences/);
assert.match(migration,/enable row level security/);
assert.match(migration,/create or replace function public\.delete_my_cloud_data/);
assert.match(migration,/grant execute on function public\.delete_my_cloud_data\(\) to authenticated/);

assert.match(retention,/cleanup_ear_sync_events/);
assert.match(retention,/interval '90 days'/);
assert.match(retention,/cron\.schedule/);

assert.match(edge,/supabase-js@2\.110\.8/);
assert.doesNotMatch(edge,/Access-Control-Allow-Origin": "\*"/);
assert.match(edge,/https:\/\/olivemusic\.github\.io/);
assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edge,/auth\.getUser\(\)/);
assert.match(edge,/auth\.admin\.deleteUser\(user\.id\)/);

console.log('cloud feature tests passed');

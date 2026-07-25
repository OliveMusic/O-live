const assert=require('node:assert/strict');
const fs=require('node:fs');

const index=fs.readFileSync('index.html','utf8');
const sync=fs.readFileSync('cloud-sync.js','utf8');
const migration=fs.readFileSync('supabase/002_preferences_and_deletion.sql','utf8');
const edge=fs.readFileSync('supabase/functions/delete-account/index.ts','utf8');

for(const section of ['metronome','tuner','scales','earTrainer','rhythmTrainer','jam']){
  assert.match(index,new RegExp(`OlivePreferences\\.register\\('${section}'`));
}

assert.match(index,/Content-Security-Policy/);
assert.match(index,/script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net/);
assert.match(index,/connect-src 'self' https:\/\/mowbkjoccuylfisbypvi\.supabase\.co/);
assert.match(index,/crossorigin="anonymous" referrerpolicy="no-referrer"/);
assert.match(index,/<details class="cloud-danger">/);
assert.match(index,/<summary>데이터 및 계정 관리<\/summary>/);
assert.match(index,/\.cloud-danger-actions button\{\s*min-height:44px/);

assert.match(sync,/from\('user_preferences'\)/);
assert.match(sync,/rpc\('delete_my_cloud_data'\)/);
assert.match(sync,/functions\.invoke\('delete-account'/);
assert.match(sync,/window\.confirm/);

assert.match(migration,/create table if not exists public\.user_preferences/);
assert.match(migration,/enable row level security/);
assert.match(migration,/create or replace function public\.delete_my_cloud_data/);
assert.match(migration,/grant execute on function public\.delete_my_cloud_data\(\) to authenticated/);

assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edge,/auth\.getUser\(\)/);
assert.match(edge,/auth\.admin\.deleteUser\(user\.id\)/);

console.log('cloud feature tests passed');

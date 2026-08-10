const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const context={globalThis:{}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('app-version.js','utf8'),context,{filename:'app-version.js'});

const release=context.globalThis.OLIVE_RELEASE;
assert.ok(release,'release metadata exists');
assert.match(release.version,/^\d+\.\d+\.\d+$/,'semantic app version');
assert.ok(Number.isInteger(release.build) && release.build>0,'positive build number');
assert.ok(Number.isInteger(release.schemaVersion) && release.schemaVersion>0,'positive schema version');

const index=fs.readFileSync('index.html','utf8');
const appShell=fs.readFileSync('js/app-shell.js','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');
const schema=fs.readFileSync('supabase/005_schema_contract.sql','utf8');

assert.match(index,new RegExp(`<script src="app-version\\.js\\?v=${release.build}"><\\/script>`),'page loads current release metadata');
assert.match(appShell,/service-worker\.js\?v=['"`]\+release\.build/,'worker registration uses release build');
assert.match(worker,new RegExp(`importScripts\\('\\.\\/app-version\\.js\\?v=${release.build}'\\)`),'worker loads current release metadata');
assert.match(worker,/const VERSION='v'\+RELEASE\.build/,'cache uses release build');
assert.match(schema,new RegExp(`select ${release.schemaVersion}::integer`),'database contract matches app');

const versionedAssets=[
  'cloud-sync.js','js/audio-runtime.js','js/core.js','js/metronome.js','js/tuner.js','js/scales.js',
  'js/ear-trainer.js','js/rhythm-trainer.js','js/jam-session.js','js/app-shell.js',
];
for(const asset of versionedAssets){
  const escaped=asset.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(index,new RegExp(`src="${escaped}\\?v=${release.build}"`),`${asset} page version`);
  assert.match(worker,new RegExp(`'\\.\\/${escaped}\\?v=${release.build}'`),`${asset} cache version`);
}

console.log(`release checks passed: v${release.version} build ${release.build} schema ${release.schemaVersion}`);

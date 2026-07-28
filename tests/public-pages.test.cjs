const assert=require('node:assert/strict');
const fs=require('node:fs');

const read=file=>fs.readFileSync(file,'utf8');

const index=read('index.html');
const about=read('about.html');
const privacy=read('privacy.html');
const terms=read('terms.html');
const worker=read('service-worker.js');
const manifest=JSON.parse(read('manifest.json'));
const sitemap=read('sitemap.xml');

for(const [label,html] of Object.entries({index,about,privacy,terms})){
  assert.match(html,/lang="ko"/,`${label}: Korean language declaration`);
  assert.match(html,/og:image/,`${label}: social preview image`);
}

for(const href of ['about.html','privacy.html','terms.html']){
  assert.match(index,new RegExp(`href="${href}"`),`index links ${href}`);
  assert.match(worker,new RegExp(`'\\./${href}'`),`service worker caches ${href}`);
  assert.match(sitemap,new RegExp(`/O-live/${href}`),`sitemap lists ${href}`);
}

assert.match(about,/Google 계정 연결은 선택 사항/);
assert.match(about,/마이크로 음정을 확인/);
assert.match(privacy,/마이크 오디오는 음정을 계산하기 위해/);
assert.match(privacy,/Google API 서비스 사용자 데이터 정책/);
assert.match(privacy,/데이터%20삭제%20요청/);
assert.match(privacy,/클라우드 데이터 삭제/);
assert.match(privacy,/계정 삭제/);
assert.match(privacy,/개인정보의 국외 이전/);
assert.match(privacy,/싱가포르/);
assert.match(privacy,/90일이 지나면 자동 삭제/);
assert.match(privacy,/O’live \(OliveMusic\)/);
assert.match(terms,/개인정보처리방침/);
assert.match(index,/service-worker\.js\?v=103/);
assert.match(index,/cloud-sync\.js\?v=97/);
assert.match(worker,/const VERSION = 'v103'/);
assert.match(worker,/url\.origin !== self\.location\.origin/);
assert.match(worker,/documentUrl\.search = ''/);
assert.doesNotMatch(worker,/addAll\(ASSETS\)\)\.catch/);
assert.match(worker,/'\.\/og\.png'/);
assert.equal(manifest.id,'./');
assert.equal(manifest.start_url,'./');

assert.match(index,/id="startupSplash"/);
assert.match(index,/<svg class="startup-splash-icon" viewBox="0 0 16 16"/);
assert.match(index,/nav\.tabbar button\.sounding::after[\s\S]*left:50%; top:50%; width:60px; height:40px;/);
assert.match(index,/nav\.tabbar button\.sounding::after[\s\S]*background:radial-gradient\(ellipse at center,/);
assert.match(index,/rgba\(var\(--signal-rgb\),0\) 100%/);
assert.doesNotMatch(index,/nav\.tabbar button\.sounding::after[\s\S]{0,500}filter:blur/);
assert.doesNotMatch(index,/startup-splash-icon" src=/);
assert.match(index,/const stateKey='olive-startup-state-v2'/);
assert.match(index,/const minimumVisibleMs=1500/);
assert.match(index,/window\.addEventListener\('load',leaveWhenReady,\{once:true\}\)/);
assert.match(index,/html\.skip-startup \.startup-splash\{display:none;\}/);
assert.match(index,/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\.startup-splash/);

console.log('public pages tests passed');

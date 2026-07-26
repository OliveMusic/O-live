const assert=require('node:assert/strict');
const fs=require('node:fs');

const index=fs.readFileSync('index.html','utf8');

// 잼 진행의 시각적 크기는 원본을 유지한다.
assert.match(index,/\.prog-bar \.stp\{[\s\S]*?width:19px; height:19px;/);

// 밀집된 진행 카드에서는 조절 버튼의 터치 영역을 32×32px로 유지한다.
assert.match(
  index,
  /\.prog-bar \.stp::after\{[\s\S]*?width:32px; height:32px;/,
);

// 코드 이름은 외형을 키우지 않고 44×32px의 별도 터치 영역을 갖는다.
assert.match(
  index,
  /\.prog-bar \.nm::after\{[\s\S]*?width:44px; height:32px;/,
);
// 진행 코드 이름은 포인터 전용 role이 아니라 실제 버튼이어야 한다.
assert.match(
  index,
  /<button type="button" class="nm" aria-label="\$\{c\.name\}, 3화음과 7화음 전환"/,
);
assert.match(index,/<button type="button" class="stp" data-act="dec"/);
assert.match(index,/<button type="button" class="stp" data-act="inc"/);

// 코드 팔레트 +는 사용자가 선택한 더 작은 38px 영역을 보존한다.
assert.match(
  index,
  /\.chord-cell \.cc-add\{[\s\S]*?width:38px; height:38px;/,
);
assert.match(index,/<button type="button" class="chord-preview" aria-label="\$\{c\.name\} 코드 미리 듣기">/);
assert.match(index,/<button type="button" class="cc-add" aria-label="\$\{c\.name\} 진행에 추가">/);
assert.doesNotMatch(index,/<span class="cc-add" role="button"/);

// 짧은 텍스트 버튼은 외형을 해치지 않으면서 44pt 터치 높이를 확보한다.
assert.match(
  index,
  /\.link-btn\{[\s\S]*?min-width:44px; min-height:44px;/,
);

// 밀집된 리듬 템포 조작부는 사용자가 선호한 절충값인 40px 높이를 사용한다.
assert.match(
  index,
  /\.rhy-keys \.key\{[\s\S]*?height:40px;[\s\S]*?min-width:44px;/,
);

assert.match(index,/\.pill\{[\s\S]*?min-height:40px;/);
assert.match(index,/\.btn\{[\s\S]*?min-height:40px;/);
assert.match(index,/\.dd-btn\{[\s\S]*?min-height:44px;/);
assert.match(index,/input\[type=range\]\{[\s\S]*?height:44px;/);

// 긴 잼 진행은 실제 화면 좌표로 활성 마디를 가운데에 두고, 마디가 바뀔 때만 따라간다.
assert.match(index,/function revealActiveBar\(cur\)\{/);
assert.match(index,/const viewRect=view\.getBoundingClientRect\(\)/);
assert.match(index,/const curRect=cur\.getBoundingClientRect\(\)/);
assert.match(index,/const viewCenter=viewRect\.left \+ viewRect\.width\/2/);
assert.match(index,/const curCenter=curRect\.left \+ curRect\.width\/2/);
assert.match(index,/const next=view\.scrollLeft \+ \(curCenter - viewCenter\)/);
assert.match(index,/if\(m\.barIdx!==visualBarIdx\)\{/);
assert.match(index,/view\.scrollTo\(\{left:want, behavior\}\)/);
assert.doesNotMatch(index,/cur\.offsetLeft - \(view\.clientWidth - cur\.offsetWidth\)\/2/);

console.log('touch target tests passed');

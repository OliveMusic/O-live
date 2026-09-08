/* ===================== 연습 링크 =====================
   YouTube에서 곡을 찾아 공식 IFrame 플레이어로 틀어 놓고 연습한다.

   지켜야 하는 것:
   - 영상을 내려받거나 오디오만 분리하지 않는다. 항상 공식 플레이어를 화면에 보인다.
   - YouTube API 개발자 정책상 제목·채널명은 30일 안에 갱신하거나 지워야 하므로
     클라우드에는 video_id와 사용자가 정한 별칭, 연습 설정만 남긴다.
   - 검색은 명시적인 동작에서만 보낸다. 하루 100회뿐인 할당량을 입력 중에 태우지 않는다. */
(function(){
  'use strict';

  const IFRAME_API_SRC='https://www.youtube.com/iframe_api';
  const PLAYER_HOST='https://www.youtube-nocookie.com';
  const MIN_QUERY_LENGTH=2;
  const MAX_TITLE_LENGTH=80;
  const STATE_SAVE_DELAY=1200;
  const TICK_MS=250;
  const CHECK_TIMEOUT_MS=8000;

  const linkPanel=document.getElementById('linkPanel');
  const linkButton=document.getElementById('recordLink');
  const modeSearch=document.getElementById('linkModeSearch');
  const modeUrl=document.getElementById('linkModeUrl');
  const searchForm=document.getElementById('linkSearchForm');
  const urlForm=document.getElementById('linkUrlForm');
  const searchInput=document.getElementById('linkSearchInput');
  const searchGo=document.getElementById('linkSearchGo');
  const urlInput=document.getElementById('linkUrlInput');
  const urlGo=document.getElementById('linkUrlGo');
  const message=document.getElementById('linkMessage');
  const results=document.getElementById('linkResults');
  const list=document.getElementById('recordLinkList');
  const listCard=document.getElementById('recordListCard');
  const menuBackdrop=document.getElementById('linkMenuBackdrop');
  const menuTitle=document.getElementById('linkMenuTitle');
  const menuRename=document.getElementById('linkMenuRename');
  const menuDelete=document.getElementById('linkMenuDelete');
  const app=document.getElementById('app');

  if(!linkPanel || !linkButton || !list) return;

  let currentUser=null;
  let rows=[];
  let loading=false;
  let expandedId='';
  let player=null;
  let playerVideoId='';
  let playerReady=false;
  let playing=false;
  let ticker=0;
  let saveTimer=0;
  let pendingState=null;
  let apiPromise=null;
  let searching=false;
  let selectedRow=null;
  let menuTrigger=null;
  const searchCache=new Map();
  const loopState=new Map();

  function setMessage(text,isError){
    message.textContent=text||'';
    message.classList.toggle('error',Boolean(isError));
  }
  function formatDuration(ms){
    const total=Math.max(0,Math.round(Number(ms)||0)/1000);
    const minutes=Math.floor(total/60);
    const seconds=Math.floor(total%60);
    return `${minutes}:${String(seconds).padStart(2,'0')}`;
  }
  /* 다양한 YouTube 주소 형태에서 11자리 영상 ID만 뽑는다. */
  function extractVideoId(raw){
    const text=String(raw||'').trim();
    if(!text) return '';
    if(/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
    let url;
    try{ url=new URL(text.includes('://')?text:`https://${text}`); }
    catch(e){ return ''; }
    if(!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(url.hostname)) return '';
    const fromQuery=url.searchParams.get('v')||'';
    if(/^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
    const parts=url.pathname.split('/').filter(Boolean);
    const last=parts[parts.length-1]||'';
    if(/^[A-Za-z0-9_-]{11}$/.test(last)) return last;
    return '';
  }

  /* ── IFrame Player API ── */
  function loadApi(){
    if(apiPromise) return apiPromise;
    apiPromise=new Promise((resolve,reject)=>{
      if(window.YT && window.YT.Player) return resolve(window.YT);
      const previous=window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady=function(){
        if(typeof previous==='function'){ try{ previous(); }catch(e){} }
        resolve(window.YT);
      };
      const script=document.createElement('script');
      script.src=IFRAME_API_SRC;
      script.async=true;
      script.onerror=()=>reject(new Error('iframe_api'));
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  /* YouTube IFrame 오류 코드. 150/101은 소유자나 레이블이 외부 재생을 막은 경우로
     음악 레이블 공식 영상에서 매우 흔하다. API의 videoEmbeddable 필터로는 걸러지지
     않고 재생 시점에야 드러난다. */
  function describePlayerError(code){
    switch(Number(code)){
      case 2: return '영상 주소가 올바르지 않습니다';
      case 5: return '이 브라우저에서 재생할 수 없는 영상입니다';
      case 100: return '삭제되었거나 비공개로 바뀐 영상입니다';
      case 101:
      case 150: return '소유자가 외부 재생을 막아 둔 영상입니다. YouTube에서는 볼 수 있지만 O’live 안에서는 재생할 수 없습니다';
      default: return '영상을 재생할 수 없습니다';
    }
  }
  /* 저장하기 전에 실제로 임베드 재생이 되는지 확인한다. 되지 않는 영상을 목록에
     쌓아 두지 않기 위해서다. 성공하면 길이도 함께 받아 온다. */
  function checkEmbeddable(videoId){
    return new Promise(async resolve=>{
      try{ await loadApi(); }
      catch(e){ return resolve({ok:false,code:'api'}); }
      const host=document.createElement('div');
      host.setAttribute('aria-hidden','true');
      host.style.cssText='position:absolute;left:-9999px;top:0;width:320px;height:180px;pointer-events:none';
      document.body.appendChild(host);
      const mount=document.createElement('div');
      host.appendChild(mount);
      let settled=false;
      let probe=null;
      const finish=result=>{
        if(settled) return;
        settled=true;
        try{ if(probe) probe.destroy(); }catch(e){}
        host.remove();
        resolve(result);
      };
      probe=new window.YT.Player(mount,{
        videoId,
        host:PLAYER_HOST,
        playerVars:{playsinline:1,rel:0,modestbranding:1,origin:location.origin},
        events:{
          onReady(){
            let duration=0;
            try{ duration=Math.round((probe.getDuration()||0)*1000); }catch(e){}
            finish({ok:true,durationMs:duration});
          },
          onError(event){ finish({ok:false,code:event&&event.data}); },
        },
      });
      /* 확인이 지연되면 막지 않고 그대로 저장한다. */
      setTimeout(()=>finish({ok:true,durationMs:0}),CHECK_TIMEOUT_MS);
    });
  }

  /* Number(null)은 0이고 Number.isFinite(0)은 참이다. 그대로 쓰면 지정된 적 없는
     A/B가 0:00에 찍힌 것처럼 보인다. 빈 값을 먼저 걸러야 한다. */
  function msOrNull(value){
    if(value===null || value===undefined || value==='') return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }
  function loopFor(row){
    if(loopState.has(row.id)) return loopState.get(row.id);
    const state={
      a:msOrNull(row.loop_a_ms),
      b:msOrNull(row.loop_b_ms),
      enabled:Boolean(row.loop_enabled),
    };
    loopState.set(row.id,state);
    return state;
  }
  function queueStateSave(row){
    const loop=loopFor(row);
    pendingState={
      id:row.id,
      position:playerReady && player?Math.round(player.getCurrentTime()*1000):Number(row.last_position_ms)||0,
      duration:playerReady && player?Math.round(player.getDuration()*1000):Number(row.duration_ms)||0,
      loopA:loop.a,loopB:loop.b,loopEnabled:loop.enabled,
      rate:Number(row.playback_rate)||1,
    };
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer=setTimeout(flushState,STATE_SAVE_DELAY);
  }
  async function flushState(){
    saveTimer=0;
    const state=pendingState;
    pendingState=null;
    if(!state || !currentUser) return;
    try{
      await window.OliveCloud.savePracticeLinkState(state.id,state);
      const row=rows.find(item=>item.id===state.id);
      if(row){
        row.last_position_ms=state.position;
        row.loop_a_ms=state.loopA; row.loop_b_ms=state.loopB;
        row.loop_enabled=state.loopEnabled;
        if(state.duration>0) row.duration_ms=state.duration;
      }
    }catch(e){ /* 연습 설정 저장 실패는 재생을 막지 않는다. */ }
  }

  function stopTicker(){
    if(ticker){ clearInterval(ticker); ticker=0; }
  }
  function startTicker(){
    stopTicker();
    ticker=setInterval(onTick,TICK_MS);
  }
  function onTick(){
    if(!player || !playerReady) return;
    const row=rows.find(item=>item.id===expandedId);
    if(!row) return;
    let position=0;
    try{ position=player.getCurrentTime()*1000; }catch(e){ return; }
    const loop=loopFor(row);
    if(loop.enabled && loop.a!==null && loop.b!==null && position>=loop.b){
      try{ player.seekTo(loop.a/1000,true); }catch(e){}
      position=loop.a;
    }
    updateTimes(row,position);
    updateTrack(row,position);
  }
  function updateTimes(row,position){
    const elapsed=list.querySelector(`#link-player-${row.id} .record-player-elapsed`);
    if(elapsed) elapsed.textContent=formatDuration(position);
  }

  function destroyPlayer(){
    stopTicker();
    playing=false;
    playerReady=false;
    playerVideoId='';
    if(player){
      try{ player.destroy(); }catch(e){}
      player=null;
    }
  }
  function stopPlayback(){
    if(!player || !playerReady) return;
    try{ player.pauseVideo(); }catch(e){}
    playing=false;
    stopTicker();
  }
  function isPlaying(){ return Boolean(playing); }

  async function mountPlayer(row,host){
    try{ await loadApi(); }
    catch(e){
      host.textContent='';
      const failed=document.createElement('p');
      failed.className='record-empty';
      failed.textContent='YouTube 플레이어를 불러오지 못했습니다';
      host.appendChild(failed);
      return;
    }
    if(expandedId!==row.id || !host.isConnected) return;
    destroyPlayer();
    playerVideoId=row.video_id;
    const mount=document.createElement('div');
    host.textContent='';
    host.appendChild(mount);
    player=new window.YT.Player(mount,{
      videoId:row.video_id,
      host:PLAYER_HOST,
      playerVars:{
        playsinline:1,
        rel:0,
        modestbranding:1,
        origin:location.origin,
      },
      events:{
        onReady(){
          playerReady=true;
          const start=Number(row.last_position_ms)||0;
          if(start>1000){ try{ player.seekTo(start/1000,true); }catch(e){} }
          const duration=Math.round((player.getDuration()||0)*1000);
          if(duration>0 && duration!==Number(row.duration_ms)){
            row.duration_ms=duration;
            const total=list.querySelector(`#link-player-${row.id} .link-total`);
            if(total) total.textContent=formatDuration(duration);
            queueStateSave(row);
          }
          /* 길이를 알고 나서야 A/B 구간을 올바른 비율로 그릴 수 있다. */
          refreshLoopUi(row);
          renderTicks(row);
          updateTrack(row,start);
        },
        onError(event){
          const host2=list.querySelector(`#link-player-${row.id} .link-frame`);
          if(!host2) return;
          host2.textContent='';
          const notice=document.createElement('p');
          notice.className='link-player-error';
          notice.textContent=describePlayerError(event&&event.data);
          host2.appendChild(notice);
          playerReady=false;
          stopTicker();
        },
        onStateChange(event){
          const YT=window.YT;
          if(!YT || !YT.PlayerState) return;
          if(event.data===YT.PlayerState.PLAYING){
            playing=true;
            /* 저장 녹음 재생과 같은 취급이다. 다른 재생은 정리한다. */
            if(window.OliveRecorder && typeof window.OliveRecorder.stopPlayback==='function'){
              window.OliveRecorder.stopPlayback();
            }
            startTicker();
          }else{
            playing=false;
            stopTicker();
            if(event.data===YT.PlayerState.PAUSED || event.data===YT.PlayerState.ENDED){
              queueStateSave(row);
            }
          }
        },
      },
    });
  }

  function setLoopPoint(row,which){
    if(!player || !playerReady) return;
    let position=0;
    try{ position=Math.round(player.getCurrentTime()*1000); }catch(e){ return; }
    const loop=loopFor(row);
    if(which==='a') loop.a=position; else loop.b=position;
    if(loop.a!==null && loop.b!==null && loop.b<=loop.a){
      /* 뒤집힌 구간은 의미가 없다. 늦게 찍은 쪽을 살린다. */
      if(which==='a') loop.b=null; else loop.a=null;
    }
    /* 두 지점이 모두 찍히면 곧바로 반복을 시작한다. B를 현재 위치에 찍으면
       다음 틱에서 바로 A로 되돌아간다. */
    loop.enabled=loop.a!==null && loop.b!==null;
    queueStateSave(row);
    refreshLoopUi(row);
  }
  function toggleLoop(row){
    const loop=loopFor(row);
    if(loop.a===null || loop.b===null) return;
    loop.enabled=!loop.enabled;
    queueStateSave(row);
    refreshLoopUi(row);
  }
  function clearLoop(row){
    const loop=loopFor(row);
    loop.a=null; loop.b=null; loop.enabled=false;
    queueStateSave(row);
    refreshLoopUi(row);
  }

  function rowDurationMs(row){
    return Math.max(0,Number(row&&row.duration_ms)||0);
  }
  /* YouTube 진행바는 iframe 안이라 A/B를 그릴 수 없다. 아래에 O'live 트랙을 두고
     녹음 플레이어와 같은 구간·마커 클래스를 써서 위치를 보여준다. */
  /* 파형을 만들 수 없으므로 시간 눈금으로 위치 감각을 준다.
     눈금이 12개를 넘지 않는 간격을 고른다. */
  function tickIntervalMs(duration){
    const steps=[10000,15000,30000,60000,120000,300000,600000,1800000];
    for(const step of steps){ if(duration/step<=12) return step; }
    return 3600000;
  }
  function renderTicks(row){
    const track=list.querySelector(`#link-player-${row.id} .link-track`);
    if(!track) return;
    const holder=track.querySelector('.link-track-ticks');
    if(!holder) return;
    holder.textContent='';
    const duration=rowDurationMs(row);
    if(duration<=0) return;
    const step=tickIntervalMs(duration);
    for(let at=step; at<duration; at+=step){
      const tick=document.createElement('span');
      tick.className='link-track-tick';
      tick.style.left=`${at/duration*100}%`;
      holder.appendChild(tick);
    }
  }
  function createTrack(row){
    const wrap=document.createElement('div');
    wrap.className='record-waveform-wrap link-track-wrap';
    const track=document.createElement('div');
    track.className='record-waveform link-track';
    track.tabIndex=0;
    track.setAttribute('role','slider');
    track.setAttribute('aria-label',`${row.title} 재생 위치`);
    const loop=loopFor(row);
    const duration=rowDurationMs(row);
    if(loop.a!==null) track.style.setProperty('--loop-start',`${duration?loop.a/duration*100:0}%`);
    if(loop.b!==null) track.style.setProperty('--loop-end',`${duration?loop.b/duration*100:0}%`);
    track.classList.toggle('has-loop-start',loop.a!==null);
    track.classList.toggle('has-loop-end',loop.b!==null);
    track.classList.toggle('looping',Boolean(loop.enabled));
    const ticks=document.createElement('span'); ticks.className='link-track-ticks';
    const region=document.createElement('span'); region.className='record-loop-region';
    const line=document.createElement('span'); line.className='link-track-line';
    const fill=document.createElement('span'); fill.className='link-track-fill';
    line.appendChild(fill);
    const markerA=document.createElement('span');
    markerA.className='record-loop-marker start'; markerA.dataset.label='A';
    const markerB=document.createElement('span');
    markerB.className='record-loop-marker end'; markerB.dataset.label='B';
    track.append(ticks,region,line,markerA,markerB);
    const seek=event=>{
      if(!player || !playerReady) return;
      const rect=track.getBoundingClientRect();
      if(!rect.width) return;
      const ratio=Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width));
      const target=rowDurationMs(row)*ratio;
      try{ player.seekTo(target/1000,true); }catch(e){}
      updateTrack(row,target);
    };
    track.addEventListener('pointerdown',event=>{
      track.setPointerCapture(event.pointerId);
      seek(event);
    });
    track.addEventListener('pointermove',event=>{
      if(track.hasPointerCapture(event.pointerId)) seek(event);
    });
    wrap.appendChild(track);
    return wrap;
  }
  function updateTrack(row,position){
    const track=list.querySelector(`#link-player-${row.id} .link-track`);
    if(!track) return;
    const duration=rowDurationMs(row);
    track.style.setProperty('--wave-progress',`${duration?Math.min(100,position/duration*100):0}%`);
    track.setAttribute('aria-valuenow',String(Math.round(position/1000)));
    track.setAttribute('aria-valuetext',formatDuration(position));
  }

  /* A/B를 누를 때마다 목록을 다시 그리면 플레이어가 새로 만들어져 영상이 처음부터
     다시 시작한다. 상태만 제자리에서 갱신한다. */
  function refreshLoopUi(row){
    const wrap=list.querySelector(`#link-player-${row.id}`);
    if(!wrap) return;
    const loop=loopFor(row);
    const duration=rowDurationMs(row);
    const pct=value=>`${duration&&value!==null?Math.min(100,value/duration*100):0}%`;
    const track=wrap.querySelector('.link-track');
    if(track){
      track.style.setProperty('--loop-start',pct(loop.a));
      track.style.setProperty('--loop-end',pct(loop.b));
      track.classList.toggle('has-loop-start',loop.a!==null);
      track.classList.toggle('has-loop-end',loop.b!==null);
      track.classList.toggle('looping',Boolean(loop.enabled));
    }
    const pointA=wrap.querySelector('[data-role="a"]');
    if(pointA){
      pointA.classList.toggle('active',loop.a!==null);
      pointA.setAttribute('aria-label',loop.a===null?'현재 위치를 A 지점으로 지정':`A 지점 ${formatDuration(loop.a)}, 다시 지정`);
    }
    const pointB=wrap.querySelector('[data-role="b"]');
    if(pointB){
      pointB.classList.toggle('active',loop.b!==null);
      pointB.setAttribute('aria-label',loop.b===null?'현재 위치를 B 지점으로 지정':`B 지점 ${formatDuration(loop.b)}, 다시 지정`);
    }
    const repeat=wrap.querySelector('[data-role="repeat"]');
    if(repeat){
      repeat.classList.toggle('active',Boolean(loop.enabled));
      repeat.disabled=loop.a===null || loop.b===null;
      repeat.setAttribute('aria-pressed',String(Boolean(loop.enabled)));
      repeat.setAttribute('aria-label',loop.enabled?'구간 반복 끄기':'A/B 구간 반복 켜기');
    }
    const clear=wrap.querySelector('[data-role="clear"]');
    if(clear) clear.disabled=loop.a===null && loop.b===null;
    const loopTimes=wrap.querySelector('.link-loop-times');
    if(loopTimes){
      const parts=[];
      if(loop.a!==null) parts.push(`A ${formatDuration(loop.a)}`);
      if(loop.b!==null) parts.push(`B ${formatDuration(loop.b)}`);
      if(parts.length && loop.a!==null && loop.b!==null){
        parts.push(`구간 ${formatDuration(loop.b-loop.a)}`);
      }
      loopTimes.textContent=parts.join(' · ');
    }
  }

  function createPlayer(row){
    const wrap=document.createElement('div');
    wrap.className='link-player';
    wrap.id=`link-player-${row.id}`;
    const frame=document.createElement('div');
    frame.className='link-frame';
    wrap.appendChild(frame);
    const timeline=createTrack(row);
    wrap.appendChild(timeline);
    const controls=document.createElement('div');
    controls.className='link-player-controls';
    const loop=loopFor(row);
    const tools=document.createElement('div');
    tools.className='record-loop-tools';
    const pointA=document.createElement('button');
    pointA.type='button';
    pointA.className='record-player-tool point'+(loop.a!==null?' active':'');
    pointA.dataset.role='a';
    pointA.textContent='A';
    pointA.setAttribute('aria-label',loop.a===null?'현재 위치를 A 지점으로 지정':`A 지점 ${formatDuration(loop.a)}, 다시 지정`);
    pointA.addEventListener('click',()=>setLoopPoint(row,'a'));
    const pointB=document.createElement('button');
    pointB.type='button';
    pointB.className='record-player-tool point'+(loop.b!==null?' active':'');
    pointB.dataset.role='b';
    pointB.textContent='B';
    pointB.setAttribute('aria-label',loop.b===null?'현재 위치를 B 지점으로 지정':`B 지점 ${formatDuration(loop.b)}, 다시 지정`);
    pointB.addEventListener('click',()=>setLoopPoint(row,'b'));
    const repeat=document.createElement('button');
    repeat.type='button';
    repeat.dataset.role='repeat';
    repeat.className='record-player-tool icon repeat'+(loop.enabled?' active':'');
    repeat.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 8A7 7 0 0 0 6.4 5.6L4.5 7.5M4.5 7.5V3.8M4.5 7.5h3.7M5.5 16A7 7 0 0 0 17.6 18.4l1.9-1.9M19.5 16.5v3.7M19.5 16.5h-3.7"/></svg>';
    repeat.setAttribute('aria-label',loop.enabled?'구간 반복 끄기':'A/B 구간 반복 켜기');
    repeat.setAttribute('aria-pressed',String(loop.enabled));
    repeat.disabled=loop.a===null || loop.b===null;
    repeat.addEventListener('click',()=>toggleLoop(row));
    const clear=document.createElement('button');
    clear.type='button';
    clear.dataset.role='clear';
    clear.className='record-player-tool icon clear';
    clear.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
    clear.setAttribute('aria-label','A/B 지점 지우기');
    clear.disabled=loop.a===null && loop.b===null;
    clear.addEventListener('click',()=>clearLoop(row));
    tools.append(pointA,pointB,repeat,clear);
    const times=document.createElement('div');
    times.className='record-player-times link-player-times';
    const elapsed=document.createElement('span');
    elapsed.className='record-player-elapsed';
    elapsed.textContent=formatDuration(row.last_position_ms);
    const divider=document.createElement('span');
    divider.className='link-time-divider';
    divider.setAttribute('aria-hidden','true');
    divider.textContent='/';
    const total=document.createElement('span');
    total.className='link-total';
    total.textContent=formatDuration(row.duration_ms);
    times.append(elapsed,divider,total);
    timeline.appendChild(times);
    const loopTimes=document.createElement('p');
    loopTimes.className='link-loop-times';
    controls.append(tools,loopTimes);
    wrap.appendChild(controls);
    mountPlayer(row,frame);
    return wrap;
  }

  function toggleExpanded(row){
    if(expandedId===row.id){
      expandedId='';
      queueStateSave(row);
      destroyPlayer();
      renderList();
      return;
    }
    expandedId=row.id;
    destroyPlayer();
    renderList();
  }

  function renderList(){
    list.textContent='';
    notifyCountChanged();
    if(!currentUser) return;
    if(loading && !rows.length){
      const state=document.createElement('p');
      state.className='record-empty';
      state.textContent='연습 링크를 불러오는 중입니다';
      list.appendChild(state);
      return;
    }
    rows.forEach(row=>{
      const entry=document.createElement('div');
      entry.className='record-entry';
      const item=document.createElement('div');
      item.className='record-row';
      const open=document.createElement('button');
      open.type='button';
      open.className='record-row-open';
      open.setAttribute('aria-expanded',expandedId===row.id?'true':'false');
      open.setAttribute('aria-controls',`link-player-${row.id}`);
      open.setAttribute('aria-label',`${row.title} 링크 ${expandedId===row.id?'접기':'열기'}`);
      const copy=document.createElement('span');
      copy.className='record-row-copy';
      const title=document.createElement('strong');
      title.textContent=row.title;
      const source=document.createElement('small');
      source.textContent='YouTube';
      copy.append(title,source);
      const duration=document.createElement('span');
      duration.className='record-row-duration';
      duration.textContent=Number(row.duration_ms)>0?formatDuration(row.duration_ms):'';
      open.append(copy,duration);
      open.addEventListener('click',()=>toggleExpanded(row));
      const more=document.createElement('button');
      more.type='button';
      more.className='record-row-more';
      more.textContent='•••';
      more.setAttribute('aria-label',`${row.title} 메뉴`);
      more.addEventListener('click',()=>openMenu(row,more));
      item.append(open,more);
      entry.appendChild(item);
      if(expandedId===row.id) entry.appendChild(createPlayer(row));
      list.appendChild(entry);
    });
  }

  function notifyCountChanged(){
    document.dispatchEvent(new CustomEvent('olive-practice-links-change'));
  }

  /* ── 목록 ── */
  async function loadLinks(force){
    if(!currentUser) return;
    if(loading && !force) return;
    loading=true;
    renderList();
    try{
      rows=await window.OliveCloud.listPracticeLinks();
      loopState.clear();
    }catch(e){
      rows=[];
    }finally{
      loading=false;
      renderList();
    }
  }

  /* ── 메뉴 ── */
  function openMenu(row,trigger){
    selectedRow=row; menuTrigger=trigger;
    menuTitle.textContent=row.title;
    if(app) app.setAttribute('inert','');
    menuBackdrop.hidden=false;
    requestAnimationFrame(()=>menuBackdrop.classList.add('open'));
    document.body.classList.add('record-menu-open');
    setTimeout(()=>menuRename.focus(),50);
  }
  function closeMenu(){
    menuBackdrop.classList.remove('open');
    document.body.classList.remove('record-menu-open');
    setTimeout(()=>{
      if(menuBackdrop.classList.contains('open')) return;
      menuBackdrop.hidden=true;
      if(app) app.removeAttribute('inert');
      if(menuTrigger && menuTrigger.isConnected) menuTrigger.focus();
      menuTrigger=null;
    },220);
  }
  async function renameSelected(){
    const row=selectedRow; closeMenu();
    if(!row) return;
    const next=window.prompt('링크 이름',row.title);
    if(next===null || !next.trim() || next.trim()===row.title) return;
    try{
      await window.OliveCloud.renamePracticeLink(row.id,next.trim().slice(0,MAX_TITLE_LENGTH));
      await loadLinks(true);
    }catch(e){ setMessage('이름을 바꾸지 못했습니다',true); }
  }
  async function deleteSelected(){
    const row=selectedRow; closeMenu();
    if(!row) return;
    if(!window.confirm(`“${row.title}” 링크를 삭제할까요?\n다른 기기에서도 사라집니다.`)) return;
    try{
      if(expandedId===row.id){ expandedId=''; destroyPlayer(); }
      await window.OliveCloud.deletePracticeLink(row.id);
      await loadLinks(true);
    }catch(e){ setMessage('링크를 삭제하지 못했습니다',true); }
  }

  /* ── 패널 ── */
  function setMode(mode){
    const isSearch=mode!=='url';
    modeSearch.classList.toggle('active',isSearch);
    modeUrl.classList.toggle('active',!isSearch);
    modeSearch.setAttribute('aria-selected',String(isSearch));
    modeUrl.setAttribute('aria-selected',String(!isSearch));
    searchForm.hidden=!isSearch;
    urlForm.hidden=isSearch;
    setMessage('');
    results.textContent='';
    setTimeout(()=>{ (isSearch?searchInput:urlInput).focus(); },30);
  }
  function togglePanel(){
    const open=linkPanel.hidden;
    linkPanel.hidden=!open;
    linkButton.setAttribute('aria-expanded',String(open));
    if(open){ setMode('search'); }
    else{ setMessage(''); results.textContent=''; }
  }

  function describeSearchError(code){
    switch(code){
      case 'search_unavailable': return '검색이 아직 설정되지 않았습니다. URL을 붙여넣어 추가할 수 있어요';
      case 'rate_limited': return '오늘 검색을 많이 사용했습니다. URL을 붙여넣어 추가할 수 있어요';
      case 'quota_exhausted': return '오늘 검색 한도를 모두 썼습니다. URL을 붙여넣어 추가할 수 있어요';
      case 'query_too_short': return '두 글자 이상 입력해 주세요';
      case 'query_too_long': return '검색어가 너무 깁니다';
      case 'upstream_timeout': return '검색이 지연되고 있습니다. 잠시 뒤 다시 시도해 주세요';
      case 'quota_check_failed': return '검색 사용량을 확인하지 못했습니다 · SEARCH-QUOTA';
      case 'upstream_error': return '검색 서버가 응답하지 않았습니다 · SEARCH-UPSTREAM';
      case 'invalid_request': return '검색 요청이 거절되었습니다 · SEARCH-REQUEST';
      case 'invalid_session': return '다시 로그인한 뒤 시도해 주세요';
      case 'server_misconfigured': return '서버 설정이 완료되지 않았습니다 · SEARCH-CONFIG';
      /* 어느 단계에서 막혔는지 알 수 있게 코드를 그대로 남긴다. */
      default: return `검색하지 못했습니다 · ${code||'UNKNOWN'} · URL을 붙여넣어 추가할 수 있어요`;
    }
  }

  function renderResults(items){
    results.textContent='';
    if(!items.length){
      setMessage('검색 결과가 없습니다. URL을 붙여넣어 추가할 수 있어요');
      return;
    }
    items.forEach(item=>{
      const row=document.createElement('button');
      row.type='button';
      row.className='link-result';
      const thumb=document.createElement('img');
      thumb.className='link-thumb';
      thumb.alt='';
      thumb.loading='lazy';
      thumb.referrerPolicy='no-referrer';
      if(item.thumbnail) thumb.src=item.thumbnail;
      const copy=document.createElement('span');
      copy.className='link-result-copy';
      const title=document.createElement('span');
      title.className='link-result-title';
      title.textContent=item.title;
      const channel=document.createElement('span');
      channel.className='link-result-channel';
      channel.textContent=item.channelTitle;
      copy.append(title,channel);
      row.append(thumb,copy);
      row.addEventListener('click',()=>addLink(item.videoId,item.title));
      results.appendChild(row);
    });
    const source=document.createElement('p');
    source.className='link-source';
    source.textContent='YouTube 검색 결과';
    results.appendChild(source);
  }

  async function runSearch(){
    if(searching) return;
    const query=searchInput.value.trim();
    if(query.length<MIN_QUERY_LENGTH){ setMessage('두 글자 이상 입력해 주세요',true); return; }
    if(searchCache.has(query)){ setMessage(''); renderResults(searchCache.get(query)); return; }
    searching=true;
    searchGo.disabled=true;
    setMessage('검색하는 중입니다');
    results.textContent='';
    try{
      const response=await window.OliveCloud.searchYouTube(query);
      searchCache.set(query,response.results);
      setMessage('');
      renderResults(response.results);
    }catch(error){
      console.warn('[O\'live youtube search]',error&&error.code,error&&error.message);
      setMessage(describeSearchError(error&&error.code),true);
    }finally{
      searching=false;
      searchGo.disabled=false;
    }
  }

  async function addLink(videoId,suggestedTitle){
    if(!videoId){ setMessage('YouTube 주소를 확인해 주세요',true); return; }
    const preset=String(suggestedTitle||'').trim().slice(0,MAX_TITLE_LENGTH);
    const title=window.prompt('링크 이름',preset||'무제');
    if(title===null) return;
    const trimmed=title.trim().slice(0,MAX_TITLE_LENGTH)||'무제';
    setMessage('재생할 수 있는 영상인지 확인하는 중입니다');
    const check=await checkEmbeddable(videoId);
    if(!check.ok){
      setMessage(describePlayerError(check.code),true);
      return;
    }
    setMessage('링크를 저장하는 중입니다');
    try{
      await window.OliveCloud.savePracticeLink(videoId,trimmed,check.durationMs||0);
      linkPanel.hidden=true;
      linkButton.setAttribute('aria-expanded','false');
      results.textContent='';
      searchInput.value='';
      urlInput.value='';
      setMessage('');
      if(listCard) listCard.open=true;
      await loadLinks(true);
    }catch(error){
      const text=String(error&&error.message||'');
      if(/already saved/i.test(text)) setMessage('이미 추가한 영상입니다',true);
      else if(/count limit/i.test(text)) setMessage('목록이 가득 찼습니다',true);
      else setMessage('링크를 저장하지 못했습니다',true);
    }
  }

  function addFromUrl(){
    const videoId=extractVideoId(urlInput.value);
    if(!videoId){ setMessage('YouTube 주소에서 영상을 찾지 못했습니다',true); return; }
    addLink(videoId,'');
  }

  /* ── 세션 ── */
  function applySession(user){
    const changed=(currentUser&&currentUser.id)!==(user&&user.id);
    currentUser=user||null;
    if(!currentUser){
      rows=[]; expandedId=''; destroyPlayer(); loopState.clear();
      linkPanel.hidden=true;
      linkButton.setAttribute('aria-expanded','false');
      renderList();
      return;
    }
    if(changed){ expandedId=''; destroyPlayer(); loadLinks(true); }
  }

  linkButton.addEventListener('click',togglePanel);
  modeSearch.addEventListener('click',()=>setMode('search'));
  modeUrl.addEventListener('click',()=>setMode('url'));
  searchGo.addEventListener('click',runSearch);
  urlGo.addEventListener('click',addFromUrl);
  searchInput.addEventListener('keydown',event=>{
    if(event.key==='Enter'){ event.preventDefault(); runSearch(); }
  });
  urlInput.addEventListener('keydown',event=>{
    if(event.key==='Enter'){ event.preventDefault(); addFromUrl(); }
  });
  menuRename.addEventListener('click',renameSelected);
  menuDelete.addEventListener('click',deleteSelected);
  menuBackdrop.addEventListener('click',event=>{
    if(event.target===menuBackdrop) closeMenu();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !menuBackdrop.hidden) closeMenu();
  });
  window.addEventListener('pagehide',()=>{ if(saveTimer) flushState(); });

  window.OlivePracticeLinks={
    count:()=>rows.length,
    isPlaying,
    stopPlayback,
  };
  if(window.OliveCloud && typeof window.OliveCloud.subscribeSession==='function'){
    window.OliveCloud.subscribeSession(applySession);
  }
  renderList();
})();

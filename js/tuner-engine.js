/* O'live tuner signal engine: pitch detection + adaptive weak-input gate. */
(function(root){
  'use strict';

  const FRAME_SIZE=4096;
  const WINDOW_SIZE=FRAME_SIZE>>1;
  const FFT_SIZE=8192;
  const YIN_THRESHOLD=0.15;
  const BAND_EDGES=Object.freeze([45,110,240,520,1100,2300]);
  const BAND_COUNT=BAND_EDGES.length-1;

  function clamp(value,min,max){ return Math.max(min,Math.min(max,value)); }

  function sensitivityProfile(value){
    const normalized=clamp(Math.round(Number(value)||0),0,100);
    const t=normalized/100;
    return Object.freeze({
      value:normalized,
      label:normalized<34 ? '노이즈 억제' : normalized<67 ? '균형' : '약한 입력',
      clarityGate:0.90-t*0.30,
      harmonicityGate:0.36-t*0.18,
      absoluteFloor:0.0012*Math.pow(0.1,t),
      noiseMultiplier:3.2-t*1.8,
      holdRatio:0.82-t*0.27,
      // 과도한 디지털 증폭은 큰 통기타 입력을 찌그러뜨릴 수 있어 6.5배로 제한한다.
      inputGain:4+t*2.5,
    });
  }

  function frameRms(samples,stride=1){
    const step=Math.max(1,Math.floor(stride));
    let sum=0,count=0;
    for(let i=0;i<samples.length;i+=step){ sum+=samples[i]*samples[i]; count++; }
    return count ? Math.sqrt(sum/count) : 0;
  }

  /* 주변 소음은 천천히 따라가고, 음정 후보가 있는 동안에는 학습하지 않는다.
     작은 기타음까지 잡되 에어컨·마찰음에 문턱이 같이 내려가는 것을 막는다. */
  function createSignalGate(){
    let noiseFloor=0,seeded=false;
    return {
      reset(){ noiseFloor=0; seeded=false; },
      evaluate(level,profile,state={}){
        const rms=Math.max(0,Number(level)||0);
        const floorMin=profile.absoluteFloor*0.25;
        if(!seeded){ noiseFloor=floorMin; seeded=true; }
        if(!state.pitched && !state.locked){
          const target=clamp(rms,floorMin,0.03);
          const rate=target<noiseFloor ? 0.08 : 0.025;
          noiseFloor+=(target-noiseFloor)*rate;
          noiseFloor=clamp(noiseFloor,floorMin,0.03);
        }
        const threshold=Math.max(profile.absoluteFloor,noiseFloor*profile.noiseMultiplier);
        const effectiveThreshold=state.locked
          ? Math.max(profile.absoluteFloor*0.65,threshold*profile.holdRatio)
          : threshold;
        return Object.freeze({
          open:rms>=effectiveThreshold,
          threshold,
          effectiveThreshold,
          noiseFloor,
        });
      },
    };
  }

  /* 전체 음량 하나만 보는 게이트를 보완하는 대역별 소음 프로필.
     음정 후보가 없는 동안 5개 대역을 천천히 학습하고, 새 입력이 각 대역의
     평소 소음보다 얼마나 선명한지를 0~1 신뢰도로 돌려준다. */
  function createBandNoiseProfile(){
    const floors=new Float32Array(BAND_COUNT);
    let seeded=false;
    let last=Object.freeze({contrastDb:0,dominantDb:0,confidence:0});
    return {
      reset(){
        floors.fill(0);
        seeded=false;
        last=Object.freeze({contrastDb:0,dominantDb:0,confidence:0});
      },
      evaluate(levels,profile,state={}){
        if(!levels || levels.length!==BAND_COUNT) return last;
        const minimum=Math.max(1e-8,profile.absoluteFloor*0.12);
        if(!seeded){ floors.fill(minimum); seeded=true; }

        if(!state.pitched && !state.locked){
          for(let i=0;i<BAND_COUNT;i++){
            const target=clamp(Number(levels[i])||0,minimum,0.04);
            const rate=target<floors[i] ? 0.10 : 0.035;
            floors[i]+= (target-floors[i])*rate;
            floors[i]=clamp(floors[i],minimum,0.04);
          }
        }

        let signalPower=0,noisePower=0,dominantDb=-60;
        for(let i=0;i<BAND_COUNT;i++){
          const level=Math.max(1e-9,Number(levels[i])||0);
          const floor=Math.max(1e-9,floors[i]);
          signalPower+=level*level;
          noisePower+=floor*floor;
          dominantDb=Math.max(dominantDb,20*Math.log10(level/floor));
        }
        const contrastDb=10*Math.log10(Math.max(1e-18,signalPower)/Math.max(1e-18,noisePower));
        const totalScore=clamp((contrastDb+1)/17,0,1);
        const dominantScore=clamp((dominantDb-1)/19,0,1);
        last=Object.freeze({
          contrastDb,
          dominantDb,
          confidence:totalScore*0.68+dominantScore*0.32,
        });
        return last;
      },
      getNoiseBands(){ return Array.from(floors); },
    };
  }

  /* 한 프레임의 우연한 결과를 바로 표시하지 않는다. 새 음은 두 프레임이
     일치해야 확정하고, 이미 잠긴 음은 즉시 따라가 반응 속도를 유지한다. */
  function createPitchTracker(){
    let lockedNote=null,pendingNote=null,pendingCount=0,misses=0;
    function reset(){ lockedNote=null; pendingNote=null; pendingCount=0; misses=0; }
    return {
      reset,
      isLocked(){ return lockedNote!==null; },
      update(candidate,options={}){
        const minimum=Number.isFinite(options.minConfidence) ? options.minConfidence : 0.48;
        if(!candidate || !(candidate.freq>0) || (candidate.confidence||0)<minimum){
          misses++;
          if(misses>3){ pendingNote=null; pendingCount=0; }
          if(misses>14) lockedNote=null;
          return null;
        }

        misses=0;
        const midi=69+12*Math.log2(candidate.freq/440);
        const note=Math.round(midi);
        if(lockedNote===note){
          pendingNote=null; pendingCount=0;
          return candidate;
        }

        if(pendingNote===note) pendingCount++;
        else { pendingNote=note; pendingCount=1; }

        const immediate=lockedNote===null &&
          candidate.confidence>=0.90 && candidate.clarity>=0.94 && candidate.harmonicity>=0.52;
        if(!immediate && pendingCount<2) return null;

        lockedNote=note;
        pendingNote=null; pendingCount=0;
        return candidate;
      },
    };
  }

  // radix-2 FFT tables and work buffers are allocated once, not per frame.
  const LEVELS=Math.round(Math.log2(FFT_SIZE));
  const cosTable=new Float32Array(FFT_SIZE/2);
  const sinTable=new Float32Array(FFT_SIZE/2);
  for(let i=0;i<FFT_SIZE/2;i++){
    cosTable[i]=Math.cos(2*Math.PI*i/FFT_SIZE);
    sinTable[i]=Math.sin(2*Math.PI*i/FFT_SIZE);
  }
  const reverseTable=new Uint16Array(FFT_SIZE);
  for(let i=0;i<FFT_SIZE;i++){
    let reversed=0,value=i;
    for(let bit=0;bit<LEVELS;bit++){
      reversed=(reversed<<1)|(value&1);
      value>>=1;
    }
    reverseTable[i]=reversed;
  }

  function fft(real,imaginary){
    for(let i=0;i<FFT_SIZE;i++){
      const j=reverseTable[i];
      if(j>i){
        let temp=real[i]; real[i]=real[j]; real[j]=temp;
        temp=imaginary[i]; imaginary[i]=imaginary[j]; imaginary[j]=temp;
      }
    }
    for(let size=2;size<=FFT_SIZE;size<<=1){
      const half=size>>1,step=FFT_SIZE/size;
      for(let i=0;i<FFT_SIZE;i+=size){
        for(let j=i,k=0;j<i+half;j++,k+=step){
          const opposite=j+half;
          const tr=real[opposite]*cosTable[k]+imaginary[opposite]*sinTable[k];
          const ti=-real[opposite]*sinTable[k]+imaginary[opposite]*cosTable[k];
          real[opposite]=real[j]-tr;
          imaginary[opposite]=imaginary[j]-ti;
          real[j]+=tr;
          imaginary[j]+=ti;
        }
      }
    }
  }

  function ifft(real,imaginary){
    for(let i=0;i<FFT_SIZE;i++) imaginary[i]=-imaginary[i];
    fft(real,imaginary);
    const inverse=1/FFT_SIZE;
    for(let i=0;i<FFT_SIZE;i++){
      real[i]*=inverse;
      imaginary[i]*=-inverse;
    }
  }

  const aReal=new Float32Array(FFT_SIZE),aImag=new Float32Array(FFT_SIZE);
  const bReal=new Float32Array(FFT_SIZE),bImag=new Float32Array(FFT_SIZE);
  const difference=new Float32Array(WINDOW_SIZE);
  const normalizedDifference=new Float32Array(WINDOW_SIZE);
  const cumulativePower=new Float32Array(FRAME_SIZE+1);

  function binPower(index){
    return bReal[index]*bReal[index]+bImag[index]*bImag[index];
  }

  function measureBands(sampleRate){
    const result=new Float32Array(BAND_COUNT);
    const normalizer=FFT_SIZE*FRAME_SIZE;
    for(let band=0;band<BAND_COUNT;band++){
      const first=Math.max(1,Math.ceil(BAND_EDGES[band]*FFT_SIZE/sampleRate));
      const last=Math.min(FFT_SIZE/2-1,Math.floor(BAND_EDGES[band+1]*FFT_SIZE/sampleRate));
      let power=0;
      for(let bin=first;bin<=last;bin++) power+=binPower(bin);
      result[band]=Math.sqrt(Math.max(0,power*2/normalizer));
    }
    return result;
  }

  function gridEnergy(base,minFrequency,maxFrequency,sampleRate){
    const firstBin=Math.max(1,Math.ceil(minFrequency*FFT_SIZE/sampleRate));
    const lastBin=Math.min(FFT_SIZE/2-1,Math.floor(maxFrequency*FFT_SIZE/sampleRate));
    let total=0;
    for(let bin=firstBin;bin<=lastBin;bin++) total+=binPower(bin);
    if(total<=1e-18) return 0;

    let selected=0,covered=0;
    const firstHarmonic=Math.max(1,Math.ceil(minFrequency/base));
    const lastHarmonic=Math.floor(maxFrequency/base);
    for(let harmonic=firstHarmonic;harmonic<=lastHarmonic;harmonic++){
      const center=Math.round(base*harmonic*FFT_SIZE/sampleRate);
      for(let bin=Math.max(firstBin,center-2);bin<=Math.min(lastBin,center+2);bin++){
        selected+=binPower(bin);
        covered++;
      }
    }
    const bins=Math.max(1,lastBin-firstBin+1);
    const baseline=clamp(covered/bins,0,0.95);
    const ratio=selected/total;
    return clamp((ratio-baseline)/Math.max(0.05,1-baseline),0,1);
  }

  function measureHarmonics(frequency,sampleRate,minFrequency,maxFrequency){
    const harmonicity=gridEnergy(frequency,minFrequency,maxFrequency,sampleRate);
    let humLikelihood=0;
    for(const base of [50,60]){
      const nearest=Math.max(1,Math.round(frequency/base));
      const gridFrequency=base*nearest;
      const cents=Math.abs(1200*Math.log2(frequency/gridFrequency));
      const proximity=clamp(1-cents/24,0,1);
      if(proximity>0){
        humLikelihood=Math.max(
          humLikelihood,
          gridEnergy(base,minFrequency,maxFrequency,sampleRate)*proximity,
        );
      }
    }
    return {harmonicity,humLikelihood};
  }

  /* YIN (de Cheveigne & Kawahara, 2002). 진폭 판정은 적응형 게이트가
     담당하므로 여기서는 아주 작은 파형도 음정 후보와 명확도를 계산한다. */
  function analyzePitch(samples,sampleRate,options={}){
    if(!samples || samples.length<FRAME_SIZE || !(sampleRate>0)){
      return {pitch:null,bands:new Float32Array(BAND_COUNT)};
    }
    const minFrequency=clamp(Number(options.minFrequency)||28,20,1500);
    const maxFrequency=clamp(Number(options.maxFrequency)||1500,minFrequency,4000);

    aReal.fill(0); aImag.fill(0); bReal.fill(0); bImag.fill(0);
    for(let i=0;i<FRAME_SIZE;i++) bReal[i]=samples[i];
    fft(bReal,bImag);
    const bands=measureBands(sampleRate);
    if(options.skipPitch) return {pitch:null,bands};

    for(let i=0;i<WINDOW_SIZE;i++) aReal[i]=samples[i];
    fft(aReal,aImag);
    for(let i=0;i<FFT_SIZE;i++){
      const ar=aReal[i],ai=-aImag[i],br=bReal[i],bi=bImag[i];
      aReal[i]=ar*br-ai*bi;
      aImag[i]=ar*bi+ai*br;
    }
    ifft(aReal,aImag);

    cumulativePower[0]=0;
    for(let i=0;i<FRAME_SIZE;i++){
      cumulativePower[i+1]=cumulativePower[i]+samples[i]*samples[i];
    }
    const firstPower=cumulativePower[WINDOW_SIZE];
    for(let tau=0;tau<WINDOW_SIZE;tau++){
      const secondPower=cumulativePower[tau+WINDOW_SIZE]-cumulativePower[tau];
      difference[tau]=Math.max(0,firstPower+secondPower-2*aReal[tau]);
    }

    normalizedDifference[0]=1;
    let running=0;
    for(let tau=1;tau<WINDOW_SIZE;tau++){
      running+=difference[tau];
      normalizedDifference[tau]=running>0 ? difference[tau]*tau/running : 1;
    }

    const minTau=Math.max(1,Math.floor(sampleRate/maxFrequency));
    const maxTau=Math.min(WINDOW_SIZE-2,Math.floor(sampleRate/minFrequency));
    let estimatedTau=-1;
    for(let tau=minTau;tau<=maxTau;tau++){
      if(normalizedDifference[tau]<YIN_THRESHOLD){
        while(tau+1<=maxTau && normalizedDifference[tau+1]<normalizedDifference[tau]) tau++;
        estimatedTau=tau;
        break;
      }
    }
    if(estimatedTau===-1){
      let best=Infinity;
      for(let tau=minTau;tau<=maxTau;tau++){
        if(normalizedDifference[tau]<best){ best=normalizedDifference[tau]; estimatedTau=tau; }
      }
      if(estimatedTau===-1 || best>0.55) return {pitch:null,bands};
    }

    let selected=estimatedTau;
    for(let multiple=2;multiple<=8;multiple++){
      const divided=Math.round(estimatedTau/multiple);
      if(divided<minTau) break;
      let candidate=divided;
      for(let j=Math.max(minTau,divided-2);j<=Math.min(maxTau,divided+2);j++){
        if(normalizedDifference[j]<normalizedDifference[candidate]) candidate=j;
      }
      if(normalizedDifference[candidate]<Math.min(0.40,normalizedDifference[estimatedTau]+0.16)){
        selected=candidate;
      }
    }
    estimatedTau=selected;

    let preciseTau=estimatedTau;
    if(estimatedTau>0 && estimatedTau<WINDOW_SIZE-1){
      const left=normalizedDifference[estimatedTau-1];
      const center=normalizedDifference[estimatedTau];
      const right=normalizedDifference[estimatedTau+1];
      const denominator=2*(2*center-right-left);
      if(Math.abs(denominator)>1e-12) preciseTau=estimatedTau+(right-left)/denominator;
    }
    if(preciseTau<=0) return {pitch:null,bands};
    const freq=sampleRate/preciseTau;
    const spectral=measureHarmonics(freq,sampleRate,minFrequency,maxFrequency);
    return {pitch:Object.freeze({
      freq,
      clarity:1-normalizedDifference[estimatedTau],
      harmonicity:spectral.harmonicity,
      humLikelihood:spectral.humLikelihood,
    }),bands};
  }

  function detectPitch(samples,sampleRate,options={}){
    return analyzePitch(samples,sampleRate,options).pitch;
  }

  root.OliveTunerEngine=Object.freeze({
    BAND_EDGES,
    FRAME_SIZE,
    analyzePitch,
    createBandNoiseProfile,
    createPitchTracker,
    createSignalGate,
    detectPitch,
    frameRms,
    sensitivityProfile,
  });
})(globalThis);

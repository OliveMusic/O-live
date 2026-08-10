/* O'live tuner signal engine: pitch detection + adaptive weak-input gate. */
(function(root){
  'use strict';

  const FRAME_SIZE=4096;
  const WINDOW_SIZE=FRAME_SIZE>>1;
  const FFT_SIZE=8192;
  const YIN_THRESHOLD=0.15;

  function clamp(value,min,max){ return Math.max(min,Math.min(max,value)); }

  function sensitivityProfile(value){
    const normalized=clamp(Math.round(Number(value)||0),0,100);
    const t=normalized/100;
    return Object.freeze({
      value:normalized,
      label:normalized<34 ? '노이즈 억제' : normalized<67 ? '균형' : '약한 입력',
      clarityGate:0.90-t*0.30,
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

  /* YIN (de Cheveigne & Kawahara, 2002). 진폭 판정은 적응형 게이트가
     담당하므로 여기서는 아주 작은 파형도 음정 후보와 명확도를 계산한다. */
  function detectPitch(samples,sampleRate,options={}){
    if(!samples || samples.length<FRAME_SIZE || !(sampleRate>0)) return null;
    const minFrequency=clamp(Number(options.minFrequency)||28,20,1500);
    const maxFrequency=clamp(Number(options.maxFrequency)||1500,minFrequency,4000);

    aReal.fill(0); aImag.fill(0); bReal.fill(0); bImag.fill(0);
    for(let i=0;i<WINDOW_SIZE;i++) aReal[i]=samples[i];
    for(let i=0;i<FRAME_SIZE;i++) bReal[i]=samples[i];
    fft(aReal,aImag); fft(bReal,bImag);
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
      if(estimatedTau===-1 || best>0.55) return null;
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
    if(preciseTau<=0) return null;
    return {
      freq:sampleRate/preciseTau,
      clarity:1-normalizedDifference[estimatedTau],
    };
  }

  root.OliveTunerEngine=Object.freeze({
    FRAME_SIZE,
    createSignalGate,
    detectPitch,
    frameRms,
    sensitivityProfile,
  });
})(globalThis);

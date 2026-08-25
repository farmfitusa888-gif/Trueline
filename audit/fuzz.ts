import { isqrt, hypotenuse, parseLength, formatFeetInches, NM_PER_INCH } from '../core/src/length.ts';
import { diagonal, diagonalFromRun, DIAGONAL_SLACK } from '../core/src/room.ts';

// 1. isqrt nearest-integer correctness
let bad=0, worstErr=0n;
for(let i=0;i<200000;i++){
  const v=BigInt(Math.floor(Math.random()*1e15))*BigInt(Math.floor(Math.random()*1e6)+1);
  const g=isqrt(v);
  // nearest integer root: |g^2 - v| minimal
  const lo=g-1n, hi=g+1n;
  const d=(k:bigint)=>{const x=k*k-v; return x<0n?-x:x;};
  if(d(g)>d(lo)||d(g)>d(hi)){bad++; if(bad<4)console.log('isqrt not nearest for',v,g);}
}
console.log('isqrt non-nearest cases:',bad,'of 200000');

// 2. diagonal(): rebuild the kitchen chamfer at many tape lengths and check validate's slack
const dir={x:68057633n,y:-191561655n};
let worst=0n, worstL=0n;
for(let mm=50; mm<=3000; mm++){
  const L=BigInt(mm)*1000000n;
  const d=diagonal(L,dir);
  const actual=hypotenuse(d.run.x,d.run.y);
  const e=actual>L?actual-L:L-actual;
  if(e>worst){worst=e;worstL=L;}
}
console.log('diagonal(): worst |hypot(run) - stated length| =',worst,'nm at',worstL,'nm   (DIAGONAL_SLACK =',DIAGONAL_SLACK,'nm)', worst>DIAGONAL_SLACK?'*** EXCEEDS SLACK -> validate() throws ***':'ok');

// 3. same over many random directions
let worst2=0n, ctx='';
for(let i=0;i<20000;i++){
  const dx=BigInt(1+Math.floor(Math.random()*3e9)), dy=BigInt(1+Math.floor(Math.random()*3e9));
  const L=BigInt(1+Math.floor(Math.random()*10_000_000_000));
  const d=diagonal(L,{x:dx,y:dy});
  const actual=hypotenuse(d.run.x,d.run.y);
  const e=actual>L?actual-L:L-actual;
  if(e>worst2){worst2=e;ctx=`L=${L} dir=(${dx},${dy}) run=(${d.run.x},${d.run.y}) hypot=${actual}`;}
}
console.log('random directions worst error:',worst2,'nm  ',ctx, worst2>DIAGONAL_SLACK?'*** EXCEEDS SLACK ***':'ok');

// 4. parse/format round trip on 1/16ths
let rt=0;
for(let i=0;i<20000;i++){
  const nm=BigInt(Math.floor(Math.random()*2000))*(NM_PER_INCH/16n);
  const s=formatFeetInches(nm);
  const back=parseLength(s);
  if(back!==nm){rt++; if(rt<5)console.log('round trip',nm,'->',s,'->',back);}
}
console.log('formatFeetInches/parseLength round-trip failures at 1/16:',rt,'of 20000');

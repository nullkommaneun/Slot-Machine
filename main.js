// === Konfiguration ===
const SYMBOLS = [
  { id:'KIR',    weight: 30, emoji:'🍒', label:'Kirsche' },
  { id:'ZIT',    weight: 24, emoji:'🍋', label:'Zitrone' },
  { id:'HUF',    weight: 16, emoji:'🧲', label:'Hufeisen' },
  { id:'KLEE',   weight: 10, emoji:'☘️', label:'Kleeblatt' },
  { id:'SIEBEN', weight:  4, emoji:'7️⃣', label:'Sieben' },
];
const PAYOUTS = { SIEBEN:100, KLEE:50, HUF:25, ZIT:10, KIR:5 };
const LINES = [
  [0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2], [0,1,2,1,0], [2,1,0,1,2],
];
const STRIP_LEN = 40;
const SYMBOL_H = 60;

// === Zustand ===
const STATE = {
  reels: 5, rows: 3,
  credits: Number(localStorage.getItem('slot_credits') ?? 1000),
  lastWin: 0, totalIn: 0, totalOut: 0,
  auto: false, spinning: false,
  seed: localStorage.getItem('slot_seed') || String(Math.floor(Math.random()*1e9)),
};

// PRNG (Mulberry32)
function makePRNG(seedStr){
  let h = 1779033703 ^ seedStr.length;
  for (let i=0;i<seedStr.length;i++){ h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h<<13) | (h>>>19); }
  return function(){ h = Math.imul(h ^ (h>>>16), 2246822507); h = Math.imul(h ^ (h>>>13), 3266489909); h ^= h>>>16; return (h>>>0) / 4294967296; }
}
let rnd = makePRNG(STATE.seed);
function uiRand(min,max){ return min + Math.random()*(max-min); } // UI randomness (nicht seedbar)
function weightedPick(){ const total = SYMBOLS.reduce((a,s)=>a+s.weight,0); let v = rnd()*total; for(const s of SYMBOLS){ if((v-=s.weight)<=0) return s.id; } return SYMBOLS[SYMBOLS.length-1].id; }
function getSym(id){ return SYMBOLS.find(s=>s.id===id); }

// DOM
const scaleWrap = document.getElementById('scale-wrap');
const reelsEl = document.getElementById('reels');
const creditsEl = document.getElementById('credits');
const lastWinEl = document.getElementById('lastWin');
const rtpEl = document.getElementById('rtp');
const seedEl = document.getElementById('seed');
const logEl = document.getElementById('log');
const btnSpin = document.getElementById('btnSpin');
const btnAuto = document.getElementById('btnAuto');
const btnSeed = document.getElementById('btnSeed');
const betInput = document.getElementById('bet');
const machine = document.getElementById('machine');
const hitOverlay = document.getElementById('hitOverlay');
const prebuffer = document.getElementById('prebuffer');

seedEl.textContent = STATE.seed;

// Overlay-Zellen
for(let row=0; row<3; row++){ for(let col=0; col<5; col++){ const d = document.createElement('div'); d.className='hit'; d.dataset.row=String(row); d.dataset.col=String(col); hitOverlay.appendChild(d);} }
function clearHits(){ [...hitOverlay.children].forEach(c=>{ c.className='hit'; }); }
function markCell(row,col, symId){ const idx=row*5+col; const c=hitOverlay.children[idx]; if(c){ c.className='hit active sym-'+symId; }}

// --- Strip-Prebuffer ---
class StripPool{
  constructor(sizePerReel=3){
    this.queue = Array.from({length:STATE.reels}, ()=>[]);
    this.sizePerReel = sizePerReel;
    this.refillAll();
  }
  genStrip(){
    const ids = Array.from({length:STRIP_LEN}, ()=>weightedPick());
    return ids;
  }
  refillAll(){
    for(let r=0;r<STATE.reels;r++){ while(this.queue[r].length < this.sizePerReel){ this.queue[r].push(this.genStrip()); } }
    this.renderOffscreen(); // Emoji-Raster vorbereiten
  }
  nextStrip(reelIndex){
    if(this.queue[reelIndex].length===0){ this.queue[reelIndex].push(this.genStrip()); }
    const strip = this.queue[reelIndex].shift();
    // gleich neu auffüllen, damit immer vorgepuffert
    this.queue[reelIndex].push(this.genStrip());
    this.renderOffscreen(); // neue Strips triggern Offscreen-Render
    return strip;
  }
  renderOffscreen(){
    // Offscreen minimal DOM erzeugen, damit Browser Emoji-Glyphen cached
    prebuffer.innerHTML='';
    for(let r=0;r<STATE.reels;r++){
      const s = this.queue[r][0]; // nur erste je Reel reicht
      const span = document.createElement('span');
      span.className='pre-s';
      // 6-8 Zeichen reichen fürs Glyph-Caching
      for(let i=0;i<Math.min(8, s.length); i+=Math.floor(s.length/8)){
        const e = getSym(s[i]).emoji;
        span.append(e + '\u00a0');
      }
      prebuffer.appendChild(span);
    }
  }
}
const stripPool = new StripPool(4);

// Reels aufbauen (DOM einmalig), Inhalte werden pro Spin aus StripPool gesetzt
const reelNodes = [];
for(let rI=0;rI<STATE.reels;rI++){
  const reel = document.createElement('div'); reel.className='reel';
  const symbolsWrap = document.createElement('div'); symbolsWrap.className='symbols';
  reel.appendChild(symbolsWrap);
  // Platzhalter-Zellen
  for(let i=0;i<STRIP_LEN;i++){
    const div = document.createElement('div'); div.className='symbol'; div.dataset.id='KIR'; div.textContent='🍒\u00a0';
    symbolsWrap.appendChild(div);
  }
  reelsEl.appendChild(reel);
  reelNodes.push({reel, symbols:symbolsWrap, px:0, topIndex:0});
}

function mountStripToReel(reelIndex, ids){
  const rn = reelNodes[reelIndex];
  const children = rn.symbols.children;
  for(let i=0;i<STRIP_LEN;i++){
    const id = ids[i]; const sym = getSym(id);
    const cell = children[i];
    cell.dataset.id = id;
    cell.textContent = sym.emoji + '\u00a0'; // NBSP hält Render stabil
  }
}

// Erst anzeigbar, wenn Fonts geladen
function showReelsWhenReady(){
  const reveal = ()=>{ reelsEl.classList.remove('hidden'); reelsEl.removeAttribute('aria-busy'); };
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(reveal); } else { setTimeout(reveal, 80); }
}
showReelsWhenReady();

// Werte-Setter
function setCredits(v){ STATE.credits=v; localStorage.setItem('slot_credits', String(v)); creditsEl.textContent=v; }
function setLastWin(v){ STATE.lastWin=v; lastWinEl.textContent=v; }
function setSeed(newSeed){ STATE.seed=newSeed; localStorage.setItem('slot_seed', String(newSeed)); seedEl.textContent=newSeed; rnd = makePRNG(newSeed); }
function log(msg){ const time=new Date().toLocaleTimeString(); logEl.innerHTML = `<div><b>${time}</b> – ${msg}</div>` + logEl.innerHTML; }

// Grid
function currentGrid(){
  const grid=[];
  for(const rn of reelNodes){
    const top = ((rn.topIndex % STRIP_LEN) + STRIP_LEN) % STRIP_LEN;
    const ids = [
      rn.symbols.children[(top + 0) % STRIP_LEN].dataset.id,
      rn.symbols.children[(top + 1) % STRIP_LEN].dataset.id,
      rn.symbols.children[(top + 2) % STRIP_LEN].dataset.id,
    ];
    grid.push(ids);
  }
  return grid;
}

// Scoring
function bestRunOnLine(seq){
  let bestLen=1, bestSym=seq[0], bestStart=0, curLen=1, curStart=0;
  for(let i=1;i<seq.length;i++){
    if(seq[i]===seq[i-1]){ curLen++; } else { if(curLen>bestLen){ bestLen=curLen; bestSym=seq[i-1]; bestStart=curStart; } curLen=1; curStart=i; }
  }
  if(curLen>bestLen){ bestLen=curLen; bestSym=seq[seq.length-1]; bestStart=curStart; }
  return { len:bestLen, sym:bestSym, start:bestStart };
}
function evaluateLines(grid, bet){
  let totalWin=0; const hits=[];
  LINES.forEach((rows, lineIdx)=>{
    const seq = rows.map((row, col)=> grid[col][row]);
    const { len, sym, start } = bestRunOnLine(seq);
    if(len>=3){
      let mult=0;
      if(len===3) mult=1;
      else if(len===4) mult=Math.floor((PAYOUTS[sym]||0)*0.3);
      else if(len===5) mult=(PAYOUTS[sym]||0);
      const win = mult*bet; totalWin+=win;
      hits.push({lineIdx, sym, count:len, start, mult, win, pattern:seq.join(' | ')});
    }
  });
  return { totalWin, hits };
}

// Overlay
function showHits(hits){
  clearHits();
  hits.forEach(h=>{ for(let k=0;k<h.count;k++){ const col=h.start+k; const row=LINES[h.lineIdx][col]; markCell(row,col,h.sym); } });
  setTimeout(clearHits, 1500);
}

// Autoscale
function autoscale(){
  scaleWrap.style.transform='scale(1)';
  const rect=scaleWrap.getBoundingClientRect();
  const pad=16; const header=document.querySelector('.site-header'); const headerH=header?header.getBoundingClientRect().height:0;
  const availW=window.innerWidth-pad*2; const availH=window.innerHeight-headerH-pad*2;
  const s=Math.min(availW/rect.width, availH/rect.height, 1);
  scaleWrap.style.transform=`translateZ(0) scale(${s})`;
}
window.addEventListener('resize', autoscale); window.addEventListener('orientationchange', autoscale);

// Audio (wie zuvor, gekürzt)
let audioCtx=null, spinActive=false, spinTimer=null;
function ensureAudio(){ if(!audioCtx){ const Ctx=window.AudioContext||window.webkitAudioContext; audioCtx=new Ctx(); } if(audioCtx.state==='suspended'){ audioCtx.resume(); } }
function playNote(freq=880, dur=0.10){
  ensureAudio();
  const o1=audioCtx.createOscillator(), o2=audioCtx.createOscillator(); o1.type='sawtooth'; o2.type='sawtooth'; o1.frequency.value=freq; o2.frequency.value=freq*1.01;
  const lp=audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1300; lp.Q.value=0.7;
  const g=audioCtx.createGain(); g.gain.value=0.0001; o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
  const now=audioCtx.currentTime; g.gain.exponentialRampToValueAtTime(0.05, now+0.015); g.gain.exponentialRampToValueAtTime(0.001, now+dur);
  o1.start(now); o2.start(now); o1.stop(now+dur+0.02); o2.stop(now+dur+0.02);
}
const SEMITONE=2**(1/12);
function scheduleDescendingScale(){
  if(!spinActive) return; const steps=Math.floor(uiRand(6,10)); const base=uiRand(950,1400); let t=0;
  for(let i=0;i<steps;i++){ const interval=uiRand(70,120)+uiRand(-20,20); const f=base/(SEMITONE**i); setTimeout(()=>{ if(spinActive) playNote(f,0.09); }, t); t+=interval; }
  spinTimer=setTimeout(()=>{ if(spinActive) scheduleDescendingScale(); }, t+30);
}
function startSpinSound(){ ensureAudio(); stopSpinSound(); spinActive=true; scheduleDescendingScale(); }
function stopSpinSound(){ spinActive=false; if(spinTimer){ clearTimeout(spinTimer); spinTimer=null; } }
function tickStop(){ ensureAudio(); const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type='square'; o.frequency.value=900+(Math.random()*80-40); g.gain.value=0.05; o.connect(g); g.connect(audioCtx.destination); const now=audioCtx.currentTime; o.start(now); g.gain.exponentialRampToValueAtTime(0.001, now+0.06); o.stop(now+0.08); }
function winChime(mult=1){ ensureAudio(); const base=880; const shift=Math.random()>0.5?1:-1; const freqs=[base, base*5/4, base*3/2].map(f=> f*(1+0.02*shift)); const now=audioCtx.currentTime; freqs.forEach((f,i)=>{ const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type='sine'; o.frequency.value=f; g.gain.value=0.0001; o.connect(g); g.connect(audioCtx.destination); o.start(now+i*0.02); g.gain.exponentialRampToValueAtTime(0.04*Math.min(2, mult/10+1), now+i*0.02+0.02); g.gain.exponentialRampToValueAtTime(0.0001, now+0.35+i*0.02); o.stop(now+0.4+i*0.02); }); }

// Easing
function eased(t){ return 1 - Math.pow(1-t, 3); }
function easeOutBack(t){ const c1=1.70158; const c3=c1+1; return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); }

// Spin
const animState = []; // pro Reel

async function spin(){
  if(STATE.spinning) return;
  const bet=Math.max(1, Math.floor(Number(betInput.value)||1));
  if(STATE.credits < bet){ log('Zu wenig Credits.'); return; }
  STATE.spinning=true; btnSpin.disabled=true; btnAuto.disabled=true; btnSeed.disabled=true; betInput.disabled=true;

  setCredits(STATE.credits - bet); STATE.totalIn += bet;

  // Neue Strips aus dem Pool ziehen und DOM befüllen (vor dem Start!)
  for(let r=0;r<STATE.reels;r++){ const strip = stripPool.nextStrip(r); mountStripToReel(r, strip); }

  const ORDER = Array.from({length:STATE.reels}, (_,i)=>i).sort(()=>Math.random()-0.5);
  const BASE=820, STAGGER=120;
  animState.length=0;
  for(let i=0;i<STATE.reels;i++){
    const rn=reelNodes[i]; animState[i]={ px: rn.px||0 };
  }
  const anim = reelNodes.map((rn,i)=>{
    const orderIdx = ORDER.indexOf(i);
    return { start: performance.now()+orderIdx*STAGGER + uiRand(-40,50), duration: BASE + orderIdx*120 + uiRand(0,160), px: animState[i].px };
  });

  startSpinSound();

  function animateReels(resolve){
    function frame(t){
      let allDone=true;
      for(let i=0;i<reelNodes.length;i++){
        const rn=reelNodes[i]; const a=anim[i]; const elapsed=t - a.start;
        if(elapsed < 0){ allDone=false; continue; }
        if(elapsed < a.duration){
          allDone=false;
          const p=Math.min(1, elapsed/a.duration);
          const spd=(12.0*(1 - eased(p)) + 1.6) + Math.random()*0.6;
          a.px=(a.px + spd) % (SYMBOL_H*STRIP_LEN);
          rn.symbols.style.transform=`translateY(${-a.px}px)`;
        } else {
          const mod=a.px % SYMBOL_H; const snapTarget=a.px - mod + (mod > SYMBOL_H/2 ? SYMBOL_H : 0);
          const startPx=a.px; const snapDur=180; const t0=performance.now();
          (function snapStep(ts){
            const tt=Math.min(1, (ts - t0)/snapDur); const k=easeOutBack(tt); const px=startPx + (snapTarget - startPx)*k;
            rn.symbols.style.transform=`translateY(${-px}px)`;
            if(tt < 1){ requestAnimationFrame(snapStep); } else { rn.px=snapTarget; rn.topIndex=Math.round(snapTarget/SYMBOL_H)%STRIP_LEN; if(!a.ticked){ tickStop(); a.ticked=true; } }
          })(performance.now());
        }
      }
      if(!allDone){ requestAnimationFrame(frame); }
      else {
        setTimeout(()=>{
          stopSpinSound();
          const grid=currentGrid();
          const { totalWin, hits } = evaluateLines(grid, bet);
          setLastWin(totalWin); STATE.totalOut += totalWin; setCredits(STATE.credits + totalWin);
          const rtp = STATE.totalIn ? (STATE.totalOut/STATE.totalIn*100).toFixed(1)+'%' : '–'; rtpEl.textContent=rtp;
          if(totalWin>0){
            showHits(hits);
            machine.classList.remove('flash-win'); void machine.offsetWidth; machine.classList.add('flash-win');
            hits.forEach(h=> log(`Linie ${h.lineIdx+1}: <b>${getSym(h.sym).label}</b> ×${h.count} (x${h.mult}). Gewinn: <b>${h.win}</b>.`));
            const topHit = hits.reduce((a,b)=> (a && a.mult > b.mult ? a : b), null); winChime(topHit ? topHit.mult : 1);
          } else { clearHits(); log('Niete.'); }
          STATE.spinning=false; btnSpin.disabled=false; btnAuto.disabled=false; btnSeed.disabled=false; betInput.disabled=false;
          resolve();
        }, 220);
      }
    }
    requestAnimationFrame(frame);
  }

  return new Promise(resolve=> animateReels(resolve));
}

// Events
btnSpin.addEventListener('click', async()=>{ await spin(); if(STATE.auto){ setTimeout(()=>btnSpin.click(), Math.floor(uiRand(160, 360))); } });
btnAuto.addEventListener('click', ()=>{ STATE.auto=!STATE.auto; btnAuto.textContent=`Auto: ${STATE.auto?'An':'Aus'}`; if(STATE.auto && !STATE.spinning){ btnSpin.click(); } });
btnSeed.addEventListener('click', ()=>{ setSeed(String(Math.floor(Math.random()*1e9))); log('Neuer Seed gesetzt.'); stripPool.refillAll(); });

// Init
function autoscale(){ scaleWrap.style.transform='scale(1)'; const rect=scaleWrap.getBoundingClientRect(); const pad=16; const header=document.querySelector('.site-header'); const headerH=header?header.getBoundingClientRect().height:0; const availW=window.innerWidth-pad*2; const availH=window.innerHeight-headerH-pad*2; const s=Math.min(availW/rect.width, availH/rect.height, 1); scaleWrap.style.transform=`translateZ(0) scale(${s})`; }
setCredits(STATE.credits); setLastWin(STATE.lastWin); log('Bereit. Drücke „Drehen“.');
window.addEventListener('resize', autoscale); window.addEventListener('orientationchange', autoscale); window.addEventListener('load', autoscale);
setTimeout(autoscale, 80);

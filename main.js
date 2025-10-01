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

// === Zustand ===
const STATE = {
  reels: 5,
  rows: 3,
  credits: Number(localStorage.getItem('slot_credits') ?? 1000),
  lastWin: 0,
  totalIn: 0,
  totalOut: 0,
  auto: false,
  spinning: false,
  seed: localStorage.getItem('slot_seed') || String(Math.floor(Math.random()*1e9)),
};

// PRNG (Mulberry32)
function makePRNG(seedStr){
  let h = 1779033703 ^ seedStr.length;
  for (let i=0;i<seedStr.length;i++){
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h<<13) | (h>>>19);
  }
  return function(){
    h = Math.imul(h ^ (h>>>16), 2246822507);
    h = Math.imul(h ^ (h>>>13), 3266489909);
    h ^= h>>>16;
    return (h>>>0) / 4294967296;
  }
}
let rnd = makePRNG(STATE.seed);
function r(min,max){ return min + Math.random()*(max-min); } // UI randomness (nicht seedbar)

function weightedPick(){
  const total = SYMBOLS.reduce((a,s)=>a+s.weight,0);
  let v = rnd()*total;
  for(const s of SYMBOLS){ if((v-=s.weight)<=0) return s.id; }
  return SYMBOLS[SYMBOLS.length-1].id;
}
function getSym(id){ return SYMBOLS.find(s=>s.id===id); }

// DOM Referenzen
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

seedEl.textContent = STATE.seed;

// Overlay-Zellen erzeugen (3 Zeilen × 5 Spalten)
for(let row=0; row<3; row++){
  for(let col=0; col<5; col++){
    const d = document.createElement('div');
    d.className = 'hit';
    d.dataset.row = String(row);
    d.dataset.col = String(col);
    hitOverlay.appendChild(d);
  }
}
function clearHits(){ [...hitOverlay.children].forEach(c=>{ c.className='hit'; }); }
function markCell(row,col, symId){
  const idx = row*5 + col;
  const c = hitOverlay.children[idx];
  if(c){ c.className = 'hit active sym-' + symId; }
}

// Reels vorbereiten (Emoji als Text)
const reelNodes = [];
const STRIP_LEN = 40;
const SYMBOL_H = 60;
for(let rI=0;rI<STATE.reels;rI++){
  const reel = document.createElement('div');
  reel.className = 'reel';
  const symbolsWrap = document.createElement('div');
  symbolsWrap.className = 'symbols';
  reel.appendChild(symbolsWrap);

  for(let i=0;i<STRIP_LEN;i++){
    const id = weightedPick();
    const div = document.createElement('div');
    div.className='symbol';
    const sym = getSym(id);
    div.dataset.id = id;
    div.setAttribute('aria-label', sym.label);
    div.textContent = sym.emoji;
    symbolsWrap.appendChild(div);
  }

  reelsEl.appendChild(reel);
  reelNodes.push({reel, symbols:symbolsWrap, offsetPx:0, topIndex:0});
}

function setCredits(v){ STATE.credits = v; localStorage.setItem('slot_credits', String(v)); creditsEl.textContent = v; }
function setLastWin(v){ STATE.lastWin = v; lastWinEl.textContent = v; }
function setSeed(newSeed){ STATE.seed = newSeed; localStorage.setItem('slot_seed', String(newSeed)); seedEl.textContent = newSeed; rnd = makePRNG(newSeed); }
function log(msg){ const time = new Date().toLocaleTimeString(); logEl.innerHTML = `<div><b>${time}</b> – ${msg}</div>` + logEl.innerHTML; }

// Grid deterministisch
function currentGrid(){
  const grid = []; // [reel][row]
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

// längste Serie + Startindex auf Linie (nicht links-gebunden)
function bestRunOnLine(seq){
  let bestLen = 1, bestSym = seq[0], bestStart = 0;
  let curLen = 1, curStart = 0;
  for(let i=1;i<seq.length;i++){
    if(seq[i] === seq[i-1]){
      curLen++;
    } else {
      if(curLen > bestLen){ bestLen = curLen; bestSym = seq[i-1]; bestStart = curStart; }
      curLen = 1; curStart = i;
    }
  }
  if(curLen > bestLen){ bestLen = curLen; bestSym = seq[seq.length-1]; bestStart = curStart; }
  return { len: bestLen, sym: bestSym, start: bestStart };
}

function evaluateLines(grid, bet){
  let totalWin = 0; const hits = [];
  LINES.forEach((rows, lineIdx)=>{
    const seq = rows.map((row, col)=> grid[col][row]);
    const { len, sym, start } = bestRunOnLine(seq);
    if(len >= 3){
      let mult = 0;
      if(len===3) mult = 1;
      else if(len===4) mult = Math.floor((PAYOUTS[sym]||0) * 0.3);
      else if(len===5) mult = (PAYOUTS[sym]||0);
      const win = mult * bet;
      totalWin += win;
      hits.push({lineIdx, sym, count: len, start, mult, win, pattern: seq.join(' | ')});
    }
  });
  return { totalWin, hits };
}

// Treffer-Overlay setzen
function showHits(hits){
  clearHits();
  hits.forEach(h=>{
    for(let k=0;k<h.count;k++){
      const col = h.start + k;
      const row = LINES[h.lineIdx][col];
      markCell(row, col, h.sym);
    }
  });
  // nach 1.6s wieder löschen
  setTimeout(clearHits, 1600);
}

// --- Auto-Scaler ---
function autoscale(){
  scaleWrap.style.transform = 'scale(1)';
  const rect = scaleWrap.getBoundingClientRect();
  const pad = 16;
  const header = document.querySelector('.site-header');
  const headerH = header ? header.getBoundingClientRect().height : 0;
  const availW = window.innerWidth - pad*2;
  const availH = window.innerHeight - headerH - pad*2;
  const sx = availW / rect.width;
  const sy = availH / rect.height;
  const s = Math.min(sx, sy, 1);
  scaleWrap.style.transform = `translateZ(0) scale(${s})`;
}
window.addEventListener('resize', autoscale);
window.addEventListener('orientationchange', autoscale);

// --- Audio (wie v6, gekürzt) ---
let audioCtx = null;
let spinActive = false;
let spinTimer = null;
function ensureAudio(){ if(!audioCtx){ const Ctx = window.AudioContext || window.webkitAudioContext; audioCtx = new Ctx(); } if(audioCtx.state === 'suspended'){ audioCtx.resume(); } }
function playNote(freq=880, dur=0.10){
  ensureAudio();
  const osc1 = audioCtx.createOscillator(); const osc2 = audioCtx.createOscillator();
  osc1.type = 'sawtooth'; osc2.type = 'sawtooth'; osc1.frequency.value = freq; osc2.frequency.value = freq*1.01;
  const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 0.7;
  const gain = audioCtx.createGain(); gain.gain.value = 0.0001;
  osc1.connect(lp); osc2.connect(lp); lp.connect(gain); gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc1.start(now); osc2.start(now); osc1.stop(now + dur + 0.02); osc2.stop(now + dur + 0.02);
}
const SEMITONE = 2 ** (1/12);
function scheduleDescendingScale(){
  if(!spinActive) return;
  const steps = Math.floor(r(6, 10));
  const base = r(950, 1400);
  let t = 0;
  for(let i=0;i<steps;i++){
    const jitter = r(-20, 20);
    const interval = r(70, 120) + jitter;
    const f = base / (SEMITONE ** i);
    setTimeout(()=>{ if(spinActive) playNote(f, 0.09); }, t);
    t += interval;
  }
  spinTimer = setTimeout(()=>{ if(spinActive) scheduleDescendingScale(); }, t + 30);
}
function startSpinSound(){ ensureAudio(); stopSpinSound(); spinActive = true; scheduleDescendingScale(); }
function stopSpinSound(){ spinActive = false; if(spinTimer){ clearTimeout(spinTimer); spinTimer = null; } }
function tickStop(){
  ensureAudio();
  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.type = 'square'; osc.frequency.value = 900 + (Math.random()*80-40);
  gain.gain.value = 0.05; osc.connect(gain); gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime; osc.start(now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06); osc.stop(now + 0.08);
}
function winChime(mult=1){
  ensureAudio();
  const base = 880; const shift = Math.random()>0.5 ? 1 : -1;
  const freqs = [base, base*5/4, base*3/2].map(f=> f * (1 + 0.02*shift));
  const now = audioCtx.currentTime;
  freqs.forEach((f,i)=>{
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = f; gain.gain.value = 0.0001;
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(now + i*0.02);
    gain.gain.exponentialRampToValueAtTime(0.04*Math.min(2, mult/10+1), now + i*0.02 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35 + i*0.02);
    osc.stop(now + 0.4 + i*0.02);
  });
}

// --- Spin (mit extra Randomness) ---
function shuffledIndices(n){ const arr = Array.from({length:n}, (_,i)=>i); for(let i=n-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

async function spin(){
  if(STATE.spinning) return;
  const bet = Math.max(1, Math.floor(Number(betInput.value)||1));
  if(STATE.credits < bet){ log('Zu wenig Credits.'); return; }
  STATE.spinning = true; btnSpin.disabled = true; btnAuto.disabled = true; btnSeed.disabled = true; betInput.disabled = true;

  setCredits(STATE.credits - bet); STATE.totalIn += bet;

  // zufällige Start-/Stopp-Reihenfolge + per-Reel Startoffset
  const ORDER = shuffledIndices(STATE.reels);
  const BASE = 780; const STAGGER = 120;
  const anim = reelNodes.map((rn,i)=>{
    const orderIdx = ORDER.indexOf(i);
    const startOffsetPx = Math.floor(r(0, 60*40)); // zufälliger Startoffset -> beeinflusst Endposition
    rn.symbols.style.transform = `translateY(${-startOffsetPx}px)`; // visueller Start
    return {
      start: performance.now() + orderIdx*STAGGER + r(-40, 60),
      duration: BASE + orderIdx*120 + r(0,180),
      lastPx: startOffsetPx
    };
  });

  startSpinSound();

  return new Promise(resolve=>{
    function frame(t){
      let allDone = true;
      for(let i=0;i<reelNodes.length;i++){
        const rn = reelNodes[i]; const a = anim[i]; const elapsed = t - a.start;
        if(elapsed < 0){ allDone = false; continue; }
        if(elapsed < a.duration){
          allDone = false;
          const p = Math.min(1, elapsed / a.duration);
          const ease = 1 - Math.pow(1-p, 3);
          const jitter = (Math.random()*0.8);
          const spd = (12.5*(1 - ease) + 1.8) + jitter;
          a.lastPx = (a.lastPx + spd) % (60 * 40);
          rn.symbols.style.transform = `translateY(${-a.lastPx}px)`;
        } else {
          const mod = a.lastPx % 60; const snap = a.lastPx - mod + (mod > 30 ? 60 : 0);
          rn.symbols.style.transform = `translateY(${-snap}px)`;
          rn.topIndex = Math.round(snap / 60) % 40;
          if(!a.ticked){ tickStop(); a.ticked = true; }
        }
      }
      if(!allDone){ requestAnimationFrame(frame); }
      else {
        stopSpinSound();
        const grid = currentGrid();
        const { totalWin, hits } = evaluateLines(grid, bet);
        setLastWin(totalWin); STATE.totalOut += totalWin; setCredits(STATE.credits + totalWin);
        const rtp = STATE.totalIn ? (STATE.totalOut/STATE.totalIn*100).toFixed(1)+'%' : '–';
        rtpEl.textContent = rtp;
        if(totalWin>0){
          showHits(hits);
          machine.classList.remove('flash-win'); void machine.offsetWidth; machine.classList.add('flash-win');
          hits.forEach(h=> log(`Linie ${h.lineIdx+1}: <b>${getSym(h.sym).label}</b> ×${h.count} (x${h.mult}). Gewinn: <b>${h.win}</b>.`));
          const topHit = hits.reduce((a,b)=> (a && a.mult > b.mult ? a : b), null);
          winChime(topHit ? topHit.mult : 1);
        } else { clearHits(); log('Niete.'); }
        STATE.spinning = false; btnSpin.disabled = false; btnAuto.disabled = false; btnSeed.disabled = false; betInput.disabled = false;
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

btnSpin.addEventListener('click', async()=>{ 
  await spin(); 
  if(STATE.auto){ setTimeout(()=>btnSpin.click(), Math.floor(r(160, 360))); }
});
btnAuto.addEventListener('click', ()=>{ STATE.auto=!STATE.auto; btnAuto.textContent = `Auto: ${STATE.auto?'An':'Aus'}`; if(STATE.auto && !STATE.spinning){ btnSpin.click(); } });
btnSeed.addEventListener('click', ()=>{ setSeed(String(Math.floor(Math.random()*1e9))); log('Neuer Seed gesetzt.'); });

// Init
function autoscale(){
  scaleWrap.style.transform = 'scale(1)';
  const rect = scaleWrap.getBoundingClientRect();
  const pad = 16;
  const header = document.querySelector('.site-header');
  const headerH = header ? header.getBoundingClientRect().height : 0;
  const availW = window.innerWidth - pad*2;
  const availH = window.innerHeight - headerH - pad*2;
  const sx = availW / rect.width;
  const sy = availH / rect.height;
  const s = Math.min(sx, sy, 1);
  scaleWrap.style.transform = `translateZ(0) scale(${s})`;
}
setCredits(STATE.credits); setLastWin(STATE.lastWin); log('Bereit. Drücke „Drehen“.');
window.addEventListener('resize', autoscale);
window.addEventListener('orientationchange', autoscale);
window.addEventListener('load', autoscale);
setTimeout(autoscale, 50);

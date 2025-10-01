// === Konfiguration ===
const SYMBOLS = [
  { id:'KIR',    weight: 30, emoji:'🍒', label:'Kirsche' },
  { id:'ZIT',    weight: 24, emoji:'🍋', label:'Zitrone' },
  { id:'HUF',    weight: 16, emoji:'🧲', label:'Hufeisen' }, // Ersatz mangels Hufeisen-Emoji
  { id:'KLEE',   weight: 10, emoji:'☘️', label:'Kleeblatt' },
  { id:'SIEBEN', weight:  4, emoji:'7️⃣', label:'Sieben' },
];
const PAYOUTS = { SIEBEN:100, KLEE:50, HUF:25, ZIT:10, KIR:5 };
// Gewinnlinien (Index je Walze → Zeile 0/1/2)
const LINES = [
  [0,0,0,0,0], // oben
  [1,1,1,1,1], // mitte
  [2,2,2,2,2], // unten
  [0,1,2,1,0], // diagonal ↘︎
  [2,1,0,1,2], // diagonal ↗︎
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

function weightedPick(){
  const total = SYMBOLS.reduce((a,s)=>a+s.weight,0);
  let r = rnd()*total;
  for(const s of SYMBOLS){ if((r-=s.weight)<=0) return s.id; }
  return SYMBOLS[SYMBOLS.length-1].id;
}
function getSym(id){ return SYMBOLS.find(s=>s.id===id); }

// DOM Referenzen
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

seedEl.textContent = STATE.seed;

// Reels vorbereiten (Emoji als Text)
const reelNodes = [];
for(let r=0;r<STATE.reels;r++){
  const reel = document.createElement('div');
  reel.className = 'reel';
  const symbolsWrap = document.createElement('div');
  symbolsWrap.className = 'symbols';
  reel.appendChild(symbolsWrap);

  const STRIP_LEN = 40;
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
  reelNodes.push({reel, symbols:symbolsWrap, offset:0});
}

function setCredits(v){ STATE.credits = v; localStorage.setItem('slot_credits', String(v)); creditsEl.textContent = v; }
function setLastWin(v){ STATE.lastWin = v; lastWinEl.textContent = v; }
function setSeed(newSeed){ STATE.seed = newSeed; localStorage.setItem('slot_seed', String(newSeed)); seedEl.textContent = newSeed; rnd = makePRNG(newSeed); }
function log(msg){ const time = new Date().toLocaleTimeString(); logEl.innerHTML = `<div><b>${time}</b> – ${msg}</div>` + logEl.innerHTML; }

// Sichtbare IDs pro Reel/Row anhand von Geometrie ermitteln
function visibleGrid(){
  const grid = []; // [reel][row]
  for(const rn of reelNodes){
    const rect = rn.reel.getBoundingClientRect();
    const rowCenters = [rect.top+30, rect.top+90, rect.top+150];
    const ids = [null,null,null];
    const symbols = [...rn.symbols.children];
    for(const s of symbols){
      const r = s.getBoundingClientRect();
      const cy = r.top + r.height/2;
      let best=0, dmin=1e9;
      for(let row=0;row<3;row++){ const d=Math.abs(cy-rowCenters[row]); if(d<dmin){dmin=d; best=row;} }
      // nimm den jeweils näheren
      if(ids[best]==null || dmin < 1e9){ ids[best] = s.dataset.id; }
    }
    grid.push(ids.map(id=>id||'KIR'));
  }
  return grid;
}

function evaluateLines(grid, bet){
  let totalWin = 0; const hits = [];
  LINES.forEach((rows, lineIdx)=>{
    const seq = rows.map((row, col)=> grid[col][row]);
    let count = 1; let sym = seq[0];
    for(let i=1;i<seq.length;i++){
      if(seq[i]===sym) count++; else break;
    }
    if(count>=3){
      let mult = 0;
      if(count===3) mult = 1;
      else if(count===4) mult = Math.floor((PAYOUTS[sym]||0) * 0.3);
      else if(count===5) mult = (PAYOUTS[sym]||0);
      const win = mult * bet;
      totalWin += win;
      hits.push({lineIdx, sym, count, mult, win, pattern: seq.join(' | ')});
    }
  });
  return { totalWin, hits };
}

async function spin(){
  if(STATE.spinning) return;
  const bet = Math.max(1, Math.floor(Number(betInput.value)||1));
  if(STATE.credits < bet){ log('Zu wenig Credits.'); return; }
  STATE.spinning = true; btnSpin.disabled = true; btnAuto.disabled = true; btnSeed.disabled = true; betInput.disabled = true;

  setCredits(STATE.credits - bet); STATE.totalIn += bet;

  const DURATION_BASE = 1100; const STAGGER = 180; // etwas kürzer, angenehmer auf Mobile
  const anim = reelNodes.map((rn,i)=>({ start: performance.now()+i*STAGGER, duration: DURATION_BASE + i*160 + (rnd()*220|0), last:0, height:60, stripLen: rn.symbols.children.length }));

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
          const spd = 12*(1 - ease) + 1.5;
          a.last = (a.last + spd) % (a.height * a.stripLen);
          rn.symbols.style.transform = `translateY(${-a.last}px)`;
        } else {
          const mod = a.last % a.height; const snap = a.last - mod + (mod > a.height/2 ? a.height : 0);
          rn.symbols.style.transform = `translateY(${-snap}px)`;
        }
      }
      if(!allDone){ requestAnimationFrame(frame); }
      else {
        const grid = visibleGrid();
        const { totalWin, hits } = evaluateLines(grid, bet);
        setLastWin(totalWin); STATE.totalOut += totalWin; setCredits(STATE.credits + totalWin);
        const rtp = STATE.totalIn ? (STATE.totalOut/STATE.totalIn*100).toFixed(1)+'%' : '–';
        rtpEl.textContent = rtp;
        if(totalWin>0){
          machine.classList.remove('flash-win'); void machine.offsetWidth; machine.classList.add('flash-win');
          hits.forEach(h=> log(`Linie ${h.lineIdx+1}: <b>${getSym(h.sym).label}</b> ×${h.count} (x${h.mult}). Gewinn: <b>${h.win}</b>.`));
        } else { log('Niete.'); }
        STATE.spinning = false; btnSpin.disabled = false; btnAuto.disabled = false; btnSeed.disabled = false; betInput.disabled = false;
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

btnSpin.addEventListener('click', async()=>{ await spin(); if(STATE.auto){ setTimeout(()=>btnSpin.click(), 250); } });
btnAuto.addEventListener('click', ()=>{ STATE.auto=!STATE.auto; btnAuto.textContent = `Auto: ${STATE.auto?'An':'Aus'}`; if(STATE.auto && !STATE.spinning){ btnSpin.click(); } });
btnSeed.addEventListener('click', ()=>{ setSeed(String(Math.floor(Math.random()*1e9))); log('Neuer Seed gesetzt.'); });

// Init
setCredits(STATE.credits); setLastWin(STATE.lastWin); log('Bereit. Drücke „Drehen“.');

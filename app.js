"use strict";

/* ================= geometry (fractions of the Musey cutout) ================= */
const BUTT = { x: 0.403, y: 0.660, rx: 0.300, ry: 0.171 };
const CHEEK_L = { x: 0.257, y: 0.660 };
const CHEEK_R = { x: 0.492, y: 0.671 };
const BODY = { x: 0.47, y: 0.50, rx: 0.40, ry: 0.48 }; // rough whole-Musey ellipse

const $ = (id) => document.getElementById(id);
const stage = $("stage"), wrap = $("musey-wrap"), handEl = $("hand");
const cheekLEl = $("cheek-l"), cheekREl = $("cheek-r");
const blushLEl = $("blush-l"), blushREl = $("blush-r");
const countEl = $("count"), comboEl = $("combo"), comboStat = document.querySelector(".combo-stat");
const milestoneEl = $("milestone"), hintRing = $("hint-ring"), popLayer = $("pop-layer");
const canvas = $("fx"), ctx2d = canvas.getContext("2d");
const headEl = $("head-layer"), printLayer = $("print-layer");
const comboFill = $("combo-fill"), hardestEl = $("hardest");
const ghost1 = $("ghost-1"), ghost2 = $("ghost-2");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const AMP = reducedMotion ? 0.35 : 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

/* ================= persistent state ================= */
let totalSmacks = parseInt(localStorage.getItem("musey-smacks") || "0", 10) || 0;
let muted = localStorage.getItem("musey-muted") === "1";
countEl.textContent = totalSmacks.toLocaleString();
if (totalSmacks > 0) hintRing.classList.add("gone");

function tierName(s) {
  return s < 0.6 ? "pat" : s < 0.9 ? "smack" : s < 1.15 ? "THWACK" : "KRAKOOM";
}
let hardest = parseFloat(localStorage.getItem("musey-hardest") || "0") || 0;
function syncHardest() {
  hardestEl.textContent = hardest > 0 ? tierName(hardest) : "—";
}
syncHardest();

/* ================= clicker economy ================= */
const balanceEl = $("balance"), ratesEl = $("rates"), shopListEl = $("shop-list");
const prestigeInfoEl = $("prestige-info"), prestigeBtn = $("prestige-btn");

const UPGRADES = [
  { id: "padded-palm", name: "Padded Palm", kind: "click", per: 1, base: 15, growth: 1.55, desc: "+1 point per smack" },
  { id: "windup-hand", name: "Wind-Up Hand", kind: "auto", per: 0.2, base: 30, growth: 1.22, desc: "Auto-smacks 0.2x per second" },
  { id: "firm-grip", name: "Firm Grip", kind: "click", per: 4, base: 120, growth: 1.6, desc: "+4 points per smack" },
  { id: "autohand", name: "Auto-Hand 3000", kind: "auto", per: 1, base: 180, growth: 1.24, desc: "Auto-smacks 1x per second" },
  { id: "momentum", name: "Momentum Training", kind: "special", base: 600, desc: "Swing speed counts much more toward points" },
  { id: "combo-grease", name: "Combo Grease", kind: "special", base: 900, desc: "Combo window stretches 0.9s to 1.6s" },
  { id: "titanium-palm", name: "Titanium Palm", kind: "click", per: 20, base: 950, growth: 1.65, desc: "+20 points per smack" },
  { id: "smack-drone", name: "Smack Drone", kind: "auto", per: 5, base: 1100, growth: 1.26, desc: "Auto-smacks 5x per second" },
  { id: "rubber-cheeks", name: "Rubberized Cheeks", kind: "special", base: 1400, desc: "Jiggle lasts way longer. +25% all points" },
  { id: "frenzy-funnel", name: "Frenzy Funnel", kind: "special", base: 2800, desc: "SMACK FRENZY pays 3x points" },
  { id: "echo-smack", name: "Echo Smack", kind: "special", base: 3400, desc: "12% chance a smack echoes for double points" },
  { id: "golden-glove", name: "Golden Glove", kind: "special", base: 6000, desc: "All points x2" },
  { id: "diamond-slapper", name: "Diamond Slapper", kind: "click", per: 90, base: 7500, growth: 1.7, desc: "+90 points per smack" },
  { id: "butler-bot", name: "Butler Bot", kind: "auto", per: 26, base: 7800, growth: 1.28, desc: "Auto-smacks 26x per second. Politely." },
  { id: "critical-palm", name: "Critical Palm", kind: "special", base: 9000, desc: "6% chance of CRITICAL: x10 points" },
  { id: "orbital-cannon", name: "Orbital Smack Cannon", kind: "auto", per: 140, base: 55000, growth: 1.3, desc: "Auto-smacks 140x per second, from space" },
  { id: "platinum-palm", name: "Platinum Palm", kind: "special", base: 60000, desc: "All points x3" },
];

let game = { balance: 0, runEarned: 0, lifetimeEarned: 0, owned: {}, stars: 0, lastSeen: 0 };
try {
  const saved = JSON.parse(localStorage.getItem("musey-clicker-v1") || "null");
  if (saved && typeof saved === "object") game = { ...game, ...saved, owned: saved.owned || {} };
} catch (e) { /* fresh start */ }

function saveGame() {
  game.lastSeen = Date.now();
  try { localStorage.setItem("musey-clicker-v1", JSON.stringify(game)); } catch (e) { /* storage full/blocked */ }
}
window.addEventListener("beforeunload", saveGame);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveGame(); });

const owned = (id) => game.owned[id] || 0;
const has = (id) => owned(id) > 0;

function clickPower() {
  let p = 0;
  for (const u of UPGRADES) if (u.kind === "click") p += u.per * owned(u.id);
  return p;
}
function autoRate() {
  let r = 0;
  for (const u of UPGRADES) if (u.kind === "auto") r += u.per * owned(u.id);
  return r;
}
function globalMult() {
  return (1 + game.stars * 0.15) * (has("golden-glove") ? 2 : 1) *
    (has("platinum-palm") ? 3 : 1) * (has("rubber-cheeks") ? 1.25 : 1);
}
function autoPointsPerSec() {
  return autoRate() * (1 + clickPower()) * 0.6 * globalMult();
}
function perSmackAvg() {
  return (1 + clickPower()) * (0.5 + 0.85 * (has("momentum") ? 1.6 : 0.8)) * globalMult();
}
function addPoints(n) {
  game.balance += n;
  game.runEarned += n;
  game.lifetimeEarned += n;
}

const FMT_UNITS = ["", "K", "M", "B", "T", "Qa", "Qi"];
function fmt(n) {
  if (n < 10 && n % 1 !== 0) return n.toFixed(1);
  if (n < 1000) return String(Math.floor(n));
  let tier = Math.floor(Math.log10(n) / 3);
  tier = Math.min(tier, FMT_UNITS.length - 1);
  const scaled = n / Math.pow(10, tier * 3);
  return (scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)) + FMT_UNITS[tier];
}

function nextCost(u, count) {
  return Math.ceil(u.base * Math.pow(u.growth || 1, count));
}
function comboWindow() {
  return has("combo-grease") ? 1600 : 900;
}
function pendingStars() {
  return Math.floor(Math.sqrt(game.runEarned / 25000));
}

/* ================= audio ================= */
let audioCtx = null, smackBuffer = null, audioTried = false;
let prefetched = null; // raw bytes fetched at load so the first smack is never silent

(async () => {
  for (const url of ["assets/smack.ogg", "assets/smack.wav"]) {
    try {
      const res = await fetch(url);
      if (res.ok) { prefetched = { url, bytes: await res.arrayBuffer() }; return; }
    } catch (e) { /* offline; will retry on first gesture */ }
  }
})();

async function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC({ latencyHint: "interactive" });
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (smackBuffer || audioTried) return;
  audioTried = true;
  const candidates = [];
  if (prefetched) candidates.push(prefetched.bytes.slice(0));
  for (const bytes of candidates) {
    try { smackBuffer = await audioCtx.decodeAudioData(bytes); return; } catch (e) { /* fall through */ }
  }
  for (const url of ["assets/smack.ogg", "assets/smack.wav"]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      smackBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
      break;
    } catch (e) { /* try next format */ }
  }
}
window.addEventListener("pointerdown", () => ensureAudio(), { passive: true });

function playSmack(strength, comboNow) {
  if (muted || !audioCtx || !smackBuffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = smackBuffer;
  // pitch ladder: combos climb
  src.playbackRate.value = 0.9 + 0.28 * strength + Math.min(comboNow || 1, 20) * 0.012 + Math.random() * 0.08;
  const gain = audioCtx.createGain();
  gain.gain.value = clamp(0.45 + 0.55 * strength, 0, 1);
  src.connect(gain).connect(audioCtx.destination);
  src.start();
  // subtle low thump under only the hardest hits
  if (strength > 1.05) {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const og = audioCtx.createGain();
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    og.gain.setValueAtTime(0.22 * (strength - 0.9), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(og).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.18);
  }
}

function playBoop() {
  // the smack sample, slowed + muffled = a soft plush boop
  if (muted || !audioCtx || !smackBuffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = smackBuffer;
  src.playbackRate.value = 0.42;
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 750;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.35;
  src.connect(lp).connect(gain).connect(audioCtx.destination);
  src.start();
}

function playWhoosh() {
  // synthesized air swing for missed slaps
  if (muted || !audioCtx) return;
  const t = audioCtx.currentTime;
  const len = Math.floor(audioCtx.sampleRate * 0.16);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass"; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(1600, t);
  bp.frequency.exponentialRampToValueAtTime(320, t + 0.15);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.16, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  src.connect(bp).connect(gain).connect(audioCtx.destination);
  src.start(t);
}

/* ================= jiggle physics =================
   Each cheek is a damped spring: s = squash (0 rest, + = squished),
   w = sideways sway. The whole body has its own gentler spring. */
function makeCheek(el, blushEl) {
  return { el, blushEl, s: 0, vs: 0, w: 0, vw: 0, blush: 0, dir: 0 };
}
const cheekL = makeCheek(cheekLEl, blushLEl);
const cheekR = makeCheek(cheekREl, blushREl);
const body1 = { s: 0, vs: 0 };
const head1 = { s: 0, vs: 0 }; // laggy head wobble
const pending = []; // delayed impulses for the far cheek
let shakeMag = 0; // px, decays fast
let hitstopUntil = 0; // performance.now() timestamp; physics crawl for impact feel
let lastTauntAt = 0;

function stepSpring(o, k, c, dt) {
  o.vs += (-k * o.s - c * o.vs) * dt;
  o.s += o.vs * dt;
}
function stepCheek(ch, dt) {
  stepSpring(ch, 300, has("rubber-cheeks") ? 3.6 : 5.6, dt);
  ch.vw += (-240 * ch.w - 7 * ch.vw) * dt;
  ch.w += ch.vw * dt;
  ch.blush = Math.max(0, ch.blush - dt * 0.55);
}

function cheekImpulse(ch, strength, dirX) {
  ch.s += 0.15 * strength; // instant dent so impact reads on the same frame
  ch.vs += 19 * strength;
  ch.vw += dirX * 5.5 * strength;
  ch.dir = clamp(dirX, -1.4, 1.4);
  if (strength > 0.3) ch.blush = clamp(ch.blush + 0.3 + 0.55 * strength, 0, 1);
}

function applyTransforms(now) {
  for (const ch of [cheekL, cheekR]) {
    const s = ch.s * AMP, w = ch.w * AMP;
    ch.el.style.transform =
      `translate(${w * 1.1}%, ${s * 0.9}%) rotate(${w * 2.2}deg) skewX(${ch.dir * s * 5}deg) ` +
      `scale(${1 + 0.20 * s}, ${1 - 0.24 * s})`;
    ch.blushEl.style.opacity = (ch.blush * 0.85).toFixed(3);
  }
  const b = body1.s * AMP;
  const breathe = reducedMotion ? 0 : Math.sin(now * 0.0016) * 0.0045;
  const shX = shakeMag > 0.1 ? rand(-shakeMag, shakeMag) : 0;
  const shY = shakeMag > 0.1 ? rand(-shakeMag, shakeMag) * 0.7 : 0;
  wrap.style.transform =
    `translate(${shX}px, ${shY + 0}px) translateY(${b * 0.55}%) ` +
    `scale(${1 + 0.012 * b + breathe}, ${1 - 0.028 * b + breathe})`;
  const hd = head1.s * AMP;
  headEl.style.transform = `rotate(${hd * 3.2}deg) translateY(${Math.abs(hd) * 0.8}%)`;
}

/* ================= particles + impact rings ================= */
let particles = [], rings = [];
let stageRectCache = null; // refreshed on resize/scroll only — never force layout per frame/event
function refreshStageRect() {
  stageRectCache = stage.getBoundingClientRect();
  return stageRectCache;
}
function sizeCanvas() {
  handSize = null; // hand size is viewport-relative (vmin clamp)
  const r = refreshStageRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", sizeCanvas);
window.addEventListener("scroll", refreshStageRect, { passive: true });

function spawnFX(x, y, strength, dirX, burst) {
  if (reducedMotion) return;
  const r = stageRectCache || refreshStageRect();
  const px = x * r.width, py = y * r.height;
  const colors = burst
    ? ["#ffffff", "#f2a0ae", "#d94f63", "#ffb37a", "#ffd9cf", "#c22544"]
    : ["#ffffff", "#f2a0ae", "#d94f63", "#ffd9cf"];
  const n = burst ? 70 : Math.round(10 + strength * 12);
  for (let i = 0; i < n; i++) {
    const ang = rand(0, Math.PI * 2);
    const spd = rand(60, 260) * (0.6 + strength * 0.6);
    particles.push({
      x: px, y: py,
      vx: Math.cos(ang) * spd + dirX * 70, vy: Math.sin(ang) * spd - (burst ? 190 : 60),
      life: 0, ttl: burst ? rand(0.7, 1.25) : rand(0.3, 0.55),
      size: rand(2, 5.5) * (0.7 + strength * 0.4),
      color: colors[(Math.random() * colors.length) | 0],
      streak: Math.random() < 0.4,
    });
  }
  rings.push({ x: px, y: py, r: 6, life: 0, ttl: 0.35, max: 55 + strength * 55 });
}

function drawFX(dt) {
  const r = stageRectCache || refreshStageRect();
  ctx2d.clearRect(0, 0, r.width, r.height);
  particles = particles.filter((p) => (p.life += dt) < p.ttl);
  for (const p of particles) {
    p.vy += 850 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const a = 1 - p.life / p.ttl;
    ctx2d.globalAlpha = a;
    ctx2d.fillStyle = p.color;
    ctx2d.strokeStyle = p.color;
    if (p.streak) {
      ctx2d.lineWidth = p.size * 0.55;
      ctx2d.beginPath();
      ctx2d.moveTo(p.x, p.y);
      ctx2d.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
      ctx2d.stroke();
    } else {
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
  rings = rings.filter((g) => (g.life += dt) < g.ttl);
  for (const g of rings) {
    const t = g.life / g.ttl;
    ctx2d.globalAlpha = (1 - t) * 0.65;
    ctx2d.strokeStyle = "#ffffff";
    ctx2d.lineWidth = 3.5 * (1 - t) + 0.5;
    ctx2d.beginPath();
    ctx2d.ellipse(g.x, g.y, g.r + g.max * t, (g.r + g.max * t) * 0.72, 0, 0, Math.PI * 2);
    ctx2d.stroke();
  }
  ctx2d.globalAlpha = 1;
}

/* ================= pop words + milestones ================= */
const WORDS_SOFT = ["pat!", "tap!", "boop!"];
const WORDS_MID = ["SMACK!", "WHAP!", "SLAP!", "THWACK!"];
const WORDS_HARD = ["THWACK!!", "WALLOP!!", "SMACK!!", "KRAKOOM!"];

let activePrints = 0;
function spawnHandprint(fx, fy, strength, angleDeg) {
  if (reducedMotion || activePrints >= 5) return;
  activePrints++;
  const el = document.createElement("div");
  el.className = "handprint";
  el.innerHTML = '<img src="assets/handprint.png" alt="" draggable="false">';
  const w = 24 + strength * 13; // % of stage width
  el.style.width = w + "%";
  el.style.left = fx * 100 + "%";
  el.style.top = fy * 100 + "%";
  printLayer.appendChild(el);
  const base = `translate(-50%,-52%) rotate(${angleDeg}deg)`;
  el.animate([
    { transform: base + " scale(0.86)", opacity: 0 },
    { transform: base + " scale(1.02)", opacity: 0.5, offset: 0.12 },
    { transform: base + " scale(1.07)", opacity: 0 },
  ], { duration: 2400, easing: "ease-out" }).onfinish = () => { el.remove(); activePrints--; };
}

function spawnPop(x, y, strength, frenzy, wordOverride) {
  if (reducedMotion) return;
  const words = strength < 0.6 ? WORDS_SOFT : strength < 1.05 ? WORDS_MID : WORDS_HARD;
  const el = document.createElement("div");
  el.className = "pop" + (frenzy ? " frenzy-pop" : "") + (wordOverride ? " crit" : "");
  el.textContent = wordOverride || words[(Math.random() * words.length) | 0];
  el.style.left = x * 100 + "%";
  el.style.top = y * 100 + "%";
  el.style.fontSize = (1.05 + strength * 0.85) + "rem";
  popLayer.appendChild(el);
  const rot = rand(-14, 14);
  el.animate([
    { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(0.5)`, opacity: 0 },
    { transform: `translate(-50%,-90%) rotate(${rot}deg) scale(1.15)`, opacity: 1, offset: 0.25 },
    { transform: `translate(-50%,-280%) rotate(${rot}deg) scale(1)`, opacity: 0 },
  ], { duration: 680, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => el.remove();
}

const MILESTONES = {
  1: "First smack! He felt that one.",
  10: "10 smacks! Musey is rethinking the mascot gig.",
  25: "25! That butt has its own weather system now.",
  50: "50 smacks! HR has been notified. HR is also smacking.",
  100: "100!! Certified Butt Smacker. Musey respects the hustle.",
  250: "250. The jiggle has achieved sentience.",
  500: "500 smacks. Scientists are studying the ripples.",
  1000: "1,000!!! You have smacked beyond science. Musey bows to you.",
};
let milestoneTimer = 0;
function showMilestone(text) {
  milestoneEl.textContent = text;
  clearTimeout(milestoneTimer);
  milestoneTimer = setTimeout(() => { milestoneEl.textContent = ""; }, 4200);
}

/* ================= smacking ================= */
let combo = 0, lastSmackAt = 0;

function doSmack(fx, fy, strength, dirX) {
  const now = performance.now();
  combo = now - lastSmackAt < comboWindow() ? combo + 1 : 1;
  lastSmackAt = now;
  totalSmacks++;
  countEl.textContent = totalSmacks.toLocaleString();
  localStorage.setItem("musey-smacks", String(totalSmacks));
  hintRing.classList.add("gone");
  if (strength > hardest) {
    hardest = strength;
    localStorage.setItem("musey-hardest", String(hardest));
    syncHardest();
  }
  const isMilestone = !!MILESTONES[totalSmacks];
  if (isMilestone) showMilestone(MILESTONES[totalSmacks]);
  if (combo === 8) showMilestone("SMACK FRENZY!! He can't keep getting away with— wait, yes he can.");
  updateCombo();

  // nearer cheek takes the hit (x weighted; image is taller than wide)
  const dL = Math.hypot((fx - CHEEK_L.x) * 1.17, fy - CHEEK_L.y);
  const dR = Math.hypot((fx - CHEEK_R.x) * 1.17, fy - CHEEK_R.y);
  const hit = dL <= dR ? cheekL : cheekR;
  const other = dL <= dR ? cheekR : cheekL;
  cheekImpulse(hit, strength, dirX);
  pending.push({ at: now + 45, ch: other, amt: strength * 0.6, dirX: dirX * 0.7 });
  pending.push({ at: now + 70, ch: null, amt: strength, dirX }); // head wobble, handled specially
  body1.vs += 5.5 * strength;

  // clicker: points for this smack
  const isCrit = has("critical-palm") && Math.random() < 0.06;
  const isEcho = has("echo-smack") && Math.random() < 0.12;
  let gain = (1 + clickPower()) *
    (0.5 + strength * (has("momentum") ? 1.6 : 0.8)) *
    (1 + 0.03 * Math.min(combo - 1, 40)) *
    (combo >= 8 && has("frenzy-funnel") ? 3 : 1) *
    globalMult() * (isCrit ? 10 : 1) * (isEcho ? 2 : 1);
  addPoints(gain);

  if (strength > 0.85 || isCrit) shakeMag = Math.max(shakeMag, (strength - 0.8) * 11 + (isCrit ? 5 : 0));
  if (strength > 1.15 && !reducedMotion && now >= hitstopUntil) hitstopUntil = now + 18;

  // render the first squash frame synchronously — no waiting for rAF
  stepCheek(cheekL, 1 / 120); stepCheek(cheekR, 1 / 120); stepSpring(body1, 220, 9, 1 / 120);
  applyTransforms(now);

  playSmack(strength, combo);
  spawnFX(fx, fy, strength, dirX, isMilestone);
  spawnPop(fx, fy - 0.04, strength + Math.min(combo, 14) * 0.035, combo >= 8, isCrit ? "CRITICAL!!" : null);
  spawnGain(fx + 0.07, fy - 0.02, gain, isCrit);
  spawnHandprint(fx, fy, strength, currentHandRot);
  if (isEcho) {
    setTimeout(() => {
      cheekImpulse(hit, strength * 0.6, dirX);
      playSmack(strength * 0.65, combo);
    }, 130);
  }
  if (navigator.vibrate) navigator.vibrate(Math.round(12 + strength * 18));
}

function updateCombo() {
  if (combo >= 3) {
    comboEl.textContent = "x" + combo;
    comboStat.classList.add("hot");
  } else {
    comboEl.innerHTML = "&nbsp;";
    comboStat.classList.remove("hot");
  }
  document.documentElement.classList.toggle("frenzy", combo >= 8);
  if (combo === 0) comboFill.style.width = "0%";
}

function gentleBoop() {
  body1.vs += 2.2;
}

/* ================= pointer + hand ================= */
const inEllipse = (x, y, e, pad = 1) =>
  ((x - e.x) / (e.rx * pad)) ** 2 + ((y - e.y) / (e.ry * pad)) ** 2 <= 1;

let pointer = { x: -999, y: -999, tx: -999, ty: -999, vx: 0, vy: 0, speed: 0, downAt: 0 };
let handPos = { x: -999, y: -999 };
let ghost1Pos = { x: -999, y: -999 }, ghost2Pos = { x: -999, y: -999 };
let currentHandRot = 0;
let slapStart = -9999;
let wasInButt = false;
let lastMoveAt = 0;

function stageFrac(clientX, clientY) {
  const r = stageRectCache || refreshStageRect();
  return { fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height, r };
}

function aimPoint(e) {
  // on touch, aim where the visible hand palm is (above the finger)
  return e.pointerType === "touch"
    ? { x: e.clientX, y: e.clientY - 72 }
    : { x: e.clientX, y: e.clientY };
}

window.addEventListener("pointermove", (e) => {
  // use the freshest coalesced sample so high-rate mice don't queue up lag
  let src = e;
  if (typeof e.getCoalescedEvents === "function") {
    const coalesced = e.getCoalescedEvents();
    if (coalesced.length) src = coalesced[coalesced.length - 1];
  }
  const aim = aimPoint(src);
  const now = performance.now();
  const dt = Math.max(now - lastMoveAt, 1);
  if (pointer.tx > -900 && lastMoveAt) {
    const ivx = (aim.x - pointer.tx) / dt, ivy = (aim.y - pointer.ty) / dt; // px per ms
    pointer.vx = pointer.vx * 0.55 + ivx * 0.45;
    pointer.vy = pointer.vy * 0.55 + ivy * 0.45;
    pointer.speed = pointer.speed * 0.55 + Math.hypot(ivx, ivy) * 0.45;
  }
  pointer.tx = aim.x; pointer.ty = aim.y;
  lastMoveAt = now;
  if (handPos.x < -900) { handPos.x = aim.x; handPos.y = aim.y; }
  handEl.classList.add("on");
  document.documentElement.classList.add("hand-active");

  // swipe-through smack: fast hand entering the butt
  const { fx, fy } = stageFrac(aim.x, aim.y);
  const inside = inEllipse(fx, fy, BUTT, 0.92);
  if (inside && !wasInButt && pointer.speed > 1.05 && now - lastSmackAt > 160) {
    doSmack(fx, fy, clamp(pointer.speed / 2.4, 0.55, 1.45), clamp(pointer.vx, -1.4, 1.4));
    slapStart = now;
  }
  wasInButt = inside;
  paintHand(now); // draw the hand NOW, don't wait for the next animation frame

  // restore normal cursor over real buttons
  const overUI = !!(e.target && typeof e.target.closest === "function" && e.target.closest("button"));
  document.documentElement.classList.toggle("over-ui", overUI);
  handEl.style.opacity = overUI ? "0" : "";
}, { passive: true });

document.documentElement.addEventListener("mouseleave", () => {
  handEl.classList.remove("on");
});

stage.addEventListener("pointerdown", (e) => {
  ensureAudio();
  slapStart = performance.now();
  paintHand(slapStart);
  const aim = aimPoint(e);
  handPos.x = aim.x; handPos.y = aim.y;
  handEl.classList.add("on");
  const { fx, fy } = stageFrac(aim.x, aim.y);
  if (inEllipse(fx, fy, BUTT, 1.0)) {
    const strength = clamp(0.55 + pointer.speed / 3.0, 0.55, 1.35);
    doSmack(fx, fy, strength, clamp(pointer.vx, -1.4, 1.4));
  } else if (inEllipse(fx, fy, BODY, 1.0)) {
    gentleBoop();
    playBoop();
  } else {
    playWhoosh();
  }
  e.preventDefault();
});

stage.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    ensureAudio();
    slapStart = performance.now();
    doSmack(BUTT.x + rand(-0.08, 0.08), BUTT.y + rand(-0.03, 0.03), 0.85, rand(-0.4, 0.4));
  }
});

stage.addEventListener("dragstart", (e) => e.preventDefault());
stage.addEventListener("contextmenu", (e) => e.preventDefault());

/* ================= shop ================= */
let buyMode = 1; // 1 | 10 | "max"

function spawnGain(x, y, amount, crit) {
  if (reducedMotion) return;
  const el = document.createElement("div");
  el.className = "pop gain" + (crit ? " crit" : "");
  el.textContent = "+" + fmt(amount);
  el.style.left = clamp(x, 0.05, 0.9) * 100 + "%";
  el.style.top = y * 100 + "%";
  if (crit) el.style.fontSize = "1.35rem";
  popLayer.appendChild(el);
  el.animate([
    { transform: "translate(-50%,-50%) scale(0.7)", opacity: 0 },
    { transform: "translate(-50%,-120%) scale(1.05)", opacity: 1, offset: 0.3 },
    { transform: "translate(-50%,-230%) scale(1)", opacity: 0 },
  ], { duration: 820, easing: "ease-out" }).onfinish = () => el.remove();
}

function planPurchase(u) {
  const count = owned(u.id);
  if (u.kind === "special" && count >= 1) return { n: 0, cost: 0, maxed: true };
  let want = u.kind === "special" ? 1 : buyMode === "max" ? 1000 : buyMode;
  let cost = 0, n = 0;
  while (n < want) {
    const c = nextCost(u, count + n);
    if (game.balance < cost + c) break;
    cost += c; n++;
  }
  if (n === 0) return { n: 0, cost: nextCost(u, count), maxed: false };
  return { n, cost, maxed: false };
}

function buildShop() {
  shopListEl.innerHTML = "";
  for (const u of UPGRADES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "upgrade";
    btn.dataset.upgrade = u.id;
    btn.setAttribute("aria-label", `Buy ${u.name}: ${u.desc}`);
    btn.innerHTML =
      `<span class="up-icon"><img src="assets/icons/${u.id}.webp" alt="" loading="lazy" draggable="false"></span>` +
      `<span class="up-main"><span class="up-name">${u.name}<span class="up-owned"></span></span>` +
      `<span class="up-desc">${u.desc}</span></span>` +
      `<span class="up-cost"><img src="assets/icons/coin.webp" alt="" draggable="false"><span class="up-cost-num"></span></span>`;
    btn.addEventListener("click", () => buyUpgrade(u));
    u._btn = btn;
    u._costEl = btn.querySelector(".up-cost-num");
    u._ownedEl = btn.querySelector(".up-owned");
    shopListEl.appendChild(btn);
  }
}

function buyUpgrade(u) {
  const plan = planPurchase(u);
  if (plan.n <= 0) return;
  game.balance -= plan.cost;
  game.owned[u.id] = owned(u.id) + plan.n;
  playBoop();
  updateShop();
  saveGame();
}

function updateShop() {
  balanceEl.textContent = fmt(game.balance);
  const sps = autoPointsPerSec();
  ratesEl.textContent =
    `≈ ${fmt(perSmackAvg())} pts/smack` +
    (autoRate() > 0 ? `  •  ${fmt(sps)} pts/s auto (${fmt(autoRate())} smacks/s)` : "") +
    (game.stars > 0 ? `  •  ★${game.stars} (+${Math.round(game.stars * 15)}%)` : "");
  for (const u of UPGRADES) {
    if (!u._btn) continue;
    const plan = planPurchase(u);
    const count = owned(u.id);
    if (plan.maxed) {
      u._btn.disabled = true;
      u._btn.classList.add("maxed");
      u._btn.classList.remove("afford");
      u._costEl.textContent = "Owned";
    } else {
      u._btn.disabled = plan.n <= 0;
      u._btn.classList.toggle("afford", plan.n > 0);
      u._btn.classList.remove("maxed");
      u._costEl.textContent = (plan.n > 1 ? `${plan.n}× ` : "") + fmt(plan.n > 0 ? plan.cost : nextCost(u, count));
    }
    u._ownedEl.textContent = count > 0 ? (u.kind === "special" ? "Owned" : `Owned: ${count}`) : "";
    u._ownedEl.style.display = count > 0 ? "" : "none";
  }
  const pending = pendingStars();
  prestigeInfoEl.innerHTML =
    `★ <b>${game.stars}</b> Butt Stars owned (+15% points each, forever).<br>` +
    (pending > 0
      ? `Prestige now for <b>+${pending} ★</b> — resets points & upgrades.`
      : `Earn ${fmt(25000 - game.runEarned > 0 ? 25000 - game.runEarned : 0)} more pts this run for your next ★.`);
  prestigeBtn.disabled = pending <= 0;
}

for (const [id, mode] of [["buy-1", 1], ["buy-10", 10], ["buy-max", "max"]]) {
  $(id).addEventListener("click", () => {
    buyMode = mode;
    for (const b of document.querySelectorAll(".buy-toggle button")) b.classList.remove("on");
    $(id).classList.add("on");
    updateShop();
  });
}

let prestigeArmedUntil = 0;
prestigeBtn.addEventListener("click", () => {
  const pending = pendingStars();
  if (pending <= 0) return;
  const now = performance.now();
  if (now > prestigeArmedUntil) {
    prestigeArmedUntil = now + 3000;
    prestigeBtn.textContent = "Really reset?";
    prestigeBtn.classList.add("confirm");
    setTimeout(() => {
      prestigeBtn.textContent = "Prestige";
      prestigeBtn.classList.remove("confirm");
    }, 3000);
    return;
  }
  game.stars += pending;
  game.balance = 0;
  game.runEarned = 0;
  game.owned = {};
  prestigeArmedUntil = 0;
  prestigeBtn.textContent = "Prestige";
  prestigeBtn.classList.remove("confirm");
  showMilestone(`★ Prestige! +${pending} Butt Stars. A fresh Musey approaches, butt unsmacked... for now.`);
  spawnFX(BUTT.x, BUTT.y, 1.2, 0, true);
  updateShop();
  saveGame();
});

function applyOffline() {
  if (!game.lastSeen || autoRate() <= 0) return;
  const elapsed = (Date.now() - game.lastSeen) / 1000;
  if (elapsed < 120) return;
  const capped = Math.min(elapsed, 8 * 3600);
  const pts = autoPointsPerSec() * capped * 0.5;
  const smacks = Math.floor(autoRate() * capped * 0.5);
  if (pts < 1) return;
  addPoints(pts);
  totalSmacks += smacks;
  countEl.textContent = totalSmacks.toLocaleString();
  localStorage.setItem("musey-smacks", String(totalSmacks));
  showMilestone(`While you were gone, your auto-smackers delivered ${fmt(smacks)} smacks (+${fmt(pts)} pts)!`);
}

/* ================= buttons ================= */
const muteBtn = $("mute-btn");
function syncMute() {
  muteBtn.textContent = muted ? "Sound: off" : "Sound: on";
  muteBtn.setAttribute("aria-pressed", String(muted));
}
muteBtn.addEventListener("click", () => {
  muted = !muted;
  localStorage.setItem("musey-muted", muted ? "1" : "0");
  syncMute();
  if (!muted) ensureAudio();
});
syncMute();

$("share-btn").addEventListener("click", async () => {
  const text = totalSmacks === 0
    ? "I have smacked Musey's butt 0 times. I am about to fix that."
    : `I have smacked Musey's butt ${totalSmacks.toLocaleString()} time${totalSmacks === 1 ? "" : "s"} (hardest: ${tierName(hardest)}). He knows what he did.`;
  try {
    if (navigator.share) {
      // give the share sheet a moment; if it never settles (some desktops/headless), fall back
      const settled = await Promise.race([
        navigator.share({ text }).then(() => true).catch(() => false),
        new Promise((res) => setTimeout(() => res(false), 1200)),
      ]);
      if (settled) return;
    }
    throw new Error("no native share");
  } catch (e) {
    try {
      await navigator.clipboard.writeText(text);
      showMilestone("Copied. Go brag about it.");
    } catch (e2) {
      showMilestone(text);
    }
  }
});

$("reset-btn").addEventListener("click", () => {
  totalSmacks = 0;
  combo = 0;
  countEl.textContent = "0";
  localStorage.setItem("musey-smacks", "0");
  updateCombo();
  showMilestone("Forgiven. For now.");
});

/* ================= hand painting (shared by pointermove + rAF) ================= */
let lastPaintAt = 0;
let handSize = null;
function getHandSize() {
  if (!handSize) handSize = { w: handEl.offsetWidth, h: handEl.offsetHeight };
  return handSize;
}

function paintHand(now) {
  if (handPos.x < -900 || pointer.tx < -900) return;
  const elapsed = lastPaintAt ? clamp(now - lastPaintAt, 0.1, 50) : 16.7;
  lastPaintAt = now;
  // ~11ms time constant: hand stays glued to the cursor (ghosts provide the trail)
  const f = 1 - Math.exp(-elapsed / 11);
  handPos.x += (pointer.tx - handPos.x) * f;
  handPos.y += (pointer.ty - handPos.y) * f;
  if (Math.abs(pointer.tx - handPos.x) < 0.5) handPos.x = pointer.tx;
  if (Math.abs(pointer.ty - handPos.y) < 0.5) handPos.y = pointer.ty;

  const { w: hw, h: hh } = getHandSize();
  let rot = clamp(pointer.vx * 16, -36, 36) + clamp(pointer.vy * 6, -12, 12);
  let scale = 1;
  const slapT = (now - slapStart) / 170;
  if (slapT < 1) {
    const s = Math.sin(slapT * Math.PI);
    rot += -30 * Math.pow(s, 1.3);
    scale = 1 - 0.13 * s;
  }
  currentHandRot = rot;
  handEl.style.transform =
    `translate(${handPos.x - hw * 0.5}px, ${handPos.y - hh * 0.52}px) rotate(${rot}deg) scale(${scale})`;

  // motion-trail ghosts while swinging fast (they keep the laggy follow, on purpose)
  if (ghost1Pos.x < -900) { ghost1Pos = { ...handPos }; ghost2Pos = { ...handPos }; }
  const gf = 1 - Math.exp(-elapsed / 55);
  ghost1Pos.x += (handPos.x - ghost1Pos.x) * gf;
  ghost1Pos.y += (handPos.y - ghost1Pos.y) * gf;
  ghost2Pos.x += (ghost1Pos.x - ghost2Pos.x) * gf;
  ghost2Pos.y += (ghost1Pos.y - ghost2Pos.y) * gf;
  const trail = reducedMotion || document.documentElement.classList.contains("over-ui")
    ? 0 : clamp(pointer.speed / 1.8, 0, 1);
  ghost1.style.opacity = (0.26 * trail).toFixed(3);
  ghost2.style.opacity = (0.14 * trail).toFixed(3);
  ghost1.style.transform =
    `translate(${ghost1Pos.x - hw * 0.5}px, ${ghost1Pos.y - hh * 0.52}px) rotate(${rot * 0.85}deg) scale(${scale * 0.97})`;
  ghost2.style.transform =
    `translate(${ghost2Pos.x - hw * 0.5}px, ${ghost2Pos.y - hh * 0.52}px) rotate(${rot * 0.7}deg) scale(${scale * 0.94})`;
}

/* ================= main loop ================= */
let lastT = performance.now();
let autoSmackAcc = 0, autoJiggleT = 1, shopTickT = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - lastT) / 1000, 0.033);
  lastT = now;
  const physDt = now < hitstopUntil ? dt * 0.08 : dt; // micro freeze-frame on huge hits

  // physics (2 substeps for stability)
  for (let i = 0; i < 2; i++) {
    stepCheek(cheekL, physDt / 2);
    stepCheek(cheekR, physDt / 2);
    stepSpring(body1, 220, 9, physDt / 2);
    stepSpring(head1, 140, 6, physDt / 2);
  }
  for (let i = pending.length - 1; i >= 0; i--) {
    if (now >= pending[i].at) {
      if (pending[i].ch) cheekImpulse(pending[i].ch, pending[i].amt, pending[i].dirX);
      else head1.vs += pending[i].amt * (1.7 + pending[i].dirX * 0.9);
      pending.splice(i, 1);
    }
  }
  shakeMag *= Math.pow(0.0005, dt);
  if (shakeMag < 0.05) shakeMag = 0;
  applyTransforms(now);

  // combo expiry + timer bar
  if (combo > 0) {
    comboFill.style.width = clamp(100 * (1 - (now - lastSmackAt) / comboWindow()), 0, 100) + "%";
    if (now - lastSmackAt > comboWindow()) { combo = 0; updateCombo(); }
  }

  // clicker: auto-smackers earn continuously; butt jiggles on its own
  const aRate = autoRate();
  if (aRate > 0) {
    addPoints(autoPointsPerSec() * dt);
    autoSmackAcc += aRate * dt;
    const whole = Math.floor(autoSmackAcc);
    if (whole > 0) {
      autoSmackAcc -= whole;
      const prevTotal = totalSmacks;
      totalSmacks += whole;
      countEl.textContent = totalSmacks.toLocaleString();
      for (const k of Object.keys(MILESTONES)) {
        if (prevTotal < +k && totalSmacks >= +k) showMilestone(MILESTONES[k]);
      }
      localStorage.setItem("musey-smacks", String(totalSmacks));
    }
    autoJiggleT -= dt;
    if (autoJiggleT <= 0) {
      autoJiggleT = clamp(2.4 / aRate, 0.45, 2.6);
      cheekImpulse(Math.random() < 0.5 ? cheekL : cheekR,
        clamp(0.15 + Math.sqrt(aRate) * 0.045, 0.15, 0.5), rand(-0.7, 0.7));
      body1.vs += 0.5;
    }
  }
  shopTickT -= dt;
  if (shopTickT <= 0) { shopTickT = 0.15; updateShop(); }

  // idle taunt: left alone too long, the butt wiggles invitingly
  if (!reducedMotion && now - lastSmackAt > 7000 && now - lastTauntAt > 11000 && lastSmackAt !== 0) {
    lastTauntAt = now;
    lastSmackAt = now - 7000; // don't re-arm instantly
    pending.push({ at: now, ch: cheekL, amt: 0.17, dirX: -0.5 });
    pending.push({ at: now + 170, ch: cheekR, amt: 0.17, dirX: 0.5 });
    pending.push({ at: now + 340, ch: cheekL, amt: 0.15, dirX: -0.5 });
    pending.push({ at: now + 510, ch: cheekR, amt: 0.15, dirX: 0.5 });
  }

  // hand follow + tilt + slap animation (also painted directly on pointermove)
  pointer.speed *= Math.pow(0.02, dt); // decay when idle
  pointer.vx *= Math.pow(0.02, dt);
  pointer.vy *= Math.pow(0.02, dt);
  paintHand(now);

  drawFX(dt);
}

sizeCanvas();
buildShop();
updateShop();
applyOffline();
setInterval(saveGame, 5000);
requestAnimationFrame(frame);

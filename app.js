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
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/* ================= persistent state ================= */
let totalSmacks = parseInt(localStorage.getItem("musey-smacks") || "0", 10) || 0;
let muted = localStorage.getItem("musey-muted") === "1";
let smackSavedAt = 0;
function renderTotalSmacks(forceSave = false) {
  setText(countEl, totalSmacks.toLocaleString());
  const now = Date.now();
  if (forceSave || now - smackSavedAt >= 1000) {
    smackSavedAt = now;
    try { localStorage.setItem("musey-smacks", String(totalSmacks)); } catch (e) { /* storage blocked */ }
  }
}
window.addEventListener("beforeunload", () => renderTotalSmacks(true));
renderTotalSmacks(true);
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
  { id: "padded-palm", name: "Padded Palm", kind: "click", per: 1, base: 30, growth: 1.2, desc: "+1 base point per smack" },
  { id: "windup-hand", name: "Wind-Up Hand", kind: "auto", per: 0.5, base: 30, growth: 1.2, desc: "Auto-smacks 0.5x per second" },
  { id: "autohand", name: "Auto-Hand 3000", kind: "auto", per: 2, base: 260, growth: 1.2, desc: "Auto-smacks 2x per second" },
  { id: "firm-grip", name: "Firm Grip", kind: "click", per: 5, base: 500, growth: 1.2, desc: "+5 base points per smack" },
  { id: "momentum", name: "Momentum Training", kind: "special", base: 750, desc: "+30% points from your smacks" },
  { id: "combo-grease", name: "Combo Grease", kind: "special", base: 1800, desc: "Combo lasts 1.6s; each stack +5%" },
  { id: "smack-drone", name: "Smack Drone", kind: "auto", per: 10, base: 2900, growth: 1.2, desc: "Auto-smacks 10x per second" },
  { id: "rubber-cheeks", name: "Rubberized Cheeks", kind: "special", base: 7500, desc: "Jiggle lasts way longer. +25% all points" },
  { id: "titanium-palm", name: "Titanium Palm", kind: "click", per: 25, base: 8500, growth: 1.2, desc: "+25 base points per smack" },
  { id: "echo-smack", name: "Echo Smack", kind: "special", base: 12000, desc: "15% chance a smack echoes for double points" },
  { id: "frenzy-funnel", name: "Frenzy Funnel", kind: "special", base: 25000, desc: "SMACK FRENZY smacks pay +50%" },
  { id: "butler-bot", name: "Butler Bot", kind: "auto", per: 50, base: 32000, growth: 1.2, desc: "Auto-smacks 50x per second. Politely." },
  { id: "golden-glove", name: "Golden Glove", kind: "special", base: 75000, desc: "All points x2" },
  { id: "critical-palm", name: "Critical Palm", kind: "special", base: 90000, desc: "8% chance of CRITICAL: x10 points" },
  { id: "diamond-slapper", name: "Diamond Slapper", kind: "click", per: 125, base: 145000, growth: 1.2, desc: "+125 base points per smack" },
  { id: "orbital-cannon", name: "Orbital Smack Cannon", kind: "auto", per: 300, base: 420000, growth: 1.2, desc: "Auto-smacks 300x per second, from space" },
  { id: "platinum-palm", name: "Platinum Palm", kind: "special", base: 1500000, desc: "All points x3" },
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

function clickPowerFrom(map = game.owned) {
  let p = 0;
  for (const u of UPGRADES) if (u.kind === "click") p += u.per * (map[u.id] || 0);
  return p;
}
function clickPower() { return clickPowerFrom(); }
function autoRateFrom(map = game.owned) {
  let r = 0;
  for (const u of UPGRADES) if (u.kind === "auto") r += u.per * (map[u.id] || 0);
  return r;
}
function autoRate() { return autoRateFrom(); }
function globalMultFrom(map = game.owned) {
  const get = (id) => (map[id] || 0) > 0;
  return (1 + game.stars * 0.15) * (get("golden-glove") ? 2 : 1) *
    (get("platinum-palm") ? 3 : 1) * (get("rubber-cheeks") ? 1.25 : 1);
}
function globalMult() { return globalMultFrom(); }

let manualSmackTimes = [];
function estimatedManualRate() {
  const cutoff = performance.now() - 30000;
  while (manualSmackTimes.length && manualSmackTimes[0] < cutoff) manualSmackTimes.shift();
  if (manualSmackTimes.length < 4) return 1.5;
  const spanSec = Math.max((manualSmackTimes[manualSmackTimes.length - 1] - manualSmackTimes[0]) / 1000, 1);
  return clamp((manualSmackTimes.length - 1) / spanSec, 0.25, 5);
}
function comboBonusPerStack(map = game.owned) {
  return (map["combo-grease"] || 0) > 0 ? 0.05 : 0.03;
}

// One shared income model drives both real auto earnings and shop value labels.
// Manual values use a typical 0.85-strength smack, your recent pace, expected
// combo size, and the expected value of echo/critical rolls.
function expectedIncome(map = game.owned) {
  const get = (id) => (map[id] || 0) > 0;
  const rate = estimatedManualRate();
  const power = clickPowerFrom(map);
  const autos = autoRateFrom(map);
  const mult = globalMultFrom(map);
  const comboStacks = clamp(4 + rate * 4, 0, 40);
  const frenzyUptime = clamp(comboStacks / 8, 0, 1) * 0.8;
  const manualPerSmack = (1 + power) * (0.5 + 0.85 * 0.8) *
    (1 + comboBonusPerStack(map) * comboStacks) *
    (get("momentum") ? 1.3 : 1) *
    (get("echo-smack") ? 1.15 : 1) *
    (get("critical-palm") ? 1.72 : 1) *
    (1 + (get("frenzy-funnel") ? 0.5 * frenzyUptime : 0)) * mult;
  const manual = rate * manualPerSmack;
  // Click power helps autos only with square-root scaling, not 1:1. This keeps
  // either path from completely invalidating the other late in a run.
  const auto = autos * (1 + Math.sqrt(power)) * mult;
  return { manual, auto, total: manual + auto, manualPerSmack, manualRate: rate, comboStacks, frenzyUptime };
}
function autoPointsPerSec() {
  return expectedIncome().auto;
}
function perSmackAvg() {
  return expectedIncome().manualPerSmack;
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
function fmtRate(n) {
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return fmt(n);
}
function formatPayback(sec) {
  if (!Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.max(1, Math.ceil(sec))}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(sec < 600 ? 1 : 0)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}
function purchaseValue(u, plan) {
  if (plan.maxed) return { n: 0, cost: 0, delta: 0, payback: Infinity };
  const n = plan.n > 0 ? plan.n : 1;
  const cost = plan.n > 0 ? plan.cost : nextCost(u, owned(u.id));
  const before = expectedIncome().total;
  const afterMap = { ...game.owned, [u.id]: owned(u.id) + n };
  const delta = Math.max(0, expectedIncome(afterMap).total - before);
  return { n, cost, delta, payback: delta > 0 ? cost / delta : Infinity };
}
const STAR_POINT_THRESHOLD = 100000;
function pendingStars() {
  return Math.floor(Math.sqrt(game.runEarned / STAR_POINT_THRESHOLD));
}
function pointsToNextStar() {
  return Math.max(0, Math.pow(pendingStars() + 1, 2) * STAR_POINT_THRESHOLD - game.runEarned);
}

/* ================= audio ================= */
let audioCtx = null, smackBuffer = null, decodeStarted = false;
let pendingPlay = null; // a smack that landed while the sample was still decoding

function createCtx() {
  if (audioCtx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  audioCtx = new AC({ latencyHint: "interactive" });
  return true;
}

// Fetch + decode immediately at page load. Decoding works while the context
// is still suspended (browsers only gate *playback* on a user gesture), so
// the sample is ready long before the first smack instead of after it.
async function decodeSmack() {
  if (decodeStarted || smackBuffer || !createCtx()) return;
  decodeStarted = true;
  for (const url of ["assets/smack.ogg", "assets/smack.wav"]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      smackBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
      break;
    } catch (e) { /* try next format */ }
  }
  if (smackBuffer && pendingPlay && performance.now() - pendingPlay.at < 600) {
    playSmackNow(pendingPlay.strength, pendingPlay.comboNow, pendingPlay.vol);
  }
  pendingPlay = null;
}
decodeSmack();

async function ensureAudio() {
  if (!createCtx()) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  decodeSmack();
}
window.addEventListener("pointerdown", () => ensureAudio(), { passive: true });

function playSmack(strength, comboNow, vol = 1) {
  if (muted || !createCtx()) return;
  if (!smackBuffer) { // still decoding: remember this smack and play it the moment we can
    pendingPlay = { strength, comboNow, vol, at: performance.now() };
    decodeSmack();
    return;
  }
  playSmackNow(strength, comboNow, vol);
}

function playSmackNow(strength, comboNow, vol = 1) {
  if (muted || !audioCtx || !smackBuffer) return;
  const now = audioCtx.currentTime;
  const src = audioCtx.createBufferSource();
  src.buffer = smackBuffer;
  // Baseline pitch climbs with strength/combo. Every individual smack then
  // gets a small two-axis wobble: playback-rate jitter changes pitch and
  // duration together, while detune adds an independent pitch-only offset.
  const baseRate = 0.9 + 0.28 * strength + Math.min(comboNow || 1, 20) * 0.012;
  src.playbackRate.value = baseRate * rand(0.96, 1.04);
  if (src.detune) src.detune.value = rand(-45, 45);
  // Randomize the audible tail too, with a tiny fade so shortening it cannot click.
  const audibleDuration = (smackBuffer.duration / src.playbackRate.value) * rand(0.86, 1);
  const baseGain = clamp(0.45 + 0.55 * strength, 0, 1) * vol;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(baseGain, now);
  gain.gain.setValueAtTime(baseGain, now + audibleDuration * 0.72);
  gain.gain.exponentialRampToValueAtTime(0.001, now + audibleDuration);
  src.connect(gain).connect(audioCtx.destination);
  src.start(now);
  src.stop(now + audibleDuration + 0.03);
  // subtle low thump under only the hardest manual hits
  if (strength > 1.05 && vol > 0.5) {
    const t = now;
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
  manualSmackTimes.push(now);
  combo = now - lastSmackAt < comboWindow() ? combo + 1 : 1;
  lastSmackAt = now;
  totalSmacks++;
  renderTotalSmacks();
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
  const isCrit = has("critical-palm") && Math.random() < 0.08;
  const isEcho = has("echo-smack") && Math.random() < 0.15;
  let gain = (1 + clickPower()) *
    (0.5 + strength * 0.8) *
    (has("momentum") ? 1.3 : 1) *
    (1 + comboBonusPerStack() * Math.min(combo - 1, 40)) *
    (combo >= 8 && has("frenzy-funnel") ? 1.5 : 1) *
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
      `<span class="up-icon"><img src="assets/icons/${u.id}.webp" alt="" loading="lazy" draggable="false"><span class="up-owned">×0</span></span>` +
      `<span class="up-main"><span class="up-name"><span class="up-title">${u.name}</span></span>` +
      `<span class="up-desc">${u.desc}</span><span class="up-value"></span></span>` +
      `<span class="up-side"><span class="up-best">Best value</span>` +
      `<span class="up-cost"><img src="assets/icons/coin.webp" alt="" draggable="false"><span class="up-cost-num"></span></span></span>`;
    btn.addEventListener("click", () => buyUpgrade(u));
    u._btn = btn;
    u._costEl = btn.querySelector(".up-cost-num");
    u._ownedEl = btn.querySelector(".up-owned");
    u._valueEl = btn.querySelector(".up-value");
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

let prestigeInfoCache = "";
function updateShop() {
  setText(balanceEl, fmt(game.balance));
  const income = expectedIncome();
  const sps = income.auto;
  setText(ratesEl,
    `≈ ${fmtRate(income.manualPerSmack)} pts/smack` +
    (autoRate() > 0 ? `  •  ${fmtRate(sps)} pts/s auto` : "") +
    `\nValue est. at ~${fmtRate(income.manualRate)} manual smacks/s`);
  let best = null;
  const values = new Map();
  for (const u of UPGRADES) {
    const plan = planPurchase(u);
    const value = purchaseValue(u, plan);
    values.set(u.id, { plan, value });
    if (plan.n > 0 && value.delta > 0 && (!best || value.payback < best.value.payback)) best = { u, value };
  }
  for (const u of UPGRADES) {
    if (!u._btn) continue;
    const { plan, value } = values.get(u.id);
    const count = owned(u.id);
    const isBest = best && best.u === u;
    u._btn.classList.toggle("best-value", !!isBest);
    if (plan.maxed) {
      u._btn.disabled = true;
      u._btn.classList.add("maxed");
      u._btn.classList.remove("afford");
      setText(u._costEl, "Owned");
      setText(u._valueEl, "Bonus active");
    } else {
      u._btn.disabled = plan.n <= 0;
      u._btn.classList.toggle("afford", plan.n > 0);
      u._btn.classList.remove("maxed");
      setText(u._costEl, (plan.n > 1 ? `${plan.n}× ` : "") + fmt(plan.n > 0 ? plan.cost : nextCost(u, count)));
      setText(u._valueEl, `+${fmtRate(value.delta)}/s • back ~${formatPayback(value.payback)}`);
    }
    setText(u._ownedEl, u.kind === "special" ? "Owned" : `×${count}`);
    const ownedVis = count > 0 ? "visible" : "hidden";
    if (u._ownedEl.style.visibility !== ownedVis) u._ownedEl.style.visibility = ownedVis;
  }
  const pending = pendingStars();
  const info =
    `★ <b>${game.stars}</b> Butt Stars owned (+15% points each, forever).<br>` +
    (pending > 0
      ? `Prestige now for <b>+${pending} ★</b> — resets points & upgrades.`
      : `Earn ${fmt(pointsToNextStar())} more pts this run for your next ★.`);
  if (prestigeInfoCache !== info) {
    prestigeInfoCache = info;
    prestigeInfoEl.innerHTML = info;
  }
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

/* Auto-strikes always use the original white plush glove. */
const autoLayerEl = $("auto-layer");

/* Auto-smack choreography: individual strikes at low rates, faster repeated
   strikes mid-game, then staggered multi-direction comic volleys. Income is
   always continuous; at extreme rates a volley represents a batch. */
const AUTO_DIRECTIONS = [-155, -115, -70, -25, 25, 70, 115, 160];
let autoStrikers = [];
let autoStrikeSeq = 0;

function buildAutoStrikers() {
  if (!autoLayerEl || autoStrikers.length) return;
  for (let i = 0; i < 8; i++) {
    const el = document.createElement("div");
    el.className = "auto-striker";
    el.innerHTML = `<img src="assets/hand.png" alt="" draggable="false">`;
    el.dataset.busyUntil = "0";
    autoLayerEl.appendChild(el);
    autoStrikers.push(el);
  }
}

function autoVisualProfile(rate) {
  if (rate <= 0) return { interval: 1, hands: 0, duration: 430, batch: 0 };
  if (rate <= 2) return { interval: 1 / rate, hands: 1, duration: 430, batch: 1 };
  if (rate <= 6) return { interval: clamp(1.8 / rate, 0.32, 0.9), hands: 1, duration: 350, batch: Math.max(1, Math.round(rate * 0.4)) };
  if (rate <= 15) return { interval: 0.55, hands: 2, duration: 320, batch: Math.max(2, Math.round(rate * 0.55)) };
  if (rate <= 40) return { interval: 0.65, hands: 3, duration: 295, batch: Math.round(rate * 0.65) };
  if (rate <= 120) return { interval: 0.7, hands: 4, duration: 275, batch: Math.round(rate * 0.7) };
  return { interval: 0.75, hands: 6, duration: 255, batch: Math.round(rate * 0.75) };
}

function getAutoStriker() {
  buildAutoStrikers();
  const now = performance.now();
  return autoStrikers.find((el) => +el.dataset.busyUntil <= now) ||
    autoStrikers[autoStrikeSeq++ % Math.max(autoStrikers.length, 1)];
}

function launchAutoStrike({ angleDeg, duration, strength, soundVol, word, batch }) {
  const cheek = angleDeg < -35 ? cheekL : angleDeg > 35 ? cheekR : (Math.random() < 0.5 ? cheekL : cheekR);
  const c = cheek === cheekL ? CHEEK_L : CHEEK_R;
  const fx = clamp(c.x + rand(-0.035, 0.035), 0.06, 0.94);
  const fy = clamp(c.y + rand(-0.025, 0.025), 0.08, 0.92);
  const dirX = clamp(Math.cos(angleDeg * Math.PI / 180), -1, 1);
  const impact = () => {
    cheekImpulse(cheek, strength, dirX);
    body1.vs += 1.05 * strength;
    if (soundVol > 0) playSmack(strength * 0.9, 1, soundVol);
    if (!reducedMotion) {
      spawnFX(fx, fy, strength * 0.75, dirX, false);
      if (word) spawnPop(fx, fy - 0.05, 1.05, batch >= 12, word);
      if (strength > 0.3 && Math.random() < 0.28) {
        spawnHandprint(fx, fy, strength * 0.85, angleDeg + 90 + rand(-12, 12));
      }
    }
  };
  if (reducedMotion || !autoLayerEl) { impact(); return; }

  const el = getAutoStriker();
  if (!el) { impact(); return; }
  const r = stageRectCache || refreshStageRect();
  const rad = angleDeg * Math.PI / 180;
  const dist = rand(0.27, 0.36);
  const dx = Math.cos(rad) * dist * r.width;
  const dy = Math.sin(rad) * dist * r.height;
  // The source hand's fingers point up; rotate them toward the target.
  const impactRot = Math.atan2(-Math.sin(rad), -Math.cos(rad)) * 180 / Math.PI + 90;
  const startRot = impactRot - 24;
  el.dataset.busyUntil = String(performance.now() + duration + 40);
  el.style.left = fx * 100 + "%";
  el.style.top = fy * 100 + "%";
  el.style.width = 20 + strength * 13 + "%";
  for (const a of el.getAnimations()) a.cancel();
  el.animate([
    { transform: `translate(calc(-50% + ${dx}px), calc(-52% + ${dy}px)) rotate(${startRot}deg) scale(1.08)`, opacity: 0 },
    { opacity: 1, offset: 0.16 },
    { transform: `translate(-50%,-52%) rotate(${impactRot + 7}deg) scale(0.9)`, opacity: 1, offset: 0.42 },
    { transform: `translate(-50%,-54%) rotate(${impactRot}deg) scale(1)`, opacity: 1, offset: 0.62 },
    { transform: `translate(calc(-50% + ${dx * 0.82}px), calc(-52% + ${dy * 0.82}px)) rotate(${startRot + 8}deg) scale(1.04)`, opacity: 0 },
  ], { duration, easing: "cubic-bezier(.2,.75,.3,1)" });
  setTimeout(impact, Math.round(duration * 0.42));
}

function launchAutoVolley(rate) {
  const profile = autoVisualProfile(rate);
  if (!profile.hands) return profile;
  const angles = [...AUTO_DIRECTIONS].sort(() => Math.random() - 0.5).slice(0, profile.hands);
  const strength = clamp((0.24 + Math.sqrt(rate) * 0.055) / Math.sqrt(profile.hands), 0.18, 0.68);
  angles.forEach((angle, i) => {
    const fire = () => launchAutoStrike({
      angleDeg: angle + rand(-9, 9),
      duration: profile.duration,
      strength,
      soundVol: i === 0 ? (profile.hands >= 3 ? 0.3 : 0.22) : 0,
      word: i === 0 && profile.hands >= 3 ? (Math.random() < 0.5 ? "WHAM!" : "SMACK x" + profile.batch + "!") : null,
      batch: profile.batch,
    });
    if (i === 0) fire();
    else setTimeout(fire, i * 45);
  });
  return profile;
}

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
  renderTotalSmacks(true);
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

/* Score permalinks: stats packed as base64url JSON in ?s=... */
function encodeShare() {
  const payload = {
    v: 1,
    sm: totalSmacks,
    pts: Math.floor(game.lifetimeEarned),
    hard: +hardest.toFixed(2),
    stars: game.stars,
    up: Object.values(game.owned).reduce((a, b) => a + b, 0),
    ts: Math.floor(Date.now() / 1000),
  };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeShare(str) {
  try {
    let b64 = String(str).replaceAll("-", "+").replaceAll("_", "/");
    while (b64.length % 4) b64 += "=";
    const payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (!payload || payload.v !== 1) return null;
    for (const k of ["sm", "pts", "hard", "stars", "up"]) {
      if (!Number.isFinite(payload[k]) || payload[k] < 0) return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

function shareURL() {
  const base = location.href.split(/[?#]/)[0];
  return `${base}?s=${encodeShare()}`;
}

$("share-btn").addEventListener("click", async () => {
  const url = shareURL();
  const text = totalSmacks === 0
    ? "I have smacked Musey's butt 0 times. I am about to fix that."
    : `I have smacked Musey's butt ${totalSmacks.toLocaleString()} time${totalSmacks === 1 ? "" : "s"} (hardest: ${tierName(hardest)}). He knows what he did.`;
  try {
    if (navigator.share) {
      // give the share sheet a moment; if it never settles (some desktops/headless), fall back
      const settled = await Promise.race([
        navigator.share({ title: "Smack Musey!", text, url }).then(() => true).catch(() => false),
        new Promise((res) => setTimeout(() => res(false), 1200)),
      ]);
      if (settled) return;
    }
    throw new Error("no native share");
  } catch (e) {
    try {
      await navigator.clipboard.writeText(url);
      showMilestone("Score link copied. Go brag about it.");
    } catch (e2) {
      showMilestone("Copy this score link: " + url);
    }
  }
});

/* Landing on someone's ?s= link: show their score + how you stack up */
function showSharedScore() {
  const raw = new URLSearchParams(location.search).get("s");
  if (!raw) return;
  const p = decodeShare(raw);
  if (!p) return;
  const theirs = p.sm;
  const mine = totalSmacks;
  const verdict = mine === 0 && theirs === 0
    ? "Nobody has smacked yet. Be the first."
    : mine >= theirs
      ? `You're at ${fmt(mine)} — you're winning. Musey fears you most.`
      : `You're at ${fmt(mine)} — only ${fmt(theirs - mine)} behind. Get smacking.`;
  const banner = document.createElement("div");
  banner.className = "shared-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML =
    `<span class="shared-text">★ Shared score: <b>${fmt(theirs)} smacks</b> • ${fmt(p.pts)} lifetime pts • ` +
    `hardest: <b>${tierName(p.hard)}</b> • ★${p.stars} • ${fmt(p.up)} upgrades<br><span class="shared-verdict">${verdict}</span></span>` +
    `<button type="button" class="shared-x" aria-label="Dismiss shared score">×</button>`;
  banner.querySelector(".shared-x").addEventListener("click", () => {
    banner.remove();
    history.replaceState({}, "", location.pathname);
    document.title = "Smack Musey!";
  });
  const layout = document.querySelector("main > .layout");
  layout.parentNode.insertBefore(banner, layout);
  document.title = `${fmt(theirs)} smacks! Can you beat it? | Smack Musey!`;
}

$("reset-btn").addEventListener("click", () => {
  totalSmacks = 0;
  combo = 0;
  renderTotalSmacks(true);
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
let autoSmackAcc = 0, autoVolleyT = 0.8, shopTickT = 0;

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
      renderTotalSmacks();
      for (const k of Object.keys(MILESTONES)) {
        if (prevTotal < +k && totalSmacks >= +k) showMilestone(MILESTONES[k]);
      }
    }
    autoVolleyT -= dt;
    if (autoVolleyT <= 0) {
      const profile = launchAutoVolley(aRate);
      autoVolleyT = profile.interval;
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
buildAutoStrikers();
updateShop();
applyOffline();
showSharedScore();
setInterval(saveGame, 5000);
requestAnimationFrame(frame);

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
  stepSpring(ch, 300, 5.6, dt);
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

function spawnPop(x, y, strength, frenzy) {
  if (reducedMotion) return;
  const words = strength < 0.6 ? WORDS_SOFT : strength < 1.05 ? WORDS_MID : WORDS_HARD;
  const el = document.createElement("div");
  el.className = "pop" + (frenzy ? " frenzy-pop" : "");
  el.textContent = words[(Math.random() * words.length) | 0];
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
  combo = now - lastSmackAt < 900 ? combo + 1 : 1;
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

  if (strength > 0.85) shakeMag = Math.max(shakeMag, (strength - 0.8) * 11);
  if (strength > 1.15 && !reducedMotion && now >= hitstopUntil) hitstopUntil = now + 18;

  // render the first squash frame synchronously — no waiting for rAF
  stepCheek(cheekL, 1 / 120); stepCheek(cheekR, 1 / 120); stepSpring(body1, 220, 9, 1 / 120);
  applyTransforms(now);

  playSmack(strength, combo);
  spawnFX(fx, fy, strength, dirX, isMilestone);
  spawnPop(fx, fy - 0.04, strength + Math.min(combo, 14) * 0.035, combo >= 8);
  spawnHandprint(fx, fy, strength, currentHandRot);
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
    comboFill.style.width = clamp(100 * (1 - (now - lastSmackAt) / 900), 0, 100) + "%";
    if (now - lastSmackAt > 900) { combo = 0; updateCombo(); }
  }

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
requestAnimationFrame(frame);

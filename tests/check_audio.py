"""Audio startup + auto-smack checks for Smack Musey.

Verifies in headless Chrome (CDP):
  1. The smack sample is decoded at page load (before any gesture), so the
     very first smack is not silent while audio 'warms up'.
  2. The first real pointer smack actually starts an audio buffer quickly.
  3. Owning an auto-smacker produces visible smacks (an auto-hand strikes
     and the cheek deforms) with quieter audio than a manual smack.

Audio starts/gains are observed by wrapping Web Audio APIs before page load
(no app changes needed).

Usage (serve repo first, e.g. `python -m http.server 8321`):
    .venv\\Scripts\\python.exe tests\\check_audio.py [base_url]
"""
import json, time, urllib.request, subprocess, os, sys
import websocket

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8321/"
CHROME = next(p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
] if os.path.exists(p))
PORT = 9357
FAILURES = []

def check(name, cond, extra=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond:
        FAILURES.append(name)

INSTRUMENT = r"""
window.__audioStarts = [];
window.__gains = [];
window.__gainPeaks = [];
window.__sources = [];
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const origCreateGain = AC.prototype.createGain;
  AC.prototype.createGain = function () {
    const g = origCreateGain.call(this);
    window.__gains.push(g);
    const origSet = g.gain.setValueAtTime.bind(g.gain);
    let recorded = false;
    g.gain.setValueAtTime = function (v, t) {
      if (!recorded) { recorded = true; window.__gainPeaks.push(v); }
      return origSet(v, t);
    };
    return g;
  };
  const origCreateSource = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () {
    const node = origCreateSource.call(this);
    const rec = { rate: 0, detune: 0, startCtx: 0, stopCtx: 0 };
    window.__sources.push(rec);
    const origStart = node.start.bind(node);
    const origStop = node.stop.bind(node);
    node.start = function (...args) {
      rec.rate = node.playbackRate.value;
      rec.detune = node.detune ? node.detune.value : 0;
      rec.startCtx = args[0] || node.context.currentTime;
      window.__audioStarts.push(performance.now());
      return origStart(...args);
    };
    node.stop = function (when = 0) {
      rec.stopCtx = when;
      return origStop(when);
    };
    return node;
  };
})();
"""

proc = subprocess.Popen([
    CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--window-size=1200,1000", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=" + os.path.join(os.environ["TEMP"], "musey-audio-profile"),
    "about:blank",
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    ws_url = None
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2) as r:
                targets = json.loads(r.read())
            ws_url = next(t for t in targets if t["type"] == "page")["webSocketDebuggerUrl"]
            break
        except Exception:
            time.sleep(0.5)
    assert ws_url
    ws = websocket.create_connection(ws_url, timeout=90)
    _id = [0]; errors = []

    def send(method, **params):
        _id[0] += 1; my = _id[0]
        ws.send(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                errors.append(str(msg["params"]["exceptionDetails"].get("exception", {}).get("description", ""))[:250])
            if msg.get("id") == my:
                if "error" in msg: raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def evl(expr):
        r = send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r: raise RuntimeError(str(r["exceptionDetails"])[:400])
        return r["result"].get("value")

    def mouse(type_, x, y, button="none", buttons=0, click=0):
        send("Input.dispatchMouseEvent", type=type_, x=x, y=y, button=button, buttons=buttons, clickCount=click)

    send("Page.enable"); send("Runtime.enable")
    send("Page.addScriptToEvaluateOnNewDocument", source=INSTRUMENT)
    send("Page.navigate", url=BASE)
    time.sleep(2.5)

    # 1. decoded during idle, before any gesture
    ready_idle = evl("({buffer: !!smackBuffer, ctx: audioCtx ? audioCtx.state : 'none'})")
    check("smack sample decoded before first gesture", ready_idle["buffer"] is True, f"({ready_idle})")

    # 2. first real smack makes a sound, quickly
    rect = evl("""(() => { const r = document.getElementById('stage').getBoundingClientRect();
      return {left:r.left, top:r.top, width:r.width, height:r.height}; })()""")
    bx = rect["left"] + rect["width"] * 0.45
    by = rect["top"] + rect["height"] * 0.67
    t0 = time.time()
    mouse("mouseMoved", bx - 140, by - 40); time.sleep(0.05)
    mouse("mouseMoved", bx, by); time.sleep(0.05)
    mouse("mousePressed", bx, by, button="left", buttons=1, click=1)
    mouse("mouseReleased", bx, by, button="left", buttons=0, click=1)
    starts = 0
    deadline = time.time() + 2
    while time.time() < deadline:
        starts = evl("window.__audioStarts.length")
        if starts > 0:
            break
        time.sleep(0.05)
    elapsed_ms = (time.time() - t0) * 1000
    check("first smack starts audio", starts > 0, f"(starts={starts})")
    check("first audio starts < 400ms after approach+click", starts > 0 and elapsed_ms < 400, f"({elapsed_ms:.0f}ms incl approach)")
    check("audio context running", evl("audioCtx.state") == "running", f"({evl('audioCtx.state')})")

    # several fixed-strength keyboard smacks: pitch (rate+detune) and audible
    # duration (scheduled stop-start) should vary from smack to smack.
    evl("""(async () => {
      const st = document.getElementById('stage'); st.focus();
      for (let i = 0; i < 9; i++) {
        st.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));
        await new Promise(r => setTimeout(r, 120));
      }
      return true;
    })()""")
    time.sleep(0.3)
    sources = [s for s in evl("window.__sources.filter(s => s.stopCtx > s.startCtx).map(s => ({rate:s.rate, detune:s.detune, dur:s.stopCtx-s.startCtx}))") if s["rate"] > 0]
    rates = [round(s["rate"], 3) for s in sources]
    detunes = [s["detune"] for s in sources]
    durs = [s["dur"] for s in sources]
    check("pitch rate varies between smacks", len(set(rates)) >= 5, f"({rates})")
    check("pitch detune varies between smacks", detunes and max(detunes) - min(detunes) > 20,
          f"({min(detunes):.0f}..{max(detunes):.0f} cents)" if detunes else "(none)")
    check("audible duration varies between smacks", durs and max(durs) - min(durs) > 0.006,
          f"({min(durs)*1000:.0f}..{max(durs)*1000:.0f}ms)" if durs else "(none)")
    manual_gain = evl("window.__gainPeaks.length ? Math.max(...window.__gainPeaks) : null")

    # 3. auto-smack visuals + quieter sound (balance topped up via app's own addPoints)
    evl("addPoints(200); updateShop(); document.querySelector('[data-upgrade=windup-hand]').click();")
    time.sleep(0.3)
    check("wind-up hand owned for auto test", evl("(game.owned['windup-hand']||0)") >= 1)
    # baselines AFTER the purchase click's own boop sound, so only auto audio counts
    starts_after_manual = evl("window.__audioStarts.length")
    gains_after_manual = evl("window.__gainPeaks.length")
    result = evl("""(async () => {
      const cheek = document.getElementById('cheek-r');
      let sawHand = false, maxDeform = 0;
      const t0 = performance.now();
      await new Promise(res => (function tick(){
        if ([...document.querySelectorAll('.auto-striker')].some(el => parseFloat(getComputedStyle(el).opacity) > 0.15)) sawHand = true;
        const m = cheek.style.transform.match(/scale\\(([\\d.]+), ([\\d.]+)\\)/);
        if (m) maxDeform = Math.max(maxDeform, Math.abs(+m[2]-1));
        performance.now()-t0 < 6500 ? requestAnimationFrame(tick) : res();
      })());
      return {sawHand, maxDeform};
    })()""")
    check("auto-smack hand visibly strikes", bool(result and result["sawHand"]))
    check("auto-smack deforms cheek", bool(result and result["maxDeform"] > 0.01),
          f"(max deform {result['maxDeform']:.3f})" if result else "")
    auto_starts = evl("window.__audioStarts.length") - starts_after_manual
    check("auto-smack plays sound", auto_starts > 0, f"(+{auto_starts} starts)")
    auto_gains = evl(f"window.__gainPeaks.slice({gains_after_manual})")
    auto_max_gain = max(auto_gains) if auto_gains else None
    check("auto-smack quieter than manual", auto_max_gain is not None and manual_gain is not None and auto_max_gain < manual_gain * 0.6,
          f"(manual {manual_gain}, auto max {auto_max_gain})")

    # a late-game auto army: all tiers represented on stage, volleys use
    # several hands at once and animate faster than the first Wind-Up Hand.
    evl("""(() => {
      game.owned = {...game.owned, 'windup-hand': 10, 'autohand': 10,
        'smack-drone': 5, 'butler-bot': 2, 'orbital-cannon': 1,
        'golden-glove': 1, 'orbital-cannon': 1};
      updateShop();
      return autoRate();
    })()""")
    time.sleep(0.3)
    check("all five auto tiers rendered in stage army",
          evl("document.querySelectorAll('.army-unit').length") == 5)
    check("owned special rendered as stage charm",
          evl("!!document.querySelector('.special-charm[data-upgrade=golden-glove]')") is True)
    profiles = evl("({low: autoVisualProfile(0.5), high: autoVisualProfile(475)})")
    check("high-rate volley uses multiple hands", profiles["high"]["hands"] >= 4, f"({profiles})")
    check("high-rate strikes animate faster", profiles["high"]["duration"] < profiles["low"]["duration"],
          f"({profiles['low']['duration']}ms -> {profiles['high']['duration']}ms)")
    concurrent = evl("""(async () => {
      let maxVisible = 0;
      const t0 = performance.now();
      await new Promise(res => (function tick(){
        const vis = [...document.querySelectorAll('.auto-striker')]
          .filter(el => parseFloat(getComputedStyle(el).opacity) > 0.15).length;
        maxVisible = Math.max(maxVisible, vis);
        performance.now()-t0 < 3000 ? requestAnimationFrame(tick) : res();
      })());
      return maxVisible;
    })()""")
    check("multiple auto hands visible simultaneously", concurrent >= 3, f"(max {concurrent})")

    print("JS errors:", errors if errors else "none")
    if errors:
        FAILURES.append("js errors")
    ws.close()
finally:
    proc.terminate()

print("\nRESULT:", "ALL PASS" if not FAILURES else f"{len(FAILURES)} FAILING: {FAILURES}")
sys.exit(1 if FAILURES else 0)

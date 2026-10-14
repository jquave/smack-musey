"""Responsiveness checks for Smack Musey.

Drives the real app in headless Chrome (CDP) and asserts:
  1. Hand lag: after a 400px mouse jump, the hand settles within 8px fast.
  2. Smack latency: cheek deformation is visible shortly after pointerdown.
  3. Layout: the stage (Musey) fits fully in the viewport at phone,
     landscape-phone, and short-laptop sizes without scrolling.

Usage (serve the repo first, e.g. `python -m http.server 8321`):
    .venv\\Scripts\\python.exe tests\\check_responsiveness.py [base_url]

Exits non-zero if any check fails.
"""
import json, time, urllib.request, subprocess, os, sys
import websocket

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8321/"
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
CHROME = next(p for p in CHROME_CANDIDATES if os.path.exists(p))
PORT = 9351
FAILURES = []

def check(name, cond, extra=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond:
        FAILURES.append(name)

proc = subprocess.Popen([
    CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--window-size=1000,1300", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=" + os.path.join(os.environ["TEMP"], "musey-resp-profile"),
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
    assert ws_url, "no devtools target"
    ws = websocket.create_connection(ws_url, timeout=60)
    _id = [0]; errors = []

    def send(method, **params):
        _id[0] += 1; my = _id[0]
        ws.send(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                errors.append(str(msg["params"]["exceptionDetails"])[:200])
            if msg.get("id") == my:
                if "error" in msg: raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def evl(expr):
        r = send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r: raise RuntimeError(str(r["exceptionDetails"])[:300])
        return r["result"].get("value")

    def mouse(type_, x, y, button="none", buttons=0, click=0):
        send("Input.dispatchMouseEvent", type=type_, x=x, y=y,
             button=button, buttons=buttons, clickCount=click)

    send("Page.enable"); send("Runtime.enable")
    send("Page.navigate", url=BASE)
    time.sleep(2.5)

    # ---- 1. hand lag: jump 400px, time until hand center within 8px ----
    mouse("mouseMoved", 200, 500); time.sleep(0.6)  # settle at start point
    lag = evl("""(async () => {
      const hand = document.getElementById('hand');
      const target = {x: 600, y: 500};
      window.dispatchEvent(new PointerEvent('pointermove', {clientX: target.x, clientY: target.y, pointerType:'mouse', bubbles:true}));
      const t0 = performance.now();
      return await new Promise(res => (function tick(){
        const m = hand.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/);
        if (m) {
          const cx = +m[1] + hand.offsetWidth*0.5, cy = +m[2] + hand.offsetHeight*0.52;
          if (Math.hypot(cx-target.x, cy-target.y) < 8) return res(Math.round(performance.now()-t0));
        }
        if (performance.now()-t0 > 2000) return res(9999);
        requestAnimationFrame(tick);
      })());
    })()""")
    check("hand settles after 400px jump < 90ms", lag < 90, f"({lag}ms)")

    # ---- 2. smack latency: pointerdown -> visible cheek deformation ----
    rect = evl("""(() => { const r = document.getElementById('stage').getBoundingClientRect();
      return {left:r.left, top:r.top, width:r.width, height:r.height}; })()""")
    bx = rect["left"] + rect["width"] * 0.46
    by = rect["top"] + rect["height"] * 0.67
    mouse("mouseMoved", bx, by); time.sleep(0.4)
    lat = evl("""(async () => {
      const st = document.getElementById('stage');
      const r = st.getBoundingClientRect();
      const cx = r.left + r.width*0.46, cy = r.top + r.height*0.67;
      const el = document.getElementById('cheek-r');
      const t0 = performance.now();
      st.dispatchEvent(new PointerEvent('pointerdown', {clientX: cx, clientY: cy, pointerType:'mouse', bubbles:true}));
      return await new Promise(res => (function tick(){
        const m = el.style.transform.match(/scale\\(([\\d.]+), ([\\d.]+)\\)/);
        if (m && +m[2] < 0.994) return res(Math.round(performance.now()-t0));
        if (performance.now()-t0 > 1500) return res(9999);
        requestAnimationFrame(tick);
      })());
    })()""")
    check("cheek deforms < 50ms after pointerdown", lat < 50, f"({lat}ms)")

    # ---- 3. layout at small / short sizes: stage fully visible, no scroll needed ----
    for name, w, h in [("phone 390x844", 390, 844), ("phone landscape 844x390", 844, 390),
                       ("laptop 1366x768", 1366, 768), ("small phone 360x640", 360, 640)]:
        send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=w < 500)
        time.sleep(0.5)
        fits = evl("""(() => {
          const r = document.getElementById('stage').getBoundingClientRect();
          return {stageBottom: Math.round(r.bottom), stageRight: Math.round(r.right),
                  ih: window.innerHeight, iw: window.innerWidth,
                  scrollW: document.documentElement.scrollWidth};
        })()""")
        ok = (fits["stageBottom"] <= fits["ih"] + 1 and fits["stageRight"] <= fits["iw"] + 1
              and fits["scrollW"] <= fits["iw"] + 1)
        check(f"stage fits viewport, no h-overflow [{name}]", ok,
              f"(bottom {fits['stageBottom']}/{fits['ih']}, right {fits['stageRight']}/{fits['iw']}, scrollW {fits['scrollW']})")
    send("Emulation.clearDeviceMetricsOverride")

    print("JS errors:", errors if errors else "none")
    if errors:
        FAILURES.append("js errors")
    ws.close()
finally:
    proc.terminate()

print("\nRESULT:", "ALL PASS" if not FAILURES else f"{len(FAILURES)} FAILING: {FAILURES}")
sys.exit(1 if FAILURES else 0)

"""Layout-stability checks for Smack Musey.

Dynamic counters (points, total smacks, combo, hardest tier, shop costs and
rates) must never resize or reposition the stage, HUD, or upgrade shop.
The test drives several extreme text states through the app's own update
functions and then watches live auto-income for a few seconds.

Usage (serve repo first, e.g. `python -m http.server 8321`):
    .venv\\Scripts\\python.exe tests\\check_layout_stability.py [base_url]
"""
import json, time, urllib.request, subprocess, os, sys
import websocket

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8321/"
CHROME = next(p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
] if os.path.exists(p))
PORT = 9363
FAILURES = []


def check(name, cond, extra=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond:
        FAILURES.append(name)


proc = subprocess.Popen([
    CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--window-size=1400,1000", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=" + os.path.join(os.environ["TEMP"], "musey-layout-profile"),
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
    _id = [0]
    errors = []

    def send(method, **params):
        _id[0] += 1
        my = _id[0]
        ws.send(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                errors.append(str(msg["params"]["exceptionDetails"].get("exception", {}).get("description", ""))[:250])
            if msg.get("id") == my:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def evl(expr):
        r = send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r:
            raise RuntimeError(str(r["exceptionDetails"])[:400])
        return r["result"].get("value")

    send("Page.enable")
    send("Runtime.enable")
    send("Page.navigate", url=BASE)
    time.sleep(2.5)

    data = evl(r"""(async () => {
      const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10);
      };
      const snap = () => ({
        stage: rect(document.getElementById('stage')),
        shop: rect(document.getElementById('shop')),
        hud: rect(document.querySelector('.hud')),
        stats: [...document.querySelectorAll('.hud .stat')].map(rect),
        buttons: [...document.querySelectorAll('.hud-buttons button')].map(rect),
        rates: rect(document.getElementById('rates')),
        cards: [...document.querySelectorAll('#shop-list .upgrade')].map(rect),
        prestige: rect(document.querySelector('.prestige-box')),
        balance: document.getElementById('balance').textContent,
        count: document.getElementById('count').textContent,
      });
      const cases = [
        [0, 0, 0, 0, 0],
        [9.4, 9, 0, .5, 0],
        [99.9, 99, 3, .7, 0],
        [999.9, 999, 8, 1.0, 1],
        [9999, 9999, 13, 1.2, 12],
        [999999, 999999, 40, 1.4, 123],
        [987654321, 9876543, 99, 1.45, 999],
        [1.1, 1, 0, .55, 0],
      ];
      const forced = [];
      for (const [bal, smacks, comboNow, hard, stars] of cases) {
        game.balance = bal;
        game.runEarned = bal;
        game.lifetimeEarned = bal;
        game.stars = stars;
        game.owned = bal > 900 ? {'windup-hand': 9, 'autohand': 4, 'padded-palm': 12} : {};
        totalSmacks = smacks;
        countEl.textContent = totalSmacks.toLocaleString();
        combo = comboNow;
        lastSmackAt = performance.now();
        updateCombo();
        hardest = hard;
        syncHardest();
        updateShop();
        await frames();
        forced.push(snap());
      }
      game.owned = {'windup-hand': 5, 'autohand': 2, 'padded-palm': 3};
      game.balance = 998.5;
      game.stars = 0;
      totalSmacks = 998;
      countEl.textContent = '998';
      combo = 0;
      updateCombo();
      updateShop();
      await frames();
      const live = [snap()];
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 500));
        live.push(snap());
      }
      return {forced, live};
    })()""")

    def spread(snaps, getter):
        vals = [getter(s) for s in snaps]
        return [round(max(v[i] for v in vals) - min(v[i] for v in vals), 1) for i in range(4)]

    def assert_group(snaps, label):
        for key in ("stage", "shop", "hud", "rates", "prestige"):
            sp = spread(snaps, lambda s, k=key: s[k])
            check(f"{label}: {key} box stable", max(sp) <= 0.6, f"(spread x/y/w/h {sp})")
        for i in range(4):
            sp = spread(snaps, lambda s, i=i: s["stats"][i])
            check(f"{label}: stat {i} box stable", max(sp) <= 0.6, f"(spread {sp})")
        for i in range(3):
            sp = spread(snaps, lambda s, i=i: s["buttons"][i])
            check(f"{label}: HUD button {i} box stable", max(sp) <= 0.6, f"(spread {sp})")
        bad_cards = []
        for i in range(len(snaps[0]["cards"])):
            sp = spread(snaps, lambda s, i=i: s["cards"][i])
            if max(sp) > 0.6:
                bad_cards.append((i, sp))
        check(f"{label}: all upgrade cards stable", not bad_cards, f"({bad_cards[:4]})")
        heights = [c[3] for c in snaps[-1]["cards"]]
        check(f"{label}: all upgrade cards same height", max(heights) - min(heights) <= 1,
              f"({min(heights)}..{max(heights)}px)")

    check("forced samples really changed counter text",
          len({s["balance"] for s in data["forced"]}) >= 6 and len({s["count"] for s in data["forced"]}) >= 6)
    assert_group(data["forced"], "forced text states")
    check("live samples really changed counter text",
          data["live"][0]["count"] != data["live"][-1]["count"],
          f"({data['live'][0]['count']} -> {data['live'][-1]['count']})")
    assert_group(data["live"], "live auto income")

    print("JS errors:", errors if errors else "none")
    if errors:
        FAILURES.append("js errors")
    ws.close()
finally:
    proc.terminate()

print("\nRESULT:", "ALL PASS" if not FAILURES else f"{len(FAILURES)} FAILING: {FAILURES}")
sys.exit(1 if FAILURES else 0)

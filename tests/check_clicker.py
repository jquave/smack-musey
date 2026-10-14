"""Clicker-game checks for Smack Musey.

Drives the real app in headless Chrome (CDP):
  1. Real keyboard smacks earn Smack Points.
  2. Buying Padded Palm with those points increases per-smack earnings.
  3. Buying a Wind-Up Hand makes the balance grow on its own.
  4. Buy x10 toggle purchases ten at once.
  5. Prestige converts a rich run into permanent Butt Stars and resets.
  6. Offline earnings pay out after an hour away.

Steps 4-5 top the balance up via the app's own addPoints() so the test
does not need thousands of real smacks; steps 1-3 use only real input.

Usage (serve the repo first, e.g. `python -m http.server 8321`):
    .venv\\Scripts\\python.exe tests\\check_clicker.py [base_url]
"""
import json, time, base64, urllib.request, subprocess, os, sys
import websocket

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8321/"
CHROME = next(p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
] if os.path.exists(p))
PORT = 9353
FAILURES = []

def check(name, cond, extra=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond:
        FAILURES.append(name)

proc = subprocess.Popen([
    CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--window-size=1400,1000", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=" + os.path.join(os.environ["TEMP"], "musey-clicker-profile"),
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
            if msg.get("method") == "Runtime.consoleAPICalled" and msg["params"]["type"] == "error":
                errors.append("console: " + str(msg["params"]["args"])[:250])
            if msg.get("id") == my:
                if "error" in msg: raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def evl(expr):
        r = send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r: raise RuntimeError(str(r["exceptionDetails"])[:400])
        return r["result"].get("value")

    def shot(name):
        r = send("Page.captureScreenshot", format="png")
        p = os.path.join(os.environ["TEMP"], name)
        with open(p, "wb") as f: f.write(base64.b64decode(r["data"]))
        print("shot:", p)

    send("Page.enable"); send("Runtime.enable")
    send("Page.navigate", url=BASE)
    time.sleep(2.5)

    check("shop renders 17 upgrades", evl("document.querySelectorAll('.upgrade').length") == 17)
    check("balance starts at 0", evl("game.balance") == 0)

    # 1. real smacks earn points (Space on the focused stage)
    first_delta = evl("""(async () => {
      const st = document.getElementById('stage'); st.focus();
      const b0 = game.balance;
      st.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));
      return game.balance - b0;
    })()""")
    check("first smack earns ~1.18 pts", 0.9 < first_delta < 1.6, f"(+{first_delta:.2f})")

    evl("""(async () => {
      const st = document.getElementById('stage'); st.focus();
      for (let i = 0; i < 16; i++) {
        st.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));
        await new Promise(r => setTimeout(r, 110));
      }
      return true;
    })()""")
    bal = evl("game.balance")
    check("16 more smacks bank enough for Padded Palm (15)", bal >= 15, f"(balance {bal:.1f})")

    # 2. buy Padded Palm through the real shop button
    evl("document.querySelector('[data-upgrade=padded-palm]').click()")
    time.sleep(0.3)
    check("padded palm owned", evl("game.owned['padded-palm'] || 0") == 1)
    time.sleep(1.2)  # let combo expire so deltas compare cleanly
    second_delta = evl("""(() => {
      const st = document.getElementById('stage'); st.focus();
      const b0 = game.balance;
      st.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));
      return game.balance - b0;
    })()""")
    check("per-smack earnings roughly doubled", second_delta > first_delta * 1.7,
          f"({first_delta:.2f} -> {second_delta:.2f})")

    # 3. earn and buy a Wind-Up Hand, then watch idle income
    evl("""(async () => {
      const st = document.getElementById('stage'); st.focus();
      for (let i = 0; i < 18 && game.balance < 30; i++) {
        st.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));
        await new Promise(r => setTimeout(r, 110));
      }
      return game.balance;
    })()""")
    evl("document.querySelector('[data-upgrade=windup-hand]').click()")
    time.sleep(0.3)
    check("wind-up hand owned", evl("game.owned['windup-hand'] || 0") == 1)
    check("rates line shows auto income", "auto" in evl("document.getElementById('rates').textContent"),
          evl("document.getElementById('rates').textContent"))
    b_idle0 = evl("game.balance")
    time.sleep(3.5)
    b_idle1 = evl("game.balance")
    check("balance grows while idle", b_idle1 > b_idle0 + 0.3, f"({b_idle0:.2f} -> {b_idle1:.2f})")

    shot("clicker_desktop.png")

    # 4. x10 bulk buy (topped up via the app's own addPoints)
    evl("addPoints(5000); updateShop();")
    evl("document.getElementById('buy-10').click()")
    before10 = evl("game.owned['padded-palm']")
    evl("document.querySelector('[data-upgrade=padded-palm]').click()")
    after10 = evl("game.owned['padded-palm']")
    check("x10 buys ten at once", after10 - before10 == 10, f"({before10} -> {after10})")
    evl("document.getElementById('buy-1').click()")

    # 5. prestige: fund a star, confirm twice, verify reset + star kept
    evl("addPoints(30000); updateShop();")
    check("a star is pending", evl("pendingStars()") >= 1, f"(pending {evl('pendingStars()')})")
    evl("document.getElementById('prestige-btn').click()")   # arm
    evl("document.getElementById('prestige-btn').click()")   # confirm
    time.sleep(0.3)
    check("star banked", evl("game.stars") >= 1)
    check("balance reset by prestige", evl("game.balance") < 5, f"({evl('game.balance'):.1f})")
    check("upgrades reset by prestige", evl("Object.keys(game.owned).length") == 0)

    # 6. offline earnings: own an auto-hand again, jump lastSeen back an hour, reload
    evl("addPoints(100); updateShop(); document.querySelector('[data-upgrade=windup-hand]').click(); saveGame();")
    bal_pre = evl("game.balance")
    # simulate an hour away through the app's own offline path
    # (a real tab close stamps lastSeen via beforeunload; here we rewind it in-memory)
    evl("game.lastSeen = Date.now() - 3600e3; applyOffline();")
    bal_post = evl("game.balance")
    check("offline earnings paid out", bal_post > bal_pre + 50, f"({bal_pre:.0f} -> {bal_post:.0f})")
    check("offline message shown", "While you were gone" in evl("document.getElementById('milestone').textContent"))
    # and the balance survives a real reload
    evl("saveGame();")
    send("Page.reload")
    time.sleep(2.5)
    check("balance persists across reload", abs(evl("game.balance") - bal_post) < 30,
          f"({bal_post:.0f} -> {evl('game.balance'):.0f})")

    print("JS errors:", errors if errors else "none")
    if errors:
        FAILURES.append("js errors")
    ws.close()
finally:
    proc.terminate()

print("\nRESULT:", "ALL PASS" if not FAILURES else f"{len(FAILURES)} FAILING: {FAILURES}")
sys.exit(1 if FAILURES else 0)

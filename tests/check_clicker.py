"""Clicker-game checks for Smack Musey.

Drives the real app in headless Chrome (CDP):
  1. Real keyboard smacks earn Smack Points.
  2. Buying Padded Palm with those points increases per-smack earnings.
  3. Buying a Wind-Up Hand makes the balance grow on its own.
  4. Buy x10 toggle purchases ten at once.
  5. Prestige converts a rich run into Butt Stars, whose perks survive it.
  6. Offline earnings pay out after an hour away.
  7. Perfect Balance, Board auto-buy and Universe Reload work end to end.

Later steps top the balance/stars up through the app's own state functions
so the test does not need thousands of real smacks; steps 1-3 use real input.

Usage (serve the repo first, e.g. `python -m http.server 8321`):
    .venv\\Scripts\\python.exe tests\\check_clicker.py [base_url]
"""
import json, time, base64, urllib.request, subprocess, os, sys, tempfile, shutil
import websocket

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8321/"
CHROME = next(p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
] if os.path.exists(p))
PORT = 9353
PROFILE_DIR = tempfile.mkdtemp(prefix="musey-clicker-profile-")
FAILURES = []

def check(name, cond, extra=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond:
        FAILURES.append(name)

proc = subprocess.Popen([
    CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--window-size=1400,1000", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=" + PROFILE_DIR,
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

    check("shop renders 18 run upgrades", evl("document.querySelectorAll('#shop-list .upgrade').length") == 18)
    check("shop renders 7 Butt Star perks", evl("document.querySelectorAll('#star-list .star-perk').length") == 7)
    check("shop renders 4 Primordial Fluff perks", evl("document.querySelectorAll('#fluff-list .fluff-perk').length") == 4)
    check("Heat Death Palm starts locked", evl("document.querySelector('[data-upgrade=heat-death-palm]').disabled") is True)
    check("balance starts at 0", evl("game.balance") == 0)
    values = evl("Object.fromEntries(UPGRADES.map(u => [u.id, purchaseValue(u, planPurchase(u))]))")
    check("every income upgrade shows a value estimate", evl("[...document.querySelectorAll('#shop-list .up-value')].filter(e => e.textContent.includes('/s • back ~')).length") == 17)
    check("opening click vs auto EV within 8x", values["windup-hand"]["payback"] / values["padded-palm"]["payback"] < 8,
          f"(padded {values['padded-palm']['payback']:.1f}s, windup {values['windup-hand']['payback']:.1f}s)")
    check("all income value estimates finite/positive", all(v["delta"] > 0 and v["payback"] > 0 for k, v in values.items() if k != "heat-death-palm"))

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
      for (let i = 0; i < 40 && game.balance < 30; i++) {
        st.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));
        await new Promise(r => setTimeout(r, 110));
      }
      return game.balance;
    })()""")
    bal = evl("game.balance")
    check("real smacks bank enough for Padded Palm (30)", bal >= 30, f"(balance {bal:.1f})")
    check("exactly one affordable Best value badge", evl("updateShop(); document.querySelectorAll('#shop-list .upgrade.best-value').length") == 1)

    # 2. buy Padded Palm through the real shop button
    evl("updateShop(); document.querySelector('[data-upgrade=padded-palm]').click()")
    time.sleep(0.3)
    check("padded palm owned", evl("game.owned['padded-palm'] || 0") == 1)
    check("manual hand keeps the original white glove", "assets/hand.png" in evl("document.querySelector('#hand img').getAttribute('src')"))
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
    evl("updateShop(); document.querySelector('[data-upgrade=windup-hand]').click()")
    time.sleep(0.3)
    check("wind-up hand owned", evl("game.owned['windup-hand'] || 0") == 1)
    check("buying auto adds no persistent stage actors", evl("document.querySelectorAll('.army-unit, .special-charm').length") == 0)
    check("rates line shows auto income", "auto" in evl("document.getElementById('rates').textContent"),
          evl("document.getElementById('rates').textContent"))
    b_idle0 = evl("game.balance")
    time.sleep(3.5)
    b_idle1 = evl("game.balance")
    check("balance grows while idle", b_idle1 > b_idle0 + 0.3, f"({b_idle0:.2f} -> {b_idle1:.2f})")

    shot("clicker_desktop.png")

    # Cheek Balance: eight real pointer smacks, alternating actual cheeks.
    balance_state = evl("""(async () => {
      const st = document.getElementById('stage');
      const r = st.getBoundingClientRect();
      cheekBalance = 0; lastCheekSide = ''; cheekBalanceUntil = 0;
      const hit = (fx) => st.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'mouse',
        clientX: r.left + fx * r.width,
        clientY: r.top + 0.665 * r.height,
      }));
      for (let i = 0; i < 8; i++) {
        hit(i % 2 ? CHEEK_R.x : CHEEK_L.x);
        await new Promise(res => setTimeout(res, 110));
      }
      return {
        mult: cheekBalanceMult(performance.now()),
        live: document.getElementById('cheek-balance').classList.contains('live'),
        message: document.getElementById('milestone').textContent,
      };
    })()""")
    check("alternating cheeks activates Perfect Balance x5", balance_state["mult"] == 5 and balance_state["live"] is True,
          f"({balance_state})")

    # 4. x10 bulk buy (topped up via the app's own addPoints)
    evl("addPoints(5000); updateShop();")
    evl("document.getElementById('buy-10').click()")
    before10 = evl("game.owned['padded-palm']")
    evl("document.querySelector('[data-upgrade=padded-palm]').click()")
    after10 = evl("game.owned['padded-palm']")
    check("x10 buys ten at once", after10 - before10 == 10, f"({before10} -> {after10})")
    evl("document.getElementById('buy-1').click()")

    # 5. prestige: fund a star, confirm twice, verify reset + star kept
    evl("addPoints(120000); updateShop();")
    check("a star is pending", evl("pendingStars()") >= 1, f"(pending {evl('pendingStars()')})")
    evl("document.getElementById('prestige-btn').click()")   # arm
    evl("document.getElementById('prestige-btn').click()")   # confirm
    time.sleep(0.3)
    check("star banked", evl("game.stars") >= 1)
    check("balance reset by prestige", evl("game.balance") < 5, f"({evl('game.balance'):.1f})")
    check("upgrades reset by prestige", evl("Object.keys(game.owned).length") == 0)
    check("scene still has no persistent actors after prestige", evl("document.querySelectorAll('.army-unit, .special-charm').length") == 0)
    check("hand remains the original white glove after prestige", "assets/hand.png" in evl("document.querySelector('#hand img').getAttribute('src')"))

    # 5b. Butt Star perks: Severance + Board survive a Prestige.
    stars_before_perks = evl("game.stars += 12; updateShop(); showShopTab('stars'); ({total: game.stars, available: availableStars()})")
    check("star tab opens the perk pane", evl("!document.getElementById('pane-stars').hidden && document.getElementById('pane-upgrades').hidden") is True)
    evl("document.querySelector('[data-star-perk=severance]').click(); document.querySelector('[data-star-perk=board]').click();")
    time.sleep(0.3)
    check("Severance Package bought with Butt Stars", evl("starPerk('severance')") == 1)
    check("Board of Directors bought with Butt Stars", evl("starPerk('board')") == 1)
    check("spent stars reduce only the available balance",
          evl("availableStars()") == stars_before_perks["available"] - 5 and evl("game.stars") == stars_before_perks["total"],
          f"({stars_before_perks} -> available {evl('availableStars()')}, total {evl('game.stars')})")
    board_result = evl("""(() => {
      const beforeOwned = Object.values(game.owned).reduce((a,b)=>a+b,0);
      const beforeBalance = game.balance;
      addPoints(100); updateShop(); tickBoard();
      return {
        beforeOwned,
        afterOwned: Object.values(game.owned).reduce((a,b)=>a+b,0),
        spent: beforeBalance + 100 - game.balance,
      };
    })()""")
    check("Board auto-buys a best-value upgrade", board_result["afterOwned"] > board_result["beforeOwned"] and board_result["spent"] > 0,
          f"({board_result})")
    shot("star_perks.png")
    evl("document.getElementById('board-on').click(); showShopTab('upgrades'); addPoints(120000); updateShop();")
    evl("document.getElementById('prestige-btn').click()")
    evl("document.getElementById('prestige-btn').click()")
    time.sleep(0.3)
    check("Severance seeds the next Prestige run", evl("game.owned['padded-palm']") == 5 and evl("game.owned['windup-hand']") == 5,
          f"({evl('game.owned')})")

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
    bal_reloaded = evl("game.balance")
    check("balance persists across reload", 0 <= bal_reloaded - bal_post < 150,
          f"({bal_post:.0f} -> {bal_reloaded:.0f})")

    # 7. Universe Reload: R&D unlocks Heat Death; the next manual smack
    # shows the reload overlay, then resets into Universe #2 with Fluff.
    evl("game.settings.board = false; game.stars += 15; updateShop(); showShopTab('stars'); document.querySelector('[data-star-perk=heat-death-rd]').click();")
    time.sleep(0.3)
    check("Heat Death R&D bought", evl("starPerk('heat-death-rd')") == 1)
    evl("showShopTab('upgrades'); addPoints(60000000); updateShop(); document.querySelector('[data-upgrade=heat-death-palm]').click();")
    time.sleep(0.3)
    check("Heat Death Palm bought", evl("game.owned['heat-death-palm'] || 0") == 1)
    check("doom warning appears after Heat Death", evl("document.getElementById('doom').hidden") is False)
    evl("document.getElementById('stage').dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));")
    time.sleep(0.8)
    check("Universe Reload overlay appears", evl("document.getElementById('universe-overlay').hidden") is False)
    shot("universe_reload.png")
    evl("document.getElementById('universe-overlay').click();")
    time.sleep(0.3)
    universe_state = evl("({universes: game.universes, fluff: game.fluff, stars: game.stars, owned: Object.keys(game.owned).length, mult: globalMult(), tagline: document.querySelector('.tagline').textContent, pane: !document.getElementById('pane-universe').hidden})")
    check("Universe Reload creates Universe #2", universe_state["universes"] == 1 and "Universe #2" in universe_state["tagline"],
          f"({universe_state})")
    check("Universe Reload grants Primordial Fluff", universe_state["fluff"] >= 3, f"({universe_state})")
    check("Universe Reload resets stars and run upgrades", universe_state["stars"] == 0 and universe_state["owned"] == 0)
    check("completed universe grants x2 points", universe_state["mult"] == 2, f"({universe_state})")
    check("Universe Reload opens the Fluff pane", universe_state["pane"] is True)
    shot("universe_pane.png")
    evl("document.querySelector('[data-fluff-perk=deja-vu]').click();")
    time.sleep(0.3)
    check("Primordial Fluff buys an eternal perk", evl("fluffPerk('deja-vu')") == 1 and evl("game.fluff") == universe_state["fluff"] - 1)

    print("JS errors:", errors if errors else "none")
    if errors:
        FAILURES.append("js errors")
    ws.close()
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    shutil.rmtree(PROFILE_DIR, ignore_errors=True)

print("\nRESULT:", "ALL PASS" if not FAILURES else f"{len(FAILURES)} FAILING: {FAILURES}")
sys.exit(1 if FAILURES else 0)

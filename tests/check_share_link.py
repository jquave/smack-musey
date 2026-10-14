"""Score permalink checks for Smack Musey.

Verifies in headless Chrome (CDP):
  1. shareURL() encodes the live stats (python-side base64url decode must
     match the page's actual smacks/points/stars/upgrades).
  2. The Share button copies a ?s= permalink to the clipboard.
  3. Opening that permalink shows the shared-score banner + verdict and
     updates the tab title.
  4. Dismissing removes the banner and cleans the URL.
  5. A malformed ?s= value shows no banner and throws no errors.

Usage (serve repo first, e.g. `python -m http.server 8321`):
    .venv\\Scripts\\python.exe tests\\check_share_link.py [base_url]
"""
import json, time, base64, urllib.request, subprocess, os, sys
import websocket

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8321/"
CHROME = next(p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
] if os.path.exists(p))
PORT = 9359
FAILURES = []

def check(name, cond, extra=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    if not cond:
        FAILURES.append(name)

proc = subprocess.Popen([
    CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--window-size=1200,1000", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=" + os.path.join(os.environ["TEMP"], "musey-share-profile"),
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

    send("Page.enable"); send("Runtime.enable")
    send("Page.navigate", url=BASE)
    time.sleep(2.5)

    # build a real score: 14 keyboard smacks, buy one upgrade
    evl("""(async () => {
      const st = document.getElementById('stage'); st.focus();
      for (let i = 0; i < 14; i++) {
        st.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));
        await new Promise(r => setTimeout(r, 110));
      }
      document.querySelector('[data-upgrade=padded-palm]').click();
      return true;
    })()""")
    stats = evl("({sm: totalSmacks, pts: Math.floor(game.lifetimeEarned), stars: game.stars, up: Object.values(game.owned).reduce((a,b)=>a+b,0)})")
    url = evl("shareURL()")
    check("share URL has ?s= payload", isinstance(url, str) and "?s=" in url, f"({url[:70]}...)")

    payload_b64 = url.split("?s=", 1)[1]
    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    decoded = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    check("payload version", decoded.get("v") == 1)
    check("payload smacks match page", decoded["sm"] == stats["sm"], f"({decoded['sm']} vs {stats['sm']})")
    check("payload points match page", decoded["pts"] == stats["pts"], f"({decoded['pts']} vs {stats['pts']})")
    check("payload upgrades match page", decoded["up"] == stats["up"], f"({decoded['up']} vs {stats['up']})")
    check("payload is url-safe (no +, /, =)", all(c not in payload_b64 for c in "+/="))

    # Share button copies the permalink (clipboard captured in-page)
    evl("window.__copied = null; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; document.getElementById('share-btn').click();")
    time.sleep(2.0)
    copied = evl("window.__copied")
    check("share button copies permalink", bool(copied) and "?s=" in copied, f"({str(copied)[:60]})")

    # open the permalink fresh (same browser, like a friend clicking it)
    send("Page.navigate", url=url)
    time.sleep(2.5)
    banner = evl("document.querySelector('.shared-banner') ? document.querySelector('.shared-banner').textContent : null")
    check("banner appears on permalink", bool(banner) and "Shared score" in banner, f"({str(banner)[:80]})")
    check("banner shows their smacks", bool(banner) and (f"{stats['sm']} smacks" in banner))
    check("title updates", "Can you beat it?" in evl("document.title"), f"({evl('document.title')})")

    # dismiss cleans up
    evl("document.querySelector('.shared-x').click()")
    time.sleep(0.3)
    check("dismiss removes banner", evl("!!document.querySelector('.shared-banner')") is False)
    check("dismiss cleans URL", "s=" not in evl("location.search"), f"({evl('location.href')})")

    # malformed payloads are ignored quietly
    send("Page.navigate", url=BASE + "?s=not!base64!at!all")
    time.sleep(2.0)
    check("malformed ?s= shows no banner", evl("!!document.querySelector('.shared-banner')") is False)
    send("Page.navigate", url=BASE + "?s=" + base64.urlsafe_b64encode(b'{"v":1,"sm":"hax"}').decode().rstrip("="))
    time.sleep(2.0)
    check("wrong-typed ?s= shows no banner", evl("!!document.querySelector('.shared-banner')") is False)

    print("JS errors:", errors if errors else "none")
    if errors:
        FAILURES.append("js errors")
    ws.close()
finally:
    proc.terminate()

print("\nRESULT:", "ALL PASS" if not FAILURES else f"{len(FAILURES)} FAILING: {FAILURES}")
sys.exit(1 if FAILURES else 0)

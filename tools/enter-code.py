#!/usr/bin/env python3
"""
Enter an email verification code into a Greenhouse-style OTP field and submit.

Runs ON the box whose real Chrome holds the application (e.g. agt-2), driven via
CDP on --port (default 9222). The security code is N per-character boxes
(#security-input-0..N-1, maxlength 1); we native-set each so React's onChange
fires, then click "Submit application" and verify the confirmation.

Usage (on the Chrome host):
  /tmp/cdpvenv/bin/python3 enter-code.py --code 8F3KQ2P1 [--port 9222] [--submit-label "Submit application"]

Get the code first (on dev, once the account is authorized):
  ctl gmail fetch-code --account rooseveltadvisors@gmail.com --from greenhouse \\
    --pattern '[A-Za-z0-9]{8}' --wait 120
"""
import asyncio, json, sys, argparse, urllib.request, websockets


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", required=True)
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--submit-label", default="Submit application")
    ap.add_argument("--match", default="greenhouse", help="substring to pick the tab")
    a = ap.parse_args()
    code = a.code.strip()

    tabs = json.loads(urllib.request.urlopen(f"http://localhost:{a.port}/json").read())
    pages = [t for t in tabs if t["type"] == "page" and a.match in t.get("url", "")]
    if not pages:
        print(f"no page tab matching '{a.match}'", file=sys.stderr)
        return 2
    page = pages[0]

    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
        _id = [0]

        async def cmd(m, p=None):
            _id[0] += 1
            i = _id[0]
            await ws.send(json.dumps({"id": i, "method": m, "params": p or {}}))
            while True:
                x = json.loads(await ws.recv())
                if "method" in x:
                    continue
                if x.get("id") == i:
                    return x.get("result", {})

        async def js(e):
            r = await cmd("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": True})
            return r.get("result", {}).get("value")

        async def click_sel(sel):
            doc = await cmd("DOM.getDocument", {"depth": 0})
            root = doc.get("root", {}).get("nodeId")
            q = await cmd("DOM.querySelector", {"nodeId": root, "selector": sel})
            nid = q.get("nodeId")
            if not nid:
                return False
            await cmd("DOM.scrollIntoViewIfNeeded", {"nodeId": nid})
            bm = await cmd("DOM.getBoxModel", {"nodeId": nid})
            c = bm.get("model", {}).get("content")
            if not c:
                return False
            x, y = (c[0] + c[4]) / 2, (c[1] + c[5]) / 2
            await cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
            await cmd("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1})
            await cmd("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1})
            return True

        await cmd("Runtime.enable")
        await cmd("DOM.enable")

        # native-set each OTP box so React's controlled onChange fires
        setter = r"""
        window.__sn=function(el,v){var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
        """
        await js(setter)
        n = await js(
            "(function(){var b=[].slice.call(document.querySelectorAll(\"input[id^='security-input-']\"));return b.length;})()"
        )
        if not n:
            print("no security-input boxes found (is the code gate showing?)", file=sys.stderr)
            return 3
        if len(code) != n:
            print(f"warning: code length {len(code)} != {n} boxes; filling min()", file=sys.stderr)

        await js(
            "(function(code){var b=[].slice.call(document.querySelectorAll(\"input[id^='security-input-']\"));"
            "for(var i=0;i<b.length&&i<code.length;i++){window.__sn(b[i],code[i]);}"
            "return b.map(function(x){return x.value;}).join('');})(%s)" % json.dumps(code)
        )
        await asyncio.sleep(0.6)

        filled = await js(
            "[].slice.call(document.querySelectorAll(\"input[id^='security-input-']\")).map(function(x){return x.value;}).join('')"
        )
        print(f"boxes now: {filled}", file=sys.stderr)
        if filled.replace(" ", "") != code[: len(filled)]:
            print(f"code not accepted into boxes (got '{filled}')", file=sys.stderr)
            return 4

        # tag + click submit
        await js(
            "var btn=[].slice.call(document.querySelectorAll('button')).find(function(b){return b.textContent.trim()===%s;});if(btn)btn.id='__submit__';"
            % json.dumps(a.submit_label)
        )
        clicked = await click_sel("#__submit__")
        if not clicked:
            print("submit button not found/clickable", file=sys.stderr)
            return 5
        await asyncio.sleep(7)

        st = await js(
            r"""JSON.stringify({url:location.href,ok:/thank you|application.{0,20}received|submitted|we.{0,3}received/i.test(document.body.innerText),errs:[].slice.call(document.querySelectorAll('[class*=error]')).map(function(e){return e.textContent.trim();}).filter(function(t){return t&&t.length<70;}).slice(0,6)})"""
        )
        print(st)
        obj = json.loads(st)
        return 0 if obj.get("ok") else 6


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

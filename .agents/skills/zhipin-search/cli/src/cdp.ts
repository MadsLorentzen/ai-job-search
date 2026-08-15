// Minimal Chrome DevTools Protocol (CDP) client over bun's native WebSocket.
//
// This skill reads BOSS直聘 through the user's OWN logged-in Chrome session, so
// it can see listings behind BOSS直聘's login wall. Read-only: search + detail.
//
// Prerequisite — launch Chrome with remote debugging enabled AND logged into
// BOSS直聘, e.g.:
//   open -a "Google Chrome" --args --remote-debugging-port=9222 \
//       --remote-allow-origins=* --user-data-dir="$HOME/zhipin-chrome-profile"
// Chrome 111+ rejects CDP WebSocket connections unless --remote-allow-origins=*.

export interface CDPTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl: string
}

export const CDP_HTTP_URL =
  process.env.ZHIPIN_CDP_URL || "http://127.0.0.1:9222"

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CDP_HTTP_URL}${path}`, init)
  if (!res.ok) {
    throw new Error(
      `CDP ${path} failed: HTTP ${res.status}. ` +
        `Is Chrome running with --remote-debugging-port=9222?`,
    )
  }
  return (await res.json()) as T
}

export async function listTargets(): Promise<CDPTarget[]> {
  return httpJson<CDPTarget[]>("/json/list")
}

export async function newTab(url = "about:blank"): Promise<CDPTarget> {
  const res = await fetch(`${CDP_HTTP_URL}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  })
  if (!res.ok) {
    throw new Error(
      `Could not open a Chrome tab via CDP (HTTP ${res.status}). ` +
        `Start Chrome with --remote-debugging-port=9222 and log into BOSS直聘 first.`,
    )
  }
  return (await res.json()) as CDPTarget
}

export async function closeTab(id: string): Promise<void> {
  await fetch(`${CDP_HTTP_URL}/json/close/${id}`).catch(() => {})
}

/**
 * Reuse an existing page tab (a human browses in one tab, not by opening and
 * closing a tab per request — rapid open/close trips BOSS直聘's risk control).
 * Falls back to opening a new tab when none exists yet.
 */
export async function getPageTab(): Promise<CDPTarget> {
  const targets = await listTargets()
  for (const t of targets) {
    if (t.type === "page" && !t.url.startsWith("devtools://")) return t
  }
  return newTab()
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class CDPSession {
  private ws: WebSocket
  private nextId = 0
  private pending = new Map<number, Pending>()

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.onmessage = (event: MessageEvent) => {
      let msg: { id?: number; error?: { message: string }; result?: unknown }
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.id === undefined) return
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
    }
  }

  static async connect(wsUrl: string): Promise<CDPSession> {
    const ws = new WebSocket(wsUrl)
    const opened = new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () =>
        reject(
          new Error(
            "Could not connect to Chrome over WebSocket. Relaunch Chrome with " +
              "--remote-allow-origins=* (Chrome 111+ blocks CDP WebSocket " +
              "connections without it).",
          ),
        )
    })
    await Promise.race([
      opened,
      sleep(10000).then(() => {
        throw new Error("Timed out connecting to Chrome CDP")
      }),
    ])
    return new CDPSession(ws)
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression: string): Promise<unknown> {
    const res = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      exceptionDetails?: { text?: string }
      result?: { value?: unknown }
    }
    if (res.exceptionDetails) {
      throw new Error(
        `Page evaluation failed: ${res.exceptionDetails.text || "exception"}`,
      )
    }
    return res.result?.value
  }

  async navigate(url: string): Promise<void> {
    await this.send("Page.navigate", { url })
  }

  close(): void {
    this.ws.close()
  }
}

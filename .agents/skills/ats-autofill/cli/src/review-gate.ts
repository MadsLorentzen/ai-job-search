export type ReviewDecision = "continue" | "cancel"

export interface ReviewRequest {
  url: string
  screenshot?: string | null
}

export interface ReviewGate {
  waitForDecision(request: ReviewRequest): Promise<ReviewDecision>
}

type StdinLike = {
  once(event: "data" | "end" | "close" | "error", listener: (...args: unknown[]) => void): StdinLike
  off?(event: string, listener: (...args: unknown[]) => void): StdinLike
}

type Writer = { write(chunk: string): unknown }

export class StdinReviewGate implements ReviewGate {
  constructor(
    private readonly stdin: StdinLike = process.stdin,
    private readonly stderr: Writer = process.stderr,
  ) {}

  waitForDecision(request: ReviewRequest): Promise<ReviewDecision> {
    this.stderr.write(
      "\nForm filled. The browser is open and Submit has NOT been clicked.\n" +
        "Review every field, then submit manually. Press Enter here to close the browser.\n",
    )
    return new Promise((resolve) => {
      let settled = false
      const finish = (decision: ReviewDecision) => {
        if (settled) return
        settled = true
        this.stdin.off?.("data", onData)
        this.stdin.off?.("end", onCancel)
        this.stdin.off?.("close", onCancel)
        this.stdin.off?.("error", onCancel)
        resolve(decision)
      }
      const onData = () => finish("continue")
      const onCancel = () => finish("cancel")
      this.stdin.once("data", onData)
      this.stdin.once("end", onCancel)
      this.stdin.once("close", onCancel)
      this.stdin.once("error", onCancel)
      void request
    })
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface DeskReviewGateOptions {
  endpoint: string
  token: string
  fetchImpl?: FetchLike
  pollMs?: number
  signal?: AbortSignal
}

export class DeskReviewGate implements ReviewGate {
  constructor(private readonly options: DeskReviewGateOptions) {}

  async waitForDecision(request: ReviewRequest): Promise<ReviewDecision> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const base = this.options.endpoint.replace(/\/$/, "")
    try {
      let token = this.options.token
      if (!token) {
        const started = await fetchImpl(`${base}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: this.options.signal,
        })
        if (!started.ok) return "cancel"
        const startedBody = await started.json() as { token?: string }
        token = startedBody.token || ""
        if (!token) return "cancel"
      }
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }
      const ready = await fetchImpl(`${base}/ready`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          token,
          url: request.url,
          screenshot: request.screenshot ?? null,
        }),
        signal: this.options.signal,
      })
      if (!ready.ok) return "cancel"

      const started = Date.now()
      while (!this.options.signal?.aborted) {
        const response = await fetchImpl(`${base}/decision`, {
          method: "GET",
          headers,
          signal: this.options.signal,
        })
        if (!response.ok) return "cancel"
        const body = await response.json() as { decision?: string; pending?: boolean }
        if (body.decision === "continue" || body.decision === "cancel") return body.decision
        if (body.pending === false) return "cancel"
        await new Promise((resolve) => setTimeout(resolve, this.options.pollMs ?? 200))
        if (Date.now() - started > 30 * 60 * 1000) return "cancel"
      }
      return "cancel"
    } catch {
      return "cancel"
    }
  }
}

export function createReviewGateFromEnv(env: NodeJS.ProcessEnv = process.env): ReviewGate {
  const token = env.JOB_SEARCH_DESK_REVIEW_TOKEN
  const endpoint = env.JOB_SEARCH_DESK_REVIEW_URL
  if (endpoint) return new DeskReviewGate({ endpoint, token: token || "" })
  return new StdinReviewGate()
}

export function reviewGateHasSubmit(gate: ReviewGate): boolean {
  return typeof (gate as ReviewGate & { submit?: unknown }).submit === "function"
}

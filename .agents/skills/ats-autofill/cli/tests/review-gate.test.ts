import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import {
  DeskReviewGate,
  StdinReviewGate,
  reviewGateHasSubmit,
} from "../src/review-gate.ts"

function fakeStdin() {
  const stream = new EventEmitter()
  return stream as EventEmitter & { off: typeof stream.off }
}

describe("StdinReviewGate", () => {
  test("keeps waiting until Enter, then continues", async () => {
    const stdin = fakeStdin()
    const writes: string[] = []
    const gate = new StdinReviewGate(stdin, { write: (text) => writes.push(text) })
    let browserOpen = true
    const pending = gate.waitForDecision({ url: "https://jobs.example/1" }).then((decision) => {
      browserOpen = false
      return decision
    })
    expect(browserOpen).toBe(true)
    expect(writes.join("")).toContain("Submit has NOT been clicked")
    stdin.emit("data", Buffer.from("\n"))
    expect(await pending).toBe("continue")
    expect(reviewGateHasSubmit(gate)).toBe(false)
  })

  test("stdin close cancels without a submit path", async () => {
    const stdin = fakeStdin()
    const gate = new StdinReviewGate(stdin, { write: () => {} })
    const pending = gate.waitForDecision({ url: "https://jobs.example/1" })
    stdin.emit("close")
    expect(await pending).toBe("cancel")
  })
})

describe("DeskReviewGate", () => {
  test("Continue closes after browser-ready; Cancel is distinct; disconnect cancels", async () => {
    const calls: string[] = []
    const gate = new DeskReviewGate({
      endpoint: "http://127.0.0.1:9/autofill",
      token: "tok-1",
      pollMs: 1,
      fetchImpl: async (input, init) => {
        const url = String(input)
        calls.push(`${init?.method || "GET"} ${url}`)
        if (url.endsWith("/ready")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response(JSON.stringify({ decision: "continue" }), { status: 200 })
      },
    })
    expect(await gate.waitForDecision({ url: "https://jobs.example/1", screenshot: "shot.png" })).toBe("continue")
    expect(calls[0]).toContain("POST")
    expect(calls[0]).toContain("/ready")
    expect(reviewGateHasSubmit(gate)).toBe(false)

    const cancelGate = new DeskReviewGate({
      endpoint: "http://127.0.0.1:9/autofill",
      token: "tok-1",
      fetchImpl: async (input) => {
        if (String(input).endsWith("/ready")) return new Response("{}", { status: 200 })
        return new Response(JSON.stringify({ decision: "cancel" }), { status: 200 })
      },
    })
    expect(await cancelGate.waitForDecision({ url: "https://jobs.example/1" })).toBe("cancel")

    const disconnected = new DeskReviewGate({
      endpoint: "http://127.0.0.1:9/autofill",
      token: "tok-1",
      fetchImpl: async () => {
        throw new Error("disconnected")
      },
    })
    expect(await disconnected.waitForDecision({ url: "https://jobs.example/1" })).toBe("cancel")
  })
})

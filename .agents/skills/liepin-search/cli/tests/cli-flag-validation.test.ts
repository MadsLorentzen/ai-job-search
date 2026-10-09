import { describe, expect, test } from "bun:test"

async function run(args: string[]) {
  return Bun.spawn(["bun", "run", "../src/cli.ts", ...args], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" }).exited.then(async (code) => ({ code }))
}

describe("liepin CLI safety boundary", () => {
  test("rejects mutating command and unknown flag before invoking upstream", async () => {
    expect((await run(["apply", "--job-id", "1"])).code).toBe(1)
    expect((await run(["search", "--token", "secret"])).code).toBe(1)
  })
})

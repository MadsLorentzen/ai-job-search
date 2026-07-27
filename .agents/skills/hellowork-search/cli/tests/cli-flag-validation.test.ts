import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

function expectJSONError(stderr: string): { error: string; code: string } {
  const parsed = JSON.parse(stderr) as { error: string; code: string }
  expect(parsed.error).toBeTruthy()
  expect(parsed.code).toBeTruthy()
  return parsed
}

describe("flag validation", () => {
  test("unknown command exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["frobnicate"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(expectJSONError(result.stderr).code).toBe("BAD_CMD")
  })

  test("detail without an id exits 1", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(expectJSONError(result.stderr).code).toBe("NO_ID")
  })

  test("detail with an unparseable id exits 1 without a network call", async () => {
    const result = await runCLI(["detail", "not-an-id"])
    expect(result.exitCode).toBe(1)
    expect(expectJSONError(result.stderr).code).toBe("BAD_ID")
  })

  test("non-numeric --limit exits 1", async () => {
    const result = await runCLI(["search", "-q", "dev", "-n", "many"])
    expect(result.exitCode).toBe(1)
    expect(expectJSONError(result.stderr).code).toBe("BAD_ARG")
  })

  test("invalid --sort exits 1", async () => {
    const result = await runCLI(["search", "-q", "dev", "--sort", "salary"])
    expect(result.exitCode).toBe(1)
    expect(expectJSONError(result.stderr).code).toBe("BAD_ARG")
  })

  test("unknown --contract value exits 1 and lists the valid values", async () => {
    const result = await runCLI(["search", "-q", "dev", "-c", "Portage"])
    expect(result.exitCode).toBe(1)
    const err = expectJSONError(result.stderr)
    expect(err.code).toBe("BAD_CONTRACT")
    expect(err.error).toContain("Freelance")
  })

  test("no command prints help and exits 1", async () => {
    const result = await runCLI([])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("hellowork-cli")
  })
})

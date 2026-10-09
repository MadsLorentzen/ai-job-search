import { spawn } from "node:child_process"
import type { SearchOptions } from "../helpers.js"
import { classifyUpstreamError, formatResults, mapSearchArgs, parseUpstreamResponse, redactSensitive, writeError } from "../helpers.js"

export async function runSearch(options: SearchOptions): Promise<number> {
  try {
    const output = await invokeOfficialCli(mapSearchArgs(options))
    const parsed = parseUpstreamResponse(output)
    if (parsed.records > 0 && !parsed.results.length) { writeError("official liepin-cli returned no parseable job records", "PARSE_DEGRADED"); return 1 }
    const capped = options.limit === undefined ? parsed.results : parsed.results.slice(0, options.limit)
    process.stdout.write(formatResults(capped, options.page, options.format))
    return 0
  } catch (error) {
    const message = redactSensitive(error instanceof Error ? error.message : String(error))
    const code = classifyUpstreamError(message)
    writeError(message, code)
    return 1
  }
}

export function invokeOfficialCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("liepin-cli", args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", NO_COLOR: "1" },
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `liepin-cli exited with code ${code ?? "unknown"}`)))
  })
}

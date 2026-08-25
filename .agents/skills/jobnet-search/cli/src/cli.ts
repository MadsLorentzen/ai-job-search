import { createCLI } from "@bunli/core"
import { writeError } from "./helpers.js"
import { search } from "./commands/search.js"
import { detail } from "./commands/detail.js"
import { occupations } from "./commands/occupations.js"
import { suggestions } from "./commands/suggestions.js"

const cli = await createCLI({
  name: "jobnet-cli",
  version: "0.1.0",
  description: "CLI for the Jobnet.dk Danish government job portal API",
})

const commands = [search, detail, occupations, suggestions]
for (const command of commands) {
  cli.command(command)
}

// Reject unknown --flags before dispatch. bunli silently discards them, and a
// silently discarded filter changes what the search returns without any error
// (a wrong flag name once returned an entire portal's database as if it
// matched the query). add-portal.md's contract requires a bogus flag to exit 1
// with a JSON error on stderr; this enforces it for the reference CLIs too.
const argv = process.argv.slice(2)
const invoked = commands.find((c) => (c as { name?: string }).name === argv[0])
if (invoked) {
  const known = new Set([
    ...Object.keys((invoked as { options?: Record<string, unknown> }).options ?? {}),
    "help",
    "version",
  ])
  for (const token of argv.slice(1)) {
    if (token === "--") break
    if (token.startsWith("--")) {
      const flag = token.slice(2).split("=")[0]
      if (!known.has(flag)) {
        writeError(
          `unknown flag --${flag} for '${argv[0]}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          "UNKNOWN_FLAG",
        )
        process.exit(1)
      }
    }
  }
}

await cli.run()

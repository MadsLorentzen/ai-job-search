import { createCLI } from "@bunli/core"
import { search } from "./commands/search.js"
import { detail } from "./commands/detail.js"

const cli = await createCLI({
  name: "jobbank-cli",
  version: "1.0.0",
  description: "CLI for Akademikernes Jobbank (jobbank.dk) — job search for highly educated candidates",
})

cli.command(search)
cli.command(detail)

await cli.run()

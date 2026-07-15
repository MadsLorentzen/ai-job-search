import { createCLI } from "@bunli/core"
import { search } from "./commands/search.js"
import { detail } from "./commands/detail.js"

const cli = await createCLI({
  name: "jobindex-cli",
  version: "0.1.0",
  description: "CLI for searching jobs on Jobindex.dk",
})

cli.command(search)
cli.command(detail)

await cli.run()

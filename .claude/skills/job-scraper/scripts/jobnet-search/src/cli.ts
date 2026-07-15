import { createCLI } from "@bunli/core"
import { search } from "./commands/search.js"
import { detail } from "./commands/detail.js"
import { occupations } from "./commands/occupations.js"
import { suggestions } from "./commands/suggestions.js"

const cli = await createCLI({
  name: "jobnet-cli",
  version: "0.1.0",
  description: "CLI for the Jobnet.dk Danish government job portal API",
})

cli.command(search)
cli.command(detail)
cli.command(occupations)
cli.command(suggestions)

await cli.run()

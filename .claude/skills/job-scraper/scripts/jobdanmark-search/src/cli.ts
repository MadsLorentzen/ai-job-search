import { createCLI } from "@bunli/core"
import { search } from "./commands/search.js"
import { detail } from "./commands/detail.js"
import { categories } from "./commands/categories.js"
import { autocomplete } from "./commands/autocomplete.js"
import { locations } from "./commands/locations.js"

const cli = await createCLI({
  name: "jobdanmark-cli",
  version: "1.0.0",
  description: "CLI for the Jobdanmark.dk public job search API",
})

cli.command(search)
cli.command(detail)
cli.command(categories)
cli.command(autocomplete)
cli.command(locations)

await cli.run()

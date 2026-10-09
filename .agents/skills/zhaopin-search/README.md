# zhaopin-search

Read-only public-page adapter for 智联招聘. The CLI emits the repository's
standard job object, including normalized Chinese salary, date, experience,
education, and provenance (`portal: zhaopin-search`, `access_mode: public_html`).

Install dependencies in the CLI directory with `bun install`, then use
`bun run src/cli.ts --help`. No cookies or secrets are read.

# liepin-search

Read-only adapter for Chinese Liepin (猎聘) job search through the official
`liepin-cli`. It requires that upstream CLI to be installed and authorized.
Only `search` is supported; job application, resume mutation, messaging, and
CAPTCHA bypass are excluded. The skill is disabled by default until an
authenticated live search confirms the upstream response schema.

```powershell
bun run .agents/skills/liepin-search/cli/src/cli.ts search --query "Python开发" --city 北京 --limit 5 --format json
```

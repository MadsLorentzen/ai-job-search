# _templates — record templates

Knap templates that instantiate the workspace's records. New unit of work =
render a template, never a blank page:

| Template | Renders | Used by |
| --- | --- | --- |
| `posting.md` | `postings/<job_key>.md` snapshots (via the defuddle→knap pipe in `fetch-posting`) | `methods/01-scrape.md` |
| `application.md` | `applications/<company>_<role>/README.md` record stub | `methods/03-apply.md` |
| `outcome.md` | `applications/<company>_<role>/outcome.md` | `methods/04-outcome.md` |

```sh
knap render _templates/application.md --data <json> --set company=... --set role=...
```

Templates are factory: changing the record schema happens here, once, and
every instantiation follows.

# ATS board endpoints

Unauthenticated JSON. Tokens are public career-page slugs.

| Platform | List | Detail |
|----------|------|--------|
| Greenhouse | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}` |
| Greenhouse company | `GET https://boards-api.greenhouse.io/v1/boards/{token}` | |
| Lever | `GET https://api.lever.co/v0/postings/{token}?mode=json` | `GET https://api.lever.co/v0/postings/{token}/{id}` |
| Ashby | `GET https://api.ashbyhq.com/posting-api/job-board/{token}` | job objects are in the list payload |

Query and location filters are applied **client-side**. Recency uses `updated_at` / `createdAt` / `publishedAt`.

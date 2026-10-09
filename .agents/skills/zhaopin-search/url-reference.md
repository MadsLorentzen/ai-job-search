# Zhaopin URL Reference

## Public search

```text
https://www.zhaopin.com/sou?kw=<url-encoded-keywords>&p=<1-indexed-page>
```

The adapter appends `--city` to the query text so it does not depend on opaque
location IDs. The public SSR result cards use `joblist-box__item` and expose
title, salary, location, experience, education, company, and detail URL.

## Public detail

```text
https://www.zhaopin.com/jobdetail/<position-number>.htm
```

Observed selectors (2026-09-01): `summary-planes__title`,
`summary-planes__info`, `summary-planes__salary`,
`describtion-card__detail-content`, `address-info__content`, and
`company-info__name`.

## Failure signals

`passport.zhaopin.com`, `登录/注册`, `验证码`, or `安全验证` indicate an
authentication/verification response. Such pages must never become job data.

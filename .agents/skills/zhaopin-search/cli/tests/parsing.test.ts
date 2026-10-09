import { describe, expect, test } from "bun:test"
import { buildSearchUrl, isBlockedPage, parseJobCards, parseJobDetail, toStandardJob } from "../src/helpers.js"
import { parseChineseSalary } from "../../../../shared/job-normalization.js"
import { normalizeEducation, normalizeExperience, normalizeLocation, parseChineseDate } from "../../../../shared/job-normalization.js"
import { crossPortalJobKey, normalizeUrl, sourceJobKey } from "../../../../shared/job-dedupe.js"
import { validateStandardJob } from "../../../../shared/job-schema.js"

const SEARCH = `<div class="joblist-box__item"><a class="jobinfo__name" href="http://www.zhaopin.com/jobdetail/CC123J456.htm">Python工程师 &amp; 平台</a><p class="jobinfo__salary">1.5-2.5万·13薪</p><div class="jobinfo__other-info-item"><span>北京·海淀</span></div><div class="jobinfo__other-info-item">1-3年</div><div class="jobinfo__other-info-item">本科</div><div class="companyinfo"><a class="companyinfo__name" href="/companydetail/CZ1.htm">示例科技</a></div></div><script>"positionNumber":"CC123J456","publishTime":"2026-09-01 11:24:58"</script>`
const DETAIL = `<h1 class="summary-planes__title"><span>Python工程师</span></h1><span class="summary-planes__salary">1.5-2.5万·13薪</span><ul class="summary-planes__info"><li>北京 <span>海淀区</span></li><li>上地</li><li>1-3年</li><li>本科</li></ul><a class="company-info__name" href="/companydetail/CZ1.htm">示例科技</a><div class="describtion-card__detail-content">负责平台开发<br><div>熟悉 Python &amp; Web</div></div>`

describe("zhaopin parsing", () => {
  test("parses result cards and decodes entities", () => {
    const card = parseJobCards(SEARCH)[0]
    expect(card.title).toBe("Python工程师 & 平台")
    expect(card.company).toBe("示例科技")
    expect(card.salary).toBe("1.5-2.5万·13薪")
    expect(card.location).toBe("北京·海淀")
    expect(card.date).toBe("2026-09-01")
  })

  test("parses detail text and maps Chinese fields", () => {
    const job = toStandardJob(parseJobDetail(DETAIL, "https://www.zhaopin.com/jobdetail/CC123J456.htm", "CC123J456"))
    expect(job.title).toBe("Python工程师")
    expect(job.company).toBe("示例科技")
    expect(job.description).toContain("负责平台开发")
    expect(job.salary_min).toBe(15000)
    expect(job.salary_max).toBe(25000)
    expect(job.salary_months).toBe(13)
    expect(job.education).toBe("本科")
    expect(job.portal).toBe("zhaopin-search")
    expect(job.source).toBe("cli")
    expect(job.access_mode).toBe("public_html")
  })

  test("builds encoded pagination URL and detects blocked pages", () => {
    expect(buildSearchUrl("Python 后端", 2, "北京")).toContain("p=2")
    expect(buildSearchUrl("Python 后端", 2, "北京")).toContain("kw=Python+%E5%90%8E%E7%AB%AF+%E5%8C%97%E4%BA%AC")
    expect(isBlockedPage("<a href='https://passport.zhaopin.com/login'>登录/注册</a>")).toBe(true)
    expect(isBlockedPage("<h1>职位详情</h1>")).toBe(false)
  })

  test("inherits a Chinese salary unit when one side omits it", () => {
    expect(parseChineseSalary("1.5-2.5万")).toMatchObject({ min: 15000, max: 25000, unit: "month" })
    expect(parseChineseSalary("15-25K")).toMatchObject({ min: 15000, max: 25000, unit: "month" })
    expect(parseChineseSalary("20万-30万/年")).toMatchObject({ min: 200000, max: 300000, unit: "year" })
  })

  test("normalizes Chinese dates, experience, education, and location", () => {
    const now = new Date(2026, 8, 1, 12)
    expect(parseChineseDate("今天", now)).toBe("2026-09-01")
    expect(parseChineseDate("昨天", now)).toBe("2026-08-31")
    expect(parseChineseDate("3天前", now)).toBe("2026-08-29")
    expect(parseChineseDate("2026年8月20日", now)).toBe("2026-08-20")
    expect(normalizeExperience("经验不限")).toBe("不限")
    expect(normalizeExperience("应届毕业生")).toBe("应届生")
    expect(normalizeEducation("研究生及以上")).toBe("硕士")
    expect(normalizeLocation("北京·海淀·上地")).toEqual({ raw: "北京·海淀·上地", province: "北京", city: "海淀", district: "上地" })
  })

  test("separates source-local and cross-portal dedupe keys", () => {
    const zhaopinKey = sourceJobKey({ portal: "zhaopin-search", id: "123", url: "https://example.com/jobs/123?track=x" })
    const anotherPortalKey = sourceJobKey({ portal: "another-search", id: "123", url: "https://example.net/jobs/123" })
    expect(zhaopinKey).toBe("portal:zhaopin-search|id:123")
    expect(zhaopinKey).not.toBe(anotherPortalKey)
    expect(normalizeUrl("https://example.com/jobs/123?track=x#apply")).toBe("https://example.com/jobs/123")
    const a = { company: "示例 科技", title: "Python 工程师", location: "北京·海淀" }
    const b = { company: "示例科技", title: "Python工程师", location: "北京 海淀" }
    expect(crossPortalJobKey(a)).toBe(crossPortalJobKey(b))
  })

  test("validates required standard-job fields", () => {
    expect(validateStandardJob({ title: "", id: "", url: "", portal: "", fetched_at: "" })).toEqual([
      "id is required", "title is required", "url is required", "portal is required", "fetched_at is required",
    ])
  })
})

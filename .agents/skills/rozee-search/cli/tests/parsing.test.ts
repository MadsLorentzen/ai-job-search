import { describe, expect, test } from "bun:test"
import { parseJobDetail, parseSearchPage } from "../src/helpers.js"

describe("Rozee search parsing", () => {
  test("parses each embedded job record and keeps the permalink actionable", () => {
    const html = `<script>
      var data = {"jobs":{"basic":[
        {"jid":"123456","title_exact_en":"AI/ML Intern","company_name":"Example &amp; Co","city_exact":["Islamabad"],"displayDate":"2026-10-17 10:00:00","rozeePermaLink":"sample-role-islamabad-jobs-123456","description_raw":"Text with { braces }"},
        {"jid":"123457","title_exact_en":"Data Analyst","company_name":"Second Co","city":"Karachi","created":"2026-10-16","permaLink":"data-analyst-karachi-jobs-123457"}
      ]},"numFound":2};
    </script>`
    const page = parseSearchPage(html)
    expect(page.total).toBe(2)
    expect(page.malformedRecords).toBe(0)
    expect(page.jobs).toHaveLength(2)
    expect(page.jobs[0]).toMatchObject({
      id: "sample-role-islamabad-jobs-123456",
      jobId: "123456",
      title: "AI/ML Intern",
      company: "Example & Co",
      location: "Islamabad",
      url: "https://www.rozee.pk/sample-role-islamabad-jobs-123456",
    })
  })

  test("skips a malformed record without losing later valid records", () => {
    const html = `<script>{"jobs":{"basic":[
      {"jid":"bad","title_exact_en":"Broken","rozeePermaLink":},
      {"jid":"123456","title_exact_en":"Valid Job","city":"Islamabad","rozeePermaLink":"valid-job-islamabad-jobs-123456"}
    ]},"numFound":2}</script>`
    const page = parseSearchPage(html)
    expect(page.jobs).toHaveLength(1)
    expect(page.jobs[0].title).toBe("Valid Job")
    expect(page.malformedRecords).toBe(1)
  })
})

describe("Rozee detail parsing", () => {
  test("extracts JobPosting data and converts description markup to readable text", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"JobPosting","title":"AI/ML Intern",
       "description":"<p>Build models &amp; test them.</p><ul><li>Python</li></ul>",
       "datePosted":"2026-10-17","validThrough":"2026-10-20",
       "employmentType":["INTERN"],"identifier":{"value":"123456"},
       "hiringOrganization":{"name":"Example Co"},
       "jobLocation":{"address":{"addressLocality":"Islamabad"}}}
    </script>`
    const job = parseJobDetail(html, "https://www.rozee.pk/sample-role-islamabad-jobs-123456", "sample-role-islamabad-jobs-123456")
    expect(job).toMatchObject({
      title: "AI/ML Intern",
      company: "Example Co",
      location: "Islamabad",
      date: "2026-10-17",
      employmentType: "INTERN",
      description: "Build models & test them.\nPython",
    })
  })
})

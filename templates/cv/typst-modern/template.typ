// Typst CV — single column, ATS-friendly, LLM-friendly.
// Compile: typst compile template.typ template.pdf
// Dates use a single ASCII hyphen (2016-2024), never an en-dash.

#set document(title: "[YOUR_NAME] - CV")
#set page(paper: "a4", margin: (x: 1.55cm, y: 1.4cm))
#set text(font: "Libertinus Serif", size: 10.5pt, lang: "en")
#set par(justify: false, leading: 0.62em)
#set list(indent: 0.6em, marker: ([•], [–]))

#let accent = rgb("#1a4f8b")

#show heading.where(level: 1): it => {
  set text(fill: accent, size: 11.5pt, weight: "bold")
  block(
    width: 100%,
    stroke: (bottom: 0.7pt + accent),
    inset: (bottom: 3pt),
    above: 11pt,
    below: 6pt,
    it.body,
  )
}

#let role(dates, title, org, location, body) = {
  block(below: 7pt)[
    #text(weight: "bold")[#title] — #org
    #h(1fr)
    #text(size: 9.5pt, fill: luma(70))[#dates]
    #linebreak()
    #text(size: 9.5pt, style: "italic")[#location]
    #body
  ]
}

#align(center)[
  #text(size: 22pt, weight: "bold", fill: accent)[[YOUR_NAME]]
  #v(3pt)
  #text(size: 9.5pt)[[YOUR_EMAIL] · [YOUR_PHONE] · [YOUR_CITY], [YOUR_COUNTRY]]
  #v(2pt)
  #text(size: 9.5pt)[#link("[YOUR_LINKEDIN_URL]")[LinkedIn] · #link("[YOUR_GITHUB_URL]")[GitHub]]
]

= Profile

[PROFILE_STATEMENT]

= Core Competencies

- *[Skill Category 1]:* [Specific skills, frameworks, tools.]
- *[Skill Category 2]:* [Specific skills, frameworks, tools.]
- *[Skill Category 3]:* [Specific skills, frameworks, tools.]
- *[Skill Category 4]:* [Domain expertise, methods, approaches.]
- *[Skill Category 5]:* [Tools and software.]

= Professional Experience

#role(
  "[START]-[END]",
  "[JOB_TITLE]",
  "[COMPANY]",
  "[LOCATION]",
)[
  - [KEY_ACHIEVEMENT_1]
  - [KEY_ACHIEVEMENT_2]
  - [KEY_ACHIEVEMENT_3]
  - [KEY_ACHIEVEMENT_4]
]

#role(
  "[START]-[END]",
  "[JOB_TITLE]",
  "[COMPANY]",
  "[LOCATION]",
)[
  - [KEY_ACHIEVEMENT_1]
  - [KEY_ACHIEVEMENT_2]
  - [KEY_ACHIEVEMENT_3]
]

= Education

#role(
  "[YEAR_START]-[YEAR_END]",
  "[DEGREE_LEVEL] in [FIELD]",
  "[INSTITUTION]",
  "[LOCATION]",
)[
  Thesis: "[THESIS_TITLE]". Topics: [KEY_TOPICS].
]

= Languages

- *[LANGUAGE]:* [LEVEL]

= Publications and Awards

- [AUTHOR_LIST] ([YEAR]). [TITLE]. [JOURNAL].
- [AWARD_NAME] — [EVENT] ([YEAR]).

= References

Available upon request.

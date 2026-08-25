// Typst cover letter — one page, matching the typst-modern CV.
// Compile: typst compile template.typ template.pdf

#set document(title: "[YOUR_NAME] - Cover Letter")
#set page(paper: "a4", margin: (x: 1.8cm, y: 1.6cm))
#set text(font: "Libertinus Serif", size: 11pt, lang: "en")
#set par(justify: false, leading: 0.72em, spacing: 0.85em)
#set list(indent: 0.7em, marker: ([•]))

#let accent = rgb("#1a4f8b")

#align(center)[
  #text(size: 20pt, weight: "bold", fill: accent)[[YOUR_NAME]]
  #v(4pt)
  #text(size: 9.5pt)[#link("mailto:[YOUR_EMAIL]")[[YOUR_EMAIL]] · [YOUR_PHONE] · #link("[YOUR_LINKEDIN_URL]")[LinkedIn]]
]

#v(14pt)
#align(right)[#datetime.today().display("[day] [month repr:long] [year]")]

#v(10pt)
Dear [Hiring Manager / Team],

[Opening paragraph: name the role and where you found it, state your strongest connection to it in one sentence, and preview why you are a fit. Keep it to 2-3 sentences.]

[Body paragraph: your most relevant experience, framed toward the tasks in the posting. Follow with 3-5 concrete bullets:]

- *[Achievement 1]:* [concrete result with a number where possible]
- *[Achievement 2]:* [skill or project mapped to a posting requirement]
- *[Achievement 3]:* [evidence for a nice-to-have requirement]

[Connection paragraph: why this company specifically. Reference a verified specific: a product, a stated priority, a team. Never generic.]

[Personal fit paragraph: behavioral strengths and what you bring to the team, 2-3 sentences.]

I look forward to hearing from you.

#align(right)[
  Kind regards, \
  #v(6pt)
  [YOUR_NAME]
]

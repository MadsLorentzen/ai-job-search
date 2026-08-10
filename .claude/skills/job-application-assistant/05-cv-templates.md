---
framework_version: 1.3.0
---

# CV Templates and Tailoring Guide

## Template: LaTeX moderncv (Banking Style)

All CVs use the moderncv LaTeX package with the "banking" style and "blue" color scheme.

**Output file:** `cv/main_<company>_<role>.tex`
**Compile with:** **lualatex** on MiKTeX/TeX Live. pdflatex often fails on modern MiKTeX installs with `fontawesome5` font-expansion errors; lualatex handles the same sources cleanly.
**Master reference:** `cv/main_example.tex` (comprehensive CV with all competencies, experience, and achievements - use as source when building targeted CVs)

### Compile command

```bash
cd cv && lualatex -interaction=nonstopmode main_<company>_<role>.tex
```

Expected output: `Output written on main_<company>_<role>.pdf (2 pages, ...)`. Any page count other than 2 is a failure that must be fixed before presenting to the user.

## Document Structure

```latex
\documentclass[11pt,a4paper,sans]{moderncv}
\moderncvstyle{banking}
\moderncvcolor{blue}

% Force both first and last name AND section headings to render in moderncv
% blue (color1). Default banking on lualatex+MiKTeX leaves these black, which
% looks inconsistent with the rest of the blue accent scheme.
\renewcommand*{\firstnamestyle}[1]{{\fontsize{34}{36}\bfseries\upshape\color{color1}#1}}
\renewcommand*{\lastnamestyle}[1]{{\fontsize{34}{36}\bfseries\upshape\color{color1}#1}}
\renewcommand*{\sectionstyle}[1]{{\sectionfont\color{color1}#1}}

\usepackage[utf8]{inputenc}
\usepackage{hyperref}
\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=blue,
    pdftitle={彭坤杰 - CV},
    pdfpagemode=FullScreen,
}
\usepackage[scale=0.77]{geometry}
\usepackage{import}

% Personal data
\name{彭}{坤杰}
\address{湖北恩施 / 上海}{}{}
\phone[mobile]{15971778877}
\email{2512635967@qq.com}
\extrainfo{\href{https://github.com/JiemsLBJ}{GitHub}}

\begin{document}
\makecvtitle

% 1. 个人简介（1-3句，根据目标岗位定制）
% 2. 核心能力
% 3. 教育背景
% 4. 专业经验
% 5. 发表论文（如适用）
% 6. 获奖与荣誉（如适用）
% 7. 参考资料

\end{document}
```

### Color overrides

The three `\renewcommand*` lines in the preamble are required on lualatex+MiKTeX. Without them the firstname, lastname, and section headings render in black even though `\moderncvcolor{blue}` is set, which looks inconsistent with the rest of the blue accent scheme (links, bullet markers, contact icons). The override forces all three to use `color1` (moderncv's accent colour, which becomes blue under `\moderncvcolor{blue}`). Both names render bold; if you prefer the firstname in regular weight, change the firstnamestyle override from `\bfseries` to `\mdseries`. Don't drop the override - on most modern installs the defaults render visibly wrong.

### Spacing inside itemize lists (important)

**Do not place `\vspace{...}` between `\item` entries in an `itemize` list.** Even though the source looks symmetric, this pattern occasionally produces a noticeably oversized gap before a single item: the inter-item `\vspace` creates a paragraph break that interacts unpredictably with the list's internal `\itemsep`, so LaTeX renders one of the gaps wider than the rest. Remove the inter-item `\vspace` and let `itemize` use its native uniform spacing.

```latex
% WRONG - intermittently produces an oversized gap before one bullet
\begin{itemize}
\item \textbf{Foo}: ...
\vspace{1pt}
\item \textbf{Bar}: ...
\vspace{1pt}
\item \textbf{Baz}: ...
\end{itemize}

% RIGHT - uniform spacing using the list's native itemsep
\begin{itemize}
\item \textbf{Foo}: ...
\item \textbf{Bar}: ...
\item \textbf{Baz}: ...
\end{itemize}
```

Two related patterns are fine and should be kept:
- `\vspace{1pt}` immediately after `\section{...}` (between section heading and first item) - this is between the heading and the list, not between list items.
- `\vspace{3pt}` between top-level `\cventry` blocks in Professional Experience or Education - this gives breathing room between roles and renders consistently.

### Section headings must match the CV's language (important)

Section headings such as `\section{Core Competencies}`, `Professional Experience`, `Education`, `Languages`, `Publications`, `Honors and Awards`, `References` (and any others your template defines), plus the `Available upon request.` line under References, are all **literal English text baked into the template** - they do not translate themselves. When the CV language is 中文, use: `核心能力`, `专业经验`, `教育背景`, `语言能力`, `发表论文`, `获奖与荣誉`, `参考资料`, `如需更多参考资料，可随时提供。`

## Section-by-Section Tailoring

### Profile Statement / Elevator Pitch (Best Practice)
This is the most important section to customize. It appears right after `\makecvtitle`.

Write 5-7 lines that function as an "elevator pitch": a concise, compelling introduction explaining why you're qualified for *this specific role*. Focus on what the employer gains from hiring you.

**Create 2-3 profile statement templates for your main role types:**

**For 数据分析 / 研究助理 实习岗位:**
> 上海财经大学数字经济专业硕士研究生（拟入学），具备扎实的经济学理论功底与Python数据分析能力。本科期间GPA 3.89排名1/125，获国家奖学金及全国大学生数学建模竞赛国家级二等奖。独立搭建A股量化多因子策略回测系统，熟悉数据处理→特征工程→模型评估全流程。发表经济类论文3篇，具备规范化研究写作与图表说明能力。可立即投入实习，接受上海/北京/深圳线下或远程协作。

**For 行业研究 / 金融分析 实习岗位:**
> 经济学与数据科学交叉背景，熟悉金融数据终端（iFind/Wind/Choice）与公司基本面分析框架。具备财务报表整理、行业数据跟踪和点评底稿撰写经验，在财务部助理实习中负责日常收入核定和经营数据口径核对。擅长使用Python进行金融数据获取与量化分析，能够独立完成从数据清洗到可视化报告的全流程。研究撰写能力强，以第一作者发表3篇经济类论文。

**For 金融科技 / 量化研究 实习岗位:**
> 上海财经大学数字经济专硕拟入学，第二学士学位为数据科学与大数据技术。独立搭建基于LightGBM的A股多因子量化回测系统，完成19个因子（动量、波动率、均线、量价等）的构造与评估。熟练使用pandas/numpy/scikit-learn/matplotlib进行数据分析与建模，具备机器学习（回归/分类/集成学习）的实践基础。注重方法论严谨性——项目中能基于数据结果如实复盘而非夸大表现。

### Core Competencies / Skills Section (Best Practice)
Reorder and emphasize based on the role. Use bold category labels.

List **5-7 key competencies** in bullet format, tailored to the specific job. For each competency, briefly explain how it adds value to the position.

Use the posting's own core term in the matching bullet's bold label when it truthfully applies - ATS and skim-reading hiring managers match literally, and "MLOps" in a heading outperforms a paraphrase like "ML Deployment".

### Education
- Always include your highest degrees
- For senior roles, keep education brief (dates and titles only)
- Include thesis topics when relevant to the target role

#### In-progress qualifications must say so explicitly

**A bare year range is not enough.** An entry reading `2025–2026`, seen partway through 2026, looks like a *finished* degree, because a reader skimming a CV treats a closed range as closed. A profile statement that says "currently completing…" does not fix it: the education entry is where a reader checks the credential, so it has to stand on its own.

State completion inside the entry itself:

```latex
\item{\cventry{2026--2028}{数字经济专业硕士}{上海财经大学}{上海}{}{\vspace{1pt}
拟入学，预计2028年6月毕业。方向：数字经济、金融科技、产业与公司研究。
}}
```

Any consistent form works: `In progress, expected <Month Year>.` / `Expected completion <Month Year>.` / a date field of `2025–present`.

The same applies to in-progress certifications and courses.

### Professional Experience
- Rewrite bullet points to emphasize aspects most relevant to the target role
- Use 4-6 bullets for most recent role, 3-4 for previous, 2-3 for older
- **Emphasize measurable results** where possible: "GPA排名1/125", "获国家级二等奖"

#### Check tenure against visible output

Before finalizing, look at each role the way a stranger will: **date span versus how much work is shown.** A two-year role represented by a single project reads as low output.

Three honest fixes, in order of preference:
1. **Surface more real work.** Ask what else the period contained.
2. **Make the phases within the role explicit.**
3. **Name what made the cycle long.**

**Never** pad with invented projects, and **never** quietly shorten the employment dates.

### Handling Employment Gaps (Best Practice)
彭坤杰目前处于本科毕业至研究生入学之间的过渡期（2025年6月本科毕业，2026年9月硕士入学），期间：
- 修读中国农业大学数据科学第二学士学位（2025.09–2026.05）
- 自学量化金融与机器学习，独立搭建A股多因子回测系统
- 完成多项机器学习建模练习项目
- 这段gap应被描述为有目的的技能建设和职业定位期

### Publications
- Select 3-4 most relevant publications (not always all of them)
- For non-academic roles, keep brief

### Evidence Links
Wherever the CV names a verifiable artifact - a public project, a hackathon entry, a publication - carry its link (`\href`) so a reader can verify the claim in one click.

### Honors and Awards
- Keep format brief, one line each

### References
- List 2-4 references with name, title, company, and contact
- End with: "如需更多参考资料，可随时提供。"
- **Do not attach reference letters** - employers typically contact references directly

## Compile-and-Inspect Loop (MANDATORY)

After writing the CV and before presenting to the user, always compile and visually inspect the PDF. Iterate until the layout is clean. Workflow:

1. Run `lualatex -interaction=nonstopmode main_<company>_<role>.tex`
2. Check the output page count: must be exactly 2
3. Read the PDF via the Read tool and visually inspect both pages
4. Check for **orphaned entries**: a `\cventry` title line must never sit alone at the bottom of page 1 with its bullets on page 2

### Fixing common page-break problems

**Problem: entry title on page 1, bullets orphaned to page 2**
Add `\needspace{5\baselineskip}` immediately before the problematic `\cventry`:
```latex
\needspace{5\baselineskip}
\item{\cventry{YEAR--YEAR}{Role Title}{Organization}{Location}{}{...}}
```
Include `\usepackage{needspace}` in the preamble.

**Caveat - use `\needspace` before entries, never before `\section` headings.**

**Problem: one trailing section spills to page 3**
Add `\enlargethispage{2-3\baselineskip}` before a late section.

**Problem: 3 pages with significant content on page 3**
Cut content — do not compress geometry or `\vspace`.

**Problem: content finishes early on page 2 (feels thin)**
Restore the highest-relevance item that was previously cut.

## ATS Parseability

Most employers run CVs through an ATS before a human sees them, and the ATS reads the PDF's embedded **text layer**, not the rendered page.

```bash
cd cv && pdftotext -layout main_<company>_<role>.pdf main_<company>_<role>.txt
```

What to check in the extraction:
- **Contact details as literal text.**
- **No garbled output.** `(cid:NNN)` markers or `�` characters.
- **Reading order.** The stock banking style is single-column, so extraction order matches visual order.
- **Keyword coverage.** Match the posting's required/preferred terms against the extracted text.

## Page Budget - Hard 2-Page Limit

The CV **must** fit on exactly 2 pages when compiled.

| Section | Max budget |
|---------|-----------|
| Profile statement | 3-4 lines |
| Skills | 5 items, each 1-2 lines |
| Most recent role | 4-5 bullets |
| Previous role | 2-3 bullets |
| Older roles | 2 bullets (1 line each) |
| Education | 2-3 entries |
| Publications | 2-3 entries |
| Awards | 3 entries, single line each |
| References | "如需更多参考资料，可随时提供。" (single line) |

## Relevance-weighted cutting (the right way to shrink a CV)

**Cut by signal, not by section.** For every candidate line, score three things:
1. **Relevance to THIS posting**
2. **Uniqueness** — is it the only place this claim appears?
3. **Narrative load** — does the cover letter depend on it?

Cut the lowest-total-score line first, regardless of which section it sits in.

## Recommended Section Order

**For 数据分析 / 量化研究 / 技术类实习岗位:**
1. 个人简介
2. 核心能力
3. 项目经验（如量化回测系统、ML建模练习）
4. 教育背景
5. 专业经验
6. 发表论文 & 获奖与荣誉
7. 参考资料

**For 行业研究 / 经济分析 / 研究助理岗位:**
1. 个人简介
2. 核心能力
3. 教育背景
4. 科研与写作经历
5. 专业经验
6. 获奖与荣誉
7. 参考资料

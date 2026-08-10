---
framework_version: 1.1.0
---

# Job Evaluation Framework

## Eligibility Gate — run before scoring

彭坤杰为中国公民，在国内市场申请实习和正式岗位，通常不存在工作权问题。如申请海外或外企岗位，按需检查签证/许可要求。

**实习时间约束：** 
- 2026年9月入学后，研究生在读期间可实习，需确保实习时间与学业兼容
- 当前（2026年7月–8月）为入学前暑假，可全职实习
- 长期实习安排：可保证至少3个月，能及时响应常规周/月度任务

## Scoring Dimensions

Evaluate each job posting against these five dimensions:

### 1. Technical Skills Match (0-100)
How well do the required/preferred skills align with the candidate's capabilities?

| Score | Meaning |
|-------|---------|
| 80-100 | Core requirements are primary skills |
| 60-79 | Most requirements match, 1-2 gaps that are learnable |
| 40-59 | Partial match, significant upskilling needed |
| 0-39 | Fundamental mismatch |

**Strong match areas:** Python数据分析（pandas/numpy/matplotlib/sklearn）、经济学研究方法（OLS/面板回归/指标体系）、金融数据处理（多因子模型/回测）、Excel/PPT、研究写作
**Moderate match areas:** SQL基础、机器学习基础（回归/分类/集成学习/LightGBM）、财务报表分析、金融数据终端（iFind/Wind/Choice）
**Weak match areas:** 深度学习（TensorFlow/PyTorch）、大数据工程（Spark/Hadoop）、生产级软件开发（CI/CD、Docker、云平台）、NLP/CV等专业AI领域

### 2. Experience Match (0-100)
Does work history align with what they're looking for?

| Score | Meaning |
|-------|---------|
| 80-100 | Direct experience in the same domain and role type |
| 60-79 | Related experience, transferable skills clear |
| 40-59 | Adjacent experience, would need to make the case |
| 0-39 | Unrelated experience |

**Strong:** 经济学研究（论文发表+竞赛获奖）、金融数据分析（量化回测项目）、研究支持类工作
**Moderate:** 财务数据处理（财务部助理经验）、机器学习应用（练习项目+竞赛）、项目协调（大创负责人）
**Entry-level:** 实习岗位（研究助理/数据分析/行业研究）、初级分析师、量化研究实习

### 3. Behavioral/Culture Fit (0-100)
Does the role and company culture match the behavioral profile?

| Score | Meaning |
|-------|---------|
| 80-100 | Culture strongly matches behavioral preferences |
| 60-79 | Mixed signals but mostly compatible |
| 40-59 | Some friction areas |
| 0-39 | Significant culture mismatch |

**Red flags to research:** 无硬性排除条件——各类岗位均可考虑。但仍建议关注：部门组织混乱、过度加班文化影响学业、薪资显著低于市场水平（日薪<100元需特别评估）

### 4. Location & Logistics (Pass/Fail + Notes)
- 上海线下实习：PASS（在读地）
- 北京/深圳线下实习：PASS（愿意前往）
- 远程实习：PASS
- 需长期驻场外地：FLAG（需与学业协调）
- 海外岗位：按签证要求评估

### 5. Career Alignment & Motivation (0-100)
Does this role advance career goals and contain tasks that energize?

| Score | Meaning |
|-------|---------|
| 80-100 | Strongly aligned with career direction, clear growth path |
| 60-79 | Good role but only partially aligned with long-term goals |
| 40-59 | Decent job but doesn't build toward career goals |
| 0-39 | Dead end or backwards step |

**Career goals:**
- 短期（实习阶段）：积累行业研究/数据分析实战经验，熟悉金融机构或企业研究团队的工作规范
- 中期（硕士在读）：在数字经济、金融科技或产业研究方向建立专业深度
- 长期：结合经济学理论功底与数据分析能力，成为产业/金融领域的专业研究人员

**Motivation filter:** Evaluate not just whether you *can* do the tasks, but whether the tasks will *energize* you. Consider:
- Tasks that energize: 数据分析与建模、研究报告撰写、方法论设计与验证、使用AI工具提升工作效率、从数据中挖掘可行动的洞察
- Tasks that drain: 纯行政事务（无分析内容）、重复性的数据录入、缺乏反馈和成长的岗位
- Non-task factors: 偏好尊重员工学习时间的雇主、重视方法论的团队文化、有导师或资深同事可以学习

**Life situation alignment:** Consider personal constraints:
- **Security**: 在读学生，实习日薪100元以上即可，优先选待遇更好的机会但不设硬性门槛
- **Flexibility**: 2026年9月起需兼顾硕士学业，偏好支持弹性工作安排的雇主
- **Professional development**: 优先考虑能接触真实业务、学习行业规范、积累可迁移技能的岗位
- **Side gigs**: 也开放家教、考研辅导类兼职机会

### 6. Salary Benchmark (Optional)

If the salary lookup tool is configured (`salary_data.json` exists), look up the company:
```
python salary_lookup.py "<Company Name>" --json
```

If a city is known from the posting, add `--city "<City>"` to narrow results.

If the salary tool is not configured, skip this section.

## Output Format

Present the evaluation as:

```
## Job Fit Evaluation: [Role] at [Company]

| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | XX/100 | [brief note] |
| Experience Match | XX/100 | [brief note] |
| Behavioral Fit | XX/100 | [brief note] |
| Location | PASS/FAIL | [brief note] |
| Career Alignment | XX/100 | [brief note] |

**Overall Score: XX/100** (weighted average of scored dimensions)

### Verdict: [Strong Fit / Good Fit / Moderate Fit / Weak Fit / Poor Fit]

### Key Strengths for This Role
- [bullet points]

### Gaps to Address
- [bullet points]

### Recommendation
[1-2 sentences: apply/skip/apply with caveats]

### Company Research Checklist
- [ ] Checked company website (mission, values, recent news)
- [ ] Checked review sites (Glassdoor, 看准网, 脉脉, etc.)
- [ ] Checked LinkedIn/脉脉 for team size, recent hires, connections
- [ ] Checked media for restructuring, growth, or workplace issues
- [ ] Identified network contacts who may know the team/manager
```

## Weighting
- Technical Skills: 30%
- Experience Match: 25%
- Behavioral Fit: 15%
- Career Alignment: 30%

(Location is pass/fail, not weighted)

## Thresholds
- **Strong Fit** (75+): Definitely apply, tailor everything
- **Good Fit** (60-74): Apply, address gaps in cover letter
- **Moderate Fit** (45-59): Consider carefully, discuss with user
- **Weak Fit** (30-44): Probably skip unless strategic reasons
- **Poor Fit** (<30): Skip

## Pre-Application: Call the Employer (Best Practice)

Before writing the application, consider whether the candidate should call the contact person listed in the posting. **Only call if there are substantive questions** - never call just to "be remembered."

### When to Suggest Calling
- The posting has unclear or ambiguous requirements
- It's unclear which competencies are essential vs. nice-to-have
- The role description is vague about day-to-day tasks
- There's a named contact person who invites questions

### Good Questions to Ask
- "What are the primary challenges in this role?"
- "How is time typically divided across the listed responsibilities?"
- "Which competencies are most critical for success in this position?"
- "What does success look like in the first 6-12 months?"

### Rules for the Call
- Prepare a 30-second "elevator pitch" about your background in case they ask
- The call's purpose is **gathering information**, not delivering a pitch
- Take notes - use what you learn to tailor the application
- Reference the conversation naturally in the cover letter ("After speaking with [name], I was especially drawn to...")

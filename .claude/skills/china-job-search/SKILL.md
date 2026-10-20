---
name: china-job-search
description: 国内社招求职助手，适用于找工作、岗位匹配、中文简历、BOSS直聘或猎聘沟通、薪资区间比较和面试准备。使用公开岗位页面或用户提供的完整JD。
---

# 国内社招

先读 [国内社招规则](../job-application-assistant/10-china-market.md)。候选人的事实来源与上游相同，中文简历模板不包含个人履历。

- 建档：执行 `.claude/commands/setup.md`，国内条件见第10章。
- 搜索：执行 `.claude/skills/job-scraper/SKILL.md` 的国内路径。目标岗位和城市未知时先确认；运行 `python3 tools/china_jobs.py search-plan --role '<目标岗位>' --city '<城市>'`，使用输出的查询调用 WebSearch，再验证完整正文。
- 登录后 JD：用户将正文保存为 `documents/postings/inbox.txt`，运行下面的导入工具；默认只预览，`--write` 才保存。不得从摘要补写不存在的职责。
- 申请材料：执行 `.claude/commands/apply-cn.md`。
- 排序：执行 `.claude/commands/rank.md`，带 `posting_file` 的候选先用 `show` 读取本地正文。薪资未知不填0，缺少职位正文不打分。
- 薪资：`python3 tools/china_jobs.py salary '20-30K·13薪'`。这里只拆解报价，不提供市场均价和税后计算。
- 面试：按第10章及 `.claude/commands/interview.md` 准备真实项目、岗位问题和沟通素材。

```bash
python3 tools/china_jobs.py import --file documents/postings/inbox.txt --company '<公司>' --title '<岗位>' --location '<城市>' --url '<岗位链接>' --salary '20-30K·13薪'
python3 tools/china_jobs.py import --file documents/postings/inbox.txt --company '<公司>' --title '<岗位>' --location '<城市>' --url '<岗位链接>' --salary '20-30K·13薪' --write
python3 tools/china_jobs.py show '<导入输出的key>'
```

候选人未建档仍可整理 JD 和生成搜索计划；评分、简历和沟通中的个人事实必须等待本人提供。

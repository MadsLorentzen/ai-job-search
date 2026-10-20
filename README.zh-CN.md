# AI Job Search：国内社招版

本 fork 默认服务中国大陆社招：寻找岗位、整理 JD、匹配分析、中文简历、平台沟通和面试准备。基于上游 Claude Code 工作流，保留国际模式。源码许可证为 MIT。

## 开始使用

```bash
cd ~/project/personal/ai-job-search
source .venv/bin/activate
claude
```

当前本地已创建 Python 3.12 虚拟环境并安装依赖。重新克隆时，先使用 Python 3.10+ 创建 `.venv`（例如 `python3.12 -m venv .venv`），激活后运行 `python -m pip install -r requirements-china.txt`。macOS 系统自带的 Python 3.9 不满足要求。Windows 使用 `.venv\Scripts\activate` 激活。

先输入 `/setup`，导入简历或通过访谈填写真实经历、目标岗位、城市、职级与到岗时间。之后可以说：

- 「帮我找杭州的 Java 后端社招岗位，优先直签」
- 「分析这个完整 JD，列出匹配点和需要问 HR 的问题」
- `/apply-cn <岗位URL或粘贴完整JD>`
- 「按这份岗位和我的真实经历，准备二面项目追问」

岗位和城市只是示例，没有预先填写你的履历。Codex 可从 `AGENTS.md` 读取同一套规则；不支持 Claude slash command 的宿主用自然语言请求，并按对应 `.claude/commands/*.md` 执行。

## 本版的具体改动

| 场景 | 国内社招默认行为 |
|---|---|
| 语言 | 简体中文，技术词保留通用英文 |
| 招聘渠道 | 企业官网、BOSS直聘、猎聘、智联、前程无忧；公开搜索及人工导入 |
| 筛选 | 城市/职级/经验/学历/薪酬/用工形式/到岗时间，未知标待确认 |
| 简历 | 中文单栏A4，通常1-2页，HTML生成，无需LaTeX |
| 沟通 | 平台招呼、自我介绍、向HR确认的问题，正式求职信按需 |
| 薪资 | 人民币税前、月薪/年薪/发薪月数拆分；不把股权奖金当保证现金 |
| 面试 | 真实项目、个人贡献、业务结果、离职动机、薪资与到岗沟通 |

没有国内平台的自动登录、私有 API 或自动投递实现。搜索摘要只作为线索，不能直接评分。遇到登录/验证码页，使用公开企业官网或粘贴 JD；不需要提供账号密码或 cookie。

## 无需模型也能用的工具

Python 3.10+；国内工具使用标准库，不要求安装 Bun：

```bash
python3 tools/china_jobs.py search-plan --role 'Java后端开发' --city '杭州'
python3 tools/china_jobs.py salary '20-30K·13薪'
```

第一条仅生成可供搜索工具使用的查询。第二条计算标注区间的名义税前年薪26万-39万元；是否保证13薪需与招聘方确认。未标注发薪月数时不自动推断年薪。

把完整 JD 保存为 `documents/postings/inbox.txt`，可先预览，再写入原有岗位队列：

```bash
python3 tools/china_jobs.py import --file documents/postings/inbox.txt --company '示例公司' --title 'Java后端开发' --location '杭州'
# 检查清洗结果和告警后，重复上面的命令并添加 --write 保存。
python3 tools/rank_state.py candidates --limit 10
```

渲染模板先安装字体裁剪依赖（`fonttools`），内嵌思源黑体子集以保证中文提取。示例里是占位符，不能直接投递：

```bash
python3 -m pip install -r requirements-china.txt
python3 tools/render_china_resume.py templates/china-resume/example.json --out cv/main_china_preview.html
```

浏览器打开 HTML，选择 A4、缩放100%、关闭页眉页脚，打印为 PDF。最终申请仍要检查 PDF 页数、文字可提取性和逐页视觉效果，步骤见 [.claude/commands/apply-cn.md](.claude/commands/apply-cn.md)。国际模式保留原 Bun 与 LaTeX 安装方式，见 [SETUP.md](SETUP.md)。

## 本地资料与同步

`documents/`、生成简历和 tracker 已由 gitignore 排除，但 `/setup` 会更新 **已经跟踪** 的档案文件。公开 fork 不适合推送个人资料。代码改动可以提交，个人档案只留本地或另建私有仓库。工具不会自动发消息、投递、提交或推送。

## 验证

```bash
python3 -m pip install pyyaml openpyxl -r requirements-china.txt
python3 -m unittest discover -s tests -t .
python3 tools/lint_skills.py
python3 tools/security_guards.py
```

规则的唯一来源是 [.claude/skills/job-application-assistant/10-china-market.md](.claude/skills/job-application-assistant/10-china-market.md)；国内专用工作流为 `/apply-cn`，上游 `/apply` 在国内模式转入它，用户明确海外岗位时保留原流程。

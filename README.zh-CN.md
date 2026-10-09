<p align="center">
  <a href="README.zh-CN.md">简体中文</a> | <a href="README.md">English</a> | <a href="https://github.com/MadsLorentzen/ai-job-search/releases">版本发布</a> | <a href="https://github.com/MadsLorentzen/ai-job-search/issues">问题反馈</a>
</p>

<p align="center">
  <img src="assets/mascot/pip_flight_loop.gif" alt="Pip，信使鸟" width="200">
</p>

# AI Job Search

*在你的电脑上运行的求职工作流。*

<p align="center">
  <a href="https://trendshift.io/repositories/43622?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-43622" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/43622/daily" alt="MadsLorentzen%2Fai-job-search | Trendshift" width="250" height="55"/></a>
</p>

[![CI](https://github.com/MadsLorentzen/ai-job-search/actions/workflows/ci.yml/badge.svg)](https://github.com/MadsLorentzen/ai-job-search/actions/workflows/ci.yml)

这是一个基于 [Claude Code](https://claude.com/claude-code) 的 AI 求职申请框架。Fork 本项目、填写你的个人资料，然后让 Claude 评估职位、定制简历、撰写求职信并准备面试。

> 注意：这是一个独立的开源项目，与 Anthropic 没有任何关联，也未获其认可、赞助或维护。文中提到 Anthropic 和 Claude Code 仅用于说明本工作流所使用的工具链。
>
> 本项目没有任何关联的加密货币、代币或付费赞助计划。任何声称代表本项目提供此类服务的内容都未经授权，应视为诈骗。支持项目的唯一方式是通过下方的 Ko-fi 链接或在 GitHub 上贡献代码。

## 它真的有效吗？

我接受的是地球物理学训练。2025 年底职位被取消后，我搭建了这个框架来进行自己的求职，每周使用本仓库里的 `/scrape`、`/apply` 和 `/interview` 工作流。我向每一位交流过的雇主坦诚说明了这一点，这通常没有成为扣分项，反而引发了真诚的技术讨论。

完成 69 份定制申请、20 次首轮面试并签下合同后，我于 2026 年 6 月开始担任 AI 工程师。很多人问这个方法是否真的有效。它帮助我找到了工作，现在也交给你。

*完整版本（包括整个申请漏斗）请见 [LinkedIn](https://www.linkedin.com/in/mads-lorentzen/)。*

<p align="center">
  <i>它是否让你省下了一个周日写求职信的时间？请我喝杯咖啡。<br>
  它是否帮你拿到了工作？那就请两杯。</i> ☕
</p>

<p align="center">
  <a href="https://ko-fi.com/madslorentzen">
    <img src="https://storage.ko-fi.com/cdn/kofi3.png?v=6" alt="在 ko-fi.com 请我喝咖啡" height="40">
  </a>
</p>

## 项目是什么

这是一个结构化工作流，将 Claude Code 变成全流程求职助手。核心流程（个人画像、匹配度评估以及起草者-审阅者申请流程）**与语言和国家无关**。目前提供的职位门户搜索技能面向丹麦市场（Jobindex、Jobnet、Akademikernes Jobbank 等），但你可以按同样的模式替换为本地招聘网站。

国内平台接入、人工导入、面向小白的本地 Web 控制台和后续路线见：[国内招聘平台支持落地整改计划](docs/domestic-platform-integration-plan.md)、[开发计划与进度台账](docs/domestic-platform-development-plan.md)、[易用性与输入简化落地方案](docs/usability-productization-plan.md) 和 [后续开发路线图](docs/next-development-roadmap.md)。

本地 Web 控制台正在开发中。开发阶段可在项目根目录运行 `python webapp/server.py`，或双击 `webapp/start_web.bat` 体验首页骨架；当前版本只读，不执行搜索、授权、投递或简历写入。

```
/setup          /scrape              /apply <url>
  |                |                     |
  v                v                     v
填写个人资料    搜索招聘门户        评估匹配度
  |                |                打分并给出建议
  v                v                     v
资料文件就绪    展示匹配职位        起草简历和求职信
                及匹配评分          （LaTeX，针对职位定制）
                   |                     |
                   v                     v
               选择职位             审阅代理进行批评
               -> /apply             -> 修改 -> 最终输出
```

框架融入了职业指导的最佳实践，包括结构化评估标准、面向未来的求职信表达方式，以及可选的薪资基准分析。

## 前置条件

- [Claude Code](https://claude.com/claude-code)（CLI）。如果你使用其他代理工具（Codex、Antigravity、Gemini CLI），请从 [`AGENTS.md`](AGENTS.md) 开始；职位门户搜索技能可以直接使用，[社区 Fork](https://github.com/MadsLorentzen/ai-job-search/discussions/78) 也提供了完整工作流的适配版本。
- Python 3.10+
- [Bun](https://bun.sh)（用于职位搜索 CLI 工具）
- 支持 `lualatex` 和 `xelatex` 的 LaTeX 发行版：[TeX Live](https://tug.org/texlive/)、[MacTeX](https://tug.org/mactex/)、[TinyTeX](https://yihui.org/tinytex/) 或 [MiKTeX](https://miktex.org/)。简历使用 `lualatex` 编译（现代 MiKTeX 安装中 `pdflatex` 经常会因 `fontawesome5` 字体扩展错误而失败）；求职信使用 `xelatex`，因为 `cover.cls` 需要 `fontspec`。如果使用 TinyTeX 或 BasicTeX 等精简安装，请按 [SETUP.md](SETUP.md#minimal-tex-install-tinytexbasictex) 安装额外宏包。
- 可选：安装 `pip install pypdf`，供 `/apply` 进行 ATS 可解析性检查（BSD 许可，不需要 Poppler）。Poppler 的 `pdftotext` 是备用方案（macOS：`brew install poppler`；Debian/Ubuntu：`apt install poppler-utils`；Windows：`choco install poppler`）。两者都没有时，检查会降级为视觉关键词审阅。

## 快速开始

> 🎥 **想先看看实际效果？** [The Next New Thing 的实践演示](https://www.youtube.com/watch?v=HoVxjMNFYv4) 展示了从设置到完成一次申请的完整流程（录制于 2026 年 8 月，命令之后可能已有变化）。

### 1. Fork 并克隆

```bash
gh repo fork MadsLorentzen/ai-job-search --clone
cd ai-job-search
```

> [!IMPORTANT]
> **本仓库的 Fork 始终是公开的**——GitHub 不允许将公开仓库私有 Fork——并且下面第 3 步的 `/setup` 会把你的个人数据（姓名、联系方式、工作经历、薪资期望）写入**受 Git 跟踪的文件**。
> 如果这份副本用于你自己的求职，而不是向上游贡献，请使用一个以本仓库为 `upstream` 的**私有仓库**；两分钟的操作步骤见 [SETUP.md 第 8 节](SETUP.md#8-pulling-upstream-updates-into-your-fork)。所有更新工作流都完全相同。只有在准备贡献时才使用 Fork。

### 2. 安装职位搜索工具

PowerShell：

```powershell
$tools = @("jobbank-search", "jobdanmark-search", "jobindex-search", "jobnet-search", "linkedin-search", "freehire-search")
foreach ($tool in $tools) {
  Push-Location ".agents/skills/$tool/cli"
  bun install
  Pop-Location
}
```

Bash / zsh / Git Bash：

```bash
for tool in jobbank-search jobdanmark-search jobindex-search jobnet-search linkedin-search freehire-search; do
  (cd .agents/skills/$tool/cli && bun install)
done
```

`linkedin-search` 和 `freehire-search` 没有运行时依赖，直接使用 `bun` 即可；执行 `bun install` 只是安装 TypeScript 开发类型，因此是可选的。

### 3. 设置个人资料

```bash
claude
# 然后在 Claude Code 中执行：
/setup
```

`/setup` 提供三种方式：读取已经填入内容的 `documents/` 文件夹（简历 PDF、LinkedIn 导出、学位证书、推荐信、过往申请记录），粘贴一份简历，或通过问答完成设置。它会自动检测现有材料并询问你。文件夹模式支持幂等重复运行，添加新材料后可安全再次执行；目录布局见 `documents/README.md`。

### 4. 搜索职位

```bash
/scrape
```

该命令会搜索多个职位门户，筛选符合你资料的职位，去重后按匹配度排序展示。选择职位即可直接运行 `/apply`；如果一次抓取的职位太多，不想逐个查看，可以先运行 `/rank`，批量评分并生成排序后的短名单。

### 5. 申请职位

```bash
/apply https://jobindex.dk/job/1234567
```

如果无法抓取 URL（部分职位门户会阻止自动访问），也可以直接粘贴完整职位描述：

```bash
/apply <在此粘贴完整职位描述>
```

该命令会运行完整流程：评估匹配度、起草简历和求职信、由第二个代理审阅、根据反馈修改并展示最终结果。

职位描述会被视为不受信任的输入（工作流不会执行其中的指令，也不会抓取其正文中的链接），但代理防护属于指令层面而非沙箱。在陌生招聘网站上点击发送前，请先检查抓取和写入的内容。详情见 [SECURITY.md](SECURITY.md)。

## 其他命令

`/setup`、`/scrape` 和 `/apply` 是核心流程。完成个人资料后，还可以使用以下命令：

- **`/interview`**：为已跟踪申请的面试准备针对阶段的资料包。它会读取申请归档（确切的职位描述、面试官实际看到的简历和求职信、前几轮记录的反馈），按“先验证再使用”规则研究公司和面试官，将可能的问题映射到你的 STAR 案例，并按 `07-interview-prep.md` 中的角色扮演协议提供模拟面试。遇到空白时只给出诚实的衔接回答，不编造经历。
- **`/outcome`**：记录申请结果，包括面试阶段、Offer、拒信和无回应；将提交过的简历、求职信和职位文本归档到 `documents/applications/<company>_<role>/`，以 `/setup` Path A 能解析的格式维护 `outcome.md`，并更新跟踪表。`/outcome followup` 还会找出长时间没有消息的申请（默认 10 天），按你的写作风格起草适合渠道的跟进信息，只使用已提交材料中的事实；仅起草、不发送，每份申请最多两次。记录面试阶段的同一轮中还可生成感谢信。若已有若干申请结果，它会引导你回到 `/setup`，用真实面试结果校准匹配框架。
- **`/notion-sync`**：通过官方 Notion MCP 服务器（OAuth，无需 API 密钥）将求职管线以单向、只读方式发布到 Notion 数据库。每个排名职位和每个跟踪申请各占一行，每行有一页只写入一次的简报。仓库文件仍是唯一事实来源，不会反向同步，文档只同步文件名。它与 `/html-report` 互补：后者是需要在电脑上重新生成的深度离线仪表盘，前者是在 Notion（桌面、网页或手机）中随时查看的轻量视图。
- **`/gmail-sync`**：通过 Gmail 连接器读取收件箱，为进行中的申请识别面试邀请、测评链接、Offer 和拒信等状态信号；在写入跟踪表或 `outcome.md` 前，先以批次形式提交给你批准，每项变更都引用来源邮件。Offer 不会直接建议 `hired`/`offer_declined`，因为那是你的决定；冲突或无法匹配的信号会标记出来，交由手动 `/outcome` 处理。
- **`/rank`**：连接 `/scrape` 与 `/apply`，批量按匹配框架为新抓取的职位评分（并行代理抓取每个职位并评估五个维度），返回带有真实优势和差距的短名单。硬性条件会否决职位，截止日期会触发紧急标记，已失效职位会标记为过期。选择编号即可交给完整的 `/apply` 流程。
- **`/expand`**：扫描个人资料中已经链接的公开来源（GitHub 仓库、作品集网站、Kaggle、Google Scholar），并查找其中列出的课程和认证的课程大纲，以补充个人资料。新增能力会带有来源标记。适合在 `/setup` 后使用，找出文档未明确体现的技能。
- **`/upskill`**：分析个人资料、已跟踪的职位以及已排名但未跟踪职位（`/rank` 记录在 `seen_jobs.json` 中的差距）之间的差距，也支持 `/upskill <URL>` 分析单个职位。它会生成按优先级排列的技能差距热图和学习计划，并附带在线搜索的学习资源与时间估算。
- **`/html-report`**：根据 `job_search_tracker.csv` 和申请归档生成自包含的 HTML 仪表盘，包括统计卡片、状态/行业/渠道/漏斗图表（内嵌 SVG，无外部依赖）以及可筛选的申请表格。`/apply` 或 `/outcome` 添加新记录后可随时重新生成。
- **`/add-template`**：注册自己的简历或求职信模板（LaTeX、Typst 或其他工具链）替代默认模板。它会记录源文件扩展名、编译命令、字体、样式规则和页数限制，执行强制测试编译，并接入 `/apply`。详见下方“自定义模板”。
- **`/add-portal`**：为本地招聘网站生成职位搜索技能。它会调查门户的搜索 URL、结果结构和访问规则，按现有技能的结构生成 CLI，进行一次实时查询测试后注册。详见下方“职位搜索工具”。

`/reset` 也可使用，详见下方“重新开始”。

## 文件结构

目录结构与英文版相同，完整说明请参阅 [README.md 的文件结构](README.md#file-structure)。核心目录包括：

```
ai-job-search/
├── CLAUDE.md                          # 主要候选人资料与工作流规则
├── .claude/                           # Claude Code 命令、技能和权限设置
├── .agents/skills/                    # 职位门户 CLI 工具
├── cv/                                # 简历 LaTeX 模板
├── cover_letters/                     # 求职信模板与字体
├── templates/                         # 通过 /add-template 注册的自定义模板
├── documents/                         # /setup 和 /expand 使用的职业资料
├── job_scraper/                       # 抓取状态（已见职位、结果）
├── gmail_sync/                        # Gmail 同步状态
├── upskill/                           # /upskill 报告输出
├── job_search_tracker.csv             # 申请跟踪表
└── SETUP.md                           # 详细设置指南
```

## `/apply` 的工作方式

`/apply` 运行一个**起草者-审阅者工作流**，并强制编译 PDF：

1. 解析职位描述（URL 或文本）。
2. 根据个人资料评估匹配度（技能、经验、文化、地点、职业方向）。
3. 使用 LaTeX 起草定制简历和求职信。
4. 启动审阅代理，研究公司并批评草稿。
5. 根据反馈修改。
6. 编译并检查两份 PDF：简历使用 lualatex，求职信使用 xelatex。Claude 会读取渲染页面并迭代 LaTeX，直到简历严格为 2 页且没有孤立的职位标题，求职信严格为 1 页、签名可见且字体一致。
7. 检查简历的 ATS 可读性：提取 PDF 文本层（`pdftotext`，可选依赖），确认联系方式是字面文本、没有乱码、阅读顺序合理，再根据提取结果评估职位关键词覆盖率。个人资料真实支持的关键词会加入，真实差距保持可见，绝不堆砌关键词。
8. 展示最终结果和验证清单。

简历和求职信中的所有内容都会根据真实个人资料核实，系统绝不捏造技能或经历。

### 这个工作流的不同之处

- **PDF 验证循环**：自动编译并视觉检查每份 PDF，针对孤立标题、求职信溢出和字体回退等问题进行修复。
- **PDF 文本层的 ATS 验证**：按 ATS 实际读取的文本检查联系方式、阅读顺序和关键词覆盖率；个人资料不支持的关键词只会作为差距说明。
- **按相关性裁剪简历**：若简历超过 2 页，系统按职位相关性、内容独特性以及求职信依赖程度给每一行评分，优先删除总分最低的内容，而不是机械地删除最早经历。
- **起草与审阅分离**：第二个 Claude 代理在全新上下文中研究公司并审阅草稿，帮助捕捉遗漏关键词、薄弱表达和泛泛措辞。
- **节省令牌的审阅调度**：审阅代理直接接收草稿，避免重复读取；验证清单只在流程末尾运行一次。

## 自定义

### 手动编辑的文件

如果不使用 `/setup` 而选择直接编辑文件：

| 文件 | 修改内容 |
|------|----------|
| `CLAUDE.md` | 完整个人资料（姓名、教育、经历、技能、目标） |
| `01-candidate-profile.md` | 结构化简历数据 |
| `02-behavioral-profile.md` | 行为评估或自我评估 |
| `04-job-evaluation.md` | 技能匹配、职业目标、动机筛选条件 |
| `05-cv-templates.md` | 不同职位类型的个人简介模板 |
| `07-interview-prep.md` | 来自真实经历的 STAR 案例 |
| `search-queries.md` | 技能和地点对应的搜索关键词 |

### 更新搜索关键词

```text
/setup --section search
```

该命令只重新运行求职搜索配置问答：目标职位、搜索技能、地点和门户，并根据个人资料建议可能未考虑过的职位类型。

### 自定义模板

默认简历使用 [moderncv](https://ctan.org/pkg/moderncv)（banking 风格），求职信使用带 Lato/Raleway 字体的 `cover.cls`。两者都是本仓库维护的 LaTeX 参考模板。

运行以下命令即可使用自己的 LaTeX、[Typst](https://typst.app/) 或其他能从命令行编译为 PDF 的工具链：

```text
/add-template
```

该命令会询问源文件扩展名、编译命令、字体位置、需要保留的样式规则和页数上限，将模板存入 `templates/`，执行强制测试编译，并激活它供 `/apply` 使用。模板以 `[PLACEHOLDER]` 代替个人数据，因此可以安全提交和共享。

- `/add-template --list`：列出已注册模板。
- `/add-template --use <name>`：切换模板。
- `/add-template --use default`：恢复默认 moderncv / cover.cls 模板。

也可以手动更新 `05-cv-templates.md` 和 `06-cover-letter-templates.md` 中的指导。

### 职位搜索工具

`.agents/skills/` 中的四个丹麦 CLI 工具（Jobbank、Jobdanmark、Jobindex、Jobnet）展示了如何为特定市场接入招聘网站。身处其他国家时，运行：

```text
/add-portal
```

提供本地招聘网站 URL 后，命令会调查搜索 URL、结果页结构、robots.txt 和访问规则，生成相同结构、命令和输出契约的 CLI 技能，并执行一次实时查询。需要登录的门户会被拒绝，条款限制严格的门户会在生成技能中显著标注“仅限个人使用”。生成的技能属于你的 Fork；生成器本身保持通用。

如果你维护适配本地市场或语言的 Fork，欢迎添加到 [社区 Fork 与适配列表](https://github.com/MadsLorentzen/ai-job-search/discussions/78)。

仓库还提供两个与国家无关的入口：`linkedin-search` 使用 LinkedIn 公开的未认证 `jobs-guest` 接口，`freehire-search` 使用 [freehire.me](https://freehire.me) 的公开 REST API。两者都零运行时依赖，支持通过地点、国家和远程标志筛选；自动访问 LinkedIn 违反其服务条款，请严格控制请求量，仅供个人使用。

### 扩展框架

框架有三个扩展点，均不需要修改上游：

1. **门户技能**：每个 `*-search` 技能都是 `.agents/skills/` 下的独立目录，遵循统一的 `search`/`detail` CLI、`--format json|table|plain` 输出、`enabled:` 标志和测试契约。`/scrape` 会自动发现符合契约的技能。
2. **文档模板**：`/add-template` 可以注册任何能从命令行编译为 PDF 的简历或求职信工具链。
3. **评估标准**：个人资料中的硬性条件和偏好是自由文本，评估规则会按你的内容打分。语言条件有专门处理：`/setup` 将语言和等级记录在 `Languages` 表中，Language Gate 会拒绝完全未声明但职位要求的语言，并对已声明但等级不足的语言发出提示而不是自动拒绝。

从其他 Fork 借用门户技能时，请先完整阅读代码，确认网络请求只发往目标招聘网站，`package.json` 没有依赖和生命周期脚本，并在离线环境运行 `bun test`。同时检查技能的 `enabled:` 标志和服务条款说明。手动复制是出于安全考虑：安装第三方技能前应由你亲自审阅。

### 薪资基准

薪资工具支持任何你提供的数据（工会统计、Glassdoor 导出、个人调研等）。格式和设置见 `tools/README_SALARY_TOOL.md`。没有薪资数据时会跳过该步骤。

### 重新开始

```text
/reset profile    # 清除技能文件，保留框架规则
/reset documents  # 删除 documents/ 文件夹中的文件
/reset all        # 两者都执行
```

`/reset` 会明确列出待删除内容，并要求输入 `RESET` 确认；确认前不会删除任何内容。

### 保持更新

上游更新频繁。建议更新到经过审核的版本发布，而不是直接拉取 `master`。`python3 tools/check_upstream_updates.py` 会预览更新将触及哪些个性化文件，`python3 tools/upstream_triage.py` 会将落后的提交分为“值得审阅”和“可能跳过”。完整流程见 [SETUP.md 第 8 节](SETUP.md#8-pulling-upstream-updates-into-your-fork)。

## 获得更好结果的建议

### 个人资料的深度很重要

输出质量最重要的因素是个人资料中的细节。资料越单薄，申请越泛泛；资料越完整，结果越贴合。

- **描述职位**：不要只列职位名称。说明实际做过的项目、使用的工具、承担的职责和可量化成果。
- **说明技能上下文**：不要只写“Python”或“项目管理”，而要说明在哪里、如何应用，例如“使用 Python 和 scikit-learn 构建客户流失预测的机器学习流水线”。
- **所有设置方式都有效**：无论是指向 `documents/` 文件夹、粘贴简历还是进行问答，原则都一样：输入越丰富，输出越精准。

### 发现职业路径

框架支持两种求职模式：

- **明确目标**：你知道想要的职位或行业，系统帮助你根据匹配度细化和排序。
- **发现潜在机会**：系统分析完整经历（不只看职位名称，也看实际工作），发现你尚未考虑的职业路径、可迁移技能和新兴交叉职位。

在 `/setup` 中不仅描述经历，也说明什么事情让你有动力、什么事情消耗你，以及希望未来增加哪些内容。这些上下文会直接影响 `/scrape` 搜索到的职位和匹配评估结果。

## 贡献

准备提交 PR？请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，其中说明哪些内容适合合并、哪些应留在 Fork 中，以及背后的原因。

## 致谢

- 感谢 [Mikkel Krogholm](https://github.com/mikkelkrogsholm) 及其 [skills repo](https://github.com/mikkelkrogsholm/skills) 提供职位搜索 CLI 技能。
- 使用 [Anthropic](https://anthropic.com) 的 [Claude Code](https://claude.com/claude-code) 构建。

## 许可证

MIT

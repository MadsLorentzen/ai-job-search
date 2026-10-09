# AI Job Search 任务型工作台 UI 设计方案

Written against: `4c38f7ce4c73448e8158d78dfbed47562690cd5c`

## Design language

- Audited surface: `webapp/` 本地 Web 控制台，重点覆盖首次资料准备、职位搜索、职位导入和 AI 匹配这条核心任务链。
- Design sources: `CLAUDE.md`；`.claude/commands/setup.md`、`.claude/commands/rank.md`、`.claude/commands/apply.md`、`.claude/commands/interview.md`、`.claude/commands/outcome.md`；`.claude/skills/job-scraper/SKILL.md`；`webapp/static/index.html`、`webapp/static/styles.css`、`webapp/static/app.js`；`webapp/server.py`。
- Documented decisions: 候选人资料与规范文件是单一事实来源；任何职位都必须先评估匹配度再进入申请；外部搜索与模型请求必须由用户主动触发；原始资料默认保存在本机；申请、面试和结果需要形成闭环。
- Governing owners and consumers: `webapp/server.py` 提供页面清单、仪表盘、安全状态和任务接口；`webapp/static/index.html` 负责页面结构；`webapp/static/app.js` 负责视图切换、异步任务和结果展示；`webapp/static/styles.css` 是当前唯一视觉系统入口。
- Explicit exceptions: “发布门禁”和底层依赖诊断属于开发/设置场景，不应作为普通求职用户的首页主内容；自动投递、平台私聊和未确认的外部写入继续排除在产品范围之外。

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 页面同时存在动态侧栏导航和“概览 / 找职位 / 匹配结果 / 我的资料”工作区标签，两套分类逻辑互相重叠；首页又把平台状态、隐私和发布门禁提升到主流程，用户难以判断下一步。 | `webapp/server.py:80-123` 定义六项页面清单；`webapp/static/index.html` 同时渲染侧栏和四个 workspace tabs；而 canonical 工作流是 setup → scrape → rank → apply → interview → outcome。 | 统一为一套任务型主导航，并按“今天 / 职位 / 申请 / 资料与材料 / 设置”重组。平台状态、隐私、发布门禁移入设置。 | 全部 Web 页面结构与页面清单 | High |
| 2 | 概览页以宣传型 Hero 和五张快捷卡为中心，只展示“已记录 / 已匹配”两个计数，无法表达资料是否完成、搜索是否需要处理、哪些职位值得行动，以及申请闭环。 | `webapp/static/index.html` 的 Hero、quick actions 和 metric row；`webapp/server.py:193-202` 只返回职位与匹配计数；canonical 命令还包含 apply、interview、outcome。 | 将首页改为“今日行动”仪表盘：一个明确的下一步、资料完成度、待处理职位、临近截止日期和申请阶段摘要。 | 首页和 dashboard API 的展示模型 | High |
| 3 | 主要文字大量使用 9–13px，搜索、匹配、AI 状态和筛选在同一大面板连续堆叠；自定义 tab 只有 ARIA role，没有方向键行为和 `aria-controls`；外发确认依赖 `window.confirm`。 | `webapp/static/styles.css:33-49` 的字号与密集布局；`webapp/static/index.html` 的 tablist；`webapp/static/app.js:175,376,470` 的确认流程。 | 建立可读的字号/间距层级，职位页采用列表—详情结构；用原生导航或完整可访问的控件语义替代手写 tab；将外发确认改为页面内披露对话框。 | 全局样式、职位页、资料表单、确认交互 | High |

## Improve first

先处理第 1 项信息架构。导航归一后，首页、职位工作台和资料流程才能共享稳定的页面边界；如果先调整配色或单个卡片，双重导航和任务优先级问题仍会持续制造认知成本。

## Evidence chain

- Surface: `webapp/static/index.html` 的应用壳、概览、搜索、匹配和资料视图。
- Problem: 当前界面按实现模块陈列功能，没有按用户从“准备资料”到“发现职位”再到“申请跟踪”的连续任务组织信息。
- Design evidence: `CLAUDE.md` 的 Workflow for New Job Applications；`.claude/commands/` 中 setup、rank、apply、interview、outcome 的阶段顺序；`webapp/server.py` 的现有 API 与安全边界。
- Owner: `webapp/static/index.html`、`webapp/static/styles.css`、`webapp/static/app.js`，以及 `webapp/server.py` 中的 `PAGE_MANIFEST` 和 dashboard payload。
- Scope and affected surfaces: 桌面与移动端应用壳、首页、资料准备、职位搜索/导入/匹配、系统设置；为后续申请跟踪预留入口。
- Uncertainty: 本次为源码审查，没有把现有页面启动后做视觉可用性测试；实施阶段需要在真实数据、空状态、长中文职位名和窄屏设备上验证密度。

## Design decision

把现有控制台重构为“任务型求职工作台”，保留本地优先、安全确认和现有海军蓝视觉身份，但由单一主导航、明确的下一步和渐进披露来组织功能。

### 1. 信息架构

| 一级入口 | 用户问题 | 主要内容 | 数据来源 |
| --- | --- | --- | --- |
| 今天 | 我现在最应该做什么？ | 下一步行动、资料完成度、待处理职位、截止提醒、最近任务 | `/api/dashboard`、`/api/tasks/history` |
| 职位 | 有哪些职位，哪些值得继续？ | 搜索、人工导入、筛选、匹配列表、职位详情 | `/api/search/start`、`/api/import/job`、`/api/rank` |
| 申请 | 我投了哪些，进展如何？ | 申请阶段、截止日期、面试和结果 | 后续读取 `job_search_tracker.csv` 的只读 API |
| 资料与材料 | 系统如何理解我？材料是否就绪？ | 求职目标、候选人资料、简历导入、CV/求职信状态 | setup、resume、profile preview API |
| 设置 | 环境和隐私是否安全？ | 平台状态、AI 服务、本机权限、审计、发布门禁 | health、privacy、AI status、release check API |

桌面端使用固定左侧栏；移动端使用底部导航展示“今天、职位、申请、资料”四个高频入口，“设置”放到右上角菜单。移除当前额外的 workspace tab，不再维护第二套页面状态。

### 2. 核心页面蓝图

#### 今天

```text
┌ 左侧主导航 ─────┬──────────────────────────────────────────────┐
│ 今天            │ 早上好，今天继续推进 3 个事项               │
│ 职位            │                                              │
│ 申请            │ ┌ 下一步 ────────────────────────────────┐ │
│ 资料与材料      │ │ 完成候选人资料  68%     [继续完善]      │ │
│ 设置            │ └────────────────────────────────────────┘ │
│                 │                                              │
│ 本机模式 ●      │ [新职位 12] [待匹配 7] [待申请 3] [面试 1] │
│                 │                                              │
│                 │ 最近发现                 即将截止            │
│                 │ 职位摘要列表             日期 + 明确行动      │
└─────────────────┴──────────────────────────────────────────────┘
```

- 页面只保留一个主 CTA，根据状态依次指向：完成资料、搜索职位、运行匹配、查看高匹配职位或继续申请。
- Hero 从装饰性营销卡改为紧凑的行动卡，不再使用火箭、轨道等装饰图形。
- 空状态必须包含一个清晰动作，例如“开始第一次搜索”，不同时给出多个竞争按钮。

#### 职位

```text
┌ 搜索关键词 / 城市 / 平台                         [开始搜索] ┐
├ 筛选：全部  高匹配  待匹配  有风险  即将截止              ┤
├──────────────────────────┬───────────────────────────────┤
│ 78  Python 后端工程师    │ Python 后端工程师              │
│     公司 · 杭州 · 20–30K │ 78 · Strong Fit                │
│     2 个优势 · 1 个差距   │ 地点 PASS · 语言 FLAG          │
│                          │                               │
│ 65  AI 应用工程师        │ 优势 / 差距 / 原文 / 截止日期  │
│     公司 · 上海           │ [打开原职位] [开始申请准备]    │
└──────────────────────────┴───────────────────────────────┘
```

- 将“搜索”和“匹配结果”合并成一个工作区，避免任务完成后切换一级页面。
- 桌面端使用 40/60 的列表—详情分栏；移动端先显示列表，详情作为整页或底部抽屉打开，并提供明确返回。
- 分数不是唯一视觉信号：同时显示 verdict、地点门禁、语言门禁、截止日期和数据来源。
- “开始 AI 匹配”和“运行职位排名”不再并列。根据配置状态只展示一个可执行主动作，另一种路径作为说明或设置入口。
- 筛选条默认保持一行关键筛选，其余条件进入“更多筛选”；筛选结果数量即时显示。

#### 资料与材料

- 将当前长页面拆为三段式进度：`1 求职偏好` → `2 简历与候选人资料` → `3 确认并开始搜索`。
- 每一步只展示当前需要的字段；已完成步骤以摘要卡显示并可编辑。
- “一句话求职目标”继续作为首要输入，识别结果在输入下方逐项确认，避免把解析结果当成已保存结果。
- 简历文件、粘贴文本和正式资料映射分成三个清晰状态：未解析、待确认、已写入；写入 canonical 资料前展示字段级差异。

#### 设置

- 分为“搜索平台”“AI 服务”“隐私与数据”“开发诊断”四个区块。
- 普通状态只显示结论和修复动作；命令路径、绑定地址、发布门禁检查项折叠到“技术详情”。
- “本机模式”在应用壳中保留一个低干扰状态点，详细解释只在此页出现。

### 3. 视觉系统

继续复用现有颜色变量，避免建立平行主题：

- `--navy`：应用壳与品牌锚点，不用于大面积内容卡。
- `--primary` / `--primary-dark`：每个视图唯一的交互强调色。
- `--green`：完成、可用和本机安全状态。
- `--amber`：待确认、截止提醒和风险提示；不再同时承担品牌主按钮。
- `--danger`：失败、不可逆写入警告和门禁 FAIL。
- `--canvas`、`--surface`、`--line`：建立内容层级，减少不同浅色背景的临时变体。

现有 CSS 没有共享的字号和间距 token，需要在 `:root` 新增一套小而稳定的语义层：

- 正文与表单控件不低于 14px；辅助说明不低于 12px；数据与状态标签可使用 12px，但不能承担关键决策信息。
- 页面标题 28–32px，区块标题 18–20px，卡片标题 15–16px；中文正文使用 1.5–1.7 行高。
- 间距只使用 4、8、12、16、24、32、40 的基础级别，替换当前大量 7、9、11、13、15、17px 的局部值。
- 保留 8px 控件圆角、12px 卡片圆角和 16px 大容器圆角；胶囊形状仅用于短状态标签。
- 阴影只用于浮层和当前行动卡；普通面板使用边框，不通过多层阴影制造层级。
- 标题不再使用额外字距；数字指标启用 tabular numerals；长职位名使用单行截断并提供完整可访问名称。

### 4. 组件与状态

优先在现有无框架 HTML/CSS/JS 架构中建立共享类和渲染函数，不引入新的 UI 框架。

- `AppNav`：唯一的一级导航，包含当前页面、未完成数量和本机状态。
- `NextActionCard`：首页唯一主行动，接收任务状态、说明和 CTA。
- `MetricCard`：数值使用等宽数字，必须有文字标签，不能仅靠颜色。
- `JobListItem`：职位、公司、地点、薪资、分数、门禁、截止日期、状态。
- `JobDetail`：摘要、优势、差距、原文、来源和下一步；加载后把焦点移到详情标题。
- `FilterBar`：关键筛选 + 更多筛选，移动端可折叠。
- `ProgressSteps`：资料流程状态，使用有序列表而不是可点击 div。
- `InlineStatus`：加载、成功、警告、失败四种状态；错误紧邻触发动作和相关字段。
- `ConsentDialog`：替代 `window.confirm`，明确列出“将发送什么、发送到哪里、不会做什么”，确认按钮使用具体文案“同意并开始匹配”。
- `EmptyState`：一个图标、一句解释、一个主行动；去掉没有后续动作的纯提示。

### 5. 交互与可访问性

- 不新增装饰动画。现有 hover/focus 反馈控制在 120–180ms，只改变 `transform` 和 `opacity`；在 `prefers-reduced-motion` 下关闭平滑滚动和位移动效。
- 移除大面积 sticky `backdrop-filter`；固定或粘性元素使用不透明表面和轻边框。
- 若保留 tab 语义，必须实现方向键、Home/End、`aria-controls` 和面板关联；本方案优先改为普通页面导航，降低自定义键盘行为成本。
- 所有帮助文本和错误通过 `aria-describedby` 关联字段；无效字段设置 `aria-invalid`；异步容器使用 `aria-busy`，任务状态通过 `role="status"` 宣告。
- 动态插入职位详情、解析结果或确认对话框后管理焦点，关闭后恢复到触发按钮。
- 禁用按钮旁说明不可执行原因，例如“先完成候选人资料”或“先配置 AI 服务”，不能只降低透明度。
- 图标只作辅助；图标按钮必须有 `aria-label`，装饰图标使用 `aria-hidden="true"`。

### 6. 响应式规则

- `≥ 1100px`：240px 左侧导航，职位页列表—详情双栏，内容最大宽度约 1280px。
- `768–1099px`：收窄导航文字与页面边距，职位详情可覆盖右侧区域，但不改变信息顺序。
- `< 768px`：底部导航；单列内容；搜索条件分两层；职位详情整页打开；主 CTA 可在安全区上方粘底。
- `< 420px`：指标卡使用 2 列；按钮默认满宽；表单不再并排；任何关键操作不依赖横向滚动导航。

## Reuse

- 复用 `webapp/static/styles.css` 中的 `--navy`、`--primary`、`--green`、`--amber`、`--danger`、`--canvas`、`--surface`、`--line`。
- 复用现有 `.button`、`.form-field`、`.parse-result`、`.inline-warning`、`.rank-item` 的行为意图，但统一字号、间距和状态命名。
- 复用 `webapp/static/app.js` 中的 `escapeHtml`、任务轮询、搜索、导入、排名和资料 API 调用。
- Exemplar: `webapp/static/index.html` 中“一句话求职目标 → 识别结果 → 回填确认”的渐进确认模式。

需要新增 `NextActionCard`、`ConsentDialog` 和统一状态组件，因为现有系统分别使用 Hero、内联 warning、禁用按钮和浏览器原生 confirm，无法表达一致的任务优先级与数据外发披露。它们应由 `app.js` 的共享渲染函数和 `styles.css` 的共享组件类拥有，供首页、职位和资料流程复用。

## Changes

1. `webapp/static/index.html`
   - Change: 重建应用壳和五个一级页面；删除 workspace switcher；把搜索与排名合并到职位页；把 health、privacy、release 移入设置；加入首页下一步、资料进度和申请占位区。
   - Preserve: 所有现有表单字段、API 能力、显式外发确认、本地隐私说明和人工导入路径。
   - Verify: 任意状态下都只有一套一级导航和一个页面主 CTA，键盘顺序与视觉顺序一致。

2. `webapp/static/styles.css`
   - Change: 建立语义字号、间距、圆角和层级 token；实现桌面侧栏、职位双栏、移动底部导航、对话框和状态组件；移除大面积 blur 与装饰性 Hero 图形。
   - Preserve: 海军蓝应用壳、蓝色主操作、绿色安全状态和克制的卡片语言。
   - Verify: 390px、768px、1024px、1440px 宽度无横向页面滚动；正文、表单和状态信息可读；焦点清晰。

3. `webapp/static/app.js`
   - Change: 用单页面导航状态替代 workspace 映射；合并搜索和排名视图；根据 dashboard 状态生成唯一下一步；实现职位列表—详情、ConsentDialog、焦点恢复和可访问的异步状态。
   - Preserve: HTML 转义、所有现有 API 请求、任务轮询、安全确认语义和错误就近显示。
   - Verify: 搜索完成后留在职位页并刷新列表；选择职位后显示详情；取消外发不发请求；对话框可用 Escape 关闭并恢复焦点。

4. `webapp/server.py`
   - Change: 将 `PAGE_MANIFEST` 改为新的一级 IA；扩展 dashboard 摘要，提供资料完成度、待匹配数量、近期任务和可推导的 next action；将诊断状态归入设置页 payload。
   - Preserve: canonical 资料来源、loopback 绑定、默认不联网、显式 opt-in 和所有现有接口兼容性。
   - Verify: 静态页面不需要读取个人正文即可渲染摘要；旧接口仍能通过现有 contract tests。

5. `tests/test_webapp.py`
   - Change: 更新页面清单断言；新增 next action、资料完成度和设置诊断分组测试；增加静态 shell 的单导航、对话框和可访问状态契约测试。
   - Preserve: 本地安全、隐私、外发确认、输入校验和职位状态的现有测试。
   - Verify: 新旧安全测试全部通过，测试不会发起真实网络请求。

6. 后续阶段：申请与材料闭环
   - Change: 增加读取 `job_search_tracker.csv`、CV、求职信、面试包和 outcome 的只读摘要 API，再启用“申请”页的完整能力。
   - Preserve: `/apply`、`/interview`、`/outcome` 仍由 canonical 命令定义，Web 不自行改写业务规则。
   - Verify: Web 展示与 tracker/文件系统一致，任何写入都有明确确认和审计记录。

## Scope

- Inherit: 首页、职位、资料、设置页面共享新的导航、视觉 token、按钮、状态、空状态和响应式规则。
- Verify: 现有 setup、resume、import、search、rank、health、privacy、release 和 AI provider 状态的所有成功、失败、空数据和加载状态。
- Exclude: 自动投递、平台登录、招聘方私聊、申请材料正文生成逻辑、canonical Markdown 规范改写，以及本次方案中的实际产品代码实现。

## Delivery phases

1. **P0 — 信息架构与基础可访问性**
   - 单一导航、页面重组、字号/间距、移动端结构、ConsentDialog。
   - 不增加后端业务能力，优先降低改造风险。
2. **P1 — 职位工作台**
   - 搜索/导入/匹配合并，列表—详情、筛选、门禁与截止信息统一。
3. **P2 — 今日行动与申请闭环**
   - 扩展 dashboard，并为 tracker、材料、面试和 outcome 增加只读摘要。
4. **P3 — 视觉 QA 与文档固化**
   - 使用真实数据和极端内容验证；稳定后创建根目录 `DESIGN.md` 记录最终设计语言。

## Validation

- Product: 从空白状态完成求职目标和简历确认，启动一次搜索，查看一个匹配结果，再进入申请准备；每一步都能回答“当前状态、下一步、是否会外发数据”。
- Interface: 验证空列表、100 条职位、超长中文/英文标题、无薪资、语言 FLAG、地点 FAIL、临近截止、AI 未配置、任务失败和取消；覆盖 390×844、768×1024、1024×768、1440×900。
- System: 确认所有页面只使用一套导航、一个颜色 token 源和一套状态组件，没有新增平行按钮/卡片/警告模式。
- Repository: `python -m unittest tests.test_webapp` → 全部通过且不产生真实网络请求。
- Repository: `python webapp/server.py --port 8765 --no-browser`，随后请求 `/api/dashboard`、`/api/health`、`/api/rank` → 返回成功且不暴露凭证或个人正文。
- Accessibility: 使用键盘完成导航、搜索、筛选、打开详情、打开/取消确认对话框；运行浏览器 Accessibility Tree 和对比度检查，关键路径无严重问题。

## Stop conditions

- Stop if Web 产品的目标仍只是开发期诊断面板，而不是面向求职者的日常工作台；这会改变首页优先级和一级导航。
- Stop if `job_search_tracker.csv` 不是申请状态的 canonical source；在确认新的 owner 前不实施“申请”页写入或编辑能力。
- Stop if新的页面清单要求破坏现有外部调用方；先保留 API 兼容层，再切换静态 UI。
- Stop if视觉检查证明现有高密度布局是用户明确选择；重新校准字号与信息密度，不凭源码审查强行替换。

## Design documentation

- After acceptance and validation: 在项目根目录创建 `DESIGN.md`，记录已确认的任务型 IA、现有颜色角色、字号/间距 token、导航、职位卡、状态与 ConsentDialog 规则；不要记录仍在试验的页面局部值。

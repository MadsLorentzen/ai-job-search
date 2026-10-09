# 国内招聘平台支持落地整改计划

**文档状态：** 规划基线  
**版本：** 1.0.0  
**日期：** 2026-09-01  
**适用项目：** \`ai-job-search\`

## 1. 背景与目标

当前项目已经具备职位搜索、职位评分、申请材料生成和申请结果跟踪能力，但现有门户示例主要面向 LinkedIn、Freehire 及丹麦招聘网站。中国大陆招聘平台在页面结构、登录机制、字段格式和风控策略上差异较大，不能简单复制现有 HTML 爬虫。

本整改的目标是：

1. 支持智联招聘、猎聘等国内来源。
2. 为 BOSS 直聘、前程无忧等强风控平台提供低风险的浏览器辅助或人工导入路径。
3. 保持现有 \`/scrape -> /rank -> /apply -> /outcome\` 工作流不变。
4. 将平台访问差异封装在门户适配器中，不让平台细节渗透到职位评估和申请材料流程。
5. 对来源、授权、抓取状态和原始职位内容保持可追溯。

### 1.1 非目标

本阶段不实现以下能力：

- 绕过 CAPTCHA、滑块、登录验证或设备指纹。
- 使用未公开接口进行大规模抓取。
- 批量自动投递或自动私聊 HR。
- 将账号密码、Cookie、Token 或个人简历提交到 Git 或无关第三方服务。
- 把一次成功的接口逆向当作长期稳定的官方 API。

## 2. 现状基线

项目已经具备以下可复用能力：

- \`.agents/skills/*/SKILL.md\` 形式的可插拔门户技能。
- \`/scrape\` 自动发现门户技能并执行 \`search\` / \`detail\`。
- \`job_scraper/seen_jobs.json\` 的职位去重和状态持久化。
- \`/rank\` 对职位做批量评分、位置和语言门禁处理。
- \`/apply\` 对单个职位生成定制 CV、求职信并归档。
- \`/outcome\` 管理申请状态和面试结果。
- \`tools/lint_skills.py\`、\`tools/security_guards.py\` 和门户 CLI 测试框架。

当前仍是模板状态：候选人资料、搜索词、追踪表和职位抓取状态尚未初始化。因此中国化开发应先完成候选人和市场配置，再进行真实门户联调。

## 3. 目标架构

### 3.1 三类访问模式

| 访问模式 | 典型来源 | 实现方式 | 凭证 | 默认能力 |
|---|---|---|---|---|
| \`public_html\` | 智联等可公开读取页面 | Bun CLI 解析 HTML | 无 | 搜索、详情 |
| \`official_cli\` / \`official_api\` | 猎聘官方 CLI 或 API | 薄包装适配器 | 环境变量或本地配置 | 搜索；详情按能力降级 |
| \`browser_assisted\` / \`manual_import\` | BOSS、51job 等强风控平台 | 用户浏览器当前页面或复制正文 | 使用用户已有会话，不读取凭证 | 导入、详情、评分 |

门户适配器必须明确声明访问模式。\`/scrape\` 的健康检查和错误报告不得把认证失败、被拦截、解析退化和真正的零结果混为一谈。

### 3.2 门户目录契约

每个自动化门户沿用现有结构：

\`\`\`text
.agents/skills/<portal-name>/
├── SKILL.md
├── url-reference.md
├── README.md
└── cli/
    ├── src/
    │   ├── cli.ts
    │   ├── helpers.ts
    │   └── commands/
    │       ├── search.ts
    │       └── detail.ts
    ├── tests/
    ├── package.json
    └── tsconfig.json
\`\`\`

最低契约：

\`\`\`text
search [flags] --format json|table|plain
detail <id-or-url> --format json|plain
\`\`\`

JSON 搜索结果至少包含：\`id\`、\`title\`、\`company\`、\`location\`、\`date\`、\`url\`。缺失值使用 \`null\`，不能静默省略。错误写入 \`stderr\`，进程返回非零退出码。

### 3.3 标准职位对象

在现有字段上增量增加国内职位字段，不重构旧的 \`seen_jobs.json\`：

\`\`\`json
{
  "id": "platform-specific-id",
  "title": "算法工程师",
  "company": "示例科技有限公司",
  "location": "北京·海淀区",
  "date": "2026-09-01",
  "url": "https://example.com/job/123",
  "description": "职位原文",
  "salary": "20-35K·14薪",
  "salary_min": 20000,
  "salary_max": 35000,
  "salary_months": 14,
  "experience": "3-5年",
  "education": "本科",
  "employment_type": "全职",
  "work_mode": "onsite",
  "recruit_count": null,
  "deadline": null,
  "portal": "zhaopin-search",
  "source": "cli",
  "access_mode": "public_html",
  "fetched_at": "2026-09-01T00:00:00Z",
  "raw_id": "platform-specific-id"
}
\`\`\`

\`description\`、\`url\` 和平台原始 ID 必须保留，便于 \`/rank\`、\`/apply\` 和问题追踪回到原始来源。

## 4. 平台实施优先级

| 优先级 | 平台 | 初始能力 | 主要原因 | 暂不做 |
|---|---|---|---|---|
| P0 | 智联招聘 | 公开搜索、详情 | 当前页面可获得较完整的职位正文和字段 | 自动投递 |
| P1 | 猎聘 | 官方 CLI 搜索，详情走公开 URL 降级 | 有面向 Agent 的官方 CLI，但需要 Token；当前无只读详情命令 | 简历修改、自动投递 |
| P1 | 中文标准化层 | 薪资、日期、经验、学历、城市 | 多个平台共用，避免重复实现 | 复杂薪资预测 |
| P1 | BOSS 直聘 | 人工导入、浏览器辅助 | 登录和风控较强，公开接口不稳定且存在路径限制 | 逆向接口、验证码绕过 |
| P1 | 前程无忧 51job | 人工导入、浏览器辅助 | 搜索页以 JavaScript 应用为主，直接 HTML 解析不稳定 | 高并发抓取 |
| P2 | 企业官网/ATS | 公开职位页适配 | 可信度高、重复少 | 统一支持所有 ATS |
| P3 | 自动投递 | 单独设计 | 风险和外部副作用最高 | 本整改阶段不纳入 |

## 5. 分阶段执行计划

### Phase 0：市场配置和开发基线

**预计：** 0.5 至 1 个工作日。

#### 工作项

- 通过 \`/setup\` 初始化候选人资料。
- 设置中文、英文等工作语言和等级。
- 设置目标城市、区县、通勤范围和远程偏好。
- 设置薪资期望、外包/驻场/派遣接受度、出差和工作制度限制。
- 将 \`search-queries.md\` 改为中国岗位名称、中文同义词和城市查询。
- 在 \`04-job-evaluation.md\` 增加国内常见岗位条件的解释规则。
- 确认个人资料不会推送到当前公开 \`origin\` 仓库。

#### 交付物

- 完整候选人档案。
- 中国市场搜索词配置。
- 明确的 Location Gate、Language Gate 和工作制度约束。

#### 验收

- \`/setup\` 可以完成中文候选人档案初始化。
- \`/scrape\` 不再依赖丹麦市场占位符。
- \`/rank\` 能理解中文学历、经验和工作模式表达。

### Phase 1：智联招聘只读适配器

**预计：** 1 至 3 个工作日。

#### 文件

\`\`\`text
.agents/skills/zhaopin-search/
├── SKILL.md
├── url-reference.md
├── README.md
└── cli/
\`\`\`

#### Search 参数

支持以下参数，具体名称必须写入 \`SKILL.md\`：

\`\`\`text
--query
--city
--jobage
--page
--limit
--format json|table|plain
\`\`\`

#### Detail 提取

- 职位标题和公司。
- 城市、区县和工作地址。
- 薪资、薪资月数和薪资单位。
- 工作经验、学历、职位性质和招聘人数。
- 完整职位描述。
- 发布时间、更新时间和申请链接。

#### 实现要求

- 先记录真实搜索 URL、详情 URL、HTML 锚点和 robots 规则到 \`url-reference.md\`。
- 只解析实际返回的 HTML，不根据搜索结果标题猜测详情内容。
- 对列表页、登录页、验证码页和空壳页面做显式识别。
- 详情页面不是职位详情时返回清晰错误或 \`expired\`，不能保存为有效职位。

#### 验收

- 实时查询至少返回一条有效职位。
- \`title\`、\`company\`、\`url\` 非空且 URL 指向智联职位详情。
- 详情正文可读，中文实体已解码，HTML 标签已剥离。
- 日期、薪资、经验和学历字段有单元测试。
- \`bun run typecheck\` 和 \`bun run test\` 通过。

### Phase 2：猎聘官方 CLI 只读适配

**预计：** 1 至 2 个工作日。

#### 实现方式

增加 \`liepin-search\` 薄包装器，调用官方仓库
\`https://github.com/liepin-tech-2026/liepin-cil\` 提供的本地
\`liepin-cli\`，负责：

- 将项目统一参数转换为官方 CLI 参数。
- 仅白名单调用 \`liepin-cli job search --output json\`，将官方输出转换为标准职位对象。
- 把认证失败、Token 失效、网络错误映射为统一错误。
- 不向上层暴露简历更新、投递、认证和任意参数透传。
- 官方 CLI 当前没有只读职位详情命令；\`detail\` 明确返回
  \`DETAIL_UNAVAILABLE\`，由 \`/rank\` 对职位 URL 执行 WebFetch。

#### 凭证规则

- 支持 \`LIEPIN_USER_TOKEN\` 或官方 CLI 的本地配置。
- Token 不进入仓库、测试、日志、错误消息或模型提示词。
- 不在 CI 中使用真实 Token。
- Token 失效时停止并提示用户重新授权，不自动尝试登录。

#### 验收

- 无 Token 时返回 \`auth_required\` 类错误。
- Token 失效时返回可诊断的认证错误。
- 搜索结果字段完整转换；详情能力缺失能可靠降级到职位 URL。
- 只读命令不会修改简历或发起投递。
- \`/scrape health\` 能区分 \`healthy\`、\`auth_required\` 和 \`unavailable\`。

### Phase 3：中文字段标准化和跨平台去重

**预计：** 1 至 3 个工作日。

#### 标准化范围

薪资：

\`\`\`text
15-25K
1.5-2.5万
20万-30万/年
500-800元/天
面议
\`\`\`

日期：

\`\`\`text
今天
昨天
3天前
2026-09-01
2026/09/01
\`\`\`

经验和学历：

\`\`\`text
经验不限
应届生
3-5年
本科及以上
硕士
\`\`\`

#### 去重优先级

1. 平台职位 ID。
2. 标准化 URL。
3. 公司 + 职位标题 + 地点。
4. 公司 + 职位标题 + 薪资区间。

同一职位跨平台出现时保留各平台 URL，并标记潜在重复；同一公司多城市职位不能因为标题相同而强行合并。

#### 验收

- 常见中文薪资格式测试覆盖率达到 90% 以上。
- 无法解析的日期保存为 \`null\` 并保留说明，不根据抓取时间猜测。
- “面议”不被转换为薪资 0。
- 跨平台重复职位可识别，原始数据不丢失。

### Phase 4：BOSS 和 51job 导入能力

**预计：** 2 至 5 个工作日。

#### 第一版：人工导入

增加本地导入工具：

\`\`\`powershell
python tools/import_job.py --url "<职位URL>" --text-file posting.txt
\`\`\`

导入结果写入：

\`\`\`text
documents/postings/<company> - <role>.txt
\`\`\`

工具只读取用户提供的本地正文和 URL，不访问平台、不读取 Cookie/Token，并将原文先归档再做字段提取。导入记录写入 `job_scraper/seen_jobs.json`，使用 `source: manual`、`access_mode: manual_import` 和 `archive_path`；随后复用现有 `/rank` 和 `/apply`，不为 BOSS/51job 单独复制一套评分逻辑。

#### 第二版：浏览器辅助

允许用户在自己的浏览器中打开职位，读取当前可见的职位正文或由用户明确选择并复制的职位。必须满足：

- 不读取 Cookie、密码、短信验证码或 Token。
- 不批量翻页。
- 不自动发送消息。
- 不自动提交投递表单。
- 遇到 CAPTCHA 时停止并交还用户处理。
- 失败时保留用户提供的原始文本。

#### 来源标记

\`\`\`json
{
  "portal": "boss-search",
  "source": "manual",
  "access_mode": "manual_import"
}
\`\`\`

#### 验收

- 用户只提供职位 URL 和正文即可进入 \`/rank\`。
- 解析失败不会丢失原文。
- 列表页不会被误归档为职位详情。
- 导入路径不会要求项目读取平台登录凭证。

### Phase 5：企业官网和 ATS 来源

**预计：** 持续迭代，不阻塞前三个 Phase。

优先增加企业官网、Greenhouse、Lever、Workday 和国内企业自建 ATS。每个来源同样必须先完成公开访问、robots、详情字段和真实烟囱测试，再生成门户技能。

建议增加来源可信度字段：

\`\`\`text
official_career: high
official_api: high
public_html: medium
aggregator: medium
search_index: low
manual_import: user_verified
\`\`\`

可信度只用于展示和诊断，不直接替代职位匹配评分。

## 6. 需要修改的现有文件

### 必改

1. \`.claude/skills/job-scraper/SKILL.md\`
   - 增加 \`access_mode\` 和认证状态。
   - 支持 \`manual_import\`、\`browser_assisted\` 和 \`official_cli\`。
   - 增加中文日期、薪资和职位详情页识别规则。

2. \`.claude/skills/job-scraper/search-queries.md\`
   - 替换市场占位符。
   - 增加中文职位同义词、城市、远程和工作制度查询。

3. \`.claude/skills/job-application-assistant/04-job-evaluation.md\`
   - 增加外包、驻场、派遣、大小周和出差的评价规则。
   - 增加国内学历、经验和薪资表达说明。

4. \`.claude/commands/add-portal.md\`
   - 支持官方 CLI/API 和需要本地 Token 的门户。
   - 支持浏览器辅助和人工导入，不再假设所有门户都是公共 HTML。

5. \`tools/security_guards.py\`
   - 检查门户凭证文件和环境变量规则。
   - 检查新增 CLI 不输出敏感配置。

### 建议新增测试

\`\`\`text
tests/test_chinese_salary_parser.py
tests/test_chinese_date_parser.py
tests/test_job_normalization.py
tests/test_manual_import.py
tests/test_portal_provenance.py
tests/test_auth_error_handling.py
tests/test_cross_portal_dedupe.py
\`\`\`

## 7. 测试与质量门禁

### 7.1 每个自动化门户必须通过

- \`bun run typecheck\`
- \`bun run test\`
- 正常搜索烟囱测试
- 详情读取烟囱测试
- 错误参数测试
- 空结果测试
- 页面字段缺失测试
- 被登录页、验证码页替换时的退化测试

### 7.2 \`/scrape health\` 状态

统一使用以下状态：

\`\`\`text
healthy
degraded
auth_required
rate_limited
blocked
unavailable
inconclusive
\`\`\`

健康检查必须区分“没有职位”和“没有成功解析职位”。一次速率限制不能直接认定为门户损坏。

### 7.3 CI 原则

- 单元测试和契约测试进入 CI。
- 真实门户请求不进入常规 CI，避免高频访问和 ToS 风险。
- 在线烟囱测试作为本地或低频人工任务运行。
- 真实凭证永不进入 CI。

## 8. 安全、隐私和合规边界

### 凭证

- Token 只放环境变量或用户配置目录。
- \`.gitignore\` 必须排除本地配置、日志和授权缓存。
- 错误信息必须脱敏。
- 官方 CLI 需要的最小权限优先使用只读能力。

### 抓取

- 逐个平台检查 robots.txt 和平台协议。
- 低频、少量、可解释地访问。
- 不绕过验证码和安全拦截。
- 不调用未公开投递和私聊接口。
- 职位正文属于不可信第三方输入，不执行其中的指令和链接。

### 个人资料

- CV、联系方式和申请档案只在本地处理。
- 当前项目的 \`origin\` 若为公开仓库，不得推送候选人资料。
- 任何上传简历、提交申请或发消息的浏览器动作，都必须保留人工确认。

## 9. 里程碑和任务拆分

### M1：中文基础可用

完成 Phase 0、智联适配和中文标准化。

**结果：** 智联职位可搜索、详情可读、可进入 \`/rank\` 和 \`/apply\`。

### M2：官方授权来源可用

完成猎聘官方 CLI 只读包装、Token 脱敏和健康检查。

**结果：** 智联 + 猎聘形成两个可诊断的自动化来源。

### M3：强风控平台可用

完成 BOSS/51job 人工导入和浏览器辅助设计。

**结果：** 即使平台阻止自动抓取，职位也能进入统一排名和申请流程。

### M4：来源扩展

增加企业官网、ATS 和更多合规来源，并完善来源可信度和跨平台合并展示。

## 10. 总体验收标准

- [ ] 中文候选人资料和搜索策略已初始化。
- [ ] 智联支持搜索和详情读取。
- [ ] 猎聘通过官方 CLI 只读接入。
- [ ] BOSS 和 51job 支持人工导入。
- [ ] 所有来源输出统一职位对象。
- [ ] 中文薪资、日期、学历和经验能够标准化。
- [ ] 跨平台重复职位能够识别。
- [ ] \`/rank\` 无需复制平台逻辑即可评分。
- [ ] \`/apply\` 能读取中文职位正文并归档。
- [ ] Token、简历、联系方式不会进入 Git。
- [ ] \`/scrape health\` 能区分认证失败、被拦截、解析退化和无结果。
- [ ] 没有验证码绕过、批量投递和自动私聊功能。
- [ ] 新增门户拥有单元测试、契约测试和低频在线验证记录。

## 11. 推荐首个开发批次

第一批只做以下范围：

\`\`\`text
1. 中文市场配置
2. 智联招聘只读适配器
3. 中文薪资/日期/经验/学历标准化
4. 跨平台去重字段扩展
5. 猎聘官方 CLI 只读适配器
6. BOSS/51job 手动职位导入
\`\`\`

该批次完成后，项目即可形成“国内职位发现 -> 统一评分 -> 定制申请材料 -> 申请跟踪”的闭环，同时把高风险的自动投递和接口逆向留在后续独立评估中。

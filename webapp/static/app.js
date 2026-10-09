const fallbackPages = [
  { id: "today", label: "今天", path: "#today", description: "查看当前最重要的求职行动和进度。" },
  { id: "jobs", label: "职位", path: "#jobs", description: "搜索、导入、筛选和评估职位。" },
  { id: "applications", label: "申请", path: "#applications", description: "查看申请阶段、截止日期和面试进度。" },
  { id: "profile", label: "资料与材料", path: "#profile", description: "维护求职偏好、候选人资料和申请材料。" },
  { id: "settings", label: "设置", path: "#settings", description: "查看平台、AI、隐私和本地诊断。" },
]

const pageMeta = {
  today: { eyebrow: "TODAY", title: "今天先推进最重要的一步", subtitle: "查看进度、处理待办，让每次打开工作台都有明确方向。" },
  jobs: { eyebrow: "JOBS", title: "发现并判断值得投入的机会", subtitle: "在同一个工作区完成搜索、导入、筛选和匹配。" },
  applications: { eyebrow: "APPLICATIONS", title: "跟踪每一份申请的进展", subtitle: "从待提交到面试与结果，始终以本地跟踪表为准。" },
  profile: { eyebrow: "PROFILE & MATERIALS", title: "让系统准确理解你的目标与经历", subtitle: "分步完成求职偏好、简历确认和候选人资料映射。" },
  settings: { eyebrow: "SETTINGS", title: "平台、AI 与隐私设置", subtitle: "检查本地环境和数据边界，技术细节按需展开。" },
}

const iconById = { today: "⌂", jobs: "⌕", applications: "↗", profile: "✦", settings: "⚙" }
const legacyRouteMap = { home: "today", search: "jobs", rank: "jobs", import: "jobs", setup: "profile", resume: "profile", health: "settings", privacy: "settings", release: "settings" }
const statusLabels = { drafted: "待提交", applied: "已申请", interview: "面试", offer: "Offer", hired: "已入职", rejected: "未通过", no_response: "无回复", "no response": "无回复", offer_declined: "已拒绝 Offer", "offer declined": "已拒绝 Offer", withdrawn: "已撤回" }

const nav = document.querySelector("#main-nav")
const mobileNav = document.querySelector("#mobile-nav")
const consentDialog = document.querySelector("#consent-dialog")
let latestDashboard = null
let latestAIStatus = null
let latestRankTask = null
let latestResumeParsed = null
let selectedJobKey = ""

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]))
}

function safeUrl(value) {
  try {
    const url = new URL(String(value), window.location.origin)
    return ["http:", "https:"].includes(url.protocol) ? url.href : ""
  } catch (_) {
    return ""
  }
}

function setBusy(target, busy) {
  if (target) target.setAttribute("aria-busy", String(Boolean(busy)))
}

function setStatus(target, message, tone = "") {
  if (!target) return
  target.className = `form-status${tone ? ` ${tone}` : ""}`
  target.textContent = message
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  let payload = {}
  try { payload = await response.json() } catch (_) { payload = {} }
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`)
  return payload
}

function splitValues(value) {
  return String(value || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
}

function renderNavigation(pages = fallbackPages, metrics = {}) {
  const counts = { jobs: Number(metrics.pending_jobs || 0), applications: Number(metrics.drafted_applications || 0) + Number(metrics.interviews || 0) }
  const markup = pages.map((page) => {
    const count = counts[page.id] || 0
    return `<a class="nav-item" href="${escapeHtml(page.path)}" data-nav-page="${escapeHtml(page.id)}"><span class="nav-icon" aria-hidden="true">${iconById[page.id] || "•"}</span><span>${escapeHtml(page.label)}</span>${count ? `<span class="nav-count" aria-label="${count} 项待处理">${count}</span>` : ""}</a>`
  }).join("")
  nav.innerHTML = markup
  mobileNav.innerHTML = markup
  updateActiveNavigation(currentPage())
}

function currentPage() {
  const raw = window.location.hash.replace(/^#/, "") || "today"
  return pageMeta[raw] ? raw : (legacyRouteMap[raw] || "today")
}

function updateActiveNavigation(page) {
  document.querySelectorAll("[data-nav-page]").forEach((item) => {
    const active = item.dataset.navPage === page
    item.classList.toggle("active", active)
    if (active) item.setAttribute("aria-current", "page")
    else item.removeAttribute("aria-current")
  })
}

function showPage(page, { focus = false } = {}) {
  const selected = pageMeta[page] ? page : "today"
  document.querySelectorAll(".page-panel").forEach((panel) => {
    const active = panel.dataset.page === selected
    panel.hidden = !active
    panel.classList.toggle("active", active)
  })
  const meta = pageMeta[selected]
  document.querySelector("#page-eyebrow").textContent = meta.eyebrow
  document.querySelector("#page-title").textContent = meta.title
  document.querySelector("#page-subtitle").textContent = meta.subtitle
  updateActiveNavigation(selected)
  document.title = `${meta.title} · AI 求职工作台`
  window.scrollTo({ top: 0, behavior: "auto" })
  if (focus) document.querySelector(`[data-page="${selected}"]`)?.focus({ preventScroll: true })
}

function navigateTo(page) {
  const selected = pageMeta[page] ? page : (legacyRouteMap[page] || "today")
  if (window.location.hash !== `#${selected}`) window.location.hash = selected
  else showPage(selected, { focus: true })
}

function renderNextAction(action) {
  const target = document.querySelector("#next-action-card")
  const safeAction = action || { title: "完善求职偏好", description: "补齐目标和城市后即可开始。", label: "继续完善", path: "#profile" }
  target.innerHTML = `<div class="next-action-copy"><span class="section-label">下一步</span><h2>${escapeHtml(safeAction.title)}</h2><p>${escapeHtml(safeAction.description)}</p></div><a class="button button-primary" href="${escapeHtml(safeAction.path || "#today")}">${escapeHtml(safeAction.label || "继续")}</a>`
  setBusy(target, false)
}

function renderMetrics(metrics = {}) {
  document.querySelector("#metric-new-jobs").textContent = Number(metrics.pending_jobs || 0)
  document.querySelector("#metric-shortlist").textContent = Number(metrics.shortlisted_jobs || 0)
  document.querySelector("#metric-applications").textContent = Number(metrics.applications || 0)
  document.querySelector("#metric-interviews").textContent = Number(metrics.interviews || 0)
}

function renderRecentJobs(ranking) {
  const target = document.querySelector("#recent-jobs")
  const jobs = ranking?.status === "ready" && Array.isArray(ranking.jobs) ? ranking.jobs.slice(0, 3) : []
  if (!jobs.length) {
    target.innerHTML = `<div class="empty-state-card"><span class="empty-icon" aria-hidden="true">⌕</span><h3>还没有职位</h3><p>开始第一次搜索，结果会集中显示在职位工作台。</p><a class="button button-primary" href="#jobs">开始搜索</a></div>`
  } else {
    target.innerHTML = jobs.map((job) => `<div class="compact-row"><span class="compact-score">${job.rank_score == null ? "—" : Math.round(job.rank_score)}</span><div class="compact-copy"><strong title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</strong><span>${escapeHtml(job.company)} · ${escapeHtml(job.location)}</span></div><a href="#jobs" data-open-job="${escapeHtml(job.key)}">详情</a></div>`).join("")
  }
  setBusy(target, false)
}

function renderProfileProgress(progress = {}, materials = {}) {
  const percent = Number(progress.percent || 0)
  const value = document.querySelector("#profile-progress-value")
  const bar = document.querySelector("#profile-progress-bar")
  const track = bar.parentElement
  value.textContent = `${percent}%`
  bar.style.width = `${percent}%`
  track.setAttribute("aria-valuenow", String(percent))
  const missing = new Set(progress.missing || [])
  const items = [
    ["goal", "已填写求职目标"],
    ["cities", "已确认目标城市"],
    ["platforms", "已选择搜索平台"],
    ["resume", "已确认简历资料"],
  ]
  document.querySelector("#profile-checklist").innerHTML = items.map(([key, label]) => `<li class="${missing.has(key) ? "" : "complete"}">${label}</li>`).join("")
  const resumeBadge = document.querySelector("#resume-state-badge")
  const confirmed = materials.resume_status === "confirmed"
  resumeBadge.className = `status-badge ${confirmed ? "safe" : "neutral"}`
  resumeBadge.textContent = confirmed ? "已确认" : "未确认"
  document.querySelectorAll("[data-profile-step]").forEach((item) => item.classList.remove("active", "complete"))
  const steps = document.querySelectorAll("[data-profile-step]")
  if (progress.search_ready) steps[0]?.classList.add("complete")
  else steps[0]?.classList.add("active")
  if (confirmed) steps[1]?.classList.add("complete")
  else if (progress.search_ready) steps[1]?.classList.add("active")
  if (progress.rank_ready) steps[2]?.classList.add("complete", "active")
}

function renderRecentTasks(tasks = []) {
  const target = document.querySelector("#recent-tasks")
  if (!tasks.length) {
    target.innerHTML = `<div class="empty-inline">还没有本地任务。搜索或匹配完成后会记录在这里。</div>`
  } else {
    target.innerHTML = tasks.map((task) => {
      const kind = task.kind === "rank" ? "职位匹配" : task.kind === "search" ? "职位搜索" : "本地任务"
      const detail = task.kind === "rank" ? `处理 ${task.ranked || 0} 个职位` : `找到 ${task.found || 0} 个，新增 ${task.added || 0} 个`
      const success = task.status === "completed"
      return `<div class="activity-row"><div><strong>${kind}</strong><span>${detail}</span></div><span class="task-state ${success ? "success" : "error"}">${success ? "已完成" : escapeHtml(task.status || "未完成")}</span></div>`
    }).join("")
  }
  setBusy(target, false)
}

function renderDeadlines(applications) {
  const target = document.querySelector("#deadline-list")
  const items = (applications?.items || []).filter((item) => Number.isInteger(item.days_to_deadline) && item.days_to_deadline >= 0 && item.days_to_deadline <= 7).slice(0, 4)
  if (!items.length) target.innerHTML = `<div class="empty-inline">未来 7 天没有已记录的申请截止日期。</div>`
  else target.innerHTML = items.map((item) => `<div class="deadline-row"><div><strong>${escapeHtml(item.role)}</strong><span>${escapeHtml(item.company)} · ${escapeHtml(item.deadline)}</span></div><span class="deadline-days">${item.days_to_deadline === 0 ? "今天" : `${item.days_to_deadline} 天`}</span></div>`).join("")
  setBusy(target, false)
}

function renderRanking(ranking) {
  const summary = document.querySelector("#rank-summary")
  const list = document.querySelector("#rank-list")
  if (!ranking || ranking.status === "empty") {
    summary.textContent = "还没有本地职位"
    list.innerHTML = `<div class="empty-state-card"><span class="empty-icon" aria-hidden="true">⌕</span><h3>从一次搜索开始</h3><p>填写上方关键词和城市，或使用人工导入加入一个职位。</p><button class="button button-primary" type="button" data-focus-search>填写搜索条件</button></div>`
    setBusy(list, false)
    document.querySelector("#job-detail").innerHTML = `<div class="empty-detail"><span class="empty-icon" aria-hidden="true">⌁</span><h3>职位详情会显示在这里</h3><p>搜索或导入职位后，可以查看匹配分、门禁、优势和差距。</p></div>`
    return
  }
  if (ranking.status !== "ready") {
    summary.textContent = "本地职位状态暂时无法读取"
    list.innerHTML = `<div class="empty-inline">请检查 seen_jobs.json 后刷新。</div>`
    setBusy(list, false)
    return
  }
  const jobs = Array.isArray(ranking.jobs) ? ranking.jobs : []
  const counts = ranking.counts || {}
  summary.textContent = `显示 ${jobs.length} 个职位 · 已匹配 ${counts.ranked || 0} · 待匹配 ${counts.new || 0}`
  list.innerHTML = jobs.length ? jobs.map((job) => {
    const score = job.rank_score == null ? "—" : Math.round(job.rank_score)
    const verdict = job.rank_verdict || (job.status === "new" ? "待匹配" : job.status)
    const locationGate = job.location_verdict && job.location_verdict !== "PASS" ? `地点 ${job.location_verdict}` : ""
    const languageGate = job.language_gate && job.language_gate !== "PASS" ? `语言 ${job.language_gate}` : ""
    const flags = [locationGate, languageGate].filter(Boolean).join(" · ")
    const insight = [...(job.strengths || []).map((item) => `优势：${item}`), ...(job.gaps || []).map((item) => `差距：${item}`)].slice(0, 1).join("")
    return `<button class="job-list-item${selectedJobKey === job.key ? " selected" : ""}" type="button" data-job-key="${escapeHtml(job.key)}" aria-pressed="${selectedJobKey === job.key}"><span class="job-score${job.rank_score == null ? " pending" : ""}">${escapeHtml(score)}</span><span class="job-list-copy"><span class="job-title-row"><h3 title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</h3><span class="job-verdict">${escapeHtml(verdict)}</span></span><span class="job-company">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</span><span class="job-meta">${escapeHtml(job.salary)}${job.deadline ? ` · 截止 ${escapeHtml(job.deadline)}` : ""}${flags ? ` · ${escapeHtml(flags)}` : ""}</span>${insight ? `<span class="job-insight">${escapeHtml(insight)}</span>` : ""}</span></button>`
  }).join("") : `<div class="empty-inline">当前筛选条件没有结果。</div>`
  setBusy(list, false)
}

function gateClass(value) {
  const normalized = String(value || "FLAG").toUpperCase()
  return normalized === "PASS" ? "pass" : normalized === "FAIL" ? "fail" : "flag"
}

async function showJobDetail(key, { focus = true } = {}) {
  const target = document.querySelector("#job-detail")
  selectedJobKey = key
  document.querySelectorAll("[data-job-key]").forEach((button) => {
    const selected = button.dataset.jobKey === key
    button.classList.toggle("selected", selected)
    button.setAttribute("aria-pressed", String(selected))
  })
  setBusy(target, true)
  target.innerHTML = `<div class="empty-inline">正在读取职位详情…</div>`
  try {
    const payload = await requestJson(`/api/rank/detail?key=${encodeURIComponent(key)}`)
    const job = payload.job || {}
    const href = safeUrl(job.url)
    const list = (items, empty) => Array.isArray(items) && items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${empty}</p>`
    target.innerHTML = `<button class="button button-secondary mobile-detail-close" type="button" data-close-detail>← 返回职位列表</button><div class="job-detail-header"><div><span class="section-label">JOB DETAIL</span><h3 id="job-detail-title" tabindex="-1">${escapeHtml(job.title || "职位详情")}</h3><p>${escapeHtml(job.company || "未注明公司")} · ${escapeHtml(job.location || "未注明地点")} · ${escapeHtml(job.salary || "面议/未注明")}</p></div><div class="detail-score"><strong>${escapeHtml(job.rank_score ?? "—")}</strong><span>匹配分</span></div></div><div class="detail-gates"><span class="status-badge neutral">${escapeHtml(job.rank_verdict || "待匹配")}</span><span class="status-badge ${gateClass(job.location_verdict) === "pass" ? "safe" : gateClass(job.location_verdict) === "fail" ? "danger" : "warning"}">地点 ${escapeHtml(job.location_verdict || "FLAG")}</span><span class="status-badge ${gateClass(job.language_gate) === "pass" ? "safe" : gateClass(job.language_gate) === "fail" ? "danger" : "warning"}">语言 ${escapeHtml(job.language_gate || "FLAG")}</span></div>${job.language_note ? `<p class="parse-result partial">${escapeHtml(job.language_note)}</p>` : ""}<section class="detail-section"><h4>匹配优势</h4>${list(job.strengths, "尚未生成优势摘要。")}</section><section class="detail-section"><h4>需要确认的差距</h4>${list(job.gaps, "尚未生成差距摘要。")}</section>${job.raw_text ? `<section class="detail-section"><details><summary>查看本地归档原文</summary><pre>${escapeHtml(job.raw_text)}</pre></details></section>` : ""}<div class="detail-actions">${href ? `<a class="button button-secondary" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">打开原职位 ↗</a>` : ""}<a class="button button-primary" href="#applications">进入申请跟踪</a></div>`
    target.classList.add("open")
    if (focus) document.querySelector("#job-detail-title")?.focus({ preventScroll: true })
  } catch (error) {
    target.innerHTML = `<div class="parse-result error">${escapeHtml(error.message)}</div>`
  } finally {
    setBusy(target, false)
  }
}

function closeJobDetail() {
  document.querySelector("#job-detail").classList.remove("open")
  document.querySelector(`[data-job-key="${CSS.escape(selectedJobKey)}"]`)?.focus()
}

function renderRankTask(task) {
  latestRankTask = task || null
  const target = document.querySelector("#rank-task-status")
  const button = document.querySelector("#start-rank-task")
  if (!task) {
    target.innerHTML = `<div class="readiness-card"><div><strong>无法检查匹配准备状态</strong><p>刷新页面后重试。</p></div><span class="status-badge warning">待检查</span></div>`
    button.disabled = true
    return
  }
  const state = task.status === "ready" ? { title: "职位与候选人资料已就绪", tone: "safe", label: "可匹配" } : task.status === "no_jobs" ? { title: "先搜索或导入职位", tone: "neutral", label: "无职位" } : { title: "先完成候选人资料", tone: "warning", label: "资料未完成" }
  target.innerHTML = `<div class="readiness-card"><div><strong>${state.title}</strong><p>${escapeHtml(task.message || "")}</p></div><span class="status-badge ${state.tone}">${state.label}</span></div>`
  button.disabled = task.status !== "ready" || !latestAIStatus?.configured
  button.title = task.status !== "ready" ? state.title : (!latestAIStatus?.configured ? "请先在设置中配置 AI 服务" : "")
}

function renderAIProvider(status) {
  latestAIStatus = status || null
  const target = document.querySelector("#ai-provider-status")
  const directButton = document.querySelector("#start-ai-match")
  if (!status) {
    target.innerHTML = `<div class="parse-result error">无法读取 AI 服务状态。</div>`
    directButton.disabled = true
    renderRankTask(latestRankTask)
    return
  }
  const configured = Boolean(status.configured)
  target.innerHTML = `<div class="ai-provider-card"><div><strong>OpenAI 兼容 API</strong><p>${escapeHtml(status.message || "")}</p></div><span class="status-badge ${configured ? "safe" : "warning"}">${configured ? "已配置" : "未配置"}</span></div><small class="ai-provider-detail">接口：${escapeHtml(status.base_url || "未设置")}${status.model ? ` · 模型：${escapeHtml(status.model)}` : ""} · 默认不发送外部请求</small>`
  setBusy(target, false)
  directButton.disabled = !configured
  document.querySelector("#consent-destination").textContent = status.base_url ? `${status.base_url}${status.model ? ` · ${status.model}` : ""}` : "已配置的 OpenAI 兼容 API"
  renderRankTask(latestRankTask)
}

function renderHealth(health) {
  const target = document.querySelector("#health-summary")
  if (!health) {
    target.innerHTML = `<div class="parse-result error">暂时无法读取平台状态。</div>`
    return
  }
  target.innerHTML = (health.commands || []).map((item) => `<div class="health-row"><span><i class="health-dot ${item.available ? "ok" : ""}" aria-hidden="true"></i>${escapeHtml(item.label)}</span><strong class="${item.available ? "gate pass" : "gate flag"}">${item.available ? "可用" : "未检测到"}</strong></div>`).join("") + `<p class="health-caption">搜索仅在你主动启动后执行只读访问。</p>`
  document.querySelector("#health-guidance").textContent = health.guidance || ""
  setBusy(target, false)
}

function renderPrivacy(privacy) {
  const target = document.querySelector("#privacy-summary")
  if (!privacy) {
    target.innerHTML = `<div class="parse-result error">暂时无法读取隐私策略。</div>`
    return
  }
  const networkLabel = privacy.external_ai_opt_in ? "默认关闭" : (privacy.network_requests ? "允许" : "关闭")
  target.innerHTML = `<div class="privacy-grid"><div><span>网络请求</span><strong class="privacy-safe">${networkLabel}</strong></div><div><span>凭证访问</span><strong class="privacy-safe">${privacy.credential_access ? "允许" : "关闭"}</strong></div><div><span>外部写入</span><strong class="privacy-safe">${privacy.external_writes ? "允许" : "关闭"}</strong></div><div><span>绑定地址</span><strong>${escapeHtml(privacy.bind_address || "127.0.0.1")}</strong></div></div><div class="privacy-columns"><div><strong>允许</strong><ul>${(privacy.allowed_actions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div><strong>明确禁止</strong><ul>${(privacy.blocked_actions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></div><p class="privacy-log-policy">${escapeHtml(privacy.log_policy || "")}</p>`
  setBusy(target, false)
}

function renderRelease(check) {
  const target = document.querySelector("#release-summary")
  if (!check) {
    target.innerHTML = `<div class="parse-result error">暂时无法读取发布检查。</div>`
    return
  }
  const passed = check.status === "pass"
  target.innerHTML = `<div class="release-head"><span class="status-badge ${passed ? "safe" : "warning"}">${passed ? "通过" : "需处理"}</span><span>${escapeHtml(check.message || "")}（${check.passed}/${check.total}）</span></div><div class="release-list">${(check.checks || []).map((item) => `<div class="release-row"><span><i class="health-dot ${item.passed ? "ok" : ""}" aria-hidden="true"></i>${escapeHtml(item.label)}</span><small>${escapeHtml(item.detail || "")}</small></div>`).join("")}</div>`
  setBusy(target, false)
}

function renderApplications(applications) {
  const counts = applications?.counts || {}
  document.querySelector("#application-drafted").textContent = Number(counts.drafted || 0)
  document.querySelector("#application-open").textContent = Math.max(0, Number(counts.open || 0) - Number(counts.drafted || 0))
  document.querySelector("#application-interview").textContent = Number(counts.interview || 0)
  document.querySelector("#application-offer").textContent = Number(counts.offer || 0)
  const target = document.querySelector("#application-list")
  const badge = document.querySelector("#application-source-badge")
  if (!applications || applications.status === "unreadable") {
    target.innerHTML = `<div class="parse-result error">无法读取 job_search_tracker.csv。</div>`
    badge.className = "status-badge warning"
    badge.textContent = "读取失败"
  } else if (applications.status === "empty" || !(applications.items || []).length) {
    target.innerHTML = `<div class="empty-state-card"><span class="empty-icon" aria-hidden="true">↗</span><h3>还没有申请记录</h3><p>选择一个高匹配职位并运行 canonical /apply 工作流后，申请会显示在这里。</p><a class="button button-primary" href="#jobs">查看职位</a></div>`
    badge.className = "status-badge neutral"
    badge.textContent = "尚未创建"
  } else {
    target.innerHTML = applications.items.map((item) => {
      const status = statusLabels[item.status] || item.status || "未知"
      const statusTone = ["interview", "offer", "hired"].includes(item.status) ? "safe" : ["rejected", "no_response", "no response", "withdrawn"].includes(item.status) ? "neutral" : item.status === "drafted" ? "warning" : "neutral"
      const deadline = item.deadline ? `${item.deadline}${Number.isInteger(item.days_to_deadline) && item.days_to_deadline < 0 ? " · 已过期" : Number.isInteger(item.days_to_deadline) && item.days_to_deadline <= 7 ? ` · ${item.days_to_deadline === 0 ? "今天" : `${item.days_to_deadline} 天`}` : ""}` : "未记录截止日期"
      return `<article class="application-row"><div class="application-role"><strong>${escapeHtml(item.role)}</strong><span>${escapeHtml(item.company)}${item.sector ? ` · ${escapeHtml(item.sector)}` : ""}</span></div><span class="status-badge ${statusTone} application-status">${escapeHtml(status)}</span><div class="application-cell application-fit"><small>匹配分</small><strong>${escapeHtml(item.fit_rating || "—")}</strong></div><div class="application-cell application-date"><small>记录日期</small><strong>${escapeHtml(item.date || "—")}</strong></div><div class="application-cell application-deadline"><small>截止日期</small><strong>${escapeHtml(deadline)}</strong></div></article>`
    }).join("")
    badge.className = "status-badge safe"
    badge.textContent = `${counts.total || applications.items.length} 条本地记录`
  }
  setBusy(target, false)
}

function renderMaterials(materials = {}) {
  const target = document.querySelector("#materials-summary")
  target.innerHTML = `<div class="material-stat"><strong>${materials.resume_status === "confirmed" ? "✓" : "—"}</strong><span>简历已确认</span></div><div class="material-stat"><strong>${Number(materials.cv_count || 0)}</strong><span>CV PDF</span></div><div class="material-stat"><strong>${Number(materials.cover_letter_count || 0)}</strong><span>求职信 PDF</span></div><p class="material-note">${materials.profile_ready ? "Canonical 候选人资料已就绪。" : "Canonical 候选人资料仍有占位字段，请预览并确认安全映射。"}${materials.application_archive_count ? ` 已归档 ${materials.application_archive_count} 份申请。` : ""}</p>`
  setBusy(target, false)
}

function fillSetup(setup) {
  const data = setup?.data || {}
  if (!data || !Object.keys(data).length) return
  document.querySelector("#setup-goal").value = data.goal || ""
  document.querySelector("#setup-cities").value = (data.cities || []).join("、")
  document.querySelector("#setup-salary").value = data.salary_min || ""
  document.querySelector("#setup-constraints").value = (data.constraints || []).join("、")
  document.querySelectorAll("input[name=work_mode]").forEach((input) => { input.checked = (data.work_mode || []).includes(input.value) })
  document.querySelectorAll("input[name=platforms]").forEach((input) => { input.checked = (data.platforms || []).includes(input.value) })
  document.querySelector("#next-actions").innerHTML = `<li>确认简历资料，提高匹配可靠性。</li><li>进入职位工作台开始搜索或导入职位。</li>`
}

function renderDashboard(dashboard) {
  latestDashboard = dashboard
  renderNavigation(dashboard.pages || fallbackPages, dashboard.metrics || {})
  renderNextAction(dashboard.next_action)
  renderMetrics(dashboard.metrics)
  renderRecentJobs(dashboard.ranking)
  renderProfileProgress(dashboard.profile_progress, dashboard.materials)
  renderRecentTasks(dashboard.recent_tasks)
  renderDeadlines(dashboard.applications)
  renderRanking(dashboard.ranking)
  renderApplications(dashboard.applications)
  renderMaterials(dashboard.materials)
  fillSetup(dashboard.setup)
}

async function loadDashboard({ announce = false } = {}) {
  const refresh = document.querySelector("#refresh-button")
  refresh.disabled = true
  if (announce) document.querySelector("#global-status").textContent = "正在刷新本地状态"
  try {
    const [dashboard, health, privacy, rankTask, release, ai] = await Promise.all([
      requestJson("/api/dashboard"),
      requestJson("/api/health"),
      requestJson("/api/privacy"),
      requestJson("/api/rank/status"),
      requestJson("/api/release-check"),
      requestJson("/api/ai/status"),
    ])
    latestAIStatus = ai
    renderDashboard(dashboard)
    renderHealth(health)
    renderPrivacy(privacy)
    renderRelease(release)
    renderAIProvider(ai)
    renderRankTask(rankTask)
    if (announce) document.querySelector("#global-status").textContent = "本地状态已刷新"
  } catch (error) {
    renderNavigation(fallbackPages)
    document.querySelector("#global-status").textContent = `无法读取本地状态：${error.message}`
    renderRecentJobs(null)
    renderRanking({ status: "unreadable" })
  } finally {
    refresh.disabled = false
  }
}

function requestConsent({ title, description, confirmLabel }) {
  document.querySelector("#consent-title").textContent = title
  document.querySelector("#consent-description").textContent = description
  document.querySelector("#consent-confirm").textContent = confirmLabel
  consentDialog.returnValue = ""
  consentDialog.showModal()
  return new Promise((resolve) => consentDialog.addEventListener("close", () => resolve(consentDialog.returnValue === "confirm"), { once: true }))
}

async function pollTask(taskId, status, onDone) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const payload = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`)
    const task = payload.task
    setStatus(status, `${task.stage || "处理中"} · ${Math.round(task.progress || 0)}%`)
    if (["completed", "failed", "cancelled"].includes(task.status)) {
      onDone(task)
      return task
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  throw new Error("任务等待超时，可刷新页面查看本地状态")
}

async function startSearch(event) {
  event.preventDefault()
  const status = document.querySelector("#search-status")
  const submit = event.currentTarget.querySelector("button[type=submit]")
  const platforms = [...document.querySelectorAll("input[name=search-platforms]:checked")].map((input) => input.value)
  const body = { query: document.querySelector("#search-query").value.trim(), cities: splitValues(document.querySelector("#search-cities").value), platforms, limit: Number(document.querySelector("#search-limit").value || 10) }
  if (!platforms.length) return setStatus(status, "请至少选择一个搜索平台", "error")
  submit.disabled = true
  setStatus(status, "正在创建搜索任务…")
  try {
    const payload = await requestJson("/api/search/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    await pollTask(payload.task.id, status, (task) => setStatus(status, task.status === "completed" ? `搜索完成：找到 ${task.found || 0} 个，新增 ${task.added || 0} 个` : (task.errors?.[0]?.message || "搜索未完成"), task.status === "completed" ? "success" : "error"))
    await loadDashboard()
  } catch (error) {
    setStatus(status, error.message || "搜索失败", "error")
  } finally {
    submit.disabled = false
  }
}

async function startRankTask() {
  const button = document.querySelector("#start-rank-task")
  const status = document.querySelector("#ai-match-status")
  if (!latestAIStatus?.configured) {
    setStatus(status, "请先在设置中配置 OpenAI 兼容 API", "error")
    return
  }
  if (latestRankTask?.status !== "ready") {
    setStatus(status, latestRankTask?.message || "职位或候选人资料尚未就绪", "error")
    return
  }
  const confirmed = await requestConsent({ title: "确认运行职位匹配", description: "系统将把待匹配职位正文和候选人资料摘要发送到已配置的 OpenAI 兼容 API。", confirmLabel: "同意并开始匹配" })
  if (!confirmed) return setStatus(status, "已取消，未发送任何数据")
  button.disabled = true
  setStatus(status, "正在创建匹配任务…")
  try {
    const payload = await requestJson("/api/rank/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_external: true, limit: 10 }) })
    await pollTask(payload.task.id, status, (task) => setStatus(status, task.status === "completed" ? `匹配完成：处理 ${task.ranked || 0} 个职位` : (task.errors?.[0]?.message || "匹配未完成"), task.status === "completed" ? "success" : "error"))
    await loadDashboard()
  } catch (error) {
    setStatus(status, error.message || "匹配失败", "error")
  } finally {
    renderRankTask(latestRankTask)
  }
}

async function applyRankFilters() {
  const params = new URLSearchParams({ portal: document.querySelector("#rank-filter-portal").value, status: document.querySelector("#rank-filter-status").value, min_score: document.querySelector("#rank-filter-score").value, sort: document.querySelector("#rank-filter-sort").value, limit: "100" })
  const list = document.querySelector("#rank-list")
  setBusy(list, true)
  try { renderRanking(await requestJson(`/api/rank?${params.toString()}`)) }
  catch (error) { list.innerHTML = `<div class="parse-result error">${escapeHtml(error.message)}</div>`; setBusy(list, false) }
}

function setupPayload() {
  const salaryValue = document.querySelector("#setup-salary").value
  return {
    goal: document.querySelector("#setup-goal").value.trim(),
    cities: splitValues(document.querySelector("#setup-cities").value),
    salary_min: salaryValue ? Number(salaryValue) : null,
    constraints: splitValues(document.querySelector("#setup-constraints").value),
    work_mode: [...document.querySelectorAll("input[name=work_mode]:checked")].map((input) => input.value),
    platforms: [...document.querySelectorAll("input[name=platforms]:checked")].map((input) => input.value),
  }
}

async function saveSetup(event) {
  event.preventDefault()
  const status = document.querySelector("#setup-status")
  const submit = event.currentTarget.querySelector("button[type=submit]")
  submit.disabled = true
  setStatus(status, "正在保存本地偏好…")
  try {
    await requestJson("/api/setup/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setupPayload()) })
    setStatus(status, "求职偏好已保存到本机", "success")
    await loadDashboard()
  } catch (error) {
    setStatus(status, error.message || "保存失败", "error")
  } finally { submit.disabled = false }
}

async function parseGoal() {
  const text = document.querySelector("#setup-goal").value.trim()
  const button = document.querySelector("#parse-goal-button")
  const result = document.querySelector("#goal-parse-result")
  if (!text) {
    document.querySelector("#setup-goal").setAttribute("aria-invalid", "true")
    result.hidden = false
    result.className = "parse-result error"
    result.textContent = "请先输入一句话求职目标。"
    return
  }
  document.querySelector("#setup-goal").removeAttribute("aria-invalid")
  button.disabled = true
  try {
    const payload = await requestJson("/api/setup/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
    const parsed = payload.parsed || {}
    const fields = parsed.fields || {}
    result.hidden = false
    result.className = `parse-result ${parsed.confidence === "high" ? "success" : "partial"}`
    result.innerHTML = `<div class="parse-result-heading"><strong>识别结果（请确认）</strong><button id="apply-parsed-goal" class="button button-small button-secondary" type="button">回填表单</button></div><div class="parse-grid"><span>岗位方向</span><strong>${escapeHtml((fields.roles || []).join("、") || "未识别")}</strong><span>城市</span><strong>${escapeHtml((fields.cities || []).join("、") || "未识别")}</strong><span>薪资</span><strong>${escapeHtml(fields.salary_min || "未识别")}</strong><span>办公方式</span><strong>${escapeHtml((fields.work_mode || []).join("、") || "未识别")}</strong><span>其他限制</span><strong>${escapeHtml((fields.constraints || []).join("、") || "无")}</strong></div>${(parsed.pending || []).length ? `<p class="parse-pending">待确认：${parsed.pending.map(escapeHtml).join("；")}</p>` : ""}`
    document.querySelector("#apply-parsed-goal").addEventListener("click", () => {
      if ((fields.cities || []).length) document.querySelector("#setup-cities").value = fields.cities.join("、")
      if (fields.salary_min) document.querySelector("#setup-salary").value = fields.salary_min
      if ((fields.constraints || []).length) document.querySelector("#setup-constraints").value = fields.constraints.join("、")
      if ((fields.work_mode || []).length) document.querySelectorAll("input[name=work_mode]").forEach((input) => { input.checked = fields.work_mode.includes(input.value) })
      document.querySelector("#setup-cities").focus()
    })
  } catch (error) {
    result.hidden = false
    result.className = "parse-result error"
    result.textContent = error.message
  } finally { button.disabled = false }
}

function renderResumeResult(parsed, status = "review") {
  latestResumeParsed = parsed
  const result = document.querySelector("#resume-result")
  const fields = parsed?.fields || {}
  const contact = [fields.email, fields.phone].filter(Boolean).join(" · ") || "未识别"
  const pending = parsed?.pending || []
  result.hidden = false
  result.className = `parse-result ${status === "confirmed" ? "success" : pending.length ? "partial" : "success"}`
  result.innerHTML = `<div class="parse-result-heading"><strong>简历识别结果（${status === "confirmed" ? "已保存" : "请确认"}）</strong></div><div class="parse-grid"><span>姓名</span><strong>${escapeHtml(fields.name || "未识别")}</strong><span>联系方式</span><strong>${escapeHtml(contact)}</strong><span>技能</span><strong>${escapeHtml((fields.skills || []).join("、") || "未识别")}</strong><span>教育</span><strong>${escapeHtml((fields.education || []).join("；") || "未识别")}</strong></div>${pending.length ? `<p class="parse-pending">待确认：${pending.map(escapeHtml).join("；")}</p>` : ""}`
  document.querySelector("#confirm-resume-button").disabled = status === "confirmed"
  document.querySelector("#map-profile-button").disabled = status !== "confirmed"
  const badge = document.querySelector("#resume-state-badge")
  badge.className = `status-badge ${status === "confirmed" ? "safe" : "warning"}`
  badge.textContent = status === "confirmed" ? "已确认" : "待确认"
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "")
    reader.onerror = () => reject(new Error("无法读取简历文件"))
    reader.readAsDataURL(file)
  })
}

async function parseResume(event) {
  event.preventDefault()
  const status = document.querySelector("#resume-status")
  const button = document.querySelector("#parse-resume-button")
  const file = document.querySelector("#resume-file").files[0]
  const text = document.querySelector("#resume-text").value.trim()
  if (!file && !text) return setStatus(status, "请选择文件或粘贴简历文本", "error")
  button.disabled = true
  setStatus(status, "正在本机解析简历…")
  try {
    let payload
    if (file) {
      document.querySelector("#resume-filename").value = file.name
      payload = await requestJson("/api/resume/parse-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, content_base64: await fileToBase64(file) }) })
      if (file.type.startsWith("text/") || /\.(txt|md|text)$/i.test(file.name)) {
        document.querySelector("#resume-text").value = await file.text()
      }
    } else {
      payload = await requestJson("/api/resume/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: document.querySelector("#resume-filename").value.trim(), text }) })
    }
    renderResumeResult(payload.resume?.data, "review")
    setStatus(status, "解析完成，请检查字段后确认", "success")
  } catch (error) { setStatus(status, error.message || "简历解析失败", "error") }
  finally { button.disabled = false }
}

async function confirmResume() {
  const status = document.querySelector("#resume-status")
  const button = document.querySelector("#confirm-resume-button")
  if (!latestResumeParsed) return setStatus(status, "请先识别简历", "error")
  button.disabled = true
  setStatus(status, "正在保存确认后的本地资料…")
  try {
    const payload = await requestJson("/api/resume/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parsed: latestResumeParsed }) })
    renderResumeResult(payload.resume?.data, "confirmed")
    setStatus(status, "简历字段已确认并保存到本机", "success")
    await loadDashboard()
  } catch (error) { setStatus(status, error.message || "确认失败", "error"); button.disabled = false }
}

async function mapProfile() {
  const status = document.querySelector("#resume-status")
  const target = document.querySelector("#profile-map-result")
  const button = document.querySelector("#map-profile-button")
  button.disabled = true
  setStatus(status, "正在生成字段级差异…")
  try {
    const payload = await requestJson("/api/resume/profile-preview")
    const changes = payload.profile?.changes || []
    target.hidden = false
    target.className = "parse-result partial"
    if (!changes.length) {
      target.innerHTML = `<strong>没有可安全映射的占位字段</strong><p class="parse-pending">请在候选人资料中手动补充或确认已有内容。</p>`
    } else {
      target.innerHTML = `<strong>将更新 ${changes.length} 个字段</strong><ul>${changes.map((change) => `<li>${escapeHtml(change.field)}：${escapeHtml(change.to)}</li>`).join("")}</ul><button id="confirm-profile-map" class="button button-primary" type="button">确认写入正式资料</button>`
      document.querySelector("#confirm-profile-map").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true
        try {
          const body = await requestJson("/api/resume/profile-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) })
          target.className = "parse-result success"
          target.innerHTML = `<strong>正式资料已更新</strong><p class="parse-pending">已生成备份：${escapeHtml(body.profile?.backup || "本地备份")}</p>`
          setStatus(status, "Canonical 候选人资料已更新", "success")
          await loadDashboard()
        } catch (error) { setStatus(status, error.message || "正式资料更新失败", "error"); event.currentTarget.disabled = false }
      })
    }
    setStatus(status, "差异预览已生成")
  } catch (error) {
    target.hidden = false
    target.className = "parse-result error"
    target.textContent = error.message
    setStatus(status, error.message, "error")
  } finally { button.disabled = false }
}

function updateDirectAIAvailability() {
  const hasJob = Boolean(document.querySelector("#import-text").value.trim())
  const hasCandidate = Boolean(document.querySelector("#resume-text").value.trim())
  document.querySelector("#direct-ai-panel").hidden = !(hasJob && hasCandidate)
}

async function importJob(event) {
  event.preventDefault()
  const status = document.querySelector("#import-status")
  const result = document.querySelector("#import-result")
  const submit = event.currentTarget.querySelector("button[type=submit]")
  submit.disabled = true
  setStatus(status, "正在保存本地职位…")
  try {
    const payload = await requestJson("/api/import/job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: document.querySelector("#import-url").value.trim(), portal: document.querySelector("#import-portal").value, text: document.querySelector("#import-text").value.trim() }) })
    const record = payload.import?.record || {}
    result.hidden = false
    result.className = "parse-result success"
    result.innerHTML = `<strong>已保存并加入职位列表</strong><p class="parse-pending">${escapeHtml(record.title || "未命名职位")} · ${escapeHtml(record.company || "未注明公司")}<br>原文归档：${escapeHtml(payload.import?.archive_path || "本地职位档案")}</p>`
    setStatus(status, "职位已导入", "success")
    updateDirectAIAvailability()
    await loadDashboard()
  } catch (error) {
    result.hidden = false
    result.className = "parse-result error"
    result.textContent = error.message
    setStatus(status, error.message || "导入失败", "error")
  } finally { submit.disabled = false }
}

function renderAIMatch(result) {
  const target = document.querySelector("#ai-match-result")
  if (!result) { target.hidden = true; target.innerHTML = ""; return }
  const scoreRows = [["综合", result.overall], ["技术", result.technical], ["经验", result.experience], ["行为", result.behavioral], ["方向", result.career]].map(([label, score]) => `<div class="ai-score"><span>${label}</span><strong>${escapeHtml(score)}</strong></div>`).join("")
  const list = (items) => Array.isArray(items) && items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>暂无</p>`
  target.hidden = false
  target.className = "ai-match-result parse-result success"
  target.innerHTML = `<div class="parse-result-heading"><strong>AI 匹配完成</strong><span class="status-badge neutral">地点 ${escapeHtml(result.location_verdict || "FLAG")} · 语言 ${escapeHtml(result.language_gate || "FLAG")}</span></div><div class="ai-score-grid">${scoreRows}</div><div class="ai-insights"><div><h4>优势</h4>${list(result.strengths)}</div><div><h4>差距</h4>${list(result.gaps)}</div></div><p>${escapeHtml(result.summary || "暂无总结")}</p>`
}

async function startAIMatch() {
  const button = document.querySelector("#start-ai-match")
  const status = document.querySelector("#ai-match-status")
  const jobText = document.querySelector("#import-text").value.trim()
  const candidateText = document.querySelector("#resume-text").value.trim()
  if (!latestAIStatus?.configured) return setStatus(status, "请先在设置中配置 AI 服务", "error")
  if (!jobText || !candidateText) return setStatus(status, "请先填写职位正文和简历文本", "error")
  const confirmed = await requestConsent({ title: "确认匹配当前职位正文", description: "系统将发送当前职位正文和简历文本，用于一次性匹配预览。", confirmLabel: "同意并匹配" })
  if (!confirmed) return setStatus(status, "已取消，未发送任何数据")
  button.disabled = true
  setStatus(status, "正在请求模型…")
  renderAIMatch(null)
  try {
    const payload = await requestJson("/api/ai/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_text: jobText, candidate_text: candidateText, confirm_external: true }) })
    renderAIMatch(payload.match)
    setStatus(status, "匹配完成；结果仅展示在本机", "success")
  } catch (error) { setStatus(status, error.message || "AI 匹配失败", "error") }
  finally { button.disabled = !latestAIStatus?.configured }
}

document.addEventListener("click", (event) => {
  const navLink = event.target.closest("a[href^='#']")
  if (navLink) {
    const raw = navLink.getAttribute("href").slice(1)
    const page = pageMeta[raw] ? raw : legacyRouteMap[raw]
    if (page) {
      event.preventDefault()
      navigateTo(page)
      const legacyTarget = raw !== page ? document.getElementById(raw) : null
      if (legacyTarget) requestAnimationFrame(() => legacyTarget.scrollIntoView({ behavior: "auto", block: "start" }))
    }
  }
  const recentJob = event.target.closest("[data-open-job]")
  if (recentJob) {
    selectedJobKey = recentJob.dataset.openJob
    requestAnimationFrame(() => showJobDetail(selectedJobKey))
  }
  const jobButton = event.target.closest("[data-job-key]")
  if (jobButton) showJobDetail(jobButton.dataset.jobKey)
  if (event.target.closest("[data-close-detail]")) closeJobDetail()
  if (event.target.closest("[data-focus-search]")) document.querySelector("#search-query").focus()
})

window.addEventListener("hashchange", () => showPage(currentPage(), { focus: true }))
document.querySelector("#refresh-button").addEventListener("click", () => loadDashboard({ announce: true }))
document.querySelector("#health-refresh-link").addEventListener("click", () => loadDashboard({ announce: true }))
document.querySelector("#search-form").addEventListener("submit", startSearch)
document.querySelector("#rank-filter-button").addEventListener("click", applyRankFilters)
document.querySelector("#start-rank-task").addEventListener("click", startRankTask)
document.querySelector("#setup-form").addEventListener("submit", saveSetup)
document.querySelector("#parse-goal-button").addEventListener("click", parseGoal)
document.querySelector("#resume-form").addEventListener("submit", parseResume)
document.querySelector("#confirm-resume-button").addEventListener("click", confirmResume)
document.querySelector("#map-profile-button").addEventListener("click", mapProfile)
document.querySelector("#import-form").addEventListener("submit", importJob)
document.querySelector("#start-ai-match").addEventListener("click", startAIMatch)
document.querySelector("#import-text").addEventListener("input", updateDirectAIAvailability)
document.querySelector("#resume-text").addEventListener("input", updateDirectAIAvailability)
document.querySelector("#open-import-button").addEventListener("click", () => {
  const panel = document.querySelector("#import-panel")
  panel.hidden = false
  document.querySelector("#open-import-button").setAttribute("aria-expanded", "true")
  document.querySelector("#import-url").focus()
})
document.querySelector("#close-import-button").addEventListener("click", () => {
  document.querySelector("#import-panel").hidden = true
  document.querySelector("#open-import-button").setAttribute("aria-expanded", "false")
  document.querySelector("#open-import-button").focus()
})

showPage(currentPage())
renderNavigation(fallbackPages)
loadDashboard()

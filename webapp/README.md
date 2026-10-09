# 本地 Web 控制台（开发中）

这是 T7.1-T7.10 的可运行切片，用于验证本地控制台、首次设置、目标解析、简历确认、职位导入、排名看板和 OpenAI 兼容 AI 匹配体验。

## 启动

在项目根目录执行：

```powershell
python webapp/server.py
```

或双击：

```text
webapp/start_web.bat
```

默认只绑定 `127.0.0.1:8765`，并自动打开浏览器。开发阶段如不希望自动打开浏览器：

```powershell
python webapp/server.py --no-browser
```

如果页面能看到“开始搜索”但点击后返回 `404 NOT_FOUND`，通常是浏览器加载了最新静态页面，而 8765 端口仍由旧的 Python 进程提供接口。结束旧 Web 进程后重新启动服务，再刷新页面：

```powershell
python webapp/server.py --port 8765 --no-browser
```

可用下面的请求确认路由已加载；正常结果是 `202 Accepted` 并返回任务 ID：

```powershell
curl.exe -i -X POST http://127.0.0.1:8765/api/search/start `
  -H "Content-Type: application/json" `
  --data-raw '{"query":"AI应用开发","cities":["杭州"],"platforms":["zhaopin-search"],"limit":10}'
```

## 当前能力

- 首页、导航、快捷操作和空状态页面。
- `/api/pages`：页面信息架构清单。
- `/api/dashboard`：不含个人正文的本地状态摘要。
- `/api/health`：Python/Bun/猎聘 CLI 可用性和安全边界摘要。
- `/api/setup`、`/api/setup/draft`、`/api/setup/confirm`：本地设置草稿读取、保存和确认。
- `/api/setup/parse`：本地规则解析一句话求职目标，仅返回待确认建议。
- `/api/resume/parse`、`/api/resume/confirm`：UTF-8 文本简历识别和本地确认草稿。
- `/api/resume/parse-file`：本地解析文本、DOCX 或 PDF（PDF 需要可选 `pypdf`），不上传文件。
- `/api/resume/profile-preview`、`/api/resume/profile-confirm`：预览并明确确认后，将已确认简历字段映射到 canonical 候选人资料；写入前保留 `.bak` 备份。
- `/api/setup/completeness`、`/api/setup/templates`、`/api/setup/history`：阶段完整度、中文目标模板和最近设置恢复。
- `/api/search/start`：用户主动启动智联/猎聘只读搜索任务；BOSS/51job 返回人工导入提示。
- `/api/tasks/{id}`、`/api/tasks/{id}/cancel`：搜索和排名任务状态、进度及安全取消标记。
- `/api/rank`、`/api/rank/status`、`/api/rank/run`：本地排名结果、准备状态和明确确认后的 AI 排名任务。
- `/api/tasks/history`：最近完成任务的本地元数据历史。
- `/api/ai/preview`：发送前的本地脱敏预览，不接受 URL 参数，不触发外部请求。
- `/api/audit`：查看最近本地操作元数据，不包含职位正文、简历正文或凭证。
- `/api/import/job`：BOSS/51job 职位 URL+正文人工导入和本地原文归档。
- `/api/ai/status`、`/api/ai/match`：OpenAI 兼容 Chat Completions 状态与显式确认后的 AI 匹配。
- 静态资源路径穿越防护。

当前版本仍不会自动执行平台授权、投递、私聊或候选人档案修改。Web 搜索和 AI 排名均为用户主动操作；搜索只调用已登记的只读 CLI，OpenAI 兼容 API 默认不发送，只有用户在页面明确确认后才会把本地职位和候选人资料发送到配置的外部服务。

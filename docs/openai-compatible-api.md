# OpenAI 兼容 API 接入说明

本项目通过标准 Chat Completions 协议接入 OpenAI 兼容服务。适用于 OpenAI 官方接口以及提供 `/v1/chat/completions` 的兼容网关或本地模型服务。

## 配置

仅从当前进程环境变量读取配置，不会把 API Key 写入项目文件、浏览器页面、URL 或日志：

| 变量 | 必填 | 说明 |
|---|---|---|
| `OPENAI_BASE_URL` | 否 | API 根地址，默认 `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 是 | 模型名称 |
| `OPENAI_API_KEY` | 是 | API Key；只在请求时使用 |
| `OPENAI_TIMEOUT` | 否 | 请求超时秒数，范围 5-180，默认 60 |

Windows PowerShell 示例（请替换为你自己的值，不要提交到 Git）：

```powershell
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_MODEL = "<your-model>"
$env:OPENAI_API_KEY = "<your-api-key>"
python webapp/server.py --no-browser
```

## Web 使用流程

1. 打开本地 Web 的“匹配结果”区域。
2. 确认“OpenAI 兼容 API”显示为“已配置”。
3. 在“导入一个职位”中粘贴职位正文，在“导入简历并确认”中粘贴候选人资料。
4. 点击“开始 AI 匹配”。页面会明确提示将发送哪些数据以及发送到 OpenAI 兼容 API。
5. 只有点击确认后，服务才会发起一次外部请求；取消时不会发送任何数据。

返回结果会经过严格 JSON 校验，展示综合分、技术/经验/行为/方向四维分数、地点与语言门禁、优势、差距和总结。结果不会自动写入 `seen_jobs.json`，也不会触发投递、私聊或候选人档案修改。

## 兼容性约束

- 只调用 `POST /chat/completions`。
- 模型需要返回 JSON 对象，包含四维分数和匹配说明字段。
- 不支持标准 Chat Completions 或返回非 JSON 时，页面会显示安全错误，不展示原始响应或凭证。
- 默认不发送外部请求；没有明确确认时，后端返回 `EXTERNAL_CONFIRMATION_REQUIRED`（HTTP 428）。

## 验证建议

首次验证请使用脱敏的职位正文和候选人资料，先执行：

```powershell
python -X utf8 -m unittest tests.test_webapp -q
```

然后在 Web 页面进行一次低风险请求，确认模型、费用、数据范围和返回字段均符合预期。真实服务验证完成前，开发台账中的 T7.10 保持“待验证”。

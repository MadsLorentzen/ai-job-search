# P1 功能验收清单

**版本：** 1.0.0  
**更新时间：** 2026-09-02

## 自动化已验证

- [x] Web 搜索任务创建、任务查询、失败状态和取消标记。
- [x] 搜索结果统一字段合并到 `seen_jobs.json`。
- [x] 排名任务需要 `confirm_external=true`，结果写回具体职位。
- [x] 排名按平台、状态、最低分和排序方式筛选。
- [x] 简历中文技能、工作年限、CET4/6、目标岗位/城市/薪资/办公方式识别。
- [x] TXT/MD、DOCX 本地解析；PDF 无可选依赖时给出明确提示。
- [x] 简历确认草稿到 canonical profile 的预览、确认和 `.bak` 备份。
- [x] 设置完整度、模板、最近输入历史和任务历史接口。
- [x] AI 输入长度限制、请求间隔、超时、兼容协议降级和脱敏预览。
- [x] 本地审计事件不记录正文、Token、Cookie、密码或验证码。

## 真实环境验收

- [ ] 用真实候选人资料完成 `/setup`，确认没有 `[YOUR_*]` 占位符。
- [ ] 智联低频执行一次 Web 搜索，确认职位进入状态文件。
- [ ] 猎聘完成官方授权后低频执行一次搜索，核对认证错误分类。
- [ ] BOSS/51job 使用真实详情页和复制正文完成导入、排名和原文归档。
- [ ] 配置 OpenAI 兼容服务后，页面确认一次单职位匹配，检查 JSON 降级和错误提示。
- [ ] 五名非技术用户完成“设置 → 搜索/导入 → 排名 → 查看原因”，记录失败点。

## 安全门禁

- [ ] 默认不发起平台或 AI 网络请求。
- [ ] 未经确认不向外部服务发送职位或候选人资料。
- [ ] 不自动投递、不自动私聊、不绕过登录、验证码或风控。
- [ ] 个人资料映射前展示变更预览，写入前保留备份。

## 运行命令

```powershell
python -X utf8 -m unittest discover -s tests -q
python -X utf8 -m py_compile webapp/server.py webapp/ai_provider.py
node --check webapp/static/app.js
python -X utf8 tools/security_guards.py
python -X utf8 tools/check_framework_version.py
git diff --check
```

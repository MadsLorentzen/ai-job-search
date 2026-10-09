# BOSS/51job 人工职位导入

## 用途

当 BOSS 直聘或前程无忧的登录、风控或页面脚本阻止只读抓取时，用户可以在自己的浏览器中复制职位正文，再将 URL 和本地文本导入项目。导入路径不访问招聘平台，不读取 Cookie、密码、验证码、Token 或浏览器会话，也不会投递、发消息或修改简历。

## 命令

```powershell
python tools/import_job.py --url "<职位详情 URL>" --text-file posting.txt
```

可选参数：

- `--portal auto|boss-search|51job-search`：默认根据 URL 主机名识别平台。
- `--state-file <path>`：测试或隔离运行时覆盖 `job_scraper/seen_jobs.json`。
- `--archive-dir <path>`：测试或隔离运行时覆盖 `documents/postings/`。
- `--format json|plain`：默认输出包含标准记录的 JSON。

URL 必须是 `http(s)` 职位详情页，不能是搜索/列表页，也不能带 `#fragment`。正文文件支持 UTF-8（含 BOM）和 GB18030。

## 输出与状态

成功后，原文保存为 `documents/postings/<公司> - <职位>.txt`，并在 `seen_jobs.json` 中新增或更新一条记录：

```json
{
  "portal": "boss-search",
  "source": "manual",
  "access_mode": "manual_import",
  "archive_path": "documents/postings/示例科技 - Python 后端工程师.txt"
}
```

同一详情 URL 再次导入时更新原记录，不产生重复条目，也不重置已有排名状态。不同平台的同名职位分别保存，避免覆盖任一原始链接或正文；发生同名文件冲突时，文件名追加 URL 哈希。解析是尽力而为的；即使标题或公司提取失败，原文也会先保存到 `manual-import-<hash>.txt` 并返回错误，不会静默丢失。

## 后续工作流

运行 `/rank` 时，`manual_import` 记录优先读取 `archive_path` 中的原文，再按统一评分规范处理。URL 仅作为来源证据和后续人工打开的链接；正文失效不会导致已归档内容消失。

# /apply-cn - 国内社招岗位申请

输入 `$ARGUMENTS` 可以是岗位 URL、完整 JD 或人工导入后的岗位 key。适用规则以 `.claude/skills/job-application-assistant/10-china-market.md` 为准。

## 1. 获取、校验和评估

复用 `/apply` Step 0 获取完整正文并运行 posting_guard；人工导入的 key 用 `python3 tools/china_jobs.py show '<key>'` 读取正文，不能重新从搜索摘要拼接。若来源尚不可读，请用户粘贴 JD。展示 integrity verdict；告警时展示 findings，让用户判断后再继续。

读取候选人档案和 `04-job-evaluation.md`，给出匹配评分、国内社招条件表、真实差距及需向 HR 确认的问题。资料不足先问关键缺项，不替用户编造经验。中国平台域名按第10章验证其为已知招聘渠道，不能把已知平台等同于雇主或岗位真实性已验证。

按照 `/apply` Step 1 的约定展示评估并确认是否继续生成材料；用户本次已明确要求生成时不重复询问。

## 2. 生成简历与沟通稿

按 `documents/README.md` 的命名规则确定 `<company>_<role>`。从 `templates/china-resume/example.json` 获取结构，写入 `cv/main_<company>_<role>.json`。事实仅来自 `01-candidate-profile.md`、`CLAUDE.md` 候选人部分和主简历；示例只是结构，不是事实来源。无需将完整主简历翻译为 LaTeX 后再生成中文版本。

生成 `documents/applications/<company>_<role>/outreach.md`，包括平台招呼、自我介绍和确认问题；不要发送。只有用户或岗位要求正式求职信时另行生成纯文本/HTML/PDF，文件名记录到 tracker；其他情况不创建占位求职信。

## 3. 独立审查

复用 `.claude/agents/application-reviewer.md` 的事实审查和公司调研规则，内联传入 JD、JSON 简历和沟通稿；明确本次使用国内规则、1-2页简历和可选求职信。reviewer 检查事实、个人与团队贡献、岗位针对性、中文自然度，不要求 moderncv/cover.cls，不添加无依据的“精通”或业绩数字。主 Agent 应用修订，新增确认事实写回候选人档案。

## 4. 渲染并检查最终文件

```bash
python3 tools/render_china_resume.py cv/main_<company>_<role>.json --out cv/main_<company>_<role>.html
```

首次使用先 `python3 -m pip install -r requirements-china.txt`。HTML 内嵌思源黑体的正文字符子集、单栏 A4、无远程资源；不依赖机器上的系统中文字体。浏览器打开可预览，通过「打印 → 另存为 PDF」，取消浏览器页眉页脚，缩放100%、纸张A4。可使用已安装的 Chrome/Chromium 导出；macOS 示例，路径必须替换为真实绝对路径：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --no-pdf-header-footer --print-to-pdf="/absolute/path/cv/main_<company>_<role>.pdf" "file:///absolute/path/cv/main_<company>_<role>.html"
```

导出后必须执行：

```bash
python3 tools/verify_pdf.py cv/main_<company>_<role>.pdf --min-chars 100 --contains '<真实姓名>' --contains '<真实邮箱>' --dump-text cv/main_<company>_<role>.txt
```

读取报告的实际页数，1或2页再运行 `--pages <实际页数>`；超出2页先调整内容。检查原始文本中的中文、日期、邮箱、电话、章节顺序和真实技能词。简体中文字间提取的排版空格需区分实际缺字与提取差异；不要把转义乱码当成合格。

渲染并逐页查看 PDF，检查中文字体、溢出、标题孤行、留白和跨页。上游 `verify_layout.py` 阈值针对 moderncv，不将其评分作为此 HTML 模板的硬性门槛。必要时在本模板上调整再导出。未安装浏览器或无法查看 PDF 时可交付 HTML 草稿，但必须写明 PDF/视觉验证未完成，不能声称最终 PDF 已验证。

## 5. 记录与交付

遵循 `/apply` Step 6b 的表头、匹配更新、状态和存档约定：新材料记 `drafted`，`cv_file` 指向实际生成的 PDF（只有 HTML 则写实际 HTML 并注明草稿），未生成求职信时 `cover_letter_file` 留空。存档清洗后的完整 JD及 guard 发现数量，不保存隐藏片段。不要将生成动作记为 `applied`。

列出简历源文件、HTML/PDF、沟通稿和 tracker 的真实路径，报告通过与未完成的检查、针对岗位的取舍及真实缺口。用户之后自行投递，或明确授权发送时才执行外发动作。

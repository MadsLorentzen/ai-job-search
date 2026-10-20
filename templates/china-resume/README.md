# 中文社招简历模板

`example.json` 仅演示字段结构，不代表用户履历。用 `tools/render_china_resume.py` 渲染，样式位于 `style.css`，浏览器打印为 A4 PDF；最终文件必须检查文字提取和实际页数。

字体来自 Adobe [Source Han Sans / 思源黑体](https://github.com/adobe-fonts/source-han-sans)，原始文件 `SubsetOTF/CN/SourceHanSansCN-Regular.otf`，下载自其 `release` 分支。随附的 [SIL Open Font License 1.1](fonts/OFL.txt) 适用于字体；项目 MIT 许可不替代字体许可。

- 原始字体 SHA-256：`e2bc8a2e7f37474b774fff8db758681ece40bb6947a90d571bce9dd60671a8e4`
- 原始字体大小：8,429,224 字节。
- 渲染时使用 fontTools 按正文实际字符生成子集，改名为 `ChinaResumeSans` 后内嵌到 HTML；保留原版权与许可元数据，不请求远程字体。
- 裁剪可以避免系统字体中汉字与部首共享字形时，浏览器生成错误的 PDF Unicode 映射，同时减小 HTML/PDF 体积。

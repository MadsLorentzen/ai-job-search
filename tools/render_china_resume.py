#!/usr/bin/env python3
"""将结构化中文简历渲染为可打印的 A4 HTML，不依赖 LaTeX 或在线服务。"""

import argparse
import base64
import html
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def embedded_font(data: dict) -> str:
    """按实际正文裁剪字体，避免共享字形的部首字符污染 PDF 的 Unicode 映射。"""
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError as exc:
        raise ValueError("中文简历需要 fonttools：python3 -m pip install -r requirements-china.txt") from exc
    font = TTFont(ROOT / "templates/china-resume/fonts/SourceHanSansCN-Regular.otf")
    options = subset.Options()
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
    sub = subset.Subsetter(options=options)
    sub.populate(text=json.dumps(data, ensure_ascii=False) + "求职意向： ·•")
    sub.subset(font)
    # 修改后的子集使用独立名称，遵守源字体保留名称条款。
    for record in font["name"].names:
        if record.nameID in (1, 3, 4, 6, 16):
            record.string = "ChinaResumeSans".encode(record.getEncoding())
    cff = font["CFF "].cff
    cff.fontNames = ["ChinaResumeSans"]
    cff.topDictIndex[0].FamilyName = "ChinaResumeSans"
    cff.topDictIndex[0].FullName = "ChinaResumeSans"
    output = io.BytesIO()
    font.save(output)
    font.close()
    return base64.b64encode(output.getvalue()).decode("ascii")


def render(data: dict) -> str:
    """只接受纯文本字段，统一转义后输出，避免材料中的 HTML 被执行。"""
    if not isinstance(data, dict):
        raise ValueError("简历必须是 JSON 对象")
    for field in ("name", "target_role"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ValueError(f"缺少必要字符串字段：{field}")
    def esc(value):
        if not isinstance(value, str):
            raise ValueError("简历中的文本字段必须是字符串")
        return html.escape(value, quote=True)

    contacts = data.get("contacts", [])
    sections = data.get("sections", [])
    if not isinstance(contacts, list) or not isinstance(sections, list) or not sections:
        raise ValueError("contacts 和 sections 必须是数组，sections 不能为空")
    body = []
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get("entries"), list):
            raise ValueError("每个章节必须包含 entries 数组")
        body.append(f'<section><h2>{esc(section.get("title", ""))}</h2>')
        for entry in section["entries"]:
            if not isinstance(entry, dict) or not isinstance(entry.get("bullets", []), list):
                raise ValueError("每个条目必须是对象，bullets 必须是数组")
            body.append('<article><header class="entry-heading"><h3>' + esc(entry.get("title", ""))
                        + '</h3><span>' + esc(entry.get("period", "")) + '</span></header>')
            if entry.get("subtitle"):
                body.append('<p class="subtitle">' + esc(entry["subtitle"]) + '</p>')
            body.append('<ul>' + ''.join('<li>' + esc(b) + '</li>' for b in entry.get("bullets", [])) + '</ul></article>')
        body.append('</section>')
    css = (ROOT / "templates/china-resume/style.css").read_text(encoding="utf-8")
    # 内嵌固定版本的思源黑体，跨机器预览不再依赖系统字体及其文字映射。
    css = ('@font-face{font-family:ChinaResume;src:url(data:font/otf;base64,'
           + embedded_font(data) + ') format("opentype");font-weight:400;}' + css)
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; font-src data:">'
            '<title>' + esc(data["name"]) + ' - ' + esc(data["target_role"]) + '</title><style>' + css
            + '</style></head><body><main><header class="identity"><h1>' + esc(data["name"])
            + '</h1><p class="target">求职意向：' + esc(data["target_role"]) + '</p><p>'
            + ' · '.join(esc(c) for c in contacts) + '</p></header>' + ''.join(body) + '</main></body></html>')


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.source.resolve() == args.out.resolve():
            raise ValueError("输出不能覆盖输入材料")
        content = render(json.loads(args.source.read_text(encoding="utf-8")))
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(content, encoding="utf-8")
        print(str(args.out))
        return 0
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

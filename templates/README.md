# Custom Templates

This folder holds user-registered LaTeX templates, managed by the `/add-template` command. The framework works out of the box with its stock templates (moderncv for CVs, `cover.cls` for cover letters) — this folder only gets content when you register your own.

## Layout

```
templates/
├── cv/
│   └── <template-name>/
│       ├── template.tex     # Profile-agnostic skeleton ([PLACEHOLDER] tokens)
│       ├── TEMPLATE.md      # Manifest: engine, fonts, page limit, style rules, pitfalls
│       ├── *.cls / *.sty    # Custom class/style files (if the template needs them)
│       └── fonts/           # Bundled font files (if not using system fonts)
└── cover_letters/
    └── <template-name>/
        └── (same layout)
```

## How it works

- `/add-template` interviews you for the template's instructions (compile engine, fonts, style rules, page limit), stores the files here, and runs a mandatory test compile before registering anything.
- Activating a template adds a managed block to `05-cv-templates.md` or `06-cover-letter-templates.md`, which is what `/apply` reads when drafting — no other wiring needed.
- `/add-template --list` shows registered templates; `/add-template --use <name>` switches; `/add-template --use default` reverts to the stock templates.

Templates are stored with `[PLACEHOLDER]` tokens instead of personal data, so they are safe to commit and share.

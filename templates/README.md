# Custom Templates

This folder holds user-registered templates (LaTeX, Typst, or any other toolchain with a declared compile command), managed by the `/add-template` command.

This fork also **ships official Typst templates** so new users can skip LaTeX:

```
templates/
├── cv/typst-modern/                 # shipped Typst CV (recommended for new users)
├── cover_letters/typst-modern/      # shipped Typst cover letter
├── cv/<your-template>/              # anything you register
└── cover_letters/<your-template>/
```

## Which engine should I use?

| | Typst (recommended) | LaTeX (stock default) |
|---|---|---|
| Who | New users, Windows, anyone tired of MiKTeX | Power users who already have a TeX install |
| Install | One binary (`winget install --id Typst.Typst`) | TeX Live / MacTeX / MiKTeX |
| Activate | `/add-template --use typst` | `/add-template --use default` |
| ATS text layer | Clean, single column | Good under lualatex; fontawesome icons add glyph noise |
| LLM breakage | Low (simple syntax) | Higher (`%` comments, `&` alignment, `\item [x]`) |

Stock LaTeX remains the out-of-the-box default so existing forks keep compiling. Activate Typst once; `/apply` then drafts `.typ` files.

## Layout of a registered template

```
templates/
├── cv/
│   └── <template-name>/
│       ├── template.<ext>  # Profile-agnostic skeleton ([PLACEHOLDER] tokens)
│       ├── TEMPLATE.md      # Manifest: source extension, compile command, fonts, page limit
│       ├── *.cls / *.sty    # Custom class/style files, or Typst packages
│       └── fonts/           # Bundled font files (if not using system/bundled fonts)
└── cover_letters/
    └── <template-name>/
        └── (same layout)
```

## How it works

- `/add-template` interviews you for the template's instructions, stores the files here, and runs a mandatory test compile before registering anything.
- `/add-template --use typst` activates the shipped Typst pair without that interview.
- Activating a template adds a managed block to `05-cv-templates.md` or `06-cover-letter-templates.md`, which is what `/apply` reads when drafting and compiling — no other wiring needed.
- `/add-template --list` shows registered templates; `/add-template --use <name>` switches; `/add-template --use default` reverts to the stock LaTeX templates.

Templates are stored with `[PLACEHOLDER]` tokens instead of personal data, so they are safe to commit and share.

## Moving a LaTeX CV to Typst

There is no automatic converter. Practical path:

1. `/add-template --use typst`
2. Copy facts from `01-candidate-profile.md` (not from the `.tex`) into the next `/apply` draft
3. Keep the LaTeX files; they are unused once the `ACTIVE-TEMPLATE` block points at Typst

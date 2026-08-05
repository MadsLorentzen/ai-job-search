# /import-ai-chat - Import Conversations From Other AI Tools

You are importing a conversation from another AI tool (Gemini, ChatGPT, Copilot, etc.) into this Claude Code workspace. The goal: make those past discussions searchable and automatically referenceable during future Claude sessions.

**Auto-discovery is already configured:** CLAUDE.md instructs Claude to check `ai-conversations/` on every technical question. Your job is to save the conversation in the right format so that mechanism works.

---

## Step 0: What the User Provides

The user may provide:
- A **file path** (e.g. `@gemini-export.md` or `/docs/chatgpt-history.json`)
- **Pasted text** — the conversation inline after the command
- **Both** — a file plus instructions about which topics matter most

If `$ARGUMENTS` is empty, ask:

> **Where's the conversation?**
>
> - **Paste it directly** after this message — just drop the whole thing in
> - **Point me to a file** — e.g. `@/path/to/export.md` or just the file path
> - **A directory** — I'll import every conversation file in it
>
> What's your source? Gemini? ChatGPT? Copilot? Something else?

Wait for the user to provide content. Do not make up stories about what "might" be in the export — if they haven't provided it yet, stop and wait.

---

## Step 1: Detect Source & Format

Once you have the content, figure out what you're looking at.

### Source detection (ask if unsure)

| Clue | Likely source |
|------|---------------|
| `## Gemini` or `**Gemini**:` in role labels | Gemini |
| `## ChatGPT` or `**ChatGPT**:` in role labels | ChatGPT |
| `## Copilot` or `**GitHub Copilot**:` | Copilot |
| `## Claude` or `**Claude**:` | Claude (another Claude session) |
| `## Assistant` or `## User` generic labels | Generic — ask |
| JSON with `"author": "assistant"` or `"role": "model"` | Ask which AI |

If source is ambiguous, ask the user:

> I see this conversation but I'm not sure which AI it's from. The role labels look like: `[show the actual labels found]`. Is this from Gemini, ChatGPT, Claude, Copilot, or something else?

### Format detection

Decide how to parse based on what you see:

- **Markdown with role headers** (`## You`, `## Gemini`) — most common. Parse alternating role blocks.
- **JSON array** (`[{"role": "user", "content": "..."}]`) — OpenAI/Anthropic API format
- **JSONL** (one JSON object per line) — some export tools
- **Plain text with prefixes** (`User: ...`, `Assistant: ...`)
- **Google Takeout JSON** — Gemini-specific nested format

If the format is unrecognizable, tell the user what you see and ask them to re-export in markdown.

---

## Step 2: Parse & Extract

### Size check (DO THIS FIRST)

Count the total messages (user + AI turns).

- **≤100 messages:** Full parse. Read everything carefully.
- **101–500 messages:** Parse in detail but summarize the middle third. Tell the user.
- **500+ messages:** Parse first 50 and last 50 messages in detail. Skim the middle via keyword extraction (grep for code blocks, decisions, "yes that worked", "I decided", "the answer is"). Tell the user you skimmed the middle and ask if any specific section needs deeper parsing.
- **10,000+ characters in a single message:** Truncate that message to first 2000 + last 1000 chars. Mark the truncation in the saved file with `[...truncated — original was N chars...]`.

### Duplicate detection

Before parsing, compute a content fingerprint: take the first user message (first 200 chars), the source, and the approximate date. Grep `ai-conversations/_index.json` for matching fingerprints. If you find an existing entry where:
- Same source AND same topic slug AND dates within 3 days → **ask**: "This looks like a conversation you already imported on [date]. Import again as a separate copy?"

If they say yes, append `-2` to the filename. If no, skip.

### Required metadata (ask if undetectable)

| Field | How to find it |
|-------|---------------|
| **Source AI** | From Step 1 detection (gemini, chatgpt, copilot, claude, other) |
| **Date** | From filename, export metadata, or first message timestamp. If unknown, use today. |
| **Topic** | Generate from the first 3 user messages — a kebab-case slug ≤40 chars, e.g. `python-async-debugging`, `react-component-design`. Use English for the slug even if the conversation is in another language. |
| **Language** | `en`, `zh`, `ja`, etc. — the conversation's primary language. Detect, don't ask unless truly ambiguous. |
| **Message count** | Count the user/AI turns |

### Key extractions

Before saving, read the full conversation and extract:

1. **A one-paragraph summary** (≤100 words, in the conversation's language) — what was the conversation about, end to end?
2. **Key decisions / conclusions** (the "highlights") — 3-7 bullet points. Things the user and AI agreed on, code decisions, design choices, answers that resolved a question. Write these as standalone sentences that make sense without the full conversation.
3. **Topics / keywords** — 5-15 lowercase terms, comma-separated. These power the search index. Include: programming languages, frameworks, tools, concepts, error types, and problem domains mentioned.
4. **Action items or open questions** — things the user said they'd do next, or questions the AI couldn't answer. Empty list is fine.
5. **Valuable facts for memory** — discrete facts a future AI session would benefit from knowing. Only flag these if they meet ALL criteria: (a) reusable across multiple future conversations, (b) not obvious from the user's public profile/codebase, (c) represents a decision or constraint, not just trivia. See Step 5 for the save-or-skip test.

---

## Step 3: Save the Conversation File

### Directory structure

```
ai-conversations/
├── INDEX.md                    ← human-readable index
├── _index.json                 ← machine-readable index (YOU must update alongside INDEX.md)
├── README.md                   ← folder documentation (do not touch — already exists)
├── gemini/
│   └── YYYY-MM-DD-topic.md
├── chatgpt/
│   └── YYYY-MM-DD-topic.md
├── copilot/
│   └── YYYY-MM-DD-topic.md
├── claude/
│   └── YYYY-MM-DD-topic.md
└── other/
    └── YYYY-MM-DD-topic.md
```

Create subdirectories as needed. Never overwrite existing files — if a file with the same name exists, append `-2`, `-3`, etc.

### Conversation file format

Each saved conversation MUST use this exact template:

```markdown
---
source: <gemini|chatgpt|copilot|claude|other>
date: YYYY-MM-DD
topic: <slug>
language: <iso-code>
summary: "<one paragraph in the conversation's language>"
keywords: [<comma-separated, lowercase English>]
messages: <count>
---

# <Source AI> Conversation — <Date> — <Topic>

> **Summary:** <one paragraph>
>
> **Key takeaways:**
> - <highlight 1>
> - <highlight 2>
> - ...

---

<clean markdown of the conversation with clear role labels>

## You
[message]

## <Source>
[message]
...
```

The frontmatter (between `---` delimiters) MUST be valid YAML. If the summary or highlights contain quotes, escape them or use single quotes. Multi-line summaries use `>-` block scalar.

Save to `ai-conversations/<source-folder>/<YYYY-MM-DD>-<topic>.md`.

---

## Step 4: Update Both Indexes

### 4a: Update `ai-conversations/INDEX.md`

Read it, append the new entry to the table (newest first), update the "Last updated" line. New conversation → new row. Existing row → update it.

### 4b: Update `ai-conversations/_index.json`

Read it. If it doesn't exist or is empty, create it from scratch. Append the new conversation to the `conversations` array, newest first. The JSON schema:

```json
{
  "updated": "<ISO timestamp>",
  "conversations": [
    {
      "source": "gemini",
      "date": "2026-08-05",
      "topic": "fastapi-async-pool-debugging",
      "file": "gemini/2026-08-05-fastapi-async-pool-debugging.md",
      "summary": "...",
      "keywords": ["python", "fastapi", "..."],
      "messages": 10,
      "highlights": ["...", "..."]
    }
  ]
}
```

Write the updated JSON (pretty-printed, 2-space indent). If the file doesn't exist, create it with the schema above and the first entry.

---

## Step 5: Save Key Facts to Memory (Apply the 3-Question Test)

Not every conversation deserves memory persistence. Apply this test to each "valuable fact" from Step 2:

1. **Would this fact change what I'd recommend in a future session?** (If no → skip)
2. **Could the user reasonably expect me to remember it without being told again?** (If no → skip)
3. **Is it already recorded in CLAUDE.md, the codebase, or an existing memory file?** (If yes → skip)

If all three YES → write a memory file. Otherwise, the INDEX.md entry + conversation file is sufficient.

When writing memory files: use `C:\Users\aw\.claude\projects\C--Users-aw\memory\<kebab-case-name>.md`. Each file gets:
- YAML frontmatter with `name`, `description`, `metadata.type` (use `project` for technical, `feedback` for preferences, `user` for personal facts)
- The body explaining the fact, **Why:** context, and **How to apply:** guidance
- Link to the source conversation file in backticks

Update `C:\Users\aw\.claude\projects\C--Users-aw\memory\MEMORY.md` with a one-line pointer for each new memory file.

---

## Step 6: Confirm

After saving, tell the user:

```
✓ Imported [N] messages from [source] → `ai-conversations/[source]/[filename].md`
✓ Updated: INDEX.md, _index.json
[M if applicable: ✓ Saved key facts to memory: [fact names]]

Automatic: Claude will now reference this conversation when you ask about [main topic keywords].
You can also ask explicitly: "Check my [source] conversations about [topic]."
```

**Do not** repeat the verbose usage instructions — the confirmation above is enough. The auto-discovery mechanism in CLAUDE.md handles the rest.

---

## Edge Cases (Preserved From Original)

- **Non-English conversations:** Preserve the original language in the body and summary. Use English for topic slug and keywords (for searchability). Set `language` in frontmatter.
- **Code-heavy conversations:** Preserve all code blocks exactly. Never truncate or reformat code. If a code block is >200 lines, add a `<!-- 200 lines of [language] -->` comment above it to help future readers orient.
- **Multi-file imports (directory):** Process each file independently, but batch the INDEX.md + _index.json update and memory writes at the end. Show a summary table.
- **Pasted text without clear role markers:** Ask the user to label where the AI responses start (e.g. "everything after `---AI---` is the AI"). Never guess — wrong role assignment makes the conversation useless for future reference.
- **Corrupted or truncated exports:** If the export appears cut off mid-sentence, note it in the summary: "(export appears truncated)". Save what you can.
- **Conversations with multiple AI sources:** If a single export file contains conversations with multiple AIs (rare), split into separate files, one per source.

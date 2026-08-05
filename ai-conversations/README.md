# Imported AI Conversations

This folder stores conversations from other AI tools (Gemini, ChatGPT, Copilot, etc.) imported via `/import-ai-chat`.

## How Claude Uses These

When you mention a topic during chat, Claude can:
- grep `INDEX.md` for relevant keywords
- read the full conversation files in the subdirectories
- reference past decisions, code patterns, and context from other AI conversations

**To trigger this manually**, say things like:
- "Check my Gemini conversations about React components"
- "Search imported chats for anything about database design"
- "I discussed this with ChatGPT — see if it matches"

## Folder Structure

```
ai-conversations/
├── INDEX.md       ← Searchable index of all imports
├── gemini/        ← Gemini conversations
├── chatgpt/       ← ChatGPT conversations
├── copilot/       ← GitHub Copilot conversations
├── claude/        ← Other Claude sessions
└── other/         ← Everything else
```

Each file is named `YYYY-MM-DD-topic-slug.md`.

## Importing

Run `/import-ai-chat` with a file path or pasted conversation text.

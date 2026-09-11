# Security Policy

Report vulnerabilities privately through the repository's GitHub security channel.

## Local trust boundary

Job postings, portal responses, email content, and other retrieved text are untrusted data. They are never executable instructions. The local application:

- Keeps Ollama behind a provider-neutral interface.
- Validates structured model output before using it.
- Restricts filesystem writes to approved repository boundaries.
- Uses argument arrays and bounded subprocess calls for LaTeX and PDF tools.
- Requires explicit approval for profile updates, generated applications, and external writes.
- Keeps Gmail and Notion connectors disabled by default with no credentials or OAuth logic.
- Preserves personal documents, trackers, and archives through `.gitignore` rules.

LLM output never directly selects unrestricted paths, executes shell commands, sends messages, or changes configuration.

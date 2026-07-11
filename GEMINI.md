# Using Gemini & Google Antigravity SDK (Addon Guide)

This guide explains how to use the job search agents and the application workspace with **Gemini models** and the **Google Antigravity (AGY) SDK** as a Python-based alternative or supplement to Claude Code.

---

## 1. Prerequisites

### Python & Virtual Environment
Ensure Python 3.10+ is installed. It is highly recommended to use a virtual environment:

```bash
# Create a virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### Install Google Antigravity SDK
Install the `google-antigravity` SDK and optional dependencies needed by the CLI tools:

```bash
pip install google-antigravity
```

### Set up API Credentials
To interact with Gemini, you need a Gemini API Key.
1. Get an API key from [Google AI Studio](https://aistudio.google.com/app/api-keys).
2. Set it as an environment variable or store it in your `.env` file in the repository root:

```bash
export GEMINI_API_KEY="your_api_key_here"
```

---

## 2. Dynamic Skill Loading

The job search portals (LinkedIn, Jobnet, Jobindex, etc.) are implemented under the [.agents/skills/](.agents/skills/) directory. Each folder contains a `SKILL.md` defining the skill metadata.

The Google Antigravity SDK automatically discovers these skills when pointed to the parent directory via `skills_paths` in your configuration.

### Programmatic Setup (Example)

Create a Python script (e.g., `gemini_search.py`) in the repository root:

```python
import os
import asyncio
from google.antigravity import Agent, LocalAgentConfig

async def main():
    # Verify API key is available
    if not os.environ.get("GEMINI_API_KEY"):
        print("Warning: GEMINI_API_KEY is not set. Please set the environment variable or pass it explicitly.")
    
    # Absolute path to the parent directory containing all search skills
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    skills_dir = os.path.join(workspace_dir, ".agents", "skills")
    
    config = LocalAgentConfig(
        model="gemini-3.5-flash",  # Default model for Google Antigravity
        skills_paths=[skills_dir],
        # Optionally customize instructions
        system_instructions="You are a helpful job search assistant. Help the user search for jobs and evaluate them."
    )
    
    async with Agent(config=config) as agent:
        print("Agent initialized. Type your query (e.g., 'search for python jobs in Copenhagen on linkedin-search') or 'exit' to quit.")
        while True:
            try:
                user_query = input("\nYou: ")
                if user_query.strip().lower() in ["exit", "quit"]:
                    break
                
                print("\nAgent thinking...", flush=True)
                response = await agent.chat(user_query)
                
                # Stream agent response
                async for chunk in response:
                    print(chunk, end="", flush=True)
                print()
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"\nError: {e}")

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 3. Running Job Search CLI Tools via Antigravity

Because the skills defined in [.agents/skills/](.agents/skills/) leverage Bun, you need Bun installed and the tool dependencies set up:

```bash
# Ensure Bun is installed (macOS/Linux)
curl -fsSL https://bun.sh/install | bash

# Install CLI dependencies (run from repo root)
for tool in jobbank-search jobdanmark-search jobindex-search jobnet-search linkedin-search freehire-search; do
  cd .agents/skills/$tool/cli && bun install && cd ../../../..
done
```

Once dependencies are installed, the Antigravity agent can execute commands specified in each skill's `allowed-tools` section:

* **LinkedIn Search:** `bun run .agents/skills/linkedin-search/cli/src/cli.ts search -l "Copenhagen" -q "Python"`
* **Freehire Tech Search:** `bun run .agents/skills/freehire-search/cli/src/cli.ts search -q "Data Science"`

---

## 4. Adapting the Application & Tailoring Workflow

The core CV and cover letter tailoring logic lives in [.claude/skills/job-application-assistant/](.claude/skills/job-application-assistant/). Gemini models are fully capable of reading these files and executing the exact same workflow:

1. **Job Fit Scoring:** Ask the agent to score a job description against your candidate profile ([01-candidate-profile.md](.claude/skills/job-application-assistant/01-candidate-profile.md)) using the rules in [04-job-evaluation.md](.claude/skills/job-application-assistant/04-job-evaluation.md).
2. **Drafting LaTeX CV & Cover Letters:** Ask the agent to tailor the stock templates under [cv/](cv/) and [cover_letters/](cover_letters/) while adhering to styling rules in [03-writing-style.md](.claude/skills/job-application-assistant/03-writing-style.md).
3. **Compilation Verification:** Prompt the agent to run the LaTeX build scripts and inspect compiling results. When referencing agentic coding in your CV/cover letters, you can prompt the agent to explicitly mention the tool of your choice (e.g. Google Antigravity SDK or Gemini).

---

## 5. Mapping Claude Code Commands to Conversational Prompts

Because the Google Antigravity SDK agent uses natural language interaction instead of hardcoded slash commands, you can invoke all workflows conversationally. Below is a mapping of the Claude Code slash commands to their equivalent conversational prompts for your Gemini agent.

| Claude Code Command | Conversational Prompt for Gemini / Antigravity Agent | What the Agent Will Do |
|:---|:---|:---|
| `/setup` | `"Run the setup interview to populate my profile"` <br>OR<br> `"Parse my CV/resume in documents/ and set up my profile"` | Reads materials in `documents/` or interviews you to populate [01-candidate-profile.md](.claude/skills/job-application-assistant/01-candidate-profile.md) and templates. |
| `/scrape` | `"Scrape matching jobs using the search skills"` <br>OR<br> `"Find job openings on LinkedIn in Copenhagen for Python developer"` | Executes local TS/Bun search scripts (like `linkedin-search`) to fetch live postings. |
| `/apply <url\|text>` | `"Evaluate and apply to this job posting: <URL or text>"` | Evaluates fit, drafts LaTeX CV & cover letter, reviews with second agent pass, and verifies PDF compile layout. |
| `/rank` | `"Rank the recently scraped job listings"` | Batch-scores all scraped postings to generate a short-list ranked by fit. |
| `/interview` | `"Help me prepare for my scheduled interview at <Company> for the <Role> position"` | Synthesizes a stage-specific prep pack, maps likely questions to your STAR list, and runs mock interview. |
| `/outcome` | `"Record the outcome of my application for <Company> - <Role> as <Status>"` | Archives application files into `documents/applications/` and updates the tracker. |
| `/expand` | `"Scan my public profiles (GitHub, portfolio, etc.) to expand my candidate profile"` | Enriches profile skills/coursework from linked external portfolio/repos. |
| `/upskill` | `"Analyze my skill gaps against the job postings I applied to"` | Evaluates current profile against roles, building a prioritized study plan with resources. |
| `/add-template` | `"Help me register a custom LaTeX CV template from cv/my_new_template.tex"` | Validates your template file structure, test-compiles it, and registers it. |
| `/add-portal` | `"I want to integrate a new job search portal at <URL>"` | Investigates the portal and scaffolds a new Bun search skill in `.agents/skills/`. |
| `/reset` | `"Reset my profile data"` | Wipes skill files back to stock placeholders. |

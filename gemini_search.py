#!/usr/bin/env python3
import os
import sys
import asyncio
from google.antigravity import Agent, LocalAgentConfig

async def run_agent(query: str = None):
    # Ensure API Key is present
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY environment variable is not set.")
        print("Please obtain an API key from https://aistudio.google.com/app/api-keys")
        print("Then set it with: export GEMINI_API_KEY='your-key'")
        sys.exit(1)
        
    # Resolve the absolute path of the search skills directory
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    skills_dir = os.path.join(workspace_dir, ".agents", "skills")
    
    # Configure the Antigravity agent to load workspace search skills
    config = LocalAgentConfig(
        model="gemini-3.5-flash",  # Default model for Antigravity SDK
        skills_paths=[skills_dir],
        system_instructions=(
            "You are a helpful, precise job search assistant. You have access to "
            "various job search tools (like linkedin-search, freehire-search, jobindex-search, etc.) "
            "located in the workspace. Use them to search for job postings when the user asks, "
            "and format the results clearly."
        )
    )
    
    async with Agent(config=config) as agent:
        if query:
            # Run one-off query from CLI arguments
            print(f"User: {query}")
            print("\nAgent thinking...", flush=True)
            try:
                response = await agent.chat(query)
                async for chunk in response:
                    print(chunk, end="", flush=True)
                print()
            except Exception as e:
                print(f"\nError executing query: {e}")
        else:
            # Interactive chat loop
            print("=== Gemini & Antigravity Job Search Agent ===")
            print(f"Skills loaded from: {skills_dir}")
            print("Type your query (e.g. 'search for python jobs in Copenhagen on linkedin-search')")
            print("Type 'exit' or 'quit' to end the session.\n")
            
            while True:
                try:
                    user_query = input("You: ").strip()
                    if not user_query:
                        continue
                    if user_query.lower() in ["exit", "quit"]:
                        print("Goodbye!")
                        break
                    
                    print("\nAgent thinking...", flush=True)
                    response = await agent.chat(user_query)
                    
                    print("Agent: ", end="")
                    async for chunk in response:
                        print(chunk, end="", flush=True)
                    print("\n")
                except KeyboardInterrupt:
                    print("\nGoodbye!")
                    break
                except Exception as e:
                    print(f"\nError: {e}\n")

if __name__ == "__main__":
    # If a query is passed in command line arguments, execute it, otherwise start interactive mode
    cli_query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else None
    try:
        asyncio.run(run_agent(cli_query))
    except KeyboardInterrupt:
        pass

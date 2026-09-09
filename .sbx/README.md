# Docker Sandboxes harness

This directory is the [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) (`sbx`) harness for the AI Job Search workspace. It declares a repeatable sandbox so an AI coding agent can work on the repo in an isolated microVM: its own filesystem, network, and Docker daemon, with the project mounted as the workspace.

The environment file names the sandbox `ai-job-search` and launches [Claude Code](https://docs.docker.com/ai/sandboxes/agents/claude-code/) (`agent: claude`). The local mixin kit installs all required tools during the initial sandbox creation and adds them to the PATH for every sandbox shell. On the first run, you should issue the command "_Check if all necessary tools are installed_" to verify the setup. Since official Docker sandboxes can sometimes be slightly outdated, you may need to restart the sandbox shortly after its first launch once any automatic updates have completed.

| File | Role |
|------|------|
| [`sbxenv.yaml`](sbxenv.yaml) | Project environment: sandbox name, agent, workspace (`..` = repo root), kits |
| [`kit/spec.yaml`](kit/spec.yaml) | Mixin kit applied at sandbox creation (bun install is the first step) |

`sbxenv.yaml` lives next to the kit rather than in the repo root so the harness stays in one place. Docker Sandboxes mounts that file read-only inside the sandbox.

## Documentation

- [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/)
- [Install the `sbx` CLI](https://docs.docker.com/ai/sandboxes/install/)
- [Get started](https://docs.docker.com/ai/sandboxes/get-started/)
- [Environment files (`sbxenv.yaml`)](https://docs.docker.com/ai/sandboxes/configuration/environment-files/)
- [Kits](https://docs.docker.com/ai/sandboxes/customize/kits/) and [kit spec reference](https://docs.docker.com/ai/sandboxes/customize/kit-reference/)
- [Supported agents](https://docs.docker.com/ai/sandboxes/agents/)
- [`sbx env run`](https://docs.docker.com/reference/cli/sbx/env/run/) and [`sbx run`](https://docs.docker.com/reference/cli/sbx/run/)

## Prerequisites

1. Install `sbx` and sign in — see the [install guide](https://docs.docker.com/ai/sandboxes/install/).
2. Authenticate the agent. For Claude Code:

   ```bash
   sbx secret set anthropic
   ```

   Details: [Claude Code in Docker Sandboxes](https://docs.docker.com/ai/sandboxes/agents/claude-code/).

## Create and run

From the **repository root** (the directory that contains `.sbx`):

```bash
# Preview what will be created (no changes)
sbx env plan .sbx

# Create the sandbox, apply the kit, do not attach
sbx env create .sbx

# Create if needed, then attach to Claude Code
sbx env run .sbx
```

`sbx` shows an environment plan and asks for approval before the first apply. Pass `-y` / `--auto-approve` to skip the prompt for that invocation.

The workspace is the repository root. Later `sbx env run .sbx` reattaches to the existing `ai-job-search` sandbox; kit install steps do not run again until you recreate it.

```bash
# Run a command in the existing environment (no lifecycle hooks).
# exec does not start a shell, so bun is not on PATH unless you wrap in bash
# (that sources /etc/sandbox-persistent.sh).
sbx env exec .sbx -- uname -a
sbx env exec .sbx -- bash -c 'bun --version'

# Interactive session; useful for tuning the environment
sbx env exec -it .sbx -- bash

# List sandboxes
sbx ls

# Remove the sandbox and its scoped resources
sbx env rm .sbx
```

After changing kits, ports, or `sandboxOptions`, remove and create again — those fields apply only at creation.

## Run without the environment file

`sbx env` has no `--agent` flag; the agent comes from `sbxenv.yaml`. To pass an agent on the command line, use `sbx run` / `sbx create`. The first argument is a built-in name or a `kind: sandbox` kit (local path, zip, git URL, or OCI ref). `--kit` adds mixins such as this project's kit:

```bash
sbx run claude . --kit ./.sbx/kit
sbx run ./path/to/my-agent/ . --kit ./.sbx/kit
```

Relative kit paths must start with `./` or `../`. A bare name is a built-in agent, not a local directory.

To change the env-file agent without editing `sbxenv.yaml`, merge a later file (`agent:` is a scalar, so the later file wins):

```bash
sbx env run .sbx ./override.sbxenv.yaml
```

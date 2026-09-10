---
name: cursor-cli-runtime
description: Cursor CLI print-mode flags, live model pass, cwd, jobs, auth, and how to enable plugin MCP or fall back to cursor-companion.mjs. Use for --model slugs, --mode ask, --force writes, or missing cursor_* tools.
---

# Cursor CLI runtime

The companion invokes print mode, not ACP:

```bash
agent -p --trust --approve-mcps --output-format json \
  --model <slug> [--mode ask|plan] [--force] [--resume <chatId>] \
  --workspace <cwd>
```

## Flags the companion always sets

- `-p` print mode (scripting path)
- `--trust` (headless-only; required)
- `--approve-mcps` so project MCP servers do not hang on approval
- `--output-format json` so `session_id` can be stored for `--resume`

## Mode and writes

- `cursor_ask`, `cursor_review`, `cursor_adversarial_review` → `--mode ask`, never `--force`
- `cursor_rescue` → agent mode (no `--mode ask`). `write=true` adds `--force`. Without `--force`, file changes are proposed and not applied.

Do not use `agent acp`. ACP blocks on `session/request_permission` and is for editor clients.

## Model pass

1. Discover live slugs with `cursor_models` (`agent --list-models`, fallback `agent models`).
2. Exact slugs pass through unchanged.
3. Short aliases resolve against the **live** catalog only: `composer`, `grok`, `opus`, `sonnet`, `gpt`/`sol`, `auto`.
4. Reject bracket syntax. Point at matching live slugs (`*-high`, `*-fast`).
5. If `model` is omitted, do not pass `--model` (account / `cli-config.json` default).
6. Optional `fast=true` remaps to a live `*-fast` sibling when one exists.

Cursor has no `--effort` flag. Reasoning and Fast are slug suffixes.

## cwd and plugin roots

Every tool needs `cwd`. Honor `PLUGIN_ROOT` / `PLUGIN_DATA` (and `CLAUDE_PLUGIN_*` aliases). Job state lives under `CURSOR_CODEX_PLUGIN_STATE` or a trusted `PLUGIN_DATA` whose basename is `cursor` / `cursor-*`. Do not share another plugin's job directory.

## Plugin MCP vs companion

Skills install with the plugin. Bundled MCP tools do not. Enable the server, then fully relaunch Codex:

```toml
[plugins."cursor@cursor-cli"]
enabled = true

[plugins."cursor@cursor-cli".mcp_servers.cursor]
enabled = true
default_tools_approval_mode = "prompt"
```

Check with `codex mcp list` and `/mcp`. `node` must be on PATH for the Codex process. If `cursor_*` tools are still missing, run the companion from this plugin (`../../scripts/cursor-companion.mjs` relative to `skills/cursor-routing/SKILL.md`, or `$PLUGIN_ROOT/scripts/cursor-companion.mjs`) as `node "$COMPANION" <command> --cwd <workspace> --json [flags] -- <prompt>`. Do not call `agent` directly. Do not pin a `~/.codex/plugins/cache/.../<version>/` path.

## Auth and binary

- Binary: `CURSOR_AGENT` / `AGENT_BIN`, then `cursor-agent`, `agent`, `~/.local/bin/agent`, `~/.cursor/bin/agent`. Prefer `cursor-agent` so another CLI named `agent` does not win.
- Install: `curl https://cursor.com/install -fsS | bash`
- Login: `agent login`, or `CURSOR_API_KEY` / `--api-key`. `CURSOR_AUTH_TOKEN` is also accepted.
- Probe: `cursor_setup` runs `agent status --format json` (or `whoami`)
- Permissions: deny lists in `~/.cursor/cli-config.json` or `<project>/.cursor/cli.json` win. The companion cannot override them.

## Jobs

`background=true` returns a job id immediately. Poll with `cursor_status`, read with `cursor_result`, stop with `cursor_cancel`. Results are written atomically (`result.json` via tmp+rename). A reaper marks jobs failed when the pid is dead and the result file is incomplete.

`resume` continues a prior Cursor `session_id`. `fresh=true` starts a new thread.

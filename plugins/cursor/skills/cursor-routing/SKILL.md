---
name: cursor-routing
description: Route Cursor CLI work to MCP tools, or the companion CLI when cursor_* tools are missing. Use for cursor_setup, cursor_ask, cursor_review, cursor_rescue, live models, auth, or job status.
---

# Cursor routing

Codex stays the host thread. Do not invent `$cursor:*` slash commands and do not call `agent` yourself. Prefer the bundled MCP tools. If those tools are **not in this session**, run the companion script instead of stopping.

Always pass the user's workspace absolute path as `cwd` (MCP) or `--cwd` (companion). The MCP server starts from the plugin cache, so omitting `cwd` reviews the wrong tree.

## Prefer MCP

If `cursor_setup`, `cursor_models`, `cursor_ask`, `cursor_review`, `cursor_adversarial_review`, `cursor_rescue`, `cursor_status`, `cursor_result`, or `cursor_cancel` are in the tool list, call them.

| Need | Tool |
| --- | --- |
| Binary missing, auth, first-run | `cursor_setup` |
| Live slugs / pick a model | `cursor_models` (`query` optional) |
| Read-only question, no edits | `cursor_ask` |
| Diff / PR review | `cursor_review` |
| Hostile second-pass review | `cursor_adversarial_review` |
| Implement / fix / apply writes | `cursor_rescue` (`write=true` to apply) |
| Background job poll | `cursor_status` |
| Fetch a finished job | `cursor_result` |
| Stop a job | `cursor_cancel` |

## Companion fallback

Use this when the `cursor_*` tools are missing (plugin skills loaded, MCP not approved, or Codex needs a full restart).

Companion path, in order:

1. `$PLUGIN_ROOT/scripts/cursor-companion.mjs`
2. This skill's plugin root: the directory that contains `skills/` and `scripts/`
3. Cache default: `~/.codex/plugins/cache/cursor-cli/cursor/0.1.2/scripts/cursor-companion.mjs`

```bash
node "$PLUGIN_ROOT/scripts/cursor-companion.mjs" <command> --cwd <workspace> --json [flags] [prompt]
```

| MCP tool | Companion command |
| --- | --- |
| `cursor_setup` | `setup --json --cwd <workspace>` |
| `cursor_models` | `models --json --cwd <workspace> --query <q>` |
| `cursor_ask` | `ask --json --cwd <workspace> [--model <slug>] -- <prompt>` |
| `cursor_review` | `review --json --cwd <workspace> [--model <slug>] [--base <ref>] [--scope auto\|working-tree\|branch] -- <focus>` |
| `cursor_adversarial_review` | `adversarial-review --json --cwd <workspace> ...` |
| `cursor_rescue` | `rescue --json --cwd <workspace> [--model <slug>] [--write] -- <prompt>` |
| `cursor_status` | `status --json --cwd <workspace> [<jobId>]` |
| `cursor_result` | `result --json --cwd <workspace> [<jobId>]` |
| `cursor_cancel` | `cancel --json --cwd <workspace> <jobId>` |

After a fallback run, tell the user how to load the MCP tools for next time:

```toml
[plugins."cursor@cursor-cli"]
enabled = true

[plugins."cursor@cursor-cli".mcp_servers.cursor]
enabled = true
default_tools_approval_mode = "prompt"
```

Then `codex mcp list`, fully quit and relaunch Codex (a new thread is often not enough), and approve the `cursor` plugin MCP server.

## Model

`model` is a first-class MCP argument and a `--model` flag on the companion. Pass a live slug from `cursor_models` / `models`, or a short alias (`composer`, `grok`, `opus`, `sonnet`, `gpt`/`sol`, `auto`). Do not pin dated IDs. Do not use `model[context=1m,effort=high]` — Cursor has no `--effort` flag.

## Examples

```text
cursor_models query="grok" cwd="/path/to/project"
cursor_review model="grok" base="main" cwd="/path/to/project"
cursor_rescue model="composer" write=true prompt="fix the failing auth test" cwd="/path/to/project"
```

---
name: cursor-routing
description: Route Cursor CLI work to MCP tools. Use when Codex should call cursor_setup, cursor_models, cursor_ask, cursor_review, cursor_adversarial_review, cursor_rescue, cursor_status, cursor_result, or cursor_cancel. Triggers on Cursor CLI, agent binary, print-mode review, rescue, live models, or job status.
---

# Cursor routing

Codex stays the host thread. Do not shell out to `agent` yourself and do not invent `$cursor:*` slash commands. Call the bundled MCP tools.

Always pass `cwd` as the user's workspace absolute path. The MCP process starts from the plugin cache, so omitting `cwd` reviews the wrong tree.

## Which tool

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

## Model

`model` is a first-class tool argument. Pass a live slug from `cursor_models`, or a short alias (`composer`, `grok`, `opus`, `sonnet`, `gpt`/`sol`, `auto`). Do not pin dated IDs. Do not use `model[context=1m,effort=high]` — Cursor has no `--effort` flag.

## Examples

```text
cursor_models query="grok" cwd="/path/to/project"
cursor_review model="grok" base="main" cwd="/path/to/project"
cursor_rescue model="composer" write=true prompt="fix the failing auth test" cwd="/path/to/project"
```

# Cursor CLI plugin for Codex

Codex stays the host thread. This plugin delegates reviews, questions, and rescue work to the local [Cursor CLI](https://cursor.com/cli) (`agent` / `cursor-agent`) through a bundled MCP server and companion.

Typed MCP tools are the API. Skills only tell Codex which tool to call. Cursor runs in **print mode**, not ACP.

## Install

From GitHub:

```bash
codex plugin marketplace add maplenk/codex-cursor-cli
codex plugin add cursor@cursor-cli
```

Or from a local checkout (paths in `marketplace.json` are relative to the repo root):

```bash
codex plugin marketplace add /path/to/this-repo
codex plugin add cursor@cursor-cli
```

Enable the plugin, then start a **new** Codex thread so the MCP server loads:

```toml
[plugins."cursor@cursor-cli"]
enabled = true
```

Ask Codex to call `cursor_setup`, or run the companion directly:

```bash
node plugins/cursor/scripts/cursor-companion.mjs setup
```

Cursor login is yours, not a plugin OAuth connect. Run `agent login` or set `CURSOR_API_KEY`. `CURSOR_AUTH_TOKEN` is also accepted.

Install the CLI if it is missing:

```bash
curl https://cursor.com/install -fsS | bash
```

The companion looks for `CURSOR_AGENT` / `AGENT_BIN`, then `agent`, `cursor-agent`, `~/.local/bin/agent`, and `~/.cursor/bin/agent`.

## Tools

Every tool should receive `cwd` (the workspace Codex is working in). The MCP process starts from the plugin cache, so omitting `cwd` points Cursor at the wrong tree.

| Tool | What it does |
| --- | --- |
| `cursor_setup` | Binary, version, auth, live model probe |
| `cursor_models` | Live slugs from `agent --list-models` (optional `query`) |
| `cursor_ask` | Read-only question (`--mode ask`, no `--force`) |
| `cursor_review` | Read-only review of the working tree or branch |
| `cursor_adversarial_review` | Hostile second-pass review |
| `cursor_rescue` | Agent mode; `write=true` adds `--force` |
| `cursor_status` / `cursor_result` / `cursor_cancel` | Background jobs |

Examples:

```text
cursor_models query="grok" cwd="/path/to/project"
cursor_review model="grok" base="main" cwd="/path/to/project"
cursor_rescue model="composer-2.5" write=true prompt="fix the failing auth test" cwd="/path/to/project"
```

## Model pass

Headless invoke:

```bash
agent -p --trust --approve-mcps --output-format json \
  --model <slug> [--mode ask|plan] [--force] [--resume <chatId>] \
  --workspace <cwd>
```

- Discovery: `agent --list-models`, then `agent models`. Parse `id - Display Name`.
- Exact slugs pass through. Short aliases (`composer`, `grok`, `opus`, `sonnet`, `gpt`/`sol`, `auto`) resolve against the **live** catalog only.
- Bracket syntax (`model[context=1m,effort=high]`) is rejected. Cursor has no `--effort` flag; reasoning and Fast are slug suffixes (`*-high`, `*-fast`).
- If `model` is omitted, `--model` is not passed (account / `cli-config.json` default).
- Do not pin dated model IDs. `cursor_models` is the catalog.

`--approve-mcps` avoids hanging on project MCP approval. `--trust` is required in print mode. Reviews and ask never pass `--force`. Rescue needs `write=true` to apply edits. User deny lists in `~/.cursor/cli-config.json` or `<project>/.cursor/cli.json` still win.

## Local development

Requires Node.js 18.18+.

```bash
npm test
node plugins/cursor/scripts/cursor-companion.mjs setup
node plugins/cursor/scripts/cursor-companion.mjs models --query grok
```

Job state lives under `CURSOR_CODEX_PLUGIN_STATE`, or a trusted `PLUGIN_DATA` whose basename is `cursor` / `cursor-*`, otherwise `~/.cursor/codex-plugin/state`. Results are written atomically (`result.json` via tmp+rename). A reaper fails jobs whose pid is dead and whose result file is incomplete.

## Layout

- `.agents/plugins/marketplace.json` — marketplace `cursor-cli`, plugin path `./plugins/cursor`
- `plugins/cursor/plugin.json` — portable Agent Plugins manifest plus `extensions.com.openai`
- `plugins/cursor/.codex-plugin/plugin.json` — older Codex CLI fallback
- `plugins/cursor/.mcp.json` — NDJSON MCP server (`node ./mcp/server.mjs`)
- `plugins/cursor/scripts/cursor-companion.mjs` — print-mode companion
- `plugins/cursor/skills/` — routing, runtime, and prompting only

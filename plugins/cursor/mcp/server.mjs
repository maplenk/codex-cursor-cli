#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER_VERSION = "0.1.2";
const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPANION = path.join(ROOT_DIR, "scripts", "cursor-companion.mjs");

const stringSchema = (description) => ({ type: "string", description });
const booleanSchema = (description) => ({ type: "boolean", description });

const WORKSPACE_PROPERTY = {
  cwd: stringSchema(
    "Workspace or repository path for this call. Pass the active Codex project path when the plugin runs from its install cache."
  )
};

const COMMON_JOB_PROPERTIES = {
  ...WORKSPACE_PROPERTY,
  model: stringSchema(
    "Cursor model slug or short alias (composer, grok, opus, sonnet, gpt, sol, auto). Resolved against `agent --list-models`. Do not use bracket syntax."
  ),
  fast: booleanSchema("Prefer a live *-fast sibling of the selected model when one exists."),
  background: booleanSchema("Start a background job and return the job id."),
  resume: booleanSchema("Resume the latest Cursor session recorded for this workspace."),
  resumeSession: stringSchema("Resume a specific Cursor session / chat id."),
  json: booleanSchema("Return machine-readable JSON from the companion.")
};

const TOOL_DEFINITIONS = [
  {
    name: "cursor_setup",
    description:
      "Check Cursor CLI availability, authentication (agent login or CURSOR_API_KEY), and live model listing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...WORKSPACE_PROPERTY,
        json: booleanSchema("Return machine-readable JSON from the companion.")
      }
    }
  },
  {
    name: "cursor_models",
    description:
      "List Cursor CLI models available to this account. Optional query filters slugs and labels.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...WORKSPACE_PROPERTY,
        query: stringSchema("Optional filter such as grok, composer, or opus."),
        json: booleanSchema("Return machine-readable JSON from the companion.")
      }
    }
  },
  {
    name: "cursor_ask",
    description: "Ask the local Cursor CLI a read-only question (--mode ask, no --force).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: stringSchema("Question or investigation for Cursor."),
        ...COMMON_JOB_PROPERTIES
      }
    }
  },
  {
    name: "cursor_review",
    description:
      "Read-only Cursor review of the working tree or branch. Uses --mode ask and never applies patches.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        focus: stringSchema("Optional review focus, such as auth or race conditions."),
        prompt: stringSchema("Optional extra review instructions (alias of focus)."),
        base: stringSchema("Base git ref for branch review."),
        scope: stringSchema("Review scope: auto, working-tree, or branch."),
        ...COMMON_JOB_PROPERTIES
      }
    }
  },
  {
    name: "cursor_adversarial_review",
    description:
      "Read-only Cursor review that challenges design, tradeoffs, and hidden assumptions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        focus: stringSchema("Assumptions Cursor should challenge."),
        prompt: stringSchema("Optional extra instructions (alias of focus)."),
        base: stringSchema("Base git ref for branch review."),
        scope: stringSchema("Review scope: auto, working-tree, or branch."),
        ...COMMON_JOB_PROPERTIES
      }
    }
  },
  {
    name: "cursor_rescue",
    description:
      "Delegate investigation or implementation to Cursor CLI. Pass write=true to apply edits with --force.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: stringSchema("The task for Cursor to investigate or implement."),
        write: booleanSchema("Allow file changes by passing --force to Cursor print mode."),
        fresh: booleanSchema("Start a new Cursor session instead of resuming."),
        ...COMMON_JOB_PROPERTIES
      }
    }
  },
  {
    name: "cursor_status",
    description: "Show active and recent Cursor jobs for this workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...WORKSPACE_PROPERTY,
        jobId: stringSchema("Specific job id to inspect."),
        all: booleanSchema("Include older jobs, not only the recent default window."),
        json: booleanSchema("Return machine-readable JSON from the companion.")
      }
    }
  },
  {
    name: "cursor_result",
    description: "Read the stored result for a completed Cursor job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        ...WORKSPACE_PROPERTY,
        jobId: stringSchema("Specific job id. Omit only when there is one unambiguous recent job."),
        json: booleanSchema("Return machine-readable JSON from the companion.")
      }
    }
  },
  {
    name: "cursor_cancel",
    description: "Cancel a running Cursor background job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["jobId"],
      properties: {
        ...WORKSPACE_PROPERTY,
        jobId: stringSchema("Job id to cancel."),
        json: booleanSchema("Return machine-readable JSON from the companion.")
      }
    }
  }
];

const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

export function resolveMcpCwd(input = {}) {
  const requested = hasValue(input.cwd) ? String(input.cwd) : process.cwd();
  const cwd = path.resolve(requested);
  let stats;
  try {
    stats = fs.statSync(cwd);
  } catch {
    throw new Error(`Workspace directory does not exist: ${cwd}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${cwd}`);
  }
  return cwd;
}

function pushFlag(args, condition, flag) {
  if (condition) {
    args.push(flag);
  }
}

function pushValue(args, value, flag) {
  if (hasValue(value)) {
    args.push(flag, String(value));
  }
}

function appendCommonArgs(args, input) {
  pushValue(args, input.model, "--model");
  pushFlag(args, input.fast, "--fast");
  pushFlag(args, input.background, "--background");
  if (hasValue(input.resumeSession)) {
    pushValue(args, input.resumeSession, "--resume-session");
  } else {
    pushFlag(args, input.resume, "--resume");
  }
  pushFlag(args, input.json, "--json");
}

export function listToolDefinitions() {
  return TOOL_DEFINITIONS.map((tool) => ({ ...tool }));
}

export function buildCompanionInvocation(toolName, input = {}) {
  if (!TOOL_MAP.has(toolName)) {
    throw new Error(`Unknown Cursor tool: ${toolName}`);
  }

  const args = [];
  const positionals = [];
  switch (toolName) {
    case "cursor_setup":
      args.push("setup");
      pushFlag(args, input.json, "--json");
      break;
    case "cursor_models":
      args.push("models");
      pushValue(args, input.query, "--query");
      pushFlag(args, input.json, "--json");
      break;
    case "cursor_ask":
      args.push("ask");
      appendCommonArgs(args, input);
      if (hasValue(input.prompt)) {
        positionals.push(String(input.prompt));
      }
      break;
    case "cursor_review":
      args.push("review");
      appendCommonArgs(args, input);
      pushValue(args, input.base, "--base");
      pushValue(args, input.scope, "--scope");
      if (hasValue(input.focus) || hasValue(input.prompt)) {
        positionals.push(String(input.focus || input.prompt));
      }
      break;
    case "cursor_adversarial_review":
      args.push("adversarial-review");
      appendCommonArgs(args, input);
      pushValue(args, input.base, "--base");
      pushValue(args, input.scope, "--scope");
      if (hasValue(input.focus) || hasValue(input.prompt)) {
        positionals.push(String(input.focus || input.prompt));
      }
      break;
    case "cursor_rescue":
      args.push("rescue");
      appendCommonArgs(args, input);
      pushFlag(args, input.write, "--write");
      pushFlag(args, input.fresh, "--fresh");
      if (hasValue(input.prompt)) {
        positionals.push(String(input.prompt));
      }
      break;
    case "cursor_status":
      args.push("status");
      pushFlag(args, input.all, "--all");
      pushFlag(args, input.json, "--json");
      if (hasValue(input.jobId)) {
        positionals.push(String(input.jobId));
      }
      break;
    case "cursor_result":
      args.push("result");
      pushFlag(args, input.json, "--json");
      if (hasValue(input.jobId)) {
        positionals.push(String(input.jobId));
      }
      break;
    case "cursor_cancel":
      args.push("cancel");
      pushFlag(args, input.json, "--json");
      if (hasValue(input.jobId)) {
        positionals.push(String(input.jobId));
      }
      break;
  }

  if (hasValue(input.cwd)) {
    args.push("--cwd", path.resolve(String(input.cwd)));
  }

  // Keep prompts and job IDs from being consumed as flag values or options.
  if (positionals.length) {
    args.push("--", ...positionals);
  }

  return { command: args[0], args, cwd: hasValue(input.cwd) ? path.resolve(String(input.cwd)) : undefined };
}

export function runCompanion(toolName, input = {}) {
  const cwd = resolveMcpCwd(input);
  const { args } = buildCompanionInvocation(toolName, { ...input, cwd });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [COMPANION, ...args], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }]
      });
    });
    child.on("close", (code) => {
      finish({
        isError: code !== 0,
        content: [{ type: "text", text: stdout || stderr || `cursor companion exited with code ${code}` }]
      });
    });
  });
}

function sendMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(message) {
  const id = message.id;
  try {
    switch (message.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: message.params?.protocolVersion || "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "cursor-in-codex", version: SERVER_VERSION }
          }
        };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: listToolDefinitions() } };
      case "tools/call": {
        const name = message.params?.name;
        const input = message.params?.arguments || {};
        const result = await runCompanion(name, input);
        return { jsonrpc: "2.0", id, result };
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      default:
        if (id === undefined || id === null) {
          return null;
        }
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown method: ${message.method}` }
        };
    }
  } catch (error) {
    if (id === undefined || id === null) {
      return null;
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
    };
  }
}

function startStdioServer() {
  const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });
  lines.on("line", (line) => {
    if (line.trim().length === 0) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method === undefined && message.id !== undefined) {
      return;
    }
    void handleRequest(message).then((response) => {
      if (response) {
        sendMessage(response);
      }
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startStdioServer();
}

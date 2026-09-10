import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAgentArgv } from "../plugins/cursor/scripts/lib/invoke.mjs";

const COMPANION = fileURLToPath(new URL("../plugins/cursor/scripts/cursor-companion.mjs", import.meta.url));
const FAKE_AGENT = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));

function runCompanion(args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [COMPANION, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function isolatedWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-e2e-"));
  fs.chmodSync(FAKE_AGENT, 0o755);
  const record = path.join(root, "agent-argv.json");
  const env = {
    ...process.env,
    CURSOR_AGENT: FAKE_AGENT,
    CURSOR_CODEX_PLUGIN_STATE: path.join(root, "state"),
    FAKE_AGENT_RECORD: record,
    PLUGIN_DATA: path.join(root, "untrusted-grok-data")
  };
  return { root, record, env };
}

test("buildAgentArgv is print-mode with trust, mcp approval, and optional model", () => {
  assert.deepEqual(buildAgentArgv({ workspace: "/repo" }), [
    "-p",
    "--trust",
    "--approve-mcps",
    "--output-format",
    "json",
    "--workspace",
    "/repo"
  ]);
  assert.deepEqual(
    buildAgentArgv({
      model: "grok-4.6",
      mode: "ask",
      workspace: "/repo",
      prompt: "hello"
    }),
    [
      "-p",
      "--trust",
      "--approve-mcps",
      "--output-format",
      "json",
      "--model",
      "grok-4.6",
      "--mode",
      "ask",
      "--workspace",
      "/repo",
      "hello"
    ]
  );
  assert.ok(
    buildAgentArgv({ force: true, mode: undefined, prompt: "fix it" }).includes("--force")
  );
});

test("companion setup probes the fake agent", async () => {
  const { root, env } = isolatedWorkspace();
  const result = await runCompanion(["setup", "--json", "--cwd", root], env, root);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.binary, FAKE_AGENT);
  assert.equal(report.version, "1.2.3");
  assert.equal(report.authenticated, true);
  assert.equal(report.modelsOk, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("companion ask resolves a live alias and records print-mode argv", async () => {
  const { root, record, env } = isolatedWorkspace();
  const result = await runCompanion(
    ["ask", "--json", "--model", "grok", "--cwd", root, "what broke in auth?"],
    env,
    root
  );
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.sessionId, "sess_fake_123");
  assert.equal(payload.model, "grok-4.6-high");
  assert.match(payload.result, /fake-agent handled print mode with grok-4.6-high/);

  const recorded = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.ok(recorded.argv.includes("-p"));
  assert.ok(recorded.argv.includes("--trust"));
  assert.ok(recorded.argv.includes("--approve-mcps"));
  assert.deepEqual(recorded.argv.slice(recorded.argv.indexOf("--output-format"), recorded.argv.indexOf("--output-format") + 2), [
    "--output-format",
    "json"
  ]);
  assert.ok(recorded.argv.includes("--mode"));
  assert.ok(recorded.argv.includes("ask"));
  assert.ok(!recorded.argv.includes("--force"));
  assert.equal(recorded.argv[recorded.argv.indexOf("--model") + 1], "grok-4.6-high");
  assert.equal(recorded.argv[recorded.argv.indexOf("--workspace") + 1], root);
  fs.rmSync(root, { recursive: true, force: true });
});

test("companion rescue --write adds --force and keeps agent mode", async () => {
  const { root, record, env } = isolatedWorkspace();
  const result = await runCompanion(
    ["rescue", "--json", "--write", "--model", "composer-2.5", "--cwd", root, "fix the failing auth test"],
    env,
    root
  );
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.model, "composer-2.5");
  const recorded = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.ok(recorded.argv.includes("--force"));
  assert.ok(!recorded.argv.includes("--mode"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("companion rejects bracket model syntax", async () => {
  const { root, env } = isolatedWorkspace();
  const result = await runCompanion(
    ["ask", "--json", "--model", "grok[effort=high]", "--cwd", root, "hello"],
    env,
    root
  );
  assert.notEqual(result.code, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /bracket syntax/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("companion models filters the live catalog", async () => {
  const { root, env } = isolatedWorkspace();
  const result = await runCompanion(["models", "--json", "--query", "grok", "--cwd", root], env, root);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.models.some((model) => model.id === "grok-4.6"));
  assert.ok(payload.models.every((model) => model.id.includes("grok") || String(model.label).toLowerCase().includes("grok")));
  fs.rmSync(root, { recursive: true, force: true });
});

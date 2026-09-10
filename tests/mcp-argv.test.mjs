import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCompanionInvocation, resolveMcpCwd } from "../plugins/cursor/mcp/server.mjs";

test("buildCompanionInvocation forwards model, cwd, and review flags", () => {
  const cwd = "/tmp/example-project";
  const invocation = buildCompanionInvocation("cursor_review", {
    model: "grok",
    base: "main",
    scope: "branch",
    focus: "auth",
    cwd,
    json: true
  });

  assert.equal(invocation.command, "review");
  assert.deepEqual(invocation.args, [
    "review",
    "--model",
    "grok",
    "--json",
    "--base",
    "main",
    "--scope",
    "branch",
    "--cwd",
    path.resolve(cwd),
    "--",
    "auth"
  ]);
  assert.equal(invocation.cwd, path.resolve(cwd));
});

test("buildCompanionInvocation omits --model when model is absent", () => {
  const invocation = buildCompanionInvocation("cursor_ask", {
    prompt: "what broke?",
    cwd: "/tmp/example-project"
  });
  assert.ok(!invocation.args.includes("--model"));
  assert.ok(invocation.args.includes("what broke?"));
  assert.ok(invocation.args.includes("--cwd"));
});

test("buildCompanionInvocation maps rescue write and resume session", () => {
  const invocation = buildCompanionInvocation("cursor_rescue", {
    prompt: "fix the failing auth test",
    write: true,
    fresh: true,
    resumeSession: "sess_123",
    model: "composer-2.5",
    cwd: "/workspace"
  });
  assert.deepEqual(invocation.args, [
    "rescue",
    "--model",
    "composer-2.5",
    "--resume-session",
    "sess_123",
    "--write",
    "--fresh",
    "--cwd",
    path.resolve("/workspace"),
    "--",
    "fix the failing auth test"
  ]);
});

test("resolveMcpCwd requires an existing directory", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-mcp-cwd-"));
  assert.equal(resolveMcpCwd({ cwd }), path.resolve(cwd));
  assert.throws(
    () => resolveMcpCwd({ cwd: path.join(cwd, "missing-subdir") }),
    /does not exist/
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

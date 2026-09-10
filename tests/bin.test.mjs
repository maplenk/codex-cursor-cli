import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { candidateBinaries, resolveCursorBinary } from "../plugins/cursor/scripts/lib/bin.mjs";
import { resolveStateRoot } from "../plugins/cursor/scripts/lib/jobs.mjs";

function makeExecutable(filePath, contents = "#!/bin/sh\nexit 0\n") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

test("CURSOR_AGENT wins over PATH names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-bin-"));
  const explicit = makeExecutable(path.join(root, "explicit-agent"));
  const pathAgent = makeExecutable(path.join(root, "bin", "agent"));
  const resolved = resolveCursorBinary({
    CURSOR_AGENT: explicit,
    PATH: path.dirname(pathAgent)
  });
  assert.equal(resolved, explicit);
  fs.rmSync(root, { recursive: true, force: true });
});

test("AGENT_BIN is consulted when CURSOR_AGENT is unset", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-bin-"));
  const named = makeExecutable(path.join(root, "named-agent"));
  const resolved = resolveCursorBinary({
    AGENT_BIN: named,
    PATH: ""
  });
  assert.equal(resolved, named);
  fs.rmSync(root, { recursive: true, force: true });
});

test("bare agent is resolved from PATH", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-bin-"));
  const pathAgent = makeExecutable(path.join(root, "agent"));
  const resolved = resolveCursorBinary({
    PATH: root
  });
  assert.equal(resolved, pathAgent);
  fs.rmSync(root, { recursive: true, force: true });
});

test("cursor-agent wins when another CLI owns agent earlier on PATH", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-bin-"));
  try {
    const otherAgent = makeExecutable(path.join(root, "grok", "agent"));
    const cursorAgent = makeExecutable(path.join(root, "cursor", "cursor-agent"));
    const resolved = resolveCursorBinary({
      PATH: [path.dirname(otherAgent), path.dirname(cursorAgent)].join(path.delimiter)
    });
    assert.equal(resolved, cursorAgent);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("candidate list includes documented install locations", () => {
  const candidates = candidateBinaries({});
  assert.ok(candidates.includes("agent"));
  assert.ok(candidates.includes("cursor-agent"));
  assert.ok(candidates.some((item) => item.endsWith(path.join(".local", "bin", "agent"))));
  assert.ok(candidates.some((item) => item.endsWith(path.join(".cursor", "bin", "agent"))));
});

test("untrusted PLUGIN_DATA is not used as the job state root", () => {
  const foreign = path.join(os.tmpdir(), "grok-in-codex");
  const trusted = path.join(os.tmpdir(), "cursor-cli");
  assert.notEqual(
    resolveStateRoot({ PLUGIN_DATA: foreign }),
    path.resolve(foreign)
  );
  assert.equal(resolveStateRoot({ PLUGIN_DATA: trusted }), path.resolve(trusted));
  assert.equal(
    resolveStateRoot({ CURSOR_CODEX_PLUGIN_STATE: "/tmp/cursor-state" }),
    path.resolve("/tmp/cursor-state")
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createJobRecord,
  isCompleteResult,
  jobDir,
  loadJob,
  reapJob,
  readJson,
  saveJob,
  writeJsonAtomic
} from "../plugins/cursor/scripts/lib/jobs.mjs";

function isolatedEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-jobs-"));
  return { root, env: { CURSOR_CODEX_PLUGIN_STATE: root } };
}

test("writeJsonAtomic replaces the destination via tmp+rename", () => {
  const { root } = isolatedEnv();
  const target = path.join(root, "result.json");
  writeJsonAtomic(target, { jobId: "ask-1", status: "ok" });
  writeJsonAtomic(target, { jobId: "ask-1", status: "ok", result: "done" });
  const parsed = readJson(target);
  assert.equal(parsed.result, "done");
  const leftovers = fs.readdirSync(root).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("reaper leaves a live pid untouched", () => {
  const { root, env } = isolatedEnv();
  const cwd = root;
  const job = createJobRecord({
    id: "ask-live",
    command: "ask",
    cwd,
    status: "running",
    pid: process.pid
  });
  saveJob(cwd, job, env);
  const next = reapJob(cwd, job, env);
  assert.equal(next.status, "running");
  fs.rmSync(root, { recursive: true, force: true });
});

test("reaper promotes a complete result.json when the pid is dead", () => {
  const { root, env } = isolatedEnv();
  const cwd = root;
  const job = createJobRecord({
    id: "ask-done",
    command: "ask",
    cwd,
    status: "running",
    pid: 999_999_991
  });
  saveJob(cwd, job, env);
  writeJsonAtomic(path.join(jobDir(cwd, job.id, env), "result.json"), {
    jobId: job.id,
    status: "ok",
    result: "shipped",
    finishedAt: "2026-09-10T00:00:00.000Z"
  });
  const next = reapJob(cwd, job, env);
  assert.equal(next.status, "completed");
  assert.equal(loadJob(cwd, job.id, env).status, "completed");
  fs.rmSync(root, { recursive: true, force: true });
});

test("reaper fails a dead pid with an incomplete result file", () => {
  const { root, env } = isolatedEnv();
  const cwd = root;
  const job = createJobRecord({
    id: "ask-dead",
    command: "ask",
    cwd,
    status: "running",
    pid: 999_999_992
  });
  saveJob(cwd, job, env);
  writeJsonAtomic(path.join(jobDir(cwd, job.id, env), "result.json"), { partial: true });
  assert.equal(isCompleteResult(readJson(path.join(jobDir(cwd, job.id, env), "result.json"))), false);
  const next = reapJob(cwd, job, env);
  assert.equal(next.status, "failed");
  assert.match(next.error, /exited without a complete result.json/);
  const result = readJson(path.join(jobDir(cwd, job.id, env), "result.json"));
  assert.equal(result.status, "error");
  fs.rmSync(root, { recursive: true, force: true });
});

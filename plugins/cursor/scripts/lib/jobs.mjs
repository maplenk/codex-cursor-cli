import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPidAlive } from "./bin.mjs";

const TRUSTED_DATA_NAMES = /^(cursor|cursor-cli|cursor-in-codex)(-|$)/i;

export function resolveStateRoot(env = process.env) {
  if (env.CURSOR_CODEX_PLUGIN_STATE) {
    return path.resolve(env.CURSOR_CODEX_PLUGIN_STATE);
  }
  for (const key of ["PLUGIN_DATA", "CODEX_PLUGIN_DATA", "CLAUDE_PLUGIN_DATA"]) {
    const value = env[key];
    if (!value) {
      continue;
    }
    const base = path.basename(path.resolve(value));
    if (TRUSTED_DATA_NAMES.test(base)) {
      return path.resolve(value);
    }
  }
  return path.join(os.homedir(), ".cursor", "codex-plugin", "state");
}

export function workspaceKey(cwd) {
  const resolved = path.resolve(cwd || process.cwd());
  const digest = crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  return digest;
}

export function jobsDir(cwd, env = process.env) {
  return path.join(resolveStateRoot(env), workspaceKey(cwd), "jobs");
}

export function createJobId(command) {
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${command}-${suffix}`;
}

export function jobDir(cwd, jobId, env = process.env) {
  return path.join(jobsDir(cwd, env), jobId);
}

export function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

export function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function isCompleteResult(result) {
  return Boolean(result && typeof result === "object" && result.status && result.jobId);
}

export function createJobRecord(input) {
  const now = new Date().toISOString();
  return {
    id: input.id,
    command: input.command,
    status: input.status || "queued",
    pid: input.pid || null,
    cwd: path.resolve(input.cwd || process.cwd()),
    createdAt: now,
    startedAt: input.startedAt || now,
    finishedAt: null,
    sessionId: null,
    model: input.model || null,
    prompt: input.prompt || "",
    argv: input.argv || []
  };
}

export function saveJob(cwd, job, env = process.env) {
  const directory = jobDir(cwd, job.id, env);
  fs.mkdirSync(directory, { recursive: true });
  writeJsonAtomic(path.join(directory, "job.json"), job);
  return directory;
}

export function loadJob(cwd, jobId, env = process.env) {
  return readJson(path.join(jobDir(cwd, jobId, env), "job.json"));
}

export function listJobs(cwd, env = process.env) {
  const root = jobsDir(cwd, env);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root)
    .map((id) => loadJob(cwd, id, env))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function reapJob(cwd, job, env = process.env) {
  if (!job || job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return job;
  }
  if (job.pid && isPidAlive(job.pid)) {
    return job;
  }
  const result = readJson(path.join(jobDir(cwd, job.id, env), "result.json"));
  if (isCompleteResult(result)) {
    const next = {
      ...job,
      status: result.status === "ok" ? "completed" : "failed",
      finishedAt: result.finishedAt || new Date().toISOString(),
      sessionId: result.sessionId || job.sessionId
    };
    saveJob(cwd, next, env);
    return next;
  }
  const next = {
    ...job,
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: "Process exited without a complete result.json"
  };
  saveJob(cwd, next, env);
  writeJsonAtomic(path.join(jobDir(cwd, job.id, env), "result.json"), {
    jobId: job.id,
    status: "error",
    error: next.error,
    finishedAt: next.finishedAt
  });
  return next;
}

export function latestFinishedJob(cwd, env = process.env) {
  return listJobs(cwd, env)
    .map((job) => reapJob(cwd, job, env))
    .find((job) => job.status === "completed" || job.status === "failed");
}

export function cancelJob(cwd, jobId, env = process.env) {
  const job = loadJob(cwd, jobId, env);
  if (!job) {
    return { ok: false, error: `Unknown job ${jobId}` };
  }
  if (job.pid && isPidAlive(job.pid)) {
    try {
      process.kill(job.pid, "SIGTERM");
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  const next = {
    ...job,
    status: "cancelled",
    finishedAt: new Date().toISOString()
  };
  saveJob(cwd, next, env);
  return { ok: true, job: next };
}

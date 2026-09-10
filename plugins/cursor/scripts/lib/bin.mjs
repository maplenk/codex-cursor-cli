import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const HOME = os.homedir();

export function candidateBinaries(env = process.env) {
  const explicit = [env.CURSOR_AGENT, env.AGENT_BIN].filter(Boolean);
  return [
    ...explicit,
    "agent",
    "cursor-agent",
    path.join(HOME, ".local", "bin", "agent"),
    path.join(HOME, ".cursor", "bin", "agent"),
    path.join(HOME, ".local", "bin", "cursor-agent"),
    path.join(HOME, ".cursor", "bin", "cursor-agent")
  ];
}

function isExecutableFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function lookOnPath(name, env = process.env) {
  const pathValue = env.PATH || env.Path || "";
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveCursorBinary(env = process.env) {
  for (const candidate of candidateBinaries(env)) {
    if (!candidate) {
      continue;
    }
    if (candidate.includes(path.sep) || path.isAbsolute(candidate)) {
      if (isExecutableFile(candidate)) {
        return candidate;
      }
      continue;
    }
    const fromPath = lookOnPath(candidate, env);
    if (fromPath) {
      return fromPath;
    }
  }
  return null;
}

export function runCommand(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    timeoutMs = 30_000,
    input = null,
    extraPath = []
  } = options;

  const childEnv = { ...env };
  if (extraPath.length > 0) {
    childEnv.PATH = [...extraPath, childEnv.PATH || ""].filter(Boolean).join(path.delimiter);
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        code: 124,
        signal: "SIGTERM",
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(),
        timedOut: true
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        code: 127,
        signal: null,
        stdout,
        stderr: error.message,
        timedOut: false,
        error
      });
    });
    child.on("close", (code, signal) => {
      finish({
        code: code ?? 1,
        signal,
        stdout,
        stderr,
        timedOut: false
      });
    });

    if (input != null) {
      child.stdin.end(String(input));
    } else {
      child.stdin.end();
    }
  });
}

export function spawnDetached(command, args, options = {}) {
  const { cwd = process.cwd(), env = process.env, stdoutPath, stderrPath } = options;
  const stdout = stdoutPath ? fs.openSync(stdoutPath, "a") : "ignore";
  const stderr = stderrPath ? fs.openSync(stderrPath, "a") : "ignore";
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", stdout, stderr]
  });
  child.unref();
  if (typeof stdout === "number") {
    fs.closeSync(stdout);
  }
  if (typeof stderr === "number") {
    fs.closeSync(stderr);
  }
  return child.pid;
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

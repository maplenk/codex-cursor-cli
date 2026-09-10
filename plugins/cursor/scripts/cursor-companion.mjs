#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flagValue, hasFlag, parseArgs } from "./lib/args.mjs";
import { resolveCursorBinary, runCommand, spawnDetached } from "./lib/bin.mjs";
import { collectReviewContext, renderReviewBrief } from "./lib/git.mjs";
import { buildAgentArgv, promptFromFileInstruction, shouldSpillPrompt } from "./lib/invoke.mjs";
import {
  cancelJob,
  createJobId,
  createJobRecord,
  jobDir,
  latestFinishedJob,
  listJobs,
  loadJob,
  reapJob,
  saveJob,
  writeJsonAtomic
} from "./lib/jobs.mjs";
import { filterModels, formatModelCatalog, parseCursorModelsOutput, resolveModelSelection } from "./lib/models.mjs";
import { extractPrintResult, printHuman, printJson, renderJob, renderJobList, renderSetup } from "./lib/render.mjs";

const COMMANDS = new Set([
  "setup",
  "models",
  "ask",
  "review",
  "adversarial-review",
  "rescue",
  "status",
  "result",
  "cancel"
]);

export async function listLiveModels(binary, cwd, env = process.env) {
  const attempts = [
    ["--list-models"],
    ["models"]
  ];
  let last = { stdout: "", stderr: "", code: 1 };
  for (const args of attempts) {
    const result = await runCommand(binary, args, { cwd, env, timeoutMs: 20_000 });
    last = result;
    const models = parseCursorModelsOutput(result.stdout, result.stderr);
    if (models.length > 0) {
      return { ok: true, models, raw: result };
    }
  }
  return { ok: false, models: [], raw: last };
}

export async function resolveRequestedModel(binary, cwd, rawModel, options = {}, env = process.env) {
  if (!rawModel && !options.fast) {
    return { ok: true, model: undefined, source: "default" };
  }
  const listed = await listLiveModels(binary, cwd, env);
  if (!listed.ok && rawModel) {
    if (rawModel.includes("[")) {
      return resolveModelSelection(rawModel, [], options);
    }
    return {
      ok: true,
      model: rawModel,
      source: "passthrough",
      warning: "Could not refresh the live Cursor model catalog; passing --model through unchanged."
    };
  }
  return resolveModelSelection(rawModel || "", listed.models, options);
}

async function probeAuth(binary, cwd, env = process.env) {
  if (env.CURSOR_API_KEY || env.CURSOR_AUTH_TOKEN) {
    return { authenticated: true, account: env.CURSOR_API_KEY ? "CURSOR_API_KEY" : "CURSOR_AUTH_TOKEN" };
  }
  for (const args of [["status", "--format", "json"], ["whoami", "--format", "json"], ["status"], ["whoami"]]) {
    const result = await runCommand(binary, args, { cwd, env, timeoutMs: 15_000 });
    const text = `${result.stdout}\n${result.stderr}`;
    if (/not (logged in|authenticated)|unauthenticated|login required/i.test(text) && result.code !== 0) {
      continue;
    }
    if (result.code === 0) {
      let account = "";
      try {
        const parsed = JSON.parse(result.stdout.trim());
        account = parsed.email || parsed.account || parsed.user || parsed.username || "";
        const authenticated =
          parsed.authenticated === true ||
          parsed.loggedIn === true ||
          Boolean(account) ||
          parsed.status === "ok";
        if (authenticated || result.stdout.trim()) {
          return { authenticated: authenticated || Boolean(result.stdout.trim()), account };
        }
      } catch {
        if (/logged in|authenticated|email|@/.test(text)) {
          return { authenticated: true, account: result.stdout.trim().split("\n")[0] };
        }
        if (result.stdout.trim()) {
          return { authenticated: true, account: result.stdout.trim().split("\n")[0] };
        }
      }
    }
  }
  return { authenticated: false, account: "" };
}

export async function runSetup(cwd, env = process.env) {
  const binary = resolveCursorBinary(env);
  const notes = [];
  if (!binary) {
    notes.push("Install Cursor CLI: curl https://cursor.com/install -fsS | bash");
    notes.push("Then add ~/.local/bin (or ~/.cursor/bin) to PATH and run `agent login`.");
    return {
      ok: false,
      binary: null,
      version: null,
      authenticated: false,
      modelsOk: false,
      notes
    };
  }
  const versionResult = await runCommand(binary, ["--version"], { cwd, env, timeoutMs: 10_000 });
  const version = (versionResult.stdout || versionResult.stderr).trim().split("\n")[0] || null;
  const auth = await probeAuth(binary, cwd, env);
  if (!auth.authenticated) {
    notes.push("Not authenticated. Run `agent login` or set CURSOR_API_KEY.");
  }
  const models = await listLiveModels(binary, cwd, env);
  if (!models.ok) {
    notes.push("Could not list models. `agent --list-models` may require login.");
  }
  notes.push("Print-mode runs use --trust --approve-mcps. Reviews use --mode ask. Rescue --write adds --force.");
  notes.push("User deny rules in ~/.cursor/cli-config.json still apply.");
  return {
    ok: Boolean(binary) && auth.authenticated,
    binary,
    version,
    authenticated: auth.authenticated,
    account: auth.account,
    modelsOk: models.ok,
    modelsCount: models.models.length,
    notes
  };
}

function resolveResumeId(cwd, env, flags) {
  const explicit = flagValue(flags, "resumeSession");
  if (explicit) {
    return explicit;
  }
  const resumeFlag = flags.resume;
  if (hasFlag(flags, "fresh") || resumeFlag === undefined || resumeFlag === false) {
    return undefined;
  }
  if (typeof resumeFlag === "string" && resumeFlag !== "true") {
    return resumeFlag;
  }
  const jobs = listJobs(cwd, env);
  return jobs.find((job) => job.sessionId)?.sessionId;
}

function usage() {
  return [
    "Usage: cursor-companion.mjs <command> [flags] [prompt]",
    "Commands: setup, models, ask, review, adversarial-review, rescue, status, result, cancel",
    "Common flags: --model <slug|alias> --fast --json --background --resume <id>"
  ].join("\n");
}

async function preparePrompt(command, flags, positionals, cwd) {
  const promptFile = flagValue(flags, "promptFile");
  if (promptFile) {
    return fs.readFileSync(path.resolve(cwd, promptFile), "utf8");
  }
  const extra = positionals.join(" ").trim();
  if (command === "review" || command === "adversarial-review") {
    const context = await collectReviewContext(cwd, {
      scope: flagValue(flags, "scope", "auto"),
      base: flagValue(flags, "base")
    });
    return renderReviewBrief(command, context, extra || flagValue(flags, "focus", ""));
  }
  if (!extra && command !== "setup" && command !== "models" && command !== "status" && command !== "result") {
    throw new Error(`Missing prompt for ${command}`);
  }
  return extra;
}

async function runAgentJob(options) {
  const {
    command,
    cwd,
    env,
    flags,
    prompt,
    background,
    json
  } = options;
  const binary = resolveCursorBinary(env);
  if (!binary) {
    throw new Error("Cursor CLI not found. Install with `curl https://cursor.com/install -fsS | bash`.");
  }

  const modelResolution = await resolveRequestedModel(
    binary,
    cwd,
    flagValue(flags, "model"),
    { fast: hasFlag(flags, "fast") },
    env
  );
  if (!modelResolution.ok) {
    throw new Error(modelResolution.error);
  }

  const write = command === "rescue" && (hasFlag(flags, "write") || flagValue(flags, "write") === "true");
  const mode = command === "rescue" ? undefined : "ask";
  const resumeId = resolveResumeId(cwd, env, flags);

  let promptText = prompt;
  const jobId = flagValue(flags, "jobId") || createJobId(command);
  const directory = jobDir(cwd, jobId, env);
  fs.mkdirSync(directory, { recursive: true });

  if (shouldSpillPrompt(promptText)) {
    const promptPath = path.join(directory, "prompt.txt");
    fs.writeFileSync(promptPath, promptText);
    promptText = promptFromFileInstruction(promptPath);
  }

  const agentArgs = buildAgentArgv({
    model: modelResolution.model,
    mode,
    force: write,
    resume: resumeId || (hasFlag(flags, "continue") ? "-1" : undefined),
    workspace: cwd,
    prompt: promptText
  });

  const job = createJobRecord({
    id: jobId,
    command,
    cwd,
    model: modelResolution.model,
    prompt,
    argv: [binary, ...agentArgs],
    status: background ? "running" : "running"
  });
  saveJob(cwd, job, env);

  if (background && !flagValue(flags, "jobId")) {
    const promptPath = path.join(directory, "prompt.txt");
    fs.writeFileSync(promptPath, prompt);
    const workerArgs = [fileURLToPath(import.meta.url), command];
    if (modelResolution.model) {
      workerArgs.push("--model", modelResolution.model);
    }
    if (hasFlag(flags, "fast")) {
      workerArgs.push("--fast");
    }
    if (write) {
      workerArgs.push("--write");
    }
    if (resumeId) {
      workerArgs.push("--resume-session", resumeId);
    }
    workerArgs.push("--prompt-file", promptPath, "--job-id", jobId, "--json", "--cwd", cwd);
    const pid = spawnDetached(process.execPath, workerArgs, {
      cwd,
      env,
      stdoutPath: path.join(directory, "stdout.log"),
      stderrPath: path.join(directory, "stderr.log")
    });
    job.pid = pid;
    saveJob(cwd, job, env);
    const payload = {
      jobId,
      status: "running",
      model: modelResolution.model || null,
      warning: modelResolution.warning
    };
    return json ? payload : `Started background job ${jobId}${modelResolution.model ? ` with --model ${modelResolution.model}` : ""}.`;
  }

  const timeoutMs = Number(flagValue(flags, "timeoutMs", 15 * 60 * 1000));
  const result = await runCommand(binary, agentArgs, { cwd, env, timeoutMs, input: null });
  const extracted = extractPrintResult(result.stdout);
  const finishedAt = new Date().toISOString();
  const ok = result.code === 0;
  const payload = {
    jobId,
    status: ok ? "ok" : "error",
    code: result.code,
    model: modelResolution.model || extracted.raw?.model || null,
    sessionId: extracted.sessionId,
    result: extracted.result || result.stdout.trim(),
    stderr: result.stderr.trim() || undefined,
    warning: modelResolution.warning,
    finishedAt
  };
  writeJsonAtomic(path.join(directory, "result.json"), payload);
  saveJob(
    cwd,
    {
      ...job,
      status: ok ? "completed" : "failed",
      sessionId: extracted.sessionId,
      finishedAt,
      error: ok ? undefined : result.stderr.trim() || `exit ${result.code}`
    },
    env
  );
  if (!ok && !json) {
    throw new Error(payload.stderr || payload.result || `Cursor CLI exited ${result.code}`);
  }
  return json ? payload : renderJob({ ...job, status: payload.status === "ok" ? "completed" : "failed", sessionId: payload.sessionId, model: payload.model, finishedAt }, payload);
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    printHuman(usage());
    return 0;
  }
  const command = argv[0];
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command ${command}\n${usage()}`);
  }
  const { flags, positionals } = parseArgs(argv.slice(1));
  const json = hasFlag(flags, "json");
  const requestedCwd = flagValue(flags, "cwd");
  if (requestedCwd) {
    const resolved = path.resolve(requestedCwd);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Workspace directory does not exist: ${resolved}`);
    }
    cwd = resolved;
  }

  if (command === "setup") {
    const report = await runSetup(cwd, env);
    if (json) {
      printJson(report);
    } else {
      printHuman(renderSetup(report));
    }
    return report.ok ? 0 : 1;
  }

  if (command === "models") {
    const binary = resolveCursorBinary(env);
    if (!binary) {
      throw new Error("Cursor CLI not found. Install with `curl https://cursor.com/install -fsS | bash`.");
    }
    const listed = await listLiveModels(binary, cwd, env);
    const query = flagValue(flags, "query", positionals[0] || "");
    const models = filterModels(listed.models, query);
    const text = formatModelCatalog(listed.models, query);
    if (json) {
      printJson({ ok: listed.ok, query, models, text });
    } else {
      printHuman(text);
    }
    return listed.ok || listed.models.length > 0 ? 0 : 1;
  }

  if (command === "status") {
    const jobId = flagValue(flags, "jobId", positionals[0]);
    if (jobId) {
      const job = reapJob(cwd, loadJob(cwd, jobId, env), env);
      if (!job) {
        throw new Error(`Unknown job ${jobId}`);
      }
      const result = fs.existsSync(path.join(jobDir(cwd, job.id, env), "result.json"))
        ? JSON.parse(fs.readFileSync(path.join(jobDir(cwd, job.id, env), "result.json"), "utf8"))
        : null;
      if (json) {
        printJson({ job, result });
      } else {
        printHuman(renderJob(job, result));
      }
      return 0;
    }
    const jobs = listJobs(cwd, env).map((job) => reapJob(cwd, job, env));
    const visible = hasFlag(flags, "all") ? jobs : jobs.slice(0, 20);
    if (json) {
      printJson({ jobs: visible });
    } else {
      printHuman(renderJobList(visible));
    }
    return 0;
  }

  if (command === "result") {
    const jobId = flagValue(flags, "jobId", positionals[0]);
    const job = jobId ? reapJob(cwd, loadJob(cwd, jobId, env), env) : latestFinishedJob(cwd, env);
    if (!job) {
      throw new Error(jobId ? `Unknown job ${jobId}` : "No finished Cursor job in this workspace.");
    }
    const resultPath = path.join(jobDir(cwd, job.id, env), "result.json");
    const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
    if (json) {
      printJson({ job, result });
    } else {
      printHuman(renderJob(job, result));
    }
    return job.status === "failed" ? 1 : 0;
  }

  if (command === "cancel") {
    const jobId = flagValue(flags, "jobId", positionals[0]);
    if (!jobId) {
      throw new Error("cancel requires a job id");
    }
    const cancelled = cancelJob(cwd, jobId, env);
    if (!cancelled.ok) {
      throw new Error(cancelled.error);
    }
    if (json) {
      printJson(cancelled);
    } else {
      printHuman(`Cancelled ${cancelled.job.id}`);
    }
    return 0;
  }

  const prompt = await preparePrompt(command, flags, positionals, cwd);
  const output = await runAgentJob({
    command,
    cwd,
    env,
    flags,
    prompt,
    background: hasFlag(flags, "background"),
    json
  });
  if (json) {
    printJson(output);
  } else {
    printHuman(typeof output === "string" ? output : JSON.stringify(output, null, 2));
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exit(code);
  }).catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exit(1);
  });
}

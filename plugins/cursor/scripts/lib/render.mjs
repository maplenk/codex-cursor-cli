export function printHuman(text) {
  process.stdout.write(`${text.endsWith("\n") ? text : `${text}\n`}`);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function renderSetup(report) {
  const lines = [
    `Cursor binary: ${report.binary || "not found"}`,
    `Version: ${report.version || "unknown"}`,
    `Authenticated: ${report.authenticated ? "yes" : "no"}`,
    report.account ? `Account: ${report.account}` : "",
    `Models reachable: ${report.modelsOk ? "yes" : "no"}`,
    report.modelsCount != null ? `Model count: ${report.modelsCount}` : "",
    ...(report.notes || [])
  ].filter(Boolean);
  return lines.join("\n");
}

export function renderJob(job, result) {
  const lines = [
    `Job: ${job.id}`,
    `Command: ${job.command}`,
    `Status: ${job.status}`,
    job.model ? `Model: ${job.model}` : "",
    job.sessionId ? `Cursor session: ${job.sessionId}` : "",
    job.pid ? `PID: ${job.pid}` : "",
    `Cwd: ${job.cwd}`,
    `Created: ${job.createdAt}`,
    job.finishedAt ? `Finished: ${job.finishedAt}` : ""
  ].filter(Boolean);
  if (result?.result) {
    lines.push("", result.result);
  } else if (result?.error) {
    lines.push("", result.error);
  } else if (job.error) {
    lines.push("", job.error);
  }
  return lines.join("\n");
}

export function renderJobList(jobs) {
  if (jobs.length === 0) {
    return "No Cursor jobs recorded for this workspace.";
  }
  return jobs
    .map((job) => `${job.id}\t${job.status}\t${job.command}\t${job.model || "-"}\t${job.createdAt}`)
    .join("\n");
}

export function extractPrintResult(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    return { result: "", sessionId: null, raw: null };
  }
  const lastLine = trimmed.split(/\r?\n/).filter(Boolean).at(-1) || trimmed;
  for (const candidate of [trimmed, lastLine]) {
    if (!(candidate.startsWith("{") || candidate.startsWith("["))) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate);
      return {
        result: parsed.result || parsed.text || parsed.message || "",
        sessionId: parsed.session_id || parsed.sessionId || null,
        raw: parsed
      };
    } catch {
      // keep looking
    }
  }
  return { result: trimmed, sessionId: null, raw: null };
}

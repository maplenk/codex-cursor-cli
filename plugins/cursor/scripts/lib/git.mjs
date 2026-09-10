import { runCommand } from "./bin.mjs";

export async function gitOutput(args, cwd) {
  const result = await runCommand("git", args, { cwd, timeoutMs: 15_000 });
  if (result.code !== 0) {
    return "";
  }
  return result.stdout.trim();
}

export async function detectReviewScope(cwd, requested = "auto", base) {
  const scope = requested || "auto";
  if (scope === "working-tree" || scope === "branch") {
    return { scope, base: base || (await defaultBase(cwd)) };
  }
  const status = await gitOutput(["status", "--porcelain"], cwd);
  if (status) {
    return { scope: "working-tree", base: base || (await defaultBase(cwd)) };
  }
  return { scope: "branch", base: base || (await defaultBase(cwd)) };
}

export async function defaultBase(cwd) {
  for (const candidate of ["main", "master", "trunk"]) {
    const exists = await gitOutput(["rev-parse", "--verify", `origin/${candidate}`], cwd);
    if (exists) {
      return candidate;
    }
    const local = await gitOutput(["rev-parse", "--verify", candidate], cwd);
    if (local) {
      return candidate;
    }
  }
  const upstream = await gitOutput(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
  return upstream || "main";
}

export async function collectReviewContext(cwd, options = {}) {
  const detected = await detectReviewScope(cwd, options.scope, options.base);
  const status = await gitOutput(["status", "--short", "--branch"], cwd);
  const log = await gitOutput(["log", "-5", "--oneline"], cwd);
  let diff = "";
  let stat = "";
  if (detected.scope === "working-tree") {
    stat = await gitOutput(["diff", "--stat", "HEAD"], cwd);
    const unstaged = await gitOutput(["diff", "HEAD"], cwd);
    const staged = await gitOutput(["diff", "--cached"], cwd);
    diff = [unstaged, staged].filter(Boolean).join("\n\n");
  } else {
    const range = `${detected.base}...HEAD`;
    stat = await gitOutput(["diff", "--stat", range], cwd);
    diff = await gitOutput(["diff", range], cwd);
  }

  const maxDiff = 12_000;
  const truncated = diff.length > maxDiff;
  return {
    ...detected,
    status,
    log,
    stat,
    diff: truncated ? `${diff.slice(0, maxDiff)}\n\n[diff truncated; inspect the remainder with git]` : diff,
    truncated
  };
}

export function renderReviewBrief(kind, context, focus = "") {
  const title = kind === "adversarial-review" ? "Adversarial review" : "Code review";
  const stance =
    kind === "adversarial-review"
      ? [
          "Challenge the design, not just the syntax.",
          "Attack hidden assumptions, rollback safety, races, auth/data-loss paths, and weaker alternatives.",
          "Do not apply patches. Stay in read-only / ask mode."
        ]
      : [
          "Review the current git changes for correctness, regressions, security, and missing tests.",
          "Be specific: file:line, severity, and a concrete recommendation.",
          "Do not apply patches. Stay in read-only / ask mode."
        ];

  return [
    `${title} of this repository.`,
    ...stance,
    focus ? `Focus: ${focus}` : "",
    `Scope: ${context.scope}`,
    `Base: ${context.base}`,
    "",
    "Git status:",
    context.status || "(clean)",
    "",
    "Recent commits:",
    context.log || "(none)",
    "",
    "Diffstat:",
    context.stat || "(empty)",
    "",
    "Diff:",
    context.diff || "(empty)",
    "",
    "Return a structured review with a short verdict, then findings as a markdown list.",
    "Each finding: severity, file:line if possible, confidence, and recommendation."
  ]
    .filter((line) => line !== "")
    .join("\n");
}

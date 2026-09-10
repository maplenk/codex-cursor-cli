#!/usr/bin/env node

import fs from "node:fs";

const argv = process.argv.slice(2);
const recordPath = process.env.FAKE_AGENT_RECORD;
if (recordPath) {
  fs.writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        argv,
        cwd: process.cwd(),
        envModel: process.env.CURSOR_MODEL || null
      },
      null,
      2
    )}\n`
  );
}

if (argv.includes("--version")) {
  process.stdout.write("1.2.3\n");
  process.exit(0);
}

if (argv.includes("--list-models") || argv[0] === "models") {
  process.stdout.write(
    [
      "composer-2.5 - Composer 2.5",
      "composer-2.5-fast - Composer 2.5 Fast",
      "grok-4.6 - Grok 4.6",
      "grok-4.6-high - Grok 4.6 High",
      "opus-4.6 - Opus",
      "sonnet-4.6 - Sonnet",
      "gpt-5.4 - GPT",
      "auto - Auto",
      ""
    ].join("\n")
  );
  process.exit(0);
}

if (argv[0] === "status" || argv[0] === "whoami") {
  process.stdout.write(
    `${JSON.stringify({ authenticated: true, email: "dev@example.com", status: "ok" })}\n`
  );
  process.exit(0);
}

if (argv.includes("-p")) {
  if (process.env.FAKE_AGENT_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_AGENT_DELAY_MS)));
  }
  const modelIndex = argv.indexOf("--model");
  const model = modelIndex >= 0 ? argv[modelIndex + 1] : null;
  const prompt = argv.filter((token) => !token.startsWith("-")).at(-1) || "";
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      subtype: "success",
      result: `fake-agent handled print mode${model ? ` with ${model}` : ""}${prompt ? `: ${prompt.slice(0, 80)}` : ""}`,
      session_id: "sess_fake_123",
      duration_ms: 12
    })}\n`
  );
  process.exit(0);
}

process.stderr.write(`unexpected argv: ${argv.join(" ")}\n`);
process.exit(2);

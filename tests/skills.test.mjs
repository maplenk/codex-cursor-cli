import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../plugins/cursor/scripts/lib/args.mjs";

const SKILL = fileURLToPath(new URL("../plugins/cursor/skills/cursor-routing/SKILL.md", import.meta.url));
const COMPANION = fileURLToPath(new URL("../plugins/cursor/scripts/cursor-companion.mjs", import.meta.url));

test("--json without -- swallows the next word as its value", () => {
  const lost = parseArgs(["--cwd", "/repo", "--json", "what broke?"]);
  assert.equal(lost.flags.json, "what broke?");
  assert.deepEqual(lost.positionals, []);
});

test("--json before -- keeps the prompt as a positional", () => {
  const kept = parseArgs(["--cwd", "/repo", "--json", "--", "what broke?"]);
  assert.equal(kept.flags.json, true);
  assert.deepEqual(kept.positionals, ["what broke?"]);
});

test("routing skill puts prompts after -- and does not pin a cache version", () => {
  const text = fs.readFileSync(SKILL, "utf8");
  assert.match(text, /--json \[flags\] -- <prompt>/);
  assert.doesNotMatch(text, /plugins\/cache\/cursor-cli\/cursor\/[^/\s]+/);
  assert.match(text, /skills\/cursor-routing\/SKILL\.md/);
  assert.match(text, /\.\.\/\.\.\/scripts\/cursor-companion\.mjs/);
});

test("companion resolves relative to the loaded routing skill", () => {
  const fromSkill = path.resolve(path.dirname(SKILL), "..", "..", "scripts", "cursor-companion.mjs");
  assert.equal(fromSkill, COMPANION);
  assert.ok(fs.existsSync(fromSkill));
});

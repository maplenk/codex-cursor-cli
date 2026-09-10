import assert from "node:assert/strict";
import test from "node:test";
import {
  isBracketModel,
  parseCursorModelsOutput,
  resolveModelSelection
} from "../plugins/cursor/scripts/lib/models.mjs";

const CATALOG = parseCursorModelsOutput(
  [
    "composer-2.5 - Composer 2.5",
    "composer-2.5-fast - Composer 2.5 Fast",
    "grok-4.6 - Grok 4.6",
    "grok-4.6-high - Grok 4.6 High",
    "opus-4.6 - Opus",
    "sonnet-4.6 - Sonnet",
    "gpt-5.4 - GPT",
    "auto - Auto"
  ].join("\n")
);

test("parseCursorModelsOutput reads id - Display Name lines", () => {
  assert.equal(CATALOG.length, 8);
  assert.equal(CATALOG[0].id, "composer-2.5");
  assert.equal(CATALOG[0].label, "Composer 2.5");
});

test("exact slugs pass through unchanged", () => {
  const resolved = resolveModelSelection("grok-4.6", CATALOG);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.model, "grok-4.6");
  assert.equal(resolved.source, "exact");
});

test("short aliases resolve against the live catalog only", () => {
  assert.equal(resolveModelSelection("composer", CATALOG).model, "composer-2.5");
  assert.equal(resolveModelSelection("grok", CATALOG).model, "grok-4.6-high");
  assert.equal(resolveModelSelection("opus", CATALOG).model, "opus-4.6");
  assert.equal(resolveModelSelection("auto", CATALOG).model, "auto");
  assert.equal(resolveModelSelection("gpt", CATALOG).model, "gpt-5.4");
  assert.equal(resolveModelSelection("sol", CATALOG).ok, false);
});

test("omitted model does not invent a slug", () => {
  const resolved = resolveModelSelection("", CATALOG);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.model, undefined);
  assert.equal(resolved.source, "default");
});

test("fast remaps to a live *-fast sibling", () => {
  const resolved = resolveModelSelection("composer-2.5", CATALOG, { fast: true });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.model, "composer-2.5-fast");
});

test("bracket syntax is rejected with live-slug hints", () => {
  assert.equal(isBracketModel("grok[context=1m,effort=high]"), true);
  const resolved = resolveModelSelection("grok[context=1m,effort=high]", CATALOG);
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /does not accept bracket syntax/);
  assert.match(resolved.error, /grok-4\.6/);
});

test("unknown aliases fail instead of pinning a stale id", () => {
  const resolved = resolveModelSelection("fable", CATALOG);
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /No live Cursor model matched alias/);
});

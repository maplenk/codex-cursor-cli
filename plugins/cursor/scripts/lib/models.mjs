const ALIAS_MATCHERS = {
  auto: (id) => id === "auto",
  composer: (id) => /(^|[-/])composer($|[-/])/.test(id) || id.startsWith("composer"),
  grok: (id) => /(^|[-/])grok($|[-/])/.test(id) || id.startsWith("grok"),
  opus: (id) => id.includes("opus"),
  sonnet: (id) => id.includes("sonnet"),
  gpt: (id) => id.startsWith("gpt-") || id.includes("/gpt"),
  sol: (id) => id.includes("sol"),
  fable: (id) => id.includes("fable"),
  gemini: (id) => id.includes("gemini")
};

export function isBracketModel(value) {
  return typeof value === "string" && /\[[^\]]*\]/.test(value.trim());
}

export function parseCursorModelsOutput(stdout = "", stderr = "") {
  const combined = `${stdout}\n${stderr}`;
  const models = [];
  const seen = new Set();

  const trimmed = stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      collectJsonModels(parsed, models, seen);
    } catch {
      // Fall through to text parsing.
    }
  }

  for (const match of combined.matchAll(/available models?:\s*([^\n]+)/gi)) {
    for (const token of (match[1] || "").split(",")) {
      pushModel(models, seen, token);
    }
  }

  for (const lineRaw of combined.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || /^(available models|tip:|use --model)/i.test(line)) {
      continue;
    }
    const dash = line.match(/^(`?)([a-zA-Z0-9][\w./+-]*)\1\s+-\s+(.+)$/);
    if (dash) {
      pushModel(models, seen, dash[2], dash[3]);
      continue;
    }
    const bullet = line.replace(/^[-*]\s+/, "");
    if (/^[a-zA-Z0-9][\w./+-]*$/.test(bullet)) {
      pushModel(models, seen, bullet);
    }
  }

  return models;
}

function collectJsonModels(value, models, seen) {
  if (!value) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonModels(item, models, seen);
    }
    return;
  }
  if (typeof value === "string") {
    pushModel(models, seen, value);
    return;
  }
  if (typeof value === "object") {
    const id = value.id || value.slug || value.name || value.model;
    const label = value.displayName || value.label || value.title;
    if (id) {
      pushModel(models, seen, id, label);
    }
    collectJsonModels(value.models, models, seen);
    collectJsonModels(value.data, models, seen);
  }
}

function pushModel(models, seen, rawId, label) {
  const id = String(rawId || "").trim().replace(/^`|`$/g, "");
  if (!id || seen.has(id)) {
    return;
  }
  seen.add(id);
  models.push({
    id,
    label: label ? String(label).trim() : id
  });
}

export function formatModelCatalog(models, query = "") {
  const filtered = filterModels(models, query);
  if (filtered.length === 0) {
    return query
      ? `No Cursor models matched ${JSON.stringify(query)}.`
      : "No Cursor models were returned. Run `agent login` or set CURSOR_API_KEY, then retry.";
  }
  return filtered.map((model) => `${model.id} - ${model.label}`).join("\n");
}

export function filterModels(models, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return models;
  }
  return models.filter(
    (model) =>
      model.id.toLowerCase().includes(needle) ||
      String(model.label || "").toLowerCase().includes(needle)
  );
}

export function resolveModelSelection(rawValue, models, options = {}) {
  const preferFast = Boolean(options.fast);
  const value = String(rawValue || "").trim();
  if (!value) {
    return { ok: true, model: undefined, source: "default" };
  }
  if (isBracketModel(value)) {
    const matches = suggestForBracket(value, models);
    return {
      ok: false,
      error:
        `Cursor CLI --model does not accept bracket syntax like ${JSON.stringify(value)}. ` +
        (matches.length > 0
          ? `Use a live slug instead: ${matches.join(", ")}.`
          : "Use a slug from cursor_models / `agent --list-models`.")
    };
  }

  const exact = models.find((model) => model.id === value);
  if (exact) {
    return applyFastPreference(exact.id, models, preferFast, "exact");
  }

  const caseInsensitive = models.find((model) => model.id.toLowerCase() === value.toLowerCase());
  if (caseInsensitive) {
    return applyFastPreference(caseInsensitive.id, models, preferFast, "exact");
  }

  const alias = value.toLowerCase();
  const matcher = ALIAS_MATCHERS[alias];
  if (matcher) {
    const candidates = models.filter((model) => matcher(model.id.toLowerCase()));
    const picked = pickBestCandidate(candidates, { preferFast, alias });
    if (picked) {
      return { ok: true, model: picked.id, source: "alias", alias };
    }
    return {
      ok: false,
      error: `No live Cursor model matched alias ${JSON.stringify(value)}. Run cursor_models to see slugs available to this account.`
    };
  }

  const partial = models.filter(
    (model) =>
      model.id.toLowerCase().includes(value.toLowerCase()) ||
      String(model.label || "").toLowerCase().includes(value.toLowerCase())
  );
  const picked = pickBestCandidate(partial, { preferFast, alias: value.toLowerCase() });
  if (picked) {
    return { ok: true, model: picked.id, source: "partial" };
  }

  return {
    ok: false,
    error: `Unknown Cursor model ${JSON.stringify(value)}. Run cursor_models or pass a slug from \`agent --list-models\`.`
  };
}

function applyFastPreference(modelId, models, preferFast, source) {
  if (!preferFast) {
    return { ok: true, model: modelId, source };
  }
  const fastSibling = models.find((model) => model.id === `${modelId}-fast` || model.id === `${modelId}-fast-mode`);
  if (fastSibling) {
    return { ok: true, model: fastSibling.id, source: "fast" };
  }
  if (/-fast(?:-|$)/.test(modelId)) {
    return { ok: true, model: modelId, source };
  }
  return { ok: true, model: modelId, source, warning: `No *-fast sibling found for ${modelId}.` };
}

function pickBestCandidate(candidates, { preferFast, alias }) {
  if (candidates.length === 0) {
    return null;
  }
  const ranked = [...candidates].sort((a, b) => scoreModel(b.id, { preferFast, alias }) - scoreModel(a.id, { preferFast, alias }));
  return ranked[0];
}

function scoreModel(id, { preferFast, alias }) {
  let score = 0;
  const lower = id.toLowerCase();
  if (lower === alias) {
    score += 1000;
  }
  if (lower.startsWith(`${alias}-`) || lower.startsWith(`${alias}/`)) {
    score += 200;
  }
  const version = [...id.matchAll(/(\d+(?:\.\d+)*)/g)].map((match) => match[1]).join(".");
  if (version) {
    const parts = version.split(".").map((part) => Number(part) || 0);
    score += parts.reduce((sum, part, index) => sum + part * 10 ** (6 - index * 2), 0);
  }
  if (/-fast(?:-|$)/.test(lower)) {
    score += preferFast ? 80 : -40;
  }
  if (lower.includes("high") || lower.includes("xhigh") || lower.includes("max")) {
    score += 15;
  }
  if (lower.includes("thinking")) {
    score += 5;
  }
  return score;
}

function suggestForBracket(value, models) {
  const base = value.replace(/\[[^\]]*\]/g, "").trim().toLowerCase();
  if (!base) {
    return models.slice(0, 5).map((model) => model.id);
  }
  return models
    .filter((model) => model.id.toLowerCase().includes(base) || base.includes(model.id.toLowerCase()))
    .slice(0, 6)
    .map((model) => model.id);
}

export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const trimmed = token.slice(2);
    const eq = trimmed.indexOf("=");
    if (eq !== -1) {
      const key = camelCase(trimmed.slice(0, eq));
      pushFlag(flags, key, trimmed.slice(eq + 1));
      continue;
    }
    const key = camelCase(trimmed);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      pushFlag(flags, key, next);
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { flags, positionals };
}

function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function pushFlag(flags, key, value) {
  if (Object.prototype.hasOwnProperty.call(flags, key)) {
    const current = flags[key];
    flags[key] = Array.isArray(current) ? [...current, value] : [current, value];
    return;
  }
  flags[key] = value;
}

export function hasFlag(flags, key) {
  return Boolean(flags[key]);
}

export function flagValue(flags, key, fallback = undefined) {
  const value = flags[key];
  if (value === undefined || value === true) {
    return fallback;
  }
  return Array.isArray(value) ? value[value.length - 1] : value;
}

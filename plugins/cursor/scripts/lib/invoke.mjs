const PROMPT_ARGV_LIMIT = 8_000;

export function buildAgentArgv(options = {}) {
  const args = ["-p", "--trust", "--approve-mcps", "--output-format", options.outputFormat || "json"];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.mode) {
    args.push("--mode", options.mode);
  }
  if (options.force) {
    args.push("--force");
  }
  if (options.resume) {
    args.push("--resume", String(options.resume));
  }
  if (options.workspace) {
    args.push("--workspace", options.workspace);
  }
  if (options.sandbox) {
    args.push("--sandbox", options.sandbox);
  }
  if (options.prompt && options.prompt.length <= PROMPT_ARGV_LIMIT && !options.promptFile) {
    args.push(options.prompt);
  }
  return args;
}

export function shouldSpillPrompt(prompt) {
  return Boolean(prompt) && prompt.length > PROMPT_ARGV_LIMIT;
}

export function promptFromFileInstruction(filePath) {
  return `Read the task in ${filePath} and carry it out. Do not mention the file unless needed.`;
}

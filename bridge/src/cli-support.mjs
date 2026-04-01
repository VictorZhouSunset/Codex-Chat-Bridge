// input: raw CLI argv tokens, bridge config objects, and target chat ids
// output: parsed CLI flags, validated allowlist decisions, control-port resolution, and usage text
// pos: shared helper layer for the bridge CLI entrypoint
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
export function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = args[index + 1];
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

export function getControlPort(config) {
  return Number(config.controlPort ?? 47821);
}

export function isAllowedChat(config, chatId) {
  if (!Array.isArray(config.allowedChatIds) || config.allowedChatIds.length === 0) {
    return false;
  }
  return config.allowedChatIds.map(String).includes(String(chatId));
}

export function resolveAttachInputs({ args = {}, config = {}, env = process.env } = {}) {
  const chatId = `${args["chat-id"] ?? config?.defaultChatId ?? ""}`.trim();
  if (!chatId) {
    throw new Error("attach requires --chat-id or config.defaultChatId.");
  }

  const threadId = `${args["thread-id"] ?? env.CODEX_THREAD_ID ?? ""}`.trim();
  if (!threadId) {
    throw new Error("attach requires --thread-id or CODEX_THREAD_ID.");
  }

  return {
    chatId,
    threadId,
  };
}

export function buildUsageText() {
  return `Usage:
  node src/cli.mjs init-config
  node src/cli.mjs start-service
  node src/cli.mjs stop-service
  node src/cli.mjs attach [--chat-id <id>] [--thread-id <id>] [--thread-label <label>] [--cwd <path>]
  node src/cli.mjs detach [--chat-id <id>]
  node src/cli.mjs status [--chat-id <id>]
  node src/cli.mjs inject --chat-id <id> --text <text>
  node src/cli.mjs serve`;
}

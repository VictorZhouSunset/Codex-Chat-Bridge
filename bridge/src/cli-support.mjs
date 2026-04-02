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

export function resolveExplicitAttachAccessArgs(args = {}) {
  const rawApprovalPolicy = `${args["approval-policy"] ?? ""}`.trim();
  const rawSandboxMode = `${args["sandbox-mode"] ?? ""}`.trim();

  if (!rawApprovalPolicy && !rawSandboxMode) {
    return null;
  }

  const approvalPolicy = normalizeApprovalPolicy(rawApprovalPolicy);
  if (!approvalPolicy) {
    throw new Error(
      "Invalid --approval-policy. Expected one of: never, on-request, on-failure, untrusted.",
    );
  }

  const sandboxMode = normalizeSandboxMode(rawSandboxMode);
  if (!sandboxMode) {
    throw new Error(
      "Invalid --sandbox-mode. Expected one of: read-only, workspace-write, danger-full-access.",
    );
  }

  return {
    approvalPolicy,
    sandboxMode,
  };
}

export function buildUsageText() {
  return `Usage:
  node src/cli.mjs init-config
  node src/cli.mjs start-service
  node src/cli.mjs stop-service
  node src/cli.mjs attach [--chat-id <id>] [--thread-id <id>] [--thread-label <label>] [--cwd <path>] [--approval-policy <policy>] [--sandbox-mode <mode>]
  node src/cli.mjs detach [--chat-id <id>]
  node src/cli.mjs status [--chat-id <id>]
  node src/cli.mjs inject --chat-id <id> --text <text>
  node src/cli.mjs serve`;
}

function normalizeApprovalPolicy(value) {
  if (value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted") {
    return value;
  }
  return null;
}

function normalizeSandboxMode(value) {
  if (value === "danger-full-access" || value === "read-only" || value === "workspace-write") {
    return value;
  }
  return null;
}

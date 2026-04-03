import path from "node:path";

export function shouldSendAttachReadyMessage({ existingBinding, targetThreadId, wasHealthy }) {
  if (!existingBinding) {
    return true;
  }

  if (existingBinding.threadId !== targetThreadId) {
    return true;
  }

  return !wasHealthy;
}

export function buildAttachReadyMessage({ threadId, threadLabel, cwd, accessSummary, notice }) {
  const projectName = summarizeProjectName(cwd);
  const currentThread = summarizeThreadLabel(threadLabel);
  const threadIdLine = threadId ? `threadId: ${threadId}` : null;
  const accessLine = accessSummary ? `权限: ${accessSummary}` : null;
  const noticeLine = notice ? `${notice}` : null;

  return ["Telegram 已可用", `项目: ${projectName}`, `当前线程: ${currentThread}`, threadIdLine, accessLine, noticeLine]
    .filter(Boolean)
    .join("\n");
}

export function buildBlockingTurnNotice(activeTurn) {
  if (!activeTurn?.turnId) {
    return null;
  }

  const preview = summarizePreview(activeTurn.textPreview);
  if (preview) {
    return `检测到当前 thread 上已有未结束 turn：${preview}。Telegram 会先等待；如需强制终止请发送 /interrupt。`;
  }

  return "检测到当前 thread 上已有未结束 turn。Telegram 会先等待；如需强制终止请发送 /interrupt。";
}

function summarizeProjectName(cwd) {
  if (!cwd) {
    return "未知项目";
  }

  const normalized = path.normalize(cwd);
  const baseName = path.basename(normalized);
  return baseName || normalized;
}

function summarizeThreadLabel(threadLabel) {
  return `${threadLabel ?? ""}`.trim() || "当前 thread";
}

function summarizePreview(text) {
  const normalized = `${text ?? ""}`.trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 10 ? `${normalized.slice(0, 10)}...` : normalized;
}

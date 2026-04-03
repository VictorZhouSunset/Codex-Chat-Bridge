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

export function buildBlockingTurnNotice(activity) {
  const blockingTurn = normalizeTurn(activity?.blockingTurn);
  const lingeringTurns = normalizeTurns(activity?.lingeringTurns);
  const lines = [];

  if (blockingTurn) {
    const preview = summarizePreview(blockingTurn.textPreview);
    if (preview) {
      lines.push(`检测到当前 thread 最新 turn 仍未结束：${preview}。Telegram 会先等待；如需强制终止请发送 /interrupt。`);
    } else {
      lines.push("检测到当前 thread 最新 turn 仍未结束。Telegram 会先等待；如需强制终止请发送 /interrupt。");
    }
  }

  if (lingeringTurns.length > 0) {
    lines.push(
      `警告: 当前线程中有 ${lingeringTurns.length} 个 lingering turns 标记为 "inProgress"，可能是 zombie turns。bridge 已忽略它们。`,
    );
  }

  return lines.filter(Boolean).join("\n") || null;
}

function normalizeTurns(activeTurns) {
  if (!activeTurns) {
    return [];
  }
  return (Array.isArray(activeTurns) ? activeTurns : [activeTurns]).filter(
    (turn) => turn?.turnId || turn?.id,
  );
}

function normalizeTurn(turn) {
  if (!turn) {
    return null;
  }
  return turn?.turnId || turn?.id ? turn : null;
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
  return normalized.length > 10 ? `${normalized.slice(0, 10).trimEnd()} ...` : normalized;
}

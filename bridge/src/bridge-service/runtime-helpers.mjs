// input: shutdown sources, interrupt-turn candidates, and generic bridge runtime helper calls
// output: shared runtime formatting and turn-deduplication helpers for bridge-service internals
// pos: internal support utilities for bridge-service orchestration
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
const DRAINING_MESSAGE = "Bridge shutdown in progress. Please return to Codex and re-attach later.";

export function buildDrainingMessage(source) {
  const sourceLabel = formatShutdownSource(source);
  if (!sourceLabel) {
    return DRAINING_MESSAGE;
  }
  return `${DRAINING_MESSAGE} (requested from ${sourceLabel})`;
}

export function isThreadSessionLostError(error) {
  if (error?.code === "THREAD_SESSION_NOT_READY") {
    return true;
  }
  return /thread not found|attached thread session is not ready/i.test(error?.message ?? "");
}

export function formatShutdownSource(source) {
  switch (`${source ?? ""}`.trim().toLowerCase()) {
    case "tray":
      return "tray";
    case "cli":
      return "cli";
    case "no_bindings":
      return "binding cleanup";
    case "unknown":
    case "":
      return null;
    default:
      return source;
  }
}

export function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createTurnIdsKey(turns) {
  return dedupeTurns(turns)
    .map((turn) => turn?.turnId ?? turn?.id ?? "")
    .filter(Boolean)
    .sort()
    .join("|");
}

export function dedupeTurns(turns) {
  const deduped = [];
  const seen = new Set();
  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!turn) {
      continue;
    }
    const key = turn.turnId ?? turn.id ?? `${turn.threadId ?? ""}:${turn.textPreview ?? ""}:${turn.source ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(turn);
  }
  return deduped;
}

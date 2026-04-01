const DETACH_PHRASES = new Set([
  "detach",
  "stop",
  "pause relay",
  "/detach",
  "回到 codex",
  "结束 telegram 接管",
]);

export function classifyTelegramText(text) {
  const normalizedText = text.trim().toLowerCase();
  if (normalizedText === "/help") {
    return {
      kind: "help",
      normalizedText,
    };
  }

  if (normalizedText === "/status") {
    return {
      kind: "status",
      normalizedText,
    };
  }

  if (normalizedText === "/changes") {
    return {
      kind: "changes",
      normalizedText,
    };
  }

  if (normalizedText === "/last-error") {
    return {
      kind: "last-error",
      normalizedText,
    };
  }

  if (normalizedText === "/cancel") {
    return {
      kind: "cancel",
      normalizedText,
    };
  }

  if (normalizedText.startsWith("/permission")) {
    const [, permissionLevel = ""] = normalizedText.split(/\s+/, 2);
    return {
      kind: "permission",
      normalizedText,
      permissionLevel: normalizePermissionLevel(permissionLevel),
    };
  }

  if (normalizedText.startsWith("permission:")) {
    const [, permissionLevel = ""] = normalizedText.split(":", 2);
    return {
      kind: "permission",
      normalizedText,
      permissionLevel: normalizePermissionLevel(permissionLevel),
    };
  }

  return {
    kind: DETACH_PHRASES.has(normalizedText) ? "detach" : "relay",
    normalizedText,
  };
}

function normalizePermissionLevel(permissionLevel) {
  const normalizedLevel = `${permissionLevel ?? ""}`.trim().toLowerCase();
  if (!normalizedLevel) {
    return null;
  }
  if (["default", "readonly", "workspace", "full"].includes(normalizedLevel)) {
    return normalizedLevel;
  }
  return null;
}

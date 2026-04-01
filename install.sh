#!/usr/bin/env sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
BRIDGE_SOURCE="${REPO_ROOT}/bridge"
BRIDGE_TARGET="${CODEX_HOME}/telegram-bridge"
SKILL_SOURCE="${REPO_ROOT}/skill/telegram-handoff"
SKILL_TARGET="${CODEX_HOME}/skills/telegram-handoff"

mkdir -p "$BRIDGE_TARGET" "$SKILL_TARGET"

rm -rf "$BRIDGE_TARGET/src" "$BRIDGE_TARGET/tests" "$BRIDGE_TARGET/tray-companion"
rm -rf "$SKILL_TARGET/agents" "$SKILL_TARGET/references"

cp -R "$BRIDGE_SOURCE/src" "$BRIDGE_TARGET/src"
cp -R "$BRIDGE_SOURCE/tests" "$BRIDGE_TARGET/tests"
cp -R "$BRIDGE_SOURCE/tray-companion" "$BRIDGE_TARGET/tray-companion"
cp "$BRIDGE_SOURCE/package.json" "$BRIDGE_TARGET/"
cp "$BRIDGE_SOURCE/config.example.json" "$BRIDGE_TARGET/"
cp "$BRIDGE_SOURCE/start-telegram-bridge.ps1" "$BRIDGE_TARGET/"
cp "$BRIDGE_SOURCE/start-telegram-bridge.sh" "$BRIDGE_TARGET/"
cp "$BRIDGE_SOURCE/stop-telegram-bridge.ps1" "$BRIDGE_TARGET/"
cp "$BRIDGE_SOURCE/stop-telegram-bridge.sh" "$BRIDGE_TARGET/"
cp "$BRIDGE_SOURCE/status-telegram-bridge.ps1" "$BRIDGE_TARGET/"
cp "$BRIDGE_SOURCE/status-telegram-bridge.sh" "$BRIDGE_TARGET/"

if [ ! -f "$BRIDGE_TARGET/config.json" ]; then
  cp "$BRIDGE_SOURCE/config.example.json" "$BRIDGE_TARGET/config.json"
fi

cp -R "$SKILL_SOURCE/agents" "$SKILL_TARGET/agents"
cp -R "$SKILL_SOURCE/references" "$SKILL_TARGET/references"
cp "$SKILL_SOURCE/SKILL.md" "$SKILL_TARGET/"

printf '%s\n' "Installed bridge to $BRIDGE_TARGET"
printf '%s\n' "Installed skill to $SKILL_TARGET"
printf '%s\n' "If this is your first install, edit $BRIDGE_TARGET/config.json before attaching a thread."

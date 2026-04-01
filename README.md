# Codex Chat Bridge

Bridge a live Codex thread into an external chat app, while keeping the same thread id and history on the Codex side.

Today this repo ships a production-leaning Telegram adapter:

- a local bridge daemon
- a Codex skill for explicit handoff
- a tray or menu-bar helper
- interactive approval and question handling from Telegram

The repo name is intentionally broader than Telegram because the architecture can later grow into additional chat adapters such as WhatsApp or Slack.

## What It Does

When you explicitly invoke the installed `telegram-handoff` skill inside a Codex thread, the bridge:

- binds that Telegram chat to the current Codex thread
- relays Telegram text into the same thread
- returns progress updates and final replies back to Telegram
- supports approvals and follow-up questions in Telegram
- lets you detach and return to Codex

The bridge is local-first. Your primary data and thread execution stay on your machine.

## Current Scope

Current adapter:

- Telegram

Current capabilities:

- same-thread handoff from Codex to Telegram
- queueing and progress updates
- `/help`
- `/status`
- `/changes`
- `/last-error`
- `/cancel`
- `/detach`
- `/permission` with an inline chooser for `default`, `readonly`, `workspace`, and `full`
- temporary tray or menu-bar companion while the bridge is running
- active Telegram bindings are cleared automatically when the bridge exits cleanly

## Prerequisites

Required:

- Codex Desktop or a Codex environment that supports `codex app-server`
- Node.js on `PATH`
- Telegram account
- A Telegram bot created with BotFather

Recommended:

- Rust and Cargo on `PATH`

Why Rust is recommended:

- the tray helper is implemented in Rust
- if no prebuilt tray binary exists in `~/.codex/telegram-bridge/tray-companion/target/release`, the bridge falls back to `cargo run`

The bridge itself can still be useful without the tray helper, but the tray experience is best when Rust is available.

## Install

This repo is designed to install into your Codex home, not into one of your app repos.

Recommended target paths:

- bridge: `~/.codex/telegram-bridge`
- skill: `~/.codex/skills/telegram-handoff`

If you want to override the destination, set `CODEX_HOME` before running the installer.

### Windows PowerShell

From the repo root:

```powershell
& .\install.ps1
```

### macOS / POSIX shell

From the repo root:

```sh
./install.sh
```

The installer:

- copies the bridge into `~/.codex/telegram-bridge`
- copies the skill into `~/.codex/skills/telegram-handoff`
- creates `config.json` from `config.example.json` on first install

## Quick Setup

### 1. Create a Telegram bot

In Telegram:

1. Open [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a display name
4. Choose a unique bot username ending in `bot`
5. Copy the bot token that BotFather returns

### 2. Start a chat with your bot

Open the bot chat and:

1. Press `Start`
2. Send at least one normal message like `hello`

### 3. Find your Telegram chat id for the allowlist

Option A, recommended:

Use the Bot API `getUpdates` endpoint:

```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

Look for:

```json
message.chat.id
```

For a private chat with your own bot, this value works as your allowlisted chat id.

Option B:

Use a Telegram id lookup bot such as a user-id bot and read your Telegram user id there. For private chat setups, that id generally matches the private chat id you need.

### 4. Fill your bridge config

Edit:

`~/.codex/telegram-bridge/config.json`

Set:

- `telegramBotToken`
- `allowedChatIds`
- `defaultChatId`

Example:

```json
{
  "_notes": [
    "The bridge auto-starts a temporary tray or menu-bar companion while a thread is attached.",
    "If no release tray binary is built, the launcher falls back to cargo run, so Rust and Cargo must be available on PATH."
  ],
  "telegramBotToken": "123456789:AA...",
  "allowedChatIds": ["123456789"],
  "defaultChatId": "123456789",
  "pollIntervalMs": 5000,
  "controlPort": 47821
}
```

## Using It

Inside a Codex thread, explicitly invoke the installed skill:

```text
Use $telegram-handoff to attach this current thread to Telegram.
```

Or in Chinese:

```text
使用 telegram-handoff，把当前这个 thread 接到 Telegram。
```

After attach:

- Telegram receives a ready message
- future Telegram messages continue the same Codex thread
- you can return with `/detach` or natural language detach phrases supported by the skill

Useful local commands:

```powershell
node "$HOME/.codex/telegram-bridge/src/cli.mjs" status
node "$HOME/.codex/telegram-bridge/src/cli.mjs" start-service
node "$HOME/.codex/telegram-bridge/src/cli.mjs" stop-service
```

## Recommended Codex-Assisted Install

Many users will prefer asking Codex to install this repo for them.

You can tell Codex something like:

```text
Please install the Codex Chat Bridge from this repo into my ~/.codex directory, copy the bridge into ~/.codex/telegram-bridge, copy the telegram-handoff skill into ~/.codex/skills/telegram-handoff, and preserve my existing config.json if it already exists.
```

If you want Codex to also help with Telegram setup, you can ask:

```text
Please install this repo into ~/.codex, then walk me through creating a Telegram bot with BotFather, getting my chat id from getUpdates, and filling config.json.
```

## Repo Layout

```text
bridge/
  src/
  tests/
  tray-companion/
  config.example.json
skill/
  telegram-handoff/
    SKILL.md
    references/
install.ps1
install.sh
README.md
```

## Development Notes

- runtime state should stay out of git
- do not commit `bridge/config.json`
- do not commit `bridge/state.json`
- do not commit `bridge/tray-companion.pid`
- do not commit `bridge/tmp/`
- do not commit `bridge/tray-companion/target/`

## License

MIT

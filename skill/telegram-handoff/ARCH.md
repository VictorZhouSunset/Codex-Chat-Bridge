# skill/telegram-handoff
Codex skill package that instructs Codex how to attach the current thread to the installed Telegram bridge.
The skill is an orchestration surface, not a second implementation of the bridge daemon.
Its docs should track operator-facing workflows, recovery steps, and command expectations.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `SKILL.md` | primary skill contract | Tells Codex when and how to invoke the installed bridge commands. |
| `agents/openai.yaml` | model metadata | Declares the skill’s target agent metadata. |
| `references/protocol.md` | operator reference | Documents attach, detach, recovery, and runtime behavior details for the skill. |

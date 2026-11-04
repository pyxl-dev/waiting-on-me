# Instructions for AI agents

You are an AI coding agent and your user asked you to install or use **waiting-on-me**. This file tells you how.

## What it does

A Claude Code mod for the Claude desktop app's Code tab. At the end of each main-loop turn it decides whether the session waits on the user (a question, a choice, an action to do and report back). Waiting sessions are moved to a sidebar section (default `Waiting on you`). When a later turn ends with nothing pending, the session goes back to its original section.

Decision order:

1. Claude's `wrap_up` call in that turn: `blocked: true` or a non-empty `ask` means waiting; a recap-only `wrap_up` means done.
2. No `wrap_up`: if the `jev` CLI is installed and `useJev` is on, Jev rates the final message (`noul`, threshold `jevThreshold`, default 0.35).
3. Neither: nothing changes.

## Install

Run, then read the output: every line starts with `✓`, `!` (optional piece missing) or `✗` (blocking).

```sh
curl -fsSL https://raw.githubusercontent.com/pyxl-dev/waiting-on-me/main/install.sh | sh
```

Pass `SECTION="<name>"` before `sh` for a custom section name. The installer edits `~/.claude/settings.json` (two `permissions.allow` rules) and `~/.claude/CLAUDE.md` (a marked block). Your own permission mode may forbid you from editing those files: if so, give the user the command and let them run it.

Uninstall: `curl -fsSL .../install.sh | sh -s -- --uninstall`.

## Using it as the agent

When a turn ends waiting on the user, call `wrap_up` with `blocked: true` (or an `ask`). When the task is finished, end with a recap-only `wrap_up`. That is all the mod needs.

## Development

- Code: `hooks/register.ts`. State contract: `types/index.d.ts`. Options: `userConfig` in `.claude-plugin/plugin.json`.
- Check: `claude plugin validate .`
- Run from a clone: add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

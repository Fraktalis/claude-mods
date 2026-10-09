# claude-mods

My Claude Code mods, as a plugin marketplace (`alex-mods`). One folder per mod under `plugins/`.

| Mod | What it does |
|---|---|
| [savvy-progress](plugins/savvy-progress) | Ember progress bar above the prompt for a batch of subagents, and an Agents pane: crab mascot per agent, live status, per-agent progress bar, model, tokens, estimated cost, elapsed time. |

## Install on this machine (reads straight from this folder)

```bash
claude plugin marketplace add E:/WS/claude-mods
claude plugin install savvy-progress@alex-mods --scope user
```

Installed this way, Claude Code reads the plugin from this folder, so an edit here reaches a session with `/reload-plugins` (no reinstall, no version bump).

## Install from GitHub (another machine)

```
/plugin install savvy-progress --marketplace Fraktalis/claude-mods
```

Then update later with `claude plugin update savvy-progress@alex-mods` after pushing a new version.

## Working on a mod

```bash
claude plugin validate plugins/savvy-progress
claude plugin test plugins/savvy-progress
```

Bump `version` in the mod's `.claude-plugin/plugin.json` for each release that GitHub installs should pick up.

## savvy-progress

- `/savvy` opens the Agents pane; `/savvy-skin <type|*> <crab|developer|designer|researcher|architect|ghost>` picks a mascot.
- Registers a `progress` tool (`mcp__savvy-progress__progress`); each subagent is asked to report `done/total/step` with it. The main loop can also call it, with `title` to name the batch.
- Cost is estimated from each request's token usage at the model's list price (table in `hooks/register.tsx`, `PRICES`); edit it when prices change.

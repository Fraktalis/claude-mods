# claude-mods

My Claude Code mods, as a plugin marketplace (`alex-mods`). One folder per mod under `plugins/`.

| Mod | What it does |
|---|---|
| [savvy-progress](plugins/savvy-progress) | Ember progress bar above the prompt for a batch of subagents, and an Agents pane: crab mascot per agent, live status, per-agent progress bar, model, tokens, estimated cost, elapsed time. |
| [file-tree](plugins/file-tree) | Files pane with the project tree: files Claude reads (blue), modifies (orange) or creates (purple) light up with a shimmer, and turn green once committed, in every repo they live in. |

## Install on this machine (reads straight from this folder)

```bash
claude plugin marketplace add E:/WS/claude-mods
claude plugin install savvy-progress@alex-mods --scope user
claude plugin install file-tree@alex-mods --scope user
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

## file-tree

- `/tree` opens the Files pane (it also opens by itself on the first file Claude edits or creates); `/tree-clear` forgets what was touched.
- States: ◦ read, ● modified, + new, ✓ committed. Reads never downgrade a state; editing a committed file makes it modified again.
- A successful `git commit` run by Claude re-checks `git status` in every repository holding a modified or new file; commits made in a terminal are picked up on the next prompt.
- Folders leading to touched files open by themselves; `node_modules`, `.git` and the like are listed dimmed and stay closed. **Touched only** hides the rest. Files outside the session's folder are listed under **Elsewhere**.

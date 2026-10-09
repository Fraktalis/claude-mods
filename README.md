# claude-mods

My Claude Code mods, as a plugin marketplace (`alex-mods`). One folder per mod under `plugins/`.

| Mod | What it does |
|---|---|
| [savvy-progress](plugins/savvy-progress) | Ember progress bar above the prompt for a batch of subagents, and an Agents pane: crab mascot per agent, live status, per-agent progress bar, model, tokens, estimated cost, elapsed time. |
| [file-tree](plugins/file-tree) | Files pane with the project tree: files Claude reads (blue), modifies (orange) or creates (purple) light up with a shimmer, and turn green once committed, in every repo they live in. |
| [tool-skins](plugins/tool-skins) | Reskins the transcript's tool rows: an icon and a palette colour per tool (`dracula` skin from kevinvn1709/vscode-dracula-color-theme), the row's result still drawn by Claude Code. |
| [cache-tax](plugins/cache-tax) | Prompt-cache state in the status line; stops a message that would re-read the whole conversation on a cold cache and shows what it costs; `/keepwarm` keeps the cache warm while you are away. |

## Install on this machine (reads straight from this folder)

```bash
claude plugin marketplace add E:/WS/claude-mods
claude plugin install savvy-progress@alex-mods --scope user
claude plugin install file-tree@alex-mods --scope user
claude plugin install cache-tax@alex-mods --scope user
claude plugin install tool-skins@alex-mods --scope user
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

## cache-tax

- Status line: `🔥 cache 42m` while warm, `🧊 cache cold · next msg ≈ $2.40` once the TTL has passed since the main conversation's last request.
- On a cold cache, a message whose context is above the threshold (20k tokens by default) is stopped once with the cold and warm cost; the text is put back in the box, and Enter again within 2 min sends it.
- Cost: cold re-writes the whole context to the cache (2x input price for a 1h TTL, 1.25x for 5m); warm reads it at the cache-read price. Prices in `hooks/register.ts` (`PRICES`), same table as savvy-progress.
- `/cache` shows the details; `/keepwarm on|off` sends a one-line ping ~1m30 before expiry, at most `maxPings` times in a row (never while Claude works or while you type). Each ping costs a cache read and a one-word reply.
- Options (plugin config): `ttl` (`1h` or `5m`), `minTokens`, `maxPings`. The TTL is not detected: switch it to `5m` in usage overage.

## tool-skins

- Redraws each tool row's header (`ToolUse`): icon + tool name in its palette colour, the call's argument (last 3 path segments, or the one-line command), `…` running, `✗` error, `Interrupted`. The result under the row (`ToolResult`: diffs, Bash output) is still Claude Code's own.
- `/skin` lists skins, `/skin <name>` switches, `/skin off` hands the rows back; the choice is kept across sessions. `dracula` is on by default.
- `dracula` comes from `themes/dracula-color-theme.json` of github.com/kevinvn1709/vscode-dracula-color-theme, a Darcula-style palette despite its name: keyword `#CC7832` → Bash, function `#FFC66D` → Edit, string `#6A8759` → Write, number `#6897BB` → Read, type `#4EC9B0` → Grep/Glob, property `#9876AA` → Agent, info `#6796e6` → web tools, debug `#b267e6` → MCP tools, on `#212122`.
- A new skin is one more entry in `THEMES` (`hooks/register.tsx`). The name `claude-skins` is reserved for Anthropic, hence `tool-skins`.

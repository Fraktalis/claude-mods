import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const skin = atom({ plugin: 'tool-skins', key: 'skin' } as const, null)

// ---------- themes ----------

export type Look = { icon: string; color: string; bold?: boolean }

export type Theme = {
  /** Where the palette comes from, shown by /skin. */
  source: string
  /** Row background; absent leaves the transcript's own. */
  background?: string
  text: string
  muted: string
  running: string
  error: string
  tools: Record<string, Look>
  /** MCP tools (`mcp__server__tool`). */
  mcp: Look
  fallback: Look
}

/**
 * "dracula" from github.com/kevinvn1709/vscode-dracula-color-theme
 * (themes/dracula-color-theme.json): despite the name, a Darcula-style palette.
 * Token colours mapped to tools by role: keywords -> Bash, functions -> Edit,
 * strings -> Write, numbers -> Read, types -> search, properties -> Agent.
 */
const DRACULA: Theme = {
  source: 'github.com/kevinvn1709/vscode-dracula-color-theme',
  background: '#212122', // editor.background
  text: '#A9B7C6', // variables / plain text
  muted: '#808080', // comment
  running: '#cd9731', // token.warn-token
  error: '#f44747', // invalid / token.error-token
  tools: {
    Bash: { icon: '❯', color: '#CC7832', bold: true }, // keyword (bold)
    Read: { icon: '▤', color: '#6897BB' }, // constant.numeric
    Edit: { icon: '✎', color: '#FFC66D' }, // entity.name.function
    MultiEdit: { icon: '✎', color: '#FFC66D' },
    NotebookEdit: { icon: '✎', color: '#FFC66D' },
    Write: { icon: '✚', color: '#6A8759' }, // string
    Grep: { icon: '⌕', color: '#4EC9B0' }, // entity.name.type
    Glob: { icon: '✱', color: '#4EC9B0' },
    WebFetch: { icon: '⇣', color: '#6796e6' }, // token.info-token
    WebSearch: { icon: '⌕', color: '#6796e6' },
    Agent: { icon: '◆', color: '#9876AA' }, // variable / property
    TodoWrite: { icon: '☑', color: '#808080' },
    TaskCreate: { icon: '☐', color: '#808080' },
    TaskUpdate: { icon: '☑', color: '#808080' },
    Skill: { icon: '✦', color: '#d7ba7d' }, // entity.name.tag.css
    ToolSearch: { icon: '⌕', color: '#BABABA' }, // entity.other.attribute-name
  },
  mcp: { icon: '⧉', color: '#b267e6' }, // token.debug-token
  fallback: { icon: '•', color: '#d4d4d4' }, // editor.foreground
}

export const THEMES: Record<string, Theme> = { dracula: DRACULA }
const DEFAULT_SKIN = 'dracula'

export const lookOf = (theme: Theme, tool: string): Look => theme.tools[tool] ?? (tool.startsWith('mcp__') ? theme.mcp : theme.fallback)

/** `mcp__obsidian__read_note` -> `obsidian · read_note`; built-ins stay as they are. */
export const toolLabel = (tool: string) => {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? `${m[1]} · ${m[2]}` : tool
}

/** The one argument worth showing for a call, shortened. */
export const argOf = (input: unknown, max = 90) => {
  const i = (input ?? {}) as Record<string, unknown>
  const pick = [i.file_path, i.notebook_path, i.command, i.pattern, i.url, i.query, i.description, i.skill, i.subject, i.prompt].find(
    v => typeof v === 'string' && v.trim() !== '',
  ) as string | undefined
  if (!pick) return ''
  const one = pick.replace(/\s+/g, ' ').trim()
  // a path: keep the last three segments
  const isPath = (typeof i.file_path === 'string' || typeof i.notebook_path === 'string') && pick === (i.file_path ?? i.notebook_path)
  const shown = isPath ? one.replace(/\\/g, '/').split('/').slice(-3).join('/') : one
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skin',
      description: 'Reskin tool rows: /skin <name>, /skin off, /skin to list',
      argumentHint: `<${[...Object.keys(THEMES), 'off'].join('|')}>`,
    })
    // never chosen yet: start on the default skin; an explicit /skin off is kept (null)
    const saved = (await $.store.get('skin')) as string | null | undefined
    const start = saved === undefined ? DEFAULT_SKIN : saved === null || THEMES[saved] ? saved : DEFAULT_SKIN
    await update($, skin, () => start)
    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const names = Object.keys(THEMES)
    if (!arg) {
      const cur = await read($, skin)
      return { text: `Skin: ${cur ?? 'off'}. Available: ${names.join(', ')}, off.` }
    }
    if (arg !== 'off' && !THEMES[arg]) return { text: `No skin "${arg}". Available: ${names.join(', ')}, off.` }
    const next = arg === 'off' ? null : arg
    await update($, skin, () => next)
    await $.store.set('skin', next)
    return { text: next ? `Skin "${next}" on (palette from ${THEMES[next]!.source}).` : 'Skins off: the engine draws its own rows.' }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const name = await read($, skin)
    const theme = name ? THEMES[name] : undefined
    if (!theme) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const p = e.props
    const look = lookOf(theme, p.tool)
    const arg = argOf(p.input)
    const status = p.isInterrupted ? (
      <Text color={theme.muted}> Interrupted</Text>
    ) : p.isErrored ? (
      <Text color={theme.error}> ✗</Text>
    ) : p.isRunning ? (
      <Text color={theme.running}> …</Text>
    ) : null

    return (
      <Box flexDirection="row" backgroundColor={theme.background} paddingX={1}>
        <Text color={look.color} bold={look.bold}>
          {look.icon} {toolLabel(p.tool)}
        </Text>
        {arg ? (
          <Text color={theme.text} wrap="truncate-end">
            {' '}
            {arg}
          </Text>
        ) : null}
        {status}
      </Box>
    )
  })
}

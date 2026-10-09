import { expect, mock, test } from 'claude-code/testing'

import { argOf, lookOf, THEMES, toolLabel } from './register'

const dracula = THEMES.dracula!

test('each tool gets its palette role, unknown and MCP tools a fallback', () => {
  expect(lookOf(dracula, 'Bash')).toEqual({ icon: '❯', color: '#CC7832', bold: true })
  expect(lookOf(dracula, 'Edit').color).toBe('#FFC66D')
  expect(lookOf(dracula, 'mcp__obsidian__read_note').color).toBe('#b267e6')
  expect(lookOf(dracula, 'SomethingNew').icon).toBe('•')
  expect(toolLabel('mcp__obsidian__read_note')).toBe('obsidian · read_note')
})

test('the argument shown: last path segments, one-line commands, cut long ones', () => {
  expect(argOf({ file_path: ['C:', 'Users', 'me', 'proj', 'src', 'app.ts'].join('\\') })).toBe('proj/src/app.ts')
  expect(argOf({ command: 'git status\n  --short' })).toBe('git status --short')
  expect(argOf({ command: 'x'.repeat(200) }, 20)).toBe(`${'x'.repeat(19)}…`)
  expect(argOf({})).toBe('')
})

// ponytail: tests reach the engine through untyped shapes (`as never`)
const ROW = { tool_use_id: 't1', tool: 'Bash', input: { command: 'ls -la' }, isRunning: false, isErrored: false, isInterrupted: false }

test('rows are reskinned on terminal and desktop, and /skin off hands them back', async ($, on) => {
  mock.store(on)
  on('command.register', (async () => ({ value: {} })) as never)
  // the engine's own row, beneath the plugin
  on('ui.render', (async ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>engine row</Text>
  }) as never)
  await ($ as any).session.start({ cwd: '/', source: 'startup' }).catch(() => undefined)
  await ($ as any).command.run({ command: 'skin', args: 'dracula' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const row = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolUse', requestId: 't1', props: ROW } as never)
    expect(!!(await row.find({ type: 'Text', text: /❯ Bash/ } as never))).toBe(true)
    expect(!!(await row.find({ type: 'Text', text: /ls -la/ } as never))).toBe(true)
    await row.unmount()
  }

  await ($ as any).command.run({ command: 'skin', args: 'off' })
  const plain = await $.ui.mount({ plugin: 'tool-skins', surface: 'desktop', component: 'ToolUse', requestId: 't1', props: ROW } as never)
  expect(!!(await plain.find({ type: 'Text', text: /❯ Bash/ } as never))).toBe(false)
  await plain.unmount()
})

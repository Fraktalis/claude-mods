import { expect, mock, test } from 'claude-code/testing'

// ponytail: a two-level fake project; tests reach the engine through untyped shapes (`as never`)
const FS: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  '/proj': [
    { name: 'src', kind: 'dir' },
    { name: 'node_modules', kind: 'dir' },
    { name: 'README.md', kind: 'file' },
  ],
  '/proj/src': [
    { name: 'app.ts', kind: 'file' },
    { name: 'util.ts', kind: 'file' },
  ],
}

/** `dirty` is the status of /proj; `others` the status of other repos, by their top folder. */
const world = (on: any, dirty: string, others: Record<string, string> = {}) => {
  mock.clock(on, { now: 10_000 })
  on('session.cwd', (async () => ({ value: '/proj' })) as never)
  on('command.register', (async () => ({ value: {} })) as never)
  on('fs.list', (async (_: unknown, e: { path?: string }) => ({
    // the engine resolves '/proj' to 'C:\proj' on Windows before a hook sees it
    value: (FS[(e.path ?? '/proj').split('\\').join('/').replace(/^[A-Za-z]:/, '')] ?? []).map(x => ({ ...x, size: 0, mtimeMs: 0, isLink: false })),
  })) as never)
  on('fs.exists', (async () => ({ value: true })) as never)
  on('ui.open', (async () => ({ value: {} })) as never)
  on('process.run', (async (_: unknown, e: { argv: string[]; init?: { cwd?: string } }) => {
    // the engine may hand cwd back Windows-style: compare '/'-separated, drive-less paths
    const cwd = (e.init?.cwd ?? '/proj').split('\\').join('/').replace(/^[A-Za-z]:/, '')
    const top = Object.keys(others).find(t => cwd === t || cwd.startsWith(`${t}/`)) ?? '/proj'
    return {
      value: e.argv.includes('rev-parse')
        ? { exitCode: 0, stdout: `${top}\n`, stderr: '' }
        : { exitCode: 0, stdout: top === '/proj' ? dirty : others[top]!, stderr: '' },
    }
  }) as never)
  on('tool.call', (async () => ({ result: {}, text: 'ok' })) as never)
}

const draw = async ($: any, surface: 'terminal' | 'desktop') => {
  const pane = await $.ui.mount({ plugin: 'file-tree', surface, component: 'Pane', requestId: 'file-tree', props: {} } as never)
  const has = async (text: RegExp) => !!(await pane.find({ type: 'Text', text } as never))
  const out = {
    summary: await has(/1 modified · 1 read/),
    nodeModules: !!(await pane.find({ key: 'b:/proj/node_modules' } as never)),
    srcOpened: !!(await pane.find({ key: 'f:/proj/src/app.ts' } as never)),
    modulesClosed: !(await pane.find({ key: 'm:/proj/node_modules' } as never)),
  }
  await pane.unmount()
  return out
}

test('touched files light up and their folder opens; heavy folders stay listed but closed', async ($, on) => {
  world(on, ' M src/app.ts\0')
  await $.tool.call({ tool: 'Read', file_path: 'README.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/app.ts', old_string: 'a', new_string: 'b' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await draw($, surface)).toEqual({ summary: true, nodeModules: true, srcOpened: true, modulesClosed: true })
  }
})

test('a commit turns the edited file committed once git no longer reports it', async ($, on) => {
  world(on, '')
  await $.tool.call({ tool: 'Edit', file_path: 'src/app.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git commit -am "x"' } as never)

  const pane = await $.ui.mount({ plugin: 'file-tree', surface: 'desktop', component: 'Pane', requestId: 'file-tree', props: {} } as never)
  expect(!!(await pane.find({ type: 'Text', text: /1 committed/ } as never))).toBe(true)
  await pane.unmount()
})

test('commits are detected in every repository a touched file lives in', async ($, on) => {
  // /proj still reports app.ts dirty; /other has been committed clean
  world(on, ' M src/app.ts\0', { '/other': '' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/app.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/other/lib.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git -C /other commit -am "x"' } as never)

  const pane = await $.ui.mount({ plugin: 'file-tree', surface: 'desktop', component: 'Pane', requestId: 'file-tree', props: {} } as never)
  expect(!!(await pane.find({ type: 'Text', text: /1 modified · 1 committed/ } as never))).toBe(true)
  expect(!!(await pane.find({ type: 'Text', text: /Elsewhere · 1/ } as never))).toBe(true)
  await pane.unmount()
})

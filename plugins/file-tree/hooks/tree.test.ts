import { expect, test } from 'claude-code/testing'

import { isCommitCommand, keyOf, nextState, norm, parentOf, parsePorcelain } from './register'

test('paths normalize to absolute forward-slash form', () => {
  expect(norm('src\\app.ts', 'C:\\proj')).toBe('C:/proj/src/app.ts')
  expect(norm('c:\\proj\\src\\..\\README.md', '/x')).toBe('C:/proj/README.md')
  expect(norm('./a/./b', '/home/me')).toBe('/home/me/a/b')
  expect(norm('/etc//hosts', 'C:/proj')).toBe('/etc/hosts')
  expect(keyOf('C:/Proj/A.ts')).toBe('c:/proj/a.ts')
  expect(keyOf('/Home/A.ts')).toBe('/Home/A.ts')
})

test('state transitions never downgrade on a read', () => {
  expect(nextState(undefined, 'read')).toBe('read')
  expect(nextState('modified', 'read')).toBe('modified')
  expect(nextState('read', 'edit')).toBe('modified')
  expect(nextState('created', 'edit')).toBe('created')
  expect(nextState('committed', 'edit')).toBe('modified')
  expect(nextState('committed', 'create')).toBe('created')
})

test('git status porcelain -z parsing, renames included', () => {
  const out = ' M src/a.ts\0?? new.txt\0R  b2.ts\0b1.ts\0'
  const dirty = parsePorcelain(out, 'C:/proj')
  expect([...dirty].sort()).toEqual(['c:/proj/b2.ts', 'c:/proj/new.txt', 'c:/proj/src/a.ts'])
})

test('commit commands are recognised, look-alikes are not', () => {
  expect(isCommitCommand('git commit -m "x"')).toBe(true)
  expect(isCommitCommand('git add . && git commit -qam "x"')).toBe(true)
  expect(isCommitCommand('git -C repo commit -m x')).toBe(true)
  expect(isCommitCommand('git log --grep commit')).toBe(false)
  expect(isCommitCommand('echo commit')).toBe(false)
})

test('parent folders, drive roots kept as roots', () => {
  expect(parentOf('C:/proj/src/a.ts')).toBe('C:/proj/src')
  expect(parentOf('C:/a.ts')).toBe('C:/')
  expect(parentOf('/home/me/a.ts')).toBe('/home/me')
  expect(parentOf('/a.ts')).toBe('/')
})

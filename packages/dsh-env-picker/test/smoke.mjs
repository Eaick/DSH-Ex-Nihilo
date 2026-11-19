/** Local smoke test for the pure Host helpers of the env-picker plugin. */
import assert from 'node:assert/strict'
import { __internals } from '../index.js'

const { buildCatalog, defaultsOf, parseArgs, reduce, renderPrompt, summarize } = __internals

const groups = await buildCatalog({})
const defaults = defaultsOf(groups, {})
for (const group of groups) {
  console.log(`[${group.kind}] ${group.options.map(item => `${item.id}=${item.label}`).join(', ')}  default=${defaults.current[group.kind]}`)
}

assert.equal(groups.length, 6, 'expected python, node, c, cpp, java, gdb groups')
const byKind = Object.fromEntries(groups.map(group => [group.kind, group]))
assert.ok(byKind.c.options[0].path.toLowerCase().endsWith('gcc.exe'), 'C group should point at gcc.exe')
assert.ok(byKind.cpp.options[0].path.toLowerCase().endsWith('g++.exe'), 'C++ group should point at g++.exe')
assert.ok(byKind.gdb.options[0].path.toLowerCase().endsWith('gdb.exe'), 'Debugger group should point at gdb.exe')
assert.ok(byKind.java.options[0].path.toLowerCase().endsWith('java.exe'), 'Java option should point at java.exe')

// Parse shapes: report, reset, set, add, remove, enable/disable, show-all.
assert.deepEqual(parseArgs(''), { kind: 'report' })
assert.deepEqual(parseArgs('reset'), { kind: 'reset' })
assert.deepEqual(parseArgs('/env python D2'), { kind: 'set', group: 'python', id: 'D2' })
assert.deepEqual(parseArgs('g++ gcc'), { kind: 'set', group: 'cpp', id: 'gcc' })
assert.deepEqual(parseArgs('add python "我的环境" D:\\envs\\x\\python.exe'), {
  kind: 'add', group: 'python', label: '我的环境', path: 'D:\\envs\\x\\python.exe',
})
assert.deepEqual(parseArgs('remove python d2'), { kind: 'remove', group: 'python', id: 'd2' })
assert.deepEqual(parseArgs('disable java'), { kind: 'disable', group: 'java' })
assert.deepEqual(parseArgs('enable  gdb'), { kind: 'enable', group: 'gdb' })
assert.deepEqual(parseArgs('show all gdb'), { kind: 'showall', group: 'gdb' })
assert.equal(parseArgs('python'), null)
assert.equal(parseArgs('wat base'), null)

// Add a custom environment: it appears, becomes current, and is removable.
let state = { ...defaults, current: { ...defaults.current } }
const added = reduce(groups, defaults, state, { kind: 'add', group: 'python', label: '我的环境', path: 'D:\\envs\\x\\python.exe' })
assert.equal(added.custom.length, 1)
assert.equal(added.current.python, added.custom[0].id)
state = added
const viewOfPython = state => ({ custom: state.custom })
assert.ok(viewOfPython(state).custom.some(item => item.label === '我的环境'))

const removed = reduce(groups, defaults, state, { kind: 'remove', group: 'python', id: state.custom[0].id })
assert.equal(removed.custom.length, 0)
assert.notEqual(removed.current.python, state.custom[0].id)
state = removed

// Hiding a detected environment, then restoring it.
const hidden = reduce(groups, defaults, state, { kind: 'remove', group: 'python', id: byKind.python.options[1].id })
assert.ok(hidden.hidden.includes(`python:${byKind.python.options[1].id}`))
assert.notEqual(hidden.current.python, byKind.python.options[1].id)
const shown = reduce(groups, defaults, hidden, { kind: 'showall', group: 'python' })
assert.equal(shown.hidden.length, 0)

// Enable / disable and reset.
const disabled = reduce(groups, defaults, state, { kind: 'disable', group: 'java' })
assert.equal(disabled.enabled.java, false)
const enabledAgain = reduce(groups, defaults, disabled, { kind: 'enable', group: 'java' })
assert.equal(enabledAgain.enabled.java, true)
const reset = reduce(groups, defaults, state, { kind: 'reset' })
assert.deepEqual(reset.current, defaults.current)

// Prompt honors disabled groups.
const prompt = renderPrompt(groups, disabled)
assert.doesNotMatch(prompt, /Java 环境：/)
assert.match(prompt, /Python 环境：/)
const fullPrompt = renderPrompt(groups, state)
assert.match(fullPrompt, /调试器 环境：/)
console.log('--- prompt (all enabled) ---\n' + fullPrompt + '\n-------------')

const summary = summarize(groups, disabled)
assert.match(summary, /Java：已关闭/)
console.log('--- summary ---\n' + summary)
console.log('host smoke test ok')

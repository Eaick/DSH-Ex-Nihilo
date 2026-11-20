/**
 * Client-half smoke test: evaluate client.js in Node with a stub module loader,
 * run apply() against a fake ctx, and render the dock once.
 *
 * This catches the class of failure that is invisible from the host: a module
 * that evaluates but never registers its slots, or a component that throws on
 * its first render. It does not test React itself.
 */

import assert from 'node:assert/strict'
import { promises as fsp, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await fsp.readFile(path.join(here, '..', 'client.js'), 'utf8')
const packageName = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')).name

let passed = 0
const failures = []
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`FAIL ${name}\n     ${error?.message ?? error}`)
  }
}

/** Minimal React surface the client uses. */
function makeReact(values) {
  const queue = [...values]
  const hooks = {
    useState(initial) {
      const next = queue.length > 0 ? queue.shift() : (typeof initial === 'function' ? initial() : initial)
      return [next, () => {}]
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
  }
  return hooks
}

/** Evaluate the module and return the exported component object. */
function loadClient(reactValues = []) {
  let captured
  const windowStub = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
  }
  const documentStub = {
    head: { appendChild() {} },
    createElement: () => ({ setAttribute() {}, remove() {} }),
    addEventListener() {},
    removeEventListener() {},
  }
  // eslint-disable-next-line no-new-func
  const evaluate = new Function('window', 'document', 'atob', source)
  evaluate(windowStub, documentStub, (value) => Buffer.from(value, 'base64').toString('binary'))
  assert.ok(captured !== undefined, 'the module must call window.__ModuleLoader__.load')
  assert.equal(captured.id, packageName, 'the client factory id must equal the package name')
  const react = makeReact(reactValues)
  const requireStub = (name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require ${name}`)
  }
  return captured.factory(requireStub)
}

await test('client: evaluating the module exports a slots plugin', () => {
  const api = loadClient()
  assert.equal(typeof api.apply, 'function')
  assert.ok(Array.isArray(api.inject), 'inject must list the services the client uses')
})

await test('client: apply registers every slot the plugin owns', () => {
  const api = loadClient()
  const registered = []
  const injections = []
  const ctx = {
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    effect: (fn) => {
      fn()
      return () => {}
    },
    get: () => undefined,
    slots: {
      inject: (names, callback) => {
        injections.push(Array.isArray(names) ? names.join(',') : names)
        callback(ctx)
      },
      register: (options, component) => {
        registered.push({ name: options.name, id: options.id ?? options.key, component })
        return () => {}
      },
    },
    remote: { commands: { execute: async () => ({ ok: true, value: { result: { kind: 'success', text: '' } } }) } },
    sessions: { binding: () => undefined, fork: async () => 'session-child' },
    uiWorkspace: { openSession() {} },
  }
  api.apply(ctx)
  const names = registered.map((entry) => `${entry.name}:${entry.id}`)
  assert.deepEqual(names.sort(), [
    'conversation.chat.assistant-actions:dsh-rewind',
    'conversation.input.dock:rewind-dock',
    'main:dsh-rewind-trash',
    'sidebar.panellist:dsh-rewind-trash',
  ])
  assert.deepEqual(injections.sort(), ['conversation.chat.assistant-actions', 'conversation.input.dock', 'main', 'sidebar.panellist'])
  for (const entry of registered) assert.equal(typeof entry.component, 'function', `${entry.id} must be a component`)
})

await test('client: the dock renders its checkpoint rows', () => {
  const checkpoints = [
    { turn: 5, at: '2026-01-01T00:00:00.000Z', files: 1, open: false, aborted: true, git: false },
    { turn: 3, at: '2026-01-01T00:00:00.000Z', files: 2, open: false, aborted: false, git: false },
  ]
  // useState order: open, checkpoints, error, notice, busy
  const api = loadClient([true, checkpoints, '', '', ''])
  const registered = []
  const ctx = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect: (fn) => { fn(); return () => {} },
    get: () => undefined,
    slots: {
      inject: (names, callback) => callback(ctx),
      register: (options, component) => { registered.push({ options, component }); return () => {} },
    },
    remote: { commands: { execute: async () => ({ ok: true, value: { result: { kind: 'success', text: '' } } }) } },
    sessions: { binding: () => undefined, fork: async () => 'session-child' },
    uiWorkspace: { openSession() {} },
  }
  api.apply(ctx)
  const dock = registered.find((entry) => entry.options.name === 'conversation.input.dock')
  assert.ok(dock !== undefined)
  const tree = dock.component({ sessionId: 'session-x', i18n: (key) => key, rewindList: async () => checkpoints, rewindTurn: async () => undefined })
  assert.ok(tree !== null && tree !== undefined, 'the dock must render when checkpoints exist')
  const text = JSON.stringify(tree)
  assert.match(text, /turnFormat|第/, 'the dock must label its turns')
  assert.match(text, /abortedBadge|已中止/, 'the dock must mark an aborted turn')
})

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} failing, ${passed} passing`)
  process.exitCode = 1
} else {
  console.log(`all ${passed} client tests passing`)
}

/**
 * dsh-rewind Host wiring tests: apply() against a recording fake context.
 *
 * These cover the seam no pure-module test reaches: the route handed to
 * `ctx.connection.fetch` (whose path validation once rejected a relative
 * path), the registered commands and tools, and the provided services.
 */
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-wiring-'))
process.env.DSH_HOME = home
const slug = '--E-Ds--'
const sessionId = 'session-wiring-1'
const keptId = 'session-wiring-2'
await fsp.mkdir(path.join(home, 'sessions', slug, sessionId), { recursive: true })
await fsp.writeFile(path.join(home, 'sessions', slug, sessionId, 'session.v4.jsonl.zstd'), 'log')
await fsp.mkdir(path.join(home, 'sessions', slug, keptId), { recursive: true })
await fsp.writeFile(path.join(home, 'sessions', slug, keptId, 'session.v4.jsonl.zstd'), 'log')

const { apply } = await import('../index.js')

function fakeConnection(record) {
  return {
    fetch: {
      register: (route) => {
        // The real service refuses anything that is not an absolute /api path.
        if (typeof route.path !== 'string' || !route.path.startsWith('/api/')) {
          throw new Error(`connection: invalid exact Fetch route "${route.path}"`)
        }
        record.route = route
        return async () => {}
      },
    },
  }
}

function fakeContext({ connection, injectedConnection, registry, storageDomain, persistence, liveAgents, boundaryOf, agentsById, sessionController } = {}) {
  const wired = { commands: [], tools: [], services: [], route: undefined, injections: [] }
  const ctx = {
    logger: { debug() {}, warn() {}, error() {} },
    fs: {},
    subprocess: {},
    agents: {
      list: () => [],
      get: (id) => (agentsById !== undefined && agentsById[id] !== undefined
        ? agentsById[id]
        : (liveAgents !== undefined && liveAgents.has(id) ? { id, session: { id } } : undefined)),
      turnBoundaryOf: () => (boundaryOf !== undefined ? boundaryOf() : {}),
    },
    commands: { register: (definition) => { wired.commands.push(definition); return () => {} } },
    tools: { register: (definition) => { wired.tools.push(definition); return () => {} } },
    provide: (name, value) => { wired.services.push({ name, value }); return () => {} },
    effect: (callback) => {
      callback()
      return () => {}
    },
    on: () => () => {},
    // Cordis injects a late-composed service: the callback runs once it exists,
    // which is how a cold process start reaches the route and the registry.
    inject: (names, callback) => {
      wired.injections.push([...names])
      callback({ connection: injectedConnection ?? connection, get: ctx.get })
      return () => {}
    },
    get: (name) => {
      if (name === 'connection') return connection
      if (name === 'workspaceRegistry') return registry
      if (name === 'storageDomain') return storageDomain
      if (name === 'sessionPersistence') return persistence
      if (name === 'sessionController') return sessionController
      return undefined
    },
  }
  return { ctx, wired }
}

function setup() {
  const record = {}
  const connection = fakeConnection(record)
  const { ctx, wired } = fakeContext({ connection })
  apply(ctx, {})
  return { ctx, wired, route: record.route }
}

await test('apply: registers the trash route on the shared API channel', async () => {
  const { route } = setup()
  assert.equal(route.path, '/api/dsh-rewind/trash')
  assert.deepEqual([...route.methods].sort(), ['GET', 'HEAD', 'POST'])
  assert.equal(route.requestBody, 'buffered')
  const response = await route.fetch(new Request('http://127.0.0.1/api/dsh-rewind/trash'))
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.limits, { maxCheckpoints: 100, retentionDays: 30 })
})

await test('apply: a relative route path is what the real service rejects', () => {
  assert.throws(
    () => fakeConnection({}).fetch.register({ path: 'dsh-rewind/trash', methods: ['GET'], requestBody: 'buffered', fetch: async () => {} }),
    /invalid exact Fetch route/,
  )
})

await test('apply: a cold start mounts the route when connection arrives, not only when present', async () => {
  const record = {}
  const connection = fakeConnection(record)
  // The real cold-start shape: neither service exists when apply runs.
  const { ctx, wired } = fakeContext({ connection: undefined, injectedConnection: connection })
  apply(ctx, {})
  assert.deepEqual(wired.injections.map((names) => names.join(',')), ['connection', 'workspaceRegistry'])
  assert.equal(record.route.path, '/api/dsh-rewind/trash')
  const response = await record.route.fetch(new Request('http://127.0.0.1/api/dsh-rewind/trash'))
  assert.equal(response.status, 200)
})

await test('apply: provides the rewind and trash services with the documented operations', () => {
  const { wired } = setup()
  const services = new Map(wired.services.map((entry) => [entry.name, entry.value]))
  assert.deepEqual([...services.keys()].sort(), ['rewind', 'trash'])
  for (const method of ['list', 'diff', 'restore']) assert.equal(typeof services.get('rewind')[method], 'function')
  for (const method of ['list', 'discard', 'restore', 'purge', 'purgeAll', 'audit']) {
    assert.equal(typeof services.get('trash')[method], 'function')
  }
})

await test('apply: every trash command and both model tools are registered', () => {
  const { wired } = setup()
  assert.deepEqual(wired.commands.map((definition) => definition.name).sort(), [
    'rewind', 'rewind-list', 'rewind-message', 'rewind-turn', 'trash', 'trash-list', 'trash-prune', 'trash-purge', 'trash-restore',
  ])
  assert.deepEqual(wired.tools.map((definition) => definition.name).sort(), ['rewind', 'trash'])
  const trashTool = wired.tools.find((definition) => definition.name === 'trash')
  assert.deepEqual(trashTool.parameters.properties.action.enum, ['list', 'restore', 'purge', 'prune', 'forget'])
  const rewindTool = wired.tools.find((definition) => definition.name === 'rewind')
  assert.deepEqual(rewindTool.parameters.properties.action.enum, ['list', 'diff', 'restore'])
})

await test('route: an archived Session with its log in place is listed and restorable', async () => {
  const archivedId = 'session-archived-1'
  await fsp.mkdir(path.join(home, 'sessions', slug, archivedId), { recursive: true })
  await fsp.writeFile(path.join(home, 'sessions', slug, archivedId, 'session.v4.jsonl.zstd'), 'log')
  const unarchived = []
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    sessionIds: [archivedId],
    async detachSession() {},
  }
  const registry = {
    list: () => [workspace],
    async unarchiveSession(id) { unarchived.push(id) },
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const storageDomain = {
    get: () => ({
      table: () => ({ get: (id) => (id === 'ws-1' ? { path: 'E:\\Ds', sessionIds: [archivedId] } : undefined) }),
      global: { get: () => ({ archivedSessionIds: [archivedId], pinnedSessionIds: [], workspaceIds: ['ws-1'] }) },
    }),
  }
  const record = {}
  const connection = fakeConnection(record)
  const { ctx } = fakeContext({ connection, registry, storageDomain })
  apply(ctx, {})
  const listResponse = await record.route.fetch(new Request('http://127.0.0.1/api/dsh-rewind/trash'))
  const list = await listResponse.json()
  const row = list.entries.find((entry) => entry.sessionId === archivedId)
  assert.ok(row !== undefined, 'the archived Session is listed')
  assert.equal(row.inPlace, true)
  assert.equal(row.archived, true)
  const restoreResponse = await record.route.fetch(new Request('http://127.0.0.1/api/dsh-rewind/trash', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'unarchive', sessionId: archivedId }),
  }))
  assert.equal(restoreResponse.status, 200)
  assert.deepEqual(unarchived, [archivedId])
  await fsp.rm(path.join(home, 'sessions', slug, archivedId), { recursive: true, force: true })
})

await test('route: an archived Session loaded but idle in this process can be deleted', async () => {
  const archivedId = 'session-archived-idle'
  const dir = path.join(home, 'sessions', slug, archivedId)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'session.v4.jsonl.zstd'), 'log')
  const archivedCalls = []
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    sessionIds: [archivedId],
    async detachSession() {},
  }
  const registry = {
    list: () => [workspace],
    archiveSession: async (id) => { archivedCalls.push(['archive', id]) },
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const storageDomain = {
    get: () => ({
      table: () => ({ get: () => ({ path: 'E:\\Ds', sessionIds: [archivedId] }) }),
      global: { get: () => ({ archivedSessionIds: [archivedId], pinnedSessionIds: [], workspaceIds: ['ws-1'] }) },
    }),
  }
  const record = {}
  const connection = fakeConnection(record)
  // Loaded agent with no open turn: archiving already stopped the work.
  const { ctx } = fakeContext({
    connection, registry, storageDomain, liveAgents: new Set([archivedId]), boundaryOf: () => ({ openTurnStartSeq: null }),
  })
  const parkedFile = path.join(home, 'rewind', 'parked.json')
  const cacheFile = path.join(home, 'storages', 'session_projcache', 'sessions', `${archivedId}.json`)
  try {
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true })
    await fsp.writeFile(cacheFile, JSON.stringify({ version: 7, record: { rows: {} } }), 'utf8')
    apply(ctx, {})
    const response = await record.route.fetch(new Request('http://127.0.0.1/api/dsh-rewind/trash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'purge-in-place', sessionId: archivedId }),
    }))
    assert.equal(response.status, 200)
    await assert.rejects(fsp.stat(dir))
    assert.deepEqual(archivedCalls, [['archive', archivedId]])
    const parked = JSON.parse(await fsp.readFile(parkedFile, 'utf8'))
    assert.ok(parked.ids.includes(archivedId))
    // The cached projection row is what keeps a grey sidebar row alive.
    await assert.rejects(fsp.stat(cacheFile))
  } finally {
    await fsp.rm(parkedFile, { force: true })
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

await test('route: a Session with an open turn refuses permanent deletion', async () => {
  const archivedId = 'session-archived-busy'
  const dir = path.join(home, 'sessions', slug, archivedId)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'session.v4.jsonl.zstd'), 'log')
  const workspace = { id: 'ws-1', path: 'E:\\Ds', sessionIds: [archivedId], async detachSession() {} }
  const registry = {
    list: () => [workspace],
    archiveSession: async () => {},
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const storageDomain = {
    get: () => ({
      table: () => ({ get: () => ({ path: 'E:\\Ds', sessionIds: [archivedId] }) }),
      global: { get: () => ({ archivedSessionIds: [archivedId], pinnedSessionIds: [], workspaceIds: ['ws-1'] }) },
    }),
  }
  const record = {}
  const connection = fakeConnection(record)
  const { ctx } = fakeContext({
    connection, registry, storageDomain, liveAgents: new Set([archivedId]), boundaryOf: () => ({ openTurnStartSeq: 12 }),
  })
  try {
    apply(ctx, {})
    const response = await record.route.fetch(new Request('http://127.0.0.1/api/dsh-rewind/trash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'purge-in-place', sessionId: archivedId }),
    }))
    assert.equal(response.status, 409)
    const payload = await response.json()
    assert.match(payload.error.message, /未结束的回合/)
    await fsp.stat(dir)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

await test('rewind-message: fork mode asks the Host controller for a new Session', async () => {
  const target = keptId
  const requests = []
  const renames = []
  const sessionController = {
    fork: async (request) => {
      requests.push(request)
      return { sessionId: 'session-child-1' }
    },
    rename: async (request) => {
      renames.push(request)
      return { title: request.title, seq: 1 }
    },
  }
  const session = {
    id: target,
    ownEvents: () => [
      { type: 'turn/start', seq: 7, data: { turn: 3 } },
      { type: 'assistant/message', seq: 8, data: { message: { id: 'msg-1' } } },
    ],
  }
  const agent = { id: target, session }
  const { ctx, wired } = fakeContext({
    connection: fakeConnection({}), agentsById: { [target]: agent }, sessionController,
  })
  apply(ctx, {})
  const command = wired.commands.find((definition) => definition.name === 'rewind-message')
  const result = await command.handler({ agent, rawInput: '/rewind-message msg-1 fork' })
  assert.equal(result.kind, 'success', result.text)
  assert.deepEqual(requests, [{ sessionId: target, atSeq: 6 }])
  assert.equal(renames.length, 1)
  assert.equal(renames[0].sessionId, 'session-child-1')
  assert.match(renames[0].title, /\(\d+\)$/)
  const match = /<!--rewind:data:([A-Za-z0-9+/=]+)-->/.exec(result.text)
  assert.ok(match !== null)
  const payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  assert.equal(payload.turn, 3)
  assert.equal(payload.startSeq, 7)
  assert.equal(payload.fork, true)
  assert.equal(payload.childId, 'session-child-1')
})

await test('rewind-message: a missing Host controller fails loudly instead of silently', async () => {
  const target = sessionId
  const session = {
    id: target,
    ownEvents: () => [
      { type: 'turn/start', seq: 3, data: { turn: 2 } },
      { type: 'assistant/message', seq: 4, data: { message: { id: 'msg-2' } } },
    ],
  }
  const agent = { id: target, session }
  const { ctx, wired } = fakeContext({ connection: fakeConnection({}), agentsById: { [target]: agent } })
  apply(ctx, {})
  const command = wired.commands.find((definition) => definition.name === 'rewind-message')
  const result = await command.handler({ agent, rawInput: '/rewind-message msg-2 fork' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /sessionController/)
})

await test('rewind-message: code mode never asks for a fork', async () => {
  const target = sessionId
  const session = {
    id: target,
    ownEvents: () => [
      { type: 'turn/start', seq: 3, data: { turn: 2 } },
      { type: 'assistant/message', seq: 4, data: { message: { id: 'msg-2' } } },
    ],
  }
  const agent = { id: target, session }
  const { ctx, wired } = fakeContext({ connection: fakeConnection({}), agentsById: { [target]: agent } })
  apply(ctx, {})
  const command = wired.commands.find((definition) => definition.name === 'rewind-message')
  const result = await command.handler({ agent, rawInput: '/rewind-message msg-2 code' })
  assert.equal(result.kind, 'success', result.text)
  const match = /<!--rewind:data:([A-Za-z0-9+/=]+)-->/.exec(result.text)
  assert.ok(match !== null)
  const payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  assert.equal(payload.fork, false)
  assert.equal(payload.startSeq, 3)
})

await test('apply: a declared input hint is never empty', () => {
  const { wired } = setup()
  for (const definition of wired.commands) {
    if (definition.input === undefined) continue
    assert.equal(typeof definition.input.hint, 'string', `${definition.name} must declare input.hint`)
    assert.ok(definition.input.hint.length > 0, `${definition.name} must declare a non-empty input.hint`)
  }
})

await test('rewind-list: newest first, and an aborted turn is labelled', async () => {
  const target = 'session-list-1'
  const sessionId = target
  const agent = {
    id: target,
    session: {
      id: target,
      ownEvents: () => [
        { type: 'turn/start', seq: 10, data: { turn: 5 } },
        { type: 'turn/end', seq: 20, data: { turn: 5, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
        { type: 'turn/start', seq: 21, data: { turn: 6 } },
        { type: 'turn/end', seq: 30, data: { turn: 6, reason: { kind: 'completed' } } },
      ],
    },
  }
  const { ctx, wired } = fakeContext({ agentsById: { [target]: agent } })
  const dir = path.join(home, 'rewind', 'sessions', sessionId)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'checkpoints.json'), JSON.stringify({
    version: 1,
    sessionId,
    checkpoints: [
      { turn: 5, at: '2026-01-01T00:00:00.000Z', open: false, files: [{ path: 'a', display: 'a', before: { kind: 'text', sha: 'x', bytes: 1 } }] },
      { turn: 6, at: '2026-01-01T00:05:00.000Z', open: false, files: [] },
    ],
  }), 'utf8')
  apply(ctx, {})
  const command = wired.commands.find((definition) => definition.name === 'rewind-list')
  const result = await command.handler({ agent, rawInput: '/rewind-list' })
  assert.equal(result.kind, 'success', result.text)
  const match = /<!--rewind:data:([A-Za-z0-9+/=]+)-->/.exec(result.text)
  assert.ok(match !== null)
  const payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  assert.deepEqual(payload.checkpoints.map((entry) => entry.turn), [6, 5])
  assert.equal(payload.checkpoints[0].aborted, false)
  assert.equal(payload.checkpoints[1].aborted, true)
  assert.equal(payload.checkpoints[1].files, 1)
  await fsp.rm(path.join(home, 'rewind', 'sessions'), { recursive: true, force: true })
})

await test('rewind-turn: a turn number is enough, no message id required', async () => {
  const target = 'session-turn-1'
  const agent = {
    id: target,
    session: {
      id: target,
      ownEvents: () => [
        { type: 'turn/start', seq: 7, data: { turn: 3 } },
        { type: 'assistant/message', seq: 8, data: { message: { id: 'msg-1' } } },
      ],
    },
  }
  const { ctx, wired } = fakeContext({ agentsById: { [target]: agent } })
  apply(ctx, {})
  const command = wired.commands.find((definition) => definition.name === 'rewind-turn')
  const result = await command.handler({ agent, rawInput: '/rewind-turn 3 code' })
  assert.equal(result.kind, 'success', result.text)
  const match = /<!--rewind:data:([A-Za-z0-9+/=]+)-->/.exec(result.text)
  assert.ok(match !== null)
  const payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  assert.equal(payload.turn, 3)
  assert.equal(payload.startSeq, 7)
  assert.equal(payload.fork, false)
})

await test('rewind-turn: a turn the log does not contain is refused', async () => {
  const target = 'session-turn-2'
  const agent = { id: target, session: { id: target, ownEvents: () => [{ type: 'turn/start', seq: 1, data: { turn: 1 } }] } }
  const { ctx, wired } = fakeContext({ agentsById: { [target]: agent } })
  apply(ctx, {})
  const command = wired.commands.find((definition) => definition.name === 'rewind-turn')
  const result = await command.handler({ agent, rawInput: '/rewind-turn 9 code' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /找不到第 9 轮/)
})

await test('ghosts: an accounted Session without a log is found and pruned', async () => {
  const detached = []
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    sessionIds: ['session-ghost', keptId],
    async detachSession(id) {
      detached.push(id)
      this.sessionIds = this.sessionIds.filter((candidate) => candidate !== id)
    },
  }
  const registry = {
    list: () => [workspace],
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const { ctx, wired } = fakeContext({ connection: fakeConnection({}), registry })
  apply(ctx, {})
  const service = wired.services.find((entry) => entry.name === 'trash').value
  const found = await service.ghosts()
  assert.deepEqual(found.map((ghost) => ghost.sessionId), ['session-ghost'])
  assert.equal(found[0].workspacePath, 'E:\\Ds')
  const result = await service.pruneGhosts()
  assert.deepEqual(result.removed, ['session-ghost'])
  assert.deepEqual(detached, ['session-ghost'])
  assert.deepEqual((await service.ghosts()).map((ghost) => ghost.sessionId), [])
})

await test('ghosts: an account the filtered view hides is still found and removed', async () => {
  const detached = []
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    // The registry's public view hides the id; the stored record still has it.
    sessionIds: [],
    async detachSession(id) {
      detached.push(id)
    },
  }
  const registry = {
    list: () => [workspace],
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const records = { 'ws-1': { path: 'E:\\Ds', sessionIds: ['session-hidden'] } }
  const storageDomain = {
    get: () => ({ table: () => ({ get: (id) => records[id] }) }),
  }
  const { ctx, wired } = fakeContext({ connection: fakeConnection({}), registry, storageDomain })
  apply(ctx, {})
  const service = wired.services.find((entry) => entry.name === 'trash').value
  assert.deepEqual((await service.ghosts()).map((ghost) => ghost.sessionId), ['session-hidden'])
  const result = await service.pruneGhosts()
  assert.deepEqual(result.removed, ['session-hidden'])
  assert.deepEqual(detached, ['session-hidden'])
})

await test('ghosts: Session persistence decides, and a live agent does not hide a ghost', async () => {
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    sessionIds: ['session-ghost', 'session-healthy'],
    async detachSession() {},
  }
  const registry = {
    list: () => [workspace],
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  // Persistence still holds the healthy one; the ghost is reported even though
  // this profile keeps an agent for every accounted Session.
  const persistence = { stat: async (id) => (id === 'session-healthy' ? { header: { id } } : undefined) }
  const { ctx, wired } = fakeContext({
    connection: fakeConnection({}),
    registry,
    persistence,
    liveAgents: new Set(['session-ghost']),
  })
  apply(ctx, {})
  const service = wired.services.find((entry) => entry.name === 'trash').value
  assert.deepEqual((await service.ghosts()).map((ghost) => ghost.sessionId), ['session-ghost'])
})

await test('apply: a parked deletion is detached when the next process starts', async () => {
  const detached = []
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    sessionIds: ['session-parked'],
    async detachSession(id) { detached.push(id) },
  }
  const registry = {
    list: () => [workspace],
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const parkedFile = path.join(home, 'rewind', 'parked.json')
  await fsp.mkdir(path.join(home, 'rewind'), { recursive: true })
  await fsp.writeFile(parkedFile, JSON.stringify({ version: 1, ids: ['session-parked'] }), 'utf8')
  try {
    const { ctx } = fakeContext({ connection: fakeConnection({}), registry })
    apply(ctx, {})
    for (let attempt = 0; attempt < 100 && detached.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.deepEqual(detached, ['session-parked'])
    const parked = JSON.parse(await fsp.readFile(parkedFile, 'utf8'))
    assert.deepEqual(parked.ids, [])
  } finally {
    await fsp.rm(parkedFile, { force: true })
  }
})

await test('route: a page read finishes a parked deletion whose agent is gone', async () => {
  const parkedId = 'session-parked-get'
  const detached = []
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    sessionIds: [parkedId],
    async detachSession(id) { detached.push(id) },
  }
  const registry = {
    list: () => [workspace],
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const parkedFile = path.join(home, 'rewind', 'parked.json')
  const record = {}
  const connection = fakeConnection(record)
  try {
    const { ctx } = fakeContext({ connection, registry })
    apply(ctx, {})
    // Let the activation sweep finish on an empty list, then park the id.
    await new Promise((resolve) => setTimeout(resolve, 30))
    await fsp.mkdir(path.join(home, 'rewind'), { recursive: true })
    await fsp.writeFile(parkedFile, JSON.stringify({ version: 1, ids: [parkedId] }), 'utf8')
    const response = await record.route.fetch(new Request('http://127.0.0.1/api/dsh-rewind/trash'))
    assert.equal(response.status, 200)
    assert.ok(detached.includes(parkedId))
    const parked = JSON.parse(await fsp.readFile(parkedFile, 'utf8'))
    assert.deepEqual(parked.ids, [])
  } finally {
    await fsp.rm(parkedFile, { force: true })
  }
})

await test('trash command: an accounted Session with no log is removed from the sidebar', async () => {
  const detached = []
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    sessionIds: ['session-ghost'],
    async detachSession(id) {
      detached.push(id)
      this.sessionIds = this.sessionIds.filter((candidate) => candidate !== id)
    },
  }
  const registry = {
    list: () => [workspace],
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const { ctx, wired } = fakeContext({ connection: fakeConnection({}), registry })
  apply(ctx, {})
  const command = wired.commands.find((definition) => definition.name === 'trash')
  const removed = await command.handler({ rawInput: `/trash session-ghost`, agent: { id: keptId } })
  assert.equal(removed.kind, 'success')
  assert.match(removed.text, /已从侧栏移除/)
  assert.deepEqual(detached, ['session-ghost'])
  const unknown = await command.handler({ rawInput: '/trash session-unknown', agent: { id: keptId } })
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /trash-prune/)
})

await test('trash tool: prune reports nothing to clean and names what it removed', async () => {
  const workspace = {
    id: 'ws-1',
    path: 'E:\\Ds',
    sessionIds: [],
    async detachSession(id) { this.sessionIds = this.sessionIds.filter((candidate) => candidate !== id) },
  }
  const registry = {
    list: () => [workspace],
    unarchiveSession: async () => {},
    unpinSession: async () => {},
    resolveByPath: async () => workspace,
  }
  const { ctx, wired } = fakeContext({ connection: fakeConnection({}), registry })
  apply(ctx, {})
  const tool = wired.tools.find((definition) => definition.name === 'trash')
  const empty = await tool.execute({ action: 'prune' })
  assert.match(empty.text, /没有失效条目/)
  workspace.sessionIds = ['session-ghost']
  const pruned = await tool.execute({ action: 'prune' })
  assert.match(pruned.text, /已清理 1 个失效条目/)
  assert.match(pruned.text, /session-ghost/)
})

await test('trash tool: list sees an entry the service discarded, and purge removes it', async () => {
  const { wired } = setup()
  const tool = wired.tools.find((definition) => definition.name === 'trash')
  const before = await tool.execute({ action: 'list' })
  assert.match(before.text, /回收站是空的/)

  const service = wired.services.find((entry) => entry.name === 'trash').value
  assert.equal((await service.discard(sessionId, { title: 'wired' })).ok, true)
  const listed = await tool.execute({ action: 'list' })
  assert.match(listed.text, new RegExp(sessionId))
  assert.match(listed.text, /wired/)

  const purged = await tool.execute({ action: 'purge', sessionId })
  assert.match(purged.text, /已彻底删除/)
  const after = await tool.execute({ action: 'list' })
  assert.match(after.text, /回收站是空的/)
})

await test('trash tool: restore and purge without a session id answer with usage, not a throw', async () => {
  const { wired } = setup()
  const tool = wired.tools.find((definition) => definition.name === 'trash')
  const missing = await tool.execute({ action: 'restore' })
  assert.match(missing.text, /需要 sessionId/)
  const unknown = await tool.execute({ action: 'explode' })
  assert.match(unknown.text, /未知 action/)
})

await test('apply: without a connection service the plugin still loads', () => {
  const { ctx, wired } = fakeContext({ connection: undefined })
  apply(ctx, {})
  assert.equal(wired.route, undefined)
  assert.ok(wired.tools.some((definition) => definition.name === 'trash'))
})

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} failing, ${passed} passing`)
  process.exitCode = 1
} else {
  console.log(`all ${passed} wiring tests passing`)
}

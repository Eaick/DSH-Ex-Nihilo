/**
 * dsh-rewind trash API tests: the JSON route over a real TrashStore in a
 * temporary directory, with Fetch Request/Response objects and no server.
 */
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TrashStore } from '../lib/trash.js'
import { TRASH_API_PATH, TRASH_API_ROUTE, TRASH_API_VERSION, entryView, handleTrashApi } from '../lib/trash-api.js'

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

async function fixture(options = {}) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-api-'))
  const sessionsRoot = path.join(home, 'sessions')
  const rewindRoot = path.join(home, 'rewind', 'sessions')
  const slug = '--E-Ds--'
  const sessionId = 'session-api-1'
  await fsp.mkdir(path.join(sessionsRoot, slug, sessionId), { recursive: true })
  await fsp.writeFile(path.join(sessionsRoot, slug, sessionId, 'session.v4.jsonl.zstd'), 'log')
  const calls = []
  const registry = {
    async archive(id) { calls.push(['archive', id]) },
    async unarchive(id) { calls.push(['unarchive', id]) },
  }
  const trash = new TrashStore({ root: path.join(home, 'rewind', 'trash'), sessionsRoot, rewindRoot, registry, warn: () => {} })
  await trash.discard(sessionId, { title: 'demo', workspacePath: 'E:\\Ds' })
  calls.length = 0
  const limits = { maxCheckpoints: 100, retentionDays: 30 }
  const ghostState = { items: [] }
  const archiveState = { items: [] }
  const unarchived = []
  const purgedInPlace = []
  const ghosts = async () => ghostState.items
  const archived = async () => archiveState.items
  const unarchive = async (id) => {
    unarchived.push(id)
    return { ok: true }
  }
  const purgeInPlace = async (id) => {
    purgedInPlace.push(id)
    return options.purgeInPlaceResult ?? { ok: true }
  }
  const pruneGhosts = async () => {
    const removed = ghostState.items.map((ghost) => ghost.sessionId)
    ghostState.items = []
    return { removed, failed: [] }
  }
  const call = async (method, body) => {
    const init = method === 'GET' || method === 'HEAD' ? { method } : {
      method,
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
    const response = await handleTrashApi(new Request(`http://127.0.0.1${TRASH_API_PATH}`, init), {
      trash, limits, warn: () => {}, ghosts, pruneGhosts, archived, unarchive, purgeInPlace,
      titleOf: async (id) => (id === sessionId ? '缓存标题' : undefined),
    })
    return { status: response.status, payload: await response.json(), headers: response.headers }
  }
  return {
    home, trash, calls, limits, call, sessionId, ghostState, archiveState, unarchived, purgedInPlace, sessionsRoot, slug,
  }
}

await test('GET: an entry stored without a title is labelled from the resolver', async () => {
  const { call, trash, sessionId } = await fixture()
  const manifest = await trash.readManifest(sessionId)
  manifest.title = ''
  await trash.writeManifest(sessionId, manifest)
  const { payload } = await call('GET')
  assert.equal(payload.entries[0].title, '缓存标题')
})

await test('POST discard: moves a session into the trash and returns the new list', async () => {
  const { call, trash, sessionsRoot, slug } = await fixture()
  const fresh = 'session-discard-1'
  await fsp.mkdir(path.join(sessionsRoot, slug, fresh), { recursive: true })
  await fsp.writeFile(path.join(sessionsRoot, slug, fresh, 'session.v4.jsonl.zstd'), 'log')
  const { status, payload } = await call('POST', { action: 'discard', sessionId: fresh })
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.action, 'discard')
  assert.ok(payload.entries.some((entry) => entry.sessionId === fresh))
  assert.equal(await trash.entryExists(fresh), true)
})

await test('POST discard: a session already in the trash answers 409', async () => {
  const { call, sessionId } = await fixture()
  const { status, payload } = await call('POST', { action: 'discard', sessionId })
  assert.equal(status, 409)
  assert.equal(payload.error.code, 'discard')
})

await test('GET: archived Sessions with their log in place are listed beside the copies', async () => {
  const { call, archiveState } = await fixture()
  archiveState.items = [{
    sessionId: 'session-archived',
    title: '旧会话',
    at: '2026-11-17T12:00:00.000Z',
    status: 'archived',
    workspacePath: 'E:\\Ds',
    archived: true,
    inPlace: true,
    live: false,
  }]
  const { payload } = await call('GET')
  const row = payload.entries.find((entry) => entry.sessionId === 'session-archived')
  assert.ok(row !== undefined)
  assert.equal(row.inPlace, true)
  assert.equal(row.title, '旧会话')
  assert.equal(row.archived, true)
})

await test('POST unarchive: restores an archived Session without touching a copy', async () => {
  const { call, unarchived, archiveState } = await fixture()
  archiveState.items = []
  const { status, payload } = await call('POST', { action: 'unarchive', sessionId: 'session-archived' })
  assert.equal(status, 200)
  assert.equal(payload.action, 'unarchive')
  assert.deepEqual(unarchived, ['session-archived'])
})

await test('POST purge-in-place: deletes an archived Session log for good', async () => {
  const { call, purgedInPlace } = await fixture()
  const { status, payload } = await call('POST', { action: 'purge-in-place', sessionId: 'session-archived' })
  assert.equal(status, 200)
  assert.equal(payload.action, 'purge-in-place')
  assert.deepEqual(purgedInPlace, ['session-archived'])
})

await test('route: the Host form is absolute below /api and the browser form is relative', () => {
  assert.equal(TRASH_API_PATH, '/api/dsh-rewind/trash')
  assert.equal(TRASH_API_ROUTE, 'api/dsh-rewind/trash')
})

await test('GET: lists entries with the retention limits and no live-session fields', async () => {
  const { call, sessionId, limits } = await fixture()
  const { status, payload, headers } = await call('GET')
  assert.equal(status, 200)
  assert.equal(headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(payload.version, TRASH_API_VERSION)
  assert.equal(payload.ok, true)
  assert.equal(payload.entries.length, 1)
  assert.equal(payload.entries[0].sessionId, sessionId)
  assert.equal(payload.entries[0].title, 'demo')
  assert.equal(payload.entries[0].originalSessionDir, undefined)
  assert.deepEqual(payload.limits, limits)
  assert.deepEqual(payload.problems, [])
  assert.deepEqual(payload.ghosts, [])
})

await test('GET: sidebar ghosts are listed beside the entries', async () => {
  const { call, ghostState } = await fixture()
  ghostState.items = [{ sessionId: 'session-ghost', workspacePath: 'E:\\Ds' }]
  const { payload } = await call('GET')
  assert.equal(payload.entries.length, 1)
  assert.deepEqual(payload.ghosts, [{ sessionId: 'session-ghost', workspacePath: 'E:\\Ds' }])
})

await test('POST prune-ghosts: detaches the ghosts and returns the new snapshot', async () => {
  const { call, ghostState } = await fixture()
  ghostState.items = [{ sessionId: 'session-ghost', workspacePath: 'E:\\Ds' }]
  const { status, payload } = await call('POST', { action: 'prune-ghosts' })
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.removed, ['session-ghost'])
  assert.deepEqual(payload.ghosts, [])
  assert.equal(payload.entries.length, 1)
})

await test('HEAD: answers like GET', async () => {
  const { call } = await fixture()
  const { status, payload } = await call('HEAD')
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
})

await test('POST restore: puts the session back and unarchives it', async () => {
  const { call, trash, calls, sessionId } = await fixture()
  const { status, payload } = await call('POST', { action: 'restore', sessionId })
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.action, 'restore')
  assert.deepEqual(payload.entries, [])
  assert.deepEqual(calls, [['unarchive', sessionId]])
  assert.equal(await trash.entryExists(sessionId), false)
})

await test('POST purge: unarchives before removing the trash copy', async () => {
  const { call, trash, calls, sessionId } = await fixture()
  const { status, payload } = await call('POST', { action: 'purge', sessionId })
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  assert.deepEqual(calls, [['unarchive', sessionId]])
  assert.equal(await trash.entryExists(sessionId), false)
})

await test('POST purge: a registry failure is reported and the copy is kept', async () => {
  const { call, trash, sessionId } = await fixture()
  trash.registry = { unarchive: async () => { throw new Error('registry busy') } }
  const { status, payload } = await call('POST', { action: 'purge', sessionId })
  assert.equal(status, 409)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'purge')
  assert.match(payload.error.message, /registry busy/)
  assert.equal(await trash.entryExists(sessionId), true)
})

await test('POST purge-all: empties the trash and reports what it removed', async () => {
  const { call, trash, sessionId } = await fixture()
  const { status, payload } = await call('POST', { action: 'purge-all' })
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.purged, [sessionId])
  assert.deepEqual(payload.failed, [])
  assert.deepEqual(payload.entries, [])
  assert.deepEqual(await trash.list(), [])
})

await test('POST purge-all: also deletes the archived rows the page lists', async () => {
  const { call, trash, sessionId, archiveState, purgedInPlace } = await fixture()
  archiveState.items = [
    { sessionId: 'session-archived-1', inPlace: true, live: false },
    { sessionId: 'session-running-1', inPlace: true, live: true },
  ]
  const { status, payload } = await call('POST', { action: 'purge-all' })
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.purged, [sessionId, 'session-archived-1'])
  assert.deepEqual(payload.skipped, ['session-running-1'])
  assert.deepEqual(purgedInPlace, ['session-archived-1'])
  assert.deepEqual(await trash.list(), [])
})

await test('POST purge-all: a failed archived deletion is reported, not swallowed', async () => {
  const { call, archiveState } = await fixture({ purgeInPlaceResult: { ok: false, error: 'busy' } })
  archiveState.items = [{ sessionId: 'session-archived-2', inPlace: true, live: false }]
  const { status, payload } = await call('POST', { action: 'purge-all' })
  assert.equal(status, 200)
  assert.deepEqual(payload.purged, ['session-api-1'])
  assert.deepEqual(payload.failed, [{ sessionId: 'session-archived-2', error: 'busy' }])
})

await test('POST: unknown action, missing session and a non-JSON body are 400s', async () => {
  const { call } = await fixture()
  const unknown = await call('POST', { action: 'explode' })
  assert.equal(unknown.status, 400)
  assert.equal(unknown.payload.error.code, 'bad-action')
  const missing = await call('POST', { action: 'restore' })
  assert.equal(missing.status, 400)
  assert.equal(missing.payload.error.code, 'bad-session')
  const junk = await call('POST', 'not json')
  assert.equal(junk.status, 400)
  assert.equal(junk.payload.error.code, 'bad-json')
})

await test('POST: an entry that is not in the trash is a 409 with the store reason', async () => {
  const { call } = await fixture()
  const { status, payload } = await call('POST', { action: 'restore', sessionId: 'session-nope' })
  assert.equal(status, 409)
  assert.match(payload.error.message, /没有这个会话/)
})

await test('DELETE: is refused with 405', async () => {
  const { call } = await fixture()
  const { status, payload } = await call('DELETE')
  assert.equal(status, 405)
  assert.equal(payload.error.code, 'method')
})

await test('entryView: normalizes a hostile manifest record', () => {
  assert.deepEqual(entryView(undefined), {
    sessionId: '', title: '', at: '', status: 'trashed', workspacePath: '', archived: false, inPlace: false, live: false,
  })
  assert.deepEqual(entryView({ sessionId: 42, title: null, at: 'x', archived: 'yes' }), {
    sessionId: '', title: '', at: 'x', status: 'trashed', workspacePath: '', archived: false, inPlace: false, live: false,
  })
  assert.deepEqual(entryView({ sessionId: 'a', inPlace: true, live: true }).inPlace, true)
})

await test('GET: audit problems are reported instead of thrown', async () => {
  const { call, trash, sessionId } = await fixture()
  await fsp.rm(path.join(trash.entryDir(sessionId), 'session'), { recursive: true, force: true })
  const { status, payload } = await call('GET')
  assert.equal(status, 200)
  assert.equal(payload.problems.length, 1)
  assert.equal(payload.problems[0].sessionId, sessionId)
})

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} failing, ${passed} passing`)
  process.exitCode = 1
} else {
  console.log(`all ${passed} trash API tests passing`)
}

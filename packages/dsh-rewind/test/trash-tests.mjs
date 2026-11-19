/**
 * dsh-rewind trash tests: a temporary directory tree standing in for the
 * harness home, plus a fake workspace registry.
 */
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TrashStore } from '../lib/trash.js'

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

async function fixture() {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-trash-'))
  const sessionsRoot = path.join(home, 'sessions')
  const rewindRoot = path.join(home, 'rewind', 'sessions')
  const slug = '--E-Ds--'
  const sessionId = 'session-test-1'
  await fsp.mkdir(path.join(sessionsRoot, slug, sessionId), { recursive: true })
  await fsp.writeFile(path.join(sessionsRoot, slug, sessionId, 'session.v4.jsonl.zstd'), 'log')
  await fsp.mkdir(path.join(rewindRoot, sessionId, 'objects'), { recursive: true })
  await fsp.writeFile(path.join(rewindRoot, sessionId, 'checkpoints.json'), '{}')
  const calls = []
  const registry = {
    async archive(id) { calls.push(['archive', id]) },
    async unarchive(id) { calls.push(['unarchive', id]) },
    async unpin(id) { calls.push(['unpin', id]) },
    async detach(id) { calls.push(['detach', id]); return true },
    async workspacePathOf(id) { return 'E:\\Ds' },
    async attach(id, workspacePath) { calls.push(['attach', id, workspacePath]); return true },
  }
  const store = new TrashStore({
    root: path.join(home, 'rewind', 'trash'),
    sessionsRoot,
    rewindRoot,
    registry,
    titleOf: async (id) => (id === sessionId ? '演示会话' : undefined),
    warn: () => {},
  })
  return { home, sessionsRoot, rewindRoot, slug, sessionId, calls, store }
}

await test('discard: archives and moves the session and its snapshots', async () => {
  const { store, calls, sessionId, sessionsRoot, rewindRoot, slug } = await fixture()
  const result = await store.discard(sessionId, { title: 't' })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [['archive', sessionId]])
  await assert.rejects(fsp.stat(path.join(sessionsRoot, slug, sessionId)))
  await assert.rejects(fsp.stat(path.join(rewindRoot, sessionId)))
  const manifest = await store.readManifest(sessionId)
  assert.equal(manifest.status, 'trashed')
  assert.equal(manifest.archived, true)
  assert.equal(manifest.title, 't')
  assert.equal((await fsp.stat(path.join(store.entryDir(sessionId), 'session'))).isDirectory(), true)
  assert.equal((await fsp.stat(path.join(store.entryDir(sessionId), 'rewind'))).isDirectory(), true)
})

await test('discard: a second call refuses instead of overwriting', async () => {
  const { store, sessionId } = await fixture()
  assert.equal((await store.discard(sessionId)).ok, true)
  const second = await store.discard(sessionId)
  assert.equal(second.ok, false)
  assert.match(second.error, /已在回收站/)
})

await test('discard: an unknown session fails without touching the registry', async () => {
  const { store, calls } = await fixture()
  const result = await store.discard('session-missing')
  assert.equal(result.ok, false)
  assert.deepEqual(calls, [])
})

await test('discard: a failed archive leaves the session in place', async () => {
  const { store, sessionsRoot, slug, sessionId } = await fixture()
  store.registry = { archive: async () => { throw new Error('registry down') } }
  const result = await store.discard(sessionId)
  assert.equal(result.ok, false)
  assert.match(result.error, /registry down/)
  assert.equal((await fsp.stat(path.join(sessionsRoot, slug, sessionId))).isDirectory(), true)
  assert.equal(await store.entryExists(sessionId), false)
})

await test('discard: records the workspace a later restore needs', async () => {
  const { store, sessionId } = await fixture()
  const result = await store.discard(sessionId)
  assert.equal(result.entry.workspacePath, 'E:\\Ds')
})

await test('discard: resolves the display title when the caller has none', async () => {
  const { store, sessionId } = await fixture()
  const result = await store.discard(sessionId)
  assert.equal(result.entry.title, '演示会话')
})

await test('restore: moves everything back, unarchives and re-attaches', async () => {
  const { store, calls, sessionId, sessionsRoot, rewindRoot, slug } = await fixture()
  await store.discard(sessionId)
  calls.length = 0
  const result = await store.restore(sessionId)
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [['unarchive', sessionId], ['attach', sessionId, 'E:\\Ds']])
  assert.equal((await fsp.stat(path.join(sessionsRoot, slug, sessionId, 'session.v4.jsonl.zstd'))).isFile(), true)
  assert.equal((await fsp.stat(path.join(rewindRoot, sessionId, 'checkpoints.json'))).isFile(), true)
  assert.equal(await store.entryExists(sessionId), false)
})

await test('restore: a refused re-attach still restores the files', async () => {
  const { store, sessionId, sessionsRoot, slug } = await fixture()
  await store.discard(sessionId)
  store.registry = {
    unarchive: async () => {},
    attach: async () => { throw new Error('registry is read-only') },
  }
  const result = await store.restore(sessionId)
  assert.equal(result.ok, true)
  assert.equal((await fsp.stat(path.join(sessionsRoot, slug, sessionId))).isDirectory(), true)
})

await test('restore: refuses an entry that is not in trash', async () => {
  const { store } = await fixture()
  assert.equal((await store.restore('nope')).ok, false)
})

await test('purge: removes the trash copy and never the live session', async () => {
  const { store, sessionId } = await fixture()
  await store.discard(sessionId)
  const result = await store.purge(sessionId)
  assert.equal(result.ok, true)
  assert.equal(await store.entryExists(sessionId), false)
})

await test('purge: detaches the workspace account before deleting the copy', async () => {
  const { store, calls, sessionId } = await fixture()
  await store.discard(sessionId)
  calls.length = 0
  const result = await store.purge(sessionId)
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [['detach', sessionId], ['unarchive', sessionId], ['unpin', sessionId]])
  assert.equal(await store.entryExists(sessionId), false)
})

await test('purge: a failed detach keeps the copy and reports why', async () => {
  const { store, sessionId } = await fixture()
  await store.discard(sessionId)
  store.registry = {
    detach: async () => { throw new Error('registry busy') },
    unarchive: async () => { throw new Error('unexpected') },
    unpin: async () => { throw new Error('unexpected') },
  }
  const result = await store.purge(sessionId)
  assert.equal(result.ok, false)
  assert.match(result.error, /registry busy/)
  assert.equal(await store.entryExists(sessionId), true)
})

await test('purge: a Session this process holds parks instead of detaching', async () => {
  const { store, calls, sessionId } = await fixture()
  await store.discard(sessionId)
  calls.length = 0
  const parked = []
  store.registry = {
    ...store.registry,
    isLive: async () => true,
    park: async (id) => { parked.push(id) },
  }
  const result = await store.purge(sessionId)
  assert.equal(result.ok, true)
  assert.equal(result.parked, true)
  assert.deepEqual(calls, [['archive', sessionId]])
  assert.deepEqual(parked, [sessionId])
  assert.equal(await store.entryExists(sessionId), false)
})

await test('purge: a failed removal leaves no sidebar ghost and stays retryable', async () => {
  const { store, calls, sessionId } = await fixture()
  await store.discard(sessionId)
  calls.length = 0
  const original = fsp.rm
  fsp.rm = async (target, options) => {
    if (String(target).startsWith(store.root)) throw new Error('EBUSY: entry is busy')
    return original(target, options)
  }
  try {
    const result = await store.purge(sessionId)
    assert.equal(result.ok, false)
    assert.match(result.error, /仍在回收站/)
    assert.deepEqual(calls, [['detach', sessionId], ['unarchive', sessionId], ['unpin', sessionId]])
    const manifest = await store.readManifest(sessionId)
    assert.equal(manifest.archived, false)
  } finally {
    fsp.rm = original
  }
})

await test('purgeAll: purges every listed entry and reports failures', async () => {
  const { store, sessionId } = await fixture()
  await store.discard(sessionId, { title: 'only' })
  const result = await store.purgeAll()
  assert.deepEqual(result.purged, [sessionId])
  assert.deepEqual(result.failed, [])
  assert.deepEqual(await store.list(), [])
})

await test('list: returns newest first and audit reports drift', async () => {
  const { store, sessionId } = await fixture()
  await store.discard(sessionId, { title: 'old' })
  const entries = await store.list()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].sessionId, sessionId)
  await fsp.rm(path.join(store.entryDir(sessionId), 'session'), { recursive: true, force: true })
  const audit = await store.audit()
  assert.equal(audit.problems.length, 1)
})

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} failing, ${passed} passing`)
  process.exitCode = 1
} else {
  console.log(`all ${passed} trash tests passing`)
}

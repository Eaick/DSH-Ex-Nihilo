/**
 * dsh-rewind unit tests: no Host, no browser.
 *
 * Run from the package directory:
 *   node test/run-tests.mjs
 */
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RewindStore } from '../lib/store.js'
import { SessionRecorder } from '../lib/recorder.js'
import { captureBefore, diffPlan, planRestore, restoreFiles } from '../lib/files.js'
import { formatDiff, formatList, formatRestore, parseTurn, readArgument } from '../lib/commands.js'
import { promptForTurn } from '../lib/prompt.js'

let passed = 0
const failures = []
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1
      console.log(`ok   ${name}`)
    })
    .catch((error) => {
      failures.push({ name, error })
      console.log(`FAIL ${name}\n     ${error?.message ?? error}`)
    })
}

function target(p) {
  return { targetKey: p, displayPath: p }
}

/** Minimal composed-filesystem double. Entries: file | dir | symlink. */
function makeFs(initial) {
  const entries = new Map()
  for (const [p, entry] of Object.entries(initial)) entries.set(p, { ...entry })
  const calls = []
  const fs = {
    calls,
    entries,
    async resolve(p) {
      return target(p)
    },
    processPath(t) {
      return t.targetKey
    },
    async lstat(p) {
      const entry = entries.get(p)
      return entry === undefined ? undefined : { type: entry.type, version: `v:${p}` }
    },
    async stat(t) {
      const entry = entries.get(t.targetKey)
      if (entry === undefined) return undefined
      return { type: entry.type, version: `v:${t.targetKey}`, size: entry.text === undefined ? undefined : Buffer.byteLength(entry.text) }
    },
    async readText(t) {
      const entry = entries.get(t.targetKey)
      if (entry === undefined) throw new Error('FS_NOT_FOUND')
      if (entry.type !== 'file') throw new Error('FS_NOT_REGULAR_FILE')
      if (entry.unreadable === true) throw new Error('FS_BINARY')
      return entry.text
    },
    async writeText(t, text) {
      calls.push(['write', t.targetKey, text])
      entries.set(t.targetKey, { type: 'file', text })
      return { operation: 'update', version: 'v', before: null, after: text }
    },
    async deleteFile(t) {
      calls.push(['delete', t.targetKey])
      if (!entries.has(t.targetKey)) throw new Error('FS_STALE_VERSION')
      entries.delete(t.targetKey)
      return { before: null }
    },
  }
  return fs
}

async function freshStore() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-test-'))
  return { store: new RewindStore(dir), dir }
}

async function makeBlob(store, sessionId, text) {
  return store.putBlob(sessionId, text)
}

// ---------------------------------------------------------------- capture

await test('capture: absent target reads as absent', async () => {
  const fs = makeFs({})
  assert.deepEqual(await captureBefore(fs, target('/missing.txt'), 1024), { kind: 'absent' })
})

await test('capture: regular file keeps its exact text', async () => {
  const fs = makeFs({ '/a.txt': { type: 'file', text: 'hello\nworld\n' } })
  assert.deepEqual(await captureBefore(fs, target('/a.txt'), 1024), { kind: 'text', text: 'hello\nworld\n' })
})

await test('capture: directory is unsupported', async () => {
  const fs = makeFs({ '/dir': { type: 'directory' } })
  const captured = await captureBefore(fs, target('/dir'), 1024)
  assert.equal(captured.kind, 'unsupported')
})

await test('capture: file larger than the cap is unsupported', async () => {
  const fs = makeFs({ '/big.txt': { type: 'file', text: 'x'.repeat(64) } })
  const captured = await captureBefore(fs, target('/big.txt'), 16)
  assert.equal(captured.kind, 'unsupported')
  assert.match(captured.reason, /larger than 16 bytes/)
})

await test('capture: binary/unreadable content is unsupported, not lost', async () => {
  const fs = makeFs({ '/bin.dat': { type: 'file', text: '', unreadable: true } })
  const captured = await captureBefore(fs, target('/bin.dat'), 1024)
  assert.equal(captured.kind, 'unsupported')
  assert.match(captured.reason, /not readable as text/)
})

// ---------------------------------------------------------------- plan

await test('plan: earliest capture at or after the floor wins', async () => {
  const checkpoints = [
    { turn: 1, files: [{ path: '/a', before: { kind: 'text', sha: 'A1' } }] },
    { turn: 2, files: [{ path: '/a', before: { kind: 'text', sha: 'A2' } }, { path: '/b', before: { kind: 'absent' } }] },
    { turn: 3, files: [{ path: '/a', before: { kind: 'text', sha: 'A3' } }] },
  ]
  const plan = planRestore(checkpoints, 2)
  assert.deepEqual(plan.map((file) => [file.path, file.before.sha ?? file.before.kind]), [['/a', 'A2'], ['/b', 'absent']])
})

await test('plan: unsorted input still returns the earliest floor capture', async () => {
  const checkpoints = [
    { turn: 3, files: [{ path: '/a', before: { kind: 'text', sha: 'A3' } }] },
    { turn: 2, files: [{ path: '/a', before: { kind: 'text', sha: 'A2' } }] },
  ]
  assert.equal(planRestore(checkpoints, 2)[0].before.sha, 'A2')
})

await test('plan: a floor past every turn returns nothing', async () => {
  assert.deepEqual(planRestore([{ turn: 1, files: [{ path: '/a', before: { kind: 'absent' } }] }], 5), [])
})

// ---------------------------------------------------------------- restore

function restoreFixture(entries, files, blobs = {}) {
  const fs = makeFs(entries)
  const store = {
    async readBlob(_sessionId, sha) {
      if (!(sha in blobs)) throw new Error('ENOENT')
      return blobs[sha]
    },
  }
  return { fs, store, files }
}

await test('restore: writes the snapshot back when the file differs', async () => {
  const fixture = restoreFixture({ '/a.txt': { type: 'file', text: 'tampered' } }, [
    { path: '/a.txt', display: 'a.txt', before: { kind: 'text', sha: 'old' } },
  ], { old: 'original' })
  const report = await restoreFiles({ ...fixture, sessionId: 's' })
  assert.deepEqual(report.restored, ['a.txt'])
  assert.equal(fixture.fs.entries.get('/a.txt').text, 'original')
})

await test('restore: identical content is untouched and not rewritten', async () => {
  const fixture = restoreFixture({ '/a.txt': { type: 'file', text: 'same' } }, [
    { path: '/a.txt', display: 'a.txt', before: { kind: 'text', sha: 'same' } },
  ], { same: 'same' })
  const report = await restoreFiles({ ...fixture, sessionId: 's' })
  assert.deepEqual(report.unchanged, ['a.txt'])
  assert.deepEqual(fixture.fs.calls, [])
})

await test('restore: a file created after the floor is deleted', async () => {
  const fixture = restoreFixture({ '/new.txt': { type: 'file', text: 'x' } }, [
    { path: '/new.txt', display: 'new.txt', before: { kind: 'absent' } },
  ])
  const report = await restoreFiles({ ...fixture, sessionId: 's' })
  assert.deepEqual(report.deleted, ['new.txt'])
  assert.equal(fixture.fs.entries.has('/new.txt'), false)
})

await test('restore: an already absent file stays absent', async () => {
  const fixture = restoreFixture({}, [{ path: '/gone.txt', display: 'gone.txt', before: { kind: 'absent' } }])
  const report = await restoreFiles({ ...fixture, sessionId: 's' })
  assert.deepEqual(report.unchanged, ['gone.txt'])
  assert.deepEqual(fixture.fs.calls, [])
})

await test('restore: symlinks are skipped, not followed', async () => {
  const fixture = restoreFixture({ '/link': { type: 'symlink' } }, [
    { path: '/link', display: 'link', before: { kind: 'text', sha: 'old' } },
  ], { old: 'x' })
  const report = await restoreFiles({ ...fixture, sessionId: 's' })
  assert.deepEqual(report.skipped.map((item) => item.reason), ['symbolic link'])
  assert.deepEqual(fixture.fs.calls, [])
})

await test('restore: a directory at the path is skipped', async () => {
  const fixture = restoreFixture({ '/a.txt': { type: 'directory' } }, [
    { path: '/a.txt', display: 'a.txt', before: { kind: 'text', sha: 'old' } },
  ], { old: 'x' })
  const report = await restoreFiles({ ...fixture, sessionId: 's' })
  assert.equal(report.skipped[0].reason, 'path is a directory')
})

await test('restore: a missing blob is reported, never silently dropped', async () => {
  const fixture = restoreFixture({ '/a.txt': { type: 'file', text: 'now' } }, [
    { path: '/a.txt', display: 'a.txt', before: { kind: 'text', sha: 'gone' } },
  ])
  const report = await restoreFiles({ ...fixture, sessionId: 's' })
  assert.match(report.skipped[0].reason, /snapshot content is missing/)
  assert.equal(fixture.fs.entries.get('/a.txt').text, 'now')
})

await test('restore: a write failure is reported per file and the rest still run', async () => {
  const fs = makeFs({ '/a.txt': { type: 'file', text: 'x' }, '/b.txt': { type: 'file', text: 'y' } })
  fs.writeText = async (t, text) => {
    fs.calls.push(['write', t.targetKey, text])
    if (t.targetKey === '/a.txt') throw new Error('FS_SANDBOX_DENIED')
    fs.entries.set(t.targetKey, { type: 'file', text })
  }
  const store = { async readBlob(_s, sha) { return sha } }
  const report = await restoreFiles({
    fs,
    store,
    sessionId: 's',
    files: [
      { path: '/a.txt', display: 'a.txt', before: { kind: 'text', sha: 'A' } },
      { path: '/b.txt', display: 'b.txt', before: { kind: 'text', sha: 'B' } },
    ],
  })
  assert.equal(report.skipped.length, 1)
  assert.deepEqual(report.restored, ['b.txt'])
})

await test('restore: unsupported snapshots are skipped with their reason', async () => {
  const fixture = restoreFixture({ '/big.txt': { type: 'file', text: 'x' } }, [
    { path: '/big.txt', display: 'big.txt', before: { kind: 'unsupported', reason: 'larger than 16 bytes' } },
  ])
  const report = await restoreFiles({ ...fixture, sessionId: 's' })
  assert.equal(report.skipped[0].reason, 'larger than 16 bytes')
})

await test('restore: applying twice is a no-op', async () => {
  const fs = makeFs({ '/a.txt': { type: 'file', text: 'tampered' } })
  const files = [{ path: '/a.txt', display: 'a.txt', before: { kind: 'text', sha: 'old' } }]
  const store = { async readBlob() { return 'original' } }
  await restoreFiles({ fs, store, sessionId: 's', files })
  fs.calls.length = 0
  const second = await restoreFiles({ fs, store, sessionId: 's', files })
  assert.deepEqual(second.unchanged, ['a.txt'])
  assert.deepEqual(fs.calls, [])
})

// ---------------------------------------------------------------- diff

await test('diff: reports modified, created, deleted, unchanged and missing blobs', async () => {
  const fs = makeFs({
    '/modified.txt': { type: 'file', text: 'now' },
    '/created.txt': { type: 'file', text: 'new' },
    '/same.txt': { type: 'file', text: 'same' },
  })
  const store = { async readBlob(_s, sha) { if (sha === 'gone') throw new Error('ENOENT'); return sha } }
  const rows = await diffPlan({
    fs,
    store,
    sessionId: 's',
    files: [
      { path: '/modified.txt', display: 'm', before: { kind: 'text', sha: 'old' } },
      { path: '/created.txt', display: 'c', before: { kind: 'absent' } },
      { path: '/deleted.txt', display: 'd', before: { kind: 'text', sha: 'was-there' } },
      { path: '/same.txt', display: 's', before: { kind: 'text', sha: 'same' } },
      { path: '/lost.txt', display: 'l', before: { kind: 'text', sha: 'gone' } },
    ],
  })
  assert.deepEqual(rows.map((row) => row.kind), ['modified', 'created', 'deleted', 'unchanged', 'unavailable'])
})

// ---------------------------------------------------------------- store

await test('store: identical content is stored once and read back', async () => {
  const { store, dir } = await freshStore()
  const first = await makeBlob(store, 's1', 'same text')
  const second = await makeBlob(store, 's1', 'same text')
  assert.equal(first.sha, second.sha)
  const files = await fsp.readdir(path.join(dir, 'sessions', 's1', 'objects'))
  assert.equal(files.length, 1)
  assert.equal(await store.readBlob('s1', first.sha), 'same text')
})

await test('store: a corrupt state file reads as empty instead of throwing', async () => {
  const { store, dir } = await freshStore()
  await fsp.mkdir(path.join(dir, 'sessions', 's2'), { recursive: true })
  await fsp.writeFile(path.join(dir, 'sessions', 's2', 'checkpoints.json'), '{not json', 'utf8')
  assert.deepEqual((await store.load('s2')).checkpoints, [])
})

await test('store: state round-trips in turn order', async () => {
  const { store } = await freshStore()
  const state = { version: 1, sessionId: 's3', checkpoints: [{ turn: 3, at: new Date().toISOString(), files: [] }, { turn: 1, at: new Date().toISOString(), files: [] }] }
  await store.save(state)
  const loaded = await store.load('s3')
  assert.deepEqual(loaded.checkpoints.map((checkpoint) => checkpoint.turn), [1, 3])
})

await test('store: prune keeps the newest records plus the oldest floor', async () => {
  const { store } = await freshStore()
  const checkpoints = []
  for (let turn = 1; turn <= 5; turn += 1) {
    const blob = await makeBlob(store, 's4', `content-${turn}`)
    checkpoints.push({ turn, at: new Date().toISOString(), files: [{ path: `/f${turn}`, display: `f${turn}`, before: { kind: 'text', sha: blob.sha } }] })
  }
  const state = { version: 1, sessionId: 's4', checkpoints }
  await store.save(state)
  await store.pruneSession('s4', state, { maxCheckpoints: 3, retentionDays: 30 })
  assert.deepEqual((await store.load('s4')).checkpoints.map((checkpoint) => checkpoint.turn), [1, 4, 5])})

await test('store: prune drops aged records but never the floor', async () => {
  const { store } = await freshStore()
  const old = new Date(Date.now() - 60 * 86400000).toISOString()
  const fresh = new Date().toISOString()
  const state = {
    version: 1,
    sessionId: 's5',
    checkpoints: [
      { turn: 1, at: old, files: [] },
      { turn: 2, at: fresh, files: [] },
    ],
  }
  await store.save(state)
  await store.pruneSession('s5', state, { maxCheckpoints: 100, retentionDays: 30 })
  assert.deepEqual((await store.load('s5')).checkpoints.map((checkpoint) => checkpoint.turn), [1, 2])
})

await test('store: prune deletes only unreferenced blobs', async () => {
  const { store, dir } = await freshStore()
  const kept = await makeBlob(store, 's6', 'kept')
  const dropped = await makeBlob(store, 's6', 'dropped')
  await store.save({
    version: 1,
    sessionId: 's6',
    checkpoints: [
      { turn: 1, at: new Date().toISOString(), files: [{ path: '/a', display: 'a', before: { kind: 'text', sha: kept.sha } }] },
      { turn: 2, at: new Date().toISOString(), files: [{ path: '/b', display: 'b', before: { kind: 'text', sha: dropped.sha } }] },
    ],
  })
  const state = await store.load('s6')
  state.checkpoints = [state.checkpoints[0]]
  await store.pruneSession('s6', state, { maxCheckpoints: 1, retentionDays: 30 })
  const left = await fsp.readdir(path.join(dir, 'sessions', 's6', 'objects'))
  assert.deepEqual(left, [`${kept.sha}.txt`])
})

// ---------------------------------------------------------------- recorder

function recorderFixture(entries, options = {}) {
  const fs = makeFs(entries)
  return { fs, options }
}

await test('recorder: one checkpoint per turn, second capture ignored', async () => {
  const { store } = await freshStore()
  const { fs } = recorderFixture({ '/a.txt': { type: 'file', text: 'original' } })
  const recorder = new SessionRecorder({
    sessionId: 'r1', store, fs, maxFileBytes: 1024, maxCheckpoints: 100, retentionDays: 30, warn: (text) => { throw new Error(text) },
  })
  recorder.start(2, 41)
  recorder.capture(target('/a.txt'))
  await recorder.settled()
  fs.entries.set('/a.txt', { type: 'file', text: 'changed once' })
  recorder.capture(target('/a.txt'))
  await recorder.settled()
  await recorder.stopping(2)
  const state = await store.load('r1')
  assert.equal(state.checkpoints.length, 1)
  assert.equal(state.checkpoints[0].turn, 2)
  assert.equal(state.checkpoints[0].startSeq, 41)
  assert.equal(state.checkpoints[0].open, false)
  const before = state.checkpoints[0].files[0].before
  assert.equal(await store.readBlob('r1', before.sha), 'original')
})

await test('recorder: a reloaded instance merges and keeps the first capture', async () => {
  const { store } = await freshStore()
  const fs = makeFs({ '/a.txt': { type: 'file', text: 'original' } })
  const options = { sessionId: 'r2', store, fs, maxFileBytes: 1024, maxCheckpoints: 100, retentionDays: 30, warn: () => {} }
  const first = new SessionRecorder(options)
  first.start(1, 10)
  first.capture(target('/a.txt'))
  await first.settled()
  fs.entries.set('/a.txt', { type: 'file', text: 'mid-turn' })
  const second = new SessionRecorder(options)
  second.start(1, 10)
  second.capture(target('/a.txt'))
  second.capture(target('/new.txt'))
  await second.settled()
  await second.stopping(1)
  const state = await store.load('r2')
  const byPath = new Map(state.checkpoints[0].files.map((file) => [file.path, file]))
  assert.equal(await store.readBlob('r2', byPath.get('/a.txt').before.sha), 'original')
  assert.equal(byPath.get('/new.txt').before.kind, 'absent')
})

await test('recorder: an empty turn records nothing', async () => {
  const { store } = await freshStore()
  const fs = makeFs({})
  const recorder = new SessionRecorder({ sessionId: 'r3', store, fs, maxFileBytes: 1024, maxCheckpoints: 100, retentionDays: 30, warn: () => {} })
  recorder.start(3, 5)
  await recorder.stopping(3)
  assert.deepEqual((await store.load('r3')).checkpoints, [])
})

await test('recorder: close does not resurrect a purged record', async () => {
  const { store, dir } = await freshStore()
  const fs = makeFs({ '/a.txt': { type: 'file', text: 'x' } })
  const recorder = new SessionRecorder({ sessionId: 'r4', store, fs, maxFileBytes: 1024, maxCheckpoints: 100, retentionDays: 30, warn: () => {} })
  recorder.start(1, 1)
  recorder.capture(target('/a.txt'))
  await recorder.settled()
  await fsp.rm(path.join(dir, 'sessions'), { recursive: true, force: true })
  await recorder.stopping(1)
  assert.deepEqual((await store.load('r4')).checkpoints, [])
})

await test('recorder: close flips the open flag even when this instance captured nothing', async () => {
  const { store } = await freshStore()
  const fs = makeFs({})
  await store.save({
    version: 1,
    sessionId: 'r6',
    checkpoints: [{ turn: 4, at: new Date().toISOString(), open: true, files: [] }],
  })
  const recorder = new SessionRecorder({ sessionId: 'r6', store, fs, maxFileBytes: 1024, maxCheckpoints: 100, retentionDays: 30, warn: () => {} })
  recorder.start(4, 5)
  await recorder.stopping(4)
  assert.equal((await store.load('r6')).checkpoints[0].open, false)
})

await test('recorder: a stopping call for another turn leaves the open record open', async () => {
  const { store } = await freshStore()
  const fs = makeFs({ '/a.txt': { type: 'file', text: 'x' } })
  const recorder = new SessionRecorder({ sessionId: 'r5', store, fs, maxFileBytes: 1024, maxCheckpoints: 100, retentionDays: 30, warn: () => {} })
  recorder.start(1, 1)
  recorder.capture(target('/a.txt'))
  await recorder.settled()
  const before = await store.load('r5')
  assert.equal(before.checkpoints[0].open, true)
  await recorder.stopping(9)
  const after = await store.load('r5')
  assert.equal(after.checkpoints.length, 1)
  assert.equal(after.checkpoints[0].open, true)
})

// ---------------------------------------------------------------- commands

await test('commands: readArgument tolerates a leading command token', () => {
  assert.equal(readArgument(''), '')
  assert.equal(readArgument(' 3 '), '3')
  assert.equal(readArgument('/undo 3'), '3')
  assert.equal(readArgument('/rewind all'), 'all')
})

await test('commands: parseTurn resolves defaults, all, and rejects junk', () => {
  const checkpoints = [{ turn: 2 }, { turn: 5 }]
  assert.deepEqual(parseTurn('', checkpoints, 'undo'), { kind: 'number', turn: 5 })
  assert.deepEqual(parseTurn('all', checkpoints, 'undo'), { kind: 'number', turn: 2 })
  assert.deepEqual(parseTurn('3', checkpoints, 'rewind'), { kind: 'number', turn: 3 })
  assert.equal(parseTurn('abc', checkpoints, 'undo').kind, 'invalid')
  assert.equal(parseTurn('-1', checkpoints, 'undo').kind, 'invalid')
  assert.equal(parseTurn('', [], 'undo').kind, 'empty')
})

await test('commands: list, restore and diff text carry the important facts', () => {
  const list = formatList('s', [{ turn: 2, at: new Date().toISOString(), open: true, files: [{ path: '/a/b.txt', display: 'a/b.txt' }] }])
  assert.match(list, /turn/)
  assert.match(list, /进行中/)
  assert.match(list, /b\.txt/)
  const restore = formatRestore({ restored: ['a.txt'], deleted: [], unchanged: [], skipped: [] }, { fromTurn: 2, fileCount: 1 })
  assert.match(restore, /第 2 轮/)
  assert.match(restore, /改写 1 个/)
  const empty = formatRestore({ restored: [], deleted: [], unchanged: ['a.txt'], skipped: [] }, { fromTurn: 2, fileCount: 1 })
  assert.match(empty, /无需还原/)
  const diff = formatDiff([{ path: 'a.txt', kind: 'modified' }], 2)
  assert.match(diff, /已改动/)
})

await test('commands: empty list explains why nothing is recorded', () => {
  assert.match(formatList('s', []), /还没有任何 checkpoint/)
})

// ---------------------------------------------------------------- prompt

await test('prompt: reads the user text that opened the turn', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '使用本地的conda D2环境调试' }] } },
    { type: 'turn/start', data: { turn: 4 } },
    { type: 'assistant/message', data: {} },
  ]
  assert.equal(promptForTurn(events, 4), '使用本地的conda D2环境调试')
})

await test('prompt: joins text blocks, ignores non-text, trims', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '  first  ' }, { type: 'image' }, { type: 'text', text: 'second' }] } },
    { type: 'turn/start', data: { turn: 1 } },
  ]
  assert.equal(promptForTurn(events, 1), 'first  \nsecond')
})

await test('prompt: a turn boundary never reuses an older turn’s message', () => {
  const boundary = [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'older turn' }] } },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1 } },
    { type: 'turn/start', data: { turn: 2 } },
  ]
  assert.equal(promptForTurn(boundary, 2), undefined)
  assert.equal(promptForTurn(boundary, 1), 'older turn')
  assert.equal(promptForTurn(boundary, 3), undefined)
  const withPrompt = [
    ...boundary.slice(0, 3),
    { type: 'user/message', data: { content: [{ type: 'text', text: 'second ask' }] } },
    { type: 'turn/start', data: { turn: 2 } },
  ]
  assert.equal(promptForTurn(withPrompt, 2), 'second ask')
})

await test('prompt: empty or textless messages yield nothing', () => {
  assert.equal(promptForTurn([{ type: 'turn/start', data: { turn: 1 } }], 1), undefined)
  assert.equal(promptForTurn([{ type: 'user/message', data: { content: [{ type: 'image' }] } }, { type: 'turn/start', data: { turn: 1 } }], 1), undefined)
  assert.equal(promptForTurn(undefined, 1), undefined)
})

// ------------------------------------------------- prompt extraction (source)

await test('prompt: injected runtime context is not the user prompt', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'what I typed' }], source: { kind: 'user' } } },
    { type: 'user/message', data: { content: [{ type: 'text', text: 'Time sampled while preparing turn 2, step 1: ...' }], source: { kind: 'runtime-context', form: 'snapshot' } } },
    { type: 'turn/start', data: { turn: 2 } },
  ]
  assert.equal(promptForTurn(events, 2), 'what I typed')
})

await test('prompt: only injected context yields nothing instead of the reminder', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'The following information describes your current session:' }], source: { kind: 'runtime-context' } } },
    { type: 'turn/start', data: { turn: 1 } },
  ]
  assert.equal(promptForTurn(events, 1), undefined)
})

await test('prompt: a system-reminder wrapper inside the message is stripped', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'do the thing\n<system-reminder>noise</system-reminder>' }], source: { kind: 'user' } } },
    { type: 'turn/start', data: { turn: 1 } },
  ]
  assert.equal(promptForTurn(events, 1), 'do the thing')
})

// ---------------------------------------------------------------- summary

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} failing, ${passed} passing`)
  process.exitCode = 1
} else {
  console.log(`all ${passed} tests passing`)
}

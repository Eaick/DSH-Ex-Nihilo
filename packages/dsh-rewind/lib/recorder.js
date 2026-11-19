/**
 * Per-session recorder: before-images for every file-tool mutation plus one git
 * tree per top-level turn (when the working directory is a repository), all
 * committed as one checkpoint record.
 *
 * A capture is persisted as soon as it exists, so a checkpoint made by a turn
 * that is still running is already visible (and restorable) and survives a
 * crash; the turn close only marks the record complete and prunes old ones.
 *
 * Work is serialized on a promise chain: the intent listener awaits
 * {@link SessionRecorder.settled} before it returns, so a capture always
 * finishes before the mutation it guards.
 */
import { captureBefore } from './files.js'
import { findRepository, snapshotTree } from './git.js'
import { describeError } from './store.js'

export class SessionRecorder {
  constructor({ sessionId, store, fs, git, gitEnabled, objectsDir, maxFileBytes, maxCheckpoints, retentionDays, warn }) {
    this.sessionId = sessionId
    this.store = store
    this.fs = fs
    this.git = git
    this.gitEnabled = gitEnabled === true
    this.objectsDir = objectsDir
    this.maxFileBytes = maxFileBytes
    this.maxCheckpoints = maxCheckpoints
    this.retentionDays = retentionDays
    this.warn = warn
    this.chain = Promise.resolve()
    this.lifetime = new AbortController()
    this.turn = undefined
    this.startSeq = undefined
    this.files = new Map()
    this.firstAt = undefined
    this.gitInfo = undefined
    this.closed = new Set()
  }

  /** Abort queued git work when the Session leaves. */
  dispose() {
    this.lifetime.abort()
  }

  enqueue(task) {
    const run = this.chain.then(task).catch((error) => {
      this.warn(`turn recording failed: ${describeError(error)}`)
    })
    this.chain = run
    return run
  }

  settled() {
    return this.chain
  }

  /** Open a turn; a new turn replaces any state the previous one left behind. */
  start(turn, startSeq, cwd) {
    this.turn = turn
    this.startSeq = startSeq
    this.files = new Map()
    this.firstAt = undefined
    this.gitInfo = undefined
    if (this.gitEnabled && this.git !== undefined && typeof cwd === 'string' && cwd !== '') {
      this.enqueue(() => this.snapshotTurnStart(turn, cwd))
    }
  }

  /** Record the working tree before the turn's first mutation can run. */
  async snapshotTurnStart(turn, cwd) {
    const signal = this.lifetime.signal
    let root
    try {
      root = await findRepository(this.git, cwd, signal)
    } catch {
      return
    }
    if (root === undefined || this.turn !== turn) return
    let tree
    try {
      tree = await snapshotTree(this.git, { root, objectsDir: this.objectsDir, signal })
    } catch (error) {
      this.warn(`git snapshot failed for turn ${turn}: ${describeError(error)}`)
      return
    }
    if (this.turn !== turn) return
    this.gitInfo = { root, tree }
    await this.persist(turn, true)
  }

  /**
   * Queue the capture of one mutation target. Only the first mutation of a path
   * in this turn is captured, because that is the state the undo returns to.
   */
  capture(target) {
    const turn = this.turn
    if (turn === undefined) return
    let key
    try {
      key = this.fs.processPath(target)
    } catch {
      key = undefined
    }
    if (key === undefined) return
    if (this.files.has(key)) return
    const entry = { display: target.displayPath, before: undefined }
    this.files.set(key, entry)
    this.enqueue(async () => {
      if (this.turn !== turn || entry.before !== undefined) return
      const captured = await captureBefore(this.fs, target, this.maxFileBytes)
      if (this.turn !== turn) return
      if (captured.kind === 'text') {
        const blob = await this.store.putBlob(this.sessionId, captured.text)
        entry.before = { kind: 'text', sha: blob.sha, bytes: blob.bytes }
      } else {
        entry.before = captured
      }
      await this.persist(turn, true)
    })
  }

  /** Mark the open turn complete when it is about to close. */
  stopping(turn) {
    const active = this.turn
    if (active === undefined || active !== turn) return Promise.resolve()
    return this.enqueue(() => this.close(turn))
  }

  /** Close after `turn/end` when the stopping hook did not already do it. */
  end(turn) {
    const active = this.turn
    if (active === undefined || active !== turn || this.closed.has(turn)) return
    void this.enqueue(() => this.close(turn))
  }

  /** Write the current partial state of one turn, creating the record if needed. */
  async persist(turn, open, force = false) {
    const files = []
    for (const [filePath, entry] of this.files) {
      if (entry.before === undefined) continue
      files.push({ path: filePath, display: entry.display, before: entry.before })
    }
    if (files.length === 0 && this.gitInfo === undefined) {
      if (!force) return
      // A recorder rebuilt mid-turn (plugin reload, resume) may hold no captures
      // of its own while an earlier instance already wrote the record; closing
      // must still flip that record's open flag instead of leaving it "running".
      const current = await this.store.load(this.sessionId)
      const known = current.checkpoints.find((checkpoint) => checkpoint.turn === turn)
      if (known === undefined) return
      known.open = open
      await this.store.save(current)
      return
    }
    this.firstAt ??= new Date().toISOString()
    const state = await this.store.load(this.sessionId)
    const record = { turn, at: this.firstAt, open, files }
    if (this.startSeq !== undefined) record.startSeq = this.startSeq
    if (this.gitInfo !== undefined) record.git = { root: this.gitInfo.root, tree: this.gitInfo.tree }
    const existing = state.checkpoints.find((checkpoint) => checkpoint.turn === turn)
    if (existing === undefined) {
      state.checkpoints.push(record)
    } else {
      // A reload or resume can rebuild this recorder in the middle of a turn.
      // The first capture of a path is the true before-image, so entries that
      // are already recorded win over the ones this instance re-captured.
      const merged = new Map()
      for (const file of existing.files ?? []) merged.set(file.path, file)
      for (const file of record.files) {
        if (!merged.has(file.path)) merged.set(file.path, file)
      }
      existing.files = [...merged.values()]
      existing.at ??= record.at
      existing.open = record.open
      if (record.startSeq !== undefined) existing.startSeq = record.startSeq
      if (existing.git === undefined && record.git !== undefined) existing.git = record.git
    }
    await this.store.save(state)
  }

  async close(turn) {
    if (this.closed.has(turn)) return
    // A turn whose record was purged (store removed, retention sweep) is not
    // resurrected on close: a record with no snapshot store behind it would only
    // produce restores that skip every path.
    const state = await this.store.load(this.sessionId)
    if (!state.checkpoints.some((checkpoint) => checkpoint.turn === turn)) {
      this.closed.add(turn)
      this.files = new Map()
      this.firstAt = undefined
      this.gitInfo = undefined
      return
    }
    await this.persist(turn, false, true)
    const next = await this.store.load(this.sessionId)
    if (next.checkpoints.length > 0) {
      await this.store.pruneSession(this.sessionId, next, {
        maxCheckpoints: this.maxCheckpoints,
        retentionDays: this.retentionDays,
      })
    }
    this.closed.add(turn)
    this.files = new Map()
    this.firstAt = undefined
    this.gitInfo = undefined
  }
}

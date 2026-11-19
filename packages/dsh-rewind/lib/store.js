/**
 * Durable snapshot store for dsh-rewind.
 *
 * Layout under the store root:
 *   sessions/<session>/checkpoints.json   ordered per-turn records
 *   sessions/<session>/objects/<sha>.txt  content-addressed file snapshots
 *
 * Every write is atomic (temporary file + rename), so a crash leaves either the
 * previous state or the new one, never a half-written record.
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const STATE_VERSION = 1
const DAY_MS = 24 * 60 * 60 * 1000

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'session'
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Write one UTF-8 file atomically, creating its directory first. */
export async function writeFileAtomic(file, content) {
  const directory = path.dirname(file)
  await fsp.mkdir(directory, { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await fsp.writeFile(temporary, content, 'utf8')
  await fsp.rename(temporary, file)
}

/** Empty in-memory state for a session that has no store yet. */
export function emptyState(sessionId) {
  return { version: STATE_VERSION, sessionId, checkpoints: [] }
}

export class RewindStore {
  /**
   * @param {string} root absolute store directory.
   */
  constructor(root) {
    this.root = root
  }

  sessionDir(sessionId) {
    return path.join(this.root, 'sessions', safeSegment(sessionId))
  }

  objectsDir(sessionId) {
    return path.join(this.sessionDir(sessionId), 'objects')
  }

  stateFile(sessionId) {
    return path.join(this.sessionDir(sessionId), 'checkpoints.json')
  }

  /** Read one session's records; a corrupt or foreign file reads as empty. */
  async load(sessionId) {
    let raw
    try {
      raw = await fsp.readFile(this.stateFile(sessionId), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyState(sessionId)
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return emptyState(sessionId)
    }
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.checkpoints)) return emptyState(sessionId)
    return { version: STATE_VERSION, sessionId, checkpoints: parsed.checkpoints }
  }

  async save(state) {
    const ordered = [...state.checkpoints].sort((a, b) => a.turn - b.turn)
    state.checkpoints = ordered
    await writeFileAtomic(
      this.stateFile(state.sessionId),
      `${JSON.stringify({ version: STATE_VERSION, sessionId: state.sessionId, checkpoints: ordered }, null, 2)}\n`,
    )
  }

  /**
   * Store one snapshot text and return its content address.
   * Identical content is written once per session.
   */
  async putBlob(sessionId, text) {
    const sha = createHash('sha256').update(text, 'utf8').digest('hex')
    const file = path.join(this.objectsDir(sessionId), `${sha}.txt`)
    try {
      await fsp.access(file)
    } catch {
      await writeFileAtomic(file, text)
    }
    return { sha, bytes: Buffer.byteLength(text, 'utf8') }
  }

  async readBlob(sessionId, sha) {
    return fsp.readFile(path.join(this.objectsDir(sessionId), `${sha}.txt`), 'utf8')
  }

  /**
   * Drop checkpoints beyond the count cap and older than the retention window.
   * The oldest record is always kept so a full rewind still has a floor; blobs
   * that no surviving record references are deleted.
   */
  async pruneSession(sessionId, state, { maxCheckpoints, retentionDays, now = Date.now() }) {
    const ordered = [...state.checkpoints].sort((a, b) => a.turn - b.turn)
    if (ordered.length === 0) return state
    const floor = ordered[0]
    let kept = ordered
    if (kept.length > maxCheckpoints) {
      // The floor counts against the cap, so a full rewind always has a start
      // point without exceeding the configured number of records.
      const newest = ordered.slice(ordered.length - (maxCheckpoints - 1))
      kept = [floor, ...newest]
    }
    const cutoff = now - retentionDays * DAY_MS
    kept = kept.filter((checkpoint) => checkpoint === floor || !(Date.parse(checkpoint.at) < cutoff))
    state.checkpoints = kept
    await this.save(state)
    await this.collectGarbage(sessionId, kept)
    return state
  }

  async collectGarbage(sessionId, checkpoints) {
    const referenced = new Set()
    for (const checkpoint of checkpoints) {
      for (const file of checkpoint.files ?? []) {
        if (file.before?.kind === 'text' && typeof file.before.sha === 'string') referenced.add(file.before.sha)
      }
    }
    let names
    try {
      names = await fsp.readdir(this.objectsDir(sessionId))
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith('.txt')) continue
      if (referenced.has(name.slice(0, -4))) continue
      await fsp.rm(path.join(this.objectsDir(sessionId), name), { force: true }).catch(() => {})
    }
  }
}

/** Compose the store root from plugin config or the Harness home directory. */
export function resolveStoreRoot(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured)
  if (process.env.DSH_HOME) return path.join(process.env.DSH_HOME, 'rewind')
  if (process.env.DSH_PROFILE_DIR) return path.join(path.dirname(path.dirname(process.env.DSH_PROFILE_DIR)), 'rewind')
  return path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'rewind')
}

export { message as describeError }

/**
 * Recoverable trash for whole sessions.
 *
 * Nothing here deletes a session behind DSH's back: a discard archives the
 * session through the workspace registry, then moves its directory and the
 * rewindsite snapshots into a trash folder with a manifest. A restore puts both
 * back and unarchives. Purge only removes the trash copy, so a failed purge can
 * never take the live session with it.
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const VERSION = 1

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

async function exists(target) {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

async function move(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true })
  try {
    await fsp.rename(from, to)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await fsp.cp(from, to, { recursive: true })
    await fsp.rm(from, { recursive: true, force: true })
  }
}

/** Move one session directory and its snapshots into trash, reversibly. */
export class TrashStore {
  /**
   * @param {object} options
   * @param {string} options.root trash root, e.g. <dsh home>/rewind/trash
   * @param {string} options.sessionsRoot the harness sessions directory
   * @param {string} options.rewindRoot the rewind sessions directory
   * @param {{archive?: Function, unarchive?: Function}} options.registry workspace registry adapters
   * @param {(sessionId: string) => Promise<string|undefined>} [options.titleOf] display-title resolver
   * @param {(text: string) => void} [options.warn]
   */
  constructor({ root, sessionsRoot, rewindRoot, registry, titleOf, warn }) {
    this.root = root
    this.sessionsRoot = sessionsRoot
    this.rewindRoot = rewindRoot
    this.registry = registry ?? {}
    this.titleOf = titleOf
    this.warn = warn ?? (() => {})
  }

  entryDir(sessionId) {
    return path.join(this.root, String(sessionId).replace(/[^A-Za-z0-9._-]+/g, '_'))
  }

  async entryExists(sessionId) {
    return exists(path.join(this.entryDir(sessionId), 'manifest.json'))
  }

  /** Find the live directory of one session, wherever its workspace slug is. */
  async locateSession(sessionId) {
    let slugs = []
    try {
      slugs = await fsp.readdir(this.sessionsRoot)
    } catch {
      return undefined
    }
    for (const slug of slugs) {
      const candidate = path.join(this.sessionsRoot, slug, String(sessionId))
      if (await exists(candidate)) return candidate
    }
    return undefined
  }

  async readManifest(sessionId) {
    try {
      const raw = await fsp.readFile(path.join(this.entryDir(sessionId), 'manifest.json'), 'utf8')
      const parsed = JSON.parse(raw)
      return parsed?.version === VERSION ? parsed : undefined
    } catch {
      return undefined
    }
  }

  async writeManifest(sessionId, manifest) {
    await fsp.mkdir(this.entryDir(sessionId), { recursive: true })
    await fsp.writeFile(path.join(this.entryDir(sessionId), 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  }

  async list() {
    let names = []
    try {
      names = await fsp.readdir(this.root)
    } catch {
      return []
    }
    const entries = []
    for (const name of names) {
      const manifest = await this.readManifest(name)
      if (manifest !== undefined) entries.push(manifest)
    }
    return entries.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }

  /**
   * Archive and move one session into trash.
   * @returns {Promise<{ok: true, entry: object} | {ok: false, error: string}>}
   */
  async discard(sessionId, meta = {}) {
    const id = String(sessionId)
    if (await this.entryExists(id)) return { ok: false, error: '会话已在回收站中' }
    const live = await this.locateSession(id)
    if (live === undefined) return { ok: false, error: '找不到该会话的存储目录（可能从未落盘）' }
    const rewindDir = this.rewindRoot === undefined ? undefined : path.join(this.rewindRoot, id)
    // The workspace path is what a restore needs to put the session back into
    // the sidebar; callers may not know it, so ask the registry that accounts it.
    let workspacePath = typeof meta.workspacePath === 'string' ? meta.workspacePath : ''
    if (workspacePath === '' && typeof this.registry.workspacePathOf === 'function') {
      try {
        workspacePath = (await this.registry.workspacePathOf(id)) ?? ''
      } catch (error) {
        this.warn(`trash: cannot resolve the workspace of ${id}: ${message(error)}`)
      }
    }
    // The title is the only human handle a trashed Session keeps, so record it
    // while the Session still exists.
    let title = typeof meta.title === 'string' ? meta.title : ''
    if (title === '' && typeof this.titleOf === 'function') {
      try {
        title = (await this.titleOf(id)) ?? ''
      } catch (error) {
        this.warn(`trash: cannot resolve the title of ${id}: ${message(error)}`)
      }
    }
    const entry = {
      version: VERSION,
      sessionId: id,
      title,
      workspacePath,
      originalSessionDir: live,
      originalRewindDir: (await exists(rewindDir)) ? rewindDir : undefined,
      archived: false,
      status: 'moving',
      at: new Date().toISOString(),
    }
    const dir = this.entryDir(id)
    await fsp.mkdir(dir, { recursive: true })
    try {
      if (typeof this.registry.archive === 'function') {
        await this.registry.archive(id)
        entry.archived = true
      }
      await move(live, path.join(dir, 'session'))
      if (entry.originalRewindDir !== undefined) await move(rewindDir, path.join(dir, 'rewind'))
      entry.status = 'trashed'
      await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(entry, null, 2), 'utf8')
      return { ok: true, entry }
    } catch (error) {
      // Roll back whatever already happened so a failure cannot strand a session.
      try {
        if (await exists(path.join(dir, 'session'))) await move(path.join(dir, 'session'), live)
        if (entry.originalRewindDir !== undefined && (await exists(path.join(dir, 'rewind')))) {
          await move(path.join(dir, 'rewind'), entry.originalRewindDir)
        }
        if (entry.archived && typeof this.registry.unarchive === 'function') await this.registry.unarchive(id)
      } catch (rollbackError) {
        this.warn(`trash rollback failed: ${message(rollbackError)}`)
      }
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, error: `移入回收站失败：${message(error)}` }
    }
  }

  /**
   * Put a trashed session back where it was, unarchive it, and re-attach it to
   * its workspace so the sidebar lists it again.
   */
  async restore(sessionId) {
    const id = String(sessionId)
    const manifest = await this.readManifest(id)
    if (manifest === undefined) return { ok: false, error: '回收站里没有这个会话' }
    const dir = this.entryDir(id)
    try {
      if (await exists(path.join(dir, 'session'))) await move(path.join(dir, 'session'), manifest.originalSessionDir)
      if (manifest.originalRewindDir !== undefined && (await exists(path.join(dir, 'rewind')))) {
        await move(path.join(dir, 'rewind'), manifest.originalRewindDir)
      }
      if (manifest.archived && typeof this.registry.unarchive === 'function') await this.registry.unarchive(id)
      // A purge that stopped after detaching its registry account leaves the
      // copy here; restoring it must put the sidebar row back as well.
      if (typeof this.registry.attach === 'function') {
        try {
          await this.registry.attach(id, manifest.workspacePath)
        } catch (error) {
          this.warn(`trash: restored ${id} but could not re-attach it: ${message(error)}`)
        }
      }
      await fsp.rm(dir, { recursive: true, force: true })
      return { ok: true, entry: manifest }
    } catch (error) {
      return { ok: false, error: `还原失败（文件保持原样）：${message(error)}` }
    }
  }

  /**
   * Remove the trash copy and forget the Session in the workspace registry.
   *
   * The registry account goes first: deleting the copy without removing the
   * account leaves a sidebar row that cannot open, and unarchiving alone only
   * makes that row visible. A failed registry write keeps the copy and the
   * manifest, so the whole purge stays retryable from the panel.
   *
   * A Session this process still holds an agent for cannot be detached yet:
   * detaching it drops the workspace account while the live agent keeps the id
   * in the sidebar's ungrouped list, so the row would come back until the
   * process ends. That case stays archived (the row hides at once) and is
   * parked for the next process start to detach.
   */
  async purge(sessionId) {
    const id = String(sessionId)
    const manifest = await this.readManifest(id)
    if (manifest === undefined) return { ok: false, error: '回收站里没有这个会话' }
    let live = false
    try {
      live = typeof this.registry.isLive === 'function' ? (await this.registry.isLive(id)) === true : false
    } catch {
      live = false
    }
    try {
      if (live) {
        if (typeof this.registry.archive === 'function') await this.registry.archive(id)
        if (typeof this.registry.park === 'function') await this.registry.park(id)
      } else {
        // Order matters: detach first so the sidebar row disappears, then drop
        // the archive/pin membership that would otherwise resurrect it.
        if (typeof this.registry.detach === 'function') await this.registry.detach(id)
        if (manifest.archived && typeof this.registry.unarchive === 'function') await this.registry.unarchive(id)
        if (typeof this.registry.unpin === 'function') await this.registry.unpin(id)
      }
    } catch (error) {
      return { ok: false, error: `清理注册表失败，回收站副本已保留：${message(error)}` }
    }
    manifest.archived = live
    try {
      await this.writeManifest(id, manifest)
    } catch {
      /* the copy is still authoritative; a stale manifest only affects audit */
    }
    // The sidebar can render a row from the derived projection cache alone, so a
    // deleted Session drops its cache row too.
    if (typeof this.registry.forgetCache === 'function') await this.registry.forgetCache(id)
    try {
      await fsp.rm(this.entryDir(id), { recursive: true, force: true })
      return { ok: true, entry: manifest, parked: live }
    } catch (error) {
      // The registry account is already gone (or parked), so the row has
      // disappeared; the copy stays listed in the trash and the call can be
      // retried.
      return { ok: false, error: `彻底删除失败（条目仍在回收站，侧栏已移除）：${message(error)}` }
    }
  }

  /** Purge every entry that is in the trash right now. */
  async purgeAll() {
    const entries = await this.list()
    const purged = []
    const failed = []
    for (const entry of entries) {
      const result = await this.purge(entry.sessionId)
      if (result.ok) purged.push(entry.sessionId)
      else failed.push({ sessionId: entry.sessionId, error: result.error })
    }
    return { purged, failed }
  }

  /** Report manifest/registry drift without changing anything. */
  async audit() {
    const entries = await this.list()
    const problems = []
    for (const entry of entries) {
      if (!(await exists(path.join(this.entryDir(entry.sessionId), 'session')))) {
        problems.push({ sessionId: entry.sessionId, problem: '会话目录不在回收站里' })
      }
    }
    return { entries: entries.length, problems }
  }

  /** Reserve a unique staging name for tests and future batch moves. */
  static stagingName(sessionId) {
    return `${sessionId}-${randomUUID().slice(0, 8)}`
  }
}

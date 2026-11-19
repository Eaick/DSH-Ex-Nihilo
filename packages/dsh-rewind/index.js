/**
 * dsh-rewind — per-turn file snapshots with `/rewind`.
 *
 * The plugin captures the content of every path a file tool is about to mutate
 * (through the filesystem intent waterfalls, before the mutation runs), commits
 * one checkpoint record when the turn closes, and restores any set of turns by
 * writing those before-images back. Conversation rewinding is out of scope:
 * `/rewind` restores files, and the per-message menu forks a new conversation.
 */
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { RewindStore, describeError, resolveStoreRoot } from './lib/store.js'
import { SessionRecorder } from './lib/recorder.js'
import { diffPlan, planRestore, restoreFiles } from './lib/files.js'
import { changedPaths, createGit, restorePaths, treeExists } from './lib/git.js'
import { promptOfSession } from './lib/prompt.js'
import { TrashStore } from './lib/trash.js'
import { TRASH_API_PATH, handleTrashApi } from './lib/trash-api.js'
import { formatDiff, formatList, formatRestore, parseTurn, plain, readArgument } from './lib/commands.js'

/** Stable Loader identity. */
export const name = 'dsh-rewind'

/** Filesystem intents, the command registry, the agent registry, subprocess, and the model tool. */
export const inject = ['fs', 'commands', 'agents', 'tools', 'subprocess']

const DEFAULTS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxCheckpoints: 100,
  retentionDays: 30,
  gitSnapshots: true,
  gitTimeoutMs: 30_000,
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function settingsOf(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  return {
    storageDir: resolveStoreRoot(raw.storageDir),
    maxFileBytes: positiveInteger(raw.maxFileBytes, DEFAULTS.maxFileBytes),
    maxCheckpoints: positiveInteger(raw.maxCheckpoints, DEFAULTS.maxCheckpoints),
    retentionDays: positiveInteger(raw.retentionDays, DEFAULTS.retentionDays),
    gitSnapshots: raw.gitSnapshots === undefined ? DEFAULTS.gitSnapshots : raw.gitSnapshots !== false,
    gitTimeoutMs: positiveInteger(raw.gitTimeoutMs, DEFAULTS.gitTimeoutMs),
  }
}

/**
 * Snapshot file-tool mutations, record them per turn, and restore them.
 * @param {object} ctx Host context with `fs`, `commands`, and `tools`.
 * @param {unknown} config validated row config.
 */
export function apply(ctx, config) {
  const settings = settingsOf(config)
  const store = new RewindStore(settings.storageDir)
  const recorders = new Map()
  const mutations = new WeakMap()
  const warn = (text) => {
    try {
      ctx.logger?.warn?.(`rewind: ${text}`)
    } catch {
      /* logging must never break recording */
    }
  }

  const eligible = (session) => {
    const header = session?.header
    if (typeof header?.cwd !== 'string' || header.cwd === '') return false
    if (header.origin === 'subagent') return false
    if ((header.delegationDepth ?? 0) > 0) return false
    return true
  }

  let gitHelper
  const git = () => {
    gitHelper ??= createGit({ subprocess: ctx.subprocess, timeoutMs: settings.gitTimeoutMs })
    return gitHelper
  }

  /** The directory a turn's git snapshot is taken from: the Session's effective cwd. */
  const sessionDirectory = (session) => {
    try {
      const effective = ctx.get('workingDirectory')?.get?.(session)
      if (typeof effective === 'string' && effective !== '') return effective
    } catch {
      /* fall through to the header cwd */
    }
    return session.header?.cwd
  }

  const recorderFor = (session) => {
    let recorder = recorders.get(session)
    if (recorder === undefined) {
      recorder = new SessionRecorder({
        sessionId: session.id,
        store,
        fs: ctx.fs,
        git: git(),
        gitEnabled: settings.gitSnapshots,
        objectsDir: path.join(store.sessionDir(session.id), 'git'),
        maxFileBytes: settings.maxFileBytes,
        maxCheckpoints: settings.maxCheckpoints,
        retentionDays: settings.retentionDays,
        warn,
      })
      recorders.set(session, recorder)
    }
    return recorder
  }

  /**
   * A plugin activated mid-conversation never saw the current turn's `turn/start`.
   * Recover it from the Session's own turn boundary so capture starts now instead
   * of at the next turn.
   */
  const ensureRecorder = (session) => {
    const existing = recorders.get(session)
    if (existing !== undefined) return existing
    if (!eligible(session)) return undefined
    let boundary
    try {
      boundary = ctx.agents.turnBoundaryOf(session)
    } catch {
      return undefined
    }
    if (boundary?.openTurnStartSeq === null || boundary?.openTurnStartSeq === undefined) return undefined
    const recorder = recorderFor(session)
    recorder.start(boundary.lastTurn, boundary.openTurnStartSeq, sessionDirectory(session))
    return recorder
  }

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      if (eligible(session)) recorderFor(session).start(event.data.turn, event.seq, sessionDirectory(session))
      return
    }
    if (event.type === 'turn/end') recorders.get(session)?.end(event.data.turn)
  })
  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    await recorders.get(agent.session)?.stopping(turn)
  })
  ctx.on('session/disposed', (session) => {
    recorders.get(session)?.dispose()
    recorders.delete(session)
  })

  // Attribute an intent's opaque `actor` to a session by way of its tool call.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const session = exec.agent?.session
    const recorder = session === undefined ? undefined : ensureRecorder(session)
    if (recorder !== undefined) {
      mutations.set(exec, recorder)
      await recorder.settled()
    }
    return next()
  })

  for (const event of ['fs/write-intent', 'fs/edit-intent', 'fs/delete-intent']) {
    ctx.on(
      event,
      async (target, actor, next) => {
        const intent = await next()
        const recorder = actor === undefined ? undefined : mutations.get(actor)
        if (recorder !== undefined) {
          recorder.capture(target)
          await recorder.settled()
        }
        return intent
      },
      { prepend: true },
    )
  }

  /**
   * Rewrite the working tree from the earliest git tree at or after `turn`.
   * Only paths that differ from that tree are touched, and a path this tree does
   * not contain is never removed; the index is left alone.
   */
  const restoreGit = async (sessionId, checkpoints, turn) => {
    const candidate = [...checkpoints]
      .filter((checkpoint) => checkpoint.turn >= turn && checkpoint.git !== undefined && typeof checkpoint.git.tree === 'string')
      .sort((a, b) => a.turn - b.turn)[0]
    if (candidate === undefined) return undefined
    const root = candidate.git.root
    if (typeof root !== 'string') return undefined
    const session = ctx.agents.get(sessionId)?.session
    let policy
    try {
      policy = session === undefined ? undefined : ctx.get('sandboxPolicy')?.resolve({ session })
    } catch {
      policy = undefined
    }
    const cwd = session === undefined ? undefined : sessionDirectory(session)
    // A git restore writes with git, not through the sandboxed fs seam, so it is
    // only allowed where the session could write those paths anyway.
    const insideWorkspace = typeof cwd === 'string' && (root === cwd || root.startsWith(`${cwd}${path.sep}`))
    if (policy !== undefined && policy.mode !== 'danger-full-access' && !insideWorkspace) {
      return { turn: candidate.turn, skipped: `sandbox mode ${policy.mode} does not cover ${root}` }
    }
    const objectsDir = path.join(store.sessionDir(sessionId), 'git')
    const signal = AbortSignal.timeout(settings.gitTimeoutMs * 2)
    try {
      const helper = git()
      if (!(await treeExists(helper, { root, tree: candidate.git.tree, objectsDir, signal }))) {
        return { turn: candidate.turn, error: 'git tree is no longer readable' }
      }
      const paths = await changedPaths(helper, { root, tree: candidate.git.tree, signal })
      if (paths.length === 0) return { turn: candidate.turn, restored: 0, remaining: 0 }
      await restorePaths(helper, { root, tree: candidate.git.tree, paths, signal })
      const remaining = await changedPaths(helper, { root, tree: candidate.git.tree, signal })
      return {
        turn: candidate.turn,
        restored: paths.length,
        remaining: remaining.length,
        remainingPaths: remaining.slice(0, 5),
      }
    } catch (error) {
      return { turn: candidate.turn, error: describeError(error) }
    }
  }

  // A plugin activated mid-conversation adopts the turns already open: without
  // this, a reloaded instance never sees the turn that is running and its record
  // would stay marked "进行中" because nothing closes it.
  try {
    for (const agent of ctx.agents.list()) {
      const session = agent.session
      if (session !== undefined) ensureRecorder(session)
    }
  } catch {
    /* adoption is best effort */
  }

  /** The turn and `turn/start` sequence that produced one assistant message. */
  const locateTurn = (session, messageId) => {
    try {
      const events = typeof session?.ownEvents === 'function' ? session.ownEvents() : []
      let active
      for (const event of events) {
        if (event?.type === 'turn/start') active = { turn: event.data.turn, startSeq: event.seq }
        else if (event?.type === 'turn/end') active = undefined
        else if (event?.type === 'assistant/message' && active !== undefined && event.data?.message?.id === messageId) return active
      }
    } catch {
      /* fall through */
    }
    return undefined
  }

  /**
   * A title for a branch that tells it apart from its parent: the parent's title
   * with the next free `(n)` suffix, the same shape DSH's own fork uses.
   */
  const forkTitle = async (parentId) => {
    const parent = await projectionTitle(parentId)
    const base = (typeof parent === 'string' && parent !== '' ? parent : '分叉会话').replace(/\s*\(\d+\)$/, '')
    const taken = new Set()
    try {
      const dir = path.join(path.dirname(settings.storageDir), 'storages', 'session_projcache', 'sessions')
      const files = await fsp.readdir(dir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const parsed = JSON.parse(await fsp.readFile(path.join(dir, file), 'utf8'))
          const title = parsed?.record?.rows?.title?.val
          if (typeof title === 'string' && title !== '') taken.add(title)
        } catch {
          /* one unreadable cache row must not stop the suffix search */
        }
      }
    } catch {
      /* no cache yet: any suffix is free */
    }
    for (let index = 1; index < 1000; index += 1) {
      const candidate = `${base} (${index})`
      if (!taken.has(candidate)) return candidate
    }
    return `${base} (${Date.now()})`
  }

  const restoreTo = async (sessionId, turn) => {
    const state = await store.load(sessionId)
    const files = planRestore(state.checkpoints, turn)
    const gitReport = await restoreGit(sessionId, state.checkpoints, turn)
    // Restoring is a filesystem capability, so it runs under the same sandbox
    // policy the session's own file tools get; without that policy a
    // workspace-write backend would fence a legitimate undo of another cwd.
    const session = ctx.agents.get(sessionId)?.session
    let policy
    if (session !== undefined) {
      try {
        policy = ctx.get('sandboxPolicy')?.resolve({ session })
      } catch {
        policy = undefined
      }
    }
    const report = await restoreFiles({ fs: ctx.fs, store, sessionId, files, policy })
    return { fromTurn: turn, fileCount: files.length, report, git: gitReport }
  }

  const diffTo = async (sessionId, turn) => {
    const state = await store.load(sessionId)
    const files = planRestore(state.checkpoints, turn)
    return diffPlan({ fs: ctx.fs, store, sessionId, files })
  }

  const lastTurn = (checkpoints) => checkpoints.reduce((max, checkpoint) => Math.max(max, checkpoint.turn), 0)

  const run = async (sessionId, argument, mode) => {
    const state = await store.load(sessionId)
    if (argument === '' && mode === 'list') return { kind: 'success', text: formatList(sessionId, state.checkpoints) }
    if (argument === 'diff') {
      const turn = parseTurn('', state.checkpoints, 'undo')
      if (turn.kind !== 'number') return { kind: 'success', text: formatList(sessionId, state.checkpoints) }
      return { kind: 'success', text: formatDiff(await diffTo(sessionId, turn.turn), turn.turn) }
    }
    const selection = parseTurn(argument, state.checkpoints, mode)
    if (selection.kind === 'empty') return { kind: 'success', text: formatList(sessionId, state.checkpoints) }
    if (selection.kind === 'invalid') return { kind: 'error', text: `无法识别的参数 \`${selection.argument}\`：请给出轮次数字、all，或省略。` }
    if (state.checkpoints.length === 0) return { kind: 'success', text: formatList(sessionId, state.checkpoints) }
    if (selection.turn > lastTurn(state.checkpoints)) {
      return { kind: 'error', text: `第 ${selection.turn} 轮之后没有 checkpoint；最近一条是第 ${lastTurn(state.checkpoints)} 轮。` }
    }
    const outcome = await restoreTo(sessionId, selection.turn)
    let text = formatRestore(outcome.report, outcome)
    // A hidden carrier for the client: the prompt that started the undone turn,
    // so a branch can put the original request back into the composer.
    const prompt = promptOfSession(ctx.agents.get(sessionId)?.session, selection.turn)
    if (prompt !== undefined) {
      text += `\n\n<!--rewind:prompt:${Buffer.from(prompt, 'utf8').toString('base64')}-->`
    }
    return { kind: 'success', text }
  }

  ctx.provide('rewind', {
    /** Every checkpoint this store holds for one session, oldest first. */
    list: async (sessionId) => (await store.load(sessionId)).checkpoints,
    /** Plain comparison of the plan for one turn against the current files. */
    diff: (sessionId, turn) => diffTo(sessionId, turn),
    /** Restore files to their state just before `turn`; idempotent. */
    restore: (sessionId, turn) => restoreTo(sessionId, turn),
  })

  // Command rows render plain text, so strip markdown markers on the way out.
  const command = (definition) => ctx.effect(() => ctx.commands.register({
    ...definition,
    handler: async (invocation) => {
      const result = await definition.handler(invocation)
      if (result === undefined || typeof result.text !== 'string') return result
      return { ...result, text: plain(result.text) }
    },
  }))

  /**
   * The workspace record's own `sessionIds`, read through the live storage
   * domain.
   *
   * The registry's public `Workspace.sessionIds` view is filtered by a header
   * index: a Session whose log is gone — exactly the ones a trash plugin has to
   * fix — can drop out of that view while the durable record still accounts it.
   * Detaching has to look at what is stored, or the row cannot be removed.
   */
  const storedSessionIds = (workspaceId) => {
    try {
      const domain = ctx.get('storageDomain')?.get?.('workspace')
      const record = domain?.table?.('workspaces')?.get?.(workspaceId)
      if (record !== undefined && Array.isArray(record.sessionIds)) return record.sessionIds
    } catch {
      /* fall back to the filtered view */
    }
    return undefined
  }

  /**
   * The workspace that accounts one session, if any. Consults the stored record
   * first and the filtered view as a fallback.
   */
  const workspaceOf = (sessionId) => {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined || typeof registry.list !== 'function') return undefined
    try {
      for (const workspace of registry.list()) {
        const stored = storedSessionIds(workspace.id)
        if (stored === undefined) {
          if (workspace.sessionIds.includes(sessionId)) return workspace
          continue
        }
        if (stored.includes(sessionId)) return workspace
      }
    } catch {
      return undefined
    }
    return undefined
  }

  /**
   * The display title of one Session, read from the projection cache that the
   * Session list itself renders from. The title is the only human handle a
   * trashed Session keeps, and the cache row outlives the Session log, so this
   * still answers for entries trashed before titles were recorded.
   */
  const projectionTitle = async (sessionId) => {
    try {
      const file = path.join(
        path.dirname(settings.storageDir), 'storages', 'session_projcache', 'sessions', `${String(sessionId)}.json`,
      )
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8'))
      const value = parsed?.record?.rows?.title?.val
      return typeof value === 'string' && value !== '' ? value : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Drop a deleted Session's cached projection row. The sidebar renders session
   * rows from this cache as well as from the workspace account, so a deleted
   * Session whose cache row survives keeps a grey, unopenable row until the
   * cache is rebuilt. Best effort: the cache self-heals on the next write.
   */
  const dropProjectionCache = async (sessionId) => {
    try {
      const file = path.join(
        path.dirname(settings.storageDir), 'storages', 'session_projcache', 'sessions', `${String(sessionId)}.json`,
      )
      await fsp.rm(file, { force: true })
    } catch {
      /* the cache is derived state; failing to drop it must not fail a delete */
    }
  }

  // ---------------------------------------------------------------------
  // Parked deletions: a purged Session whose agent this process still holds
  // cannot be detached yet. It stays archived (hidden) and its id is written
  // here, so the next process start detaches the account without a restart
  // being needed to make the row disappear.
  // ---------------------------------------------------------------------

  const parkedFile = path.join(settings.storageDir, 'parked.json')

  const readParked = async () => {
    try {
      const parsed = JSON.parse(await fsp.readFile(parkedFile, 'utf8'))
      return Array.isArray(parsed?.ids)
        ? parsed.ids.filter((id) => typeof id === 'string' && id !== '')
        : []
    } catch {
      return []
    }
  }

  const writeParked = async (ids) => {
    try {
      await fsp.mkdir(settings.storageDir, { recursive: true })
      await fsp.writeFile(parkedFile, `${JSON.stringify({ version: 1, ids }, null, 2)}\n`, 'utf8')
    } catch (error) {
      warn(`trash: cannot persist parked deletions: ${describeError(error)}`)
    }
  }

  const parkForDetach = async (sessionId) => {
    const ids = await readParked()
    if (!ids.includes(sessionId)) await writeParked([...ids, sessionId])
  }

  /**
   * Detach every parked id whose agent is gone; keep the rest.
   *
   * A parked id is one the user already deleted. While this process still holds
   * its agent, detaching the workspace account only moves the row from its group
   * into "Ungrouped" — the client lists live agents regardless of accounting —
   * so the id keeps its hidden archived slot until the agent is released. That is
   * the one thing DSH gives no API for.
   */
  const settleParked = async (only) => {
    const ids = await readParked()
    if (ids.length === 0) return { detached: [], pending: [] }
    const interested = Array.isArray(only) ? ids.filter((id) => only.includes(id)) : ids
    if (interested.length === 0) return { detached: [], pending: [] }
    const detached = []
    const pending = []
    for (const id of interested) {
      if (ctx.agents.get(id) !== undefined) {
        pending.push(id)
        continue
      }
      try {
        await trash.registry.detach(id)
        await trash.registry.unarchive?.(id)
        await trash.registry.unpin?.(id)
        detached.push(id)
      } catch (error) {
        warn(`trash: cannot settle parked ${id}: ${describeError(error)}`)
        pending.push(id)
      }
    }
    if (detached.length > 0) {
      const keep = ids.filter((id) => !detached.includes(id))
      await writeParked(keep)
    }
    return { detached, pending }
  }

  // An agent leaving the registry is the exact moment a parked id becomes
  // detachable, so clean it up then instead of waiting for the next start.
  ctx.on('agent/disposed', () => {
    void settleParked().catch(() => undefined)
  })

  const trash = new TrashStore({
    root: path.join(settings.storageDir, 'trash'),
    sessionsRoot: path.join(path.dirname(settings.storageDir), 'sessions'),
    rewindRoot: path.join(settings.storageDir, 'sessions'),
    titleOf: projectionTitle,
    registry: {
      archive: (id) => ctx.get('workspaceRegistry')?.archiveSession?.(id),
      unarchive: (id) => ctx.get('workspaceRegistry')?.unarchiveSession?.(id),
      unpin: (id) => ctx.get('workspaceRegistry')?.unpinSession?.(id),
      isLive: (id) => ctx.agents.get(id) !== undefined,
      park: (id) => parkForDetach(id),
      forgetCache: (id) => dropProjectionCache(id),
      workspacePathOf: (id) => workspaceOf(id)?.path,
      detach: async (id) => {
        const workspace = workspaceOf(id)
        if (workspace === undefined) return false
        await workspace.detachSession(id)
        return true
      },
      attach: async (id, workspacePath) => {
        const registry = ctx.get('workspaceRegistry')
        if (registry === undefined || typeof workspacePath !== 'string' || workspacePath === '') return false
        const workspace = await registry.resolveByPath?.(workspacePath)
        if (workspace === undefined) return false
        await workspace.attachSession(id)
        return true
      },
    },
    warn,
  })

  /**
   * Whether the Session still exists. `sessionPersistence.stat` is the
   * authoritative answer (the same seam the workspace registry checks); the
   * filesystem lookup is only the fallback when no persistence is composed.
   */
  const sessionExists = async (sessionId) => {
    const persistence = ctx.get('sessionPersistence')
    if (persistence !== undefined && typeof persistence.stat === 'function') {
      try {
        return (await persistence.stat(sessionId)) !== undefined
      } catch {
        /* status is advisory: an error falls through to the filesystem */
      }
    }
    return (await trash.locateSession(sessionId)) !== undefined
  }

  // ---------------------------------------------------------------------
  // Archived Sessions, listed in the trash page without moving their logs.
  // DSH's own Archive hides a Session; the trash page turns that state into
  // one reversible place (restore = unarchive, delete forever = drop the log),
  // so no second "delete" gesture is needed. Nothing here touches the log until
  // the user asks to delete it.
  // ---------------------------------------------------------------------

  /**
   * Whether one Session has an open turn, i.e. is actually doing work. A loaded
   * agent is not enough: archiving stops the work but DSH keeps the agent
   * resident, so "agent exists" says nothing about running.
   */
  const sessionRunning = (sessionId) => {
    try {
      const session = ctx.agents.get(sessionId)?.session
      if (session === undefined) return false
      const boundary = ctx.agents.turnBoundaryOf(session)
      return boundary?.openTurnStartSeq !== null && boundary?.openTurnStartSeq !== undefined
    } catch {
      return false
    }
  }

  /** Ids in the registry-global archive set, read from the live domain. */
  const storedArchivedIds = () => {
    try {
      const state = ctx.get('storageDomain')?.get?.('workspace')?.global?.get?.()
      return Array.isArray(state?.archivedSessionIds) ? state.archivedSessionIds : undefined
    } catch {
      return undefined
    }
  }

  /** One trash-page row per archived Session whose log is still in place. */
  const archivedEntries = async () => {
    const ids = storedArchivedIds()
    if (ids === undefined) return []
    const entries = []
    for (const sessionId of ids) {
      // A moved copy is already a manifest entry; do not list it twice.
      if (await trash.entryExists(sessionId)) continue
      const dir = await trash.locateSession(sessionId)
      if (dir === undefined) continue
      let at = ''
      try {
        at = (await fsp.stat(dir)).mtime.toISOString()
      } catch {
        at = ''
      }
      entries.push({
        sessionId,
        title: (await projectionTitle(sessionId)) ?? '',
        at,
        status: 'archived',
        workspacePath: workspaceOf(sessionId)?.path ?? '',
        archived: true,
        inPlace: true,
        live: sessionRunning(sessionId),
      })
    }
    return entries
  }

  /**
   * Delete an archived Session for good: its log first, then its account.
   *
   * A loaded agent is not a running Session: archiving already stopped the work,
   * and DSH keeps the agent object resident. Only a Session with an open turn is
   * refused, because its log may still be appended to. A loaded-but-idle Session
   * is deleted and then parked — archived (hidden) until the next process start
   * detaches its account, so the row never reappears under "Ungrouped".
   */
  const purgeInPlace = async (sessionId) => {
    const id = String(sessionId)
    if (sessionRunning(id)) {
      return { ok: false, error: '该会话还有未结束的回合，先停止再来彻底删除' }
    }
    const dir = await trash.locateSession(id)
    if (dir === undefined) return { ok: false, error: '找不到该会话的存储目录' }
    const loaded = ctx.agents.get(id) !== undefined
    try {
      await fsp.rm(dir, { recursive: true, force: true })
      await fsp.rm(path.join(settings.storageDir, 'sessions', id), { recursive: true, force: true }).catch(() => {})
    } catch (error) {
      return { ok: false, error: `删除会话失败：${describeError(error)}` }
    }
    await dropProjectionCache(id)
    try {
      if (loaded) {
        await trash.registry.archive(id)
        await trash.registry.park(id)
      } else {
        await trash.registry.detach(id)
        await trash.registry.unarchive?.(id)
        await trash.registry.unpin?.(id)
      }
    } catch (error) {
      // The log is gone, so the row is a hidden archived ghost from now on; the
      // panel's cleanup reports it and can retry the account write.
      return { ok: false, error: `会话已删除，但清理侧栏条目失败：${describeError(error)}` }
    }
    return { ok: true }
  }

  /** Put one archived Session back into the sidebar. */
  const unarchiveSession = async (sessionId) => {
    const id = String(sessionId)
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined || typeof registry.unarchiveSession !== 'function') {
      return { ok: false, error: '当前装配没有 workspaceRegistry，无法取消归档' }
    }
    try {
      await registry.unarchiveSession(id)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: `还原失败：${describeError(error)}` }
    }
  }

  /**
   * Sidebar rows whose Session log is gone for good: accounted by a workspace,
   * not in the trash, and unknown to Session persistence. The stored record is
   * authoritative for the account — see {@link storedSessionIds} — and the
   * `ctx.agents` registry is no help here: this profile holds an agent for every
   * accounted Session, including deleted ones.
   */
  const ghosts = async () => {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined || typeof registry.list !== 'function') return []
    const found = []
    let workspaces = []
    try {
      workspaces = registry.list()
    } catch {
      return []
    }
    const parked = new Set(await readParked())
    for (const workspace of workspaces) {
      const ids = storedSessionIds(workspace.id) ?? workspace.sessionIds
      for (const sessionId of ids) {
        // A parked deletion is already hidden and will be detached at the next
        // process start; reporting it as a ghost would only add noise.
        if (parked.has(sessionId)) continue
        if (await trash.entryExists(sessionId)) continue
        if (await sessionExists(sessionId)) continue
        found.push({ sessionId, workspaceId: workspace.id, workspacePath: workspace.path })
      }
    }
    return found
  }

  /**
   * Drop one Session from its workspace account and its archive/pin sets.
   * The account is the sidebar row, so this is what "remove a Session whose log
   * is already gone" means.
   */
  const forgetSession = async (sessionId) => {
    try {
      await trash.registry.detach(sessionId)
    } catch (error) {
      return { ok: false, error: describeError(error) }
    }
    for (const step of ['unarchive', 'unpin']) {
      try {
        await trash.registry[step]?.(sessionId)
      } catch (error) {
        // The row is already detached; a stale archive/pin id is invisible.
        warn(`trash: forget could not ${step} ${sessionId}: ${describeError(error)}`)
      }
    }
    // The cache row can keep a grey, unopenable sidebar row alive on its own.
    await dropProjectionCache(sessionId)
    return { ok: true }
  }

  /** Account view for the prune report: what is stored versus what the UI sees. */
  const registrySnapshot = () => {
    try {
      const registry = ctx.get('workspaceRegistry')
      if (registry === undefined || typeof registry.list !== 'function') return []
      return registry.list().map((workspace) => ({
        id: workspace.id,
        path: workspace.path,
        stored: storedSessionIds(workspace.id) ?? null,
        visible: [...workspace.sessionIds],
      }))
    } catch {
      return []
    }
  }

  /** Why one accounted id is or is not treated as a ghost. */
  const probeAccount = async (sessionId) => ({
    sessionId,
    live: ctx.agents.get(sessionId) !== undefined,
    inTrash: await trash.entryExists(sessionId),
    inPersistence: await sessionExists(sessionId),
    hasLog: (await trash.locateSession(sessionId)) !== undefined,
    sessionsRoot: trash.sessionsRoot,
  })

  /**
   * Overwrite one small support snapshot of the last prune. A detached row that
   * a stale client keeps showing is diagnosed from this file, so it records what
   * the registry actually stored. Never throws.
   */
  const writePruneReport = async (report) => {
    try {
      await fsp.mkdir(settings.storageDir, { recursive: true })
      await fsp.writeFile(
        path.join(settings.storageDir, 'trash-prune.log'),
        `${new Date().toISOString()}\n${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      )
    } catch {
      /* diagnostics must never break the operation */
    }
  }

  /** Detach every ghost from its workspace account and its archive/pin sets. */
  const pruneGhosts = async () => {
    const candidates = await ghosts()
    const removed = []
    const failed = []
    const skipped = []
    for (const ghost of candidates) {
      // Detaching a Session this process still holds an agent for would move
      // its row from the workspace list into "Ungrouped", not remove it.
      if (ctx.agents.get(ghost.sessionId) !== undefined) {
        skipped.push({ sessionId: ghost.sessionId, reason: 'live' })
        continue
      }
      const result = await forgetSession(ghost.sessionId)
      if (result.ok) removed.push(ghost.sessionId)
      else failed.push({ sessionId: ghost.sessionId, error: result.error })
    }
    await writePruneReport({
      registry: registrySnapshot(),
      candidates: candidates.map((ghost) => ghost.sessionId),
      removed,
      failed,
      skipped,
    })
    return { removed, failed, skipped }
  }

  ctx.provide('trash', {
    list: () => trash.list(),
    discard: (sessionId, meta) => trash.discard(sessionId, meta),
    restore: (sessionId) => trash.restore(sessionId),
    purge: (sessionId) => trash.purge(sessionId),
    purgeAll: () => trash.purgeAll(),
    audit: () => trash.audit(),
    ghosts: () => ghosts(),
    pruneGhosts: () => pruneGhosts(),
    archived: () => archivedEntries(),
    purgeInPlace,
    unarchive: unarchiveSession,
  })

  // A real process start activates this plugin before the late web services are
  // mounted. Probing once for `connection` therefore mounted no route at all on
  // a cold start (the panel answered HTTP 404), so anything that needs a service
  // now waits for it through `ctx.inject` and re-registers if it is replaced.
  const whenAvailable = (name, callback) => {
    if (typeof ctx.inject === 'function') {
      ctx.inject([name], (scope) => callback(scope))
      return
    }
    callback(ctx)
  }

  /** Mount the trash JSON route on the shared API fetch channel. */
  let disposeRoute = () => {}
  const mountTrashRoute = (scope) => {
    const connection = scope?.connection ?? ctx.get('connection')
    if (connection === undefined || typeof connection.fetch?.register !== 'function') {
      warn('trash: no connection service, so the panel has no JSON route')
      return
    }
    const limits = { maxCheckpoints: settings.maxCheckpoints, retentionDays: settings.retentionDays }
    try {
      disposeRoute()
    } catch {
      /* a replaced service may already have disposed the previous route */
    }
    disposeRoute = ctx.effect(() => connection.fetch.register({
      path: TRASH_API_PATH,
      methods: ['GET', 'HEAD', 'POST'],
      requestBody: 'buffered',
      fetch: (request) => handleTrashApi(request, {
        trash,
        limits,
        warn,
        ghosts,
        pruneGhosts,
        titleOf: projectionTitle,
        archived: archivedEntries,
        purgeInPlace,
        unarchive: unarchiveSession,
        // Every page read is also a chance to finish a parked deletion whose
        // agent has gone away since the last check.
        settle: () => settleParked(),
      }),
    }), 'rewind: trash route')
    void fsp.mkdir(settings.storageDir, { recursive: true })
      .then(() => fsp.writeFile(
        path.join(settings.storageDir, 'trash-route.log'),
        `${new Date().toISOString()} mounted ${TRASH_API_PATH}\n`,
        'utf8',
      ))
      .catch(() => {})
  }

  // One account snapshot per activation: a row that refuses to disappear is then
  // diagnosable from the file, without asking anyone to run a command first.
  const writeActivationReport = async () => {
    try {
      const accounts = []
      try {
        for (const workspace of ctx.get('workspaceRegistry')?.list?.() ?? []) {
          for (const sessionId of storedSessionIds(workspace.id) ?? workspace.sessionIds) {
            accounts.push(await probeAccount(sessionId))
          }
        }
      } catch (error) {
        accounts.push({ error: describeError(error) })
      }
      await writePruneReport({
        reason: 'activation',
        registry: registrySnapshot(),
        agents: (() => {
          try {
            return (ctx.agents.list?.() ?? []).map((agent) => agent.id)
          } catch {
            return []
          }
        })(),
        accounts,
        candidates: (await ghosts()).map((ghost) => ghost.sessionId),
        removed: [],
        failed: [],
      })
    } catch {
      /* a diagnostic snapshot never breaks activation */
    }
  }

  whenAvailable('connection', mountTrashRoute)
  whenAvailable('workspaceRegistry', () => {
    // A parked deletion becomes detachable exactly when this process starts
    // without the Session's agent, so settle it before writing the report.
    void settleParked()
      .catch(() => ({ detached: [], pending: [] }))
      .then(() => writeActivationReport())
  })

  const trashLines = (entries) => {
    if (entries.length === 0) return '回收站是空的。'
    const lines = [`**回收站** · ${entries.length} 个会话`, '']
    for (const entry of entries) {
      lines.push(`- \`${entry.sessionId}\`${entry.title ? ` ${entry.title}` : ''} · ${entry.at}`)
    }
    lines.push('', '用 `/trash-restore <id>` 还原，`/trash-purge <id>` 彻底删除。')
    return lines.join('\n')
  }

  command({
    name: 'trash-list',
    description: '列出回收站里的会话',
    handler: async () => ({ kind: 'success', text: trashLines(await trash.list()) }),
  })
  command({
    name: 'trash',
    description: '把会话移入回收站；日志已丢失的失效条目会直接从侧栏移除',
    input: { hint: '<sessionId>' },
    handler: async (invocation) => {
      const id = readArgument(invocation.rawInput).split(/\s+/)[0]
      if (!id) return { kind: 'error', text: '缺少 sessionId' }
      const result = await trash.discard(id)
      if (result.ok) {
        return { kind: 'success', text: `已移入回收站：\`${id}\`。\n\n${trashLines(await trash.list())}` }
      }
      // No Session log left to archive. When the sidebar still accounts the id,
      // the row is a ghost: removing it is the only thing left to do, and it is
      // what asking to trash that Session means.
      const entry = (await ghosts()).find((ghost) => ghost.sessionId === id)
      if (entry !== undefined) {
        const forgotten = await forgetSession(id)
        return forgotten.ok
          ? { kind: 'success', text: `该会话的日志已不存在，已从侧栏移除：\`${id}\`。` }
          : { kind: 'error', text: `会话日志已丢失，但仍无法从侧栏移除：${forgotten.error}` }
      }
      return { kind: 'error', text: `${result.error}。\n\n若要清理所有日志已丢失的失效条目，用 \`/trash-prune\`。` }
    },
  })
  command({
    name: 'trash-restore',
    description: '把回收站里的会话还原并取消归档',
    input: { hint: '<sessionId>' },
    handler: async (invocation) => {
      const id = readArgument(invocation.rawInput).split(/\s+/)[0]
      if (!id) return { kind: 'error', text: '缺少 sessionId' }
      const result = await trash.restore(id)
      return result.ok ? { kind: 'success', text: `已还原：\`${id}\`` } : { kind: 'error', text: result.error }
    },
  })
  command({
    name: 'trash-purge',
    description: '彻底删除回收站里的一个会话副本（不影响会话本身）',
    input: { hint: '<sessionId>' },
    handler: async (invocation) => {
      const id = readArgument(invocation.rawInput).split(/\s+/)[0]
      if (!id) return { kind: 'error', text: '缺少 sessionId' }
      const result = await trash.purge(id)
      return result.ok ? { kind: 'success', text: `已彻底删除：\`${id}\`` } : { kind: 'error', text: result.error }
    },
  })
  command({
    name: 'trash-prune',
    description: '清理侧栏里日志已丢失的失效会话条目',
    handler: async () => {
      const result = await pruneGhosts()
      if (result.removed.length === 0 && result.failed.length === 0) {
        return { kind: 'success', text: '没有失效条目：侧栏里的每个会话都还有日志文件。' }
      }
      const lines = [result.removed.length === 0 ? '未清理任何条目。' : `已清理 ${result.removed.length} 个失效条目：${result.removed.join('、')}`]
      if (result.failed.length > 0) {
        lines.push('', '失败：')
        for (const item of result.failed) lines.push(`- ${item.sessionId}：${item.error}`)
      }
      return { kind: 'success', text: lines.join('\n') }
    },
  })

  command({
    name: 'rewind',
    description: '查看逐轮文件 checkpoint，并把文件还原到某一轮开始之前',
    input: { hint: '[turn|all|diff]' },
    handler: async (invocation) => {
      try {
        const argument = readArgument(invocation.rawInput)
        const mode = argument === '' || argument === 'list' || argument === 'diff' ? 'list' : 'rewind'
        return await run(invocation.agent.id, argument === 'list' ? '' : argument, mode)
      } catch (error) {
        return { kind: 'error', text: `rewind 失败：${describeError(error)}` }
      }
    },
  })

  command({
    name: 'rewind-message',
    description: '按 assistant 消息定位所属回合并回滚（供回滚菜单使用）',
    input: { hint: '<messageId> <code|fork|fork-code>' },
    handler: async (invocation) => {
      try {
        const argument = readArgument(invocation.rawInput)
        const [messageId, mode = 'fork-code'] = argument.split(/\s+/)
        if (!messageId) return { kind: 'error', text: '缺少 messageId' }
        if (mode !== 'code' && mode !== 'fork' && mode !== 'fork-code') {
          return { kind: 'error', text: `未知模式 \`${mode}\`（code | fork | fork-code）` }
        }
        const session = ctx.agents.get(invocation.agent.id)?.session
        const located = locateTurn(session, messageId)
        if (located === undefined) return { kind: 'error', text: '找不到该消息所属的回合' }
        const wantsFiles = mode === 'code' || mode === 'fork-code'
        const wantsFork = mode === 'fork' || mode === 'fork-code'
        const parts = []
        let childId
        if (wantsFork) {
          // Fork through the Host controller: it owns persistence, the session
          // catalog, and the cold-readable boundary semantics, and its failures
          // surface here instead of disappearing inside the client.
          const controller = ctx.get('sessionController')
          if (controller === undefined || typeof controller.fork !== 'function') {
            return { kind: 'error', text: '宿主没有暴露 sessionController.fork，无法新建会话' }
          }
          try {
            const forked = await controller.fork({ sessionId: invocation.agent.id, atSeq: located.startSeq - 1 })
            childId = typeof forked?.sessionId === 'string' && forked.sessionId !== '' ? forked.sessionId : undefined
          } catch (error) {
            return { kind: 'error', text: `分叉失败：${describeError(error)}` }
          }
          if (childId === undefined) return { kind: 'error', text: '分叉失败：宿主没有返回新会话 id' }
          let title
          try {
            title = await forkTitle(invocation.agent.id)
            await controller.rename({ sessionId: childId, title })
          } catch (error) {
            // A branch with the parent's title is still usable.
            warn(`rewind: fork title failed: ${describeError(error)}`)
            title = undefined
          }
          parts.push(title === undefined
            ? `已新建会话 ${childId}（停在同一步）。`
            : `已新建会话「${title}」（停在同一步）。`)
        }
        if (wantsFiles) {
          const outcome = await restoreTo(invocation.agent.id, located.turn)
          parts.push(formatRestore(outcome.report, outcome))
        }
        if (!wantsFork && !wantsFiles) parts.push('没有可执行的动作。')
        const prompt = promptOfSession(session, located.turn)
        const payload = { turn: located.turn, startSeq: located.startSeq, prompt, fork: wantsFork, childId }
        const text = `${parts.join('\n\n')}\n\n<!--rewind:data:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}-->`
        return { kind: 'success', text }
      } catch (error) {
        return { kind: 'error', text: `rewind-message 失败：${describeError(error)}` }
      }
    },
  })

  ctx.tools.register({
    name: 'rewind',
    description:
      'List this session\'s per-turn file checkpoints, diff them against the current files, or restore files to their state just before a turn. Restore only affects paths that the file tools (write/edit/delete) changed after the plugin was enabled.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'diff', 'restore'],
          description: 'list checkpoints, diff the plan for a turn against current files, or restore files.',
        },
        turn: {
          type: 'integer',
          description: 'For diff and restore: the first turn to undo. Omit for the latest checkpoint.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: typeof value?.text === 'string' ? value.text : '' }],
    },
    execute: async (args, exec) => {
      const sessionId = exec.agent?.id
      if (sessionId === undefined) return { text: '没有会话上下文，无法使用 rewind。' }
      const action = args?.action
      const state = await store.load(sessionId)
      if (action === 'list') return { text: formatList(sessionId, state.checkpoints) }
      if (state.checkpoints.length === 0) return { text: formatList(sessionId, state.checkpoints) }
      const fallback = lastTurn(state.checkpoints)
      const turn = Number.isInteger(args?.turn) ? args.turn : fallback
      if (action === 'diff') return { text: formatDiff(await diffTo(sessionId, turn), turn) }
      if (action === 'restore') {
        const outcome = await restoreTo(sessionId, turn)
        return { text: formatRestore(outcome.report, outcome) }
      }
      return { text: `未知 action \`${String(action)}\`。` }
    },
  })

  ctx.tools.register({
    name: 'trash',
    description:
      'Manage the recoverable trash of archived sessions: list the entries, restore one (unarchives it, moves its Session log and snapshots back, and re-attaches it to its workspace), delete one forever, prune sidebar entries whose Session log is already gone, or forget one (drop its workspace account and cached row without touching files). Deleting is irreversible and only ever removes the trash copy.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'restore', 'purge', 'prune', 'forget'],
          description: 'list entries, restore one, delete one forever, prune Sessions whose log is gone, or forget one.',
        },
        sessionId: {
          type: 'string',
          description: 'For restore, purge and forget: the exact session id shown by list.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: typeof value?.text === 'string' ? value.text : '' }],
    },
    execute: async (args) => {
      const action = args?.action
      if (action === 'list') return { text: trashLines(await trash.list()) }
      if (action === 'prune') {
        const result = await pruneGhosts()
        if (result.removed.length === 0 && result.failed.length === 0) return { text: '没有失效条目：侧栏里的每个会话都还有日志文件。' }
        const lines = [result.removed.length === 0 ? '未清理任何条目。' : `已清理 ${result.removed.length} 个失效条目：${result.removed.join('、')}`]
        if (result.failed.length > 0) {
          lines.push('', '失败：')
          for (const item of result.failed) lines.push(`- ${item.sessionId}：${item.error}`)
        }
        return { text: lines.join('\n') }
      }
      if (action !== 'restore' && action !== 'purge' && action !== 'forget') {
        return { text: `未知 action \`${String(action)}\`。` }
      }
      const id = typeof args?.sessionId === 'string' ? args.sessionId.trim() : ''
      if (id === '') return { text: `action=${action} 需要 sessionId；先用 list 查看。` }
      if (action === 'restore') {
        const result = await trash.restore(id)
        return { text: result.ok ? `已还原：${id}` : `还原失败：${result.error}` }
      }
      if (action === 'forget') {
        const result = await forgetSession(id)
        return { text: result.ok ? `已从侧栏与归档集合移除（文件未动）：${id}` : `移除失败：${result.error}` }
      }
      const result = await trash.purge(id)
      return { text: result.ok ? `已彻底删除：${id}` : `彻底删除失败：${result.error}` }
    },
  })

  ctx.logger?.debug?.(`rewind: file snapshots are stored under ${settings.storageDir}`)
}

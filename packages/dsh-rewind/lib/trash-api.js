/**
 * The JSON face of the trash for the Web UI.
 *
 * A panel needs structured data, and a command row can only carry text: the
 * Client reads `api/dsh-rewind/trash` and posts `{ action, sessionId }` back to
 * the same path. The route is registered on the shared API channel (through
 * `ctx.connection.fetch`), so only an admitted browser Peer reaches it and no
 * Session log record is written just to refresh a list.
 *
 * The handler is a plain function over a Fetch `Request`/`Response` pair, so
 * the whole request mapping is testable without an HTTP server.
 */
import { describeError } from './store.js'

/**
 * Absolute route below `/api` that answers the trash JSON API. The shared
 * fetch channel matches whole paths, so the Host registers the `/api` form.
 */
export const TRASH_API_PATH = '/api/dsh-rewind/trash'

/** Browser-relative form; the page resolves it against its document base. */
export const TRASH_API_ROUTE = TRASH_API_PATH.slice(1)

/** Payload version; the Client refuses a version it does not understand. */
export const TRASH_API_VERSION = 1

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function failure(status, code, message) {
  return json(status, { version: TRASH_API_VERSION, ok: false, error: { code, message } })
}

/** Only client-safe, already-normalized fields cross the wire. */
export function entryView(entry) {
  const record = entry !== null && typeof entry === 'object' ? entry : {}
  return {
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
    title: typeof record.title === 'string' ? record.title : '',
    at: typeof record.at === 'string' ? record.at : '',
    status: typeof record.status === 'string' ? record.status : 'trashed',
    workspacePath: typeof record.workspacePath === 'string' ? record.workspacePath : '',
    archived: record.archived === true,
    // Listed from the archive set with its log still in place, so "restore"
    // means unarchive rather than moving a copy back.
    inPlace: record.inPlace === true,
    live: record.live === true,
  }
}

function sessionIdOf(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 200) return undefined
  return trimmed
}

/** A full list snapshot: trash copies, archived Sessions, ghosts, and limits. */
export async function listPayload(trash, limits, ghosts, titleOf, archived) {
  const entries = await trash.list()
  let problems = []
  try {
    problems = (await trash.audit()).problems ?? []
  } catch (error) {
    problems = [{ sessionId: '', problem: describeError(error) }]
  }
  let orphaned = []
  if (typeof ghosts === 'function') {
    try {
      orphaned = (await ghosts()).map((ghost) => ({
        sessionId: typeof ghost?.sessionId === 'string' ? ghost.sessionId : '',
        workspacePath: typeof ghost?.workspacePath === 'string' ? ghost.workspacePath : '',
      }))
    } catch (error) {
      orphaned = []
      problems = [...problems, { sessionId: '', problem: describeError(error) }]
    }
  }
  // An entry written before titles were recorded still gets one: the title is
  // the only human handle a trashed Session has, and the browser searches it.
  const views = []
  for (const entry of entries) {
    const view = entryView(entry)
    if (view.title === '' && typeof titleOf === 'function') {
      try {
        const title = await titleOf(view.sessionId)
        if (typeof title === 'string' && title !== '') view.title = title
      } catch {
        /* a missing title only costs a nicer label */
      }
    }
    views.push(view)
  }
  if (typeof archived === 'function') {
    try {
      for (const entry of await archived()) {
        const view = entryView(entry)
        if (view.title === '' && typeof titleOf === 'function') {
          try {
            const title = await titleOf(view.sessionId)
            if (typeof title === 'string' && title !== '') view.title = title
          } catch {
            /* a missing title only costs a nicer label */
          }
        }
        views.push(view)
      }
    } catch {
      /* archived listing is additive: a failure must not hide the copies */
    }
  }
  // Newest first; an archived row without a timestamp sorts last.
  views.sort((left, right) => String(right.at).localeCompare(String(left.at)))
  return {
    version: TRASH_API_VERSION,
    ok: true,
    entries: views,
    problems,
    ghosts: orphaned,
    limits,
  }
}

/**
 * Answer one request on the trash route.
 * @param {Request} request admitted browser request.
 * @param {{trash: object, limits?: object, warn?: (text: string) => void, ghosts?: Function,
 *   pruneGhosts?: Function, titleOf?: Function, archived?: Function,
 *   purgeInPlace?: Function, unarchive?: Function}} options
 * @returns {Promise<Response>}
 */
export async function handleTrashApi(request, {
  trash, limits, warn, ghosts, pruneGhosts, titleOf, archived, purgeInPlace, unarchive, settle,
}) {
  const method = String(request?.method ?? 'GET').toUpperCase()
  try {
    if (method === 'GET' || method === 'HEAD') {
      // A parked deletion whose agent has gone away since the last read is
      // finished here, so a refresh can clear it without a restart.
      if (typeof settle === 'function') {
        try {
          await settle()
        } catch {
          /* parking is opportunistic; a failed sweep must not fail the read */
        }
      }
      return json(200, await listPayload(trash, limits, ghosts, titleOf, archived))
    }
    if (method !== 'POST') return failure(405, 'method', `不支持的方法 ${method}`)

    let body
    try {
      body = await request.json()
    } catch {
      return failure(400, 'bad-json', '请求体不是合法的 JSON')
    }
    const action = body !== null && typeof body === 'object' ? body.action : undefined

    if (action === 'discard') {
      const sessionId = sessionIdOf(body.sessionId)
      if (sessionId === undefined) return failure(400, 'bad-session', '缺少 sessionId')
      const result = await trash.discard(sessionId)
      if (result.ok !== true) {
        return failure(409, 'discard', typeof result.error === 'string' ? result.error : '移入回收站失败')
      }
      const payload = await listPayload(trash, limits, ghosts, titleOf, archived)
      return json(200, { ...payload, action, sessionId })
    }

    if (action === 'restore' || action === 'purge') {
      const sessionId = sessionIdOf(body.sessionId)
      if (sessionId === undefined) return failure(400, 'bad-session', '缺少 sessionId')
      const result = action === 'restore' ? await trash.restore(sessionId) : await trash.purge(sessionId)
      if (result.ok !== true) return failure(409, action, typeof result.error === 'string' ? result.error : `${action} 失败`)
      const payload = await listPayload(trash, limits, ghosts, titleOf, archived)
      return json(200, { ...payload, action, sessionId })
    }

    // An archived Session still has its log in place: restoring means leaving
    // the archive set, and deleting forever drops that log for good.
    if (action === 'unarchive' || action === 'purge-in-place') {
      const sessionId = sessionIdOf(body.sessionId)
      if (sessionId === undefined) return failure(400, 'bad-session', '缺少 sessionId')
      if (action === 'unarchive' && typeof unarchive !== 'function') {
        return failure(400, 'bad-action', '当前装配不支持取消归档')
      }
      if (action === 'purge-in-place' && typeof purgeInPlace !== 'function') {
        return failure(400, 'bad-action', '当前装配不支持删除归档会话')
      }
      const result = action === 'unarchive' ? await unarchive(sessionId) : await purgeInPlace(sessionId)
      if (result.ok !== true) {
        return failure(409, action, typeof result.error === 'string' ? result.error : `${action} 失败`)
      }
      const payload = await listPayload(trash, limits, ghosts, titleOf, archived)
      return json(200, { ...payload, action, sessionId })
    }

    if (action === 'purge-all') {
      const result = await trash.purgeAll()
      const purged = Array.isArray(result.purged) ? [...result.purged] : []
      const failed = Array.isArray(result.failed) ? [...result.failed] : []
      const skipped = []
      // The page shows two kinds of rows, so emptying it covers both: the moved
      // copies above and every archived Session listed in place. A Session this
      // process still runs cannot be deleted — its row survives until it stops —
      // so it is reported instead of silently left behind.
      if (typeof archived === 'function' && typeof purgeInPlace === 'function') {
        let entries = []
        try {
          entries = await archived()
        } catch {
          entries = []
        }
        for (const entry of Array.isArray(entries) ? entries : []) {
          const id = entry?.sessionId
          if (typeof id !== 'string' || id === '') continue
          if (entry.live === true) {
            skipped.push(id)
            continue
          }
          const outcome = await purgeInPlace(id)
          if (outcome?.ok === true) {
            purged.push(id)
          } else {
            failed.push({ sessionId: id, error: typeof outcome?.error === 'string' ? outcome.error : '删除失败' })
          }
        }
      }
      const payload = await listPayload(trash, limits, ghosts, titleOf, archived)
      return json(200, {
        ...payload,
        action,
        purged,
        failed,
        skipped,
      })
    }

    if (action === 'prune-ghosts') {
      if (typeof pruneGhosts !== 'function') return failure(400, 'bad-action', '当前装配不支持清理失效条目')
      const result = await pruneGhosts()
      const payload = await listPayload(trash, limits, ghosts, titleOf, archived)
      return json(200, {
        ...payload,
        action,
        removed: result.removed,
        failed: result.failed,
        skipped: result.skipped ?? [],
      })
    }

    return failure(400, 'bad-action', `未知的 action ${String(action)}`)
  } catch (error) {
    const text = describeError(error)
    try {
      warn?.(`trash api failed: ${text}`)
    } catch {
      /* logging must never break the response */
    }
    return failure(500, 'internal', text)
  }
}

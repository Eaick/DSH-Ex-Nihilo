/**
 * Read the prompt the user typed to open one turn, from a Session log.
 *
 * A `user/message` is not necessarily what the user typed: DSH also injects
 * `<system-reminder>` runtime context as a `user/message` whose `source.kind` is
 * `runtime-context`. Refilling the composer with that text is noise, so only
 * messages the user authored are read, and any reminder wrapper is stripped.
 */

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/**
 * Whether one `user/message` records text the user typed.
 *
 * Records written before the source field existed are treated as user-authored;
 * DSH's injected context always carries a non-user source kind.
 */
function authoredByUser(event) {
  const source = event?.data?.source
  if (source === null || typeof source !== 'object') return true
  return source.kind === 'user'
}

/** @param {readonly any[]} events ordered session events. */
export function promptForTurn(events, turn) {
  if (!Array.isArray(events)) return undefined
  const start = events.findIndex((event) => event?.type === 'turn/start' && event?.data?.turn === turn)
  if (start < 0) return undefined
  for (let index = start - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start') break
    if (event?.type !== 'user/message') continue
    if (!authoredByUser(event)) continue
    const blocks = Array.isArray(event.data?.content) ? event.data.content : []
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .replace(REMINDER, '')
      .trim()
    return text === '' ? undefined : text
  }
  return undefined
}

/** Read it straight from a Session object. */
export function promptOfSession(session, turn) {
  try {
    const events = typeof session?.ownEvents === 'function' ? session.ownEvents() : undefined
    return promptForTurn(events, turn)
  } catch {
    return undefined
  }
}

/**
 * Before-image capture and the restore plan.
 *
 * Capture reads through the composed `fs` service, so it follows the same
 * provider (local, sandboxed, or remote) the file tools write through and
 * never touches a path the provider would refuse.
 */
import { describeError } from './store.js'

/**
 * Capture one file as it is right now, before the pending mutation.
 * @param {object} fs the Host `fs` service.
 * @param {{ targetKey: string, displayPath: string }} target resolved FsTarget.
 * @param {number} maxBytes inclusive cap on a captured snapshot.
 * @returns {Promise<{kind: 'text', text: string} | {kind: 'absent'} | {kind: 'unsupported', reason: string}>}
 */
export async function captureBefore(fs, target, maxBytes) {
  let info
  try {
    info = await fs.stat(target)
  } catch (error) {
    return { kind: 'unsupported', reason: `stat failed: ${describeError(error)}` }
  }
  if (info === undefined) return { kind: 'absent' }
  if (info.type !== 'file') return { kind: 'unsupported', reason: `not a regular file (${info.type})` }
  if (typeof info.size === 'number' && info.size > maxBytes) {
    return { kind: 'unsupported', reason: `larger than ${maxBytes} bytes` }
  }
  try {
    const text = await fs.readText(target)
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      return { kind: 'unsupported', reason: `larger than ${maxBytes} bytes` }
    }
    return { kind: 'text', text }
  } catch (error) {
    return { kind: 'unsupported', reason: `not readable as text: ${describeError(error)}` }
  }
}

/**
 * Build the file plan for restoring the state just before `fromTurn`.
 *
 * A path is restored to its earliest capture at or after `fromTurn`, because
 * that is the only capture whose before-image equals the state at the start of
 * that turn; later captures hold states produced by the very turns being undone.
 *
 * @param {Array<{turn: number, files: Array<object>}>} checkpoints ordered records.
 * @param {number} fromTurn first turn to undo (inclusive).
 * @returns {Array<object>} one entry per path, in first-touched order.
 */
export function planRestore(checkpoints, fromTurn) {
  const ordered = [...checkpoints].filter((checkpoint) => checkpoint.turn >= fromTurn).sort((a, b) => a.turn - b.turn)
  const plan = new Map()
  for (const checkpoint of ordered) {
    for (const file of checkpoint.files ?? []) {
      if (!plan.has(file.path)) plan.set(file.path, { ...file, turn: checkpoint.turn })
    }
  }
  return [...plan.values()]
}

/**
 * Apply a restore plan: write, delete, skip links and unsupported snapshots.
 * Applying the same plan twice is a no-op because unchanged content is skipped.
 *
 * @returns {Promise<{restored: string[], deleted: string[], unchanged: string[], skipped: Array<{path: string, reason: string}>}>}
 */
export async function restoreFiles({ fs, store, sessionId, files, policy }) {
  const report = { restored: [], deleted: [], unchanged: [], skipped: [] }
  for (const file of files) {
    const label = typeof file.display === 'string' && file.display !== '' ? file.display : file.path
    const before = file.before
    if (before?.kind === 'unsupported') {
      report.skipped.push({ path: label, reason: before.reason })
      continue
    }
    let link
    try {
      link = await fs.lstat(file.path)
    } catch {
      link = undefined
    }
    if (link?.type === 'symlink') {
      report.skipped.push({ path: label, reason: 'symbolic link' })
      continue
    }
    if (link?.type === 'directory') {
      report.skipped.push({ path: label, reason: 'path is a directory' })
      continue
    }
    let target
    try {
      target = await fs.resolve(file.path)
    } catch (error) {
      report.skipped.push({ path: label, reason: `cannot resolve path: ${describeError(error)}` })
      continue
    }
    let info
    try {
      info = await fs.stat(target)
    } catch {
      info = undefined
    }
    if (before?.kind === 'absent') {
      if (info === undefined) {
        report.unchanged.push(label)
        continue
      }
      if (info.type !== 'file') {
        report.skipped.push({ path: label, reason: `not a regular file (${info.type})` })
        continue
      }
      try {
        await fs.deleteFile(target, undefined, undefined, policy)
        report.deleted.push(label)
      } catch (error) {
        report.skipped.push({ path: label, reason: describeError(error) })
      }
      continue
    }
    let text
    try {
      text = await store.readBlob(sessionId, before.sha)
    } catch (error) {
      report.skipped.push({ path: label, reason: `snapshot content is missing: ${describeError(error)}` })
      continue
    }
    if (info?.type === 'file') {
      let current
      try {
        current = await fs.readText(target)
      } catch {
        current = undefined
      }
      if (current === text) {
        report.unchanged.push(label)
        continue
      }
    } else if (info !== undefined) {
      report.skipped.push({ path: label, reason: `not a regular file (${info.type})` })
      continue
    }
    try {
      await fs.writeText(target, text, undefined, undefined, policy)
      report.restored.push(label)
    } catch (error) {
      report.skipped.push({ path: label, reason: describeError(error) })
    }
  }
  return report
}

/** Compare each planned file's snapshot against its current content, without writing. */
export async function diffPlan({ fs, store, sessionId, files }) {
  const rows = []
  for (const file of files) {
    const label = typeof file.display === 'string' && file.display !== '' ? file.display : file.path
    const before = file.before
    if (before?.kind === 'unsupported') {
      rows.push({ path: label, kind: 'unsupported', reason: before.reason })
      continue
    }
    let target
    try {
      target = await fs.resolve(file.path)
    } catch (error) {
      rows.push({ path: label, kind: 'unreadable', reason: describeError(error) })
      continue
    }
    let current
    try {
      current = await fs.readText(target)
    } catch {
      current = undefined
    }
    if (before?.kind === 'absent') {
      rows.push({ path: label, kind: current === undefined ? 'absent' : 'created' })
      continue
    }
    let snapshot
    try {
      snapshot = await store.readBlob(sessionId, before.sha)
    } catch {
      rows.push({ path: label, kind: 'unavailable', reason: 'snapshot content is missing' })
      continue
    }
    rows.push({
      path: label,
      kind: current === undefined ? 'deleted' : current === snapshot ? 'unchanged' : 'modified',
    })
  }
  return rows
}

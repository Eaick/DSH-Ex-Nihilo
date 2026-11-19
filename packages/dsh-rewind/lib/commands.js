/** Command rows are plain text, so markdown markers must not reach them. */
export function plain(text) {
  return String(text ?? '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
}

/** User-facing text for the rewind commands. */

function baseName(display) {
  const text = String(display ?? '')
  const parts = text.split(/[\\/]/).filter((part) => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : text
}

function timeOf(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** Argument text after the command name, tolerating a leading `/name`. */
export function readArgument(rawInput) {
  const raw = String(rawInput ?? '').trim()
  if (raw === '') return ''
  const tokens = raw.split(/\s+/)
  if (tokens[0]?.startsWith('/')) tokens.shift()
  return tokens.join(' ').trim()
}

export function formatList(sessionId, checkpoints) {
  if (checkpoints.length === 0) {
    return [
      '还没有任何 checkpoint。',
      '',
      '本插件只记录它启用之后、由文件工具（写/改/删）产生的改动；bash 命令改的文件和插件事前就已经完成的回合不在其中。',
    ].join('\n')
  }
  const ordered = [...checkpoints].sort((a, b) => b.turn - a.turn)
  const lines = [
    `**Rewind** · session \`${sessionId}\` · 共 ${ordered.length} 个 checkpoint`,
    '',
    '| turn | 时间 | 文件 | 涉及文件 |',
    '| --- | --- | --- | --- |',
  ]
  for (const checkpoint of ordered.slice(0, 30)) {
    const files = checkpoint.files ?? []
    const names = files.slice(0, 3).map((file) => `\`${baseName(file.display ?? file.path)}\``).join('、')
    const more = files.length > 3 ? ` 等 ${files.length} 个` : ''
    const time = `${timeOf(checkpoint.at)}${checkpoint.open === true ? ' · 进行中' : ''}${checkpoint.git === undefined ? '' : ' · git'}`
    lines.push(`| ${checkpoint.turn} | ${time} | ${files.length} | ${names}${more} |`)
  }
  if (ordered.length > 30) lines.push('', `仅显示最近 30 条，共 ${ordered.length} 条。`)
  lines.push(
    '',
    '`/undo <turn>` 或 `/rewind <turn>`：把文件还原到该轮开始之前；',
    '`/undo all`：还原到第一条 checkpoint 之前；省略参数时取最近一条。',
  )
  return lines.join('\n')
}

export function formatRestore(report, { fromTurn, fileCount, git }) {
  const lines = []
  const touched = report.restored.length + report.deleted.length
  if (touched === 0 && report.skipped.length === 0) {
    lines.push(`第 ${fromTurn} 轮之前的状态与当前一致（${report.unchanged.length} 个文件未变化），无需还原。`)
  } else {
    lines.push(`已还原到第 ${fromTurn} 轮开始之前：共计划 ${fileCount} 个文件，改写 ${report.restored.length} 个、删除 ${report.deleted.length} 个、未变化 ${report.unchanged.length} 个。`)
    if (report.restored.length > 0) lines.push('', `**改写**：${report.restored.map((path) => `\`${path}\``).join('、')}`)
    if (report.deleted.length > 0) lines.push('', `**删除**：${report.deleted.map((path) => `\`${path}\``).join('、')}`)
    if (report.skipped.length > 0) {
      lines.push('', `**跳过 ${report.skipped.length} 个**：`)
      for (const item of report.skipped) lines.push(`- \`${item.path}\`：${item.reason}`)
    }
  }
  if (git !== undefined) {
    if (typeof git.error === 'string') lines.push('', `**git 快照**：还原失败（${git.error}）`)
    else if (typeof git.skipped === 'string') lines.push('', `**git 快照**：跳过（${git.skipped}）`)
    else if (typeof git.restored === 'number' && git.restored > 0) {
      lines.push('', `**git 快照**：按第 ${git.turn} 轮起点还原 ${git.restored} 个工作树文件（含 bash / 脚本改动）`)
    }
    if (typeof git.remaining === 'number' && git.remaining > 0) {
      const sample = (git.remainingPaths ?? []).map((path) => `\`${path}\``).join('、')
      lines.push('', `⚠️ 仍有 ${git.remaining} 个文件与快照不一致${sample === '' ? '' : `：${sample}`}`)
    }
  }
  return lines.join('\n')
}

export function formatDiff(rows, fromTurn) {
  if (rows.length === 0) return `第 ${fromTurn} 轮之前没有可比较的文件记录。`
  const labels = {
    modified: '已改动',
    unchanged: '未改动',
    created: '新增',
    absent: '不存在',
    deleted: '已删除',
    unsupported: '不支持',
    unreadable: '读不到',
    unavailable: '快照缺失',
  }
  const lines = [`**Rewind diff** · 相对第 ${fromTurn} 轮之前`, '', '| 文件 | 状态 | 说明 |', '| --- | --- | --- |']
  for (const row of rows) {
    lines.push(`| \`${row.path}\` | ${labels[row.kind] ?? row.kind} | ${row.reason ?? ''} |`)
  }
  return lines.join('\n')
}

/** Parse a turn argument into a number ('all' resolves against the checkpoint list). */
export function parseTurn(argument, checkpoints, mode) {
  if (argument === '') {
    if (checkpoints.length === 0) return { kind: 'empty' }
    const turns = checkpoints.map((checkpoint) => checkpoint.turn)
    return { kind: 'number', turn: mode === 'rewind' ? Math.min(...turns) : Math.max(...turns) }
  }
  if (argument === 'all' || argument === 'start') {
    if (checkpoints.length === 0) return { kind: 'empty' }
    return { kind: 'number', turn: Math.min(...checkpoints.map((checkpoint) => checkpoint.turn)) }
  }
  const value = Number(argument)
  if (!Number.isInteger(value) || value < 0) return { kind: 'invalid', argument }
  return { kind: 'number', turn: value }
}

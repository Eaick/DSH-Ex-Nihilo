// Diagnose and repair a session log corrupted by the removed in-place rewind.
//
// Usage:
//   node repair-session.cjs <log> --check
//   node repair-session.cjs <log> --write
const fs = require('node:fs')
const zlib = require('node:zlib')

const file = process.argv[2]
const mode = process.argv[3] ?? '--check'

function decodeFrames(buffer) {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const offsets = []
  let cursor = buffer.indexOf(magic)
  while (cursor >= 0) {
    offsets.push(cursor)
    cursor = buffer.indexOf(magic, cursor + 1)
  }
  const chunks = []
  for (let i = 0; i < offsets.length; i += 1) {
    const from = offsets[i]
    let to = i + 1 < offsets.length ? offsets[i + 1] : buffer.length
    let decoded
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        decoded = zlib.zstdDecompressSync(buffer.subarray(from, to))
        break
      } catch {
        to = i + 1 + attempt < offsets.length ? offsets[i + 1 + attempt] : buffer.length
      }
    }
    if (decoded !== undefined) chunks.push(decoded)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const text = decodeFrames(fs.readFileSync(file))
const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
const header = JSON.parse(lines[0])
const events = lines.slice(1).map((line) => JSON.parse(line))

const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])
const ENVELOPE = new Set(['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable'])
const MARKER = /^↩ 已回退到第 \d+ 轮之前$/

const problems = []
for (let index = 0; index < events.length; index += 1) {
  const event = events[index]
  const subject = `event seq ${event.seq}`
  if (event.seq !== index) problems.push(`${subject}: seq is not dense (expected ${index})`)
  for (const key of Object.keys(event)) if (!ENVELOPE.has(key)) problems.push(`${subject}: unexpected envelope key ${key}`)
  if (SURFACE.has(event.type)) {
    if (event.surfaceOp === undefined) problems.push(`${subject}: surface event without surfaceOp`)
    const message = event.type === 'user/message' ? event.data : event.data?.message
    if (typeof message?.id !== 'string' || message.id === '') problems.push(`${subject}: lacks an identified message`)
  }
  if (event.sourceEventSeqs !== undefined) {
    const flat = []
    for (const entry of event.sourceEventSeqs) {
      if (Array.isArray(entry)) {
        for (let value = entry[0]; value <= entry[1]; value += 1) flat.push(value)
      } else flat.push(entry)
    }
    for (const ref of flat) if (!(ref < event.seq)) problems.push(`${subject}: sourceEventSeq ${ref} is not earlier`)
  }
  if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') {
    const op = event.surfaceOp
    if (op.startSeq >= event.seq || op.endSeq >= event.seq) problems.push(`${subject}: replace endpoints are not earlier`)
  }
}

const markers = events.filter((event) => {
  const first = event.data?.content?.[0]
  return event.type === 'user/message' && first?.type === 'text' && MARKER.test(first.text)
}).map((event) => event.seq)

console.log('header id:', header.id, 'version:', header.version)
console.log('events:', events.length, 'markers:', markers.join(',') || 'none')
console.log('problems:', problems.length)
for (const problem of problems.slice(0, 20)) console.log(' -', problem)

if (mode === '--write') {
  // Drop everything from the first marker on: the tail is only command rows plus
  // the invalid markers, and truncating keeps the log a dense valid prefix. The
  // command/run right before the marker goes too, so no completion is left
  // dangling.
  const cut = events.findIndex((event) => markers.includes(event.seq)) - 1
  if (cut <= 0) {
    console.error('nothing to repair')
    process.exit(1)
  }
  const kept = events.slice(0, cut)
  console.log('last kept event:', kept[kept.length - 1].seq, kept[kept.length - 1].type)
  const headerLine = JSON.stringify(header) + '\n'
  const frames = [zlib.zstdCompressSync(Buffer.from(headerLine, 'utf8'))]
  const batchSize = 32
  for (let index = 0; index < kept.length; index += batchSize) {
    const body = kept.slice(index, index + batchSize).map((event) => JSON.stringify(event) + '\n').join('')
    frames.push(zlib.zstdCompressSync(Buffer.from(body, 'utf8')))
  }
  const repaired = Buffer.concat(frames)
  const out = `${file}.repaired`
  fs.writeFileSync(out, repaired)
  console.log('wrote', out, repaired.length, 'bytes; events kept:', kept.length, 'last seq:', kept[kept.length - 1].seq)

  // Verify the repaired artifact decodes and stays dense with no markers left.
  const verifyText = decodeFrames(fs.readFileSync(out))
  const verifyLines = verifyText.split(/\r?\n/).filter((line) => line.trim() !== '')
  const verifyEvents = verifyLines.slice(1).map((line) => JSON.parse(line))
  const dense = verifyEvents.every((event, index) => event.seq === index)
  const leftover = verifyEvents.some((event) => {
    const first = event.data?.content?.[0]
    return event.type === 'user/message' && first?.type === 'text' && MARKER.test(first.text)
  })
  const missingIds = verifyEvents.filter((event) => {
    if (!SURFACE.has(event.type)) return false
    const message = event.type === 'user/message' ? event.data : event.data?.message
    return typeof message?.id !== 'string' || message.id === ''
  }).length
  console.log('verify: events', verifyEvents.length, 'dense', dense, 'markers', leftover, 'missingIds', missingIds)
}

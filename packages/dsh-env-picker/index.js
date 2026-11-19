/**
 * Session environment picker — Host half.
 *
 * Keeps one per-session selection for every toolchain group (Python, Node.js,
 * C/C++, Java), derives it from the session log (the `/env` command lifecycle),
 * exposes it to the Web client as the `envPicker` session projection, and turns
 * it into model guidance: a scoped system-prompt section plus the trusted
 * `DSH_*` shell facts.
 *
 * No session event type is invented: the state folds the shipped `command/run`
 * records, so fork, resume, and replay all reconstruct the same selection.
 *
 * @module @local/dsh-env-picker
 */

import { exec } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export const name = 'env-picker'
export const inject = ['agents', 'commands', 'shellEnv', 'sessionProjections', 'systemPrompt']

/** Session projection key carrying the selection and every group's options. */
const PROJECTION_KEY = 'envPicker'
/** Slash command that switches the selection; its lifecycle is the durable state. */
const COMMAND_NAME = 'env'
/** Prompt section name; the per-agent scoped section shadows the global default. */
const SECTION_NAME = 'env-picker'
/** Prompt section order: after the shell tool guidance (1010). */
const SECTION_ORDER = 1500

/** Toolchain groups in display order; each maps to one selectable environment. */
const KIND_LABELS = { python: 'Python', node: 'Node.js', c: 'C', cpp: 'C++', java: 'Java', gdb: '调试器' }
const KIND_ALIASES = {
  python: 'python', py: 'python',
  node: 'node', nodejs: 'node', js: 'node',
  c: 'c', gcc: 'c', cc: 'c',
  cpp: 'cpp', cxx: 'cpp', 'c++': 'cpp', 'g++': 'cpp', gpp: 'cpp',
  java: 'java', jdk: 'java', jre: 'java',
  gdb: 'gdb', debugger: 'gdb',
}

/** Where Windows installations usually put C/C++ toolchains and JDKs. */
const COMMON_CC_DIRS = [
  'C:\\msys64\\mingw64\\bin',
  'C:\\msys64\\ucrt64\\bin',
  'C:\\msys64\\clang64\\bin',
  'C:\\mingw64\\bin',
  'C:\\MinGW\\bin',
  'C:\\Program Files\\LLVM\\bin',
]
const JAVA_SCAN_ROOTS = [
  'C:\\Program Files\\Java',
  'C:\\Program Files\\Eclipse Adoptium',
  'C:\\Program Files\\Microsoft',
  'C:\\Program Files\\Zulu',
  'C:\\Program Files\\BellSoft',
  'C:\\Program Files\\Amazon Corretto',
  'C:\\Program Files\\AdoptOpenJDK',
]

/**
 * Minimal schema facade accepted by the projection registry for this Host half.
 * State and view are plain JSON built here, so validation is identity.
 */
function schemaFacade() {
  return {
    parse: value => value,
    safeParse: value => ({ success: true, data: value }),
  }
}

/** Run one short command and resolve its first stdout line, or undefined. */
function firstLine(command, timeout = 5000) {
  return new Promise((resolve) => {
    exec(command, { timeout, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(undefined)
        return
      }
      const line = String(stdout).split(/\r?\n/).map(item => item.trim()).find(item => item.length > 0)
      resolve(line)
    })
  })
}

/** Resolve one executable through the ambient PATH. */
async function which(name) {
  return firstLine(`where ${name}`)
}

/** Normalize a free-form name into a stable option id. */
function toId(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'env'
}

/** Append one option unless its id or executable path is already listed. */
function pushUnique(list, item) {
  if (list.some(other => other.id === item.id || other.path.toLowerCase() === item.path.toLowerCase())) return
  list.push(item)
}

/** Build one option record. */
function option(id, label, path, kind, extra = {}) {
  return { id, label, path, kind, ...extra }
}

/** Read the Harness home directory the profile exposes, without assuming a layout. */
function harnessHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir.length > 0) return dirname(dirname(profileDir))
  if (typeof process.env.USERPROFILE === 'string' && process.env.USERPROFILE.length > 0) {
    return join(process.env.USERPROFILE, '.dsh')
  }
  return undefined
}

/** Detect the bundled runtimes shipped under `<home>/dsh-runtimes/<name>/dependencies`. */
function bundledRuntimes(kind) {
  const home = harnessHome()
  if (home === undefined) return []
  const root = join(home, 'dsh-runtimes')
  if (!existsSync(root)) return []
  const found = []
  let directories = []
  try {
    directories = readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())
  } catch {
    return []
  }
  for (const directory of directories) {
    const dependencies = join(root, directory.name, 'dependencies')
    if (kind === 'python') {
      const python = join(dependencies, 'python', 'python.exe')
      if (existsSync(python)) found.push(option('dsh-python', 'DSH 内置', python, 'bundled'))
    }
    if (kind === 'node') {
      const node = join(dependencies, 'node', 'bin', 'node.exe')
      if (existsSync(node)) found.push(option('dsh-node', 'DSH 内置', node, 'bundled'))
    }
  }
  return found
}

/** List conda environments as prefix strings; empty when conda is unavailable. */
function condaEnvironments() {
  return new Promise((resolve) => {
    exec('conda env list --json', { timeout: 8000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve([])
        return
      }
      try {
        const parsed = JSON.parse(String(stdout))
        const environments = Array.isArray(parsed.envs) ? parsed.envs : []
        resolve(environments.filter(item => typeof item === 'string' && existsSync(join(item, 'python.exe'))))
      } catch {
        resolve([])
      }
    })
  })
}

/** Config-provided options for one kind. */
function configuredOptions(config, kind) {
  const list = Array.isArray(config[kind]) ? config[kind] : []
  return list.flatMap((item) => {
    if (item === null || typeof item !== 'object' || typeof item.path !== 'string') return []
    const id = toId(item.id ?? basename(dirname(item.path)))
    return [option(id, String(item.label ?? item.id ?? item.path), item.path, 'custom', {
      home: typeof item.home === 'string' ? item.home : undefined,
      detail: typeof item.detail === 'string' ? item.detail : undefined,
    })]
  })
}

/** Python: conda environments, the ambient PATH, the bundled runtime, and config. */
async function buildPython(config) {
  const options = []
  for (const item of configuredOptions(config, 'python')) pushUnique(options, item)
  for (const prefix of await condaEnvironments()) {
    const parts = prefix.split(/[\\/]/).filter(Boolean)
    const isBase = !parts.includes('envs')
    const label = isBase ? 'base' : basename(prefix)
    pushUnique(options, option(toId(label), label, join(prefix, 'python.exe'), 'conda'))
  }
  pushUnique(options, option('path', '系统 PATH', 'python', 'path'))
  for (const item of bundledRuntimes('python')) pushUnique(options, item)
  return { kind: 'python', label: KIND_LABELS.python, options }
}

/** Node.js: config, the ambient PATH, and the bundled runtime. */
async function buildNode(config) {
  const options = []
  for (const item of configuredOptions(config, 'node')) pushUnique(options, item)
  pushUnique(options, option('path', '系统 PATH', 'node', 'path'))
  for (const item of bundledRuntimes('node')) pushUnique(options, item)
  return { kind: 'node', label: KIND_LABELS.node, options }
}

/** C and C++: one row per toolchain for each language, from PATH, MinGW/LLVM dirs, and config. */
async function buildCNative(config) {
  const toolchains = []
  const addToolchain = (gcc) => {
    if (typeof gcc !== 'string' || gcc.length === 0) return
    if (toolchains.some(item => item.gcc.toLowerCase() === gcc.toLowerCase())) return
    const dir = dirname(gcc)
    const gxx = join(dir, 'g++.exe')
    toolchains.push({ gcc, gxx: existsSync(gxx) ? gxx : undefined, dir })
  }
  for (const item of configuredOptions(config, 'c')) addToolchain(item.path)
  const gccOnPath = await which('gcc')
  if (gccOnPath !== undefined) addToolchain(gccOnPath)
  for (const directory of COMMON_CC_DIRS) {
    const gcc = join(directory, 'gcc.exe')
    if (existsSync(gcc)) addToolchain(gcc)
  }
  const c = []
  const cpp = []
  for (const toolchain of toolchains) {
    const banner = await firstLine(`"${toolchain.gcc}" --version`) ?? ''
    const version = /(\d+\.\d+(?:\.\d+)?)/.exec(banner)?.[1]
    const base = version === undefined ? 'GCC' : `GCC ${version}`
    const source = /[\\/]scoop[\\/]/i.test(toolchain.gcc) ? 'Scoop' : /msys|mingw/i.test(toolchain.gcc) ? 'MinGW' : /LLVM/i.test(toolchain.gcc) ? 'LLVM' : undefined
    const label = source === undefined ? base : `${base}（${source}）`
    const id = toId(`${source ?? basename(dirname(toolchain.dir))}-gcc`)
    const shared = { home: toolchain.dir }
    pushUnique(c, option(id, label, toolchain.gcc, 'path', shared))
    if (toolchain.gxx !== undefined) pushUnique(cpp, option(id, label, toolchain.gxx, 'path', shared))
  }
  for (const item of configuredOptions(config, 'cpp')) pushUnique(cpp, item)
  if (c.length === 0) c.push(option('path', '系统 PATH', 'gcc', 'path'))
  if (cpp.length === 0) cpp.push(option('path', '系统 PATH', 'g++', 'path'))
  return [
    { kind: 'c', label: KIND_LABELS.c, options: c },
    { kind: 'cpp', label: KIND_LABELS.cpp, options: cpp },
  ]
}

/** GNU debugger: the PATH gdb, common MinGW/LLVM directories, and config. */
async function buildGdb(config) {
  const options = []
  for (const item of configuredOptions(config, 'gdb')) pushUnique(options, item)
  const candidates = []
  const gdbOnPath = await which('gdb')
  if (gdbOnPath !== undefined) candidates.push(gdbOnPath)
  for (const directory of COMMON_CC_DIRS) {
    const gdb = join(directory, 'gdb.exe')
    if (existsSync(gdb)) candidates.push(gdb)
  }
  for (const gdb of candidates) {
    const banner = await firstLine(`"${gdb}" --version`) ?? ''
    const version = /(\d+\.\d+(?:\.\d+)?)/.exec(banner)?.[1]
    const label = version === undefined ? 'GDB' : `GDB ${version}`
    pushUnique(options, option(toId(`gdb-${version ?? 'path'}`), label, gdb, 'path', { home: dirname(gdb) }))
  }
  if (options.length === 0) options.push(option('path', '系统 PATH', 'gdb', 'path'))
  return { kind: 'gdb', label: KIND_LABELS.gdb, options }
}

/** Read `JAVA_VERSION` from a JDK home's release file. */
function javaVersion(home) {
  try {
    const release = readFileSync(join(home, 'release'), 'utf8')
    const match = /JAVA_VERSION="([^"]+)"/.exec(release)
    if (match !== null) return match[1]
  } catch {
    // No release file: fall back to the directory name.
  }
  return undefined
}

/** Every plausible JDK home: JAVA_HOME, the PATH java, scanned install roots, config. */
async function javaHomes(config) {
  const homes = []
  const add = (home) => {
    if (typeof home !== 'string' || home.length === 0) return
    if (!existsSync(join(home, 'bin', 'java.exe'))) return
    if (!homes.some(other => other.toLowerCase() === home.toLowerCase())) homes.push(home)
  }
  add(process.env.JAVA_HOME)
  const javaOnPath = await which('java')
  if (javaOnPath !== undefined) add(dirname(dirname(javaOnPath)))
  const scan = (root, depth) => {
    if (depth > 2 || !existsSync(root)) return
    let entries = []
    try {
      entries = readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(root, entry.name)
      if (existsSync(join(path, 'bin', 'java.exe'))) add(path)
      else scan(path, depth + 1)
    }
  }
  for (const root of JAVA_SCAN_ROOTS) scan(root, 0)
  for (const item of configuredOptions(config, 'java')) {
    add(typeof item.home === 'string' ? item.home : undefined)
  }
  return homes
}

/** Java: every JDK found, plus config-provided JDKs. */
async function buildJava(config) {
  const options = []
  for (const item of configuredOptions(config, 'java')) pushUnique(options, item)
  for (const home of await javaHomes(config)) {
    const version = javaVersion(home)
    const label = version === undefined ? basename(home) : `JDK ${version}`
    pushUnique(options, option(toId(basename(home)), label, join(home, 'bin', 'java.exe'), 'path', {
      home,
      detail: `JAVA_HOME：${home}`,
      extras: { javac: join(home, 'bin', 'javac.exe') },
    }))
  }
  if (options.length === 0) options.push(option('path', '系统 PATH', 'java', 'path'))
  return { kind: 'java', label: KIND_LABELS.java, options }
}

/** Build the catalog: one group per toolchain, each with ordered options. */
async function buildCatalog(config) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const groups = []
  groups.push(await buildPython(settings))
  groups.push(await buildNode(settings))
  groups.push(...await buildCNative(settings))
  groups.push(await buildJava(settings))
  groups.push(await buildGdb(settings))
  return groups
}

/**
 * Default state: one selected option and one enable flag per group.
 * Custom (user-added) options and hidden detected options live in the session.
 */
function defaultsOf(groups, config) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const current = {}
  const enabled = {}
  for (const group of groups) {
    const wanted = settings[`default${group.kind[0].toUpperCase()}${group.kind.slice(1)}`]
    const match = typeof wanted === 'string' ? group.options.find(item => item.id === wanted) : undefined
    current[group.kind] = (match ?? group.options[0]).id
    enabled[group.kind] = true
  }
  return { current, enabled, custom: [], hidden: [] }
}

/** The visible options of one group: detected ones plus user-added ones, minus hidden ones. */
function effectiveOptions(group, state) {
  const custom = (state.custom ?? [])
    .filter(item => item.kind === group.kind)
    .map(item => ({ id: item.id, label: item.label, path: item.path, kind: 'custom' }))
  const hidden = new Set(state.hidden ?? [])
  return [...group.options, ...custom].filter(item => !hidden.has(`${group.kind}:${item.id}`))
}

/** The selected option of one group, falling back to the first visible one. */
function currentOf(group, state) {
  const options = effectiveOptions(group, state)
  return options.find(item => item.id === state.current?.[group.kind]) ?? options[0]
}

/** One group is active unless the session disabled it. */
function groupEnabled(state, kind) {
  return state.enabled?.[kind] !== false
}

/** Split one command line into tokens, honoring double and single quotes. */
function tokenize(text) {
  const tokens = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

/** Parse `/env` arguments into an action; `null` means unusable input. */
function parseArgs(raw) {
  const text = String(raw ?? '').trim().replace(/^\/(?:env|environment)\b/i, '').trim()
  if (text.length === 0) return { kind: 'report' }
  const tokens = tokenize(text)
  if (tokens.length === 0) return { kind: 'report' }
  const head = tokens[0].toLowerCase()
  if (head === 'reset' || head === 'default' || head === 'defaults' || head === 'clear') return { kind: 'reset' }
  if (head === 'list' || head === 'ls' || head === 'status') return { kind: 'report' }
  if (head === 'enable' || head === 'disable') {
    const kind = KIND_ALIASES[tokens[1] === undefined ? '' : tokens[1].toLowerCase()]
    if (kind === undefined) return null
    return { kind: head === 'enable' ? 'enable' : 'disable', group: kind }
  }
  if (head === 'add' || head === 'new') {
    const kind = KIND_ALIASES[tokens[1] === undefined ? '' : tokens[1].toLowerCase()]
    if (kind === undefined || tokens.length < 4) return null
    return { kind: 'add', group: kind, label: tokens[2], path: tokens.slice(3).join(' ') }
  }
  if (head === 'remove' || head === 'rm' || head === 'delete' || head === 'hide') {
    const kind = KIND_ALIASES[tokens[1] === undefined ? '' : tokens[1].toLowerCase()]
    if (kind === undefined || tokens.length < 3) return null
    return { kind: 'remove', group: kind, id: tokens.slice(2).join(' ') }
  }
  if (head === 'show' || head === 'unhide') {
    if (tokens[1] !== undefined && tokens[1].toLowerCase() === 'all') {
      const kind = KIND_ALIASES[tokens[2] === undefined ? '' : tokens[2].toLowerCase()]
      return kind === undefined ? null : { kind: 'showall', group: kind }
    }
    const kind = KIND_ALIASES[tokens[1] === undefined ? '' : tokens[1].toLowerCase()]
    if (kind === undefined || tokens.length < 3) return null
    return { kind: 'show', group: kind, id: tokens.slice(2).join(' ') }
  }
  const kind = KIND_ALIASES[head]
  if (kind === undefined || tokens.length < 2) return null
  return { kind: 'set', group: kind, id: tokens.slice(1).join(' ').trim() }
}

/** Resolve one option by id, label, or executable path. */
function findOption(options, id) {
  const wanted = String(id ?? '').toLowerCase()
  return options.find(item => item.id === wanted)
    ?? options.find(item => item.label.toLowerCase() === wanted)
    ?? options.find(item => item.path.toLowerCase() === wanted)
    ?? options.find(item => (item.home ?? '').toLowerCase() === wanted)
}

/** Resolve one action against the catalog and the current state; same reference means no change. */
function reduce(groups, defaults, state, action) {
  if (action === null || action.kind === 'report') return state
  if (action.kind === 'reset') {
    return { ...defaults, custom: state.custom, enabled: { ...defaults.enabled } }
  }
  const group = groups.find(item => item.kind === action.group)
  if (group === undefined) return state

  if (action.kind === 'enable' || action.kind === 'disable') {
    const next = action.kind === 'enable'
    if (groupEnabled(state, group.kind) === next) return state
    return { ...state, enabled: { ...state.enabled, [group.kind]: next } }
  }

  if (action.kind === 'add') {
    const label = String(action.label ?? '').trim()
    const path = String(action.path ?? '').trim()
    if (label.length === 0 || path.length === 0) return state
    const taken = new Set([
      ...group.options.map(item => item.id),
      ...state.custom.filter(item => item.kind === group.kind).map(item => item.id),
    ])
    const base = toId(label)
    let id = base
    let suffix = 2
    while (taken.has(id)) id = `${base}-${suffix++}`
    const entry = { kind: group.kind, id, label, path }
    return {
      ...state,
      custom: [...state.custom, entry],
      current: { ...state.current, [group.kind]: id },
    }
  }

  if (action.kind === 'remove') {
    const found = findOption(effectiveOptions(group, state), action.id)
    if (found === undefined) return state
    const customIndex = state.custom.findIndex(item => item.kind === group.kind && item.id === found.id)
    if (customIndex >= 0) {
      const custom = state.custom.filter((_, index) => index !== customIndex)
      const remaining = [...group.options, ...custom.filter(item => item.kind === group.kind)]
        .filter(item => !state.hidden.includes(`${group.kind}:${item.id}`))
      const nextCurrent = state.current[group.kind] === found.id
        ? (remaining[0]?.id ?? state.current[group.kind])
        : state.current[group.kind]
      return { ...state, custom, current: { ...state.current, [group.kind]: nextCurrent } }
    }
    const hidden = [...state.hidden, `${group.kind}:${found.id}`]
    const remaining = group.options.filter(item => !hidden.includes(`${group.kind}:${item.id}`))
    const nextCurrent = state.current[group.kind] === found.id
      ? (remaining[0]?.id ?? state.current[group.kind])
      : state.current[group.kind]
    return { ...state, hidden, current: { ...state.current, [group.kind]: nextCurrent } }
  }

  if (action.kind === 'show' || action.kind === 'showall') {
    const hidden = action.kind === 'showall'
      ? state.hidden.filter(item => !item.startsWith(`${group.kind}:`))
      : state.hidden.filter(item => {
        if (!item.startsWith(`${group.kind}:`)) return true
        const found = findOption([...group.options, ...state.custom], action.id)
        return found === undefined || item !== `${group.kind}:${found.id}`
      })
    if (hidden.length === state.hidden.length) return state
    return { ...state, hidden }
  }

  const options = effectiveOptions(group, state)
  const found = findOption(options, action.id)
  if (found === undefined || state.current[group.kind] === found.id) return state
  return { ...state, current: { ...state.current, [group.kind]: found.id } }
}

/** Backward-compatible alias for {@link currentOf}. */
function pick(group, state) {
  return currentOf(group, state)
}

/** Render one environment for prompt text. */
function describeEntry(item) {
  return item.kind === 'path' && (item.path === 'python' || item.path === 'node' || item.path === 'gcc' || item.path === 'java')
    ? `PATH 中的 ${item.path}`
    : item.path
}

/** Invocation form for one executable in PowerShell. */
function invoke(path) {
  return path === 'python' || path === 'node' || path === 'gcc' || path === 'java' ? path : `& "${path}"`
}

/** Usage guidance for one selected group. */
function usageOf(group, item, debuggerItem) {
  if (group.kind === 'python') {
    const conda = item.kind === 'conda' ? `（也可用 \`conda run -n ${item.label} python ...\`）` : ''
    return `- Python：使用 \`${invoke(item.path)} ...\`${conda}，不要调用 PATH 上的其它 python。`
  }
  if (group.kind === 'node') {
    return `- Node.js：使用 \`${invoke(item.path)} ...\`。`
  }
  if (group.kind === 'c' || group.kind === 'cpp') {
    const home = item.home ?? dirname(item.path)
    return `- ${group.label}：编译用 \`${invoke(item.path)} ...\`；编译前把 \`${home}\` 放到 PATH 前面。`
  }
  if (group.kind === 'gdb') {
    return `- 调试器：使用 \`${invoke(item.path)}\`（gdb）。`
  }
  const javac = item.extras?.javac ?? (item.home === undefined ? undefined : join(item.home, 'bin', 'javac.exe'))
  const parts = []
  if (javac !== undefined) parts.push(`\`${invoke(javac)} ...\` 编译`)
  parts.push(`\`${invoke(item.path)} ...\` 运行`)
  const home = item.home ?? dirname(dirname(item.path))
  return `- Java：${parts.join('，')}；JAVA_HOME 设为 \`${home}\`。`
}

/** Build the model-facing guidance for one selection (disabled groups are omitted). */
function renderPrompt(groups, state) {
  const active = groups.filter(group => groupEnabled(state, group.kind))
  const current = active
    .map(group => ({ group, item: pick(group, state) }))
    .filter(pair => pair.item !== undefined)
  const gdbGroup = active.find(group => group.kind === 'gdb')
  const debuggerItem = gdbGroup === undefined ? undefined : pick(gdbGroup, state)
  if (current.length === 0) return ''
  const summary = current
    .map(({ group, item }) => `${group.label} 环境：${item.label}（${describeEntry(item)}）`)
    .join('，')
  return [
    '## 指定运行环境',
    `我指定你在 ${summary}。`,
    '',
    ...current.map(({ group, item }) => usageOf(group, item, debuggerItem)),
    '- 该选择属于当前会话，用户可通过输入框左侧的环境按钮或 `/env <类型> <名称>`（如 `/env java jdk21`、`/env c gcc`、`/env cpp gcc`、`/env gdb gdb`）切换；不要自行更改环境。',
  ].join('\n')
}

/** One-line summary of the current selection, used by the command receipt. */
function summarize(groups, state) {
  return groups
    .flatMap(group => {
      if (!groupEnabled(state, group.kind)) return [`${group.label}：已关闭`]
      const item = pick(group, state)
      const ids = effectiveOptions(group, state).map(option => option.id).join(' / ')
      return [`${group.label}：${item === undefined ? '（无可用环境）' : item.label}（${ids}）`]
    })
    .join('；')
}

/**
 * Register the toolchain catalog, the `/env` command, the `envPicker` session
 * projection, the managed shell facts, and the scoped prompt section.
 * @param ctx - Host plugin context.
 * @param config - plugin row configuration.
 */
export async function apply(ctx, config = {}) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const groups = await buildCatalog(settings)
  const defaults = defaultsOf(groups, settings)
  let handle

  /** Current selection for one session, derived from its committed command log. */
  const selectionOf = (session) => {
    if (session === undefined || session === null || handle === undefined) return defaults
    try {
      return handle.stateOf(session) ?? defaults
    } catch {
      return defaults
    }
  }

  const viewOption = item => ({
    id: item.id,
    label: item.label,
    path: item.path,
    kind: item.kind,
    home: item.home,
    detail: item.detail,
  })

  handle = await ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 2,
    stateSchema: schemaFacade(),
    init: () => ({ ...defaults }),
    apply: (state, event) => {
      if (event.type !== 'command/run') return state
      const data = event.data
      if (data === null || typeof data !== 'object' || data.name !== COMMAND_NAME) return state
      return reduce(groups, defaults, state, parseArgs(data.args))
    },
    wire: {
      viewSchema: schemaFacade(),
      summary: false,
      view: (state) => {
        const view = {
          groups: groups.map(group => {
            const options = effectiveOptions(group, state)
            const current = pick(group, state)
            return {
              kind: group.kind,
              label: group.label,
              enabled: groupEnabled(state, group.kind),
              current: current === undefined ? null : viewOption(current),
              options: options.map(viewOption),
              hiddenCount: state.hidden.filter(item => item.startsWith(`${group.kind}:`)).length,
            }
          }),
        }
        return view
      },
    },
  })

  ctx.commands.register({
    name: COMMAND_NAME,
    description: '查看、切换、增删或开关本会话的 Python / Node / C / C++ / Java / 调试器环境',
    input: { hint: 'python <名称> | add <类型> "<名称>" <路径> | remove <类型> <名称> | enable|disable <类型> | reset' },
    handler: (invocation) => {
      const action = parseArgs(invocation.rawInput)
      if (action === null) {
        return {
          kind: 'error',
          text: '用法：/env <类型> <名称> 切换；/env add <类型> "<名称>" <路径> 新增；/env remove <类型> <名称> 删除/隐藏；/env enable|disable <类型> 开关；/env 查看；/env reset 重置',
        }
      }
      const state = selectionOf(invocation.agent?.session)
      if (action.kind === 'report') return { kind: 'success', text: summarize(groups, state) }
      if (action.kind === 'reset') {
        const restored = { ...defaults, custom: state.custom, enabled: { ...defaults.enabled } }
        return { kind: 'success', text: `已恢复默认：${summarize(groups, restored)}` }
      }
      const group = groups.find(item => item.kind === action.group)
      if (group === undefined) return { kind: 'error', text: `未知类型：${action.group}` }
      if (action.kind === 'enable' || action.kind === 'disable') {
        return { kind: 'success', text: `${group.label} 已${action.kind === 'enable' ? '开启' : '关闭'}` }
      }
      if (action.kind === 'add') {
        const label = String(action.label ?? '').trim()
        const path = String(action.path ?? '').trim()
        if (label.length === 0 || path.length === 0) {
          return { kind: 'error', text: '用法：/env add <类型> "<名称>" <可执行文件路径>' }
        }
        const bare = !path.includes('\\') && !path.includes('/')
        if (!bare && !existsSync(path)) return { kind: 'error', text: `路径不存在：${path}` }
        return { kind: 'success', text: `已添加 ${group.label} 环境：${label}（${path}）` }
      }
      if (action.kind === 'remove') {
        const found = findOption(effectiveOptions(group, state), action.id)
        if (found === undefined) return { kind: 'error', text: `未知 ${group.label} 环境：${action.id}` }
        const custom = state.custom.some(item => item.kind === group.kind && item.id === found.id)
        return { kind: 'success', text: `已${custom ? '删除' : '隐藏'} ${group.label} 环境：${found.label}` }
      }
      if (action.kind === 'show' || action.kind === 'showall') {
        return { kind: 'success', text: `已恢复 ${group.label} 的隐藏环境` }
      }
      const options = effectiveOptions(group, state)
      const found = findOption(options, action.id)
      if (found === undefined) {
        return {
          kind: 'error',
          text: `未知 ${group.label} 环境：${action.id}；可选：${options.map(item => item.id).join(', ')}`,
        }
      }
      return { kind: 'success', text: `已切换 ${group.label} 环境：${found.label}（${found.path}）` }
    },
  })

  ctx.shellEnv.register({
    name: 'env-picker',
    variables: {
      DSH_PYTHON: { description: 'Python executable selected for this session.' },
      DSH_PYTHON_ENV: { description: 'Python environment name selected for this session.' },
      DSH_NODE: { description: 'Node.js executable selected for this session.' },
      DSH_CC: { description: 'C compiler selected for this session.' },
      DSH_CXX: { description: 'C++ compiler selected for this session.' },
      DSH_GDB: { description: 'Debugger selected for this session.' },
      DSH_JAVA: { description: 'Java runtime selected for this session.' },
      DSH_JAVA_HOME: { description: 'JAVA_HOME of the selected JDK.' },
    },
    resolve: (execution) => {
      const session = execution?.agent?.session
      if (session === undefined) return {}
      const state = selectionOf(session)
      const value = (kind) => {
        if (!groupEnabled(state, kind)) return undefined
        const group = groups.find(item => item.kind === kind)
        if (group === undefined) return undefined
        return pick(group, state)
      }
      const python = value('python')
      const node = value('node')
      const c = value('c')
      const cpp = value('cpp')
      const java = value('java')
      const gdb = value('gdb')
      return {
        ...(python === undefined ? {} : { DSH_PYTHON: python.path, DSH_PYTHON_ENV: python.label }),
        ...(node === undefined ? {} : { DSH_NODE: node.path }),
        ...(c === undefined ? {} : { DSH_CC: c.path }),
        ...(cpp === undefined ? {} : { DSH_CXX: cpp.path }),
        ...(gdb === undefined ? {} : { DSH_GDB: gdb.path }),
        ...(java === undefined ? {} : { DSH_JAVA: java.path }),
        ...(java === undefined || java.home === undefined ? {} : { DSH_JAVA_HOME: java.home }),
      }
    },
  })

  // Global fallback: sessions whose agent predates this plugin still get guidance.
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: Number.isFinite(settings.promptOrder) ? settings.promptOrder : SECTION_ORDER,
    text: () => renderPrompt(groups, defaults),
  })

  // Per-agent scoped section shadows the global one with the session's own choice.
  const sections = new Map()
  const order = Number.isFinite(settings.promptOrder) ? settings.promptOrder : SECTION_ORDER
  const disposeSection = (agent) => {
    const dispose = sections.get(agent.id)
    if (dispose === undefined) return
    sections.delete(agent.id)
    try {
      dispose()
    } catch {
      // The agent context may already be disposed; nothing to release then.
    }
  }
  const registerSection = (agent) => {
    const dispose = agent.ctx.systemPrompt.section({
      name: SECTION_NAME,
      order,
      text: () => renderPrompt(groups, selectionOf(agent.session)),
    })
    sections.set(agent.id, dispose)
  }
  ctx.on('agent/created', ({ agent }) => {
    disposeSection(agent)
    registerSection(agent)
  })
  // Agents that predate this plugin (or a hot reload) get the scoped section now,
  // so a later switch takes effect on their next request instead of never.
  for (const agent of ctx.agents.list()) {
    disposeSection(agent)
    registerSection(agent)
  }
  ctx.on('agent/disposed', ({ agent }) => {
    disposeSection(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of sections.values()) {
      try {
        dispose()
      } catch {
        // Disposal after teardown is a no-op.
      }
    }
    sections.clear()
  })
}

/** Test seam: the pure helpers, exported for local verification only. */
export const __internals = { buildCatalog, defaultsOf, parseArgs, reduce, renderPrompt, summarize, toId, findOption }

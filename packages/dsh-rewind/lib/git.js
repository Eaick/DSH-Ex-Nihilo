/**
 * Git-backed turn snapshots: one tree object per top-level turn, written into a
 * session-private object store with the repository attached read-only as an
 * alternate. Restoring a tree rewrites only the paths that differ from the
 * working tree, so files created after the turn are never deleted.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const GIT_ENV = {
  GIT_CONFIG_COUNT: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
}

const STDERR_BYTES = 16 * 1024

/** Build the git runner around the Host subprocess capability. */
export function createGit({ subprocess, timeoutMs = 30_000, outputMaxBytes = 8 * 1024 * 1024 }) {
  let executable
  const resolve = async (signal) => {
    if (executable === undefined) executable = await subprocess.resolveExecutable('git', undefined, signal)
    return executable
  }
  const run = async (cwd, args, options = {}) => {
    const exe = await resolve(options.signal)
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    const handle = subprocess.spawn({
      argv: [exe, ...args],
      cwd,
      stdio: {
        stdin: options.stdin === undefined ? 'ignore' : { data: options.stdin },
        stdout: { maxBytes: options.maxBytes ?? outputMaxBytes },
        stderr: { maxBytes: STDERR_BYTES },
      },
      graceMs: 2_000,
      signal,
      env: { ...GIT_ENV, ...(options.env ?? {}) },
    })
    const outcome = await handle.done
    const stdout = handle.collected?.stdout?.readFrom(0) ?? { text: '', lossy: false }
    const stderr = handle.collected?.stderr?.readFrom(0)?.text ?? ''
    if (signal.aborted) throw new Error(`git ${args.join(' ')} ${timeout.aborted ? 'timed out' : 'was aborted'}`)
    return { exitCode: outcome.exitCode, stdout: stdout.text, stderr, lossy: stdout.lossy }
  }
  return { run, resolve }
}

function ok(result, what) {
  if (result.exitCode !== 0) throw new Error(`${what}: ${result.stderr.trim() || `exit ${result.exitCode}`}`)
  return result
}

/** The repository enclosing one directory, or undefined when it is not in a repository. */
export async function findRepository(git, cwd, signal) {
  const result = await git.run(cwd, ['rev-parse', '--show-toplevel'], { signal })
  if (result.exitCode !== 0) return undefined
  const root = result.stdout.trim()
  return root === '' ? undefined : path.resolve(root)
}

async function commonObjects(git, root, signal) {
  const result = ok(await git.run(root, ['rev-parse', '--git-common-dir'], { signal }), 'git rev-parse --git-common-dir')
  const common = result.stdout.trim()
  return path.join(path.isAbsolute(common) ? common : path.join(root, common), 'objects')
}

/**
 * Write the whole working tree (honouring ignore rules) into `objectsDir` and
 * return the resulting tree id. The repository's own object store is attached
 * read-only, so committed blobs are reused and never copied.
 */
export async function snapshotTree(git, { root, objectsDir, signal }) {
  await mkdir(objectsDir, { recursive: true })
  const indexFile = path.join(objectsDir, `index-${randomUUID()}`)
  const env = {
    GIT_OBJECT_DIRECTORY: objectsDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: await commonObjects(git, root, signal),
    GIT_INDEX_FILE: indexFile,
  }
  try {
    const add = await git.run(root, ['add', '--all', '--ignore-errors'], { signal, env })
    // Exit 1 means some file could not be read; the tree still covers the rest.
    if (add.exitCode !== 0 && add.exitCode !== 1) throw new Error(`git add failed: ${add.stderr.trim()}`)
    const write = ok(await git.run(root, ['write-tree'], { signal, env }), 'git write-tree')
    const tree = write.stdout.trim()
    if (tree === '') throw new Error('git write-tree produced no tree')
    return tree
  } finally {
    await rm(indexFile, { force: true }).catch(() => {})
    await rm(`${indexFile}.lock`, { force: true }).catch(() => {})
  }
}

/** Paths whose working-tree content differs from the tree, relative to the repository root. */
export async function changedPaths(git, { root, tree, signal }) {
  const result = ok(await git.run(root, ['diff', '--name-only', '-z', tree, '--'], { signal }), 'git diff')
  return result.stdout.split('\0').filter((entry) => entry !== '')
}

/**
 * Restore only the listed paths from the tree into the working tree. The index
 * is left untouched, and a path that is not in the tree is never removed.
 */
export async function restorePaths(git, { root, tree, paths, signal }) {
  const chunk = 80
  const restored = []
  for (let index = 0; index < paths.length; index += chunk) {
    const slice = paths.slice(index, index + chunk)
    const result = await git.run(root, ['restore', `--source=${tree}`, '--worktree', '--', ...slice], {
      signal,
      maxBytes: 1024 * 1024,
    })
    if (result.exitCode !== 0) throw new Error(`git restore failed: ${result.stderr.trim()}`)
    restored.push(...slice)
  }
  return restored
}

/** Verify that one tree can still be read in this session's object store. */
export async function treeExists(git, { root, tree, objectsDir, signal }) {
  const env = {
    GIT_OBJECT_DIRECTORY: objectsDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: await commonObjects(git, root, signal),
  }
  const result = await git.run(root, ['cat-file', '-e', tree], { signal, env })
  return result.exitCode === 0
}

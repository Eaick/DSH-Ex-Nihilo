/**
 * dsh-rewind git snapshot tests: a real repository, a node-child_process
 * adapter standing in for the Host subprocess capability.
 *
 * Run from the package directory:
 *   node test/git-tests.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { changedPaths, createGit, findRepository, restorePaths, snapshotTree, treeExists } from '../lib/git.js'

let passed = 0
const failures = []
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`FAIL ${name}\n     ${error?.message ?? error}`)
  }
}

function nodeSubprocess() {
  return {
    async resolveExecutable(command) {
      return command
    },
    spawn(spec) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...(spec.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      const done = new Promise((resolve) => {
        child.on('close', (code) => resolve({ exitCode: code }))
        child.on('error', () => resolve({ exitCode: null }))
      })
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr }) },
        },
      }
    },
  }
}

const git = createGit({ subprocess: nodeSubprocess(), timeoutMs: 20_000 })

function gitSync(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function makeRepo() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-git-'))
  gitSync(dir, ['init', '-q'])
  gitSync(dir, ['config', 'user.email', 'test@example.com'])
  gitSync(dir, ['config', 'user.name', 'test'])
  gitSync(dir, ['config', 'commit.gpgsign', 'false'])
  return dir
}

const signal = AbortSignal.timeout(60_000)

await test('repository: reports the enclosing root and undefined outside a repo', async () => {
  const repo = await makeRepo()
  assert.equal(await findRepository(git, repo, signal), await fsp.realpath(repo))
  const plain = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-plain-'))
  assert.equal(await findRepository(git, plain, signal), undefined)
})

await test('snapshot + restore: bash edits, deletions, untracked files', async () => {
  const repo = await makeRepo()
  const objectsDir = path.join(repo, '..', `${path.basename(repo)}-objects`)
  await fsp.writeFile(path.join(repo, 'a.txt'), 'one')
  await fsp.writeFile(path.join(repo, 'b.txt'), 'keep')
  gitSync(repo, ['add', '.'])
  gitSync(repo, ['commit', '-qm', 'init'])

  const tree = await snapshotTree(git, { root: repo, objectsDir, signal })
  assert.match(tree, /^[0-9a-f]{40,64}$/)

  // "bash" changes: modify, delete, and create a brand-new untracked file.
  await fsp.writeFile(path.join(repo, 'a.txt'), 'two')
  await fsp.rm(path.join(repo, 'b.txt'))
  await fsp.writeFile(path.join(repo, 'c.txt'), 'new')

  assert.deepEqual((await changedPaths(git, { root: repo, tree, signal })).sort(), ['a.txt', 'b.txt'])

  await restorePaths(git, { root: repo, tree, paths: ['a.txt', 'b.txt'], signal })
  assert.equal(await fsp.readFile(path.join(repo, 'a.txt'), 'utf8'), 'one')
  assert.equal(await fsp.readFile(path.join(repo, 'b.txt'), 'utf8'), 'keep')
  assert.equal(await fsp.readFile(path.join(repo, 'c.txt'), 'utf8'), 'new', 'untracked file must survive')

  assert.deepEqual(await changedPaths(git, { root: repo, tree, signal }), [])
})

await test('snapshot: gitignore is honoured and trees stay readable', async () => {
  const repo = await makeRepo()
  const objectsDir = path.join(repo, '..', `${path.basename(repo)}-objects-2`)
  await fsp.writeFile(path.join(repo, '.gitignore'), 'ignored/\n')
  await fsp.writeFile(path.join(repo, 'kept.txt'), 'x')
  await fsp.mkdir(path.join(repo, 'ignored'), { recursive: true })
  await fsp.writeFile(path.join(repo, 'ignored', 'huge.bin'), 'y')
  gitSync(repo, ['add', '.'])
  gitSync(repo, ['commit', '-qm', 'init'])

  const tree = await snapshotTree(git, { root: repo, objectsDir, signal })
  const listing = gitSync(repo, ['ls-tree', '-r', '--name-only', tree]).trim().split('\n')
  assert.ok(listing.includes('kept.txt'))
  assert.ok(!listing.some((entry) => entry.startsWith('ignored/')), 'ignored paths must not be snapped')
  assert.equal(await treeExists(git, { root: repo, tree, objectsDir, signal }), true)
  assert.equal(await treeExists(git, { root: repo, tree: '0'.repeat(40), objectsDir, signal }), false)
})

await test('restore: an unknown tree fails loudly instead of guessing', async () => {
  const repo = await makeRepo()
  await fsp.writeFile(path.join(repo, 'a.txt'), 'one')
  gitSync(repo, ['add', '.'])
  gitSync(repo, ['commit', '-qm', 'init'])
  await assert.rejects(
    restorePaths(git, { root: repo, tree: '0'.repeat(40), paths: ['a.txt'], signal }),
    /git restore failed/,
  )
})

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} failing, ${passed} passing`)
  process.exitCode = 1
} else {
  console.log(`all ${passed} git tests passing`)
}

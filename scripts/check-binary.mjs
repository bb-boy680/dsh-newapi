/**
 * Which file this machine executes is the decision the plugin cannot take back,
 * and the one that has to work without a network: these cases pin the order the
 * local candidates are tried in, the promise that using one leaves the network
 * untouched, and the refusal to execute a file a manifest on disk contradicts.
 *
 * Run from this package with: node scripts/check-binary.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checksumAsset, localBinaryCandidates, resolveGatewayBinary } from '../src/release.js'
import { directRoute } from '../src/net.js'

const VERSION = 'v0.0.0-check'
const DROP_IN = Buffer.from('the binary the operator put in the data directory\n')
const CACHED = Buffer.from('the binary an earlier download left in the cache\n')
const digestOf = (buffer) => createHash('sha256').update(buffer).digest('hex')

let fetches = 0
globalThis.fetch = () => {
  fetches++
  return Promise.reject(new Error('these cases must not need the network'))
}

const root = await mkdtemp(join(tmpdir(), 'dsh-newapi-binary-'))
const dataDir = join(root, 'data')
const cacheDir = join(root, 'cache')
await mkdir(dataDir, { recursive: true })
await mkdir(cacheDir, { recursive: true })
const candidates = localBinaryCandidates({ version: VERSION, dataDir, cacheDir })
const manifestPath = join(cacheDir, checksumAsset(process.platform))
// A manifest names the release asset; verification compares the digest it lists
// with the bytes on disk, so a drop-in under any name is the asset or is not.
const assetName = candidates[2].path.split(/[\\/]/).pop()
// A route pinned direct, like the boot check: the stub above stands in for the
// network, and a route that read this machine's real proxy settings would send
// these requests somewhere the stub cannot see.
const resolve = () =>
  resolveGatewayBinary({
    version: VERSION,
    dataDir,
    cacheDir,
    downloadBaseUrl: 'https://example.invalid',
    route: directRoute(),
  })

let failures = 0
const check = async (label, run) => {
  try {
    await run()
    console.log(`  ${label.padEnd(52)}: ok`)
  } catch (error) {
    failures++
    console.log(`  ${label.padEnd(52)}: FAILED (${error.message})`)
  }
}

await writeFile(candidates[0].path, DROP_IN)
await writeFile(candidates[2].path, CACHED)

await check('the data-directory drop-in wins over the cache', async () => {
  const binary = await resolve()
  assert.equal(binary.path, candidates[0].path)
  assert.equal(binary.source, 'data directory')
  assert.equal(binary.digest, digestOf(DROP_IN))
  assert.equal(binary.verified, false)
  assert.equal(fetches, 0)
})

await check('a cached manifest verifies the drop-in', async () => {
  await writeFile(manifestPath, `${digestOf(DROP_IN)} *${assetName}\n`)
  const binary = await resolve()
  assert.equal(binary.verified, true)
  assert.equal(fetches, 0)
})

await check('the release cache serves when the data directory is empty', async () => {
  await rm(manifestPath, { force: true })
  await rm(candidates[0].path, { force: true })
  const binary = await resolve()
  assert.equal(binary.path, candidates[2].path)
  assert.equal(binary.source, 'release cache')
  assert.equal(binary.digest, digestOf(CACHED))
  assert.equal(binary.verified, false)
  assert.equal(fetches, 0)
})

await check('a contradicted file is skipped instead of executed', async () => {
  await writeFile(manifestPath, `${digestOf(DROP_IN)} *${assetName}\n`)
  await assert.rejects(resolve(), /must not need the network/)
  assert.equal(fetches, 3)
})

await rm(root, { recursive: true, force: true })
console.log(failures === 0 ? 'binary checks passed' : `${failures} binary check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

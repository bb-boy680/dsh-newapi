/**
 * A start that fails has to leave the machine as it found it. This pins the way
 * a broken boot used to survive itself: a gateway that never answered kept
 * running and held its port, so the next attempt started a second one instead of
 * recovering — which is what made a failed first start cost a restart.
 *
 * Run from this package with: node scripts/check-startup.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adoptOrStartGateway } from '../src/gateway.js'

/** A port nothing listens on, so the adopt probe cannot short-circuit the attempt. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.once('listening', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
    probe.listen(0, '127.0.0.1')
  })
}

const dataDir = await mkdtemp(join(tmpdir(), 'dsh-newapi-startup-'))
const preferredPort = await freePort()
let terminated = false
let exited = false

/** A child that never becomes ready, standing in for a gateway that hangs on startup. */
const handle = {
  collected: {
    stdout: { readFrom: () => ({ text: 'starting up', lossy: false }) },
    stderr: { readFrom: () => ({ text: '', lossy: false }) },
  },
  done: new Promise(() => {}),
  terminate: () => {
    terminated = true
  },
  waitForExit: async () => {
    exited = true
    return true
  },
}

const ctx = {
  subprocess: {
    resolveExecutable: async (path) => path,
    spawn: () => handle,
  },
}

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

await check('a gateway that never answers fails the attempt', async () => {
  await assert.rejects(
    adoptOrStartGateway({
      ctx,
      binaryPath: process.execPath,
      dataDir,
      env: {},
      preferredPort,
      readyTimeoutMs: 500,
    }),
    /did not answer/,
  )
})

await check('the failed attempt leaves no gateway running', () => {
  assert.equal(terminated, true, 'the spawned process was not terminated')
  assert.equal(exited, true, 'the attempt did not wait for the process to exit')
})

await rm(dataDir, { recursive: true, force: true })
console.log(failures === 0 ? 'startup checks passed' : `${failures} startup check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

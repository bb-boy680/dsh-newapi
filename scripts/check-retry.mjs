/**
 * The whole of a failed first install, driven through the plugin itself: a boot
 * whose download cannot reach the release host has to leave a record the panel
 * can describe, and the panel's Retry has to run the boot again instead of
 * re-reading the same facts — which used to be the only way out of a failed
 * first start, by toggling the plugin off and on.
 *
 * Run from this package with: node scripts/check-retry.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOOT_ATTEMPTS, BOOT_RETRY_DELAY_MS, apply } from '../index.js'
import { NETWORK_RETRY_DELAY_MS } from '../src/release.js'
import { ROUTES } from '../src/routes.js'

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

/** A port nothing listens on, so the boot cannot adopt a gateway by accident. */
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

/** Collects what a route handler wrote, so a route can be read without a server. */
function responseRecorder() {
  const recorded = { status: undefined, body: undefined }
  return {
    recorded,
    response: {
      writeHead: (status) => {
        recorded.status = status
      },
      end: (text) => {
        recorded.body = JSON.parse(text)
      },
    },
  }
}

/** A request that passes the loopback fence with no Connection service mounted. */
const localRequest = (method) => ({
  method,
  headers: { host: '127.0.0.1:19387' },
  socket: { remoteAddress: '127.0.0.1' },
})

const dataDir = await mkdtemp(join(tmpdir(), 'dsh-newapi-retry-'))
const port = await freePort()

// Shortened so a whole round of attempts — and then a second round — finish
// inside this check. The schedules themselves are what the plugin ships.
BOOT_RETRY_DELAY_MS[0] = 20
BOOT_RETRY_DELAY_MS[1] = 20
NETWORK_RETRY_DELAY_MS[0] = 10
NETWORK_RETRY_DELAY_MS[1] = 10

// The boot under test must fail the same way on every machine. A real machine may
// well have a proxy this plugin would find and use, so the route is pinned direct
// through the bypass list every route honours — otherwise this check would pass or
// fail depending on whose desk it runs on.
process.env.NO_PROXY = '*'
for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete process.env[name]
}

let fetches = 0
/** The blocked network of a machine behind a proxy Node cannot see. */
globalThis.fetch = async (url) => {
  fetches++
  const error = new TypeError('fetch failed')
  error.cause = Object.assign(new Error(`Connect Timeout Error (attempted address: ${String(url)})`), {
    code: 'UND_ERR_CONNECT_TIMEOUT',
  })
  throw error
}

const registered = []
const disposers = []
/** Collect a disposer whether the effect returns one or a promise of one. */
const collect = (result) => {
  if (typeof result === 'function') disposers.push(result)
  else if (typeof result?.then === 'function') {
    void result.then((dispose) => {
      if (typeof dispose === 'function') disposers.push(dispose)
    })
  }
}
const webCtx = {
  effect: (execute) => {
    collect(execute())
  },
  webServer: {
    register: (route) => {
      registered.push(route)
      return () => {}
    },
  },
}
const ctx = {
  get: () => undefined,
  inject: (_names, callback) => callback(webCtx),
  effect: (execute) => {
    collect(execute())
  },
  // Nothing may be spawned: this boot never gets as far as a binary.
  subprocess: {
    resolveExecutable: async (path) => path,
    spawn: () => {
      throw new Error('the gateway was spawned although no binary could be resolved')
    },
  },
}

const routeOf = (path) => {
  const route = registered.find((entry) => entry.path === path)
  if (route === undefined) throw new Error(`no route registered for ${path}`)
  return route
}

/** Read the facts the panel would read. */
async function readFacts() {
  const { recorded, response } = responseRecorder()
  routeOf(ROUTES.status).handler(localRequest('GET'), response)
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  return recorded.body
}

/** Wait for the status payload to satisfy a predicate, or give up. */
async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const facts = await readFacts()
    if (predicate(facts)) return facts
    if (Date.now() > deadline) throw new Error(`timed out waiting; last phase ${facts?.progress?.phase}`)
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
}

apply(ctx, {
  dataDir,
  port,
  version: 'v0.0.0-retry',
  downloadBaseUrl: 'https://example.invalid/download',
  rootPassword: 'check-password-1',
  publishProvider: false,
})

await check('a boot that cannot download reports each attempt', async () => {
  const facts = await waitFor((entry) => entry.progress?.phase === 'failed')
  assert.equal(facts.running, false)
  assert.equal(facts.progress.attempt, BOOT_ATTEMPTS, `the round stopped after ${facts.progress.attempt} attempt(s)`)
  assert.equal(facts.progress.attempts, BOOT_ATTEMPTS)
  assert.equal(facts.progress.hint.kind, 'network', `classified as ${facts.progress.hint.kind}`)
  // Which way the download went travels with the failure, so the panel can state
  // it: here the bypass list sent it direct, and nothing may claim otherwise.
  assert.equal(facts.progress.route.source, 'direct')
  assert.equal(facts.hint.route.source, 'direct')
  assert.match(facts.error, /fetch failed/)
  assert.match(facts.progress.error, /Connect Timeout Error/)
  // What the panel needs to offer a way out of this exact failure.
  assert.ok(facts.hint.releaseUrl.startsWith('https://example.invalid/download/'))
  assert.ok(facts.hint.dropInPath.endsWith(facts.hint.dropInName))
  assert.equal(facts.dataDir, dataDir)
  assert.ok(facts.logPath.endsWith('dsh-newapi.log'))
  assert.ok(fetches >= 1, 'the boot never tried the network at all')
})

await check('a spent boot still offers a retry', async () => {
  const facts = await readFacts()
  assert.equal(facts.canRetry, true)
})

await check('the retry route runs the boot again', async () => {
  const before = await readFacts()
  const { recorded, response } = responseRecorder()
  routeOf(ROUTES.retry).handler(localRequest('POST'), response)
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  assert.equal(recorded.status, 202)
  assert.equal(recorded.body.started, true)

  // A second round is not the first one continuing: the attempt counter starts
  // over and the cause of the previous round is cleared while it runs.
  const restarted = await waitFor((entry) => entry.progress.attempt === 1 && entry.progress.phase !== 'failed')
  assert.equal(restarted.progress.phase, 'preparing', `the retry began in ${restarted.progress.phase}`)
  assert.equal(restarted.progress.error, undefined, 'the retry kept the previous round’s cause')
  // ...and it runs to the end of its own round, which is what makes it a boot
  // rather than a status read.
  const spent = await waitFor((entry) => entry.progress.phase === 'failed')
  assert.notEqual(spent.progress.since, before.progress.since, 'the retry never began a new attempt')
  assert.equal(spent.progress.attempt, BOOT_ATTEMPTS)
})

await check('a retry while one is running is refused, not doubled', async () => {
  const { recorded, response } = responseRecorder()
  routeOf(ROUTES.retry).handler(localRequest('POST'), response)
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  assert.equal(recorded.status, 202)
  const second = responseRecorder()
  routeOf(ROUTES.retry).handler(localRequest('POST'), second.response)
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  assert.equal(second.recorded.status, 409)
  assert.match(second.recorded.body.error, /already in progress/)
  // Let this round finish so the disposer below has nothing in flight.
  await waitFor((entry) => entry.progress.phase === 'failed')
})

await check('unloading the plugin leaves no retry behind', async () => {
  for (const dispose of disposers.reverse()) await dispose()
  const { recorded, response } = responseRecorder()
  routeOf(ROUTES.retry).handler(localRequest('POST'), response)
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  assert.equal(recorded.status, 409)
  assert.match(recorded.body.error, /no bootstrap to retry/)
})

await rm(dataDir, { recursive: true, force: true })
console.log(failures === 0 ? 'retry checks passed' : `${failures} retry check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

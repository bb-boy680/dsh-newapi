/**
 * A boot that downloads for minutes, and one that gives up, are the two states a
 * first install spends its time in — and the two the panel used to be unable to
 * describe. This pins what the Host reports for them: the classified kind of a
 * failure, the byte counts and speed of a download as it streams, and the retry
 * route that runs the boot again instead of re-reading the same facts.
 *
 * Run from this package with: node scripts/check-boot.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  HINT,
  PHASE,
  STEP,
  classifyFailure,
  failureFacts,
  failureHint,
  makeProgress,
  trackDownload,
} from '../src/progress.js'
import { detectLocalProxy, directRoute } from '../src/net.js'
import { releaseAsset, resolveGatewayBinary } from '../src/release.js'
import { makeRoutes, ROUTES } from '../src/routes.js'

const VERSION = 'v0.0.0-boot'
const ASSET = releaseAsset(process.platform, process.arch, VERSION)

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

console.log('--- what a failure is ---')

await check('a blocked download is a network failure', () => {
  assert.equal(
    classifyFailure('fetch failed <- Connect Timeout Error (attempted address: github.com:443) (UND_ERR_CONNECT_TIMEOUT)'),
    HINT.network,
  )
  assert.equal(classifyFailure('fetch failed <- read ECONNRESET (ECONNRESET)'), HINT.network)
})

await check('every other kind keeps its own advice', () => {
  assert.equal(classifyFailure(`${ASSET} failed checksum verification: lists a but serves b`), HINT.checksum)
  assert.equal(classifyFailure('no free port in 9011..9030 for the New API gateway'), HINT.port)
  assert.equal(classifyFailure('New API exited with code 1 signal null'), HINT.gateway)
  assert.equal(classifyFailure('New API did not answer http://127.0.0.1:9011/api/status within 120000ms'), HINT.timeout)
  assert.equal(classifyFailure('something nobody has seen before'), HINT.unknown)
})

await check('the ways out name a path on the Host, not on the browser', () => {
  const facts = failureFacts({
    downloadBaseUrl: 'https://github.com/QuantumNous/new-api/releases/download',
    dataDir: join('C:', 'data'),
    cacheDir: join('C:', 'cache'),
    version: VERSION,
    asset: ASSET,
    route: { url: 'http://127.0.0.1:7890', source: 'windows' },
  })
  assert.equal(facts.dropInPath, join('C:', 'data', facts.dropInName))
  assert.ok(facts.releaseUrl.endsWith(`/${VERSION}/${ASSET}`))
  // The route the download already took travels with the failure, so the panel
  // can state it instead of advising a person to repeat what just failed.
  assert.equal(facts.route.url, 'http://127.0.0.1:7890')
  const hint = failureHint(HINT.network, facts, { port: 3000 })
  assert.equal(hint.kind, HINT.network)
  assert.equal(hint.route.source, 'windows')
})

await check('a proxy failure is classified as a network failure', () => {
  // The messages this plugin's own proxy code raises, which undici never would.
  assert.equal(classifyFailure('http://127.0.0.1:7890 refused CONNECT github.com:443: HTTP 403'), HINT.network)
  assert.equal(classifyFailure('http://127.0.0.1:7890 did not respond to CONNECT github.com:443 within 10000ms (ETIMEDOUT)'), HINT.network)
  assert.equal(classifyFailure('newapi: socks5://127.0.0.1:10808 is not an HTTP proxy address; a SOCKS proxy needs a local HTTP port'), HINT.network)
})

await check('no local proxy is reported on a port nothing answers', async () => {
  // Port 1 is the one port a user process cannot have bound on any platform.
  assert.equal(await detectLocalProxy([1], 200), undefined)
})

console.log('--- what a download reports ---')

await check('the byte count, speed and estimate follow the stream', () => {
  const record = makeProgress(3)
  const url = 'https://example.invalid/new-api.exe'
  const started = Date.now() - 1000
  record.download = {
    url,
    sampledAt: started,
    receivedBytes: 0,
    bytesPerSecond: undefined,
    startedAt: new Date(started).toISOString(),
  }
  trackDownload(record, { url, receivedBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024 })
  assert.equal(record.phase, PHASE.downloading)
  assert.equal(record.step, STEP.download)
  assert.equal(record.download.totalBytes, 4 * 1024 * 1024)
  assert.ok(record.download.bytesPerSecond > 0, 'no speed was derived from the stream')
  assert.ok(record.download.etaSeconds >= 0, 'no estimate was derived from the stream')
})

await check('a retry that restarts a URL is a new stream, not a negative speed', async () => {
  const record = makeProgress(3)
  const url = 'https://example.invalid/new-api.exe'
  trackDownload(record, { url, receivedBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 })
  const firstAttempt = record.download.startedAt
  // Long enough that a fresh start time differs from the one before it.
  await new Promise((resolve) => {
    setTimeout(resolve, 5)
  })
  trackDownload(record, { url, receivedBytes: 1024, totalBytes: 32 * 1024 * 1024 })
  assert.equal(record.download.receivedBytes, 1024)
  assert.notEqual(record.download.startedAt, firstAttempt, 'the restarted stream kept the old start time')
  assert.ok(
    record.download.bytesPerSecond === undefined || record.download.bytesPerSecond >= 0,
    'the restarted stream reported a negative speed',
  )
})

console.log('--- what the release layer reports while it downloads ---')

const root = await mkdtemp(join(tmpdir(), 'dsh-newapi-boot-'))
const payload = Buffer.alloc(3 * 1024 * 1024, 7)
const digest = createHash('sha256').update(payload).digest('hex')
let manifestFetches = 0

/** A response good enough for the two shapes the release layer reads. */
const responseOf = (body, headers) => ({
  ok: true,
  status: 200,
  headers: new Headers(headers),
  body: body === undefined ? undefined : new Response(body).body,
  text: async () => (body === undefined ? '' : body.toString('utf8')),
})

globalThis.fetch = async (url) => {
  if (String(url).endsWith('.txt')) {
    manifestFetches++
    return responseOf(Buffer.from(`${digest} *${ASSET}\n`))
  }
  return responseOf(payload, { 'content-length': String(payload.length) })
}

await check('a download reports increasing bytes against its own total', async () => {
  const events = []
  const cacheDir = join(root, 'cache')
  const binary = await resolveGatewayBinary({
    version: VERSION,
    dataDir: join(root, 'data'),
    cacheDir,
    downloadBaseUrl: 'https://example.invalid/download',
    // A route pinned direct: the check stubs `fetch`, and a route that read this
    // machine's real settings would send the request somewhere else entirely.
    route: directRoute(),
    onProgress: (event) => events.push(event),
  })
  assert.equal(binary.path, join(cacheDir, ASSET))
  const route = events.find((event) => event.step === STEP.route)
  assert.ok(route !== undefined, 'the route the download takes was not reported')
  assert.equal(route.route.source, 'direct')
  assert.equal(route.route.url, undefined)
  const manifest = events.find((event) => event.step === STEP.manifest)
  assert.ok(manifest !== undefined, 'the checksum fetch was not reported')
  const download = events.filter((event) => event.step === STEP.download)
  assert.ok(download.length >= 1, 'the download was not reported at all')
  const final = download[download.length - 1]
  assert.equal(final.receivedBytes, payload.length)
  assert.equal(final.totalBytes, payload.length)
  // The panel names the file it is downloading, so the asset has to travel with
  // the bytes rather than being left to the panel to guess.
  assert.equal(final.asset, ASSET, 'the download was reported without the asset it is fetching')
  assert.equal(final.version, VERSION)
  for (let index = 1; index < download.length; index++) {
    assert.ok(
      download[index].receivedBytes >= download[index - 1].receivedBytes,
      'the reported byte count went backwards without a retry',
    )
  }
})

await check('a cached release reports a hit without touching the network again', async () => {
  const events = []
  const before = manifestFetches
  await resolveGatewayBinary({
    version: VERSION,
    dataDir: join(root, 'data'),
    cacheDir: join(root, 'cache'),
    downloadBaseUrl: 'https://example.invalid/download',
    route: directRoute(),
    onProgress: (event) => events.push(event),
  })
  assert.equal(manifestFetches, before, 'a cached release went back to the network')
  assert.ok(
    events.some((event) => event.step === STEP.verify),
    'the cached binary was not reported as verified',
  )
})

// The record the panel polls is filled in by the fold above; this is what a
// finished download leaves behind for the panel to render.
await check('the progress record carries what the panel renders', () => {
  const record = makeProgress(3)
  trackDownload(record, {
    url: 'https://example.invalid/new-api.exe',
    asset: ASSET,
    version: VERSION,
    cacheDir: 'C:/cache',
    receivedBytes: payload.length,
    totalBytes: payload.length,
  })
  assert.equal(record.download.asset, ASSET)
  assert.equal(record.download.cacheDir, 'C:/cache')
  assert.equal(record.download.receivedBytes, record.download.totalBytes)
})

console.log('--- the retry route ---')

/** A request that passes the loopback fence with no Connection service mounted. */
const localRequest = (method) => ({
  method,
  headers: { host: '127.0.0.1:19387' },
  socket: { remoteAddress: '127.0.0.1' },
})

/** Collects what a handler wrote, so a route can be read without a server. */
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

const routeOf = (routes, path) => routes.find((route) => route.path === path)

/** Drive one handler and let the promise chain it starts settle. */
async function drive(routes, path, request) {
  const { recorded, response } = responseRecorder()
  routeOf(routes, path).handler(request, response)
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  return recorded
}

await check('a retry starts a boot and answers 202', async () => {
  let started = 0
  const routes = makeRoutes(
    { get: () => undefined },
    () => ({ running: false }),
    () => Promise.resolve({ accepted: true }),
    () => Promise.resolve({ provider: {} }),
    () => {
      started++
      return { started: true, attempts: 3 }
    },
  )
  const recorded = await drive(routes, ROUTES.retry, localRequest('POST'))
  assert.equal(recorded.status, 202)
  assert.equal(recorded.body.started, true)
  assert.equal(started, 1)
})

await check('a retry the Host refuses keeps its own reason and status', async () => {
  const routes = makeRoutes(
    { get: () => undefined },
    () => ({ running: true }),
    () => Promise.resolve({}),
    () => Promise.resolve({}),
    () => ({ error: 'the gateway is already running', status: 409 }),
  )
  const recorded = await drive(routes, ROUTES.retry, localRequest('POST'))
  assert.equal(recorded.status, 409)
  assert.equal(recorded.body.error, 'the gateway is already running')
})

await check('reading the retry route is refused', async () => {
  const routes = makeRoutes(
    { get: () => undefined },
    () => ({ running: false }),
    () => Promise.resolve({}),
    () => Promise.resolve({}),
    () => ({ started: true }),
  )
  const recorded = await drive(routes, ROUTES.retry, localRequest('GET'))
  assert.equal(recorded.status, 405)
})

await check('a cross-site retry is refused', async () => {
  let started = 0
  const routes = makeRoutes(
    { get: () => undefined },
    () => ({ running: false }),
    () => Promise.resolve({}),
    () => Promise.resolve({}),
    () => {
      started++
      return { started: true }
    },
  )
  const recorded = await drive(routes, ROUTES.retry, {
    ...localRequest('POST'),
    headers: { host: '127.0.0.1:19387', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(recorded.status, 403)
  assert.equal(started, 0)
})

await rm(root, { recursive: true, force: true })
console.log(failures === 0 ? 'boot checks passed' : `${failures} boot check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

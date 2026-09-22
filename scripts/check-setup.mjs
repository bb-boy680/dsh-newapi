/**
 * First-run checks. Two things are worth pinning here: when the plugin must ask
 * for the port and root password at all, and what the route that accepts them
 * refuses. That route is reachable before any account exists and is what creates
 * the administrator, so a malformed, oversized, repeated, or cross-site request
 * has to be turned away by the Host rather than by the panel.
 *
 * Run from this package with: node scripts/check-setup.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { makeRoutes, ROUTES } from '../src/routes.js'
import { needsFirstRunSetup, parseSetupRequest } from '../src/setup.js'

let failures = 0
const check = async (label, run) => {
  try {
    await run()
    console.log(`  ${label.padEnd(50)}: ok`)
  } catch (error) {
    failures++
    console.log(`  ${label.padEnd(50)}: FAILED (${error.message})`)
  }
}

const silentRow = { port: 3000 }

await check('a fresh install is asked for the settings', () => {
  assert.equal(needsFirstRunSetup(silentRow, {}), true)
})

await check('an answered install is never asked again', () => {
  assert.equal(needsFirstRunSetup(silentRow, { setupCompleted: true }), false)
})

await check('a row that pins the password is not asked', () => {
  assert.equal(needsFirstRunSetup({ ...silentRow, rootPassword: 'row-password-1' }, {}), false)
})

await check('an install provisioned by an earlier version is not asked', () => {
  assert.equal(needsFirstRunSetup(silentRow, { rootPassword: 'stored-password-1' }), false)
  assert.equal(needsFirstRunSetup(silentRow, { token: 'sk-stored' }), false)
})

await check('acceptable settings are taken as written', () => {
  assert.deepEqual(parseSetupRequest({ port: 3080, rootPassword: 'a-password' }), {
    settings: { port: 3080, rootPassword: 'a-password' },
  })
  // Characters, not bytes: the gateway counts what it hashes.
  const unicode = '密码密码密码密码'
  assert.equal(parseSetupRequest({ port: 1, rootPassword: unicode }).settings?.rootPassword, unicode)
})

await check('a submission without a password keeps the current one', () => {
  assert.deepEqual(parseSetupRequest({ port: 3000 }), { settings: { port: 3000 } })
  assert.deepEqual(parseSetupRequest({ port: 3000, rootPassword: undefined }), { settings: { port: 3000 } })
})

await check('a port that is not a port is refused', () => {
  for (const port of [0, -1, 65536, 3000.5, '3000', null, undefined]) {
    assert.notEqual(parseSetupRequest({ port, rootPassword: 'a-password' }).error, undefined, `port ${port}`)
  }
})

await check('a password outside the gateway policy is refused', () => {
  assert.notEqual(parseSetupRequest({ port: 3000, rootPassword: 'short12' }).error, undefined)
  assert.notEqual(parseSetupRequest({ port: 3000, rootPassword: 'x'.repeat(129) }).error, undefined)
  assert.notEqual(parseSetupRequest({ port: 3000, rootPassword: 12345678 }).error, undefined)
  assert.equal(parseSetupRequest({ port: 3000, rootPassword: 'x'.repeat(128) }).error, undefined)
})

await check('a body that is not an object is refused', () => {
  for (const payload of [null, 'password', 42, ['a-password']]) {
    assert.notEqual(parseSetupRequest(payload).error, undefined, `${String(payload)}`)
  }
})

/** One accepted submission, as the Host would hand it to the waiting boot. */
const accepted = []
const routes = makeRoutes(
  // No Connection service in this harness, so the loopback fence decides.
  { get: () => undefined },
  () => ({ running: false, needsSetup: accepted.length === 0 }),
  (settings) => {
    if (accepted.length > 0) return { error: 'the gateway is not running', status: 409 }
    accepted.push(settings)
    return { accepted: true, port: settings.port }
  },
  // Nothing is running yet in this half of the check.
  () => ({ error: 'the gateway is not running', status: 409 }),
)
const server = createServer((request, response) => {
  const route = routes.find((entry) => entry.path === (request.url ?? '/').split('?')[0])
  if (route === undefined) {
    response.writeHead(404)
    response.end()
    return
  }
  void route.handler(request, response)
})
await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', resolve)
})
const origin = `http://127.0.0.1:${server.address().port}`
const post = (body, headers) =>
  fetch(`${origin}${ROUTES.setup}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

await check('the panel reads a first run before it submits one', async () => {
  const status = await (await fetch(`${origin}${ROUTES.status}`)).json()
  assert.equal(status.needsSetup, true)
  assert.equal(status.running, false)
})

const wrongMethod = await fetch(`${origin}${ROUTES.setup}`)
await check('reading the write route is refused', () => {
  assert.equal(wrongMethod.status, 405)
})

const crossSite = await post({ port: 3000, rootPassword: 'a-password' }, { Origin: 'http://evil.example' })
await check('a cross-site submission is refused', () => {
  assert.equal(crossSite.status, 403)
})

const forgedFetch = await post({ port: 3000, rootPassword: 'a-password' }, { 'sec-fetch-site': 'cross-site' })
await check('a cross-site fetch is refused', () => {
  assert.equal(forgedFetch.status, 403)
})

const notJson = await post('not json at all')
await check('a body that is not JSON is refused', () => {
  assert.equal(notJson.status, 400)
})

const badSettings = await post({ port: 70000, rootPassword: 'a-password' })
await check('settings the gateway would reject are refused', async () => {
  assert.equal(badSettings.status, 400)
  assert.match((await badSettings.json()).error, /port/)
})

const oversized = await post(JSON.stringify({ port: 3000, rootPassword: `a${'x'.repeat(9000)}` }))
await check('an oversized body is refused', () => {
  assert.equal(oversized.status, 413)
})

const acceptedResponse = await post({ port: 3080, rootPassword: 'first-run-password' })
await check('valid settings reach the waiting boot', async () => {
  assert.equal(acceptedResponse.status, 202)
  assert.deepEqual(accepted, [{ port: 3080, rootPassword: 'first-run-password' }])
  assert.equal((await acceptedResponse.json()).port, 3080)
})

const repeated = await post({ port: 3081, rootPassword: 'second-password' })
await check('a second submission is refused', () => {
  assert.equal(repeated.status, 409)
})

// The panel's other write: it carries no body at all, because both of its inputs
// — the gateway and the model configuration — live on the Host side.
const notRunning = await fetch(`${origin}${ROUTES.sync}`, { method: 'POST' })
await check('a sync without a running gateway is refused', async () => {
  assert.equal(notRunning.status, 409)
  assert.match((await notRunning.json()).error, /not running/)
})

const readSync = await fetch(`${origin}${ROUTES.sync}`)
await check('reading the sync route is refused', () => {
  assert.equal(readSync.status, 405)
})

const crossSiteSync = await fetch(`${origin}${ROUTES.sync}`, {
  method: 'POST',
  headers: { Origin: 'http://evil.example' },
})
await check('a cross-site sync is refused', () => {
  assert.equal(crossSiteSync.status, 403)
})

await new Promise((resolve) => {
  server.close(resolve)
})

// The other life of this route: an instance already running is re-configured
// through the same form, and a submission without a password keeps the current one.
const reconfigured = []
const runningRoutes = makeRoutes(
  { get: () => undefined },
  () => ({ running: true, needsSetup: false, port: 3000 }),
  (settings) => {
    reconfigured.push(settings)
    return {
      applied: true,
      port: settings.port,
      passwordChanged: settings.rootPassword !== undefined,
      portChanged: settings.port !== 3000,
    }
  },
  () => ({ provider: { enabled: true, route: 'new-api', displayName: 'New API', models: 3 } }),
)
const runningServer = createServer((request, response) => {
  const route = runningRoutes.find((entry) => entry.path === (request.url ?? '/').split('?')[0])
  if (route === undefined) {
    response.writeHead(404)
    response.end()
    return
  }
  void route.handler(request, response)
})
await new Promise((resolve) => {
  runningServer.listen(0, '127.0.0.1', resolve)
})
const runningOrigin = `http://127.0.0.1:${runningServer.address().port}`
const runningPost = (body) =>
  fetch(`${runningOrigin}${ROUTES.setup}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const moved = await runningPost({ port: 3080 })
await check('a running gateway applies a new port', async () => {
  assert.equal(moved.status, 200)
  const body = await moved.json()
  assert.deepEqual(body, { applied: true, port: 3080, passwordChanged: false, portChanged: true })
  assert.deepEqual(reconfigured, [{ port: 3080 }])
})

const kept = await runningPost({ port: 3080, rootPassword: 'a-new-password' })
await check('a running gateway applies a new root password', async () => {
  assert.equal(kept.status, 200)
  assert.equal((await kept.json()).passwordChanged, true)
  assert.deepEqual(reconfigured[1], { port: 3080, rootPassword: 'a-new-password' })
})

const refusedSettings = await runningPost({ port: 3000, rootPassword: 'short' })
await check('a running gateway still refuses bad settings', () => {
  assert.equal(refusedSettings.status, 400)
})

const runningSync = await fetch(`${runningOrigin}${ROUTES.sync}`, { method: 'POST' })
await check('a running gateway advertises its models again', async () => {
  assert.equal(runningSync.status, 200)
  assert.equal((await runningSync.json()).provider.models, 3)
})

await new Promise((resolve) => {
  runningServer.close(resolve)
})
if (failures > 0) {
  console.log(`${failures} setup check(s) FAILED`)
  process.exitCode = 1
} else {
  console.log('setup checks passed')
}

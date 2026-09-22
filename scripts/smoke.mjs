/**
 * End-to-end smoke check for the sidecar path without a running DeepSeek
 * Harness: it supplies the context members `apply` consumes — `effect`,
 * `inject`, `get`, and `subprocess` — over `node:child_process`, records what the
 * plugin publishes to the harness' model configuration, mounts the plugin's
 * browser routes on a real HTTP server, and hands over the first-run settings
 * the way the panel does. From there it boots the real gateway, provisions it,
 * and exercises the console session bridge against a real second account, which
 * is what proves the bridge follows the account someone signs in with instead of
 * imposing one of its own. A second run over the same data directory then proves
 * the settings are asked for once.
 *
 * Run from this package with: node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, resolveConfig } from '../index.js'
import { startConsoleProxy } from '../src/proxy.js'

/** The account the bridge is expected to follow, distinct from the setup root. */
const CONSOLE_ACCOUNT = { username: 'bridge-check', password: 'Bridge-Check-1234' }

/** How long the second run may take before it counts as "asked again". */
const SECOND_RUN_TIMEOUT_MS = 120000

/** `SubprocessHandle` over a plain child process: collected tails, done, terminate, waitForExit. */
function spawnShim(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const tails = { stdout: [], stderr: [] }
  child.stdout.on('data', (chunk) => tails.stdout.push(chunk))
  child.stderr.on('data', (chunk) => tails.stderr.push(chunk))
  const done = new Promise((resolve) => child.on('close', (exitCode, signal) => resolve({ exitCode, signal })))
  const reader = (stream) => ({
    readFrom: () => ({ text: Buffer.concat(tails[stream]).toString('utf8'), nextOffset: 0, lossy: false }),
  })
  return {
    collected: { stdout: reader('stdout'), stderr: reader('stderr') },
    done,
    terminate: () => child.kill(),
    waitForExit: async () => {
      await done
      return true
    },
  }
}

/** A first unused port on the loopback interface, so the panel's choice is unambiguous. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** A plugin context with a web server and both model-configuration seams attached. */
function harness() {
  const routes = []
  // What the harness' own model configuration received: the credential write and
  // the settings patch, recorded rather than applied.
  const published = { credentials: [], settings: [] }
  const services = {
    settings: {
      update: async (ns, patch) => {
        published.settings.push([ns, patch])
      },
    },
    credentials: {
      set: async (ref, value) => {
        published.credentials.push([ref, value])
      },
    },
  }
  const webCtx = {
    effect: (execute) => {
      execute()
      return () => {}
    },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  let effect
  const ctx = {
    effect: (execute) => {
      effect = execute()
      return () => {}
    },
    // No Connection service, so the routes' own loopback fence decides, and the
    // two settings/credentials seams this plugin publishes through.
    get: (name) => services[name],
    inject: (_deps, callback) => callback(webCtx),
    subprocess: {
      spawn: spawnShim,
      resolveExecutable: async (command) => command,
    },
  }
  return { ctx, routes, published, started: () => effect }
}

/** Serve the plugin's routes over real HTTP, so its trust fence sees a real request. */
async function mount(routes) {
  const server = createHttpServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    const route = routes.find((entry) => entry.path === path)
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
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve)
      }),
  }
}

const dataDir = join(tmpdir(), 'dsh-newapi-smoke')
// The first run is the point of this check, so it has to start from nothing.
await rm(dataDir, { recursive: true, force: true })
// Three models, three answers for the same claim: one named on the plugin row,
// one tagged in the gateway's own console, and one nothing describes — which the
// row's `providerDefaultInput` decides. Here it is pinned to text so the two
// positive sources are isolated; the assumed-image default is covered by
// `check-provider.mjs`.
const IMAGE_MODEL = 'gpt-4o-mini'
const TAG_MODEL = 'deepseek-chat'
const MYSTERY_MODEL = 'mystery-model'
const config = resolveConfig({ port: 3078, dataDir, providerImageModels: IMAGE_MODEL, providerDefaultInput: 'text' })
const settings = { port: await freePort(), rootPassword: 'Smoke-First-Run-Password' }

const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${label.padEnd(44)}: ${ok ? 'ok' : 'FAILED'}${detail === undefined ? '' : ` (${detail})`}`)
  if (!ok) failures.push(label)
}
const postJson = (url, body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

console.log('--- first run ---')
const first = harness()
const panel = await mount(first.routes)
apply(first.ctx, config)

const asked = await (await fetch(`${panel.url}/api/dsh-newapi/status`)).json()
check('the panel is asked before anything is started', asked.needsSetup === true && asked.running === false)
check('nothing is running before the answer', !existsSync(join(dataDir, 'connection.json')))
const refused = await postJson(`${panel.url}/api/dsh-newapi/setup`, { port: settings.port, rootPassword: 'short' })
check('settings the gateway would reject are refused', refused.status === 400, `HTTP ${refused.status}`)
const accepted = await postJson(`${panel.url}/api/dsh-newapi/setup`, settings)
check('the panel settings are accepted', accepted.status === 202, `HTTP ${accepted.status}`)

const stop = await first.started()
if (!existsSync(join(dataDir, 'connection.json'))) {
  // The plugin logs why it gave up; a stack trace would only hide those lines.
  console.error('the gateway did not start, so there are no facts to check; the [newapi] lines above say why')
  process.exit(1)
}
const facts = JSON.parse(await readFile(join(dataDir, 'connection.json'), 'utf8'))
const state = JSON.parse(await readFile(join(dataDir, '.dsh-gateway.json'), 'utf8'))

console.log('--- gateway ---')
const models = await fetch(facts.modelsEndpoint, { headers: { Authorization: `Bearer ${facts.token}` } })
console.log(`  baseUrl                         : ${facts.baseUrl}`)
console.log(`  models endpoint                 : ${models.status}`)
console.log(`  Claude Code base                : ${facts.claudeCodeEnv.ANTHROPIC_BASE_URL}`)
check('the port the panel chose is the one in use', facts.port === settings.port, `port=${facts.port}`)
check('the root password is the one the panel chose', state.rootPassword === settings.rootPassword)
check('the install is marked as configured', state.setupCompleted === true)

// The record advertises the address another device would use, not a loopback one,
// and only when that address actually answers.
const localAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry?.family === 'IPv4' && entry.internal === false)
  .map((entry) => entry.address)
if (localAddresses.length > 0) {
  check(
    'the record names an address on this network',
    localAddresses.some((address) => facts.lanBaseUrl === `http://${address}:${facts.port}`),
    facts.lanBaseUrl,
  )
  check('that address serves the gateway', (await fetch(`${facts.lanBaseUrl}/api/status`)).ok, facts.lanConsoleUrl)
} else {
  check('a machine with no network address advertises none', facts.lanBaseUrl === undefined)
}

console.log('--- model configuration ---')
// The gateway's models have to be selectable in the harness' own model selector,
// which means the same two things the web Models page writes by hand: the token
// behind a credential reference, and one provider route in `llm-pi-ai`. A fresh
// gateway has no channel yet, so the first thing to pin is the refusal.
const statusFacts = await (await fetch(`${panel.url}/api/dsh-newapi/status`)).json()
if (facts.models.length !== 0) {
  // The release's own defaults changed; the checks below would no longer mean
  // what they say.
  check('a fresh gateway serves no models until a channel is added', false, `${facts.models.length} models`)
} else {
  check('a gateway with no models reports why it was not registered', /serves no models/.test(statusFacts.provider?.error ?? ''), statusFacts.provider?.error)
}
check('nothing was written while there was nothing to advertise', first.published.credentials.length === 0 && first.published.settings.length === 0)

const emptySync = await postJson(`${panel.url}/api/dsh-newapi/sync`)
const emptySyncBody = await emptySync.json()
check(
  'a sync with nothing to advertise reports why',
  emptySync.status === 409 && /serves no models/.test(emptySyncBody.error ?? ''),
  `HTTP ${emptySync.status}: ${emptySyncBody.error ?? ''}`,
)

console.log('--- console session bridge ---')
/** What the plugin would persist; a restart re-reads it. */
let remembered
const openProxy = () =>
  startConsoleProxy({
    target: facts.baseUrl,
    loadAccount: () => remembered,
    saveAccount: async (account) => {
      remembered = account
    },
    log: (message) => {
      console.log('  [proxy]', message)
    },
  })

let proxy = await openProxy()
console.log(`  proxy                           : ${proxy.url}`)

const page = await fetch(`${proxy.url}/console`)
const pageBody = await page.text()
check('passthrough serves the console', page.ok && /<div[^>]*id="root"/.test(pageBody), `${pageBody.length} bytes`)

const anonymous = await postJson(`${proxy.url}/api/user/auth/refresh`)
check('no remembered account asks for a sign-in', anonymous.status === 401, `HTTP ${anonymous.status}`)

// A second, non-root account: the bridge must follow whatever signs in here.
const adminLogin = await postJson(`${facts.baseUrl}/api/user/login`, {
  username: 'root',
  password: state.rootPassword,
})
const adminToken = (await adminLogin.json())?.data?.access_token
check('the chosen root password signs in', typeof adminToken === 'string')
const created = await postJson(
  `${facts.baseUrl}/api/user/`,
  { ...CONSOLE_ACCOUNT, display_name: 'Bridge Check', role: 1 },
  { Authorization: `Bearer ${adminToken}` },
)
check('created a non-root account', created.ok, `HTTP ${created.status}`)

console.log('--- model configuration after a channel ---')
// Adding a channel is what an operator does in the gateway's own console, which
// this plugin cannot observe; the model configuration has to follow it on
// demand, and the model list it advertises is the one the gateway answers with.
const CHANNEL_MODELS = [TAG_MODEL, IMAGE_MODEL, MYSTERY_MODEL]
const channel = await postJson(
  `${facts.baseUrl}/api/channel/`,
  {
    mode: 'single',
    channel: {
      name: 'smoke',
      type: 1,
      key: 'sk-smoke-upstream',
      base_url: '',
      models: CHANNEL_MODELS.join(','),
      group: 'default',
      model_mapping: '',
      status: 1,
      priority: 0,
      weight: 0,
    },
  },
  { Authorization: `Bearer ${adminToken}` },
)
check('a channel was added in the gateway console', channel.ok, `HTTP ${channel.status}`)

// The other half of the image claim: the tag an operator sets on the model in the
// gateway's own console, which is what makes a model added later need nothing on
// the harness side at all.
const tagged = await postJson(
  `${facts.baseUrl}/api/models/`,
  { model_name: TAG_MODEL, tags: 'Tools,Vision', status: 1, sync_official: 1 },
  { Authorization: `Bearer ${adminToken}` },
)
check('a model was tagged in the gateway console', tagged.ok, `HTTP ${tagged.status}`)

const syncedResponse = await postJson(`${panel.url}/api/dsh-newapi/sync`)
const synced = await syncedResponse.json()
check(
  'the sync registers the models that channel added',
  syncedResponse.status === 200 && synced.provider?.models === CHANNEL_MODELS.length,
  `HTTP ${syncedResponse.status} models=${synced.provider?.models}`,
)
const [ns, patch] = first.published.settings.at(-1) ?? []
const written = patch?.providers?.['new-api']
check('the token is stored behind its credential reference', first.published.credentials[0]?.[0] === 'NEW_API_KEY' && first.published.credentials[0]?.[1] === facts.token)
check('the route lands in the settings section the Models page writes', ns === 'llm-pi-ai')
check('the route points at the gateway’s OpenAI-compatible root', written?.baseURL === `${facts.baseUrl}/v1`, written?.baseURL)
check('the route names the protocol a hand-declared route needs', written?.api === 'openai-completions')
check(
  'the route lists exactly the models this token reaches',
  JSON.stringify(written?.models?.map((model) => model.id)) === JSON.stringify(CHANNEL_MODELS),
  `${written?.models?.length ?? 0} of ${CHANNEL_MODELS.length}`,
)
check('no key reached the settings document', JSON.stringify(patch).includes(facts.token) === false)
/** The input types the route declares for one model. */
const declaredInput = (id) => written?.models?.find((model) => model.id === id)?.input
check(
  'the model the plugin row names accepts images alongside text',
  JSON.stringify(declaredInput(IMAGE_MODEL)) === JSON.stringify(['text', 'image']),
  JSON.stringify(declaredInput(IMAGE_MODEL)),
)
check(
  'the model the gateway tags accepts images, with no harness-side configuration',
  JSON.stringify(declaredInput(TAG_MODEL)) === JSON.stringify(['text', 'image']),
  JSON.stringify(declaredInput(TAG_MODEL)),
)
check(
  'a model nothing describes takes the row’s default input instead',
  declaredInput(MYSTERY_MODEL) === undefined,
  JSON.stringify(declaredInput(MYSTERY_MODEL)),
)
// No catalog answered in this composition (`ctx.get('llm')` has no service), so
// every model keeps the route's capacity guess rather than one of its own: a
// per-model number nothing stated would be the invention this path exists to
// avoid.
check(
  'the route carries the capacity guess, and no model overrides it',
  written?.defaultContextWindow === 131072
    && written?.defaultMaxTokens === 32768
    && written?.models?.every((model) => !('contextWindow' in model) && !('maxTokens' in model)),
  `${written?.defaultContextWindow}/${written?.defaultMaxTokens}`,
)
check(
  'the panel reports which models were declared image-capable',
  JSON.stringify(synced.provider?.imageModels?.slice().sort()) === JSON.stringify([IMAGE_MODEL, TAG_MODEL].sort()),
  JSON.stringify(synced.provider?.imageModels),
)
// The composer's effort selector lists exactly what the route declares, and only
// spellings New API's own request parser accepts as `reasoning_effort` survive
// the trip upstream.
check(
  'the route offers the configured thinking levels',
  JSON.stringify(written?.models?.[0]?.reasoningEfforts)
    === JSON.stringify({ off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }),
  JSON.stringify(written?.models?.[0]?.reasoningEfforts),
)
check(
  'the route rests at off and names the openai dispatch format',
  written?.reasoning === 'off'
    && written?.compat?.thinkingFormat === 'openai'
    && written?.compat?.supportsReasoningEffort === true,
  `${written?.reasoning} ${JSON.stringify(written?.compat)}`,
)
// pi-ai would otherwise send the system prompt as `developer` — an OpenAI-hosted
// assumption a gateway relaying to arbitrary upstreams cannot make: the upstream
// answers 422 `unknown variant 'developer'` and every turn on the route fails.
check(
  'the route sends the system prompt as system, not developer',
  written?.compat?.supportsDeveloperRole === false,
  JSON.stringify(written?.compat),
)
const configuredFacts = await (await fetch(`${panel.url}/api/dsh-newapi/status`)).json()
check(
  'the panel reports the registered provider',
  configuredFacts.provider?.route === 'new-api' && configuredFacts.provider?.models === CHANNEL_MODELS.length,
  JSON.stringify(configuredFacts.provider),
)
check('the gateway record carries the new model list too', configuredFacts.models?.length === CHANNEL_MODELS.length)

const login = await postJson(`${proxy.url}/api/user/login`, CONSOLE_ACCOUNT)
const loginBody = await login.json()
check('sign-in through the proxy succeeds', login.ok && loginBody?.success === true)
check('proxy remembered that account', remembered?.username === CONSOLE_ACCOUNT.username)
check('remembered password is the one typed', remembered?.password === CONSOLE_ACCOUNT.password)

const refreshed = await postJson(`${proxy.url}/api/user/auth/refresh`)
const refreshedBody = await refreshed.json()
const identity = refreshedBody?.data?.user?.username
check('bridge session is the signed-in account', identity === CONSOLE_ACCOUNT.username, `user=${identity}`)
check('bridge session is not root', identity !== 'root')

const self = await fetch(`${facts.baseUrl}/api/user/self`, {
  headers: { Authorization: `Bearer ${refreshedBody?.data?.access_token}` },
})
check('bridged token authenticates', self.ok && (await self.json())?.success === true)
check(
  'hint cookie relaxed for the frame',
  /SameSite=None/i.test(refreshed.headers.getSetCookie?.().find((v) => v.startsWith('new_api_has_session=')) ?? ''),
)

await proxy.close()
proxy = await openProxy()
const restoredBody = await (await postJson(`${proxy.url}/api/user/auth/refresh`)).json()
check(
  'restart signs in as the remembered account',
  restoredBody?.data?.user?.username === CONSOLE_ACCOUNT.username,
  `user=${restoredBody?.data?.user?.username}`,
)

const logout = await postJson(`${proxy.url}/api/user/auth/logout`)
await new Promise((resolve) => {
  setTimeout(resolve, 100)
})
const afterLogout = await postJson(`${proxy.url}/api/user/auth/refresh`)
check('signing out forgets the account', logout.ok && afterLogout.status === 401 && remembered === undefined)

await proxy.close()

console.log('--- re-configuration ---')
// What the 配置 button submits against an instance that is already running: a new
// port means the child is replaced, a new root password goes through the gateway.
const movedPort = await freePort()
const changedPassword = 'Smoke-Changed-Password'
const appliedResponse = await postJson(`${panel.url}/api/dsh-newapi/setup`, {
  port: movedPort,
  rootPassword: changedPassword,
})
const applied = await appliedResponse.json()
check(
  'the settings form applies a new port and password',
  appliedResponse.status === 200 && applied.applied === true && applied.port === movedPort,
  `HTTP ${appliedResponse.status} port=${applied.port}`,
)
check('both changes are reported', applied.passwordChanged === true && applied.portChanged === true)
const movedFacts = JSON.parse(await readFile(join(dataDir, 'connection.json'), 'utf8'))
const movedState = JSON.parse(await readFile(join(dataDir, '.dsh-gateway.json'), 'utf8'))
check('the gateway runs on the new port', movedFacts.port === movedPort, `port=${movedFacts.port}`)
check('the stored root password is the new one', movedState.rootPassword === changedPassword)
const oldLogin = await postJson(`${movedFacts.baseUrl}/api/user/login`, { username: 'root', password: settings.rootPassword })
check('the previous root password no longer signs in', (await oldLogin.json())?.success === false)
const newLogin = await postJson(`${movedFacts.baseUrl}/api/user/login`, { username: 'root', password: changedPassword })
check('the new root password signs in', (await newLogin.json())?.success === true)
const movedStatus = await (await fetch(`${panel.url}/api/dsh-newapi/status`)).json()
check(
  'the panel reports the gateway on the new port',
  movedStatus.running === true && movedStatus.port === movedPort,
  `port=${movedStatus.port}`,
)
// The port the gateway moved off must serve nothing: the child was replaced.
const staleServes = await postJson(`${facts.baseUrl}/api/user/login`, { username: 'root', password: changedPassword })
  .then(async (response) => (await response.json().catch(() => undefined))?.success === true)
  .catch(() => false)
check('the old port serves nothing', staleServes === false)
// The restart is a fresh boot, so the route is registered again — on the address
// the gateway is actually serving now, which is the whole point of re-publishing.
const afterMove = first.published.settings.at(-1)?.[1]?.providers?.['new-api']
check(
  'a restart re-registers the route on the new port',
  afterMove?.baseURL === `${movedFacts.baseUrl}/v1`,
  afterMove?.baseURL,
)
check(
  'a restart keeps the image claim on the model the row names',
  JSON.stringify(afterMove?.models?.find((model) => model.id === IMAGE_MODEL)?.input) === JSON.stringify(['text', 'image']),
  JSON.stringify(afterMove?.models?.find((model) => model.id === IMAGE_MODEL)?.input),
)
check(
  'a restart re-reads the gateway tag that declares the other model',
  JSON.stringify(afterMove?.models?.find((model) => model.id === TAG_MODEL)?.input) === JSON.stringify(['text', 'image']),
  JSON.stringify(afterMove?.models?.find((model) => model.id === TAG_MODEL)?.input),
)

await stop()

console.log('--- second run ---')
const second = harness()
const secondPanel = await mount(second.routes)
apply(second.ctx, config)
// Nothing submits the form this time: a configured install must start on its own.
const secondStop = await Promise.race([
  second.started(),
  new Promise((resolve) => {
    setTimeout(() => {
      resolve(undefined)
    }, SECOND_RUN_TIMEOUT_MS)
  }),
])
check('a configured install starts without being asked', typeof secondStop === 'function')
if (typeof secondStop === 'function') {
  // Read the panel while the gateway is still this plugin's to report on: its
  // disposer is what hands the harness back an idle plugin.
  const after = await (await fetch(`${secondPanel.url}/api/dsh-newapi/status`)).json()
  check('the panel stops asking for settings', after.needsSetup === false)
  check(
    'a configured install hands its models over on every start',
    second.published.settings.length === 1 && after.provider?.models === CHANNEL_MODELS.length,
    `${second.published.settings.length} writes, provider=${JSON.stringify(after.provider)}`,
  )
  await secondStop()
}

await secondPanel.close()
await panel.close()
console.log('--- teardown ---')
console.log('  stopped                         : ok')
if (failures.length > 0) {
  console.error(`failed checks: ${failures.join(', ')}`)
  process.exitCode = 1
}

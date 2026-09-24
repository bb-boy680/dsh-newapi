/**
 * dsh-newapi — runs a local New API gateway as a managed DeepSeek Harness
 * sidecar, provisions it on first start, exposes the connection facts to the
 * browser panel, and writes what DeepSeek Harness and Claude Code use to reach it.
 * @module dsh-newapi
 */
import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { resolveDataDir, resolveDshHome, releaseCacheDir } from './src/paths.js'
import { releaseAsset, resolveGatewayBinary, resolveReleaseVersion } from './src/release.js'
import { adoptOrStartGateway, probeGateway } from './src/gateway.js'
import { createRoute, routeFacts, ROUTE_SOURCE } from './src/net.js'
import {
  HINT,
  PHASE,
  STEP,
  beginAttempt,
  classifyFailure,
  failureFacts,
  failureHint,
  makeProgress,
  trackDownload,
} from './src/progress.js'
import { changeGatewayRootPassword, provisionGateway, verifyGatewayToken } from './src/provision.js'
import { makeRoutes } from './src/routes.js'
import { needsFirstRunSetup } from './src/setup.js'
import { startConsoleProxy } from './src/proxy.js'
import { publishGatewayProvider, parseReasoningEfforts, parseImageModels, parseModelAliases, parseDefaultInput } from './src/llmprovider.js'
import { readCatalogModels, readTaggedModels, resolveAliasedCapacities, resolveCapacities, resolveImageModels, resolveModelAliases } from './src/modalities.js'

export const name = 'newapi'
export const inject = ['subprocess']

/**
 * Every option a plugin row may set, with the default it takes when the row is
 * silent. This plugin ships no runtime dependencies on purpose — the fields are
 * read and checked here rather than through a schema package, so installing it
 * never requires a package manager to resolve anything.
 */
const FIELDS = {
  enabled: { kind: 'boolean', fallback: true },
  version: { kind: 'string', fallback: 'v1.0.0-rc.39' },
  binaryPath: { kind: 'string' },
  port: { kind: 'number', fallback: 3000 },
  dataDir: { kind: 'string' },
  dshHome: { kind: 'string' },
  downloadBaseUrl: { kind: 'string', fallback: 'https://github.com/QuantumNous/new-api/releases/download' },
  rootUsername: { kind: 'string', fallback: 'root' },
  rootPassword: { kind: 'string' },
  tokenName: { kind: 'string', fallback: 'dsh' },
  readyTimeoutMs: { kind: 'number', fallback: 120000 },
  publishProvider: { kind: 'boolean', fallback: true },
  providerName: { kind: 'string', fallback: 'new-api' },
  providerDisplayName: { kind: 'string', fallback: 'New API' },
  providerApiKeyRef: { kind: 'string', fallback: 'NEW_API_KEY' },
  providerContextWindow: { kind: 'number', fallback: 131072 },
  providerMaxTokens: { kind: 'number', fallback: 32768 },
  providerReasoningEfforts: { kind: 'string', fallback: 'off,low,medium,high,xhigh,max' },
  providerImageModels: { kind: 'string', fallback: '' },
  providerModelAliases: { kind: 'string', fallback: '' },
  providerDefaultInput: { kind: 'string', fallback: 'text,image' },
}

/**
 * Apply the defaults and refuse a row this plugin cannot act on. A misspelled or
 * mistyped key is an operator mistake, so it stops the plugin instead of being
 * quietly ignored; the alternative is a gateway that starts with settings
 * nobody asked for.
 * @param raw - the row's `config`, or nothing when the row declares none.
 * @returns the effective configuration.
 * @throws {Error} for an unknown key or a value of the wrong type.
 */
export function resolveConfig(raw) {
  const supplied = raw ?? {}
  const unknown = Object.keys(supplied).filter(key => !(key in FIELDS))
  if (unknown.length > 0) {
    throw new Error(`newapi: unknown config key(s) ${unknown.join(', ')}; expected any of ${Object.keys(FIELDS).join(', ')}`)
  }
  const config = {}
  for (const [key, field] of Object.entries(FIELDS)) {
    const value = supplied[key] ?? field.fallback
    if (value === undefined) continue
    if (typeof value !== field.kind) {
      throw new Error(`newapi: config.${key} must be a ${field.kind}, got ${typeof value}`)
    }
    config[key] = value
  }
  // The one field whose value is a list: a level nobody offers is a typo, and it
  // is cheaper to hear about it here than from a settings write that was refused.
  parseReasoningEfforts(config.providerReasoningEfforts)
  // The other list-valued fields: a name holding whitespace is a typo whatever
  // the gateway serves, usually commas typed as spaces, and an input type pi-ai
  // does not have is cheaper to refuse here than from a settings write.
  const claim = parseImageModels(config.providerImageModels)
  const spacedNames = [...claim.include, ...claim.exclude].filter((name) => /\s/.test(name))
  if (spacedNames.length > 0) {
    throw new Error(
      `newapi: config.providerImageModels names ${spacedNames.join(', ')}, which contain whitespace;`
      + ' separate model ids with commas',
    )
  }
  parseDefaultInput(config.providerDefaultInput)
  // The aliases: an entry that is not a `served=catalog` pair, or one that aliases
  // an id to itself, is a typo that would otherwise leave the model exactly as
  // undescribed as before. A whitespace inside either id is the same mistake the
  // image list refuses — commas and `=` typed as spaces.
  const aliases = parseModelAliases(config.providerModelAliases)
  const spacedAliases = [...aliases].flat().filter((name) => /\s/.test(name))
  if (spacedAliases.length > 0) {
    throw new Error(
      `newapi: config.providerModelAliases names ${spacedAliases.join(', ')}, which contain whitespace;`
      + ' separate pairs with commas and the two ids with "="',
    )
  }
  return config
}

const STATE_FILE = '.dsh-gateway.json'

/**
 * What the browser half expects from this Host half; mirrored in
 * `src/client/index.jsx`. The panel is served from a bundle the page reloads on
 * its own, while this module generation only changes with the plugin, so the two
 * can be a version apart — and the panel says so rather than reporting a refusal
 * whose cause it cannot see.
 *
 * 4 adds `progress`, `hint` and the retry route: a boot that is downloading, or
 * one that gave up, is now something the panel can describe and re-run instead of
 * an unexplained "not running".
 *
 * 5 adds `progress.route`: the panel says which way out the download took — the
 * proxy in the machine's own settings, or a direct connection — because after a
 * failure that is the first thing worth knowing.
 */
const PANEL_API = 5

/**
 * Bootstrap attempts and the pause before each retry. A first install downloads
 * the release and a cold gateway migrates on its first start, so a single
 * failure must not cost the session — least of all a restart of the harness.
 *
 * Exported because the schedule is part of what this plugin promises: a check
 * shortens it to watch a whole round of attempts finish.
 */
export const BOOT_ATTEMPTS = 3
export const BOOT_RETRY_DELAY_MS = [5_000, 15_000]

/**
 * Where the plugin's own lines are also written, once the data directory is
 * known. The host's console is not always in reach — a desktop shell may keep it
 * to itself — and a start that fails has to stay diagnosable after the fact.
 */
let logFile

function log(message) {
  const line = `[newapi] ${message}`
  console.log(line)
  if (logFile !== undefined) {
    // Synchronously, so the file keeps the order the lines were emitted in and a
    // failing start leaves a complete account behind; a few bytes per line is not
    // worth the bookkeeping an async writer would need.
    try {
      appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // An unwritable log file must not take the gateway down with it.
    }
  }
}

/** The full cause chain, because undici reports network failures as a bare `fetch failed`. */
function describeError(error) {
  const parts = []
  for (let current = error; current !== undefined; current = current?.cause) {
    if (current instanceof Error) parts.push(`${current.message}${current.code ? ` (${current.code})` : ''}`)
    else parts.push(String(current))
  }
  return parts.join(' <- ')
}

/**
 * Fold one report from the release layer into the record the panel polls. The
 * layer knows the bytes and the URL; this side knows which version and cache
 * directory they belong to, so the panel is told one merged story rather than
 * having to correlate two.
 * @param progress - the record to mutate.
 * @param event - a step event from `src/release.js`.
 * @param context - `{ version, cacheDir }` for this row.
 */
function reportBinaryStep(progress, event, context) {
  if (event.step === STEP.download) {
    trackDownload(progress, { ...context, ...event })
    return
  }
  progress.step = event.step
  if (event.step === STEP.route) {
    // The route outlives the step: a failure reported later has to name the way
    // it already went, or the panel can only guess at one.
    progress.route = event.route
  }
  // A step after the stream — the checksum comparison, a second candidate — is
  // no longer downloading, and the panel must stop counting bytes up.
  if (progress.phase === PHASE.downloading) progress.phase = PHASE.preparing
}

/** Provisioning facts this harness keeps between runs; the file is created with owner-only permissions. */
async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return {}
  }
}

/** Environment the gateway child starts from; explicit entries survive the subprocess credential scrub. */
function gatewayEnvironment(dataDir, sessionSecret) {
  return {
    SQLITE_PATH: join(dataDir, 'one-api.db'),
    SESSION_SECRET: sessionSecret,
    GIN_MODE: 'release',
    TRUSTED_PROXIES: 'none',
  }
}

/**
 * The address this machine answers at on its local network, or `undefined` when
 * it has only a loopback interface. new-api binds every interface, so the
 * console is reachable there too — and an address another device can open is
 * more useful to show than one only this machine can.
 * @returns one IPv4 address, private ranges first.
 */
function lanAddress() {
  const addresses = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  // A VPN or container adapter is usually not the one a phone on the same Wi-Fi
  // can reach, so the private LAN ranges win when both are present.
  const privateRange = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  return addresses.find((address) => privateRange.test(address)) ?? addresses[0]
}

/** Everything a client needs to use the gateway, in one machine-readable record. */
function connectionFacts(port, baseUrl, token, models, lanUrl) {
  return {
    port,
    baseUrl,
    lanBaseUrl: lanUrl,
    lanConsoleUrl: lanUrl === undefined ? undefined : `${lanUrl}/`,
    token,
    openaiBaseUrl: `${baseUrl}/v1`,
    anthropicBaseUrl: baseUrl,
    modelsEndpoint: `${baseUrl}/v1/models`,
    consoleUrl: `${baseUrl}/`,
    claudeCodeEnv: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: token,
    },
    models,
  }
}

/**
 * Hand the running gateway to DeepSeek Harness' own model configuration, so its
 * models are selectable in the composer instead of reachable only by clients
 * that were configured by hand.
 *
 * Both seams are optional in a composition and are read through `ctx.get`, so a
 * missing or refusing one is reported rather than fatal: the panel shows what
 * happened, and the gateway keeps serving whatever else was asked of it.
 * @param ctx - host plugin context.
 * @param config - effective plugin configuration.
 * @param facts - the gateway facts, whose model list is what gets advertised.
 * @returns what the panel should report about the model configuration.
 */
async function publishProvider(ctx, config, facts) {
  if (!config.publishProvider) {
    log('model configuration: publishing is off (publishProvider is false)')
    return { enabled: false }
  }
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined || credentials === undefined) {
    const error = 'this harness mounts no settings/credentials service, so the gateway cannot be added to its model configuration'
    log(`model configuration: ${error}`)
    return { enabled: true, displayName: config.providerDisplayName, error }
  }
  try {
    // The two sources that can answer on their own follow the gateway's own model
    // list, so a model added in the New API console (and tagged there, when it
    // reads images) needs nothing on this side.
    //
    // An alias target joins the read even though the gateway does not serve it: a
    // model reached under a relay's own id is described by the catalogs under
    // theirs, and an id nobody serves is never read otherwise.
    const aliases = resolveModelAliases(parseModelAliases(config.providerModelAliases))
    const tagged = await readTaggedModels(facts.baseUrl, facts.models)
    const catalog = await readCatalogModels(
      ctx.get('llm'),
      [...new Set([...facts.models, ...aliases.values()])],
      config.providerName,
    )
    const stated = resolveCapacities(catalog.models, facts.models)
    const capacities = resolveAliasedCapacities(stated, catalog.models, aliases, facts.models)
    const images = resolveImageModels({
      models: facts.models,
      claim: parseImageModels(config.providerImageModels),
      tagged: tagged.models,
      catalog: catalog.models,
      fallback: parseDefaultInput(config.providerDefaultInput),
    })
    for (const [source, answer] of [['the gateway\'s model tags', tagged], ['the harness\' model catalogs', catalog]]) {
      if (answer.unavailable !== undefined) log(`image input: ${source} answered nothing: ${answer.unavailable}`)
    }
    const published = await publishGatewayProvider({
      settings,
      credentials,
      route: config.providerName,
      apiKeyRef: config.providerApiKeyRef,
      displayName: config.providerDisplayName,
      baseUrl: facts.baseUrl,
      token: facts.token,
      models: facts.models,
      contextWindow: config.providerContextWindow,
      maxTokens: config.providerMaxTokens,
      efforts: parseReasoningEfforts(config.providerReasoningEfforts),
      imageModels: images.declared,
      capacities: capacities.capacities,
    })
    log(
      `model configuration: ${published.models} models are selectable as provider "${published.route}" `
      + `(${published.displayName}), key stored as ${published.apiKeyRef}, `
      + `thinking levels ${published.efforts.length === 0 ? 'none' : published.efforts.join('/')}`,
    )
    log(
      'image input: '
      + (images.declared.length === 0
        ? 'no model declares it'
        : images.declared.map((id) => `${id} (${images.sources.get(id)})`).join(', '))
      + `${images.textOnly.length === 0 ? '' : `; text only: ${images.textOnly.join(', ')}`}`,
    )
    if (images.undescribed.length > 0) {
      // Named so the assumption is visible: these are the models nothing here can
      // describe, and the row can withhold any of them.
      log(`image input: nothing describes ${images.undescribed.join(', ')};`
        + ` they take providerDefaultInput (${config.providerDefaultInput}), and a leading ! withholds one`)
    }
    if (images.unmatched.length > 0) {
      // Not fatal: the gateway's model list is its own answer and it changes as
      // channels are added, so refusing to publish over a stale name would cost
      // the whole route. Naming it is what makes the typo findable.
      log(
        `image input: providerImageModels names ${images.unmatched.join(', ')},`
        + ' which this gateway does not serve; those names were ignored',
      )
    }
    // Which models carry a stated capacity and which fall back is the difference
    // between a number a catalog knows and the route's one guess, and it is the
    // only place that distinction is visible: the settings document shows both
    // spellings the same way. An alias and a number the route already carried are
    // the other two cases, and each is reported as what it is rather than as a
    // catalog fact about the id.
    const spelled = ({ id, contextWindow, maxTokens }) => `${id} ${contextWindow ?? '?'} in/${maxTokens ?? '?'} out`
    log(
      'capacities: '
      + (stated.size === 0 ? 'no catalog states one' : [...stated].map(([id, known]) => spelled({ id, ...known })).join(', ')),
    )
    if (capacities.aliased.length > 0) {
      log(
        'capacities: '
        + capacities.aliased.map(({ id, as, contextWindow, maxTokens }) =>
          `${spelled({ id, contextWindow, maxTokens })} are what the catalogs state for ${as}`).join(', '),
      )
    }
    if (published.carriedCapacities.length > 0) {
      log(
        'capacities: '
        + published.carriedCapacities.map(spelled).join(', ')
        + ' are kept from this route\'s own profile; no catalog restates those models',
      )
    }
    const carried = new Set(published.carriedCapacities.map(({ id }) => id))
    const guessed = facts.models.filter((id) => !capacities.capacities.has(id) && !carried.has(id))
    if (guessed.length > 0) {
      // Named so the guess is visible: nothing on this side knows a number for
      // these, so the row's own fields (set once in 「设置 → 模型」, and carried
      // over from then on) or the route's defaults are the only answers there are.
      log(
        `capacities: nothing states one for ${guessed.join(', ')};`
        + ` they take providerContextWindow/providerMaxTokens (${config.providerContextWindow} in/${config.providerMaxTokens} out)`,
      )
    }
    return {
      enabled: true,
      ...published,
      undescribedImageModels: [...images.undescribed],
      guessedCapacityModels: guessed,
    }
  } catch (error) {
    // Enumerated rather than swallowed: a shadowed reference, a namespace no
    // plugin registered, and a refusal from the adapter are all actionable, and
    // the panel is where the person who can act on them is looking.
    const message = describeError(error)
    log(`model configuration: the gateway was not added: ${message}`)
    return { enabled: true, displayName: config.providerDisplayName, error: message }
  }
}

/**
 * Make the gateway available, provisioning it when it has never been provisioned.
 * @param ctx - host plugin context.
 * @param config - effective plugin configuration.
 * @param state - the mutable facts this plugin publishes.
 * @param settings - settings the panel collected, or `undefined` when nobody had to be asked.
 * @returns everything needed to serve from this gateway, record a later change, or stop it.
 */
async function boot(ctx, config, state, settings) {
  const home = resolveDshHome(config.dshHome)
  const dataDir = resolveDataDir(home, config.dataDir)
  await mkdir(dataDir, { recursive: true })
  logFile = join(dataDir, 'dsh-newapi.log')
  const statePath = join(dataDir, STATE_FILE)
  const stored = await loadState(statePath)
  state.dataDir = dataDir
  state.logPath = logFile

  // A pinned tag downloads straight away; `latest` asks the release host first,
  // and only when this run actually needs the download.
  //
  // One route per attempt, resolved lazily and read from the machine rather than
  // remembered: the person who has just started their proxy client and chosen
  // Retry is the whole reason this is per attempt.
  const route = createRoute({
    onFound: (found) => {
      const facts = routeFacts(found)
      // What the panel reads, from the one place that knows a route changed:
      // a proxy resolved from the settings, a port a probe found, or a host the
      // bypass list sends direct.
      state.progress.route = facts
      if (facts.url !== undefined) {
        log(`network route for the release host: ${facts.url} (from the ${facts.source})`)
      } else if (facts.source === ROUTE_SOURCE.socks) {
        log(`this machine names a SOCKS proxy at ${facts.address}, which this plugin cannot download through`)
      } else if (found.bypassed === true) {
        log('the release host is in this machine proxy bypass list (NO_PROXY or ProxyOverride), so the download goes direct')
      } else {
        log('the release download will go direct; no HTTP proxy is configured for this machine')
      }
    },
  })
  const version = config.binaryPath === undefined
    ? await resolveReleaseVersion(config.version, config.downloadBaseUrl, {
        route,
        onProgress: (event) => reportBinaryStep(state.progress, event, {}),
      })
    : config.version
  state.version = version
  log(`gateway release ${version}`)

  const sessionSecret = stored.sessionSecret ?? randomBytes(32).toString('base64url')
  // Merged over what is already stored, so a change to one field never drops the
  // token or the console account recorded beside it.
  const saveState = (fields) =>
    writeFile(
      statePath,
      `${JSON.stringify({ ...stored, version, sessionSecret, tokenName: config.tokenName, ...fields }, null, 2)}\n`,
      { mode: 0o600 },
    )
  // What the panel chose is written before anything can fail: a first start that
  // cannot finish (a cold download, a port that never frees) must not cost the
  // person the form, and the next start has to know it was already answered.
  if (settings !== undefined) {
    log(`saving the settings from the panel: port ${settings.port} (the password is not logged)`)
    await saveState({
      setupCompleted: true,
      port: settings.port,
      ...(settings.rootPassword === undefined ? {} : { rootPassword: settings.rootPassword }),
    })
  }

  let binaryPath = config.binaryPath
  let binarySource = 'binaryPath'
  let binaryVerified = false
  if (binaryPath === undefined) {
    log('looking for a gateway binary this machine already has; a release download is the last resort')
    const binary = await resolveGatewayBinary({
      version,
      downloadBaseUrl: config.downloadBaseUrl,
      dataDir,
      cacheDir: releaseCacheDir(home, version),
      route,
      onProgress: (event) => {
        reportBinaryStep(state.progress, event, { version, cacheDir: releaseCacheDir(home, version) })
      },
    })
    binaryPath = binary.path
    binarySource = binary.source
    binaryVerified = binary.verified
    log(
      binary.verified
        ? `gateway binary: ${binaryPath} (${binary.source}, sha256 verified)`
        : `gateway binary: ${binaryPath} (${binary.source}; no release manifest covers it, sha256 ${binary.digest})`,
    )
  } else {
    log(`gateway binary: ${binaryPath} (configured by binaryPath, not checked here)`)
  }
  state.progress.binary = { path: binaryPath, source: binarySource, verified: binaryVerified }

  const preferredPort = stored.port ?? settings?.port ?? config.port
  state.progress.port = preferredPort
  state.progress.step = undefined
  state.progress.phase = PHASE.starting
  const gateway = await adoptOrStartGateway({
    ctx,
    binaryPath,
    dataDir,
    env: gatewayEnvironment(dataDir, sessionSecret),
    preferredPort,
    readyTimeoutMs: config.readyTimeoutMs,
  })
  if (gateway.adopted) log(`adopted the New API already listening on ${gateway.baseUrl}`)
  state.progress.port = gateway.port

  // Everything past the start must take this attempt's gateway with it when it
  // fails: an abandoned one would hold the port, and the retry would adopt it
  // instead of starting clean, so nothing would ever stop it.
  try {
    state.progress.phase = PHASE.provisioning
    const provisioned = await provisionGateway({
      baseUrl: gateway.baseUrl,
      rootUsername: config.rootUsername,
      tokenName: config.tokenName,
      knownPassword: config.rootPassword ?? settings?.rootPassword ?? stored.rootPassword,
      storedToken: stored.token,
    })

    const lan = lanAddress()
    const lanUrl = lan === undefined ? undefined : `http://${lan}:${gateway.port}`
    // Only an address that answers is advertised: a firewall or a stale adapter
    // must not turn the panel's link into a dead end.
    const lanAnswers = lanUrl !== undefined && (await probeGateway(lanUrl)) !== undefined
    const facts = connectionFacts(
      gateway.port,
      gateway.baseUrl,
      provisioned.token,
      provisioned.models,
      lanAnswers ? lanUrl : undefined,
    )
    // Everything this gateway is configured with, kept in one place: a later
    // change replaces one field of it, and the console account joins it when
    // someone signs in, so no writer can restore a stale value beside a new one.
    let persisted = {
      setupCompleted: true,
      port: gateway.port,
      rootPassword: provisioned.password,
      token: provisioned.token,
    }
    await saveState(persisted)
    const connectionPath = join(dataDir, 'connection.json')
    await writeFile(connectionPath, `${JSON.stringify(facts, null, 2)}\n`, { mode: 0o600 })

    state.connection = facts
    state.connectionPath = connectionPath
    state.adopted = gateway.adopted
    state.admin = { username: config.rootUsername, password: provisioned.password }
    state.provider = await publishProvider(ctx, config, facts)

    // The console proxy serves an account nobody chose until someone signs in
    // through it, so it holds no credential of its own — the root account created
    // by first-run setup stays confined to provisioning.
    const proxy = await startConsoleProxy({
      target: gateway.baseUrl,
      loadAccount: () => stored.consoleAccount,
      saveAccount: async (account) => {
        stored.consoleAccount = account
        persisted = { ...persisted, consoleAccount: account }
        await saveState(persisted)
      },
      log,
    })
    state.console = proxy
    state.consoleProxyUrl = proxy.url
    log(`console proxy: ${proxy.url} (keeps the embedded console signed in)`)

    log(`gateway ready at ${facts.baseUrl} with ${facts.models.length} enabled models`)
    log(
      `admin console: ${facts.consoleUrl}${facts.lanConsoleUrl === undefined ? '' : `  (this network: ${facts.lanConsoleUrl})`}  (add upstream channels and models there)`,
    )
    log(`Claude Code: ANTHROPIC_BASE_URL=${facts.anthropicBaseUrl} ANTHROPIC_AUTH_TOKEN=${facts.token}`)
    log(`connection facts: ${connectionPath}`)
    return {
      baseUrl: gateway.baseUrl,
      port: gateway.port,
      adopted: gateway.adopted,
      rootPassword: provisioned.password,
      /** Record a change to the settings this gateway is running with. */
      persist: async (fields) => {
        persisted = { ...persisted, ...fields }
        await saveState(persisted)
      },
      /**
       * Re-read the models this gateway serves and advertise them again: the
       * channels behind it are added in its own console, which this plugin
       * cannot observe, and a restart of the harness is not a reasonable price
       * for the selector to agree with the gateway.
       */
      sync: async () => {
        const models = (await verifyGatewayToken(gateway.baseUrl, provisioned.token)) ?? []
        const next = { ...facts, models }
        facts.models = models
        state.connection = facts
        await writeFile(connectionPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
        state.provider = await publishProvider(ctx, config, facts)
        return state.provider
      },
      /** The console account the proxy holds, when it holds one. */
      console: proxy,
      stop: async () => {
        await proxy.close()
        await gateway.stop()
      },
    }
  } catch (error) {
    await gateway.stop()
    throw error
  }
}

export function apply(ctx, raw) {
  const config = resolveConfig(raw)
  const home = resolveDshHome(config.dshHome)
  const dataDir = resolveDataDir(home, config.dataDir)
  const state = {
    connection: undefined,
    connectionPath: undefined,
    dataDir,
    logPath: join(dataDir, 'dsh-newapi.log'),
    adopted: false,
    error: undefined,
    hint: undefined,
    // Live account of the boot, so the panel can show a download in progress
    // instead of an unexplained "not running".
    progress: makeProgress(BOOT_ATTEMPTS),
    version: config.version,
    admin: undefined,
    console: undefined,
    consoleProxyUrl: undefined,
    provider: undefined,
    needsSetup: false,
    configure: undefined,
    retry: undefined,
  }

  /** The facts a way out of a failed boot needs, as of the release this run wanted. */
  function failureContext() {
    const version = state.version
    let asset
    try {
      // `latest` never resolves to an asset name: the tag it stands for is what
      // the asset is called after, and this run did not get that far.
      asset = version === 'latest' ? undefined : releaseAsset(process.platform, process.arch, version)
    } catch {
      asset = undefined
    }
    return failureFacts({
      downloadBaseUrl: config.downloadBaseUrl,
      dataDir,
      cacheDir: releaseCacheDir(home, version),
      version,
      asset,
      route: state.progress.route,
    })
  }

  /**
   * Record a failed attempt as something the panel can act on: the described
   * cause, a classified kind, and — for a download that could not reach the
   * release host — the route it already tried, so the panel can say whether the
   * machine's proxy was used, was tried and did not help, or was never found.
   * @param error - what the attempt threw.
   */
  async function reportFailure(error) {
    const described = describeError(error)
    const kind = classifyFailure(described)
    const hint = failureHint(kind, failureContext(), kind === HINT.port ? { port: state.progress.port } : {})
    if (kind === HINT.network) {
      const facts = state.progress.route
      log(facts?.url === undefined
        ? 'the release download went direct and could not reach the release host'
        : `the release download went through ${facts.url} (from the ${facts.source}) and still failed`)
      log('the panel names the ways out; the same lines are in the README under "the download cannot reach GitHub"')
    }
    state.error = described
    state.hint = hint
    state.progress.error = described
    state.progress.hint = hint
    return kind
  }

  // The boot record of the gateway currently being served. It lives here rather
  // than inside the effect below because the route family is built in the
  // injected context — one scope away from the effect that fills this in — and
  // the panel's sync route has to reach the same gateway the panel reads about.
  let running

  // The panel reads this through the Harness browser-trust fence; a composition
  // without a web server simply never mounts the routes.
  ctx.inject(['webServer'], (webCtx) => {
    const routes = makeRoutes(
      ctx,
      () => ({
        running: state.connection !== undefined,
        version: state.version,
        dataDir: state.dataDir,
        logPath: state.logPath,
        connectionPath: state.connectionPath,
        adopted: state.adopted,
        error: state.error,
        hint: state.hint,
        progress: state.progress,
        // Whether a retry would do anything, so the button is offered only when
        // it can act: one is accepted exactly when the bootstrap is not running a
        // round, which is the state a failure leaves behind.
        canRetry:
          state.retry !== undefined &&
          (state.progress.phase === PHASE.failed || state.progress.phase === PHASE.idle),
        adminUsername: state.admin?.username,
        adminPassword: state.admin?.password,
        consoleProxyUrl: state.consoleProxyUrl,
        consoleAccount: state.console?.account()?.username,
        // The panel shows its settings form while this is true, and the
        // submission below is the only thing that ends the wait.
        needsSetup: state.needsSetup,
        defaultPort: config.port,
        panelApi: PANEL_API,
        provider: state.provider,
        ...state.connection,
      }),
      // The panel's only write. Nothing waiting for an answer is a refusal, not
      // a silent success: the settings configure a gateway that exists or is
      // about to.
      (settings) =>
        state.configure === undefined
          ? Promise.resolve({ error: 'no gateway is configured or waiting to be configured', status: 409 })
          : state.configure(settings),
      // The panel's other write: hand the gateway's current model list to the
      // harness again, after channels were added in the gateway's own console.
      // A publish that reported a reason is answered as a refusal with that
      // reason, not as a success carrying a hidden failure.
      () =>
        running === undefined
          ? Promise.resolve({ error: 'the gateway is not running', status: 409 })
          : running.sync().then(
              (provider) =>
                provider?.error === undefined
                  ? { provider }
                  : { error: provider.error, status: 409, provider },
              (error) => ({ error: describeError(error), status: 502 }),
            ),
      // The panel's third write: run the boot once more after it gave up. The
      // cause lives on this side and the person has just dealt with it outside
      // the panel, so the request carries nothing and the answer only says
      // whether an attempt was started.
      () =>
        state.retry === undefined
          ? Promise.resolve({ error: 'this plugin has no bootstrap to retry', status: 409 })
          : state.retry(),
    )
    webCtx.effect(() => {
      const disposers = routes.map((route) => webCtx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'newapi: routes')
  })

  if (!config.enabled) {
    log('disabled by configuration; no gateway started')
    return
  }
  ctx.effect(async () => {
    // What this effect owns. `disposed` is read by the boot loop and by the
    // retry route, because a retry can be asked for while an attempt is in
    // flight and both have to stop when the plugin is unloaded.
    //
    // `running` is deliberately not declared here: the sync route is built one
    // scope out and has to reach the same gateway this effect starts.
    let disposed = false
    let settings
    let firstRun = false
    let answerFirstRun
    let booting = false

    /**
     * One round of bootstrap attempts: {@link BOOT_ATTEMPTS} tries, spaced by
     * {@link BOOT_RETRY_DELAY_MS}, each leaving the progress record and — when it
     * fails — the classified cause the panel renders. Giving up is not final any
     * more: the record says `failed`, and the retry route runs this again.
     */
    async function bootstrap() {
      if (booting || disposed) return
      booting = true
      try {
        for (let attempt = 1; !disposed; attempt++) {
          beginAttempt(state.progress, attempt)
          try {
            running = await boot(ctx, config, state, settings)
            if (disposed) {
              // Unloaded while this attempt was starting: nothing may be left
              // running that no disposer knows about.
              await running.stop()
              running = undefined
              return
            }
            state.error = undefined
            state.hint = undefined
            state.progress.phase = PHASE.ready
            state.progress.step = undefined
            state.progress.retryAt = undefined
            state.progress.since = new Date().toISOString()
            return
          } catch (error) {
            if (disposed) return
            const kind = await reportFailure(error)
            log(`gateway unavailable: ${state.error}`)
            if (kind === HINT.network && attempt === 1) {
              // The failure whose cause is easiest to miss: a machine that
              // reaches the release host in a browser and not from here, because
              // the connection has to leave through a proxy this plugin may or
              // may not have found.
              log('the panel names the ways out; the same lines are in the README under "the download cannot reach GitHub"')
            }
            if (attempt >= BOOT_ATTEMPTS) {
              log(`giving up after ${attempt} attempts; the harness continues without a local New API gateway`)
              log('fix the reported cause, then choose Retry in the New API panel to start it again')
              state.progress.phase = PHASE.failed
              return
            }
            const waitMs = BOOT_RETRY_DELAY_MS[attempt - 1] ?? BOOT_RETRY_DELAY_MS[BOOT_RETRY_DELAY_MS.length - 1]
            log(`retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1} of ${BOOT_ATTEMPTS})`)
            state.progress.phase = PHASE.retrying
            state.progress.retryAt = new Date(Date.now() + waitMs).toISOString()
            await delay(waitMs)
          }
        }
      } finally {
        booting = false
      }
    }

    /**
     * Ask for another round. The panel's Retry button is the caller: the boot
     * gave up, and toggling the plugin off and on is not something a person who
     * has just fixed a proxy setting should have to know about.
     * @returns `{started}` once an attempt is running, or `{error, status}`.
     */
    function requestStart() {
      if (disposed) return { error: 'the plugin is not loaded', status: 409 }
      if (state.connection !== undefined) return { error: 'the gateway is already running', status: 409 }
      if (booting) return { error: 'a start is already in progress', status: 409 }
      if (firstRun) return { error: 'the first-run settings have not been collected yet', status: 409 }
      state.error = undefined
      state.hint = undefined
      state.progress.hint = undefined
      state.progress.error = undefined
      bootstrap().catch((error) => {
        log(`the retry stopped: ${describeError(error)}`)
      })
      return { started: true, attempts: BOOT_ATTEMPTS }
    }

    state.retry = requestStart

    // Either answers the first-run question or re-configures the running
    // gateway: the same form, and the only two things this route may do.
    state.configure = async (asked) => {
      if (firstRun) {
        if (asked.rootPassword === undefined) {
          return { error: 'a root password is required to initialise the instance', status: 400 }
        }
        firstRun = false
        const accept = answerFirstRun
        answerFirstRun = undefined
        state.needsSetup = false
        accept(asked)
        return { accepted: true, port: asked.port }
      }
      if (running === undefined) return { error: 'the gateway is not running', status: 409 }
      let passwordChanged = false
      if (asked.rootPassword !== undefined && asked.rootPassword !== running.rootPassword) {
        try {
          await changeGatewayRootPassword({
            baseUrl: running.baseUrl,
            rootUsername: config.rootUsername,
            currentPassword: running.rootPassword,
            nextPassword: asked.rootPassword,
          })
        } catch (error) {
          return { error: describeError(error), status: 502 }
        }
        passwordChanged = true
        running.rootPassword = asked.rootPassword
        await running.persist({ rootPassword: asked.rootPassword })
        if (running.console.account()?.username === config.rootUsername) {
          // The change invalidated every session; hand the proxy the credential
          // it must sign in with, so the console does not fall back to its login page.
          running.console.remember({ username: config.rootUsername, password: asked.rootPassword })
        }
      }
      if (asked.port === running.port) {
        return { applied: true, port: running.port, passwordChanged, portChanged: false }
      }
      if (running.adopted) {
        return {
          error: `the New API on ${running.baseUrl} was not started by this plugin, so its port cannot be changed here`,
          status: 409,
        }
      }
      log(`moving the gateway from port ${running.port} to ${asked.port}`)
      await running.persist({ port: asked.port })
      await running.stop()
      running = undefined
      state.connection = undefined
      state.consoleProxyUrl = undefined
      state.provider = undefined
      try {
        running = await boot(ctx, config, state, undefined)
      } catch (error) {
        await reportFailure(error)
        return { error: state.error, status: 502 }
      }
      state.error = undefined
      state.hint = undefined
      state.progress.phase = PHASE.ready
      state.progress.retryAt = undefined
      return { applied: true, port: running.port, passwordChanged, portChanged: true }
    }

    // The first run has to be collected once, before the loop can start
    // anything: the port and the root password decide the database the gateway
    // creates, so they cannot arrive after it does. A retry never waits again —
    // what the panel collected is already in `settings`.
    const stored = await loadState(join(dataDir, STATE_FILE))
    firstRun = needsFirstRunSetup(config, stored)
    if (firstRun) {
      const answered = new Promise((resolve) => {
        answerFirstRun = resolve
      })
      state.needsSetup = true
      log('first run: waiting for the New API panel to collect the port and the root password')
      log('no panel in this composition? set `rootPassword` on the newapi plugin row instead')
      settings = await answered
      log('first run: the panel answered; starting the gateway it described')
    }

    // The first round is awaited rather than detached: a caller that awaits this
    // effect learns whether the gateway came up, and the disposer below is what
    // releases it. A round that gives up is not the end of the effect — the retry
    // route runs another one, and the same disposer stops whatever it starts.
    try {
      await bootstrap()
    } catch (error) {
      // A round already reports its own failures; reaching here means the report
      // itself broke, and the disposer still has to be handed back.
      log(`the bootstrap stopped: ${describeError(error)}`)
    }

    return async () => {
      disposed = true
      state.configure = undefined
      state.retry = undefined
      state.connection = undefined
      state.consoleProxyUrl = undefined
      state.provider = undefined
      state.needsSetup = false
      await running?.stop()
    }
  }, 'newapi.gateway')
}

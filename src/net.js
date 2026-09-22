/**
 * The route this plugin's own network use takes to the release host.
 *
 * A release download is the only step of this plugin that leaves the machine,
 * and on a desktop behind a proxy client it is also the step most likely to
 * fail: Node's `fetch` opens its own connection and ignores the proxy Windows,
 * macOS and GNOME keep for every other program, so "the browser can open GitHub"
 * says nothing about this download. Telling a person to set an environment
 * variable and restart the whole harness is a poor answer when the machine has
 * already been told where its proxy is, so this module reads that answer and uses
 * it.
 *
 * The order is deliberate, most certain first: an explicit proxy in the
 * environment, then the proxy the Windows Internet Settings name — the same
 * value every browser and installer on that machine uses — and, only after a
 * direct attempt has already failed, the loopback ports a desktop proxy client
 * listens on. A port that merely answers is never preferred to a direct
 * connection, because routing a working download through a stranger's port is a
 * worse failure than the one it tries to repair.
 *
 * This module is also where a proxy is actually spoken, which Node does not do
 * for `fetch`: an `https://` target is tunneled with `CONNECT` and then carries
 * its own TLS, and an `http://` target is sent to the proxy in absolute form.
 * Both are answered as a `Response`, so the release layer cannot tell a proxied
 * request from a direct one.
 * @module dsh-newapi/net
 */
import { execFile } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { connect as tcpConnect } from 'node:net'
import { Readable } from 'node:stream'
import { connect as tlsConnect } from 'node:tls'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

/** Windows registry key holding the per-user proxy every WinINET program reads. */
const WINDOWS_PROXY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

/**
 * Ports a desktop proxy client commonly listens on, in the order they are tried.
 * A client that writes the system proxy settings is found through those instead;
 * this list is the last resort, for one that only opens a port.
 */
export const PROXY_PORTS = [7890, 7897, 7891, 10809, 10808, 1080, 8888, 8118]

/** How long one candidate proxy port may take to answer. */
const PROBE_TIMEOUT_MS = 300

/** How long a proxy may take to accept a tunnel, and a release host to complete TLS. */
const CONNECT_TIMEOUT_MS = 10_000

/** How long a transfer may stall, with no byte either way, before it is called dead. */
const IDLE_TIMEOUT_MS = 60_000

/** Redirects one proxied request follows before it gives up. */
const MAX_REDIRECTS = 5

/** The statuses whose whole meaning is the `Location` beside them. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

/**
 * Where a route was found. The panel turns these into words; the Host only ever
 * reports the token, so one language of copy can be changed without touching it.
 */
export const ROUTE_SOURCE = {
  environment: 'environment',
  windows: 'windows',
  localPort: 'local-port',
  socks: 'socks',
  direct: 'direct',
}

/**
 * The proxy address without its credentials. A proxy password belongs in neither
 * a log line nor a panel a screenshot can carry, so this is the only form of an
 * address that leaves this module.
 * @param url - a parsed proxy URL.
 * @returns `protocol//host:port`.
 */
export function proxyLabel(url) {
  const parsed = url instanceof URL ? url : new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

/**
 * Read one configured proxy address: `host:port`, or any URL form. A scheme this
 * module cannot speak (SOCKS, most often) is reported rather than thrown away,
 * because "the machine's proxy is a SOCKS one" explains a failure that "no proxy
 * found" would hide.
 * @param value - the configured value, as written.
 * @returns `{protocol, url}` where `url` is set only for HTTP proxies, or `undefined` for a blank or unusable value.
 */
export function parseProxyAddress(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const text = value.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
  let parsed
  try {
    parsed = new URL(withScheme)
  } catch {
    return undefined
  }
  if (parsed.hostname === '') return undefined
  const protocol = parsed.protocol.replace(':', '').toLowerCase()
  return { protocol, url: protocol === 'http' || protocol === 'https' ? parsed : undefined }
}

/**
 * The proxy an environment variable names, if any. `HTTPS_PROXY` wins over
 * `HTTP_PROXY`, and either case wins over `ALL_PROXY` — the order the tools that
 * set these variables expect.
 * @param env - the environment to read.
 * @returns `{protocol, url, key}` for the first variable that holds one, or `undefined`.
 */
export function proxyFromEnvironment(env = process.env) {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const parsed = parseProxyAddress(env?.[key])
    if (parsed !== undefined) return { ...parsed, key }
  }
  return undefined
}

/**
 * The `ProxyOverride` list as a decision: does this list tell a program not to
 * use the proxy for this address? The syntax is the one WinINET and NO_PROXY
 * both use — bare hosts, `.suffix`, `*.suffix`, `host:port`, `*`, and `<local>`
 * for names without a dot.
 * @param target - the URL about to be fetched.
 * @param override - the list, or nothing.
 * @returns true when the address must be reached directly.
 */
export function bypassed(target, override) {
  if (typeof override !== 'string' || override.trim() === '') return false
  const url = new URL(target)
  const host = url.hostname.toLowerCase()
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  for (const raw of override.split(/[;,]/)) {
    const entry = raw.trim().toLowerCase()
    if (entry === '') continue
    if (entry === '*') return true
    if (entry === '<local>') {
      if (!host.includes('.')) return true
      continue
    }
    const separator = entry.lastIndexOf(':')
    const namedPort = separator === -1 ? undefined : entry.slice(separator + 1)
    const pattern = namedPort !== undefined && /^\d+$/.test(namedPort) ? entry.slice(0, separator) : entry
    if (namedPort !== undefined && /^\d+$/.test(namedPort) && namedPort !== port) continue
    const bare = pattern.replace(/^\*?\.?/, '')
    if (bare === '') continue
    if (host === bare || host.endsWith(`.${bare}`)) return true
  }
  return false
}

/**
 * Parse the output of `reg query` for the Internet Settings key.
 * @param text - the command's output, as bytes read back one-to-one.
 * @returns the three values that matter, or `undefined` when the key said nothing.
 */
export function parseWindowsProxySettings(text) {
  const values = new Map()
  for (const line of String(text).split('\n')) {
    const match = /^\s{4}(\S+)\s+REG_[A-Z_]+\s+(.*?)\s*$/.exec(line)
    if (match !== null) values.set(match[1], match[2])
  }
  if (values.size === 0) return undefined
  const server = values.get('ProxyServer')
  return {
    enabled: values.get('ProxyEnable') === '0x1',
    server: server === undefined || server === '' ? undefined : server,
    override: values.get('ProxyOverride'),
  }
}

/**
 * Pick the address to use out of a Windows `ProxyServer` value. It is either a
 * bare `host:port` or a `scheme=host:port` list, and the HTTPS entry is the one
 * a release download needs.
 * @param settings - the output of {@link parseWindowsProxySettings}.
 * @returns `{protocol, url, override}` for an HTTP proxy, a SOCKS address this module cannot speak, or `undefined`.
 */
export function windowsProxyAddress(settings) {
  if (settings === undefined || !settings.enabled || settings.server === undefined) return undefined
  const entries = new Map()
  for (const part of settings.server.split(';')) {
    const text = part.trim()
    if (text === '') continue
    const separator = text.indexOf('=')
    const key = separator === -1 ? 'http' : text.slice(0, separator).trim().toLowerCase()
    const value = separator === -1 ? text : text.slice(separator + 1).trim()
    if (value !== '') entries.set(key, value)
  }
  for (const key of ['https', 'http']) {
    const parsed = parseProxyAddress(entries.get(key))
    if (parsed?.url !== undefined) return { ...parsed, override: settings.override }
  }
  const socks = entries.get('socks') ?? entries.get('socks5') ?? entries.get('socks4')
  if (socks !== undefined) return { protocol: 'socks', url: undefined, address: sanitizedAddress(socks), override: settings.override }
  return undefined
}

/**
 * One configured address without its credentials, for a report that must not
 * carry a password. A SOCKS entry is not a URL this module speaks, so it cannot
 * be normalised through {@link proxyLabel}; the credentials and the scheme are
 * cut out of the text instead.
 * @param value - the configured address.
 * @returns `host:port`, with any `scheme://` and `user:secret@` removed.
 */
function sanitizedAddress(value) {
  return String(value)
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^[^/@]*@/, '')
}

/**
 * Read the Windows Internet Settings through `reg.exe`. There is no way to read
 * the registry from Node without a native module, and this plugin ships no
 * dependencies on purpose; one short-lived read of a key that every browser on
 * the machine already obeys is the cheapest honest answer.
 * @returns the parsed settings, or `undefined` when the key or the command is unavailable.
 */
function readWindowsProxySettings() {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', WINDOWS_PROXY_KEY],
      { windowsHide: true, timeout: 5_000, encoding: 'buffer' },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        // The value names and types are ASCII whatever code page the machine
        // uses, and reading byte-for-byte cannot mangle them.
        resolve(parseWindowsProxySettings(stdout.toString('latin1')))
      },
    )
  })
}

/** True when something accepts a TCP connection on this loopback port. */
function acceptsConnection(port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = tcpConnect({ port, host: '127.0.0.1' })
    const settle = (answer) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(timeoutMs, () => settle(false))
    socket.once('error', () => settle(false))
    socket.once('connect', () => settle(true))
  })
}

/**
 * The first port of `ports` that something is listening on, as a stand-in for
 * "this machine has a proxy". Only consulted after a direct download failed, and
 * only on the loopback interface, so it can never turn into a port scan.
 * @param ports - candidates, in the order they are tried.
 * @param timeoutMs - how long one candidate may take.
 * @returns the port, or `undefined` when none answers.
 */
export async function detectLocalProxy(ports = PROXY_PORTS, timeoutMs = PROBE_TIMEOUT_MS) {
  for (const port of ports) {
    if (await acceptsConnection(port, timeoutMs)) return port
  }
  return undefined
}

/**
 * A route as the panel and the log read it: plain JSON, no URL object and never
 * a credential. A boot that found no proxy is reported as the direct route, which
 * is a decision the panel has to be able to state — "the plugin did not use a
 * proxy" is the answer to a question a person behind one always has.
 * @param route - a route record, or nothing when the machine named no proxy.
 * @returns `{source, url, via, address}` with only the fields that apply.
 */
export function routeFacts(route) {
  if (route === undefined) return { source: ROUTE_SOURCE.direct }
  return {
    source: route.source ?? (route.url === undefined ? ROUTE_SOURCE.direct : ROUTE_SOURCE.environment),
    ...(route.url === undefined ? {} : { url: proxyLabel(route.url) }),
    ...(route.via === undefined ? {} : { via: route.via }),
    ...(route.address === undefined ? {} : { address: route.address }),
  }
}

/**
 * One route for one boot: what the machine says its proxy is, what a local probe
 * found after a failure, and the requests sent along it.
 *
 * It is created per boot rather than once per process, so a person who starts
 * their proxy client and chooses Retry gets a fresh reading of the settings
 * instead of the one that was already known to be wrong.
 * @param options - environment, platform, and the readers and probe a check replaces.
 * @returns `{resolve, current, probe, request}`.
 */
export function createRoute(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const readSettings = options.readWindowsSettings ?? readWindowsProxySettings
  const probePorts = options.probe ?? detectLocalProxy
  const onFound = options.onFound
  /**
   * `NO_PROXY` covers every route, not just the one an environment variable
   * named: an operator who writes it means "this host goes direct", whatever
   * else the machine says.
   */
  const noProxy = env.NO_PROXY ?? env.no_proxy

  /** What the machine's own settings named: a proxy, a SOCKS address, or nothing. */
  let configured
  /** What the panel is told and what requests use; `undefined` means direct. */
  let settled
  /** The settings are read once per boot, and a second caller waits for that read. */
  let reading
  /** Whether a local port has been probed; a probe happens at most once per boot. */
  let probed = false

  function adopt(route) {
    settled = route
    onFound?.(route)
    return route
  }

  /** Read the machine's own settings: the environment first, then the Windows ones. */
  async function readSettingsOnce() {
    const fromEnv = proxyFromEnvironment(env)
    if (fromEnv !== undefined) {
      configured = fromEnv.url !== undefined
        ? { ...fromEnv, via: fromEnv.key, source: ROUTE_SOURCE.environment }
        : { protocol: fromEnv.protocol, url: undefined, via: fromEnv.key, source: ROUTE_SOURCE.socks }
      return adopt(configured)
    }
    if (platform === 'win32') {
      const fromWindows = windowsProxyAddress(await readSettings())
      if (fromWindows !== undefined) {
        configured = fromWindows.url === undefined
          ? { ...fromWindows, source: ROUTE_SOURCE.socks }
          : { ...fromWindows, source: ROUTE_SOURCE.windows }
        return adopt(configured)
      }
    }
    return undefined
  }

  /**
   * The route in use, once the machine has been asked. A route adopted later — a
   * port a probe found, or a host the bypass list sends direct — is what a caller
   * reading this again sees, so a report can never lag the decision.
   */
  async function resolve() {
    if (reading === undefined) reading = readSettingsOnce()
    await reading
    return settled
  }

  /**
   * Look for a proxy on the loopback ports a desktop client listens on. Called
   * only after a request has already failed on the route that was in use, and at
   * most once, so a port that answers but does not proxy cannot be retried into
   * an endless loop.
   * @returns the route now in use, or `undefined` when nothing answered.
   */
  async function probe() {
    if (probed) return settled
    probed = true
    const port = await probePorts(PROXY_PORTS, PROBE_TIMEOUT_MS)
    if (port === undefined) return undefined
    return adopt({ url: new URL(`http://127.0.0.1:${port}`), source: ROUTE_SOURCE.localPort })
  }

  /**
   * Send one request along this route, answering it exactly as `fetch` would have.
   * A failure is the one moment a local probe is worth its cost: the direct route
   * is then known to be broken, and a proxy client that opened a port without
   * writing the system settings is still a working way out.
   * @param url - the request target.
   * @param init - `fetch` options; the release layer only ever sends GETs with headers.
   * @returns the response.
   */
  async function request(url, init) {
    await resolve()
    // A host the bypass list sends direct keeps the machine's proxy available for
    // the next target, so the decision is taken per request rather than once.
    const route = settled?.bypassed === true ? configured : settled
    const bypass = bypassed(url, route?.override) || bypassed(url, noProxy)
    if (route?.url !== undefined && bypass) {
      // Honouring a bypass list is the whole point of one, and the report says so
      // rather than claiming a proxy that was never used.
      if (settled?.bypassed !== true) adopt({ source: ROUTE_SOURCE.direct, bypassed: true })
      return await fetch(url, init)
    }
    const proxy = route?.url
    if (proxy !== undefined) {
      try {
        return await proxyFetch(url, init, proxy)
      } catch (error) {
        const alternative = await probe()
        if (alternative?.url === undefined || alternative.url.href === proxy.href) throw error
        return await proxyFetch(url, init, alternative.url)
      }
    }
    try {
      return await fetch(url, init)
    } catch (error) {
      const alternative = await probe()
      if (alternative?.url === undefined) throw error
      return await proxyFetch(url, init, alternative.url)
    }
  }

  return { resolve, probe, request, current: () => settled }
}

/**
 * A route that always goes direct, for a caller that has decided so — a check
 * that pins the direct path, and a machine with no proxy at all.
 * @returns a route whose requests are plain `fetch`.
 */
export function directRoute() {
  return createRoute({
    env: {},
    platform: 'linux',
    readWindowsSettings: async () => undefined,
    probe: async () => undefined,
  })
}

/** The `Proxy-Authorization` header a proxy URL with credentials calls for. */
function authorization(proxy) {
  if (proxy.username === '' && proxy.password === '') return {}
  const user = decodeURIComponent(proxy.username)
  const secret = decodeURIComponent(proxy.password)
  return { 'proxy-authorization': `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}` }
}

/** The port a proxy URL listens on, defaulted by its own scheme. */
function proxyPort(proxy) {
  if (proxy.port !== '') return Number(proxy.port)
  return proxy.protocol === 'https:' ? 443 : 80
}

/**
 * Open the tunnel an `https://` target needs: `CONNECT` to the proxy, then TLS
 * to the origin over the socket that comes back.
 * @param proxy - the proxy URL.
 * @param authority - `host:port` of the target.
 * @returns the TLS socket, ready for a request.
 */
async function openTunnel(proxy, authority) {
  const transport = proxy.protocol === 'https:' ? httpsRequest : httpRequest
  const socket = await new Promise((resolve, reject) => {
    const connect = transport({
      host: proxy.hostname,
      port: proxyPort(proxy),
      method: 'CONNECT',
      path: authority,
      headers: { host: authority, ...authorization(proxy) },
      agent: false,
    })
    connect.setTimeout(CONNECT_TIMEOUT_MS, () => {
      connect.destroy(new Error(`${proxyLabel(proxy)} did not respond to CONNECT ${authority} within ${CONNECT_TIMEOUT_MS}ms (ETIMEDOUT)`))
    })
    connect.once('connect', (response, tunnel, head) => {
      if (response.statusCode !== 200) {
        tunnel.destroy()
        reject(new Error(`${proxyLabel(proxy)} refused CONNECT ${authority}: HTTP ${response.statusCode}`))
        return
      }
      // The CONNECT deadline belongs to the handshake, not to the transfer.
      tunnel.setTimeout(0)
      // A proxy may answer with the first bytes of the tunneled response already
      // read; dropping them would truncate the body.
      if (head !== undefined && head.length > 0) tunnel.unshift(head)
      resolve(tunnel)
    })
    connect.once('error', (error) => reject(new Error(`${proxyLabel(proxy)} is unusable: ${error.message}`)))
    connect.end()
  })
  return await new Promise((resolve, reject) => {
    const tls = tlsConnect({ socket, servername: authority.split(':')[0] }, () => {
      tls.setTimeout(0)
      resolve(tls)
    })
    tls.setTimeout(CONNECT_TIMEOUT_MS, () => {
      tls.destroy(new Error(`the TLS handshake with ${authority} did not finish within ${CONNECT_TIMEOUT_MS}ms (ETIMEDOUT)`))
    })
    tls.once('error', reject)
  })
}

/**
 * An agent that hands Node a socket it did not open itself. A request option
 * cannot do this: Node's agent always calls its own `createConnection`, so a
 * tunnel has to arrive as the agent. One agent carries one request, which is also
 * what keeps a redirect from opening a connection of its own.
 */
class TunnelAgent extends HttpsAgent {
  constructor(tunnel) {
    super({ keepAlive: false })
    this.tunnel = tunnel
  }

  createConnection(options, callback) {
    if (typeof callback === 'function') {
      callback(null, this.tunnel)
      return undefined
    }
    return this.tunnel
  }
}

/**
 * One request on one socket, or through the proxy in absolute form when the
 * target is plain HTTP and needs no tunnel.
 * @param transport - `http.request` or `https.request`.
 * @param options - the request options, including the agent to use when there is one.
 * @param body - the bytes to send, when there are any.
 * @param label - what to call the far side if the transfer stalls.
 * @returns the origin's response.
 */
function send(transport, options, body, label) {
  return new Promise((resolve, reject) => {
    const request = transport(options, resolve)
    request.setTimeout(IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error(`${label} stalled for ${IDLE_TIMEOUT_MS}ms (ETIMEDOUT)`))
    })
    request.once('error', reject)
    if (body === undefined || body === null) request.end()
    else request.end(body)
  })
}

/**
 * The origin's response as a `Response`, which is the shape the release layer
 * already knows how to stream. An origin that compressed the body despite the
 * identity request is decoded here, and its stated length dropped with it: the
 * wire length is not the length the download will write.
 * @param nodeResponse - the response Node produced.
 * @returns a `Response` whose body is the decompressed payload.
 */
function asResponse(nodeResponse) {
  const status = nodeResponse.statusCode ?? 502
  const headers = new Headers()
  for (const [name, value] of Object.entries(nodeResponse.headers)) {
    if (value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
  }
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status, statusText: nodeResponse.statusMessage, headers })
  }
  const encoding = (headers.get('content-encoding') ?? '').toLowerCase()
  let body = nodeResponse
  if (encoding === 'gzip' || encoding === 'x-gzip' || encoding === 'deflate' || encoding === 'br') {
    const decoder = encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : createGunzip()
    body = nodeResponse.pipe(decoder)
    headers.delete('content-encoding')
    headers.delete('content-length')
  }
  return new Response(Readable.toWeb(body), { status, statusText: nodeResponse.statusMessage, headers })
}

/** One hop of a proxied request: the tunnel and TLS for HTTPS, absolute form for HTTP. */
async function proxyRequest(target, init, proxy) {
  const secure = target.protocol === 'https:'
  const port = target.port === '' ? (secure ? 443 : 80) : Number(target.port)
  const headers = { ...(init.headers ?? {}) }
  if (!Object.keys(headers).some((name) => name.toLowerCase() === 'host')) headers.host = target.host
  const method = init.method ?? 'GET'
  if (secure) {
    const tunnel = await openTunnel(proxy, `${target.hostname}:${port}`)
    return asResponse(await send(httpsRequest, {
      host: target.hostname,
      port,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      // The Host header follows the target, not the socket it travels on.
      setHost: false,
      servername: target.hostname,
      agent: new TunnelAgent(tunnel),
    }, init.body, target.host))
  }
  return asResponse(await send(httpRequest, {
    host: proxy.hostname,
    port: proxyPort(proxy),
    // The absolute form is what tells a proxy where the request is going; the
    // tunnel above carries that in its CONNECT line instead.
    path: target.href,
    method,
    headers: { ...headers, ...authorization(proxy) },
    agent: false,
    setHost: false,
  }, init.body, `${target.host} through ${proxyLabel(proxy)}`))
}

/**
 * `fetch` through an HTTP proxy, for the two URL shapes this plugin needs.
 *
 * Redirects are followed here rather than by `fetch`, because a redirect is
 * nothing but another request along the same route — and the release host
 * redirects every asset to a storage host.
 * @param url - the request target.
 * @param init - `fetch` options; only `method`, `headers` and a byte body are honoured.
 * @param proxy - the proxy URL, or its address as written.
 * @returns a `Response`; its body is the payload, already decoded.
 * @throws {Error} for an address this module cannot use as an HTTP proxy.
 */
export async function proxyFetch(url, init = {}, proxy) {
  const proxyUrl = proxy instanceof URL ? proxy : parseProxyAddress(proxy)?.url
  if (proxyUrl === undefined) {
    throw new Error(`newapi: ${String(proxy)} is not an HTTP proxy address; a SOCKS proxy needs a local HTTP port`)
  }
  let target = new URL(url)
  let next = init
  for (let hop = 0; ; hop++) {
    const response = await proxyRequest(target, next, proxyUrl)
    const location = response.headers.get('location')
    if (!REDIRECT_STATUS.has(response.status) || location === null) return response
    await response.body?.cancel()
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`${url}: more than ${MAX_REDIRECTS} redirects through ${proxyLabel(proxyUrl)}`)
    }
    target = new URL(location, target)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error(`${url}: redirected to ${target.protocol}, which this download cannot use`)
    }
    // 303 always, and 301/302 in practice, turn the request into a GET; a
    // redirect that must keep its method says 307 or 308.
    if (response.status === 303 || (response.status === 301 || response.status === 302)) {
      next = { ...next, method: 'GET', body: undefined }
    }
  }
}

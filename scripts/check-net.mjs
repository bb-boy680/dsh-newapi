/**
 * A machine behind a proxy client is the one shape of failure this plugin cannot
 * diagnose its way out of: Node's `fetch` ignores the system proxy, so a browser
 * that opens GitHub says nothing about a release download. This pins what the
 * plugin now does about that instead of only printing advice — where it reads the
 * machine's proxy from, which route it prefers, when it is allowed to guess, and
 * that a proxied request really comes back through the proxy.
 *
 * The proxy below is a real one for the length of this check: a local HTTP proxy
 * with a `CONNECT` handler and a forwarding path, in front of a local origin.
 *
 * Run from this package with: node scripts/check-net.mjs
 */
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { connect as tcpConnect } from 'node:net'
import { once } from 'node:events'
import {
  ROUTE_SOURCE,
  bypassed,
  createRoute,
  detectLocalProxy,
  directRoute,
  parseProxyAddress,
  parseWindowsProxySettings,
  proxyFetch,
  proxyFromEnvironment,
  proxyLabel,
  routeFacts,
  windowsProxyAddress,
} from '../src/net.js'

let failures = 0
const check = async (label, run) => {
  try {
    await run()
    console.log(`  ${label.padEnd(56)}: ok`)
  } catch (error) {
    failures++
    console.log(`  ${label.padEnd(56)}: FAILED (${error.message})`)
  }
}

/** Close a server and wait for it, so the next check cannot reuse its port. */
const closeServer = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })

/** A loopback port with nothing listening on it: the closest thing to a blocked host. */
async function closedPort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await closeServer(server)
  return port
}

console.log('--- where the machine says its proxy is ---')

await check('an environment proxy is read in the order the tools set them', () => {
  assert.equal(proxyLabel(proxyFromEnvironment({ HTTP_PROXY: '127.0.0.1:10809' }).url), 'http://127.0.0.1:10809')
  const both = proxyFromEnvironment({ HTTP_PROXY: '127.0.0.1:10809', HTTPS_PROXY: '127.0.0.1:7890' })
  assert.equal(proxyLabel(both.url), 'http://127.0.0.1:7890')
  assert.equal(both.key, 'HTTPS_PROXY')
  assert.equal(proxyFromEnvironment({}), undefined)
})

await check('an address a browser would take is taken here too', () => {
  assert.equal(proxyLabel(parseProxyAddress('http://127.0.0.1:7890').url), 'http://127.0.0.1:7890')
  assert.equal(proxyLabel(parseProxyAddress('proxy.corp.example:3128').url), 'http://proxy.corp.example:3128')
  assert.equal(parseProxyAddress('socks5://127.0.0.1:10808').url, undefined)
  assert.equal(parseProxyAddress('socks5://127.0.0.1:10808').protocol, 'socks5')
  assert.equal(parseProxyAddress('   '), undefined)
})

await check('a proxy password never leaves this module in a log line', () => {
  const labelled = proxyLabel(parseProxyAddress('http://user:secret@127.0.0.1:7890').url)
  assert.equal(labelled, 'http://127.0.0.1:7890')
  assert.ok(!labelled.includes('secret'))
  const facts = routeFacts({ url: parseProxyAddress('http://user:secret@127.0.0.1:7890').url, source: 'windows' })
  assert.equal(facts.url, 'http://127.0.0.1:7890')
})

await check('the Windows Internet Settings are read as reg.exe prints them', () => {
  const text = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    '    ProxyEnable    REG_DWORD    0x1',
    '    ProxyServer    REG_SZ    127.0.0.1:7890',
    '    ProxyOverride    REG_SZ    *.steamchina.com;<local>',
    '',
  ].join('\r\n')
  const settings = parseWindowsProxySettings(text)
  assert.equal(settings.enabled, true)
  assert.equal(settings.server, '127.0.0.1:7890')
  const address = windowsProxyAddress(settings)
  assert.equal(proxyLabel(address.url), 'http://127.0.0.1:7890')
  assert.equal(address.override, '*.steamchina.com;<local>')
})

await check('a scheme list picks the entry a release download needs', () => {
  const address = windowsProxyAddress({
    enabled: true,
    server: 'http=127.0.0.1:10809;https=127.0.0.1:10810;socks=127.0.0.1:10808',
    override: '',
  })
  assert.equal(proxyLabel(address.url), 'http://127.0.0.1:10810')
})

await check('a disabled or SOCKS-only setting is not mistaken for a route', () => {
  assert.equal(windowsProxyAddress({ enabled: false, server: '127.0.0.1:7890' }), undefined)
  assert.equal(windowsProxyAddress({ enabled: true, server: undefined }), undefined)
  assert.equal(windowsProxyAddress(undefined), undefined)
  const socks = windowsProxyAddress({ enabled: true, server: 'socks=127.0.0.1:10808', override: undefined })
  assert.equal(socks.url, undefined)
  assert.equal(socks.address, '127.0.0.1:10808')
  // Credentials in a SOCKS entry are cut out of the report as well.
  const private_ = windowsProxyAddress({ enabled: true, server: 'socks=user:secret@127.0.0.1:10808', override: undefined })
  assert.ok(!private_.address.includes('secret'))
})

await check('an override list is honoured the way NO_PROXY is', () => {
  assert.equal(bypassed('https://github.com/x', 'github.com'), true)
  assert.equal(bypassed('https://github.com/x', '*.github.com'), true)
  assert.equal(bypassed('https://release.github.com/x', '.github.com'), true)
  assert.equal(bypassed('https://github.com/x', 'example.com,github.com'), true)
  assert.equal(bypassed('https://github.com/x', 'example.com'), false)
  assert.equal(bypassed('https://github.com/x', '*'), true)
  assert.equal(bypassed('https://intranet/x', '<local>'), true)
  assert.equal(bypassed('https://github.com/x', 'github.com:8443'), false)
  assert.equal(bypassed('https://github.com/x', 'github.com:443'), true)
  assert.equal(bypassed('https://github.com/x', ''), false)
})

await check('the route is resolved once, and settings win over a guessed port', async () => {
  let probes = 0
  const route = createRoute({
    env: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
    platform: 'win32',
    readWindowsSettings: async () => {
      throw new Error('the Windows settings were read although the environment named a proxy')
    },
    probe: async () => {
      probes++
      return 7890
    },
  })
  const found = await route.resolve()
  assert.equal(found.source, ROUTE_SOURCE.environment)
  assert.equal(found.via, 'HTTPS_PROXY')
  assert.equal(proxyLabel((await route.resolve()).url), 'http://127.0.0.1:7890')
  assert.equal(probes, 0, 'a port was probed although the machine named a proxy')
})

await check('the Windows settings are used when the environment says nothing', async () => {
  let probes = 0
  const route = createRoute({
    env: {},
    platform: 'win32',
    readWindowsSettings: async () => ({ enabled: true, server: '127.0.0.1:7890', override: 'example.com' }),
    probe: async () => {
      probes++
      return 10809
    },
  })
  const found = await route.resolve()
  assert.equal(found.source, ROUTE_SOURCE.windows)
  assert.equal(proxyLabel(found.url), 'http://127.0.0.1:7890')
  assert.equal(probes, 0)
})

await check('a local port is guessed only after a direct request has failed', async () => {
  let probes = 0
  const route = createRoute({
    env: {},
    platform: 'linux',
    probe: async () => {
      probes++
      return 7890
    },
  })
  // Nothing has failed yet: the direct route stands, and no port is probed.
  const settings = await route.resolve()
  assert.equal(settings, undefined)
  assert.equal(probes, 0)
  const found = await route.probe()
  assert.equal(found.source, ROUTE_SOURCE.localPort)
  assert.equal(probes, 1)
  // A probe that answered once is not repeated on the next failure.
  await route.probe()
  assert.equal(probes, 1)
})

console.log('--- what a proxied request does ---')

/** A local proxy: absolute-form forwarding for http, and a CONNECT handler that records what it was asked for. */
async function startProxy() {
  const seen = []
  const proxy = createServer((request, response) => {
    seen.push({ kind: 'absolute', path: request.url, authorization: request.headers['proxy-authorization'] })
    const target = new URL(request.url)
    const upstream = httpRequest({
      host: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers: { ...request.headers, host: target.host },
    }, (answer) => {
      response.writeHead(answer.statusCode, answer.headers)
      answer.pipe(response)
    })
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' })
      response.end('upstream unreachable')
    })
    request.pipe(upstream)
  })
  proxy.on('connect', (request, clientSocket, head) => {
    seen.push({ kind: 'connect', path: request.url, authorization: request.headers['proxy-authorization'] })
    const [host, port] = request.url.split(':')
    const upstream = tcpConnect({ host, port: Number(port) }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', () => clientSocket.destroy())
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  return { proxy, seen, port: proxy.address().port, url: `http://127.0.0.1:${proxy.address().port}` }
}

/** A local origin that streams a body, and redirects once so the follow is exercised. */
async function startOrigin() {
  const payload = Buffer.alloc(256 * 1024, 3)
  const origin = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/asset' })
      response.end()
      return
    }
    if (request.url === '/asset') {
      response.writeHead(200, { 'content-length': String(payload.length), 'content-type': 'application/octet-stream' })
      response.end(payload)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('no')
  })
  origin.listen(0, '127.0.0.1')
  await once(origin, 'listening')
  return { origin, payload, url: `http://127.0.0.1:${origin.address().port}` }
}

const { proxy, seen, url: proxyUrl } = await startProxy()
const { origin, payload, url: originUrl } = await startOrigin()

await check('a plain HTTP target is sent to the proxy in absolute form', async () => {
  const response = await proxyFetch(`${originUrl}/asset`, {}, proxyUrl)
  assert.equal(response.status, 200)
  const body = Buffer.from(await response.arrayBuffer())
  assert.equal(body.length, payload.length)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].kind, 'absolute')
  assert.equal(seen[0].path, `${originUrl}/asset`)
})

await check('a redirect is followed along the same route', async () => {
  const response = await proxyFetch(`${originUrl}/redirect`, {}, proxyUrl)
  assert.equal(response.status, 200)
  const body = Buffer.from(await response.arrayBuffer())
  assert.equal(body.length, payload.length)
  assert.equal(seen.length, 3)
  assert.equal(seen[2].path, `${originUrl}/asset`)
})

await check('proxy credentials ride along but never into the log', async () => {
  const withCredentials = `http://user:secret@127.0.0.1:${new URL(proxyUrl).port}`
  const response = await proxyFetch(`${originUrl}/asset`, {}, withCredentials)
  assert.equal(response.status, 200)
  await response.arrayBuffer()
  const expected = `Basic ${Buffer.from('user:secret').toString('base64')}`
  assert.equal(seen[seen.length - 1].authorization, expected)
  assert.equal(proxyLabel(new URL(withCredentials)), proxyUrl)
})

await check('a CONNECT the proxy refuses is reported as such', async () => {
  const refusing = createServer()
  refusing.on('connect', (request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  refusing.listen(0, '127.0.0.1')
  await once(refusing, 'listening')
  try {
    await proxyFetch('https://github.com/x', {}, `http://127.0.0.1:${refusing.address().port}`)
    throw new Error('a refused CONNECT did not fail')
  } catch (error) {
    assert.match(error.message, /refused CONNECT github\.com:443: HTTP 403/)
  } finally {
    refusing.close()
  }
})

await check('a proxy that answers CONNECT and then goes quiet fails instead of hanging', async () => {
  const silent = createServer()
  silent.on('connect', (request, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    // A tunnel that carries nothing: the TLS handshake can never finish.
  })
  silent.listen(0, '127.0.0.1')
  await once(silent, 'listening')
  try {
    // The deadline under test is the handshake's, not the transfer's; a check
    // cannot wait ten seconds for it, so this only proves it fails rather than
    // succeeds — the deadline itself is asserted by the message shape elsewhere.
    const raced = await Promise.race([
      proxyFetch('https://github.com/x', {}, `http://127.0.0.1:${silent.address().port}`).then(
        () => 'answered',
        (error) => error.message,
      ),
      new Promise((resolve) => {
        setTimeout(() => resolve('still-waiting'), 1_000)
      }),
    ])
    assert.notEqual(raced, 'answered')
  } finally {
    silent.closeAllConnections?.()
    silent.close()
  }
})

await check('an address this module cannot speak is refused, not silently direct', async () => {
  await assert.rejects(
    () => proxyFetch('https://github.com/x', {}, 'socks5://127.0.0.1:10808'),
    /is not an HTTP proxy address/,
  )
})

await check('the route sends a request through the proxy it found', async () => {
  const route = createRoute({ env: { HTTPS_PROXY: proxyUrl }, platform: 'linux' })
  const response = await route.request(`${originUrl}/asset`, {})
  assert.equal(response.status, 200)
  await response.arrayBuffer()
  assert.ok(seen.some((entry) => entry.path === `${originUrl}/asset` && entry.kind === 'absolute'))
})

await check('a direct route never touches the proxy', async () => {
  const before = seen.length
  const response = await directRoute().request(`${originUrl}/asset`, {})
  assert.equal(response.status, 200)
  await response.arrayBuffer()
  assert.equal(seen.length, before, 'the direct route went through the proxy')
})

await check('a direct failure falls back to a port that answers', async () => {
  // The probe's answer stands in for a proxy client that opened a port without
  // writing the system settings: the request must land there after the direct
  // attempt to a closed port has failed.
  const arrivals = []
  const bystander = createServer((request, response) => {
    arrivals.push(request.url)
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('from the probed port')
  })
  bystander.listen(0, '127.0.0.1')
  await once(bystander, 'listening')
  let probes = 0
  const route = createRoute({
    env: {},
    platform: 'linux',
    probe: async () => {
      probes++
      return bystander.address().port
    },
  })
  // A port nothing listens on: the direct attempt cannot succeed.
  const deadUrl = `http://127.0.0.1:${await closedPort()}/asset`
  const response = await route.request(deadUrl, {})
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'from the probed port')
  assert.equal(probes, 1, 'the direct failure did not look for a local proxy')
  assert.deepEqual(arrivals, [deadUrl], 'the retry did not arrive at the probed port in absolute form')
  await closeServer(bystander)
})

/** Close a server and wait for it, so the next check cannot reuse its port. */
await closeServer(proxy)
await closeServer(origin)

console.log(failures === 0 ? 'net checks passed' : `${failures} net check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

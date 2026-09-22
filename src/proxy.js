/**
 * A loopback reverse proxy in front of the gateway, which is what makes an
 * embedded console usable inside DeepSeek Harness' desktop shell.
 *
 * The desktop shell serves its document from `dsh-app://app`, so an iframe onto
 * `http://127.0.0.1:<gateway>` is a cross-site frame: the browser keeps neither
 * new-api's `SameSite=Strict` refresh cookie nor its session-hint cookie, and
 * the dashboard holds its 15-minute access token in memory only. Straight
 * embedding therefore lands on the sign-in page on every reload.
 *
 * The proxy closes that gap without weakening new-api's session design: it owns
 * one gateway session server-side (a real login, then the gateway's own refresh
 * rotation), answers the embedded console's refresh call from it, and forwards
 * every other request unchanged. The browser never needs a cookie, and the
 * gateway still authenticates every call.
 *
 * The session it owns belongs to **the account the person signs in with**: the
 * console is served from this origin, so the proxy sees that login request and
 * adopts both its credentials and its session. It never signs in on its own
 * initiative with an account nobody chose.
 *
 * It listens on the loopback interface only, on an OS-assigned port.
 * @module dsh-newapi/proxy
 */
import { createServer, request as httpRequest } from 'node:http'

/** The gateway endpoint the proxy answers from its own session. */
const REFRESH_PATH = '/api/user/auth/refresh'

/** The login the proxy learns the console's account from. */
const LOGIN_PATH = '/api/user/login'

/** The logout that ends the remembered account, because signing out must stick. */
const LOGOUT_PATH = '/api/user/auth/logout'

/** Largest login body the proxy will buffer to read the account from. */
const LOGIN_BODY_LIMIT = 64 * 1024

/** Cookie the gateway issues on a successful login; its presence proves success. */
const REFRESH_COOKIE = 'new_api_refresh'

/**
 * Session-hint cookie carrying the constant "1" and no credential (the gateway
 * documents forging it as costing only a round trip). Relaxing its SameSite
 * lets a cross-site frame keep it, so the dashboard's public pages do not
 * short-circuit to anonymous before asking the server.
 */
const SESSION_HINT_COOKIE = 'new_api_has_session'

/** Request path without its query string. */
function pathOf(request) {
  return (request.url ?? '/').split('?')[0]
}

/** Rebuild one `Set-Cookie` value with the hint cookie's SameSite relaxed. */
function relaxHintCookie(value) {
  if (!value.startsWith(`${SESSION_HINT_COOKIE}=`)) return value
  if (!/;\s*SameSite=Strict/i.test(value)) return value
  return value.replace(/;\s*SameSite=Strict/i, '; SameSite=None; Secure')
}

/** Response headers with every `Set-Cookie` mapped, hint cookies relaxed. */
function relayHeaders(headers) {
  const next = { ...headers }
  const cookies = headers['set-cookie']
  if (cookies !== undefined) next['set-cookie'] = cookies.map(relaxHintCookie)
  return next
}

/** Collect a request body up to `limit`, or `undefined` when it is larger. */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        resolve(undefined)
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    request.on('error', reject)
  })
}

/**
 * Start the console proxy.
 * @param options - gateway root, the persisted console account, a writer for it, and call logging.
 * @returns the proxy root URL, a disposer, and a reader for the account in use.
 */
export function startConsoleProxy(options) {
  const { target, loadAccount, saveAccount, log } = options
  const authority = new URL(target)
  /** The gateway session this proxy owns; `undefined` until someone signs in. */
  let session
  /** The account whose credentials were last seen signing in through this proxy. */
  let account = loadAccount()

  async function signIn(credentials) {
    const response = await fetch(`${target}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
      redirect: 'manual',
    })
    const body = await response.json().catch(() => undefined)
    const cookies = response.headers.getSetCookie?.() ?? []
    if (!body?.success || !cookies.some((value) => value.startsWith(`${REFRESH_COOKIE}=`))) {
      throw new Error(`sign-in failed for ${credentials.username}: ${body?.message ?? `HTTP ${response.status}`}`)
    }
    session = { cookies }
    return body.data
  }

  /** Persist the remembered account without letting a write failure break a request. */
  function remember(next) {
    account = next
    Promise.resolve(saveAccount?.(next)).catch((error) => {
      log(`could not persist the console account: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** Adopt the session and credentials of a login the console just performed. */
  function adopt(requestBody, cookies) {
    if (requestBody !== undefined) {
      try {
        const payload = JSON.parse(requestBody.toString('utf8'))
        const username = typeof payload?.username === 'string' ? payload.username : undefined
        if (username !== undefined && typeof payload.password === 'string') {
          remember({ username, password: payload.password })
          log(`console account remembered: ${username}`)
        } else if (username !== undefined && payload.password_encrypted !== undefined) {
          // The gateway's optional password encryption hides the password from
          // this origin, so the session is all the proxy can carry forward.
          log(`console account seen: ${username} (its password is encrypted in transit and is not stored)`)
        }
      } catch {
        // A body the proxy cannot read is not a reason to refuse the login.
      }
    }
    if (cookies.some((value) => value.startsWith(`${REFRESH_COOKIE}=`))) session = { cookies }
  }

  /** Forget the console account; signing out through the console must stick. */
  function forget() {
    session = undefined
    remember(undefined)
  }

  /** Call the gateway's own refresh with the held cookies, adopting any rotation. */
  async function rotate(expectedSid) {
    const headers = { cookie: session.cookies.join('; ') }
    if (typeof expectedSid === 'string' && expectedSid !== '') headers['x-auth-session'] = expectedSid
    const response = await fetch(`${target}${REFRESH_PATH}`, { method: 'POST', headers, redirect: 'manual' })
    const rotated = response.headers.getSetCookie?.() ?? []
    if (rotated.length > 0) session.cookies = rotated
    // The hint cookie is this endpoint's to issue, so it must ride our answer to
    // the frame rather than a response the browser would have dropped.
    const hint = rotated.map(relaxHintCookie).find((value) => value.startsWith(`${SESSION_HINT_COOKIE}=`))
    return { status: response.status, body: await response.text(), hint }
  }

  /** One refresh answer for the embedded console, restoring the remembered account if needed. */
  let pending
  function refresh(expectedSid) {
    if (pending === undefined) {
      pending = (async () => {
        if (session === undefined && account?.password !== undefined) {
          try {
            await signIn(account)
          } catch (error) {
            log(`could not restore the console session: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        if (session === undefined) {
          // Nobody has signed in yet, so the console shows its own sign-in page.
          return { status: 401, body: JSON.stringify({ success: false, message: 'no console session yet' }) }
        }
        const result = await rotate(expectedSid)
        if (result.status === 401 && account?.password !== undefined) {
          session = undefined
          await signIn(account)
          return rotate(expectedSid)
        }
        return result
      })().finally(() => {
        pending = undefined
      })
    }
    return pending
  }

  function forward(request, response, body) {
    const path = pathOf(request)
    const headers = { ...request.headers, host: authority.host }
    if (body !== undefined) {
      delete headers['transfer-encoding']
      headers['content-length'] = String(body.length)
    }
    const upstream = httpRequest(
      { hostname: authority.hostname, port: authority.port, path: request.url, method: request.method, headers },
      (upstreamResponse) => {
        if (path === LOGIN_PATH) adopt(body, upstreamResponse.headers['set-cookie'] ?? [])
        response.writeHead(upstreamResponse.statusCode ?? 502, relayHeaders(upstreamResponse.headers))
        upstreamResponse.pipe(response)
      },
    )
    upstream.on('error', (error) => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(`gateway unreachable: ${error.message}`)
    })
    if (body === undefined) request.pipe(upstream)
    else upstream.end(body)
  }

  const server = createServer((request, response) => {
    const path = pathOf(request)
    if (request.method === 'POST' && path === REFRESH_PATH) {
      refresh(request.headers['x-auth-session'])
        .then((result) => {
          const headers = {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          }
          if (result.hint !== undefined) headers['set-cookie'] = result.hint
          response.writeHead(result.status, headers)
          response.end(result.body)
        })
        .catch((error) => {
          log(`console session refresh failed: ${error instanceof Error ? error.message : String(error)}`)
          response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ success: false, message: 'gateway session unavailable' }))
        })
      return
    }
    if (request.method === 'POST' && path === LOGIN_PATH) {
      readBody(request, LOGIN_BODY_LIMIT)
        .then((body) => {
          forward(request, response, body)
        })
        .catch(() => {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('unreadable login request')
        })
      return
    }
    if (request.method === 'POST' && path === LOGOUT_PATH) {
      response.once('finish', () => {
        if (response.statusCode === 200) forget()
      })
      forward(request, response, undefined)
      return
    }
    forward(request, response, undefined)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        /** The account the console is signed in with, for the panel to report. */
        account: () => account,
        /** Replace the remembered account, so a password that just changed is the one it signs in with. */
        remember,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.()
            server.close(() => {
              done()
            })
          }),
      })
    })
  })
}

/**
 * The plugin's browser-facing route family: what the sidebar panel reads about
 * the local gateway, and the writes it performs — handing over the first-run
 * settings that decide the port and the root password of an instance that does
 * not exist yet, asking the running gateway's current model list to be
 * advertised to DeepSeek Harness again, and asking a boot that gave up to run
 * once more. Every route is refused unless the request passes DeepSeek Harness'
 * own browser-trust fence.
 */
import { SETUP_BODY_LIMIT, parseSetupRequest } from './setup.js'

/** Exact paths the panel fetches, mirrored in the client bundle. */
export const ROUTES = {
  status: '/api/dsh-newapi/status',
  setup: '/api/dsh-newapi/setup',
  sync: '/api/dsh-newapi/sync',
  retry: '/api/dsh-newapi/retry',
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
}

function writeJson(response, status, body) {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(body))
}

/** IPv4 127/8 predicate (four decimal octets, first === 127). */
function isIPv4Loopback(address) {
  const parts = address.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

/** Loopback socket address or `::1` / IPv4-mapped loopback. */
function isLoopbackAddress(address) {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7))
  return isIPv4Loopback(normalized)
}

/**
 * Loopback-only fallback fence: a loopback socket address AND a loopback Host
 * header, plus browser same-origin markers. The socket address is authoritative;
 * `X-Forwarded-For` is never trusted.
 */
function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  const host = request.headers?.host
  if (typeof host !== 'string') return false
  let authority
  try {
    authority = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (authority.hostname !== 'localhost' && authority.hostname !== '[::1]' && !isIPv4Loopback(authority.hostname)) {
    return false
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === authority.host
  } catch {
    return false
  }
}

/**
 * Whether this request may read the gateway facts. The Connection service owns
 * the Harness browser-trust decision (Host/Origin checks plus browser-session
 * authentication); a composition that mounts no Connection falls back to the
 * loopback-only fence rather than trusting the request.
 * @param ctx - host plugin context.
 * @param request - the incoming HTTP request.
 * @returns true only when the request passed a fence.
 */
function isTrusted(ctx, request) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection', false) : undefined
  if (connection && typeof connection.requestRejection === 'function') {
    return connection.requestRejection(request) === undefined
  }
  return isLoopbackRequest(request)
}

/**
 * Collect a request body, or `undefined` when it grew past `limit` — which is
 * all the reading a two-field form needs, and all an unauthenticated local route
 * should ever buffer.
 */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        request.resume()
        resolve(undefined)
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
 * Build the route family for `ctx.webServer.register`.
 * @param ctx - host plugin context carrying the optional Connection service.
 * @param readFacts - supplies the current gateway facts.
 * @param configure - applies accepted settings, resolving with `{accepted}` for a first run, `{applied}` for a running gateway, or `{error, status}`.
 * @param syncModels - re-reads the running gateway's models and advertises them again, resolving with `{provider}` or `{error, status}`.
 * @param retryStart - runs the boot again after it gave up, resolving with `{started}` or `{error, status}`.
 * @returns one exact route per entry of {@link ROUTES}.
 */
export function makeRoutes(
  ctx,
  readFacts,
  configure,
  syncModels,
  retryStart = () => ({ error: 'this plugin has no bootstrap to retry', status: 409 }),
) {
  return [
    {
      kind: 'exact',
      path: ROUTES.status,
      handler: (request, response) => {
        if (!isTrusted(ctx, request)) {
          writeJson(response, 403, { error: 'forbidden' })
          return
        }
        if (request.method !== 'GET') {
          writeJson(response, 405, { error: `method not allowed: ${request.method}` })
          return
        }
        writeJson(response, 200, readFacts())
      },
    },
    {
      kind: 'exact',
      path: ROUTES.setup,
      handler: (request, response) => {
        if (!isTrusted(ctx, request)) {
          writeJson(response, 403, { error: 'forbidden' })
          return
        }
        if (request.method !== 'POST') {
          writeJson(response, 405, { error: `method not allowed: ${request.method}` })
          return
        }
        readBody(request, SETUP_BODY_LIMIT)
          .then(async (body) => {
            if (body === undefined) {
              writeJson(response, 413, { error: 'the request body is too large' })
              return
            }
            let payload
            try {
              payload = JSON.parse(body.toString('utf8'))
            } catch {
              writeJson(response, 400, { error: 'the request body is not JSON' })
              return
            }
            const parsed = parseSetupRequest(payload)
            if (parsed.error !== undefined) {
              writeJson(response, 400, { error: parsed.error })
              return
            }
            let result
            try {
              result = await configure(parsed.settings)
            } catch (error) {
              writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
              return
            }
            if (result?.error !== undefined) {
              writeJson(response, result.status ?? 409, { error: result.error })
              return
            }
            // A first run only starts the gateway and answers 202; a running one
            // has already applied the change by the time it answers.
            writeJson(response, result?.accepted === true ? 202 : 200, result)
          })
          .catch(() => {
            writeJson(response, 400, { error: 'the request body could not be read' })
          })
      },
    },
    {
      kind: 'exact',
      path: ROUTES.sync,
      handler: (request, response) => {
        if (!isTrusted(ctx, request)) {
          writeJson(response, 403, { error: 'forbidden' })
          return
        }
        if (request.method !== 'POST') {
          writeJson(response, 405, { error: `method not allowed: ${request.method}` })
          return
        }
        // No body at all: the gateway and the model configuration are the
        // inputs, and both live on this side of the fence.
        Promise.resolve()
          .then(() => syncModels())
          .then((result) => {
            if (result?.error !== undefined) {
              writeJson(response, result.status ?? 409, { error: result.error })
              return
            }
            writeJson(response, 200, result)
          })
          .catch((error) => {
            writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
          })
      },
    },
    {
      kind: 'exact',
      path: ROUTES.retry,
      handler: (request, response) => {
        if (!isTrusted(ctx, request)) {
          writeJson(response, 403, { error: 'forbidden' })
          return
        }
        if (request.method !== 'POST') {
          writeJson(response, 405, { error: `method not allowed: ${request.method}` })
          return
        }
        // No body: the cause is on this side, and a person who has just fixed it
        // has nothing to describe. The answer says whether a boot was started —
        // an attempt already in flight is a refusal, not a second gateway.
        Promise.resolve()
          .then(() => retryStart())
          .then((result) => {
            if (result?.error !== undefined) {
              writeJson(response, result.status ?? 409, { error: result.error })
              return
            }
            writeJson(response, 202, result)
          })
          .catch((error) => {
            writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
          })
      },
    },
  ]
}

import { randomBytes } from 'node:crypto'

/** Minimum accepted by the gateway's account password policy. */
const GENERATED_PASSWORD_BYTES = 24

/** One JSON request against the gateway's management API. */
async function api(baseUrl, path, options = {}) {
  const { method = 'GET', token, body, headers: extra, timeoutMs = 20000 } = options
  const headers = { Accept: 'application/json', ...extra }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${method} ${path} answered ${response.status} with a non-JSON body: ${text.slice(0, 200)}`)
  }
  if (parsed.success === false) {
    throw new Error(`${method} ${path} failed: ${parsed.message || parsed.code || response.status}`)
  }
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}`)
  return parsed.data
}

/** A random password that satisfies the gateway's 8..128 character policy. */
function generatePassword() {
  return randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url')
}

/** Confirm a stored token still authenticates, returning the models it can reach. */
export async function verifyGatewayToken(baseUrl, token, timeoutMs = 10000) {
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return undefined
    const body = await response.json()
    return Array.isArray(body?.data) ? body.data.map((entry) => entry.id) : undefined
  } catch {
    return undefined
  }
}

/** Reuse the token of `name`, or create it, then read back its plaintext key. */
async function ensureToken(baseUrl, accessToken, name) {
  const page = await api(baseUrl, '/api/token/?p=1&page_size=100', { token: accessToken })
  let existing = page?.items?.find((entry) => entry.name === name)
  if (!existing) {
    await api(baseUrl, '/api/token/', {
      method: 'POST',
      token: accessToken,
      body: {
        name,
        remain_quota: 0,
        unlimited_quota: true,
        expired_time: -1,
        model_limits_enabled: false,
        model_limits: '',
        allow_ips: '',
        group: '',
        cross_group_retry: false,
      },
    })
    const refreshed = await api(baseUrl, '/api/token/?p=1&page_size=100', { token: accessToken })
    existing = refreshed?.items?.find((entry) => entry.name === name)
  }
  if (!existing) throw new Error(`created token ${name} but it is absent from the token list`)
  const { key } = await api(baseUrl, `/api/token/${existing.id}/key`, { method: 'POST', token: accessToken })
  if (!key) throw new Error(`token ${name} returned no key`)
  return key
}

/**
 * Replace the root account's password with the credential this harness already
 * holds. The gateway authorizes a password change with a single-use proof bound
 * to the session that asked for it, and rejects the change outright when the
 * account has a second factor enrolled — that refusal is the gateway's to make,
 * and it is reported rather than worked around. Every session is invalidated by
 * the change, so the console signs in again.
 * @param options - gateway root, root username, the password in use, and the one to set.
 */
export async function changeGatewayRootPassword(options) {
  const { baseUrl, rootUsername, currentPassword, nextPassword } = options
  const login = await api(baseUrl, '/api/user/login', {
    method: 'POST',
    body: { username: rootUsername, password: currentPassword },
  })
  const accessToken = login?.access_token
  if (!accessToken) throw new Error('login returned no access token')
  const proof = await api(baseUrl, '/api/verify', {
    method: 'POST',
    token: accessToken,
    body: { method: 'password', scope: 'account.password.change', password: currentPassword },
  })
  const proofToken = proof?.proof_token
  if (!proofToken) throw new Error('the gateway issued no security proof for the password change')
  await api(baseUrl, '/api/user/self', {
    method: 'PUT',
    token: accessToken,
    headers: { 'X-Security-Proof': proofToken },
    body: { password: nextPassword, original_password: currentPassword },
  })
}

/**
 * Make the gateway usable without a browser: complete the first-run setup when
 * it has not run yet, log in as the root account, and obtain the API token that
 * clients such as Claude Code and DeepSeek Harness authenticate with.
 * @param options - gateway root, root username, token name, an already known root password, and a stored token.
 * @returns the usable token, the root password that produced it, and the reachable model ids.
 */
export async function provisionGateway(options) {
  const { baseUrl, rootUsername, tokenName, knownPassword, storedToken } = options
  if (storedToken) {
    const models = await verifyGatewayToken(baseUrl, storedToken)
    if (models) return { token: storedToken, password: knownPassword, models }
  }

  const setup = await api(baseUrl, '/api/setup')
  let password = knownPassword
  if (!setup?.status) {
    password = password || generatePassword()
    await api(baseUrl, '/api/setup', {
      method: 'POST',
      body: {
        username: rootUsername,
        password,
        confirmPassword: password,
        SelfUseModeEnabled: true,
        DemoSiteEnabled: false,
      },
    })
  } else if (!password) {
    throw new Error(
      `the New API instance at ${baseUrl} is already initialised and this harness has no stored credential for it. ` +
        'Set `rootPassword` on the newapi plugin row, or point `dataDir` at a fresh directory.',
    )
  }

  const login = await api(baseUrl, '/api/user/login', {
    method: 'POST',
    body: { username: rootUsername, password },
  })
  const accessToken = login?.access_token
  if (!accessToken) throw new Error('login returned no access token')
  const token = await ensureToken(baseUrl, accessToken, tokenName)
  const models = (await verifyGatewayToken(baseUrl, token)) ?? []
  return { token, password, models }
}

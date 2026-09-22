/**
 * The first-run settings the browser panel collects before this plugin has ever
 * provisioned a gateway: the port it should listen on and the password its root
 * account is created with. Deciding whether they are still needed, and checking
 * a submission, lives here so the boot path and the route family share one rule.
 * @module dsh-newapi/setup
 */

/**
 * new-api's own account password policy, in characters rather than bytes
 * (`common.MinAccountPasswordLength` / `MaxAccountPasswordLength`).
 */
export const MIN_PASSWORD_CHARS = 8
export const MAX_PASSWORD_CHARS = 128

/** Largest TCP port a listener can be asked for. */
const MAX_PORT = 65535

/** Largest first-run body the route reads; a legitimate one is two short fields. */
export const SETUP_BODY_LIMIT = 8 * 1024

/**
 * Whether this run must ask for the first-run settings before it can start.
 *
 * Once they have been answered — by the panel, or by `rootPassword` on the
 * plugin row, or by an earlier version of this plugin that provisioned the
 * instance and stored the credential it used — the question is never asked
 * again: what the panel collects can only be honoured while the root account
 * does not exist yet.
 * @param config - effective plugin configuration.
 * @param stored - the persisted `.dsh-gateway.json`, or `{}`.
 * @returns true when nothing has answered the first-run question yet.
 */
export function needsFirstRunSetup(config, stored) {
  if (stored.setupCompleted === true) return false
  if (config.rootPassword !== undefined) return false
  return stored.rootPassword === undefined && stored.token === undefined
}

/**
 * Check one submission from the panel. The gateway enforces the same password
 * policy when it creates the account; checking it here turns a late refusal into
 * an immediate one, and a bad port into a refusal instead of a failed start. A
 * submission without a password keeps the one in use, which is how an instance
 * that is already running changes only its port.
 * @param payload - the parsed JSON body.
 * @returns the accepted settings, or the reason they were refused.
 */
export function parseSetupRequest(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'the request body must be a JSON object' }
  }
  const { port, rootPassword } = payload
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    return { error: `port must be an integer between 1 and ${MAX_PORT}` }
  }
  if (rootPassword === undefined) return { settings: { port } }
  if (typeof rootPassword !== 'string') return { error: 'rootPassword must be a string' }
  // Counted in characters, exactly as the gateway counts the password it accepts.
  const length = [...rootPassword].length
  if (length < MIN_PASSWORD_CHARS || length > MAX_PASSWORD_CHARS) {
    return { error: `rootPassword must be between ${MIN_PASSWORD_CHARS} and ${MAX_PASSWORD_CHARS} characters` }
  }
  return { settings: { port, rootPassword } }
}

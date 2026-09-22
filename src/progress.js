/**
 * What the panel is told while the gateway is not up yet: which step of the boot
 * is running, how far a download has got, and — when an attempt failed — a
 * classified reason the panel turns into advice.
 *
 * The browser half mirrors the names in this module, so a phase, a step, or a
 * hint kind is a contract rather than an internal detail. Anything a person
 * reads is written on the panel side; this module only reports facts.
 * @module dsh-newapi/progress
 */

import { join } from 'node:path'

/**
 * The boot's phases, in the order they are entered.
 *
 * - `idle`: nothing has been asked for yet (a first run waits for the form).
 * - `preparing`: finding or fetching a runnable gateway binary.
 * - `downloading`: streaming the release asset; the only phase with byte counts.
 * - `starting`: the child is spawned and `/api/status` is being polled.
 * - `provisioning`: the instance is being initialised and its token created.
 * - `retrying`: an attempt failed and the next one is scheduled.
 * - `ready`: the gateway answers and the panel shows its console.
 * - `failed`: the attempts are spent; the panel shows why and offers a retry.
 */
export const PHASE = {
  idle: 'idle',
  preparing: 'preparing',
  downloading: 'downloading',
  starting: 'starting',
  provisioning: 'provisioning',
  retrying: 'retrying',
  ready: 'ready',
  failed: 'failed',
}

/**
 * The finer step inside `preparing`, so the panel can say what is happening
 * without guessing from a byte counter.
 */
export const STEP = {
  local: 'local',
  route: 'route',
  manifest: 'manifest',
  download: 'download',
  verify: 'verify',
}

/**
 * How a failed attempt is explained. `unknown` is the honest answer when no
 * sign matches, and the panel then shows the raw cause alone.
 */
export const HINT = {
  network: 'network',
  checksum: 'checksum',
  port: 'port',
  gateway: 'gateway',
  timeout: 'timeout',
  unknown: 'unknown',
}

/** The plain file name the data directory is searched for on this platform. */
export function dropInName(platform = process.platform) {
  return platform === 'win32' ? 'new-api.exe' : 'new-api'
}

/**
 * A fresh progress record. One is created per plugin row and mutated in place:
 * the panel polls it, so replacing it would only make the reads racy.
 * @param attempts - how many bootstrap attempts one round makes.
 * @returns the record the status route hands to the panel.
 */
export function makeProgress(attempts) {
  return {
    phase: PHASE.idle,
    attempt: 0,
    attempts,
    /** When the current attempt began, so the panel can show how long it has been. */
    since: undefined,
    /** When the next attempt starts, while the phase is `retrying`. */
    retryAt: undefined,
    /** The finer step inside `preparing`. */
    step: undefined,
    /**
     * The route this attempt's network use takes: which proxy, if any, and where
     * that answer came from. A download that failed can then say which way it
     * already tried, which is the difference between advice and a guess.
     */
    route: undefined,
    /** The asset being streamed, while the phase is `downloading`. */
    download: undefined,
    /** The binary this run settled on, once one was resolved. */
    binary: undefined,
    /** The raw cause of the last failed attempt. */
    error: undefined,
    /** The classified form of that cause. */
    hint: undefined,
  }
}

/**
 * Start one attempt: clear what the previous one left behind, so the panel never
 * shows a stale byte count or a cause that has been superseded.
 * @param progress - the record to mutate.
 * @param attempt - 1-based attempt number.
 */
export function beginAttempt(progress, attempt) {
  progress.phase = PHASE.preparing
  progress.attempt = attempt
  progress.since = new Date().toISOString()
  progress.retryAt = undefined
  progress.step = STEP.local
  progress.route = undefined
  progress.download = undefined
  progress.binary = undefined
  progress.error = undefined
  progress.hint = undefined
}

/**
 * Fold one streaming report into the record.
 *
 * The speed is smoothed rather than taken from the last chunk: a progress bar
 * read by a person should not jump because one read landed late. The estimate is
 * only reported while a total is known and the stream is moving.
 * @param progress - the record to mutate.
 * @param event - `{ asset, version, url, cacheDir, receivedBytes, totalBytes }`.
 */
export function trackDownload(progress, event) {
  const now = Date.now()
  const previous = progress.download
  // A count that went backwards is a retry that started the same URL again: it is
  // a new stream, and averaging it into the old one would report a negative speed.
  const sameStream =
    previous !== undefined && previous.url === event.url && event.receivedBytes >= previous.receivedBytes
  const elapsed = sameStream ? (now - previous.sampledAt) / 1000 : 0
  const instant = elapsed > 0.2 ? (event.receivedBytes - previous.receivedBytes) / elapsed : undefined
  const smoothed = instant === undefined
    ? previous?.bytesPerSecond
    : previous?.bytesPerSecond === undefined
      ? instant
      : previous.bytesPerSecond * 0.6 + instant * 0.4
  const total = Number.isFinite(event.totalBytes) && event.totalBytes > 0 ? event.totalBytes : undefined
  progress.phase = PHASE.downloading
  progress.step = STEP.download
  progress.download = {
    asset: event.asset,
    version: event.version,
    url: event.url,
    cacheDir: event.cacheDir,
    receivedBytes: event.receivedBytes,
    totalBytes: total,
    bytesPerSecond: smoothed,
    etaSeconds:
      total !== undefined && smoothed !== undefined && smoothed > 0
        ? Math.max(0, Math.round((total - event.receivedBytes) / smoothed))
        : undefined,
    startedAt: sameStream ? previous.startedAt : new Date().toISOString(),
    sampledAt: now,
  }
}

/**
 * Network failures, as `describeError` spells them: undici wraps everything as a
 * bare `fetch failed` and puts the real cause in the chain, so the sign has to
 * match any link of it. A proxy this plugin spoke to itself names the failure its
 * own way — a refused `CONNECT`, or an address it cannot use at all — and both
 * belong here rather than in "something nobody has seen before".
 */
const NETWORK_SIGNS =
  /fetch failed|ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET|socket hang up|getaddrinfo|TLS|certificate|refused CONNECT|is not an HTTP proxy/i

/**
 * Which kind of failure a boot ended with, from the message alone.
 * @param message - the described cause chain.
 * @returns one of {@link HINT}.
 */
export function classifyFailure(message) {
  const text = message ?? ''
  if (/checksum verification/i.test(text)) return HINT.checksum
  if (/no free port/i.test(text)) return HINT.port
  if (/exited with code|was killed by signal|signal SIG/.test(text)) return HINT.gateway
  // The gateway's own words for "it never came up": anything else that merely
  // failed to answer in time is a network problem, not a gateway one.
  if (/did not answer .*\/api\/status/.test(text)) return HINT.timeout
  if (NETWORK_SIGNS.test(text)) return HINT.network
  return HINT.unknown
}

/**
 * The facts a panel needs to turn a classified failure into advice it can give
 * in its own words: where the binary belongs, what it is called, the release it
 * could not be fetched from, and the route that was already tried.
 * @param options - effective configuration, directories, resolved version, and the route in use.
 * @returns the facts, with `undefined` for anything this platform cannot name.
 */
export function failureFacts(options) {
  const { downloadBaseUrl, dataDir, cacheDir, version, asset, route } = options
  const name = dropInName()
  return {
    dataDir,
    cacheDir,
    version,
    asset,
    route,
    dropInName: name,
    // The path is spelled on this side: the panel may well be rendering in a
    // browser on another machine, and only the Host knows which separator the
    // directory it would write to uses.
    dropInPath: join(dataDir, name),
    releaseUrl: asset === undefined ? undefined : `${downloadBaseUrl}/${version}/${asset}`,
  }
}

/**
 * The classified cause as one record: the facts plus the kind, so the panel can
 * pick a headline and a list of ways out without knowing this file.
 * @param kind - one of {@link HINT}.
 * @param facts - the output of {@link failureFacts}.
 * @param extra - anything only this failure knows, such as the port it wanted.
 * @returns the hint carried in the status payload.
 */
export function failureHint(kind, facts, extra = {}) {
  return { kind, ...facts, ...extra }
}

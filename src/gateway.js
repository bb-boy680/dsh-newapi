import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

/** Retained output per stream; enough for a startup diagnosis without buffering the whole log. */
const COLLECT_BYTES = 64 * 1024

/**
 * Ask a URL whether a New API gateway is already serving there.
 * @param baseUrl - gateway root, without a trailing slash.
 * @param timeoutMs - per-attempt bound.
 * @returns the `/api/status` payload, or `undefined` when nothing answers.
 */
export async function probeGateway(baseUrl, timeoutMs = 2000) {
  try {
    const response = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return undefined
    const body = await response.json()
    return body?.success ? body.data : undefined
  } catch {
    return undefined
  }
}

/** True when a TCP listener can be bound to the port on the loopback interface. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

/** First free port at or above `preferred`, bounded so a wrong port cannot scan the range. */
async function pickPort(preferred, attempts = 20) {
  for (let port = preferred; port < preferred + attempts; port++) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`no free port in ${preferred}..${preferred + attempts - 1} for the New API gateway`)
}

/** Collected output of both streams, for diagnosing a failed start. */
function collectedTail(handle) {
  const parts = []
  for (const stream of ['stderr', 'stdout']) {
    const text = handle.collected?.[stream]?.readFrom(0).text.trim()
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

/** Poll readiness until the gateway answers or the child exits. */
async function waitForReady(baseUrl, timeoutMs, handle) {
  const deadline = Date.now() + timeoutMs
  const exited = handle.done.then(
    (outcome) => ({ outcome }),
    (error) => ({ error }),
  )
  while (Date.now() < deadline) {
    const raced = await Promise.race([exited, delay(500).then(() => undefined)])
    if (raced) {
      // The child is gone; let the provider drain its collected pipes before reading them.
      await handle.waitForExit().catch(() => {})
      const detail = collectedTail(handle)
      const cause = raced.error
        ? `could not be started: ${raced.error}`
        : `exited with code ${raced.outcome.exitCode} signal ${raced.outcome.signal}`
      throw new Error(`New API ${cause}${detail ? `\n${detail}` : ''}`)
    }
    if (await probeGateway(baseUrl, 2000)) return
  }
  throw new Error(`New API did not answer ${baseUrl}/api/status within ${timeoutMs}ms`)
}

/**
 * Make one gateway available: adopt an instance already listening on the
 * preferred port, otherwise start the binary as a managed child on the first
 * free port and wait until it answers.
 * @param options - subprocess context, binary, data directory, child environment, port, and timeout.
 * @returns the gateway root, its port, whether it was adopted, and a stop function.
 */
export async function adoptOrStartGateway(options) {
  const { ctx, binaryPath, dataDir, env, preferredPort, readyTimeoutMs } = options
  const adoptedUrl = `http://127.0.0.1:${preferredPort}`
  if (await probeGateway(adoptedUrl)) {
    return { baseUrl: adoptedUrl, port: preferredPort, adopted: true, stop: async () => {} }
  }

  const port = await pickPort(preferredPort)
  const baseUrl = `http://127.0.0.1:${port}`
  await mkdir(dataDir, { recursive: true })
  const executable = await ctx.subprocess.resolveExecutable(binaryPath)
  const handle = ctx.subprocess.spawn({
    argv: [executable],
    cwd: dataDir,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: COLLECT_BYTES },
      stderr: { maxBytes: COLLECT_BYTES },
    },
    graceMs: 10_000,
    env: { ...env, PORT: String(port) },
  })
  // A gateway that never answers must not outlive the attempt: the port would
  // stay taken, and a caller that retries the boot would end up running two.
  try {
    await waitForReady(baseUrl, readyTimeoutMs, handle)
  } catch (error) {
    handle.terminate()
    await handle.waitForExit().catch(() => {})
    throw error
  }
  return {
    baseUrl,
    port,
    adopted: false,
    stop: async () => {
      handle.terminate()
      await handle.waitForExit().catch(() => {})
    },
  }
}

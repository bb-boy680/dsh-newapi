import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { createRoute, routeFacts } from './net.js'
import { STEP } from './progress.js'

/**
 * How often a streaming download reports its byte count. Frequent enough that
 * the panel's progress bar moves, rare enough that a 128 MB transfer does not
 * spend its time allocating records.
 */
const PROGRESS_INTERVAL_MS = 250

/** Release asset name for one platform, as published by the upstream release workflow. */
export function releaseAsset(platform, arch, version) {
  if (platform === 'win32') {
    if (arch !== 'x64') throw new Error(`new-api publishes no Windows build for ${arch}`)
    return `new-api-${version}.exe`
  }
  if (platform === 'darwin') return `new-api-macos-${version}`
  if (platform === 'linux') return arch === 'arm64' ? `new-api-arm64-${version}` : `new-api-${version}`
  throw new Error(`new-api publishes no build for platform ${platform}`)
}

/** Checksum manifest published beside the release assets. */
export function checksumAsset(platform) {
  if (platform === 'win32') return 'checksums-windows.txt'
  if (platform === 'darwin') return 'checksums-macos.txt'
  return 'checksums-linux.txt'
}

/** Parse the `sha256 *filename` manifest into a filename → digest map. */
export function parseChecksums(text) {
  const digests = new Map()
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (match) digests.set(match[2], match[1])
  }
  return digests
}

/** SHA-256 of a file, or `undefined` when it does not exist. */
async function fileDigest(path) {
  const hash = createHash('sha256')
  try {
    await pipeline(createReadStream(path), async function* (source) {
      for await (const chunk of source) hash.update(chunk)
    })
  } catch {
    return undefined
  }
  return hash.digest('hex')
}

/**
 * Stream one URL into `target` while hashing it; the file lands only after a
 * complete body. The byte count is reported as it moves, because this is the one
 * step of a first install that takes minutes and a panel that cannot say so
 * looks like a plugin that does not work.
 * @param url - the asset to fetch.
 * @param target - the file to write.
 * @param onProgress - called with `{ step, url, receivedBytes, totalBytes }`.
 * @param route - the route to send the request along.
 * @returns the sha256 of the bytes written.
 */
async function download(url, target, onProgress, route) {
  const response = await route.request(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  // A release host that answers with a chunked body states no total; the panel
  // then shows the bytes received without a bar it cannot fill honestly.
  const stated = response.headers.get('content-length')
  const totalBytes = stated === null ? undefined : Number(stated)
  const hash = createHash('sha256')
  let receivedBytes = 0
  let reportedAt = 0
  const report = () => {
    onProgress?.({ step: STEP.download, url, receivedBytes, totalBytes })
  }
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      async function* (source) {
        for await (const chunk of source) {
          receivedBytes += chunk.length
          hash.update(chunk)
          const now = Date.now()
          if (now - reportedAt >= PROGRESS_INTERVAL_MS) {
            reportedAt = now
            report()
          }
          yield chunk
        }
      },
      createWriteStream(target),
    )
  } catch (error) {
    await rm(target, { force: true })
    throw error
  }
  report()
  return hash.digest('hex')
}

/**
 * The pause before each retry of a network step, in milliseconds. Exported
 * because the schedule is part of what this module promises its caller, and a
 * check shortens it to watch a round of attempts finish.
 */
export const NETWORK_RETRY_DELAY_MS = [1_000, 2_000]

/** Retry a network step a bounded number of times; the release host is occasionally unreachable. */
async function withRetry(attempts, step) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await step()
    } catch (error) {
      last = error
      if (attempt < attempts) await delay(NETWORK_RETRY_DELAY_MS[attempt - 1] ?? 1_000 * attempt)
    }
  }
  throw last
}

/**
 * Turn the configured release selector into a concrete tag. `latest` asks the
 * GitHub API, which only a GitHub release base can answer for.
 * @param version - a release tag, or `latest`.
 * @param downloadBaseUrl - the release download prefix the tag will be fetched from.
 * @param options - an optional `route` and `onProgress`; both default to the ones a plain boot uses.
 * @returns the release tag to download.
 * @throws {Error} when `latest` is asked of a base that cannot resolve it.
 */
export async function resolveReleaseVersion(version, downloadBaseUrl, options = {}) {
  if (version !== 'latest') return version
  const host = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/?$/.exec(downloadBaseUrl)
  if (!host) {
    throw new Error('newapi: version "latest" needs a GitHub downloadBaseUrl (https://github.com/<owner>/<repo>/releases/download); pin a release tag instead')
  }
  const route = options.route ?? createRoute()
  options.onProgress?.({ step: STEP.route, route: routeFacts(await route.resolve()) })
  const url = `https://api.github.com/repos/${host[1]}/${host[2]}/releases/latest`
  const response = await withRetry(3, () =>
    route.request(url, { redirect: 'follow', headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-newapi' } }),
  )
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  const tag = (await response.json())?.tag_name
  if (typeof tag !== 'string' || tag === '') throw new Error(`${url} returned no release tag`)
  return tag
}

/**
 * Files tried before any download, most specific first: what an operator dropped
 * into the data directory, then the binary the download cache already holds. The
 * list stays short and its locations are ones an operator can predict, because
 * everything on it is executed as found.
 * @param options - release tag, data directory, cache directory, and platform overrides.
 * @returns candidate paths, each naming the source it belongs to.
 */
export function localBinaryCandidates(options) {
  const { version, dataDir, cacheDir } = options
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const asset = releaseAsset(platform, arch, version)
  const plain = platform === 'win32' ? 'new-api.exe' : 'new-api'
  return [
    { path: join(dataDir, plain), source: 'data directory' },
    { path: join(dataDir, asset), source: 'data directory' },
    { path: join(cacheDir, asset), source: 'release cache' },
  ]
}

/**
 * Produce a runnable gateway binary without preferring the network: a file this
 * machine already has wins, and the release download runs only when none is
 * usable. A hand-placed binary is used as it stands, so its digest is reported
 * rather than trusted silently — but a file that a manifest already on disk
 * contradicts is skipped, and only bytes fetched over the network must prove
 * themselves against a manifest before they are executed.
 * @param options - release tag, download base, data directory, cache directory, platform overrides,
 *                  and an optional `route` and `onProgress` for the panel.
 * @returns the absolute path, where it came from, and the digest a local file carried; a download
 *          reports no digest because the manifest it was checked against already named it.
 */
export async function resolveGatewayBinary(options) {
  const { cacheDir, onProgress } = options
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const route = options.route ?? createRoute()
  const asset = releaseAsset(platform, arch, options.version)
  const listed = await cachedDigest(join(cacheDir, checksumAsset(platform)), asset)
  for (const candidate of localBinaryCandidates(options)) {
    const digest = await fileDigest(candidate.path)
    if (digest === undefined) continue
    onProgress?.({ step: STEP.local, path: candidate.path, source: candidate.source })
    if (listed !== undefined && digest !== listed) continue
    await makeExecutable(candidate.path, platform)
    // A file a manifest already on disk agrees with has been verified as surely
    // as a download has, and the panel says so the same way.
    if (listed !== undefined) {
      onProgress?.({ step: STEP.verify, path: candidate.path, digest, source: candidate.source })
    }
    return { path: candidate.path, source: candidate.source, digest, verified: listed !== undefined }
  }
  return {
    path: await ensureGatewayBinary({ ...options, route }),
    source: 'download',
    digest: undefined,
    verified: true,
  }
}

/**
 * Produce a runnable gateway binary for this machine by downloading the official
 * release and verifying it against the published checksum manifest. A cached
 * binary whose digest still matches is reused without touching the network.
 * @param options - release tag, download base, destination cache, platform overrides, and an
 *                  optional `route` and `onProgress` for the panel.
 * @returns absolute path of the verified binary.
 */
export async function ensureGatewayBinary(options) {
  const { version, downloadBaseUrl, cacheDir, onProgress } = options
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const route = options.route ?? createRoute()
  const asset = releaseAsset(platform, arch, version)
  const binaryPath = join(cacheDir, asset)
  const manifestPath = join(cacheDir, checksumAsset(platform))
  const manifestUrl = `${downloadBaseUrl}/${version}/${checksumAsset(platform)}`
  const assetUrl = `${downloadBaseUrl}/${version}/${asset}`
  // The streaming layer reports bytes and a URL; the panel needs to name the file
  // those bytes belong to, and this is the only layer that knows which asset it
  // asked for.
  const report = onProgress === undefined ? undefined : (event) => onProgress({ ...event, asset, version })
  await mkdir(cacheDir, { recursive: true })
  // Which way out this machine has is a fact the panel shows before the first
  // byte: "downloading through the proxy in the Windows settings" is a very
  // different situation from "downloading directly", and only one of them is
  // worth waiting out on a machine that cannot reach the release host.
  onProgress?.({ step: STEP.route, route: routeFacts(await route.resolve()) })

  // Two attempts so a manifest cached from a re-uploaded release cannot wedge
  // the install: the mismatch drops both the binary and the manifest, and the
  // second pass fetches the manifest the release host is serving now.
  for (let attempt = 1; ; attempt++) {
    const expected = await expectedDigest(manifestPath, manifestUrl, asset, report, route)
    const cached = await fileDigest(binaryPath)
    if (cached === expected) {
      report?.({ step: STEP.verify, path: binaryPath, digest: cached, source: 'release cache' })
      await makeExecutable(binaryPath, platform)
      return binaryPath
    }
    // Reported before the first byte so the panel can name the file it is about
    // to spend minutes on, and switch to the download phase immediately.
    report?.({ step: STEP.download, url: assetUrl, receivedBytes: 0, totalBytes: undefined })
    const actual = await withRetry(3, () => download(assetUrl, binaryPath, report, route))
    if (actual === expected) {
      await makeExecutable(binaryPath, platform)
      return binaryPath
    }
    await rm(binaryPath, { force: true })
    await rm(manifestPath, { force: true })
    if (attempt >= 2) {
      throw new Error(`${asset} failed checksum verification: the release host lists ${expected} but serves ${actual}`)
    }
  }
}

/** The digest a manifest already on disk lists for one asset, without touching the network. */
async function cachedDigest(manifestPath, asset) {
  try {
    return parseChecksums(await readFile(manifestPath, 'utf8')).get(asset)
  } catch {
    return undefined
  }
}

/** The digest the release host lists for one asset, cached beside the binaries. */
async function expectedDigest(manifestPath, manifestUrl, asset, onProgress, route) {
  const cached = await cachedDigest(manifestPath, asset)
  if (cached) return cached
  onProgress?.({ step: STEP.manifest, url: manifestUrl })
  const response = await withRetry(3, () => route.request(manifestUrl, { redirect: 'follow' }))
  if (!response.ok) throw new Error(`GET ${manifestUrl} failed with ${response.status}`)
  const text = await response.text()
  const published = parseChecksums(text).get(asset)
  if (!published) throw new Error(`${manifestUrl} lists no digest for ${asset}`)
  await writeFile(manifestPath, text)
  return published
}

async function makeExecutable(path, platform) {
  if (platform !== 'win32') await chmod(path, 0o755)
}

/** Atomically replace a small text file. */
export async function writeTextAtomic(path, text) {
  const partial = `${path}.partial`
  await writeFile(partial, text)
  await rename(partial, path)
}

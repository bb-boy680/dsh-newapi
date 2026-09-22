import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Resolve the DeepSeek Harness home: an explicit path wins, then `$DSH_HOME`,
 * then `~/.dsh`. A blank `$DSH_HOME` is treated as unset.
 * @param explicit - configured home, when the plugin row supplies one.
 * @returns absolute harness home.
 */
export function resolveDshHome(explicit) {
  if (explicit) return resolve(explicit)
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim() !== '') return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

/**
 * Directory holding the gateway's SQLite database, logs, and provisioning state.
 * @param home - harness home.
 * @param configured - explicit `dataDir` from the plugin row.
 * @returns absolute data directory.
 */
export function resolveDataDir(home, configured) {
  return configured ? resolve(configured) : join(home, 'newapi')
}

/**
 * Download cache for release binaries, keyed by release tag so two versions
 * never share a path.
 * @param home - harness home.
 * @param version - release tag such as `v1.0.0-rc.39`.
 * @returns absolute cache directory.
 */
export function releaseCacheDir(home, version) {
  return join(home, 'cache', 'newapi', version)
}

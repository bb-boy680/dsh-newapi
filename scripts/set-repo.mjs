/**
 * Point the package metadata at the GitHub repository this checkout pushes to,
 * read from `origin`. `npm publish --provenance` refuses to run unless
 * `repository.url` names the repository that produced the artifact, and a
 * hard-coded guess would be worse than no field at all, so the value is derived
 * here — and an origin that is not a GitHub remote stops the release instead of
 * publishing metadata that points nowhere.
 *
 * Run from this package with: node scripts/set-repo.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'package.json')

const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
const host = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(origin)
if (!host) throw new Error(`[dsh-newapi] origin is not a GitHub remote: ${origin}`)

const url = `https://github.com/${host[1]}/${host[2]}`
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.homepage = `${url}#readme`
manifest.repository = { type: 'git', url: `git+${url}.git` }
manifest.bugs = { url: `${url}/issues` }
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[dsh-newapi] package metadata points at ${host[1]}/${host[2]}`)

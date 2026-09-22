/**
 * Build the browser half into the one artifact the Harness client module system
 * serves: `lib/client.js`, a lazy-CJS factory that registers itself on
 * `window.__ModuleLoader__`. `react` and its JSX runtime stay external because
 * the page's module table supplies them; everything else is bundled.
 *
 * Run from this package with: bun run build:client
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outfile = join(root, 'lib/client.js')

const result = await Bun.build({
  entrypoints: [join(root, 'src/client/index.jsx')],
  target: 'browser',
  format: 'cjs',
  external: ['react', 'react-dom/client', 'react/jsx-runtime'],
  // The page's module table supplies the production JSX runtime only, so the
  // dev transform must not be selected.
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: false,
})
if (!result.success) {
  for (const message of result.logs) console.error(message)
  process.exit(1)
}

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const body = await result.outputs[0].text()
const indented = body
  .split('\n')
  .map((line) => (line === '' ? '' : `\t\t${line}`))
  .join('\n')

await mkdir(dirname(outfile), { recursive: true })
await writeFile(
  outfile,
  [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(manifest.name)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    indented,
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n'),
)
console.log(`[dsh-newapi] wrote ${outfile} (${body.length} bytes of module body)`)

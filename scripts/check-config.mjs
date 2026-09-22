/**
 * The plugin ships no dependencies, so nothing validates a plugin row before
 * `apply` sees it: these cases pin the defaults a silent row receives and the
 * refusals that keep a misspelled row from starting a gateway nobody described.
 *
 * Run from this package with: node scripts/check-config.mjs
 */
import assert from 'node:assert/strict'
import { resolveConfig } from '../index.js'

let failures = 0
const check = (label, run) => {
  try {
    run()
    console.log(`  ${label.padEnd(46)}: ok`)
  } catch (error) {
    failures++
    console.log(`  ${label.padEnd(46)}: FAILED (${error.message})`)
  }
}
const defaults = resolveConfig(undefined)

check('a row that declares nothing gets the defaults', () => {
  assert.equal(defaults.enabled, true)
  assert.equal(defaults.version, 'v1.0.0-rc.39')
  assert.equal(defaults.port, 3000)
  assert.equal(defaults.rootUsername, 'root')
  assert.equal(defaults.tokenName, 'dsh')
  assert.equal(defaults.readyTimeoutMs, 120000)
  assert.match(defaults.downloadBaseUrl, /^https:\/\/github\.com\//)
  assert.equal(defaults.rootPassword, undefined)
  assert.equal(defaults.dataDir, undefined)
})

check('the model configuration is published by default', () => {
  assert.equal(defaults.publishProvider, true)
  assert.equal(defaults.providerName, 'new-api')
  assert.equal(defaults.providerDisplayName, 'New API')
  assert.equal(defaults.providerApiKeyRef, 'NEW_API_KEY')
  assert.equal(defaults.providerContextWindow, 131072)
  assert.equal(defaults.providerMaxTokens, 32768)
  assert.equal(defaults.providerReasoningEfforts, 'off,low,medium,high,xhigh,max')
  // No model is named as accepting images until a source says so — the gateway's
  // own model tags or the harness' catalogs — and a model nothing describes takes
  // image input, because the gateway serves the models its operator added.
  assert.equal(defaults.providerImageModels, '')
  assert.equal(defaults.providerDefaultInput, 'text,image')
})

check('the input types an undescribed model gets are read from the row', () => {
  assert.equal(resolveConfig({ providerDefaultInput: 'text' }).providerDefaultInput, 'text')
  // Empty declares nothing, which hands the model back to pi-ai's text floor.
  assert.equal(resolveConfig({ providerDefaultInput: '' }).providerDefaultInput, '')
  assert.throws(() => resolveConfig({ providerDefaultInput: 'audio' }), /audio.*not an input type/)
  assert.throws(() => resolveConfig({ providerDefaultInput: 1 }), /config\.providerDefaultInput must be a string/)
})

check('the models accepting images are read from the row', () => {
  assert.equal(resolveConfig({ providerImageModels: 'glm-5.3,mimo-v2.6-pro' }).providerImageModels, 'glm-5.3,mimo-v2.6-pro')
  // A route-wide claim, for a gateway whose upstreams are all vision-capable.
  assert.equal(resolveConfig({ providerImageModels: '*' }).providerImageModels, '*')
  assert.equal(resolveConfig({ providerImageModels: '' }).providerImageModels, '')
  // A name with whitespace inside is commas typed as spaces.
  assert.throws(() => resolveConfig({ providerImageModels: 'glm-5.3 mimo-v2.6-pro' }), /whitespace.*separate model ids with commas/)
  assert.throws(() => resolveConfig({ providerImageModels: 5 }), /config\.providerImageModels must be a string/)
})

check('a thinking level nobody offers is refused where the row is read', () => {
  assert.throws(() => resolveConfig({ providerReasoningEfforts: 'off,ultra' }), /ultra.*not a thinking level/)
  assert.throws(() => resolveConfig({ providerReasoningEfforts: 'high;low' }), /high;low/)
  // Every level New API's own parser knows is nameable here.
  assert.equal(
    resolveConfig({ providerReasoningEfforts: 'off,low,medium,high,xhigh,max' }).providerReasoningEfforts,
    'off,low,medium,high,xhigh,max',
  )
  // An empty value is a choice, not a typo: these upstreams ignore the parameter.
  assert.equal(resolveConfig({ providerReasoningEfforts: '' }).providerReasoningEfforts, '')
})

check('the model configuration can be pointed elsewhere or switched off', () => {
  const config = resolveConfig({
    publishProvider: false,
    providerName: 'gateway',
    providerDisplayName: 'Gateway',
    providerApiKeyRef: 'MY_GATEWAY_KEY',
    providerContextWindow: 200000,
    providerMaxTokens: 8192,
    providerReasoningEfforts: 'off,high',
  })
  assert.deepEqual(
    [config.publishProvider, config.providerName, config.providerDisplayName, config.providerApiKeyRef],
    [false, 'gateway', 'Gateway', 'MY_GATEWAY_KEY'],
  )
  assert.deepEqual([config.providerContextWindow, config.providerMaxTokens], [200000, 8192])
  assert.equal(config.providerReasoningEfforts, 'off,high')
})

check('a model-configuration value of the wrong type is refused', () => {
  assert.throws(() => resolveConfig({ publishProvider: 'yes' }), /config\.publishProvider must be a boolean/)
  assert.throws(() => resolveConfig({ providerContextWindow: '128k' }), /config\.providerContextWindow must be a number/)
})

check('a row overrides one field without disturbing the rest', () => {
  const config = resolveConfig({ port: 4321, rootPassword: 'secret' })
  assert.equal(config.port, 4321)
  assert.equal(config.rootPassword, 'secret')
  assert.equal(config.version, defaults.version)
})

check('a misspelled key is refused', () => {
  assert.throws(() => resolveConfig({ prot: 3000 }), /unknown config key\(s\) prot/)
})

check('a value of the wrong type is refused', () => {
  assert.throws(() => resolveConfig({ port: '3000' }), /config\.port must be a number/)
  assert.throws(() => resolveConfig({ enabled: 'no' }), /config\.enabled must be a boolean/)
})

check('the refusals name the accepted keys', () => {
  assert.throws(() => resolveConfig({ nope: 1 }), /expected any of enabled, version, binaryPath, port, dataDir, dshHome/)
})

console.log(failures === 0 ? 'config checks passed' : `${failures} config check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

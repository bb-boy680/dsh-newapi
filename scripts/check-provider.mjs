/**
 * Model-configuration checks: what one gateway contributes to DeepSeek Harness'
 * own model configuration, and the order the two writes happen in.
 *
 * The seams are stubs here — `smoke.mjs` runs the same path against a real
 * gateway — but the profile stored under `llm-pi-ai` is exactly what the web
 * Models page writes by hand, and a route that names the wrong protocol, address,
 * or reference is silently unreachable or silently broken in the composer.
 * Nothing here may put the gateway token into the settings document: that
 * document is served to every configuration surface.
 *
 * The thinking levels are the second half of that: they are what the composer's
 * effort selector lists, and only a level spelled the way the gateway's request
 * parser accepts it survives the trip upstream.
 *
 * The modalities are the third: New API reports none, so what the row claims is
 * the whole answer, and a claim the route does not carry is an image the harness
 * refuses before it can be attached.
 *
 * The capacities are the fourth, and the reason they are stated per model at all:
 * New API reports no token limit either, so a model the harness' own catalogs
 * describe has to carry the limit its id implies rather than the route's one
 * guess — a 1M-token model declared at 131072 loses context it could have held.
 * The same asymmetry decides the other half: a model no catalog describes keeps
 * the number the route already states for it, because a write that dropped it
 * would silently hand that model back to the guess.
 *
 * Run from this package with: node scripts/check-provider.mjs
 */
import assert from 'node:assert/strict'
import {
  parseDefaultInput,
  parseImageModels,
  parseModelAliases,
  parseReasoningEfforts,
  providerProfile,
  publishGatewayProvider,
} from '../src/llmprovider.js'
import {
  MODEL_ALIASES,
  catalogEntry,
  readCatalogModels,
  readTaggedModels,
  resolveAliasedCapacities,
  resolveCapacities,
  resolveImageModels,
  resolveModelAliases,
  tagsAcceptImages,
} from '../src/modalities.js'

let failures = 0
const check = async (label, run) => {
  try {
    await run()
    console.log(`  ${label.padEnd(52)}: ok`)
  } catch (error) {
    failures++
    console.log(`  ${label.padEnd(52)}: FAILED (${error.message})`)
  }
}

const TOKEN = 'a1b2c3d4'.repeat(6)
const gateway = {
  route: 'new-api',
  apiKeyRef: 'NEW_API_KEY',
  displayName: 'New API',
  baseUrl: 'http://127.0.0.1:3000',
  token: TOKEN,
  models: ['deepseek-chat', 'gpt-4o-mini'],
  contextWindow: 131072,
  maxTokens: 32768,
  efforts: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
}

/** A recording pair of seams, optionally refusing one of the writes. */
function seams(options = {}) {
  const calls = { credentials: [], settings: [] }
  return {
    calls,
    credentials: {
      set: async (ref, value) => {
        calls.credentials.push([ref, value])
        if (options.refuseCredential === true) throw new Error('the reference is shadowed by the environment')
      },
    },
    settings: {
      // The resolved view the plugin reads back before it writes, so a capacity
      // the route already states is carried instead of dropped. `stored` names the
      // model rows that view holds; `noDescribe` is a composition whose settings
      // seam mounts no reader, and `unreadable` one whose document cannot be read
      // — either must cost the carried numbers and nothing else.
      ...options.noDescribe === true
        ? {}
        : {
            describe: () => {
              if (options.unreadable === true) throw new Error('the settings document cannot be read')
              return [{ ns: 'llm-pi-ai', value: { providers: { 'new-api': { models: options.stored ?? [] } } } }]
            },
          },
      update: async (ns, patch) => {
        calls.settings.push([ns, patch])
        if (options.refuseSettings === true) throw new Error('the adapter refused the route')
      },
    },
  }
}

await check('the route names the OpenAI-compatible surface under /v1', () => {
  const profile = providerProfile(gateway)
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.baseURL, 'http://127.0.0.1:3000/v1')
})

await check('the key is referenced, never written into the profile', () => {
  const profile = providerProfile(gateway)
  assert.equal(profile.apiKeyEnv, 'NEW_API_KEY')
  assert.equal(JSON.stringify(profile).includes(TOKEN), false)
})

await check('every model the gateway serves is listed, and nothing else', () => {
  const profile = providerProfile(gateway)
  assert.deepEqual(profile.models.map((model) => model.id), ['deepseek-chat', 'gpt-4o-mini'])
})

await check('every model offers the configured thinking levels', () => {
  const profile = providerProfile(gateway)
  const expected = { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
  for (const model of profile.models) assert.deepEqual(model.reasoningEfforts, expected, model.id)
})

await check('the route thinks nothing by default and names its dispatch format', () => {
  const profile = providerProfile(gateway)
  // `off` is the resting state, and the wire format is named outright because a
  // declared route has no catalog entry to infer it from.
  assert.equal(profile.reasoning, 'off')
  assert.deepEqual(profile.compat, {
    supportsDeveloperRole: false,
    thinkingFormat: 'openai',
    supportsReasoningEffort: true,
  })
})

await check('the system prompt goes out as system, whatever the levels are', () => {
  // pi-ai guesses compatibility from the address, and its guess is an
  // OpenAI-hosted endpoint: it sends the system prompt as `developer` whenever the
  // model reasons, which an upstream behind the gateway answers with
  // 422 `unknown variant 'developer'`.
  for (const efforts of [[], ['low'], ['off', 'high']]) {
    const profile = providerProfile({ ...gateway, efforts })
    assert.equal(profile.compat.supportsDeveloperRole, false, JSON.stringify(efforts))
  }
})

await check('an empty level set declares no reasoning at all', () => {
  const profile = providerProfile({ ...gateway, efforts: [] })
  assert.deepEqual(profile.models.map((model) => model.id), ['deepseek-chat', 'gpt-4o-mini'])
  assert.equal('reasoningEfforts' in profile.models[0], false)
  assert.equal('reasoning' in profile, false)
  // The compat profile stays: it carries the system-role fact, which has nothing
  // to do with whether a level is offered.
  assert.deepEqual(profile.compat, { supportsDeveloperRole: false })
})

await check('a level set without off takes no resting effort', () => {
  const profile = providerProfile({ ...gateway, efforts: ['low', 'high'] })
  assert.equal('reasoning' in profile, false)
  assert.deepEqual(profile.models[0].reasoningEfforts, { low: 'low', high: 'high' })
})

await check('the offered levels are read from the row, in order and once', () => {
  assert.deepEqual(parseReasoningEfforts('off,low,medium,high,xhigh,max'), ['off', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(parseReasoningEfforts(' high , low '), ['high', 'low'])
  assert.deepEqual(parseReasoningEfforts('off,off'), ['off'])
  // An empty value is how a deployment says "my upstreams ignore the parameter".
  assert.deepEqual(parseReasoningEfforts(''), [])
  assert.throws(() => parseReasoningEfforts('off,ultra'), /ultra.*not a thinking level/)
})

await check('a model is text-only until the row says otherwise', () => {
  const profile = providerProfile(gateway)
  // Absent, not `['text']`: an entry that declares nothing keeps the route's
  // default, and restating the floor would pin a value nobody chose.
  for (const model of profile.models) assert.equal('input' in model, false, model.id)
})

await check('a named model declares image input beside text', () => {
  const profile = providerProfile({ ...gateway, imageModels: ['gpt-4o-mini'] })
  assert.deepEqual(profile.models[0].input, undefined)
  assert.deepEqual(profile.models[1].input, ['text', 'image'])
})

await check('the plugin row is read as a claim: named, route-wide, and withheld', () => {
  assert.deepEqual(parseImageModels('glm-5.3, mimo-v2.6-pro '), { all: false, include: ['glm-5.3', 'mimo-v2.6-pro'], exclude: [] })
  assert.deepEqual(parseImageModels('same,same'), { all: false, include: ['same'], exclude: [] })
  assert.deepEqual(parseImageModels(''), { all: false, include: [], exclude: [] })
  assert.deepEqual(parseImageModels('*'), { all: true, include: [], exclude: [] })
  // A leading `!` withholds one model, which is how a catalog claim the operator
  // disagrees with is corrected from the row.
  assert.deepEqual(parseImageModels('*,!glm-5.3'), { all: true, include: [], exclude: ['glm-5.3'] })
  assert.deepEqual(parseImageModels('!nope'), { all: false, include: [], exclude: ['nope'] })
})

await check('the models that got the claim are reported back', async () => {
  const stub = seams()
  const published = await publishGatewayProvider({ ...gateway, imageModels: ['gpt-4o-mini'], ...stub })
  assert.deepEqual(published.imageModels, ['gpt-4o-mini'])
})

await check('a model the gateway does not serve is never declared', async () => {
  const stub = seams()
  await publishGatewayProvider({ ...gateway, imageModels: ['gpt-4o'], ...stub })
  // The route is still published: the gateway's own list changes as channels are
  // added, and one stale name must not cost the whole route.
  assert.deepEqual(stub.calls.settings.length, 1)
  for (const model of stub.calls.settings[0][1].providers['new-api'].models) assert.equal('input' in model, false, model.id)
})

await check('capacities and the label ride on the route', () => {
  const profile = providerProfile(gateway)
  assert.equal(profile.displayName, 'New API')
  assert.equal(profile.defaultContextWindow, 131072)
  assert.equal(profile.defaultMaxTokens, 32768)
})

await check('a catalog capacity lands on the model, not on the whole route', () => {
  const profile = providerProfile({
    ...gateway,
    capacities: new Map([
      ['deepseek-chat', { contextWindow: 1000000, maxTokens: 384000 }],
      ['gpt-4o-mini', { maxTokens: 16384 }],
    ]),
  })
  // The model whose id states a 1M window carries it; the route keeps its guess
  // for the models nothing describes.
  assert.deepEqual(profile.models[0], {
    id: 'deepseek-chat',
    contextWindow: 1000000,
    maxTokens: 384000,
    reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  })
  // Half a statement is still a statement: the context window stays the route's.
  assert.equal('contextWindow' in profile.models[1], false)
  assert.equal(profile.models[1].maxTokens, 16384)
})

await check('an output cap above the model’s window is lowered to it', () => {
  const profile = providerProfile({
    ...gateway,
    capacities: new Map([['deepseek-chat', { contextWindow: 8192, maxTokens: 384000 }]]),
  })
  // pi-ai reads the two as independent ceilings, so a pair that contradicts
  // itself would admit a request the model cannot satisfy.
  assert.equal(profile.models[0].contextWindow, 8192)
  assert.equal(profile.models[0].maxTokens, 8192)
})

await check('only a model a catalog describes carries a capacity', () => {
  const catalog = new Map([
    ['known', catalogEntry(['text'], 1000000, 384000)],
    ['partial', catalogEntry(['text'], undefined, undefined)],
  ])
  assert.deepEqual([...resolveCapacities(catalog, ['known', 'partial', 'nothing'])], [
    ['known', { contextWindow: 1000000, maxTokens: 384000 }],
  ])
  assert.deepEqual([...resolveCapacities(new Map(), ['nothing'])], [])
})

await check('the published result names the models that took a catalog capacity', async () => {
  const stub = seams()
  const published = await publishGatewayProvider({
    ...gateway,
    capacities: new Map([['deepseek-chat', { contextWindow: 1000000, maxTokens: 384000 }]]),
    ...stub,
  })
  assert.deepEqual(published.capacities, [{ id: 'deepseek-chat', contextWindow: 1000000, maxTokens: 384000 }])
  assert.deepEqual(published.carriedCapacities, [])
})

await check('a capacity the route already states survives the sync', async () => {
  // The case this exists for: the gateway serves a relay's own model id, no
  // installed catalog describes it, and the number a person typed for it in the
  // Models page is the only answer there is. The write must not delete it — the
  // route's own fallback (131072/32768) is what an entry with no capacity gets,
  // and that is a guess about a model nobody described.
  const stub = seams({
    stored: [
      { id: 'deepseek-v4.1-flash', contextWindow: 1000000, maxTokens: 256000 },
      { id: 'retired', contextWindow: 400000, maxTokens: 64000 },
    ],
  })
  const published = await publishGatewayProvider({ ...gateway, models: ['deepseek-v4.1-flash', 'deepseek-chat'], ...stub })
  const models = stub.calls.settings[0][1].providers['new-api'].models
  assert.deepEqual(models[0], {
    id: 'deepseek-v4.1-flash',
    contextWindow: 1000000,
    maxTokens: 256000,
    reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  })
  // The model the catalogs describe still takes its own reading, and a model the
  // gateway no longer serves carries nothing: the list stays the gateway's.
  assert.deepEqual(models[1], {
    id: 'deepseek-chat',
    reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  })
  assert.deepEqual(published.carriedCapacities, [
    { id: 'deepseek-v4.1-flash', contextWindow: 1000000, maxTokens: 256000 },
  ])
  // The route's guesses are untouched: they stay the answer for the models that
  // carry nothing at all.
  assert.equal(stub.calls.settings[0][1].providers['new-api'].defaultContextWindow, 131072)
  assert.equal(stub.calls.settings[0][1].providers['new-api'].defaultMaxTokens, 32768)
})

await check('a catalog fact outranks the number the route carried', async () => {
  // Field by field, so a corrected catalog reading still lands while the half it
  // says nothing about is kept.
  const stub = seams({ stored: [{ id: 'deepseek-chat', contextWindow: 1000000, maxTokens: 128000 }] })
  const published = await publishGatewayProvider({
    ...gateway,
    capacities: new Map([['deepseek-chat', { contextWindow: 200000 }]]),
    ...stub,
  })
  assert.deepEqual(stub.calls.settings[0][1].providers['new-api'].models[0], {
    id: 'deepseek-chat',
    contextWindow: 200000,
    maxTokens: 128000,
    reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  })
  assert.deepEqual(published.carriedCapacities, [{ id: 'deepseek-chat', maxTokens: 128000 }])
})

await check('a settings seam that cannot answer costs only the carried numbers', async () => {
  for (const options of [{ noDescribe: true }, { unreadable: true }]) {
    const stub = seams(options)
    const published = await publishGatewayProvider({ ...gateway, ...stub })
    assert.deepEqual(published.carriedCapacities, [], JSON.stringify(options))
    assert.equal(stub.calls.settings.length, 1, JSON.stringify(options))
    // Nothing stated a capacity, so the same profile as before is written.
    assert.deepEqual(stub.calls.settings[0][1].providers['new-api'], providerProfile(gateway))
  }
})

await check('a model the gateway no longer serves carries nothing over', async () => {
  // The list is still the gateway's: a capacity for an id that is gone is not
  // restated, so it leaves with the model.
  const stub = seams({ stored: [{ id: 'retired', contextWindow: 1000000, maxTokens: 256000 }] })
  const published = await publishGatewayProvider({ ...gateway, ...stub })
  assert.deepEqual(published.carriedCapacities, [])
  for (const model of stub.calls.settings[0][1].providers['new-api'].models) {
    assert.equal('contextWindow' in model, false, model.id)
  }
})

await check('publishing stores the key and registers the route', async () => {
  const stub = seams()
  const published = await publishGatewayProvider({ ...gateway, ...stub })
  assert.deepEqual(published, {
    route: 'new-api',
    apiKeyRef: 'NEW_API_KEY',
    displayName: 'New API',
    models: 2,
    efforts: gateway.efforts,
    imageModels: [],
    capacities: [],
    carriedCapacities: [],
  })
  assert.deepEqual(stub.calls.credentials, [['NEW_API_KEY', TOKEN]])
  assert.equal(stub.calls.settings.length, 1)
  const [ns, patch] = stub.calls.settings[0]
  assert.equal(ns, 'llm-pi-ai')
  assert.deepEqual(patch.providers['new-api'], providerProfile(gateway))
})

await check('the settings document never carries the token', async () => {
  const stub = seams()
  await publishGatewayProvider({ ...gateway, ...stub })
  assert.equal(JSON.stringify(stub.calls.settings).includes(TOKEN), false)
})

console.log('--- which ids are another id in disguise ---')
// A gateway aggregates relays, and a relay names a model its own way: DeepSeek V4.1
// Flash arrives as `deepseek-v4.1-flash` through one channel and as `deepseek-flash`
// through another, while the catalogs know only the latter. The pairing is curated
// and stated (`providerModelAliases` outranks it), never guessed from the spelling,
// and the numbers it yields are the target's own — first sync included.

await check('the aliases are read as pairs, and a typo is refused', () => {
  assert.deepEqual([...parseModelAliases('relay-id=catalog-id')], [['relay-id', 'catalog-id']])
  assert.deepEqual([...parseModelAliases(' a = b , c=d ')], [['a', 'b'], ['c', 'd']])
  assert.deepEqual([...parseModelAliases('')], [])
  assert.throws(() => parseModelAliases('relay-id'), /not a pair.*served-id=catalog-id/)
  assert.throws(() => parseModelAliases('relay-id='), /not a pair/)
  assert.throws(() => parseModelAliases('=catalog-id'), /not a pair/)
  assert.throws(() => parseModelAliases('same=same'), /aliases "same" to itself/)
})

await check('the curated pairings are the floor, and the row outranks them', () => {
  // The one pairing the plugin states itself, because the id spells out the name
  // the DeepSeek catalog gives the model.
  assert.equal(MODEL_ALIASES.get('deepseek-v4.1-flash'), 'deepseek-flash')
  assert.deepEqual([...resolveModelAliases()], [['deepseek-v4.1-flash', 'deepseek-flash']])
  // A deployment whose upstream really is another model says so on its row.
  assert.deepEqual(
    [...resolveModelAliases(new Map([['deepseek-v4.1-flash', 'glm-5.3']]))],
    [['deepseek-v4.1-flash', 'glm-5.3']],
  )
  assert.deepEqual(
    [...resolveModelAliases(new Map([['my-relay-id', 'deepseek-v4-pro']]))],
    [['deepseek-v4.1-flash', 'deepseek-flash'], ['my-relay-id', 'deepseek-v4-pro']],
  )
})

await check('an alias lends the target its numbers, and invents nothing', () => {
  const resolved = resolveAliasedCapacities(
    new Map(),
    new Map([['deepseek-flash', { images: true, contextWindow: 1000000, maxTokens: 256000 }]]),
    resolveModelAliases(),
    ['deepseek-v4.1-flash'],
  )
  assert.deepEqual([...resolved.capacities], [['deepseek-v4.1-flash', { contextWindow: 1000000, maxTokens: 256000 }]])
  assert.deepEqual(resolved.aliased, [
    { id: 'deepseek-v4.1-flash', as: 'deepseek-flash', contextWindow: 1000000, maxTokens: 256000 },
  ])
  // An alias whose target nothing describes adds nothing: the model keeps
  // whatever the route already carries for it.
  const undescribed = resolveAliasedCapacities(new Map(), new Map(), resolveModelAliases(), ['deepseek-v4.1-flash'])
  assert.deepEqual([...undescribed.capacities], [])
  assert.deepEqual(undescribed.aliased, [])
})

await check('an id’s own entry outranks the alias, per field', () => {
  const aliases = new Map([['relay-id', 'known-id']])
  const catalog = new Map([['known-id', { contextWindow: 1000000, maxTokens: 256000 }]])
  const own = resolveAliasedCapacities(
    new Map([['relay-id', { contextWindow: 8192 }]]),
    catalog,
    aliases,
    ['relay-id'],
  )
  // The half the id states stays; the half it leaves open is filled.
  assert.deepEqual([...own.capacities], [['relay-id', { contextWindow: 8192, maxTokens: 256000 }]])
  assert.deepEqual(own.aliased, [{ id: 'relay-id', as: 'known-id', maxTokens: 256000 }])
  const nothing = resolveAliasedCapacities(
    new Map([['relay-id', { contextWindow: 1000000, maxTokens: 256000 }]]),
    catalog,
    aliases,
    ['relay-id'],
  )
  assert.deepEqual([...nothing.capacities], [['relay-id', { contextWindow: 1000000, maxTokens: 256000 }]])
  assert.deepEqual(nothing.aliased, [])
})

await check('a gateway with no models is not registered at all', async () => {
  const stub = seams()
  await assert.rejects(
    publishGatewayProvider({ ...gateway, models: [], ...stub }),
    /serves no models/,
  )
  assert.deepEqual(stub.calls.credentials, [])
  assert.deepEqual(stub.calls.settings, [])
})

await check('a refused credential stops before the route is registered', async () => {
  const stub = seams({ refuseCredential: true })
  await assert.rejects(publishGatewayProvider({ ...gateway, ...stub }), /shadowed/)
  // A route advertising models whose every request would fail on an
  // unresolvable reference is worse than no route.
  assert.deepEqual(stub.calls.settings, [])
})

await check('a refused route write is reported, not swallowed', async () => {
  const stub = seams({ refuseSettings: true })
  await assert.rejects(publishGatewayProvider({ ...gateway, ...stub }), /refused the route/)
  // The key is already stored by then; the caller reports the failure and the
  // next attempt reuses what is there.
  assert.deepEqual(stub.calls.credentials, [['NEW_API_KEY', TOKEN]])
})

console.log('--- which models accept images ---')
// Nothing on the wire states a modality, so the plugin asks the two places that
// already know and follows the gateway's own model list: the tags an operator
// sets on the model in the New API console, and the harness' installed catalogs.
// The plugin row outranks both.

await check('a New API tag is enough, in any language or case', () => {
  assert.equal(tagsAcceptImages('Tools,Files,Vision'), true)
  assert.equal(tagsAcceptImages(' vision '), true)
  assert.equal(tagsAcceptImages('多模态,免费'), true)
  assert.equal(tagsAcceptImages('图像'), true)
  // Only a whole tag counts: `image-generation` is a different claim.
  assert.equal(tagsAcceptImages('image-generation'), false)
  assert.equal(tagsAcceptImages('reasoning,vision-input'), false)
  assert.equal(tagsAcceptImages(''), false)
  assert.equal(tagsAcceptImages(undefined), false)
})

/** The ids the seam's routes serve, so `resolveModelInfo` can refuse a foreign one. */
const catalogSeamModels = ['deepseek-flash', 'deepseek-v4-pro', 'glm-5.3', 'glm-5.3-flash', 'silent']

/** A catalog seam with two honest providers, one broken, and the plugin's own route. */
const catalogSeam = (ownRoute) => ({
  listProviders: () => [{ id: 'deepseek-official' }, { id: ownRoute }, { id: 'broken' }],
  listModels: async (provider) => {
    if (provider === 'broken') throw new Error('NO_ADAPTER')
    if (provider === ownRoute) return [{ provider, id: 'own', name: 'own', inputModalities: ['text', 'image'] }]
    return [
      { provider, id: 'deepseek-flash', name: 'flash', inputModalities: ['text', 'image'] },
      { provider, id: 'deepseek-v4-pro', name: 'pro', inputModalities: ['text'] },
      { provider, id: 'glm-5.3', name: 'GLM-5.3', inputModalities: ['text'], contextWindow: 1000000, maxTokens: 131072 },
      { provider, id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', inputModalities: ['text'] },
      { provider, id: 'silent', name: 'silent' },
    ]
  },
  // The installed directory: providers this deployment never configured, whose
  // catalogs still know the models. It agrees with the listing above wherever both
  // speak, so each entry's provenance is what this check reads.
  listConfigurableProviders: () => [{ provider: 'zai', displayName: 'Z.ai', settingsNs: 'llm-pi-ai', settingsPath: [] }, { provider: ownRoute, settingsNs: 'llm-pi-ai', settingsPath: [] }],
  discoverModels: async (settingsNs, request) => {
    assert.equal(settingsNs, 'llm-pi-ai')
    if (request.provider === ownRoute) return [{ id: 'own', name: 'own', inputModalities: ['text'] }]
    return [
      { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', inputModalities: ['text', 'image'], contextWindow: 1000000, maxTokens: 384000 },
      { id: 'deepseek-flash', name: 'flash', inputModalities: ['text'], contextWindow: 1000000, maxTokens: 384000 },
    ]
  },
  // The other half of a catalog: what the owning adapter resolves for a model it
  // serves itself. Every route is asked only about its own models, which is what
  // keeps `deepseek-official`'s 1M window from being applied to a name `zai`
  // happens to share.
  resolveModelInfo: async (provider, model) => {
    assert.equal(provider, 'deepseek-official')
    assert.equal(catalogSeamModels.includes(model), true, `asked about ${model}, which this route does not serve`)
    // Only the window: `deepseek-v4-pro`'s listing stated no capacity at all, and
    // `glm-5.3` already carries both from its own entry.
    return model === 'deepseek-v4-pro' ? { context: { contextWindow: 1000000 } } : {}
  },
})

await check('the catalog source reads other routes and answers for their models', async () => {
  const answer = await readCatalogModels(
    catalogSeam('new-api'),
    ['deepseek-flash', 'deepseek-v4-pro', 'silent', 'own', 'glm-5.3', 'glm-5.3-flash'],
    'new-api',
  )
  assert.equal(answer.unavailable, undefined)
  assert.deepEqual([...answer.models], [
    // The listing and the directory both state it, and they agree.
    ['deepseek-flash', { images: true, contextWindow: 1000000, maxTokens: 384000 }],
    // Its listing disclosed no capacity; its own adapter supplied the window.
    ['deepseek-v4-pro', { images: false, contextWindow: 1000000 }],
    // The listing supplied both; the adapter, asked again, added nothing.
    ['glm-5.3', { images: false, contextWindow: 1000000, maxTokens: 131072 }],
    // The listing knows it, the directory added the image claim and the capacities.
    ['glm-5.3-flash', { images: true, contextWindow: 1000000, maxTokens: 384000 }],
    // The adapter answered nothing usable for it, so the capacity side of the
    // entry is absent while the modality side is still an answer.
    ['silent', { images: false }],
  ])
  // The plugin's own route is never consulted, or its last answer would return as
  // evidence for itself; a model a catalog stays silent about is not an answer
  // either.
  assert.equal(answer.models.has('own'), false)
  assert.equal(answer.models.has('silent'), true)
  assert.deepEqual(answer.models.get('silent'), { images: false })
})

await check('sources that disagree about a capacity resolve to the smaller one', async () => {
  // The same id stated with two different ceilings, which is what a model's own
  // catalog and a gateway's listing of it routinely do. Admitting fewer tokens is
  // the reading no endpoint rejects, so the merged entry keeps that one — in both
  // directions, and per field.
  const answer = await readCatalogModels(
    {
      listProviders: () => [{ id: 'gateway' }],
      listModels: async (provider) => [
        { provider, id: 'smaller-cap', name: 'a', inputModalities: ['text'], maxTokens: 131072 },
        { provider, id: 'smaller-window', name: 'b', inputModalities: ['text'], contextWindow: 200000 },
        { provider, id: 'image-from-adapter', name: 'c', inputModalities: ['text'] },
      ],
      listConfigurableProviders: () => [],
      resolveModelInfo: async (_provider, model) => (model === 'image-from-adapter'
        ? { context: { contextWindow: 1000000 }, defaultMaxTokens: 384000 }
        : {}),
    },
    ['smaller-cap', 'smaller-window', 'image-from-adapter'],
    'new-api',
  )
  assert.deepEqual([...answer.models], [
    ['smaller-cap', { images: false, maxTokens: 131072 }],
    ['smaller-window', { images: false, contextWindow: 200000 }],
    ['image-from-adapter', { images: false, contextWindow: 1000000, maxTokens: 384000 }],
  ])
  const conflicting = await readCatalogModels(
    {
      listProviders: () => [{ id: 'gateway' }],
      listModels: async (provider) => [
        { provider, id: 'disagreed', name: 'd', inputModalities: ['text'], contextWindow: 1000000, maxTokens: 384000 },
      ],
      listConfigurableProviders: () => [{ provider: 'zai', settingsNs: 'llm-pi-ai' }],
      discoverModels: async () => [{ id: 'disagreed', inputModalities: ['text'], contextWindow: 1000000, maxTokens: 131072 }],
    },
    ['disagreed'],
    'new-api',
  )
  assert.deepEqual([...conflicting.models], [
    ['disagreed', { images: false, contextWindow: 1000000, maxTokens: 131072 }],
  ])
})

await check('a composition without an llm service costs only the catalog source', async () => {
  const answer = await readCatalogModels(undefined, ['deepseek-flash'], 'new-api')
  assert.deepEqual([...answer.models], [])
  assert.match(answer.unavailable, /no llm service/)
})

await check('a gateway that will not answer its pricing page costs only the tag source', async () => {
  const answer = await readTaggedModels('http://127.0.0.1:1', ['deepseek-flash'], 500)
  assert.deepEqual([...answer.models], [])
  assert.match(answer.unavailable, /could not be read/)
})

await check('the row outranks the tags, the tags outrank the catalogs', () => {
  const resolved = resolveImageModels({
    models: ['named', 'tagged', 'known', 'sighted', 'unknown'],
    claim: parseImageModels('named'),
    tagged: new Set(['tagged', 'named']),
    catalog: new Map([
      ['known', catalogEntry(['text'])],
      ['tagged', catalogEntry(['text'])],
      ['sighted', catalogEntry(['text', 'image'])],
    ]),
    fallback: parseDefaultInput('text'),
  })
  assert.deepEqual(resolved.declared, ['named', 'tagged', 'sighted'])
  // `unknown` is both: nothing described it, and this row's default puts it at text.
  assert.deepEqual(resolved.textOnly, ['known', 'unknown'])
  assert.deepEqual(resolved.undescribed, ['unknown'])
  assert.deepEqual(
    [...resolved.sources],
    [
      ['named', 'plugin row'],
      ['tagged', 'New API tag'],
      ['known', 'model catalog'],
      ['sighted', 'model catalog'],
    ],
  )
  assert.deepEqual(resolved.unmatched, [])
})

await check('a model nothing describes takes the row’s default input', () => {
  const sources = { claim: parseImageModels(''), tagged: new Set(), catalog: new Map() }
  // The default: the gateway serves the models its operator added, so an
  // undescribed one takes images rather than being refused.
  const assumed = resolveImageModels({ models: ['mystery'], ...sources, fallback: parseDefaultInput('text,image') })
  assert.deepEqual(assumed.declared, ['mystery'])
  assert.deepEqual(assumed.undescribed, ['mystery'])
  assert.equal(assumed.sources.get('mystery'), 'assumed')
  // A deployment that would rather refuse can say so, including by declaring
  // nothing at all and handing the model back to pi-ai's text floor.
  const cautious = resolveImageModels({ models: ['mystery'], ...sources, fallback: parseDefaultInput('text') })
  assert.deepEqual(cautious.declared, [])
  assert.deepEqual(cautious.textOnly, ['mystery'])
  const silent = resolveImageModels({ models: ['mystery'], ...sources, fallback: parseDefaultInput('') })
  assert.deepEqual(silent.declared, [])
  assert.deepEqual(silent.textOnly, ['mystery'])
  assert.equal(parseDefaultInput('text,image').declared, true)
  assert.equal(parseDefaultInput('').declared, false)
  assert.throws(() => parseDefaultInput('text,audio'), /audio.*not an input type/)
})

await check('an exclusion withholds a model another source claims', () => {
  const resolved = resolveImageModels({
    models: ['every', 'except'],
    claim: parseImageModels('*,!except'),
    tagged: new Set(),
    catalog: new Map([['except', catalogEntry(['text', 'image'])], ['every', catalogEntry(['text'])]]),
    fallback: parseDefaultInput('text,image'),
  })
  assert.deepEqual(resolved.declared, ['every'])
  assert.deepEqual(resolved.textOnly, ['except'])
  assert.deepEqual(resolved.undescribed, [])
})

await check('a name the gateway does not serve is reported, not dropped in silence', () => {
  const resolved = resolveImageModels({
    models: ['served'],
    claim: parseImageModels('served,typo,!gone'),
    tagged: new Set(),
    catalog: new Map(),
    fallback: parseDefaultInput('text,image'),
  })
  assert.deepEqual(resolved.declared, ['served'])
  assert.deepEqual(resolved.unmatched, ['typo', 'gone'])
})

await check('an alias target is read even though this gateway does not serve it', async () => {
  // The first sync of a gateway that resells DeepSeek V4.1 Flash under the relay's
  // id: the id itself is in no catalog, the catalogs describe the model as
  // `deepseek-flash`, and only the alias makes that entry reachable — which is why
  // the target joins the read even though the gateway never advertises it.
  const aliases = resolveModelAliases()
  const served = ['deepseek-v4.1-flash']
  const answer = await readCatalogModels(catalogSeam('new-api'), [...new Set([...served, ...aliases.values()])], 'new-api')
  const stated = resolveCapacities(answer.models, served)
  // Nothing describes the served id itself, which is the whole problem.
  assert.deepEqual([...stated], [])
  const resolved = resolveAliasedCapacities(stated, answer.models, aliases, served)
  assert.deepEqual([...resolved.capacities], [['deepseek-v4.1-flash', { contextWindow: 1000000, maxTokens: 384000 }]])
  assert.deepEqual(resolved.aliased, [
    { id: 'deepseek-v4.1-flash', as: 'deepseek-flash', contextWindow: 1000000, maxTokens: 384000 },
  ])
  // The row's pairing is what a deployment whose upstream is another model uses,
  // and the numbers that travel are that target's.
  const remapped = resolveModelAliases(parseModelAliases('deepseek-v4.1-flash=glm-5.3'))
  const other = await readCatalogModels(catalogSeam('new-api'), [...new Set([...served, ...remapped.values()])], 'new-api')
  assert.deepEqual(
    resolveAliasedCapacities(resolveCapacities(other.models, served), other.models, remapped, served).aliased,
    [{ id: 'deepseek-v4.1-flash', as: 'glm-5.3', contextWindow: 1000000, maxTokens: 131072 }],
  )
})

console.log(failures === 0 ? 'provider checks passed' : `${failures} provider check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

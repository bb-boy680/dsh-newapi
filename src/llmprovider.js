/**
 * Publishing the running gateway into DeepSeek Harness' own model configuration.
 *
 * Two writes do it, and they are the same two the web Models page performs by
 * hand: the credential reference the adapter resolves per request, and the
 * provider route the settings section carries. Both seams are read live, so a
 * changed endpoint or key reaches the very next request — no restart, and no key
 * retyped anywhere.
 *
 * The gateway's own model list is the only source of truth here: a model this
 * harness' token cannot reach is never advertised in the selector.
 *
 * Request modalities cannot come from there, though: New API's OpenAI-compatible
 * list carries an id, an owner, and endpoint types, and nothing else — the
 * console's own model metadata is free-form tags a deployment may never fill in.
 * Neither can a model's capacity: no token limit is on the wire, and the model
 * metadata has no field to put one in. So both come from the installed model
 * catalogs, which describe a served model by id
 * ({@link module:dsh-newapi/modalities}), and the route's configurable guesses are
 * what a model nothing describes keeps — except for the numbers the route itself
 * already carries, which a write here keeps instead of deleting. A gateway that
 * serves a relay's own spelling of a model (`deepseek-v4.1-flash`, say) matches no
 * catalog, and the operator's answer for it is the only one there is.
 */

/** Settings namespace the pi-ai adapter owns; the Models page writes the same one. */
const PROVIDER_NS = 'llm-pi-ai'

/**
 * Wire protocol a route the installed pi-ai catalog does not ship has to name,
 * because nothing else can decide it. New API serves the OpenAI-compatible
 * surface under `/v1` for every channel it aggregates.
 */
const PROVIDER_API = 'openai-completions'

/**
 * The thinking levels this plugin may declare, in escalation order. They are
 * pi-ai's own level ids, and each is also the wire spelling New API's request
 * parser accepts for `reasoning_effort` (`relaykit/relayconvert/reasoning`), so
 * a declared level needs no translation table of its own.
 */
export const EFFORT_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Read the offered thinking levels from one plugin-row string.
 *
 * An empty value means "declare no reasoning at all", which is the only honest
 * answer for a gateway whose upstreams all ignore the parameter: pi-ai refuses a
 * profile that offers a level no model can read, and this plugin cannot ask the
 * gateway which of its models really think.
 * @param raw - comma-separated level names, in the order the selector should show.
 * @returns the levels, deduplicated and in the declared order.
 * @throws {Error} naming an unknown level.
 */
export function parseReasoningEfforts(raw) {
  const levels = raw
    .split(',')
    .map((level) => level.trim())
    .filter((level) => level.length > 0)
  const unknown = levels.filter((level) => !EFFORT_LEVELS.includes(level))
  if (unknown.length > 0) {
    throw new Error(
      `newapi: providerReasoningEfforts names ${unknown.join(', ')}, which is not a thinking level;`
      + ` expected a comma-separated subset of ${EFFORT_LEVELS.join(', ')}, or empty to offer none`,
    )
  }
  return [...new Set(levels)]
}

/**
 * The modalities a model declared to accept images offers, in pi-ai's order.
 *
 * Both, never image alone: a vision model that could not be sent text could not
 * serve a conversation, and the harness reads an entry's list as what it accepts.
 */
const IMAGE_INPUT = ['text', 'image']

/**
 * Read the models that accept images from one plugin-row string.
 *
 * The row outranks the two sources the plugin consults on its own — the gateway's
 * model tags and the harness' model catalogs — and it is the only way to answer
 * for a model neither of them knows. `*` covers every model the gateway serves,
 * and a leading `!` withholds one, which is what makes a catalog claim the
 * operator disagrees with correctable from here.
 * @param raw - comma-separated model ids, `*`, and `!`-prefixed exclusions.
 * @returns the claim: whether it covers every model, the ids it names, and the ids it withholds.
 */
export function parseImageModels(raw) {
  const tokens = [...new Set(raw.split(',').map((name) => name.trim()).filter((name) => name.length > 0))]
  return {
    all: tokens.includes('*'),
    include: tokens.filter((name) => name !== '*' && !name.startsWith('!')),
    exclude: tokens
      .filter((name) => name.startsWith('!'))
      .map((name) => name.slice(1))
      .filter((name) => name.length > 0),
  }
}

/** The request modalities a profile may name, in pi-ai's order. */
const MODALITIES = ['text', 'image']

/**
 * Read the model-id aliases from one plugin-row string.
 *
 * A gateway resells what a relay calls a model, and the harness' catalogs describe
 * that model under the id they know it by — so the row can state which catalog id a
 * served id *is*, and the capacity read follows the pairing. Nothing is inferred
 * from the spelling: an id that merely looks similar is a different model, and
 * handing it another model's limits is the failure the alias exists to avoid.
 * @param raw - comma-separated `served-id=catalog-id` pairs, or empty.
 * @returns served id → catalog id, in the order the row names them.
 * @throws {Error} naming an entry that is not a pair, or one that aliases an id to itself.
 */
export function parseModelAliases(raw) {
  const aliases = new Map()
  for (const token of raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
    const equals = token.indexOf('=')
    const served = equals === -1 ? '' : token.slice(0, equals).trim()
    const target = equals === -1 ? '' : token.slice(equals + 1).trim()
    if (served.length === 0 || target.length === 0) {
      throw new Error(
        `newapi: providerModelAliases names "${token}", which is not a pair;`
        + ' expected a comma-separated list of "served-id=catalog-id"',
      )
    }
    if (served === target) {
      throw new Error(`newapi: providerModelAliases aliases "${served}" to itself, which states nothing`)
    }
    aliases.set(served, target)
  }
  return aliases
}

/**
 * Read the input types an undescribed model gets from the plugin row.
 *
 * The same meaning as pi-ai's own route `defaultInput` — what a model gets when
 * nothing says otherwise — with a different default: the models here are the ones
 * the gateway's operator added on purpose, so image input is assumed unless the
 * source of truth for this gateway says otherwise. An empty value declares
 * nothing at all, which hands the model back to pi-ai's text floor.
 * @param raw - comma-separated `text` and/or `image`, or empty.
 * @returns whether image input counts as declared, and whether anything was declared at all.
 * @throws {Error} naming a modality pi-ai does not have.
 */
export function parseDefaultInput(raw) {
  const named = raw
    .split(',')
    .map((modality) => modality.trim())
    .filter((modality) => modality.length > 0)
  const unknown = named.filter((modality) => !MODALITIES.includes(modality))
  if (unknown.length > 0) {
    throw new Error(
      `newapi: providerDefaultInput names ${unknown.join(', ')}, which is not an input type;`
      + ` expected a comma-separated subset of ${MODALITIES.join(', ')}, or empty to declare nothing`,
    )
  }
  return { declared: named.length > 0, images: named.includes('image') }
}

/** Whether the resolved list declares this one model. */
function acceptsImages(id, imageModels) {
  return imageModels.includes(id)
}

/** The OpenAI-compatible root of a gateway, from the address it answers at. */
function modelsRoot(baseUrl) {
  return `${baseUrl}/v1`
}

/**
 * The provider profile one gateway becomes.
 *
 * Capacities are per model when the harness' own catalogs describe the model —
 * a gateway serving `deepseek-flash` serves DeepSeek's 1M-token window, and
 * saying 131072 there costs context the model could have held — and the route's
 * one deliberate, configurable guess for every model nothing describes. New API
 * aggregates arbitrary upstreams and its model list discloses no token limit, so
 * that guess is the honest answer for a name no catalog knows; it is not a
 * statement about the other models.
 *
 * Modalities are decided the same way, per model, by whatever source answered for
 * it ({@link module:dsh-newapi/modalities}); a model no source describes takes the
 * row's default input, whose image answer is deliberate — a refusal is a dead end
 * only the plugin row can undo, while an admitted image the upstream turns out not
 * to take comes back as that upstream's own answer.
 * @param options - route identity, gateway address, model ids, credential reference, capacity guesses, offered thinking levels, the models accepting images, and the capacities the catalogs state.
 * @returns the profile to store under `llm-pi-ai.providers[route]`.
 */
export function providerProfile(options) {
  const {
    displayName,
    baseUrl,
    models,
    apiKeyRef,
    contextWindow,
    maxTokens,
    efforts,
    imageModels = [],
    capacities = new Map(),
  } = options
  return {
    displayName,
    api: PROVIDER_API,
    baseURL: modelsRoot(baseUrl),
    apiKeyEnv: apiKeyRef,
    defaultContextWindow: contextWindow,
    defaultMaxTokens: maxTokens,
    // `off` is the one level allowed to carry no wire spelling: it means the
    // parameter is left out entirely, which is also what a model the upstream
    // will not think for needs.
    ...efforts.includes('off') ? { reasoning: 'off' } : {},
    compat: routeCompat(efforts),
    models: models.map((id) => ({
      id,
      ...modelCapacity(capacities.get(id) ?? {}),
      ...acceptsImages(id, imageModels) ? { input: [...IMAGE_INPUT] } : {},
      ...efforts.length === 0
        ? {}
        : { reasoningEfforts: Object.fromEntries(efforts.map((level) => [level, level === 'off' ? null : level])) },
    })),
  }
}

/**
 * The capacity fields one model entry declares, from what the catalogs stated.
 *
 * An entry that names no capacity declares none and keeps the route's guess, and
 * a max-tokens above the model's own context window is lowered to it: pi-ai reads
 * these as independent ceilings, so a pair that contradicts itself would let a
 * request through that the model cannot satisfy.
 * @param known - the context window and output cap one catalog stated, either possibly absent.
 * @returns the entry's `contextWindow` and `maxTokens`, omitting what nothing stated.
 */
function modelCapacity(known) {
  const maxTokens = Number.isInteger(known.contextWindow) && known.maxTokens > known.contextWindow
    ? known.contextWindow
    : known.maxTokens
  return {
    ...known.contextWindow === undefined ? {} : { contextWindow: known.contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
  }
}

/** Whether a reported capacity is one a profile may carry: a positive whole token count. */
function isTokenCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * The capacities the route's profile already states, keyed by model id.
 *
 * Nothing on the wire states a token limit and no catalog describes every id a
 * gateway may serve — a relay's own spelling of a model matches neither — so the
 * number a person typed for such a model in 「设置 → 模型」 is the only answer that
 * exists. Reading it back is what keeps a write from deleting it: the model list
 * is replaced wholesale, and a capacity nobody restates would otherwise revert the
 * model to the route's guess on every sync.
 *
 * The read is the resolved settings view, so it is the profile in force rather
 * than the last thing this plugin wrote. Both it and the document it comes from
 * are advisory: a seam that cannot answer costs the carried numbers, never the
 * route.
 * @param settings - the settings seam, when the harness mounts one.
 * @param route - the provider route this plugin registers.
 * @returns the capacities that route currently declares; empty when nothing states one.
 */
function storedCapacities(settings, route) {
  if (typeof settings?.describe !== 'function') return new Map()
  let view
  try {
    view = settings.describe({ redactSecrets: true })
  } catch {
    return new Map()
  }
  const value = (Array.isArray(view) ? view : []).find((row) => row?.ns === PROVIDER_NS)?.value
  const models = value?.providers?.[route]?.models
  if (!Array.isArray(models)) return new Map()
  const stored = new Map()
  for (const entry of models) {
    if (typeof entry?.id !== 'string' || entry.id.length === 0) continue
    const known = {
      ...isTokenCount(entry.contextWindow) ? { contextWindow: entry.contextWindow } : {},
      ...isTokenCount(entry.maxTokens) ? { maxTokens: entry.maxTokens } : {},
    }
    if (Object.keys(known).length > 0) stored.set(entry.id, known)
  }
  return stored
}

/**
 * Fold the numbers the route already carries under the ones this read states.
 *
 * The catalogs win field by field, so a corrected catalog fact still lands; a
 * field no catalog states keeps what the route has instead of being dropped. Only
 * the models the gateway still serves are considered — a capacity kept for an id
 * that is gone would be a claim about a model this route no longer carries. The
 * two are reported apart ({@link publishGatewayProvider}) because they are not the
 * same claim: one is what a catalog says about the model, the other is what this
 * deployment decided for an id nothing describes.
 * @param capacities - the per-model capacities the catalog read stated just now.
 * @param stored - the per-model capacities the route's profile already carries.
 * @param models - the model ids the gateway currently serves.
 * @returns the capacities to declare, and the per-model fields that came from the profile.
 */
function withStoredCapacities(capacities, stored, models) {
  const served = new Set(models)
  const merged = new Map()
  for (const source of [stored, capacities]) {
    for (const [id, known] of source) {
      if (!served.has(id)) continue
      merged.set(id, { ...merged.get(id), ...known })
    }
  }
  const carried = []
  for (const [id, known] of stored) {
    if (!served.has(id)) continue
    const stated = capacities.get(id) ?? {}
    const fromProfile = {
      ...stated.contextWindow !== undefined || known.contextWindow === undefined ? {} : { contextWindow: known.contextWindow },
      ...stated.maxTokens !== undefined || known.maxTokens === undefined ? {} : { maxTokens: known.maxTokens },
    }
    if (Object.keys(fromProfile).length > 0) carried.push({ id, ...fromProfile })
  }
  return { capacities: merged, carried }
}

/**
 * The pi-ai wire facts every model on this route needs, named outright.
 *
 * Nothing here can be inferred: this route is declared by configuration rather
 * than shipped by pi-ai's catalog, so pi-ai falls back to guessing from the
 * address — and its guess is an OpenAI-hosted endpoint, which a gateway relaying
 * to arbitrary upstreams is not.
 *
 *  - The system prompt goes out as `system`. pi-ai sends `developer` when a model
 *    reasons and compatibility allows it, which an upstream behind New API
 *    answers with `422 unknown variant 'developer'`; `system` is accepted
 *    everywhere, including by the OpenAI models that prefer `developer`.
 *  - The thinking levels need the openai dispatch format, or a detected default
 *    that drifted would silently stop sending the parameter they were offered for.
 * @param efforts - the offered thinking levels; only the reasoning facts depend on them.
 * @returns the route's compat profile.
 */
function routeCompat(efforts) {
  return {
    supportsDeveloperRole: false,
    ...efforts.length === 0 ? {} : { thinkingFormat: 'openai', supportsReasoningEffort: true },
  }
}

/**
 * Store the gateway token behind its reference, then register the route that
 * names it. The credential goes first: a route advertising models whose every
 * request would fail on an unresolvable reference is worse than no route.
 *
 * The model list replaces whatever the route held, because the gateway is what
 * decides which models exist: a per-model edit made in 「设置 → 模型」 does not
 * survive the next start or sync. The two capacity fields are the exception, and
 * for a reason the list does not share: they are the only place a number for an id
 * no catalog describes can live, so what the route already states is carried over
 * wherever this read states nothing ({@link storedCapacities}).
 * @param options - the two seams, the route's identity, the gateway address, its token, the model ids, the capacity guesses, the offered thinking levels, the resolved models accepting images, and the resolved per-model capacities.
 * @returns what was published: the route key, the credential reference, the display name, the model count, the models declared image-capable, the models a capacity was declared for, and the capacities kept from the route's own profile.
 * @throws {Error} when the gateway exposes no models, or either seam refuses the write.
 */
export async function publishGatewayProvider(options) {
  const {
    settings,
    credentials,
    route,
    apiKeyRef,
    displayName,
    baseUrl,
    token,
    models,
    contextWindow,
    maxTokens,
    efforts,
    imageModels = [],
    capacities = new Map(),
  } = options
  // An empty list is not a narrower route but an invalid one: pi-ai refuses a
  // declared route whose catalog resolves no models at all, so there would be
  // nothing to register.
  if (models.length === 0) {
    throw new Error('the gateway serves no models yet; add a channel in the New API console first')
  }
  const declared = withStoredCapacities(capacities, storedCapacities(settings, route), models)
  await credentials.set(apiKeyRef, token)
  await settings.update(PROVIDER_NS, {
    providers: {
      [route]: providerProfile({
        displayName,
        baseUrl,
        models,
        apiKeyRef,
        contextWindow,
        maxTokens,
        efforts,
        imageModels,
        capacities: declared.capacities,
      }),
    },
  })
  return {
    route,
    apiKeyRef,
    displayName,
    models: models.length,
    efforts: [...efforts],
    imageModels: models.filter((id) => acceptsImages(id, imageModels)),
    capacities: [...capacities].map(([id, known]) => ({ id, ...known })),
    carriedCapacities: declared.carried,
  }
}

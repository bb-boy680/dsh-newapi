/**
 * What the gateway's models are, beyond their ids.
 *
 * Nothing on the wire states a modality or a capacity. New API's
 * OpenAI-compatible model list carries an id, an owner, and endpoint types; its
 * `/api/pricing` carries the free-form tags an operator sets on the model in the
 * console; and pi-ai's own floor for a model nobody describes is text with the
 * route's capacity guess. So this module asks the two places that can already
 * answer, both of which follow the gateway's own model list:
 *
 *  - **the gateway's model metadata** — a `vision` (and friends) tag on the model
 *    in the New API console, whether typed there or imported by the official
 *    metadata sync. Adding a model in the console and tagging it there is the
 *    whole workflow; nothing on the harness side is edited by hand.
 *  - **the harness' installed model catalogs** — a model id some *other*
 *    provider already ships with its modalities, e.g. DeepSeek's own catalog
 *    describing `deepseek-flash`, or pi-ai's catalog describing `glm-5.3-flash`.
 *
 * A model neither source describes takes the row's `providerDefaultInput`, which
 * defaults to image input; the plugin row's `providerImageModels` outranks
 * everything, and with a leading `!` it withholds any model.
 *
 * The same catalog read is the only source for a per-model capacity: a model
 * entry carries its context window and output cap, which is what keeps a route
 * whose models are described by id from guessing one number for all of them
 * (see {@link resolveCapacities}).
 *
 * A relay renames what it resells, so an id the catalogs never heard can still be
 * a model they describe: {@link MODEL_ALIASES} states those pairings, and the
 * capacity read follows one to the entry its target carries
 * (see {@link resolveAliasedCapacities}). Modalities deliberately do not: an alias
 * says two ids are one model, and a target that calls the model text-only would
 * then silently withdraw image input that nothing else asked it to withdraw.
 *
 * @module dsh-newapi/modalities
 */

/** Tag spellings, lowercased, that mean "this model reads images". */
const IMAGE_TAGS = new Set(['vision', 'vlm', 'multimodal', 'multi-modal', '多模态', '视觉', '图像'])

/**
 * The served ids this plugin knows name a model the installed catalogs describe
 * under another id, curated one model at a time.
 *
 * A gateway aggregates relays, and a relay names a model its own way: DeepSeek V4.1
 * Flash reaches DSH as `deepseek-v4.1-flash` through one channel and as
 * `deepseek-flash` through another, while the catalogs know only the latter. The
 * pairing is stated here rather than guessed from the spelling — a similarity rule
 * would hand one model's limits to another — and only where the two ids are the
 * same model beyond doubt. A deployment that serves a spelling nothing here names
 * adds it on its own row (`providerModelAliases`), which outranks this table.
 */
export const MODEL_ALIASES = new Map([
  // The catalogs' own name for it: llm-deepseek ships `deepseek-flash` as
  // "DeepSeek-V41-Flash", and the relay spells that name out in the id.
  ['deepseek-v4.1-flash', 'deepseek-flash'],
])

/**
 * Whether one model's New API tag string claims image input. Tags are free text
 * separated by commas, so only a whole tag counts — `vision-input` is a word this
 * module does not know, and guessing at it would be the invention it avoids.
 * @param tags - the `tags` field of one pricing row, or nothing.
 * @returns true when one tag is a spelling of image input.
 */
export function tagsAcceptImages(tags) {
  return String(tags ?? '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .some((tag) => IMAGE_TAGS.has(tag))
}

/** What one source answered, and why it could not answer when it could not. */
async function asked(read, unavailable, empty = new Set()) {
  try {
    return { models: await read(), unavailable: undefined }
  } catch (error) {
    return { models: empty, unavailable: `${unavailable}: ${error.message}` }
  }
}

/**
 * The served models whose New API metadata carries an image tag.
 *
 * The pricing page is the console's public model list, and it is where the tags
 * live; a deployment that requires a session for it answers nothing, which costs
 * the catalog source nothing but is reported so the reason a model stayed
 * text-only is never a mystery.
 * @param baseUrl - the gateway's address.
 * @param names - the model ids the gateway currently serves.
 * @returns the models tagged for image input, and a diagnostic when the read failed.
 */
export async function readTaggedModels(baseUrl, names, timeoutMs = 15000) {
  return asked(async () => {
    const response = await fetch(`${baseUrl}/api/pricing`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`/api/pricing answered HTTP ${response.status}`)
    const body = await response.json()
    const rows = Array.isArray(body?.data) ? body.data : []
    const wanted = new Set(names)
    const tagged = new Set()
    for (const row of rows) {
      if (typeof row?.model_name === 'string' && wanted.has(row.model_name) && tagsAcceptImages(row.tags)) {
        tagged.add(row.model_name)
      }
    }
    return tagged
  }, 'the gateway\'s model tags could not be read')
}

/** What one catalog says about a model: whether it reads images, and how much it takes. */
export function catalogEntry(inputModalities, contextWindow, maxTokens) {
  return {
    images: Array.isArray(inputModalities) && inputModalities.includes('image'),
    ...isCapacity(contextWindow) ? { contextWindow } : {},
    ...isCapacity(maxTokens) ? { maxTokens } : {},
  }
}

/**
 * The served models some installed catalog already describes.
 *
 * A catalog answers in two places, and they are read together because neither
 * covers both halves of the answer:
 *
 *  - **the directory and the configured routes** — the providers pi-ai ships and
 *    those this deployment configured, whose entries carry the modalities, the
 *    context window and the output cap outright. This is what lets a model nobody
 *    configured a provider for still answer: `glm-5.3-flash` is in the installed
 *    pi-ai catalog whether or not a `zai` route exists here.
 *  - **the owning adapter** — a route whose provider has no directory entry
 *    (an adapter that ships its own catalog, like the harness' DeepSeek one, the
 *    very route a served `deepseek-flash` usually comes from) states the same
 *    things through `resolveModelInfo`, which is where its context window and
 *    output cap live.
 *
 * Both are advisory metadata read from memory, so neither costs a request or a
 * key. The plugin's own route is skipped in both, or this module would feed its
 * last answer back in as evidence; a provider that cannot answer is skipped
 * rather than failing the whole read.
 *
 * One entry is what remains per id, and each field is picked for the reading it
 * deserves: an image claim from any provider is evidence about the model, while a
 * capacity is the smallest one reported, because exceeding one is the failure
 * this exists to prevent.
 * @param llm - the harness' llm service, when the composition mounts one.
 * @param names - the model ids the gateway currently serves.
 * @param ownRoute - the provider route this plugin registers; never consulted.
 * @returns each served model's catalog entry, and a diagnostic when the service is absent.
 */
export async function readCatalogModels(llm, names, ownRoute) {
  if (llm === undefined || typeof llm.listProviders !== 'function') {
    return { models: new Map(), unavailable: 'this harness mounts no llm service' }
  }
  return asked(async () => {
    const wanted = new Set(names)
    const answers = new Map()
    /** Record one source's answer about a model's image input. Image wins: a provider that knows the model reads images is evidence about the model, while `text` from another provider is that provider's own endpoint talking. */
    const mergeImages = (id, images) => {
      const known = answers.get(id)
      answers.set(id, { images: images === true || known?.images === true, ...capacitiesOf(known) })
    }
    /** Record one source's capacities. Smallest wins, per field: providers disagree about a model's ceilings (its own catalog against a gateway's listing of it), and the reading that admits fewer tokens is the one no endpoint rejects. */
    const mergeCapacities = (id, contextWindow, maxTokens) => {
      const known = answers.get(id)
      const window = smallestCapacity(known?.contextWindow, contextWindow)
      const cap = smallestCapacity(known?.maxTokens, maxTokens)
      answers.set(id, {
        images: known?.images === true,
        ...window === undefined ? {} : { contextWindow: window },
        ...cap === undefined ? {} : { maxTokens: cap },
      })
    }
    /** What the directory says about the models of one provider this deployment configured. */
    const fromDirectory = async (entry) => {
      const discovered = await llm.discoverModels(entry.settingsNs, { provider: entry.provider })
      for (const model of discovered) {
        if (!wanted.has(model.id)) continue
        mergeImages(model.id, catalogEntry(model.inputModalities).images)
        mergeCapacities(model.id, model.contextWindow, model.maxTokens)
      }
    }
    /** What one route's own adapter says about each of its models. */
    const fromAdapter = async (provider, models) => {
      // One resolution per model, memoized: every provider is asked about every
      // served model, and a catalog route's resolution never ends.
      const resolved = new Map()
      for (const model of models) {
        if (!wanted.has(model.id)) continue
        if (!resolved.has(model.id)) {
          const info = await llm.resolveModelInfo(provider, model.id)
          resolved.set(model.id, {
            contextWindow: info?.context?.contextWindow,
            maxTokens: info?.defaultMaxTokens,
          })
        }
        const { contextWindow, maxTokens } = resolved.get(model.id)
        if ('inputModalities' in model) mergeImages(model.id, catalogEntry(model.inputModalities).images)
        mergeCapacities(model.id, contextWindow, maxTokens)
      }
    }
    for (const provider of llm.listProviders()) {
      if (provider.id === ownRoute) continue
      try {
        const listed = await llm.listModels(provider.id)
        for (const model of listed) {
          if (!wanted.has(model.id)) continue
          mergeImages(model.id, catalogEntry(model.inputModalities).images)
          // The listing's own capacities are read too: an adapter that reports them
          // beside its modalities states them just as validly as the directory does.
          mergeCapacities(model.id, model.contextWindow, model.maxTokens)
        }
        if (typeof llm.resolveModelInfo === 'function') await fromAdapter(provider.id, listed)
      } catch {
        // A route whose profile cannot serve its catalog still leaves the others.
      }
    }
    if (typeof llm.listConfigurableProviders === 'function' && typeof llm.discoverModels === 'function') {
      for (const entry of llm.listConfigurableProviders()) {
        if (entry.provider === ownRoute) continue
        try {
          await fromDirectory(entry)
        } catch {
          // A provider nothing installed describes needs an endpoint to probe,
          // which is not this plugin's business.
        }
      }
    }
    return answers
  }, 'the harness\' model catalogs could not be read', new Map())
}

/** Whether a reported capacity is usable at all. */
function isCapacity(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** The capacity fields one entry already carries, so a modality answer does not drop them. */
function capacitiesOf(entry) {
  return {
    ...isCapacity(entry?.contextWindow) ? { contextWindow: entry.contextWindow } : {},
    ...isCapacity(entry?.maxTokens) ? { maxTokens: entry.maxTokens } : {},
  }
}

/**
 * The smallest capacity any reading stated, so a merged entry never claims more
 * than one of its sources does.
 * @param readings - the capacities reported for one model, in any order.
 * @returns the capacity to keep, or nothing when no reading stated a usable one.
 */
function smallestCapacity(...readings) {
  const usable = readings.filter(isCapacity)
  return usable.length === 0 ? undefined : Math.min(...usable)
}

/**
 * The image claim for every model the gateway serves, with the source behind it.
 *
 * Precedence follows how specifically each source speaks about *this* gateway:
 * the plugin row names models outright, a tag is set on the model in the
 * gateway's own console, and a catalog answer is about a same-id model on some
 * other provider — evidence rather than a statement about this endpoint.
 *
 * A model no source describes takes the fallback the row configures, which
 * defaults to image input: the gateway serves the models its operator added on
 * purpose, and a refusal for an undescribed model is a dead end only the plugin
 * row can undo, while an admitted image the upstream turns out not to take comes
 * back as that upstream's own answer. A source that positively calls a model
 * text-only — a catalog entry, or a `!` in the row — is still respected.
 * @param options - the served models, the parsed plugin-row claim, both source answers, and the input types an undescribed model gets.
 * @returns the models to declare image-capable, the ones answered text-only, the ones nothing described, and which source decided each.
 */
export function resolveImageModels(options) {
  const { models, claim, tagged, catalog, fallback } = options
  const declared = []
  const textOnly = []
  const undescribed = []
  const sources = new Map()
  for (const id of models) {
    if (claim.exclude.includes(id)) {
      textOnly.push(id)
      sources.set(id, 'plugin row')
    } else if (claim.all || claim.include.includes(id)) {
      declared.push(id)
      sources.set(id, 'plugin row')
    } else if (tagged.has(id)) {
      declared.push(id)
      sources.set(id, 'New API tag')
    } else if (catalog.has(id)) {
      const images = catalog.get(id).images
      if (images) declared.push(id)
      else textOnly.push(id)
      sources.set(id, 'model catalog')
    } else {
      undescribed.push(id)
      if (fallback.images) {
        declared.push(id)
        sources.set(id, 'assumed')
      } else {
        // Nothing to state: the model keeps pi-ai's own floor, which is text.
        textOnly.push(id)
      }
    }
  }
  // A name the row lists that the gateway does not serve is a typo that would
  // otherwise do nothing at all, and silence is the one answer an operator
  // cannot act on.
  const unmatched = [...claim.include, ...claim.exclude].filter((name) => !models.includes(name))
  return { declared, textOnly, undescribed, sources, unmatched }
}

/**
 * The capacities the installed catalogs state for the served models.
 *
 * This is the one source a per-model capacity can come from. New API's
 * `/v1/models` carries no token limit at all and its model metadata has no field
 * to put one in, so a capacity is either the model id's own fact — the same read
 * that decides modalities, which knows DeepSeek's 1M window because the harness
 * ships that model — or the route's one deliberate guess.
 *
 * The guess is what a model nothing describes keeps, and it stays on the route
 * rather than being copied onto the entry: restating it per model would pin a
 * value nobody chose and hide it from the next read.
 * @param catalog - each served model's catalog entry, from {@link readCatalogModels}.
 * @param models - the model ids the gateway currently serves.
 * @returns the per-model capacities to declare, keyed by model id.
 */
export function resolveCapacities(catalog, models) {
  const capacities = new Map()
  for (const id of models) {
    const entry = catalog.get(id)
    const known = entry === undefined
      ? {}
      : {
          ...isCapacity(entry.contextWindow) ? { contextWindow: entry.contextWindow } : {},
          ...isCapacity(entry.maxTokens) ? { maxTokens: entry.maxTokens } : {},
        }
    if (Object.keys(known).length > 0) capacities.set(id, known)
  }
  return capacities
}

/**
 * The alias table this run follows: the curated pairings under the row's own.
 *
 * The row wins so a deployment can correct the table — a spelling curated here may
 * be wrong for the upstream behind this gateway, and a relay whose id nothing here
 * names is exactly what the row exists for.
 * @param row - the pairings the plugin row named, served id → catalog id.
 * @returns every pairing this run knows, the row's taken last.
 */
export function resolveModelAliases(row = new Map()) {
  return new Map([...MODEL_ALIASES, ...row])
}

/**
 * The capacities the served models take from the catalog entry their alias names.
 *
 * A gateway resells what a relay calls a model; the catalogs describe that model
 * under the relay's or the vendor's own id. The alias states which id that is, and
 * the numbers are the ones the catalogs already state for it — nothing is invented
 * here, and an alias whose target no catalog describes adds nothing, which leaves
 * the model to whatever the route already carries.
 *
 * A capacity stated for the served id itself is never replaced: the alias fills the
 * fields that id's own entry leaves open, per field, and states nothing where the
 * target is silent.
 * @param capacities - the per-model capacities the catalogs stated by id, from {@link resolveCapacities}.
 * @param catalog - each read model's catalog entry, from {@link readCatalogModels}.
 * @param aliases - served id → catalog id, from {@link resolveModelAliases}.
 * @param models - the model ids the gateway currently serves.
 * @returns the capacities to declare, and the models that took them from an alias.
 */
export function resolveAliasedCapacities(capacities, catalog, aliases, models) {
  const declared = new Map(capacities)
  const aliased = []
  for (const id of models) {
    const target = aliases.get(id)
    if (target === undefined || target === id) continue
    const stated = capacities.get(id) ?? {}
    const entry = catalog.get(target)
    const taken = {
      ...stated.contextWindow === undefined && isCapacity(entry?.contextWindow) ? { contextWindow: entry.contextWindow } : {},
      ...stated.maxTokens === undefined && isCapacity(entry?.maxTokens) ? { maxTokens: entry.maxTokens } : {},
    }
    if (Object.keys(taken).length === 0) continue
    declared.set(id, { ...stated, ...taken })
    aliased.push({ id, as: target, ...taken })
  }
  return { capacities: declared, aliased }
}

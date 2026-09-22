/**
 * Headless check of the shipped browser artifact. It loads `lib/client.js`
 * through a stub of the page's module loader, runs the plugin's `apply` against
 * a stub context, then mounts the panel in jsdom and drives its branches — so a
 * broken wrapper, a wrong slot id, a missing dictionary key, or a wrong
 * cross-site decision fails here instead of only in the browser.
 *
 * Run from this package with: bun run check:client (after build:client)
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import * as react from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import * as jsxRuntime from 'react/jsx-runtime'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = await readFile(join(root, 'lib/client.js'), 'utf8')

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
for (const key of [
  'window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'Element', 'Node',
  'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'localStorage', 'sessionStorage',
]) {
  const value = dom.window[key]
  if (value !== undefined) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// React's legacy value watcher probes the IE-only `propertychange` API when it
// focuses an input; jsdom has no `attachEvent`, and the missing method would
// otherwise print a stack trace per focus without failing anything.
for (const target of [dom.window.HTMLElement.prototype, dom.window.HTMLInputElement.prototype]) {
  target.attachEvent = () => {}
  target.detachEvent = () => {}
}
const { act } = react

const modules = { react, 'react/jsx-runtime': jsxRuntime, 'react-dom/client': { createRoot } }
let loaded
globalThis.window.__ModuleLoader__ = {
  load(entry) {
    loaded = {
      id: entry.id,
      exports: entry.factory((name) => {
        if (!(name in modules)) throw new Error(`unexpected module-table request: ${name}`)
        return modules[name]
      }),
    }
  },
}
// eslint-disable-next-line no-new-func -- the artifact is a script, exactly as the page evaluates it.
new Function(source)()

if (loaded.id !== 'dsh-newapi') throw new Error(`unexpected module id: ${loaded.id}`)
const plugin = loaded.exports
if (typeof plugin.apply !== 'function') throw new Error('the artifact exports no apply')

const expectedInject = ['slots', 'locale']
if (JSON.stringify(plugin.inject) !== JSON.stringify(expectedInject)) {
  throw new Error(`unexpected inject list: ${JSON.stringify(plugin.inject)}`)
}

const dictionaries = {}
const registrations = []
const ctx = {
  effect: (execute) => {
    execute()
    return () => {}
  },
  locale: {
    register: (ns, dict) => {
      dictionaries[ns] = dict
      return () => {}
    },
    bind: (ns) => (key) => dictionaries[ns]?.zh?.[key] ?? key,
  },
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

plugin.apply(ctx)

const panel = registrations.find((entry) => entry.options.name === 'main')
const row = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
if (!panel) throw new Error('no main panel registered')
if (!row) throw new Error('no sidebar.panellist entry registered')
if (panel.options.key !== 'newapi') throw new Error(`main panel key is ${panel.options.key}`)
if (row.options.id !== panel.options.key) throw new Error('the sidebar row does not address the panel it registers')

const dictionary = dictionaries['dsh-newapi']
const missing = Object.keys(dictionary.zh).filter((key) => !(key in dictionary.en))
const extra = Object.keys(dictionary.en).filter((key) => !(key in dictionary.zh))
if (missing.length > 0 || extra.length > 0) {
  throw new Error(`zh/en dictionaries differ: missing ${missing.join(', ')}; extra ${extra.join(', ')}`)
}

/**
 * Render the panel once against a stubbed status route and return its markup.
 * @param facts - what the status route answers.
 * @param drive - optional interaction with the rendered DOM before the markup is read.
 */
async function renderPanel(facts, drive) {
  globalThis.fetch = async () => ({ ok: true, json: async () => facts })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const reactRoot = createRoot(container)
  await act(async () => {
    reactRoot.render(react.createElement(panel.component, { t: ctx.locale.bind('dsh-newapi') }))
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  if (drive !== undefined) await drive(container)
  const markup = container.innerHTML
  await act(async () => {
    reactRoot.unmount()
  })
  container.remove()
  return markup
}

const running = {
  running: true,
  port: 3000,
  baseUrl: 'http://127.0.0.1:3000',
  consoleUrl: 'http://127.0.0.1:3000/',
  lanBaseUrl: 'http://192.168.10.101:3000',
  lanConsoleUrl: 'http://192.168.10.101:3000/',
  models: [],
  adminUsername: 'root',
  adminPassword: 'secret',
  panelApi: 5,
  provider: { enabled: true, route: 'new-api', apiKeyRef: 'NEW_API_KEY', displayName: 'New API', models: 7 },
  claudeCodeEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:3000', ANTHROPIC_AUTH_TOKEN: 'sk-test' },
}

const browserMarkup = await renderPanel(running)
if (!browserMarkup.includes('<iframe')) throw new Error('a running gateway rendered no console iframe')
if (!browserMarkup.includes('http://127.0.0.1:3000/')) throw new Error('the iframe does not point at the gateway console')
if (browserMarkup.includes('跨站框架')) throw new Error('an http-served Harness showed the cross-site caveat')
if (!browserMarkup.includes('192.168.10.101:3000')) throw new Error('the toolbar hid the address other devices can open')
if (!browserMarkup.includes('href="http://192.168.10.101:3000/"')) {
  throw new Error('opening the console in a window did not use the address other devices can open')
}

// Without a reachable network address the panel must fall back to loopback.
const loopbackOnlyMarkup = await renderPanel({ ...running, lanBaseUrl: undefined, lanConsoleUrl: undefined })
if (!loopbackOnlyMarkup.includes('href="http://127.0.0.1:3000/"')) {
  throw new Error('a gateway with no network address did not fall back to its loopback console')
}

dom.reconfigure({ url: 'dsh-app://app/' })
const shellMarkup = await renderPanel(running)
if (!shellMarkup.includes('跨站框架')) throw new Error('the desktop shell origin hid the cross-site caveat')

const bridgedMarkup = await renderPanel({ ...running, consoleProxyUrl: 'http://127.0.0.1:5555' })
if (!bridgedMarkup.includes('http://127.0.0.1:5555/console')) {
  throw new Error('the session bridge did not take over the embedded console URL')
}
if (bridgedMarkup.includes('跨站框架')) throw new Error('the session bridge left the cross-site caveat in place')
// The bridge keeps the console signed in, and says nothing about it: the account
// it holds is an implementation detail of the pane, not a status line.
if (bridgedMarkup.includes('记住')) throw new Error('the panel printed a console-account status line again')

const rememberedMarkup = await renderPanel({
  ...running,
  consoleProxyUrl: 'http://127.0.0.1:5555',
  consoleAccount: 'alice',
})
if (rememberedMarkup.includes('alice')) throw new Error('the panel printed the remembered console account again')
if (rememberedMarkup.includes('记住')) throw new Error('the panel printed a console-account status line again')

const stoppedMarkup = await renderPanel({ running: false, error: 'boom', dataDir: 'D:/x' })
if (stoppedMarkup.includes('<iframe')) throw new Error('a stopped gateway still rendered an iframe')
if (!stoppedMarkup.includes('网关未运行')) throw new Error('a stopped gateway rendered no explanation')
if (!stoppedMarkup.includes('boom')) throw new Error('a stopped gateway hid its reason')

const setupMarkup = await renderPanel({ running: false, needsSetup: true, defaultPort: 3080 })
if (setupMarkup.includes('<iframe')) throw new Error('an uninitialised gateway rendered a console iframe')
if (!setupMarkup.includes('首次运行配置')) throw new Error('the first run rendered no settings form')
if (!setupMarkup.includes('type="number"')) throw new Error('the first-run form asked for no port')
if (!setupMarkup.includes('type="password"')) throw new Error('the first-run form asked for no root password')
if (setupMarkup.includes('网关未运行')) throw new Error('the first run was reported as a stopped gateway')

// Finishing the form is what hands the two settings to the Host, so drive it the
// way a person does: type the password, submit, and inspect the request and the
// panel the submission leaves behind.
let submitted
let afterSubmit
await renderPanel({ running: false, needsSetup: true, defaultPort: 3080 }, async (container) => {
  // Installed after the panel's first read, because submitting is what this drives.
  globalThis.fetch = async (url, options = {}) => {
    submitted = { url, body: JSON.parse(options.body) }
    return { ok: true, status: 202, json: async () => ({ accepted: true, port: 3080 }) }
  }
  await act(async () => {
    Simulate.change(container.querySelector('input[type="password"]'), { target: { value: 'first-run-password' } })
  })
  await act(async () => {
    container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  afterSubmit = container.innerHTML
})
if (submitted?.url !== '/api/dsh-newapi/setup') throw new Error(`the form posted to ${submitted?.url}`)
if (submitted.body.port !== 3080) throw new Error(`the form posted port ${submitted.body.port}`)
if (submitted.body.rootPassword !== 'first-run-password') throw new Error('the form posted the wrong root password')
if (afterSubmit.includes('<form')) throw new Error('the first-run form stayed on screen after it was accepted')
if (!afterSubmit.includes('设置已提交')) throw new Error('the accepted first run showed no progress')

/** Open the settings form through the toolbar button, as a person would. */
const clickConfigure = async (container) => {
  const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === '配置')
  if (button === undefined) throw new Error('a running gateway offered no settings button')
  await act(async () => {
    button.click()
  })
}

// A gateway that is already running offers no form until the button asks for it.
const configuredMarkup = await renderPanel(running, clickConfigure)
if (configuredMarkup.includes('<iframe')) throw new Error('the settings form left the console iframe in place')
if (!configuredMarkup.includes('配置 New API')) throw new Error('the settings button opened no settings form')
if (!configuredMarkup.includes('取消')) throw new Error('the settings form offered no way back to the console')

// The password in use is shown masked, not editable, and the form sends nothing
// for a password it is not changing.
const findButton = (container, label) =>
  [...container.querySelectorAll('button')].find(
    (entry) => entry.getAttribute('aria-label') === label || entry.textContent === label,
  )
const shownField = (container) => container.querySelector('input[readonly]')

const openSettings = async (container, changePassword) => {
  globalThis.fetch = async (url, options = {}) => {
    if (options.method !== 'POST') return { ok: true, json: async () => running }
    posted = JSON.parse(options.body)
    return { ok: true, status: 200, json: async () => ({ applied: true, port: 3000, passwordChanged: false, portChanged: false }) }
  }
  await clickConfigure(container)
  const shown = shownField(container)
  if (shown === null || shown.value !== 'secret') {
    throw new Error('the settings form did not show the password in use')
  }
  if (shown.type !== 'password') throw new Error('the password in use was not masked')
  if (changePassword !== undefined) {
    const edit = findButton(container, '编辑')
    if (edit === undefined) throw new Error('the settings form offered no way to change the password')
    await act(async () => {
      edit.click()
    })
    const field = container.querySelector('input[type="password"]:not([readonly])')
    if (field === null) throw new Error('choosing to edit the password showed no editable field')
    await act(async () => {
      Simulate.change(field, { target: { value: changePassword } })
    })
  }
  await act(async () => {
    container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

let posted
let afterApply
await renderPanel(running, async (container) => {
  await openSettings(container)
  afterApply = container.innerHTML
})
if (posted?.port !== 3000) throw new Error(`the settings form posted port ${posted?.port}`)
if (posted.rootPassword !== undefined) {
  throw new Error('a password nobody chose to edit was posted as a change')
}
if (afterApply.includes('<form')) throw new Error('the settings form stayed open after the change was applied')
if (!afterApply.includes('配置已更新')) throw new Error('the applied change was not confirmed')
if (!afterApply.includes('<iframe')) throw new Error('the console did not come back after the change was applied')

// A password the form was told to change is posted; an emptied field is not.
await renderPanel(running, async (container) => {
  await openSettings(container, 'changed-password-1')
})
if (posted.rootPassword !== 'changed-password-1') throw new Error(`the form posted ${posted.rootPassword} as the new password`)

await renderPanel(running, async (container) => {
  await openSettings(container, '')
})
if (posted.rootPassword !== undefined) {
  throw new Error('an emptied password field posted a password instead of keeping the current one')
}

// The eye reveals what the field masks, and the sheet copies it.
let revealedType
let copyOffered
await renderPanel(running, async (container) => {
  await clickConfigure(container)
  copyOffered = findButton(container, '复制密码') !== undefined
  await act(async () => {
    findButton(container, '显示密码').click()
  })
  revealedType = shownField(container).type
})
if (!copyOffered) throw new Error('the password in use offered no way to copy it')
if (revealedType !== 'text') throw new Error('the eye did not reveal the masked password')

// Abandoning an edit puts the password in use back on screen, untouched.
let cancelledValue
let cancelledType
await renderPanel(running, async (container) => {
  await clickConfigure(container)
  await act(async () => {
    findButton(container, '编辑').click()
  })
  await act(async () => {
    findButton(container, '取消编辑').click()
  })
  cancelledValue = shownField(container)?.value
  cancelledType = shownField(container)?.type
})
if (cancelledValue !== 'secret') throw new Error('cancelling the edit did not restore the password in use')
if (cancelledType !== 'password') throw new Error('cancelling the edit left the field editable')

// A Host that speaks an older panel contract is named instead of failing silently.
const staleMarkup = await renderPanel({ ...running, panelApi: undefined })
if (!staleMarkup.includes('Host 还是旧代码')) throw new Error('an older Host half was not reported to the person')
const currentMarkup = await renderPanel(running)
if (currentMarkup.includes('Host 还是旧代码')) throw new Error('a current Host half was reported as stale')

// The panel used to print a permanent line about this gateway's place in the
// harness' model configuration, and another about the console account it holds.
// Both were noise above the console, and both are gone: what stays is the one
// action that changes the first, and its answer.
if (currentMarkup.includes('已写入 DSH 模型配置')) throw new Error('the provider status line came back')
if (currentMarkup.includes('DSH 模型配置：New API')) throw new Error('the provider status line came back')

const providerFailedMarkup = await renderPanel({
  ...running,
  provider: { enabled: true, displayName: 'New API', error: 'the reference is shadowed' },
})
if (providerFailedMarkup.includes('未能写入 DSH 模型配置')) {
  throw new Error('a provider failure was printed above the console instead of answering the sync')
}

const providerOffMarkup = await renderPanel({ ...running, provider: { enabled: false } })
if (providerOffMarkup.includes('已按配置关闭')) throw new Error('a switched-off registration was reported above the console')

// The gateway's channels are added in its own console, so the panel offers the
// one action that makes the selector agree with the gateway again.
let syncRequest
let syncedMarkup
await renderPanel(running, async (container) => {
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      syncRequest = url
      return { ok: true, status: 200, json: async () => ({ provider: { enabled: true, route: 'new-api', models: 9 } }) }
    }
    return { ok: true, json: async () => running }
  }
  const button = findButton(container, '同步模型')
  if (button === undefined) throw new Error('a running gateway offered no way to sync its models')
  await act(async () => {
    button.click()
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  syncedMarkup = container.innerHTML
})
if (syncRequest !== '/api/dsh-newapi/sync') throw new Error(`the sync button posted to ${syncRequest}`)
if (!syncedMarkup.includes('已把网关当前的模型同步到 DSH 模型配置')) {
  throw new Error('a successful sync was not confirmed')
}

// A sync the Host refuses answers where it was asked for, with the reason: this
// is the only place the panel still reports the model configuration at all, so it
// is the one that has to carry a refusal.
let syncRefusedMarkup
await renderPanel(running, async (container) => {
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      return { ok: false, status: 409, json: async () => ({ error: 'the gateway serves no models yet' }) }
    }
    return { ok: true, json: async () => running }
  }
  await act(async () => {
    findButton(container, '同步模型').click()
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  syncRefusedMarkup = container.innerHTML
})
if (!syncRefusedMarkup.includes('未能写入 DSH 模型配置 — the gateway serves no models yet')) {
  throw new Error('a refused sync did not answer with the reason the Host gave')
}

// A first install spends minutes downloading, and a panel that answers that with
// "not running" is what makes a working plugin look broken. Every state below is
// driven from the progress record the Host now reports.
const cacheDir = 'C:/Users/x/.dsh/cache/newapi/v1.0.0-rc.39'
const dataDir = 'C:/Users/x/.dsh/newapi'
const logPath = `${dataDir}/dsh-newapi.log`
const asset = 'new-api-v1.0.0-rc.39.exe'
const releaseUrl = `https://github.com/QuantumNous/new-api/releases/download/v1.0.0-rc.39/${asset}`
const progress = (fields) => ({ attempt: 1, attempts: 3, since: new Date().toISOString(), ...fields })

let acceptedMarkup
await renderPanel(
  {
    running: false,
    needsSetup: true,
    defaultPort: 3080,
    panelApi: 5,
    progress: progress({ phase: 'preparing', step: 'local' }),
  },
  async (container) => {
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') return { ok: true, status: 202, json: async () => ({ accepted: true, port: 3080 }) }
      return { ok: true, json: async () => ({ running: false, panelApi: 5, progress: progress({ phase: 'preparing' }) }) }
    }
    await act(async () => {
      Simulate.change(container.querySelector('input[type="password"]'), { target: { value: 'first-run-password' } })
    })
    await act(async () => {
      container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    acceptedMarkup = container.innerHTML
  },
)
if (acceptedMarkup.includes('<form')) throw new Error('the first-run form stayed on screen after it was accepted')
if (!acceptedMarkup.includes('正在启动 New API 网关')) {
  throw new Error('an accepted first run did not show what the Host is doing')
}
if (acceptedMarkup.includes('网关未运行')) throw new Error('a boot in progress was reported as a stopped gateway')

const downloadingMarkup = await renderPanel({
  running: false,
  panelApi: 5,
  dataDir,
  logPath,
  progress: progress({
    phase: 'downloading',
    step: 'download',
    route: { url: 'http://127.0.0.1:7890', source: 'windows' },
    download: {
      asset,
      version: 'v1.0.0-rc.39',
      url: releaseUrl,
      cacheDir,
      receivedBytes: 40 * 1024 * 1024,
      totalBytes: 128 * 1024 * 1024,
      bytesPerSecond: 15 * 1024 * 1024,
      etaSeconds: 6,
    },
  }),
})
if (downloadingMarkup.includes('网关未运行')) throw new Error('a downloading gateway was reported as not running')
if (!downloadingMarkup.includes(`正在下载 ${asset}`)) throw new Error('the panel did not name the file it is downloading')
if (!downloadingMarkup.includes('40.0 MB')) throw new Error('the panel did not report the bytes received')
if (!downloadingMarkup.includes('128.0 MB')) throw new Error('the panel did not report the total size')
if (!downloadingMarkup.includes('31%')) throw new Error('the panel did not report how far the download has come')
if (!downloadingMarkup.includes('15.0 MB/s')) throw new Error('the panel did not report the download speed')
if (!downloadingMarkup.includes(cacheDir)) throw new Error('the panel did not say where the download is going')
if (!downloadingMarkup.includes('http://127.0.0.1:7890')) {
  throw new Error('a download in progress did not say which route it is taking')
}
if (!downloadingMarkup.includes('开始下载网关程序') && !downloadingMarkup.includes('下载网关程序')) {
  throw new Error('the panel showed no step for the download')
}

// Looking for a route out is its own step in the list, so a download that is
// waiting on a proxy decision is not shown as already downloading.
const routingMarkup = await renderPanel({
  running: false,
  panelApi: 5,
  dataDir,
  logPath,
  progress: progress({ phase: 'preparing', step: 'route' }),
})
if (!routingMarkup.includes('查找可用的网络出口')) throw new Error('the route step was not shown in the boot step list')

const retryingMarkup = await renderPanel({
  running: false,
  panelApi: 5,
  dataDir,
  logPath,
  progress: progress({
    phase: 'retrying',
    step: 'download',
    retryAt: new Date(Date.now() + 12_000).toISOString(),
    error: 'fetch failed <- Connect Timeout Error',
  }),
})
if (!retryingMarkup.includes('自动重试')) throw new Error('a scheduled retry was not reported')
if (!retryingMarkup.includes('Connect Timeout Error')) throw new Error('a scheduled retry hid the cause it is retrying from')

const failure = {
  running: false,
  panelApi: 5,
  dataDir,
  logPath,
  canRetry: true,
  error: `fetch failed <- Connect Timeout Error (attempted address: github.com:443, timeout: 10000ms) (UND_ERR_CONNECT_TIMEOUT)`,
  hint: {
    kind: 'network',
    dataDir,
    cacheDir,
    version: 'v1.0.0-rc.39',
    asset,
    dropInName: 'new-api.exe',
    dropInPath: `${dataDir}/new-api.exe`,
    releaseUrl,
    // The way the download already went: the panel states it rather than telling
    // a person to configure the proxy that just failed.
    route: { url: 'http://127.0.0.1:7890', source: 'windows' },
  },
  progress: progress({
    phase: 'failed',
    attempt: 3,
    error: `fetch failed <- Connect Timeout Error (attempted address: github.com:443, timeout: 10000ms)`,
    hint: { kind: 'network' },
    route: { url: 'http://127.0.0.1:7890', source: 'windows' },
  }),
}

const failedMarkup = await renderPanel(failure)
if (failedMarkup.includes('网关未运行')) throw new Error('a failed boot was reported as a plain stopped gateway')
if (!failedMarkup.includes('连不上下载服务器')) throw new Error('a network failure was not named in the panel')
if (!failedMarkup.includes('UND_ERR_CONNECT_TIMEOUT')) throw new Error('the raw cause was hidden')
if (!failedMarkup.includes('已尝试的出口')) throw new Error('the panel did not say which route the download already took')
if (!failedMarkup.includes('http://127.0.0.1:7890')) {
  throw new Error('the proxy the download went through was not named')
}
if (!failedMarkup.includes('Windows 系统代理设置')) {
  throw new Error('the panel did not say where the proxy address came from')
}
if (failedMarkup.includes('NODE_USE_ENV_PROXY')) {
  throw new Error('a download that had already used the machine proxy was told to configure that same proxy again')
}
if (!failedMarkup.includes(releaseUrl)) throw new Error('the release URL to download by hand was not offered')
if (!failedMarkup.includes(`${dataDir}/new-api.exe`)) throw new Error('the folder a hand-placed binary belongs in was not offered')
if (!failedMarkup.includes(logPath)) throw new Error('the log path was not shown')
if (!failedMarkup.includes('重试启动')) throw new Error('a failed boot offered no way to try again')

// A download that went direct and found nothing gets the other advice: the switch
// that makes Node itself use a proxy, and the file to place by hand.
const directMarkup = await renderPanel({
  ...failure,
  hint: { ...failure.hint, route: { source: 'direct' } },
})
if (!directMarkup.includes('直连下载服务器')) throw new Error('a direct download was not reported as direct')
if (!directMarkup.includes('已尝试的出口')) throw new Error('the direct route was not stated beside the cause')
if (!directMarkup.includes('HTTPS_PROXY')) throw new Error('a direct failure did not name the switch Node needs')

// A machine whose proxy is SOCKS only cannot be downloaded through at all, and
// saying so is more useful than reporting "no proxy found".
const socksMarkup = await renderPanel({
  ...failure,
  hint: { ...failure.hint, route: { source: 'socks', address: '127.0.0.1:10808' } },
})
if (!socksMarkup.includes('127.0.0.1:10808')) throw new Error('a SOCKS-only machine was reported as having no proxy')
if (!socksMarkup.includes('SOCKS')) throw new Error('a SOCKS-only machine was not explained')

// A failure whose kind the Host cannot classify still names its cause and log.
const unclassifiedMarkup = await renderPanel({
  running: false,
  panelApi: 5,
  logPath,
  canRetry: true,
  error: 'something nobody has seen before',
  hint: { kind: 'unknown', dataDir, dropInPath: `${dataDir}/new-api.exe` },
  progress: progress({ phase: 'failed', attempt: 3, error: 'something nobody has seen before' }),
})
if (!unclassifiedMarkup.includes('网关启动失败')) throw new Error('an unclassified failure lost its headline')
if (!unclassifiedMarkup.includes('something nobody has seen before')) {
  throw new Error('an unclassified failure hid what the Host reported')
}

// The retry is a request to the Host, not a re-read of the same facts: that is
// what makes a fix take effect without toggling the plugin off and on.
let retryRequest
await renderPanel(failure, async (container) => {
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      retryRequest = url
      return { ok: true, status: 202, json: async () => ({ started: true, attempts: 3 }) }
    }
    return { ok: true, json: async () => failure }
  }
  const button = findButton(container, '重试启动')
  if (button === undefined) throw new Error('a failed boot offered no retry button to drive')
  await act(async () => {
    button.click()
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
})
if (retryRequest !== '/api/dsh-newapi/retry') throw new Error(`the retry button posted to ${retryRequest}`)

// A refusal from the Host is shown instead of looking like a retry that worked.
let refusedMarkup
await renderPanel(failure, async (container) => {
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') return { ok: false, status: 409, json: async () => ({ error: 'a start is already in progress' }) }
    return { ok: true, json: async () => failure }
  }
  await act(async () => {
    findButton(container, '重试启动').click()
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  refusedMarkup = container.innerHTML
})
if (!refusedMarkup.includes('a start is already in progress')) {
  throw new Error('a refused retry did not say why it was refused')
}

console.log('[dsh-newapi] client artifact verified')
console.log(`  module id       : ${loaded.id}`)
console.log(`  sidebar row     : id=${row.options.id} order=${row.options.order} label=${row.options.label()}`)
console.log(`  main panel      : key=${panel.options.key}`)
console.log(`  dictionaries    : zh/en, ${Object.keys(dictionary.zh).length} keys each`)
console.log('  branches        : running+http, running+dsh-app, bridge(no account), bridge(account), stopped, first run, configure, sync(ok/refused)')
console.log('  boot states     : accepted, downloading(+bytes/speed/eta), retrying(+countdown), failed(network/unknown), retry request, refused retry')

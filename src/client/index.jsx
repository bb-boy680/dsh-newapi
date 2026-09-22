/**
 * dsh-newapi, browser half: the **New API** entry in the sidebar and the console
 * it opens in the main column. The panel embeds the gateway's own web UI in an
 * iframe — new-api sends neither `X-Frame-Options` nor `Content-Security-Policy`,
 * so the same-site loopback page renders inside the Harness — under a toolbar
 * carrying the gateway status, its address, and the settings form that decides
 * the port and the root password.
 * @module dsh-newapi/client
 */
import { useCallback, useEffect, useState } from 'react'

/** Locale namespace this plugin owns. */
const NS = 'dsh-newapi'

/** Sidebar entry id; the same string keys the main panel that entry selects. */
const PANEL_ID = 'newapi'

/** Row position among the sidebar's global panels. */
const ORDER = 10

/** Mirrors `ROUTES.status` in the Host half. */
const STATUS_PATH = '/api/dsh-newapi/status'

/** Mirrors `ROUTES.setup` in the Host half: the one write this panel performs. */
const SETUP_PATH = '/api/dsh-newapi/setup'

/** Mirrors `ROUTES.sync`: hand the gateway's current models to the harness again. */
const SYNC_PATH = '/api/dsh-newapi/sync'

/** Mirrors `ROUTES.retry`: run the boot again after it gave up. */
const RETRY_PATH = '/api/dsh-newapi/retry'

/** The password policy the Host enforces, repeated here only to answer sooner. */
const PASSWORD_MIN_CHARS = 8
const PASSWORD_MAX_CHARS = 128

/** Largest port a listener can be asked for. */
const MAX_PORT = 65535

/** How long the confirmation of an applied change stays visible. */
const APPLIED_FEEDBACK_MS = 6000

/** How often the panel re-reads the gateway facts while it is open. */
const POLL_MS = 15000

/** How often it re-reads them while settings are being configured or started. */
const SETUP_POLL_MS = 1500

/**
 * What this browser half expects the Host half to speak; mirrored in
 * `index.js`. The two halves do not reload together — the page picks up a new
 * bundle while the Host keeps running its old module generation — so a panel
 * that talks to a Host it does not know has to say so instead of failing on a
 * refusal it cannot explain.
 *
 * 4 adds `progress`/`hint` and the retry route: a first install that is
 * downloading, and one that gave up, are described here instead of looking like
 * a plugin that does not work.
 *
 * 5 adds `progress.route` and the route step: the panel says which way out the
 * download takes — the proxy in the machine's own settings, or a direct
 * connection — because after a failure that is the first thing worth knowing.
 */
const PANEL_API = 5

const zh = {
  panel: 'New API',
  consoleTitle: 'New API 控制台',
  running: '运行中',
  stopped: '未运行',
  loading: '读取中…',
  unreachable: '读不到插件状态：面板需要 Harness 的 Web 服务',
  notRunning: '网关未运行，暂时无法显示控制台',
  retry: '重试',
  reload: '重新加载',
  openExternal: '新窗口打开',
  crossSiteHint:
    '桌面 App 的页面来自 dsh-app://，内嵌的控制台属于跨站框架，浏览器不会保存它的登录状态，因此每次进来都要重新登录。需要常驻登录请用「新窗口打开」，或在浏览器里打开 Harness。',
  configure: '配置',
  syncModels: '同步模型',
  error: '错误',
  providerFailed: '未能写入 DSH 模型配置',
  providerSynced: '已把网关当前的模型同步到 DSH 模型配置',
  staleHost: '插件的前端是新的，但 Host 还是旧代码，这里的配置改不动。请在 Plugins 页把 dsh-newapi 关掉再打开（或重启 DSH）。',
  setupTitle: '首次运行配置',
  setupIntro:
    'New API 还没有初始化。填好下面两项后点「完成」，插件会用这些设置启动网关并完成初始化，随后直接进入 New API 控制台。',
  configTitle: '配置 New API',
  configIntro: '改端口会重启网关；要改 root 密码请点右侧的「编辑」。改密码后控制台需要重新登录一次。',
  setupPort: '端口号',
  setupPassword: 'root 密码',
  setupPasswordHint: '8–128 个字符，请自行保存；这是管理员账号的密码',
  setupPasswordKeepHint: '留空表示不修改当前密码',
  setupEdit: '编辑',
  setupCancelEdit: '取消编辑',
  copyPassword: '复制密码',
  showPassword: '显示密码',
  hidePassword: '隐藏密码',
  setupSubmit: '完成',
  setupCancel: '取消',
  setupPortInvalid: '端口号需要是 1–65535 之间的整数',
  setupPasswordInvalid: 'root 密码长度需要是 8–128 个字符',
  setupPasswordConsoleHint:
    '若这里改不动（例如账号已启用二次验证），可在 New API 控制台的「个人设置」里修改密码。',
  setupSubmitting: '正在启动 New API，首次运行可能还要下载二进制…',
  setupAccepted: '设置已提交，正在启动 New API…',
  setupApplying: '正在应用配置…',
  setupApplied: '配置已更新',
  setupAppliedPassword: '配置已更新，root 密码已修改',
  setupAppliedPort: '配置已更新，网关已在端口 {port} 重启',
  setupAppliedBoth: '配置已更新，root 密码已修改，网关已在端口 {port} 重启',
  starting: '启动中…',
  bootTitle: '正在启动 New API 网关',
  bootIntro:
    '插件正在准备网关。首次安装需要下载网关程序（约 128 MB），这一步只发生一次；完成后这里会自动显示控制台，期间请保持 DSH 开着。',
  bootStepLocal: '查找本机已有的网关程序',
  bootStepRoute: '查找可用的网络出口（代理）',
  bootStepDownload: '下载网关程序',
  bootStepVerify: '校验下载文件（sha256）',
  bootStepLaunch: '启动网关进程',
  bootStepProvision: '初始化实例、创建访问令牌',
  bootStepDone: '已完成',
  bootStepNow: '进行中',
  bootStepFailed: '失败',
  routeDirect: '直连下载服务器（没有使用代理）',
  routeProxy: '通过 {proxy} 下载（{source}）',
  routeSocks: '本机只配置了 SOCKS 代理 {address}，插件只会说 HTTP 代理',
  routeTried: '已尝试的出口：{route}',
  routeSourceEnvironment: '环境变量 {via}',
  routeSourceWindows: 'Windows 系统代理设置',
  routeSourceLocalPort: '本机探测到的代理端口',
  bootAttempt: '第 {attempt}/{attempts} 次尝试',
  bootElapsed: '已用时 {seconds}',
  bootRetryIn: '{seconds} 秒后自动重试',
  bootDownloading: '正在下载 {asset}',
  bootReceivedOf: '已下载 {received} / {total}',
  bootReceived: '已下载 {received}',
  bootSpeed: '{speed}/s',
  bootEta: '预计还需 {eta}',
  bootSource: '下载源：{url}',
  bootCache: '下载完成后会校验并缓存到 {cacheDir}，之后的启动不再联网。',
  bootKeepOpen: '下载期间请勿关闭 DSH；浏览器刷新或离开这一页都不会中断下载。',
  bootWaitingForm: '等待填写首次运行设置。',
  failTitleNetwork: '下载网关程序失败：连不上下载服务器',
  failTitleChecksum: '下载的网关程序校验不通过',
  failTitlePort: '找不到可用的端口',
  failTitleGateway: '网关进程启动后退出',
  failTitleTimeout: '网关启动后没有响应',
  failTitleUnknown: '网关启动失败',
  failCause: '原因',
  failHowTo: '可以这样处理',
  failNetworkDirect:
    '插件先试了直连（Node 的 fetch 不使用系统代理），失败后在本机也没有找到可用出口：环境变量、Windows 的代理设置、常见代理端口都没有代理。',
  failNetworkProxyGuess:
    '若本机有 HTTP 代理（Clash / v2ray 这类客户端常见是 7890、10809），可设置 HTTPS_PROXY=http://127.0.0.1:<端口> 后重启 DSH。',
  failNetworkRouted: '请确认这个代理现在能打开 github.com；也可以换一条出口（在代理客户端里改，或设置 HTTPS_PROXY 后重启 DSH）再点「重试启动」。',
  failNetworkSocks:
    '本机配置的代理是 SOCKS（{address}），而插件只会说 HTTP 代理。请在代理客户端里打开 HTTP 端口，或设置 HTTPS_PROXY 指向那个 HTTP 端口后重启 DSH。',
  failNetworkManual: '手动下载：用浏览器打开 {releaseUrl}，把下载到的文件放到 {dropInPath}。放在这个位置的文件会被直接使用，不再联网校验。',
  failNetworkBinaryPath: '若本机已经有 new-api 程序，可在插件行里设置 binaryPath 指向它（profile 的 cordis.patch.yml）。',
  failChecksumRetry: '下载到的内容与官方校验清单不一致，通常是网络中断或代理改写了内容。点下方「重试启动」重新下载。',
  failChecksumManual: '若反复失败，用浏览器下载 {releaseUrl}，把文件放到 {dropInPath}。',
  failPortAdvice: '端口 {port} 附近没有可用端口（被占用或权限不足）。请在「配置」里换一个端口，或改插件行里的 port。',
  failGatewayAdvice:
    '网关进程启动后立即退出。常见原因是端口被占用、数据目录不可写、杀毒软件拦截；上面的「原因」里有它自己打印的说明。',
  failGatewayData: '确认这个目录可写：{dataDir}',
  failTimeoutAdvice: '进程起来了但一直没有响应 /api/status。可能是防火墙拦截，或首次启动仍在做数据库迁移。点「重试启动」再等一次。',
  failUnknownAdvice: '把下面的日志内容发出来即可定位。',
  failRetry: '重试启动',
  failRetrying: '正在重试…',
  failLog: '日志',
  failCopyLog: '复制日志路径',
  failCopied: '已复制',
  failRetryRefused: '重试没有开始',
}

const en = {
  panel: 'New API',
  consoleTitle: 'New API console',
  running: 'Running',
  stopped: 'Not running',
  loading: 'Reading…',
  unreachable: 'Cannot read the plugin status: the panel needs the Harness web server',
  notRunning: 'The gateway is not running, so the console cannot be shown',
  retry: 'Retry',
  reload: 'Reload',
  openExternal: 'Open in a new window',
  crossSiteHint:
    'This window is served from dsh-app://, so the embedded console is a cross-site frame and the browser will not keep its login. Use "Open in a new window", or open the Harness in a browser, to stay signed in.',
  configure: 'Configure',
  syncModels: 'Sync models',
  error: 'Error',
  providerFailed: 'Not added to the DSH model configuration',
  providerSynced: 'The gateway\u2019s current models were handed to the DSH model configuration',
  staleHost: 'The panel is newer than the Host half, which still runs the old code, so settings cannot be changed here. Toggle dsh-newapi off and on in the Plugins page (or restart DSH).',
  setupTitle: 'First-run setup',
  setupIntro:
    'New API has not been initialised yet. Fill in these two settings and choose Finish: the plugin starts the gateway with them, completes the initialisation, and opens the New API console.',
  configTitle: 'Configure New API',
  configIntro:
    'A new port restarts the gateway; choose Edit beside the root password to change it. Changing the password signs the console out once.',
  setupPort: 'Port',
  setupPassword: 'Root password',
  setupPasswordHint: '8–128 characters, worth saving: this is the administrator password',
  setupPasswordKeepHint: 'Leave empty to keep the current password',
  setupEdit: 'Edit',
  setupCancelEdit: 'Cancel edit',
  copyPassword: 'Copy password',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  setupSubmit: 'Finish',
  setupCancel: 'Cancel',
  setupPortInvalid: 'The port must be an integer between 1 and 65535',
  setupPasswordInvalid: 'The root password must be 8–128 characters',
  setupPasswordConsoleHint:
    'If this refuses — a second factor on the account, for example — change the password in the New API console under personal settings.',
  setupSubmitting: 'Starting New API; a first run may still be downloading the binary…',
  setupAccepted: 'The settings were accepted; New API is starting…',
  setupApplying: 'Applying the settings…',
  setupApplied: 'Settings updated',
  setupAppliedPassword: 'Settings updated; the root password changed',
  setupAppliedPort: 'Settings updated; the gateway restarted on port {port}',
  setupAppliedBoth: 'Settings updated; the root password changed and the gateway restarted on port {port}',
  starting: 'Starting…',
  bootTitle: 'Starting the New API gateway',
  bootIntro:
    'The plugin is preparing the gateway. A first install downloads the gateway program (about 128 MB), which happens once; the console appears here by itself when it is ready, so leave DSH running.',
  bootStepLocal: 'Look for a gateway program this machine already has',
  bootStepRoute: 'Find a route out to the download server (proxy)',
  bootStepDownload: 'Download the gateway program',
  bootStepVerify: 'Check the download (sha256)',
  bootStepLaunch: 'Start the gateway process',
  bootStepProvision: 'Initialise the instance and create its token',
  bootStepDone: 'Done',
  bootStepNow: 'In progress',
  bootStepFailed: 'Failed',
  routeDirect: 'Straight to the download server (no proxy)',
  routeProxy: 'Through {proxy} ({source})',
  routeSocks: 'This machine configures only a SOCKS proxy at {address}, and this plugin speaks HTTP proxies',
  routeTried: 'Route already tried: {route}',
  routeSourceEnvironment: 'the {via} environment variable',
  routeSourceWindows: 'the Windows proxy settings',
  routeSourceLocalPort: 'a proxy port found on this machine',
  bootAttempt: 'Attempt {attempt} of {attempts}',
  bootElapsed: '{seconds} elapsed',
  bootRetryIn: 'Retrying in {seconds}s',
  bootDownloading: 'Downloading {asset}',
  bootReceivedOf: '{received} of {total} downloaded',
  bootReceived: '{received} downloaded',
  bootSpeed: '{speed}/s',
  bootEta: 'about {eta} left',
  bootSource: 'Source: {url}',
  bootCache: 'It is verified and cached in {cacheDir}, so later starts need no network.',
  bootKeepOpen: 'Leave DSH running while it downloads; refreshing this page or leaving it does not interrupt the download.',
  bootWaitingForm: 'Waiting for the first-run settings.',
  failTitleNetwork: 'Could not download the gateway program: the download server is unreachable',
  failTitleChecksum: 'The downloaded gateway program failed its checksum',
  failTitlePort: 'No free port was found',
  failTitleGateway: 'The gateway process exited after it started',
  failTitleTimeout: 'The gateway started but never answered',
  failTitleUnknown: 'The gateway could not be started',
  failCause: 'Cause',
  failHowTo: 'Ways out',
  failNetworkDirect:
    'The plugin tried a direct connection first (Node\u2019s fetch does not use the system proxy) and found no usable way out on this machine either: no environment variable, nothing in the Windows proxy settings, and nothing on the ports a desktop proxy client uses.',
  failNetworkProxyGuess:
    'If this machine runs an HTTP proxy (Clash and v2ray usually listen on 7890 or 10809), set HTTPS_PROXY=http://127.0.0.1:<port> and restart DSH.',
  failNetworkRouted:
    'Check that this proxy can open github.com right now; you can also point the machine at another route (in the proxy client, or with HTTPS_PROXY) and choose Retry.',
  failNetworkSocks:
    'This machine configures a SOCKS proxy at {address}, and this plugin speaks HTTP proxies. Turn on the client\u2019s HTTP port, or set HTTPS_PROXY to that HTTP port and restart DSH.',
  failNetworkManual:
    'Or download it by hand: open {releaseUrl} in a browser and put the file at {dropInPath}. A file in that place is used as it stands, with no network check.',
  failNetworkBinaryPath:
    'If this machine already has a new-api program, set binaryPath to it on the plugin row (cordis.patch.yml in the profile).',
  failChecksumRetry:
    'The bytes on disk do not match the published checksum, which usually means an interrupted transfer or a proxy that rewrote the body. Choose Retry below to fetch it again.',
  failChecksumManual: 'If it keeps failing, download {releaseUrl} in a browser and put the file at {dropInPath}.',
  failPortAdvice:
    'No port near {port} could be used (taken, or not permitted). Choose another port under Configure, or change port on the plugin row.',
  failGatewayAdvice:
    'The process exited right after it started. The usual causes are a port already in use, a data directory it cannot write, or antivirus blocking it; the cause above is what it printed itself.',
  failGatewayData: 'Check that this directory is writable: {dataDir}',
  failTimeoutAdvice:
    'The process started but never answered /api/status. A firewall may be blocking it, or a first start may still be migrating its database. Choose Retry to wait once more.',
  failUnknownAdvice: 'The log below is what identifies this one.',
  failRetry: 'Retry',
  failRetrying: 'Retrying…',
  failLog: 'Log',
  failCopyLog: 'Copy log path',
  failCopied: 'Copied',
  failRetryRefused: 'The retry did not start',
}

/** Gateway glyph: two stacked server rows with a routing link. */
function GatewayIcon({ size }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01M12 10v4" />
    </svg>
  )
}

/** One outline glyph at the size the password row uses. */
function Glyph({ children }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Two overlapping sheets: copy the value in the field. */
function CopyIcon() {
  return (
    <Glyph>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </Glyph>
  )
}

/** A check: the copy landed. */
function CheckIcon() {
  return (
    <Glyph>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  )
}

/** An eye, and the same eye struck through: reveal the password or hide it again. */
function EyeIcon() {
  return (
    <Glyph>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  )
}

function EyeOffIcon() {
  return (
    <Glyph>
      <path d="M4 5l16 14M9.9 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.2 4M6.4 7.4A17.6 17.6 0 0 0 2 12s3.6 7 10 7a10.9 10.9 0 0 0 4-.75" />
    </Glyph>
  )
}

/** A pencil: change the password instead of accepting the one shown. */
function PencilIcon() {
  return (
    <Glyph>
      <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="M13.5 6.5 17.5 10.5" />
    </Glyph>
  )
}

/** A backward arrow: abandon the edit and show the password in use again. */
function UndoIcon() {
  return (
    <Glyph>
      <path d="M4 9h11a5 5 0 0 1 0 10H9" />
      <path d="M8 5 4 9l4 4" />
    </Glyph>
  )
}

/** One icon button, sized to sit beside a text field. */
function IconButton({ label, onClick, disabled, children }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} style={styles.iconButton}>
      {children}
    </button>
  )
}

/** How long the copy confirmation stays visible. */
const COPY_FEEDBACK_MS = 1600

/**
 * Copy text, falling back to the selection trick where the clipboard API is not
 * available (the desktop shell's `dsh-app://` document is not a secure context).
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the selection path.
  }
  try {
    const holder = document.createElement('textarea')
    holder.value = text
    holder.setAttribute('readonly', '')
    holder.style.position = 'fixed'
    holder.style.top = '-1000px'
    document.body.appendChild(holder)
    holder.select()
    const copied = document.execCommand('copy')
    holder.remove()
    return copied
  } catch {
    return false
  }
}

/**
 * The settings form, in both of the places it is used: the first run, where the
 * Host has no port and no root password yet and knows nothing until this
 * answers, and the 配置 button, where an instance already running is asked to
 * change. Only the first run asks for a password outright: the one in use is
 * shown, and the pencil beside it is what turns the field into a new password.
 */
function SettingsPanel({ t, firstRun, initialPort, initialPassword, onAccepted, onApplied, onCancel }) {
  const [port, setPort] = useState(String(initialPort))
  // The password in use is shown, not offered for typing: replacing it is a
  // separate intention, and the pencil beside the field is how it is expressed.
  const [editing, setEditing] = useState(firstRun)
  const [password, setPassword] = useState(firstRun ? '' : (initialPassword ?? ''))
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(undefined)
  const [submitted, setSubmitted] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const chosen = Number(port)
    if (!Number.isInteger(chosen) || chosen < 1 || chosen > MAX_PORT) {
      setError(t('setupPortInvalid'))
      return
    }
    // An empty field, or the password already in use, means "keep it": nothing is
    // sent for it, so a historical password shorter than today's policy is not
    // asked to satisfy one it never had to.
    const keepPassword = password === '' || password === (initialPassword ?? '')
    if (!keepPassword) {
      const length = [...password].length
      if (length < PASSWORD_MIN_CHARS || length > PASSWORD_MAX_CHARS) {
        setError(t('setupPasswordInvalid'))
        return
      }
    } else if (firstRun) {
      setError(t('setupPasswordInvalid'))
      return
    }
    setError(undefined)
    setSubmitted(true)
    try {
      const response = await fetch(SETUP_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(keepPassword ? { port: chosen } : { port: chosen, rootPassword: password }),
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok) {
        setError(body?.error ?? `HTTP ${response.status}`)
        setSubmitted(false)
        return
      }
      if (body?.accepted === true) onAccepted()
      else onApplied(body)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setSubmitted(false)
    }
  }

  return (
    <div style={styles.setupScreen}>
      <form style={styles.setup} onSubmit={submit}>
        <div style={styles.setupHeader}>
          <span style={styles.setupGlyph}>
            <GatewayIcon size={16} />
          </span>
          <div style={styles.setupHeading}>
            <h2 style={styles.setupTitle}>{firstRun ? t('setupTitle') : t('configTitle')}</h2>
            <p style={styles.setupIntro}>{firstRun ? t('setupIntro') : t('configIntro')}</p>
          </div>
        </div>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>{t('setupPort')}</span>
          <input
            type="number"
            min="1"
            max={MAX_PORT}
            step="1"
            required
            value={port}
            onChange={(event) => {
              setPort(event.target.value)
            }}
            style={styles.input}
            {...focusRing}
          />
        </label>
        <div style={styles.field}>
          <span style={styles.fieldLabel}>{t('setupPassword')}</span>
          {editing ? (
            <>
              <div style={styles.passwordRow}>
                <input
                  type="password"
                  required={firstRun}
                  autoComplete="new-password"
                  spellCheck={false}
                  autoFocus
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                  }}
                  style={styles.input}
                  {...focusRing}
                />
                {!firstRun && (
                  <IconButton
                    label={t('setupCancelEdit')}
                    disabled={submitted}
                    onClick={() => {
                      setEditing(false)
                      setPassword(initialPassword ?? '')
                    }}
                  >
                    <UndoIcon />
                  </IconButton>
                )}
              </div>
              <span style={styles.fieldHint}>
                {t('setupPasswordHint')}
                {firstRun ? '' : ` · ${t('setupPasswordKeepHint')}`}
              </span>
            </>
          ) : (
            <div style={styles.passwordRow}>
              <input
                type={revealed ? 'text' : 'password'}
                readOnly
                value={initialPassword ?? ''}
                aria-label={t('setupPassword')}
                style={{ ...styles.input, ...styles.readonly }}
              />
              <IconButton
                label={t('copyPassword')}
                disabled={submitted}
                onClick={async () => {
                  setCopied(await copyText(initialPassword ?? ''))
                  setTimeout(() => {
                    setCopied(false)
                  }, COPY_FEEDBACK_MS)
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </IconButton>
              <IconButton
                label={revealed ? t('hidePassword') : t('showPassword')}
                disabled={submitted}
                onClick={() => {
                  setRevealed(!revealed)
                }}
              >
                {revealed ? <EyeOffIcon /> : <EyeIcon />}
              </IconButton>
              <IconButton
                label={t('setupEdit')}
                disabled={submitted}
                onClick={() => {
                  setEditing(true)
                  setPassword('')
                }}
              >
                <PencilIcon />
              </IconButton>
            </div>
          )}
        </div>
        {error !== undefined && <p style={styles.setupError}>{error}</p>}
        {error !== undefined && !firstRun && <p style={styles.fieldHint}>{t('setupPasswordConsoleHint')}</p>}
        <div style={styles.actions}>
          <button type="submit" style={{ ...styles.button, ...styles.primary }} disabled={submitted}>
            {t('setupSubmit')}
          </button>
          {!firstRun && (
            <button type="button" style={styles.button} onClick={onCancel} disabled={submitted}>
              {t('setupCancel')}
            </button>
          )}
          {submitted && <span style={styles.fieldHint}>{firstRun ? t('setupSubmitting') : t('setupApplying')}</span>}
        </div>
      </form>
    </div>
  )
}

/** The steps of a boot, in the order the Host enters them; keys of the dictionary. */
const BOOT_STEPS = [
  'bootStepLocal',
  'bootStepRoute',
  'bootStepDownload',
  'bootStepVerify',
  'bootStepLaunch',
  'bootStepProvision',
]

/**
 * Which of those steps a progress record is on. The Host reports a phase and,
 * inside `preparing`, the finer step it is working on; everything else follows
 * from the phase, so the panel never has to guess from a byte count.
 * @param progress - the record from the status payload.
 * @returns the index into {@link BOOT_STEPS}.
 */
function bootStepIndex(progress) {
  if (progress?.phase === 'downloading') return 2
  if (progress?.phase === 'starting') return 4
  if (progress?.phase === 'provisioning') return 5
  if (progress?.step === 'download' || progress?.step === 'manifest') return 2
  if (progress?.step === 'verify') return 3
  if (progress?.step === 'route') return 1
  return 0
}

/** Replace the `{placeholders}` of one line with the values it names. */
function fill(text, values) {
  return Object.entries(values).reduce((line, [key, value]) => line.replace(`{${key}}`, String(value)), text)
}

/**
 * Where a route came from, in the panel's own words. The Host reports a token
 * rather than a sentence, so the two languages stay written on this side.
 * @param t - the dictionary for the language in use.
 * @param route - the route facts from the status payload.
 * @returns the source, spelled out.
 */
function routeSource(t, route) {
  switch (route?.source) {
    case 'windows':
      return t('routeSourceWindows')
    case 'local-port':
      return t('routeSourceLocalPort')
    default:
      return fill(t('routeSourceEnvironment'), { via: route?.via ?? 'HTTPS_PROXY' })
  }
}

/**
 * One route as a sentence: which address the download went through, and where
 * that address came from. A direct connection is worth saying out loud, because
 * it is the answer to "did the plugin use my proxy or not".
 * @param t - the dictionary for the language in use.
 * @param route - the route facts from the status payload, or nothing yet.
 * @returns the line to show, or `undefined` when there is nothing to say.
 */
function routeLabel(t, route) {
  if (route === undefined) return undefined
  if (route.source === 'socks') return fill(t('routeSocks'), { address: route.address ?? '?' })
  if (route.url === undefined) return t('routeDirect')
  return fill(t('routeProxy'), { proxy: route.url, source: routeSource(t, route) })
}

/** `12.3 MB`: the units a download is described in, in both languages. */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return undefined
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]}`
}

/** A wait, read the way a person reads one: seconds up to a minute, then minutes. */
function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return undefined
  const whole = Math.round(seconds)
  if (whole < 60) return `${whole}s`
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
}

/** The advice one classified failure calls for, in the panel's own words. */
function failureWays(t, hint) {
  const manual = []
  if (hint.releaseUrl !== undefined && hint.dropInPath !== undefined) {
    manual.push(fill(t('failNetworkManual'), { releaseUrl: hint.releaseUrl, dropInPath: hint.dropInPath }))
  }
  switch (hint.kind) {
    case 'network': {
      const route = hint.route
      const ways = []
      if (route?.source === 'socks') {
        ways.push(fill(t('failNetworkSocks'), { address: route.address ?? '?' }))
      } else if (route?.url !== undefined) {
        // The plugin already used the machine's proxy: advising a person to set
        // the same proxy in an environment variable would be advice to repeat
        // what has just failed. The route itself is stated beside the cause.
        ways.push(t('failNetworkRouted'))
      } else {
        ways.push(t('failNetworkDirect'))
        ways.push(t('failNetworkProxyGuess'))
      }
      ways.push(...manual)
      ways.push(t('failNetworkBinaryPath'))
      return ways
    }
    case 'checksum':
      return [t('failChecksumRetry'), ...manual]
    case 'port':
      return [fill(t('failPortAdvice'), { port: hint.port ?? '?' })]
    case 'gateway':
      return [t('failGatewayAdvice'), fill(t('failGatewayData'), { dataDir: hint.dataDir ?? '?' })]
    case 'timeout':
      return [t('failTimeoutAdvice')]
    default:
      return [t('failUnknownAdvice')]
  }
}

/** The headline one classified failure gets. */
function failureTitle(t, kind) {
  switch (kind) {
    case 'network':
      return t('failTitleNetwork')
    case 'checksum':
      return t('failTitleChecksum')
    case 'port':
      return t('failTitlePort')
    case 'gateway':
      return t('failTitleGateway')
    case 'timeout':
      return t('failTitleTimeout')
    default:
      return t('failTitleUnknown')
  }
}

/**
 * What the panel shows while the gateway is not up yet but is being worked on:
 * the step it is on, and — during the one step that takes minutes — how far the
 * download has come and where it is going. A first install that downloads a
 * 128 MB release must not look like a plugin that does not work.
 */
function BootPanel({ t, facts }) {
  const progress = facts.progress ?? {}
  const download = progress.download
  const route = routeLabel(t, progress.route)
  const step = bootStepIndex(progress)
  const retrying = progress.phase === 'retrying'
  const attempt = typeof progress.attempt === 'number' ? progress.attempt : 0
  const attempts = typeof progress.attempts === 'number' ? progress.attempts : 0
  const elapsedSince = progress.since === undefined ? undefined : Date.parse(progress.since)
  const elapsed = elapsedSince === undefined || Number.isNaN(elapsedSince)
    ? undefined
    : Math.max(0, Math.round((Date.now() - elapsedSince) / 1000))
  const retryAt = progress.retryAt === undefined ? undefined : Date.parse(progress.retryAt)
  const retryIn = retryAt === undefined || Number.isNaN(retryAt)
    ? undefined
    : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))

  const total = download?.totalBytes
  const received = download?.receivedBytes
  const percent = typeof total === 'number' && typeof received === 'number' && total > 0
    ? Math.max(0, Math.min(100, Math.round((received / total) * 100)))
    : undefined

  return (
    <div style={styles.bootScreen}>
      <div style={styles.bootCard}>
        <div style={styles.setupHeader}>
          <span style={styles.setupGlyph}>
            <GatewayIcon size={16} />
          </span>
          <div style={styles.setupHeading}>
            <h2 style={styles.setupTitle}>{t('bootTitle')}</h2>
            <p style={styles.setupIntro}>{t('bootIntro')}</p>
          </div>
        </div>

        <ol style={styles.steps}>
          {BOOT_STEPS.map((key, index) => {
            const state = index < step ? 'done' : index === step ? (retrying ? 'failed' : 'now') : 'todo'
            return (
              <li key={key} style={styles.step}>
                <span
                  style={{
                    ...styles.stepDot,
                    ...(state === 'done' ? styles.stepDotDone : undefined),
                    ...(state === 'now' ? styles.stepDotNow : undefined),
                    ...(state === 'failed' ? styles.stepDotFailed : undefined),
                  }}
                >
                  {state === 'done' ? '✓' : index + 1}
                </span>
                <span style={state === 'todo' ? styles.stepLabelTodo : styles.stepLabel}>{t(key)}</span>
                {state === 'now' && <span style={styles.stepMark}>{t('bootStepNow')}</span>}
                {state === 'failed' && <span style={styles.stepMarkFailed}>{t('bootStepFailed')}</span>}
              </li>
            )
          })}
        </ol>

        {route !== undefined && <p style={styles.fieldHint}>{route}</p>}

        {download !== undefined && received !== undefined && (
          <div style={styles.download}>
            <div style={styles.progressHead}>
              <span style={styles.progressLabel}>
                {download.asset === undefined
                  ? t('bootStepDownload')
                  : t('bootDownloading').replace('{asset}', download.asset)}
              </span>
              {percent !== undefined && <span style={styles.muted}>{percent}%</span>}
            </div>
            <div style={styles.progressTrack}>
              {percent !== undefined && <div style={{ ...styles.progressBar, width: `${percent}%` }} />}
            </div>
            <div style={styles.progressMeta}>
              <span>
                {(total === undefined
                  ? t('bootReceived')
                  : t('bootReceivedOf')
                )
                  .replace('{received}', formatBytes(received) ?? '')
                  .replace('{total}', formatBytes(total) ?? '')}
              </span>
              {formatBytes(download.bytesPerSecond) !== undefined && (
                <span>{t('bootSpeed').replace('{speed}', formatBytes(download.bytesPerSecond))}</span>
              )}
              {formatDuration(download.etaSeconds) !== undefined && (
                <span>{t('bootEta').replace('{eta}', formatDuration(download.etaSeconds))}</span>
              )}
            </div>
            {download.cacheDir !== undefined && (
              <p style={styles.fieldHint}>{t('bootCache').replace('{cacheDir}', download.cacheDir)}</p>
            )}
            <p style={styles.fieldHint}>{t('bootKeepOpen')}</p>
          </div>
        )}

        <div style={styles.bootMeta}>
          {attempt > 0 && (
            <span style={styles.muted}>
              {t('bootAttempt').replace('{attempt}', String(attempt)).replace('{attempts}', String(attempts))}
            </span>
          )}
          {elapsed !== undefined && (
            <span style={styles.muted}>{t('bootElapsed').replace('{seconds}', String(elapsed))}</span>
          )}
          {retryIn !== undefined && (
            <span style={styles.retryNote}>{t('bootRetryIn').replace('{seconds}', String(retryIn))}</span>
          )}
        </div>

        {retrying && progress.error !== undefined && <p style={styles.bootCause}>{progress.error}</p>}
        {facts.logPath !== undefined && (
          <p style={styles.fieldHint}>
            {t('failLog')}: <code style={styles.code}>{facts.logPath}</code>
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * What the panel shows when the bootstrap gave up: the classified reason, what
 * it printed itself, the ways out, and a button that runs the boot again — so
 * nobody has to know that toggling the plugin off and on used to be the only way.
 */
function FailurePanel({ t, facts, onRetry, retrying, refused }) {
  const hint = facts.hint ?? {}
  const [copied, setCopied] = useState(false)
  const ways = failureWays(t, hint)
  // Which way the download already went is a fact, not advice: it belongs beside
  // the cause, and it is the first thing a person behind a proxy wants to know.
  const tried = hint.kind === 'network' ? routeLabel(t, hint.route) : undefined
  return (
    <div style={styles.bootScreen}>
      <div style={styles.bootCard}>
        <div style={styles.setupHeader}>
          <span style={{ ...styles.setupGlyph, ...styles.setupGlyphError }}>
            <GatewayIcon size={16} />
          </span>
          <div style={styles.setupHeading}>
            <h2 style={styles.setupTitle}>{failureTitle(t, hint.kind)}</h2>
          </div>
        </div>

        <div style={styles.failBlock}>
          <div style={styles.failLabel}>{t('failCause')}</div>
          <pre style={styles.failPre}>{facts.error ?? ''}</pre>
          {tried !== undefined && (
            <p style={styles.fieldHint}>{t('routeTried').replace('{route}', tried)}</p>
          )}
        </div>

        <div style={styles.failBlock}>
          <div style={styles.failLabel}>{t('failHowTo')}</div>
          <ol style={styles.failWays}>
            {ways.map((way) => (
              <li key={way} style={styles.failWay}>
                {way}
              </li>
            ))}
          </ol>
        </div>

        {refused !== undefined && <p style={styles.setupError}>{t('failRetryRefused')} — {refused}</p>}

        <div style={styles.actions}>
          <button type="button" style={{ ...styles.button, ...styles.primary }} disabled={retrying} onClick={onRetry}>
            {retrying ? t('failRetrying') : t('failRetry')}
          </button>
          {facts.logPath !== undefined && (
            <button
              type="button"
              style={styles.button}
              onClick={async () => {
                setCopied(await copyText(facts.logPath))
                setTimeout(() => {
                  setCopied(false)
                }, COPY_FEEDBACK_MS)
              }}
            >
              {copied ? t('failCopied') : t('failCopyLog')}
            </button>
          )}
        </div>
        {facts.logPath !== undefined && (
          <p style={styles.fieldHint}>
            {t('failLog')}: <code style={styles.code}>{facts.logPath}</code>
          </p>
        )}
      </div>
    </div>
  )
}

/** The panel rendered in the main column when the sidebar entry is selected. */
function GatewayPanel({ t }) {
  const [state, setState] = useState({ phase: 'loading' })
  // Set once this browser has handed the first-run settings over, so the panel
  // keeps waiting for the gateway instead of showing the form again while the
  // Host is still starting it.
  const [accepted, setAccepted] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [applied, setApplied] = useState(undefined)
  const [synced, setSynced] = useState(undefined)
  const [reloadKey, setReloadKey] = useState(0)
  // The retry the panel asks the Host for, and what it answered when it refused.
  const [retrying, setRetrying] = useState(false)
  const [refused, setRefused] = useState(undefined)

  const load = useCallback(async () => {
    try {
      const response = await fetch(STATUS_PATH, { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!response.ok) {
        setState({ phase: 'error', message: `HTTP ${response.status}` })
        return
      }
      setState({ phase: 'ready', facts: await response.json() })
    } catch (error) {
      setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  // The bootstrap gave up and the person has just dealt with the cause — a proxy
  // setting, a port, a firewall. This is what makes that fix take effect without
  // toggling the plugin off and on.
  const retryBoot = useCallback(async () => {
    setRetrying(true)
    setRefused(undefined)
    try {
      const response = await fetch(RETRY_PATH, { method: 'POST', headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => undefined)
      if (!response.ok) setRefused(body?.error ?? `HTTP ${response.status}`)
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error))
    } finally {
      setRetrying(false)
      await load()
    }
  }, [load])

  // The gateway's channels are added in its own console, which this panel cannot
  // see, so the model list it advertises is refreshed on demand rather than by a
  // restart of the harness.
  const syncModels = useCallback(async () => {
    try {
      const response = await fetch(SYNC_PATH, { method: 'POST', headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => undefined)
      setSynced(
        response.ok
          ? t('providerSynced')
          : `${t('providerFailed')} — ${body?.error ?? `HTTP ${response.status}`}`,
      )
      await load()
    } catch (error) {
      setSynced(`${t('providerFailed')} — ${error instanceof Error ? error.message : String(error)}`)
    }
    setTimeout(() => {
      setSynced(undefined)
    }, APPLIED_FEEDBACK_MS)
  }, [load, t])

  const facts = state.phase === 'ready' ? state.facts : undefined
  const needsSetup = facts?.needsSetup === true
  const progress = facts?.progress
  // The boot's own account of itself, which is what makes this panel able to say
  // "downloading 34 MB of 128 MB" instead of "not running". A Host older than
  // this contract sends none, and the panel then falls back to what it can see.
  const booting =
    progress?.phase === 'preparing' ||
    progress?.phase === 'downloading' ||
    progress?.phase === 'starting' ||
    progress?.phase === 'provisioning' ||
    progress?.phase === 'retrying'
  const failed = facts !== undefined && facts.running !== true && progress?.phase === 'failed'
  // A first run is the one time the panel has something to wait for, and it is
  // also the one time a slow answer is expected (the binary may be downloading).
  const waiting = accepted || needsSetup || booting

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      void load()
    }, waiting ? SETUP_POLL_MS : POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [load, waiting])

  if (needsSetup && !accepted) {
    return (
      <SettingsPanel
        t={t}
        firstRun
        initialPort={facts.defaultPort ?? 3000}
        onAccepted={() => {
          setAccepted(true)
        }}
      />
    )
  }

  const running = facts?.running === true
  // A gateway that is up is the only thing that un-does the first-run wait: an
  // answer from the Host that is not running is progress, not an outcome.
  const hasProgress = progress !== undefined
  const starting = !running && !failed && (booting || (accepted && hasProgress)) && state.phase !== 'error'
  // A Host that cannot describe its boot — an older bundle, which the panel
  // already flags as stale — keeps the one line this panel has always shown.
  const acceptedNotice = !running && !failed && !starting && accepted && state.phase !== 'error'
  const statusText = facts === undefined
    ? t('loading')
    : running
      ? t('running')
      : booting
        ? t('starting')
        : t('stopped')
  // The desktop shell serves its document from `dsh-app://app`, so the embedded
  // console is a cross-site frame whose SameSite=Strict session cookie the
  // browser refuses to keep. A browser-served Harness (http/https) is same-site
  // with the loopback gateway, so only that case is free of the caveat — and the
  // console proxy, when it is running, owns the session instead of the browser.
  const crossSite = !/^https?:$/.test(window.location.protocol)
  const bridged = facts?.consoleProxyUrl !== undefined
  // A protected route, so the dashboard resolves authentication against the
  // server on entry rather than rendering its public landing page.
  const consoleSrc = bridged ? `${facts.consoleProxyUrl}/console` : facts?.consoleUrl
  // new-api binds every interface, so the address another device would use is
  // the more useful one to show and to open; the embedded console stays on the
  // loopback proxy, which is what keeps it signed in.
  const shownUrl = facts?.lanBaseUrl ?? facts?.baseUrl
  const openUrl = facts?.lanConsoleUrl ?? facts?.consoleUrl

  if (running && configuring) {
    return (
      <SettingsPanel
        t={t}
        firstRun={false}
        initialPort={facts.port}
        initialPassword={facts.adminPassword}
        onCancel={() => {
          setConfiguring(false)
        }}
        onApplied={(result) => {
          setConfiguring(false)
          setApplied(result)
          setReloadKey((value) => value + 1)
          void load()
          setTimeout(() => {
            setApplied(undefined)
          }, APPLIED_FEEDBACK_MS)
        }}
      />
    )
  }

  // The boot gave up: say why, and offer the one action that tries again. This
  // is what a first install behind a blocked network used to be missing — the
  // panel said "not running" and the only way on was to toggle the plugin.
  if (failed) {
    return (
      <FailurePanel
        t={t}
        facts={facts}
        retrying={retrying}
        refused={refused}
        onRetry={() => {
          void retryBoot()
        }}
      />
    )
  }

  // Working, and not up yet: show the step and, while it downloads, the bytes.
  if (starting && state.phase !== 'error') {
    return <BootPanel t={t} facts={facts} />
  }

  return (
    <div style={styles.page}>
      <div style={styles.toolbar}>
        <span style={{ ...styles.dot, background: running ? '#3fb950' : '#8b949e' }} />
        <span style={styles.statusText}>New API</span>
        <span style={styles.muted}>{statusText}</span>
        {running && <code style={styles.url}>{shownUrl}</code>}
        <span style={styles.spacer} />
        {running && (
          <>
            <button type="button" style={styles.button} onClick={() => { setReloadKey((value) => value + 1) }}>
              {t('reload')}
            </button>
            <button type="button" style={styles.button} onClick={() => { void syncModels() }}>
              {t('syncModels')}
            </button>
            <a href={openUrl} target="_blank" rel="noreferrer noopener" style={styles.button}>
              {t('openExternal')}
            </a>
            <button type="button" style={styles.button} onClick={() => { setConfiguring(true) }}>
              {t('configure')}
            </button>
          </>
        )}
        {facts !== undefined && !running && !starting && !failed && (
          <button
            type="button"
            style={styles.button}
            disabled={retrying}
            onClick={() => {
              // A Host that reported a failure can be asked to run the boot
              // again; one that never got that far is only re-read, which is all
              // an older Host can answer.
              if (booting || retrying || facts.canRetry === false) {
                void load()
                return
              }
              void retryBoot()
            }}
          >
            {t('retry')}
          </button>
        )}
      </div>

      {state.phase === 'error' && (
        <p style={styles.notice}>{t('unreachable')} — {state.message}</p>
      )}
      {facts !== undefined && facts.panelApi !== PANEL_API && (
        <p style={styles.setupError}>{t('staleHost')}</p>
      )}
      {facts !== undefined && facts.error !== undefined && facts.error !== null && (
        <p style={styles.notice}>{t('error')}: {facts.error}</p>
      )}
      {applied !== undefined && <p style={styles.notice}>{appliedText(t, applied)}</p>}
      {synced !== undefined && <p style={styles.notice}>{synced}</p>}

      {running && crossSite && !bridged && <p style={styles.hint}>{t('crossSiteHint')}</p>}

      {running && (
        <iframe
          key={`${consoleSrc}#${reloadKey}`}
          src={consoleSrc}
          title={t('consoleTitle')}
          style={styles.frame}
        />
      )}
      {facts !== undefined && !running && (
        <p style={styles.notice}>{acceptedNotice ? t('setupAccepted') : t('notRunning')}</p>
      )}
    </div>
  )
}

/** What one applied change reports, in the terms of what it actually changed. */
function appliedText(t, applied) {
  if (applied.passwordChanged === true && applied.portChanged === true) {
    return t('setupAppliedBoth').replace('{port}', applied.port)
  }
  if (applied.passwordChanged === true) return t('setupAppliedPassword')
  if (applied.portChanged === true) return t('setupAppliedPort').replace('{port}', applied.port)
  return t('setupApplied')
}

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const secondary = 'var(--dsw-alias-label-secondary, #6b7280)'
const border = 'var(--dsw-alias-border-l1, #e3e5ea)'
const layer = 'var(--dsw-alias-bg-layer-1, #f7f8fa)'
const accent = '#3b6ef5'

/**
 * The focus ring CSS would otherwise own. Inline styles cannot express `:focus`,
 * and this form is the one place in the panel where typing happens.
 */
const focusRing = {
  onFocus: (event) => {
    event.currentTarget.style.borderColor = accent
    event.currentTarget.style.boxShadow = `0 0 0 3px ${accent}2e`
  },
  onBlur: (event) => {
    event.currentTarget.style.borderColor = border
    event.currentTarget.style.boxShadow = 'none'
  },
}

const styles = {
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    color: 'var(--dsw-alias-label-primary, #1c1e26)',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '13px',
  },
  toolbar: {
    alignItems: 'center',
    borderBottom: `1px solid ${border}`,
    display: 'flex',
    flex: '0 0 auto',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '8px 14px',
  },
  dot: { width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' },
  statusText: { fontWeight: 600 },
  spacer: { flex: '1 1 auto' },
  url: { color: secondary, fontFamily: mono, fontSize: '12px' },
  muted: { color: secondary },
  notice: { color: secondary, margin: '12px 14px' },
  setupScreen: {
    alignItems: 'center',
    boxSizing: 'border-box',
    display: 'flex',
    height: '100%',
    justifyContent: 'center',
    padding: '24px',
    width: '100%',
  },
  setup: {
    background: layer,
    border: `1px solid ${border}`,
    borderRadius: '12px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    maxWidth: '440px',
    padding: '20px 22px 22px',
    width: '100%',
    color: 'var(--dsw-alias-label-primary, #1c1e26)',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '13px',
  },
  setupHeader: { alignItems: 'flex-start', display: 'flex', gap: '10px' },
  setupGlyph: {
    alignItems: 'center',
    background: 'var(--dsw-alias-bg-base, #fff)',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    color: accent,
    display: 'flex',
    flex: '0 0 auto',
    height: '28px',
    justifyContent: 'center',
    width: '28px',
  },
  setupHeading: { display: 'flex', flexDirection: 'column', gap: '3px' },
  setupTitle: { fontSize: '14px', fontWeight: 600, margin: 0 },
  setupIntro: { color: secondary, fontSize: '12px', lineHeight: 1.6, margin: 0 },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  fieldLabel: { fontSize: '12px', fontWeight: 600 },
  fieldHint: { color: secondary, fontSize: '12px', lineHeight: 1.5, margin: 0 },
  input: {
    background: 'var(--dsw-alias-bg-base, #fff)',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    boxSizing: 'border-box',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: '13px',
    height: '32px',
    padding: '0 10px',
    transition: 'border-color 120ms ease, box-shadow 120ms ease',
    width: '100%',
  },
  setupError: {
    background: 'rgba(209, 36, 47, 0.08)',
    border: '1px solid rgba(209, 36, 47, 0.35)',
    borderRadius: '8px',
    color: 'var(--dsw-alias-label-error, #d1242f)',
    fontSize: '12px',
    lineHeight: 1.5,
    margin: 0,
    padding: '8px 10px',
  },
  // The boot and failure screens share one card: they are the two halves of the
  // same story, and a person sees them one after the other.
  bootScreen: {
    alignItems: 'flex-start',
    boxSizing: 'border-box',
    display: 'flex',
    height: '100%',
    justifyContent: 'center',
    overflow: 'auto',
    padding: '24px',
    width: '100%',
  },
  bootCard: {
    background: layer,
    border: `1px solid ${border}`,
    borderRadius: '12px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    maxWidth: '560px',
    padding: '20px 22px 22px',
    width: '100%',
    color: 'var(--dsw-alias-label-primary, #1c1e26)',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '13px',
  },
  setupGlyphError: {
    borderColor: 'rgba(209, 36, 47, 0.35)',
    color: 'var(--dsw-alias-label-error, #d1242f)',
  },
  code: { fontFamily: mono, fontSize: '11px', wordBreak: 'break-all' },
  steps: { display: 'flex', flexDirection: 'column', gap: '8px', listStyle: 'none', margin: 0, padding: 0 },
  step: { alignItems: 'center', display: 'flex', gap: '8px' },
  stepDot: {
    alignItems: 'center',
    background: 'var(--dsw-alias-bg-base, #fff)',
    border: `1px solid ${border}`,
    borderRadius: '50%',
    color: secondary,
    display: 'flex',
    flex: '0 0 auto',
    fontSize: '11px',
    height: '20px',
    justifyContent: 'center',
    width: '20px',
  },
  stepDotDone: { background: 'rgba(63, 185, 80, 0.12)', borderColor: 'rgba(63, 185, 80, 0.5)', color: '#2f9e44' },
  stepDotNow: { background: 'rgba(59, 110, 245, 0.12)', borderColor: accent, color: accent },
  stepDotFailed: {
    background: 'rgba(209, 36, 47, 0.1)',
    borderColor: 'rgba(209, 36, 47, 0.45)',
    color: 'var(--dsw-alias-label-error, #d1242f)',
  },
  stepLabel: { color: 'var(--dsw-alias-label-primary, #1c1e26)', fontSize: '12px' },
  stepLabelTodo: { color: secondary, fontSize: '12px' },
  stepMark: { color: accent, fontSize: '11px' },
  stepMarkFailed: { color: 'var(--dsw-alias-label-error, #d1242f)', fontSize: '11px' },
  download: {
    background: 'var(--dsw-alias-bg-base, #fff)',
    border: `1px solid ${border}`,
    borderRadius: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 14px',
  },
  progressHead: { alignItems: 'baseline', display: 'flex', gap: '8px', justifyContent: 'space-between' },
  progressLabel: { fontFamily: mono, fontSize: '12px' },
  progressTrack: {
    background: 'rgba(127, 127, 127, 0.18)',
    borderRadius: '999px',
    height: '6px',
    overflow: 'hidden',
    width: '100%',
  },
  progressBar: {
    background: accent,
    borderRadius: '999px',
    height: '100%',
    transition: 'width 400ms linear',
  },
  progressMeta: { color: secondary, display: 'flex', flexWrap: 'wrap', fontSize: '12px', gap: '12px' },
  bootMeta: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', fontSize: '12px', gap: '12px' },
  retryNote: { color: 'var(--dsw-alias-label-error, #d1242f)' },
  bootCause: {
    color: secondary,
    fontFamily: mono,
    fontSize: '11px',
    lineHeight: 1.5,
    margin: 0,
    maxHeight: '80px',
    overflow: 'auto',
    wordBreak: 'break-all',
  },
  failBlock: { display: 'flex', flexDirection: 'column', gap: '6px' },
  failLabel: { fontSize: '12px', fontWeight: 600 },
  failPre: {
    background: 'var(--dsw-alias-bg-base, #fff)',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    color: secondary,
    fontFamily: mono,
    fontSize: '11px',
    lineHeight: 1.5,
    margin: 0,
    maxHeight: '140px',
    overflow: 'auto',
    padding: '8px 10px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  failWays: {
    color: 'var(--dsw-alias-label-primary, #1c1e26)',
    display: 'flex',
    flexDirection: 'column',
    fontSize: '12px',
    gap: '6px',
    lineHeight: 1.6,
    margin: 0,
    paddingLeft: '18px',
  },
  failWay: { wordBreak: 'break-word' },
  actions: { alignItems: 'center', display: 'flex', gap: '8px', marginTop: '2px' },
  passwordRow: { alignItems: 'center', display: 'flex', gap: '4px' },
  readonly: { color: secondary, cursor: 'default', fontFamily: mono, fontSize: '12px' },
  iconButton: {
    alignItems: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: secondary,
    cursor: 'pointer',
    display: 'flex',
    flex: '0 0 auto',
    height: '28px',
    justifyContent: 'center',
    padding: 0,
    width: '28px',
  },
  primary: {
    background: accent,
    borderColor: accent,
    color: '#fff',
    fontWeight: 600,
    padding: '5px 18px',
  },
  hint: {
    background: layer,
    borderBottom: `1px solid ${border}`,
    color: secondary,
    flex: '0 0 auto',
    fontSize: '12px',
    lineHeight: 1.5,
    margin: 0,
    padding: '8px 14px',
  },
  frame: {
    background: 'var(--dsw-alias-bg-base, #fff)',
    border: 'none',
    display: 'block',
    flex: '1 1 auto',
    minHeight: 0,
    width: '100%',
  },
  button: {
    background: 'var(--dsw-alias-bg-base, #fff)',
    border: `1px solid ${border}`,
    borderRadius: '6px',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '3px 10px',
    textDecoration: 'none',
  },
}

/** Services the panel and its sidebar entry require. */
export const inject = ['slots', 'locale']

/**
 * Contribute the New API sidebar entry and the console panel it opens.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-newapi: dictionaries')
  const t = ctx.locale.bind(NS)

  // The entry and the panel share one id: the sidebar row selects the main
  // panel whose key matches it, exactly as the shipped Plugins page does.
  // `locale: NS` gives the page its `t` prop; the panel needs nothing else.
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, GatewayPanel),
  )
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: ORDER, label: () => t('panel'), locale: NS },
      GatewayIcon,
    ),
  )
}

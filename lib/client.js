window.__ModuleLoader__.load({
	id: "dsh-newapi",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var __defProp = Object.defineProperty;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		function __accessProp(key) {
		  return this[key];
		}
		var __toCommonJS = (from) => {
		  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
		  if (entry)
		    return entry;
		  entry = __defProp({}, "__esModule", { value: true });
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (var key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(entry, key))
		        __defProp(entry, key, {
		          get: __accessProp.bind(from, key),
		          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		        });
		  }
		  __moduleCache.set(from, entry);
		  return entry;
		};
		var __moduleCache;
		var __returnValue = (v) => v;
		function __exportSetter(name, newValue) {
		  this[name] = __returnValue.bind(null, newValue);
		}
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, {
		      get: all[name],
		      enumerable: true,
		      configurable: true,
		      set: __exportSetter.bind(all, name)
		    });
		};

		// src/client/index.jsx
		var exports_client = {};
		__export(exports_client, {
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(exports_client);
		var import_react = require("react");
		var jsx_runtime = require("react/jsx-runtime");
		var NS = "dsh-newapi";
		var PANEL_ID = "newapi";
		var ORDER = 10;
		var STATUS_PATH = "/api/dsh-newapi/status";
		var SETUP_PATH = "/api/dsh-newapi/setup";
		var SYNC_PATH = "/api/dsh-newapi/sync";
		var RETRY_PATH = "/api/dsh-newapi/retry";
		var PASSWORD_MIN_CHARS = 8;
		var PASSWORD_MAX_CHARS = 128;
		var MAX_PORT = 65535;
		var APPLIED_FEEDBACK_MS = 6000;
		var POLL_MS = 15000;
		var SETUP_POLL_MS = 1500;
		var PANEL_API = 5;
		var zh = {
		  panel: "New API",
		  consoleTitle: "New API 控制台",
		  running: "运行中",
		  stopped: "未运行",
		  loading: "读取中…",
		  unreachable: "读不到插件状态：面板需要 Harness 的 Web 服务",
		  notRunning: "网关未运行，暂时无法显示控制台",
		  retry: "重试",
		  reload: "重新加载",
		  openExternal: "新窗口打开",
		  crossSiteHint: "桌面 App 的页面来自 dsh-app://，内嵌的控制台属于跨站框架，浏览器不会保存它的登录状态，因此每次进来都要重新登录。需要常驻登录请用「新窗口打开」，或在浏览器里打开 Harness。",
		  configure: "配置",
		  syncModels: "同步模型",
		  error: "错误",
		  providerFailed: "未能写入 DSH 模型配置",
		  providerSynced: "已把网关当前的模型同步到 DSH 模型配置",
		  staleHost: "插件的前端是新的，但 Host 还是旧代码，这里的配置改不动。请在 Plugins 页把 dsh-newapi 关掉再打开（或重启 DSH）。",
		  setupTitle: "首次运行配置",
		  setupIntro: "New API 还没有初始化。填好下面两项后点「完成」，插件会用这些设置启动网关并完成初始化，随后直接进入 New API 控制台。",
		  configTitle: "配置 New API",
		  configIntro: "改端口会重启网关；要改 root 密码请点右侧的「编辑」。改密码后控制台需要重新登录一次。",
		  setupPort: "端口号",
		  setupPassword: "root 密码",
		  setupPasswordHint: "8–128 个字符，请自行保存；这是管理员账号的密码",
		  setupPasswordKeepHint: "留空表示不修改当前密码",
		  setupEdit: "编辑",
		  setupCancelEdit: "取消编辑",
		  copyPassword: "复制密码",
		  showPassword: "显示密码",
		  hidePassword: "隐藏密码",
		  setupSubmit: "完成",
		  setupCancel: "取消",
		  setupPortInvalid: "端口号需要是 1–65535 之间的整数",
		  setupPasswordInvalid: "root 密码长度需要是 8–128 个字符",
		  setupPasswordConsoleHint: "若这里改不动（例如账号已启用二次验证），可在 New API 控制台的「个人设置」里修改密码。",
		  setupSubmitting: "正在启动 New API，首次运行可能还要下载二进制…",
		  setupAccepted: "设置已提交，正在启动 New API…",
		  setupApplying: "正在应用配置…",
		  setupApplied: "配置已更新",
		  setupAppliedPassword: "配置已更新，root 密码已修改",
		  setupAppliedPort: "配置已更新，网关已在端口 {port} 重启",
		  setupAppliedBoth: "配置已更新，root 密码已修改，网关已在端口 {port} 重启",
		  starting: "启动中…",
		  bootTitle: "正在启动 New API 网关",
		  bootIntro: "插件正在准备网关。首次安装需要下载网关程序（约 128 MB），这一步只发生一次；完成后这里会自动显示控制台，期间请保持 DSH 开着。",
		  bootStepLocal: "查找本机已有的网关程序",
		  bootStepRoute: "查找可用的网络出口（代理）",
		  bootStepDownload: "下载网关程序",
		  bootStepVerify: "校验下载文件（sha256）",
		  bootStepLaunch: "启动网关进程",
		  bootStepProvision: "初始化实例、创建访问令牌",
		  bootStepDone: "已完成",
		  bootStepNow: "进行中",
		  bootStepFailed: "失败",
		  routeDirect: "直连下载服务器（没有使用代理）",
		  routeProxy: "通过 {proxy} 下载（{source}）",
		  routeSocks: "本机只配置了 SOCKS 代理 {address}，插件只会说 HTTP 代理",
		  routeTried: "已尝试的出口：{route}",
		  routeSourceEnvironment: "环境变量 {via}",
		  routeSourceWindows: "Windows 系统代理设置",
		  routeSourceLocalPort: "本机探测到的代理端口",
		  bootAttempt: "第 {attempt}/{attempts} 次尝试",
		  bootElapsed: "已用时 {seconds}",
		  bootRetryIn: "{seconds} 秒后自动重试",
		  bootDownloading: "正在下载 {asset}",
		  bootReceivedOf: "已下载 {received} / {total}",
		  bootReceived: "已下载 {received}",
		  bootSpeed: "{speed}/s",
		  bootEta: "预计还需 {eta}",
		  bootSource: "下载源：{url}",
		  bootCache: "下载完成后会校验并缓存到 {cacheDir}，之后的启动不再联网。",
		  bootKeepOpen: "下载期间请勿关闭 DSH；浏览器刷新或离开这一页都不会中断下载。",
		  bootWaitingForm: "等待填写首次运行设置。",
		  failTitleNetwork: "下载网关程序失败：连不上下载服务器",
		  failTitleChecksum: "下载的网关程序校验不通过",
		  failTitlePort: "找不到可用的端口",
		  failTitleGateway: "网关进程启动后退出",
		  failTitleTimeout: "网关启动后没有响应",
		  failTitleUnknown: "网关启动失败",
		  failCause: "原因",
		  failHowTo: "可以这样处理",
		  failNetworkDirect: "插件先试了直连（Node 的 fetch 不使用系统代理），失败后在本机也没有找到可用出口：环境变量、Windows 的代理设置、常见代理端口都没有代理。",
		  failNetworkProxyGuess: "若本机有 HTTP 代理（Clash / v2ray 这类客户端常见是 7890、10809），可设置 HTTPS_PROXY=http://127.0.0.1:<端口> 后重启 DSH。",
		  failNetworkRouted: "请确认这个代理现在能打开 github.com；也可以换一条出口（在代理客户端里改，或设置 HTTPS_PROXY 后重启 DSH）再点「重试启动」。",
		  failNetworkSocks: "本机配置的代理是 SOCKS（{address}），而插件只会说 HTTP 代理。请在代理客户端里打开 HTTP 端口，或设置 HTTPS_PROXY 指向那个 HTTP 端口后重启 DSH。",
		  failNetworkManual: "手动下载：用浏览器打开 {releaseUrl}，把下载到的文件放到 {dropInPath}。放在这个位置的文件会被直接使用，不再联网校验。",
		  failNetworkBinaryPath: "若本机已经有 new-api 程序，可在插件行里设置 binaryPath 指向它（profile 的 cordis.patch.yml）。",
		  failChecksumRetry: "下载到的内容与官方校验清单不一致，通常是网络中断或代理改写了内容。点下方「重试启动」重新下载。",
		  failChecksumManual: "若反复失败，用浏览器下载 {releaseUrl}，把文件放到 {dropInPath}。",
		  failPortAdvice: "端口 {port} 附近没有可用端口（被占用或权限不足）。请在「配置」里换一个端口，或改插件行里的 port。",
		  failGatewayAdvice: "网关进程启动后立即退出。常见原因是端口被占用、数据目录不可写、杀毒软件拦截；上面的「原因」里有它自己打印的说明。",
		  failGatewayData: "确认这个目录可写：{dataDir}",
		  failTimeoutAdvice: "进程起来了但一直没有响应 /api/status。可能是防火墙拦截，或首次启动仍在做数据库迁移。点「重试启动」再等一次。",
		  failUnknownAdvice: "把下面的日志内容发出来即可定位。",
		  failRetry: "重试启动",
		  failRetrying: "正在重试…",
		  failLog: "日志",
		  failCopyLog: "复制日志路径",
		  failCopied: "已复制",
		  failRetryRefused: "重试没有开始"
		};
		var en = {
		  panel: "New API",
		  consoleTitle: "New API console",
		  running: "Running",
		  stopped: "Not running",
		  loading: "Reading…",
		  unreachable: "Cannot read the plugin status: the panel needs the Harness web server",
		  notRunning: "The gateway is not running, so the console cannot be shown",
		  retry: "Retry",
		  reload: "Reload",
		  openExternal: "Open in a new window",
		  crossSiteHint: 'This window is served from dsh-app://, so the embedded console is a cross-site frame and the browser will not keep its login. Use "Open in a new window", or open the Harness in a browser, to stay signed in.',
		  configure: "Configure",
		  syncModels: "Sync models",
		  error: "Error",
		  providerFailed: "Not added to the DSH model configuration",
		  providerSynced: "The gateway’s current models were handed to the DSH model configuration",
		  staleHost: "The panel is newer than the Host half, which still runs the old code, so settings cannot be changed here. Toggle dsh-newapi off and on in the Plugins page (or restart DSH).",
		  setupTitle: "First-run setup",
		  setupIntro: "New API has not been initialised yet. Fill in these two settings and choose Finish: the plugin starts the gateway with them, completes the initialisation, and opens the New API console.",
		  configTitle: "Configure New API",
		  configIntro: "A new port restarts the gateway; choose Edit beside the root password to change it. Changing the password signs the console out once.",
		  setupPort: "Port",
		  setupPassword: "Root password",
		  setupPasswordHint: "8–128 characters, worth saving: this is the administrator password",
		  setupPasswordKeepHint: "Leave empty to keep the current password",
		  setupEdit: "Edit",
		  setupCancelEdit: "Cancel edit",
		  copyPassword: "Copy password",
		  showPassword: "Show password",
		  hidePassword: "Hide password",
		  setupSubmit: "Finish",
		  setupCancel: "Cancel",
		  setupPortInvalid: "The port must be an integer between 1 and 65535",
		  setupPasswordInvalid: "The root password must be 8–128 characters",
		  setupPasswordConsoleHint: "If this refuses — a second factor on the account, for example — change the password in the New API console under personal settings.",
		  setupSubmitting: "Starting New API; a first run may still be downloading the binary…",
		  setupAccepted: "The settings were accepted; New API is starting…",
		  setupApplying: "Applying the settings…",
		  setupApplied: "Settings updated",
		  setupAppliedPassword: "Settings updated; the root password changed",
		  setupAppliedPort: "Settings updated; the gateway restarted on port {port}",
		  setupAppliedBoth: "Settings updated; the root password changed and the gateway restarted on port {port}",
		  starting: "Starting…",
		  bootTitle: "Starting the New API gateway",
		  bootIntro: "The plugin is preparing the gateway. A first install downloads the gateway program (about 128 MB), which happens once; the console appears here by itself when it is ready, so leave DSH running.",
		  bootStepLocal: "Look for a gateway program this machine already has",
		  bootStepRoute: "Find a route out to the download server (proxy)",
		  bootStepDownload: "Download the gateway program",
		  bootStepVerify: "Check the download (sha256)",
		  bootStepLaunch: "Start the gateway process",
		  bootStepProvision: "Initialise the instance and create its token",
		  bootStepDone: "Done",
		  bootStepNow: "In progress",
		  bootStepFailed: "Failed",
		  routeDirect: "Straight to the download server (no proxy)",
		  routeProxy: "Through {proxy} ({source})",
		  routeSocks: "This machine configures only a SOCKS proxy at {address}, and this plugin speaks HTTP proxies",
		  routeTried: "Route already tried: {route}",
		  routeSourceEnvironment: "the {via} environment variable",
		  routeSourceWindows: "the Windows proxy settings",
		  routeSourceLocalPort: "a proxy port found on this machine",
		  bootAttempt: "Attempt {attempt} of {attempts}",
		  bootElapsed: "{seconds} elapsed",
		  bootRetryIn: "Retrying in {seconds}s",
		  bootDownloading: "Downloading {asset}",
		  bootReceivedOf: "{received} of {total} downloaded",
		  bootReceived: "{received} downloaded",
		  bootSpeed: "{speed}/s",
		  bootEta: "about {eta} left",
		  bootSource: "Source: {url}",
		  bootCache: "It is verified and cached in {cacheDir}, so later starts need no network.",
		  bootKeepOpen: "Leave DSH running while it downloads; refreshing this page or leaving it does not interrupt the download.",
		  bootWaitingForm: "Waiting for the first-run settings.",
		  failTitleNetwork: "Could not download the gateway program: the download server is unreachable",
		  failTitleChecksum: "The downloaded gateway program failed its checksum",
		  failTitlePort: "No free port was found",
		  failTitleGateway: "The gateway process exited after it started",
		  failTitleTimeout: "The gateway started but never answered",
		  failTitleUnknown: "The gateway could not be started",
		  failCause: "Cause",
		  failHowTo: "Ways out",
		  failNetworkDirect: "The plugin tried a direct connection first (Node’s fetch does not use the system proxy) and found no usable way out on this machine either: no environment variable, nothing in the Windows proxy settings, and nothing on the ports a desktop proxy client uses.",
		  failNetworkProxyGuess: "If this machine runs an HTTP proxy (Clash and v2ray usually listen on 7890 or 10809), set HTTPS_PROXY=http://127.0.0.1:<port> and restart DSH.",
		  failNetworkRouted: "Check that this proxy can open github.com right now; you can also point the machine at another route (in the proxy client, or with HTTPS_PROXY) and choose Retry.",
		  failNetworkSocks: "This machine configures a SOCKS proxy at {address}, and this plugin speaks HTTP proxies. Turn on the client’s HTTP port, or set HTTPS_PROXY to that HTTP port and restart DSH.",
		  failNetworkManual: "Or download it by hand: open {releaseUrl} in a browser and put the file at {dropInPath}. A file in that place is used as it stands, with no network check.",
		  failNetworkBinaryPath: "If this machine already has a new-api program, set binaryPath to it on the plugin row (cordis.patch.yml in the profile).",
		  failChecksumRetry: "The bytes on disk do not match the published checksum, which usually means an interrupted transfer or a proxy that rewrote the body. Choose Retry below to fetch it again.",
		  failChecksumManual: "If it keeps failing, download {releaseUrl} in a browser and put the file at {dropInPath}.",
		  failPortAdvice: "No port near {port} could be used (taken, or not permitted). Choose another port under Configure, or change port on the plugin row.",
		  failGatewayAdvice: "The process exited right after it started. The usual causes are a port already in use, a data directory it cannot write, or antivirus blocking it; the cause above is what it printed itself.",
		  failGatewayData: "Check that this directory is writable: {dataDir}",
		  failTimeoutAdvice: "The process started but never answered /api/status. A firewall may be blocking it, or a first start may still be migrating its database. Choose Retry to wait once more.",
		  failUnknownAdvice: "The log below is what identifies this one.",
		  failRetry: "Retry",
		  failRetrying: "Retrying…",
		  failLog: "Log",
		  failCopyLog: "Copy log path",
		  failCopied: "Copied",
		  failRetryRefused: "The retry did not start"
		};
		function GatewayIcon({ size }) {
		  return /* @__PURE__ */ jsx_runtime.jsxs("svg", {
		    width: size,
		    height: size,
		    viewBox: "0 0 24 24",
		    fill: "none",
		    stroke: "currentColor",
		    strokeWidth: "1.7",
		    strokeLinecap: "round",
		    strokeLinejoin: "round",
		    "aria-hidden": "true",
		    children: [
		      /* @__PURE__ */ jsx_runtime.jsx("rect", {
		        x: "3",
		        y: "4",
		        width: "18",
		        height: "6",
		        rx: "2"
		      }),
		      /* @__PURE__ */ jsx_runtime.jsx("rect", {
		        x: "3",
		        y: "14",
		        width: "18",
		        height: "6",
		        rx: "2"
		      }),
		      /* @__PURE__ */ jsx_runtime.jsx("path", {
		        d: "M7 7h.01M7 17h.01M12 10v4"
		      })
		    ]
		  });
		}
		function Glyph({ children }) {
		  return /* @__PURE__ */ jsx_runtime.jsx("svg", {
		    width: "15",
		    height: "15",
		    viewBox: "0 0 24 24",
		    fill: "none",
		    stroke: "currentColor",
		    strokeWidth: "1.7",
		    strokeLinecap: "round",
		    strokeLinejoin: "round",
		    "aria-hidden": "true",
		    children
		  });
		}
		function CopyIcon() {
		  return /* @__PURE__ */ jsx_runtime.jsxs(Glyph, {
		    children: [
		      /* @__PURE__ */ jsx_runtime.jsx("rect", {
		        x: "9",
		        y: "9",
		        width: "11",
		        height: "11",
		        rx: "2"
		      }),
		      /* @__PURE__ */ jsx_runtime.jsx("path", {
		        d: "M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
		      })
		    ]
		  });
		}
		function CheckIcon() {
		  return /* @__PURE__ */ jsx_runtime.jsx(Glyph, {
		    children: /* @__PURE__ */ jsx_runtime.jsx("path", {
		      d: "M20 6 9 17l-5-5"
		    })
		  });
		}
		function EyeIcon() {
		  return /* @__PURE__ */ jsx_runtime.jsxs(Glyph, {
		    children: [
		      /* @__PURE__ */ jsx_runtime.jsx("path", {
		        d: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
		      }),
		      /* @__PURE__ */ jsx_runtime.jsx("circle", {
		        cx: "12",
		        cy: "12",
		        r: "3"
		      })
		    ]
		  });
		}
		function EyeOffIcon() {
		  return /* @__PURE__ */ jsx_runtime.jsx(Glyph, {
		    children: /* @__PURE__ */ jsx_runtime.jsx("path", {
		      d: "M4 5l16 14M9.9 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.2 4M6.4 7.4A17.6 17.6 0 0 0 2 12s3.6 7 10 7a10.9 10.9 0 0 0 4-.75"
		    })
		  });
		}
		function PencilIcon() {
		  return /* @__PURE__ */ jsx_runtime.jsxs(Glyph, {
		    children: [
		      /* @__PURE__ */ jsx_runtime.jsx("path", {
		        d: "M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z"
		      }),
		      /* @__PURE__ */ jsx_runtime.jsx("path", {
		        d: "M13.5 6.5 17.5 10.5"
		      })
		    ]
		  });
		}
		function UndoIcon() {
		  return /* @__PURE__ */ jsx_runtime.jsxs(Glyph, {
		    children: [
		      /* @__PURE__ */ jsx_runtime.jsx("path", {
		        d: "M4 9h11a5 5 0 0 1 0 10H9"
		      }),
		      /* @__PURE__ */ jsx_runtime.jsx("path", {
		        d: "M8 5 4 9l4 4"
		      })
		    ]
		  });
		}
		function IconButton({ label, onClick, disabled, children }) {
		  return /* @__PURE__ */ jsx_runtime.jsx("button", {
		    type: "button",
		    title: label,
		    "aria-label": label,
		    onClick,
		    disabled,
		    style: styles.iconButton,
		    children
		  });
		}
		var COPY_FEEDBACK_MS = 1600;
		async function copyText(text) {
		  try {
		    if (navigator.clipboard?.writeText !== undefined) {
		      await navigator.clipboard.writeText(text);
		      return true;
		    }
		  } catch {}
		  try {
		    const holder = document.createElement("textarea");
		    holder.value = text;
		    holder.setAttribute("readonly", "");
		    holder.style.position = "fixed";
		    holder.style.top = "-1000px";
		    document.body.appendChild(holder);
		    holder.select();
		    const copied = document.execCommand("copy");
		    holder.remove();
		    return copied;
		  } catch {
		    return false;
		  }
		}
		function SettingsPanel({ t, firstRun, initialPort, initialPassword, onAccepted, onApplied, onCancel }) {
		  const [port, setPort] = import_react.useState(String(initialPort));
		  const [editing, setEditing] = import_react.useState(firstRun);
		  const [password, setPassword] = import_react.useState(firstRun ? "" : initialPassword ?? "");
		  const [revealed, setRevealed] = import_react.useState(false);
		  const [copied, setCopied] = import_react.useState(false);
		  const [error, setError] = import_react.useState(undefined);
		  const [submitted, setSubmitted] = import_react.useState(false);
		  async function submit(event) {
		    event.preventDefault();
		    const chosen = Number(port);
		    if (!Number.isInteger(chosen) || chosen < 1 || chosen > MAX_PORT) {
		      setError(t("setupPortInvalid"));
		      return;
		    }
		    const keepPassword = password === "" || password === (initialPassword ?? "");
		    if (!keepPassword) {
		      const length = [...password].length;
		      if (length < PASSWORD_MIN_CHARS || length > PASSWORD_MAX_CHARS) {
		        setError(t("setupPasswordInvalid"));
		        return;
		      }
		    } else if (firstRun) {
		      setError(t("setupPasswordInvalid"));
		      return;
		    }
		    setError(undefined);
		    setSubmitted(true);
		    try {
		      const response = await fetch(SETUP_PATH, {
		        method: "POST",
		        headers: { "content-type": "application/json", accept: "application/json" },
		        body: JSON.stringify(keepPassword ? { port: chosen } : { port: chosen, rootPassword: password })
		      });
		      const body = await response.json().catch(() => {
		        return;
		      });
		      if (!response.ok) {
		        setError(body?.error ?? `HTTP ${response.status}`);
		        setSubmitted(false);
		        return;
		      }
		      if (body?.accepted === true)
		        onAccepted();
		      else
		        onApplied(body);
		    } catch (caught) {
		      setError(caught instanceof Error ? caught.message : String(caught));
		      setSubmitted(false);
		    }
		  }
		  return /* @__PURE__ */ jsx_runtime.jsx("div", {
		    style: styles.setupScreen,
		    children: /* @__PURE__ */ jsx_runtime.jsxs("form", {
		      style: styles.setup,
		      onSubmit: submit,
		      children: [
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.setupHeader,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: styles.setupGlyph,
		              children: /* @__PURE__ */ jsx_runtime.jsx(GatewayIcon, {
		                size: 16
		              })
		            }),
		            /* @__PURE__ */ jsx_runtime.jsxs("div", {
		              style: styles.setupHeading,
		              children: [
		                /* @__PURE__ */ jsx_runtime.jsx("h2", {
		                  style: styles.setupTitle,
		                  children: firstRun ? t("setupTitle") : t("configTitle")
		                }),
		                /* @__PURE__ */ jsx_runtime.jsx("p", {
		                  style: styles.setupIntro,
		                  children: firstRun ? t("setupIntro") : t("configIntro")
		                })
		              ]
		            })
		          ]
		        }),
		        /* @__PURE__ */ jsx_runtime.jsxs("label", {
		          style: styles.field,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: styles.fieldLabel,
		              children: t("setupPort")
		            }),
		            /* @__PURE__ */ jsx_runtime.jsx("input", {
		              type: "number",
		              min: "1",
		              max: MAX_PORT,
		              step: "1",
		              required: true,
		              value: port,
		              onChange: (event) => {
		                setPort(event.target.value);
		              },
		              style: styles.input,
		              ...focusRing
		            })
		          ]
		        }),
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.field,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: styles.fieldLabel,
		              children: t("setupPassword")
		            }),
		            editing ? /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
		              children: [
		                /* @__PURE__ */ jsx_runtime.jsxs("div", {
		                  style: styles.passwordRow,
		                  children: [
		                    /* @__PURE__ */ jsx_runtime.jsx("input", {
		                      type: "password",
		                      required: firstRun,
		                      autoComplete: "new-password",
		                      spellCheck: false,
		                      autoFocus: true,
		                      value: password,
		                      onChange: (event) => {
		                        setPassword(event.target.value);
		                      },
		                      style: styles.input,
		                      ...focusRing
		                    }),
		                    !firstRun && /* @__PURE__ */ jsx_runtime.jsx(IconButton, {
		                      label: t("setupCancelEdit"),
		                      disabled: submitted,
		                      onClick: () => {
		                        setEditing(false);
		                        setPassword(initialPassword ?? "");
		                      },
		                      children: /* @__PURE__ */ jsx_runtime.jsx(UndoIcon, {})
		                    })
		                  ]
		                }),
		                /* @__PURE__ */ jsx_runtime.jsxs("span", {
		                  style: styles.fieldHint,
		                  children: [
		                    t("setupPasswordHint"),
		                    firstRun ? "" : ` · ${t("setupPasswordKeepHint")}`
		                  ]
		                })
		              ]
		            }) : /* @__PURE__ */ jsx_runtime.jsxs("div", {
		              style: styles.passwordRow,
		              children: [
		                /* @__PURE__ */ jsx_runtime.jsx("input", {
		                  type: revealed ? "text" : "password",
		                  readOnly: true,
		                  value: initialPassword ?? "",
		                  "aria-label": t("setupPassword"),
		                  style: { ...styles.input, ...styles.readonly }
		                }),
		                /* @__PURE__ */ jsx_runtime.jsx(IconButton, {
		                  label: t("copyPassword"),
		                  disabled: submitted,
		                  onClick: async () => {
		                    setCopied(await copyText(initialPassword ?? ""));
		                    setTimeout(() => {
		                      setCopied(false);
		                    }, COPY_FEEDBACK_MS);
		                  },
		                  children: copied ? /* @__PURE__ */ jsx_runtime.jsx(CheckIcon, {}) : /* @__PURE__ */ jsx_runtime.jsx(CopyIcon, {})
		                }),
		                /* @__PURE__ */ jsx_runtime.jsx(IconButton, {
		                  label: revealed ? t("hidePassword") : t("showPassword"),
		                  disabled: submitted,
		                  onClick: () => {
		                    setRevealed(!revealed);
		                  },
		                  children: revealed ? /* @__PURE__ */ jsx_runtime.jsx(EyeOffIcon, {}) : /* @__PURE__ */ jsx_runtime.jsx(EyeIcon, {})
		                }),
		                /* @__PURE__ */ jsx_runtime.jsx(IconButton, {
		                  label: t("setupEdit"),
		                  disabled: submitted,
		                  onClick: () => {
		                    setEditing(true);
		                    setPassword("");
		                  },
		                  children: /* @__PURE__ */ jsx_runtime.jsx(PencilIcon, {})
		                })
		              ]
		            })
		          ]
		        }),
		        error !== undefined && /* @__PURE__ */ jsx_runtime.jsx("p", {
		          style: styles.setupError,
		          children: error
		        }),
		        error !== undefined && !firstRun && /* @__PURE__ */ jsx_runtime.jsx("p", {
		          style: styles.fieldHint,
		          children: t("setupPasswordConsoleHint")
		        }),
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.actions,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("button", {
		              type: "submit",
		              style: { ...styles.button, ...styles.primary },
		              disabled: submitted,
		              children: t("setupSubmit")
		            }),
		            !firstRun && /* @__PURE__ */ jsx_runtime.jsx("button", {
		              type: "button",
		              style: styles.button,
		              onClick: onCancel,
		              disabled: submitted,
		              children: t("setupCancel")
		            }),
		            submitted && /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: styles.fieldHint,
		              children: firstRun ? t("setupSubmitting") : t("setupApplying")
		            })
		          ]
		        })
		      ]
		    })
		  });
		}
		var BOOT_STEPS = [
		  "bootStepLocal",
		  "bootStepRoute",
		  "bootStepDownload",
		  "bootStepVerify",
		  "bootStepLaunch",
		  "bootStepProvision"
		];
		function bootStepIndex(progress) {
		  if (progress?.phase === "downloading")
		    return 2;
		  if (progress?.phase === "starting")
		    return 4;
		  if (progress?.phase === "provisioning")
		    return 5;
		  if (progress?.step === "download" || progress?.step === "manifest")
		    return 2;
		  if (progress?.step === "verify")
		    return 3;
		  if (progress?.step === "route")
		    return 1;
		  return 0;
		}
		function fill(text, values) {
		  return Object.entries(values).reduce((line, [key, value]) => line.replace(`{${key}}`, String(value)), text);
		}
		function routeSource(t, route) {
		  switch (route?.source) {
		    case "windows":
		      return t("routeSourceWindows");
		    case "local-port":
		      return t("routeSourceLocalPort");
		    default:
		      return fill(t("routeSourceEnvironment"), { via: route?.via ?? "HTTPS_PROXY" });
		  }
		}
		function routeLabel(t, route) {
		  if (route === undefined)
		    return;
		  if (route.source === "socks")
		    return fill(t("routeSocks"), { address: route.address ?? "?" });
		  if (route.url === undefined)
		    return t("routeDirect");
		  return fill(t("routeProxy"), { proxy: route.url, source: routeSource(t, route) });
		}
		function formatBytes(bytes) {
		  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0)
		    return;
		  const units = ["B", "KB", "MB", "GB"];
		  let value = bytes;
		  let unit = 0;
		  while (value >= 1024 && unit < units.length - 1) {
		    value /= 1024;
		    unit += 1;
		  }
		  return `${unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]}`;
		}
		function formatDuration(seconds) {
		  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
		    return;
		  const whole = Math.round(seconds);
		  if (whole < 60)
		    return `${whole}s`;
		  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
		}
		function failureWays(t, hint) {
		  const manual = [];
		  if (hint.releaseUrl !== undefined && hint.dropInPath !== undefined) {
		    manual.push(fill(t("failNetworkManual"), { releaseUrl: hint.releaseUrl, dropInPath: hint.dropInPath }));
		  }
		  switch (hint.kind) {
		    case "network": {
		      const route = hint.route;
		      const ways = [];
		      if (route?.source === "socks") {
		        ways.push(fill(t("failNetworkSocks"), { address: route.address ?? "?" }));
		      } else if (route?.url !== undefined) {
		        ways.push(t("failNetworkRouted"));
		      } else {
		        ways.push(t("failNetworkDirect"));
		        ways.push(t("failNetworkProxyGuess"));
		      }
		      ways.push(...manual);
		      ways.push(t("failNetworkBinaryPath"));
		      return ways;
		    }
		    case "checksum":
		      return [t("failChecksumRetry"), ...manual];
		    case "port":
		      return [fill(t("failPortAdvice"), { port: hint.port ?? "?" })];
		    case "gateway":
		      return [t("failGatewayAdvice"), fill(t("failGatewayData"), { dataDir: hint.dataDir ?? "?" })];
		    case "timeout":
		      return [t("failTimeoutAdvice")];
		    default:
		      return [t("failUnknownAdvice")];
		  }
		}
		function failureTitle(t, kind) {
		  switch (kind) {
		    case "network":
		      return t("failTitleNetwork");
		    case "checksum":
		      return t("failTitleChecksum");
		    case "port":
		      return t("failTitlePort");
		    case "gateway":
		      return t("failTitleGateway");
		    case "timeout":
		      return t("failTitleTimeout");
		    default:
		      return t("failTitleUnknown");
		  }
		}
		function BootPanel({ t, facts }) {
		  const progress = facts.progress ?? {};
		  const download = progress.download;
		  const route = routeLabel(t, progress.route);
		  const step = bootStepIndex(progress);
		  const retrying = progress.phase === "retrying";
		  const attempt = typeof progress.attempt === "number" ? progress.attempt : 0;
		  const attempts = typeof progress.attempts === "number" ? progress.attempts : 0;
		  const elapsedSince = progress.since === undefined ? undefined : Date.parse(progress.since);
		  const elapsed = elapsedSince === undefined || Number.isNaN(elapsedSince) ? undefined : Math.max(0, Math.round((Date.now() - elapsedSince) / 1000));
		  const retryAt = progress.retryAt === undefined ? undefined : Date.parse(progress.retryAt);
		  const retryIn = retryAt === undefined || Number.isNaN(retryAt) ? undefined : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
		  const total = download?.totalBytes;
		  const received = download?.receivedBytes;
		  const percent = typeof total === "number" && typeof received === "number" && total > 0 ? Math.max(0, Math.min(100, Math.round(received / total * 100))) : undefined;
		  return /* @__PURE__ */ jsx_runtime.jsx("div", {
		    style: styles.bootScreen,
		    children: /* @__PURE__ */ jsx_runtime.jsxs("div", {
		      style: styles.bootCard,
		      children: [
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.setupHeader,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: styles.setupGlyph,
		              children: /* @__PURE__ */ jsx_runtime.jsx(GatewayIcon, {
		                size: 16
		              })
		            }),
		            /* @__PURE__ */ jsx_runtime.jsxs("div", {
		              style: styles.setupHeading,
		              children: [
		                /* @__PURE__ */ jsx_runtime.jsx("h2", {
		                  style: styles.setupTitle,
		                  children: t("bootTitle")
		                }),
		                /* @__PURE__ */ jsx_runtime.jsx("p", {
		                  style: styles.setupIntro,
		                  children: t("bootIntro")
		                })
		              ]
		            })
		          ]
		        }),
		        /* @__PURE__ */ jsx_runtime.jsx("ol", {
		          style: styles.steps,
		          children: BOOT_STEPS.map((key, index) => {
		            const state = index < step ? "done" : index === step ? retrying ? "failed" : "now" : "todo";
		            return /* @__PURE__ */ jsx_runtime.jsxs("li", {
		              style: styles.step,
		              children: [
		                /* @__PURE__ */ jsx_runtime.jsx("span", {
		                  style: {
		                    ...styles.stepDot,
		                    ...state === "done" ? styles.stepDotDone : undefined,
		                    ...state === "now" ? styles.stepDotNow : undefined,
		                    ...state === "failed" ? styles.stepDotFailed : undefined
		                  },
		                  children: state === "done" ? "✓" : index + 1
		                }),
		                /* @__PURE__ */ jsx_runtime.jsx("span", {
		                  style: state === "todo" ? styles.stepLabelTodo : styles.stepLabel,
		                  children: t(key)
		                }),
		                state === "now" && /* @__PURE__ */ jsx_runtime.jsx("span", {
		                  style: styles.stepMark,
		                  children: t("bootStepNow")
		                }),
		                state === "failed" && /* @__PURE__ */ jsx_runtime.jsx("span", {
		                  style: styles.stepMarkFailed,
		                  children: t("bootStepFailed")
		                })
		              ]
		            }, key);
		          })
		        }),
		        route !== undefined && /* @__PURE__ */ jsx_runtime.jsx("p", {
		          style: styles.fieldHint,
		          children: route
		        }),
		        download !== undefined && received !== undefined && /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.download,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsxs("div", {
		              style: styles.progressHead,
		              children: [
		                /* @__PURE__ */ jsx_runtime.jsx("span", {
		                  style: styles.progressLabel,
		                  children: download.asset === undefined ? t("bootStepDownload") : t("bootDownloading").replace("{asset}", download.asset)
		                }),
		                percent !== undefined && /* @__PURE__ */ jsx_runtime.jsxs("span", {
		                  style: styles.muted,
		                  children: [
		                    percent,
		                    "%"
		                  ]
		                })
		              ]
		            }),
		            /* @__PURE__ */ jsx_runtime.jsx("div", {
		              style: styles.progressTrack,
		              children: percent !== undefined && /* @__PURE__ */ jsx_runtime.jsx("div", {
		                style: { ...styles.progressBar, width: `${percent}%` }
		              })
		            }),
		            /* @__PURE__ */ jsx_runtime.jsxs("div", {
		              style: styles.progressMeta,
		              children: [
		                /* @__PURE__ */ jsx_runtime.jsx("span", {
		                  children: (total === undefined ? t("bootReceived") : t("bootReceivedOf")).replace("{received}", formatBytes(received) ?? "").replace("{total}", formatBytes(total) ?? "")
		                }),
		                formatBytes(download.bytesPerSecond) !== undefined && /* @__PURE__ */ jsx_runtime.jsx("span", {
		                  children: t("bootSpeed").replace("{speed}", formatBytes(download.bytesPerSecond))
		                }),
		                formatDuration(download.etaSeconds) !== undefined && /* @__PURE__ */ jsx_runtime.jsx("span", {
		                  children: t("bootEta").replace("{eta}", formatDuration(download.etaSeconds))
		                })
		              ]
		            }),
		            download.cacheDir !== undefined && /* @__PURE__ */ jsx_runtime.jsx("p", {
		              style: styles.fieldHint,
		              children: t("bootCache").replace("{cacheDir}", download.cacheDir)
		            }),
		            /* @__PURE__ */ jsx_runtime.jsx("p", {
		              style: styles.fieldHint,
		              children: t("bootKeepOpen")
		            })
		          ]
		        }),
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.bootMeta,
		          children: [
		            attempt > 0 && /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: styles.muted,
		              children: t("bootAttempt").replace("{attempt}", String(attempt)).replace("{attempts}", String(attempts))
		            }),
		            elapsed !== undefined && /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: styles.muted,
		              children: t("bootElapsed").replace("{seconds}", String(elapsed))
		            }),
		            retryIn !== undefined && /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: styles.retryNote,
		              children: t("bootRetryIn").replace("{seconds}", String(retryIn))
		            })
		          ]
		        }),
		        retrying && progress.error !== undefined && /* @__PURE__ */ jsx_runtime.jsx("p", {
		          style: styles.bootCause,
		          children: progress.error
		        }),
		        facts.logPath !== undefined && /* @__PURE__ */ jsx_runtime.jsxs("p", {
		          style: styles.fieldHint,
		          children: [
		            t("failLog"),
		            ": ",
		            /* @__PURE__ */ jsx_runtime.jsx("code", {
		              style: styles.code,
		              children: facts.logPath
		            })
		          ]
		        })
		      ]
		    })
		  });
		}
		function FailurePanel({ t, facts, onRetry, retrying, refused }) {
		  const hint = facts.hint ?? {};
		  const [copied, setCopied] = import_react.useState(false);
		  const ways = failureWays(t, hint);
		  const tried = hint.kind === "network" ? routeLabel(t, hint.route) : undefined;
		  return /* @__PURE__ */ jsx_runtime.jsx("div", {
		    style: styles.bootScreen,
		    children: /* @__PURE__ */ jsx_runtime.jsxs("div", {
		      style: styles.bootCard,
		      children: [
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.setupHeader,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("span", {
		              style: { ...styles.setupGlyph, ...styles.setupGlyphError },
		              children: /* @__PURE__ */ jsx_runtime.jsx(GatewayIcon, {
		                size: 16
		              })
		            }),
		            /* @__PURE__ */ jsx_runtime.jsx("div", {
		              style: styles.setupHeading,
		              children: /* @__PURE__ */ jsx_runtime.jsx("h2", {
		                style: styles.setupTitle,
		                children: failureTitle(t, hint.kind)
		              })
		            })
		          ]
		        }),
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.failBlock,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("div", {
		              style: styles.failLabel,
		              children: t("failCause")
		            }),
		            /* @__PURE__ */ jsx_runtime.jsx("pre", {
		              style: styles.failPre,
		              children: facts.error ?? ""
		            }),
		            tried !== undefined && /* @__PURE__ */ jsx_runtime.jsx("p", {
		              style: styles.fieldHint,
		              children: t("routeTried").replace("{route}", tried)
		            })
		          ]
		        }),
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.failBlock,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("div", {
		              style: styles.failLabel,
		              children: t("failHowTo")
		            }),
		            /* @__PURE__ */ jsx_runtime.jsx("ol", {
		              style: styles.failWays,
		              children: ways.map((way) => /* @__PURE__ */ jsx_runtime.jsx("li", {
		                style: styles.failWay,
		                children: way
		              }, way))
		            })
		          ]
		        }),
		        refused !== undefined && /* @__PURE__ */ jsx_runtime.jsxs("p", {
		          style: styles.setupError,
		          children: [
		            t("failRetryRefused"),
		            " — ",
		            refused
		          ]
		        }),
		        /* @__PURE__ */ jsx_runtime.jsxs("div", {
		          style: styles.actions,
		          children: [
		            /* @__PURE__ */ jsx_runtime.jsx("button", {
		              type: "button",
		              style: { ...styles.button, ...styles.primary },
		              disabled: retrying,
		              onClick: onRetry,
		              children: retrying ? t("failRetrying") : t("failRetry")
		            }),
		            facts.logPath !== undefined && /* @__PURE__ */ jsx_runtime.jsx("button", {
		              type: "button",
		              style: styles.button,
		              onClick: async () => {
		                setCopied(await copyText(facts.logPath));
		                setTimeout(() => {
		                  setCopied(false);
		                }, COPY_FEEDBACK_MS);
		              },
		              children: copied ? t("failCopied") : t("failCopyLog")
		            })
		          ]
		        }),
		        facts.logPath !== undefined && /* @__PURE__ */ jsx_runtime.jsxs("p", {
		          style: styles.fieldHint,
		          children: [
		            t("failLog"),
		            ": ",
		            /* @__PURE__ */ jsx_runtime.jsx("code", {
		              style: styles.code,
		              children: facts.logPath
		            })
		          ]
		        })
		      ]
		    })
		  });
		}
		function GatewayPanel({ t }) {
		  const [state, setState] = import_react.useState({ phase: "loading" });
		  const [accepted, setAccepted] = import_react.useState(false);
		  const [configuring, setConfiguring] = import_react.useState(false);
		  const [applied, setApplied] = import_react.useState(undefined);
		  const [synced, setSynced] = import_react.useState(undefined);
		  const [reloadKey, setReloadKey] = import_react.useState(0);
		  const [retrying, setRetrying] = import_react.useState(false);
		  const [refused, setRefused] = import_react.useState(undefined);
		  const load = import_react.useCallback(async () => {
		    try {
		      const response = await fetch(STATUS_PATH, { headers: { accept: "application/json" }, cache: "no-store" });
		      if (!response.ok) {
		        setState({ phase: "error", message: `HTTP ${response.status}` });
		        return;
		      }
		      setState({ phase: "ready", facts: await response.json() });
		    } catch (error) {
		      setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
		    }
		  }, []);
		  const retryBoot = import_react.useCallback(async () => {
		    setRetrying(true);
		    setRefused(undefined);
		    try {
		      const response = await fetch(RETRY_PATH, { method: "POST", headers: { accept: "application/json" } });
		      const body = await response.json().catch(() => {
		        return;
		      });
		      if (!response.ok)
		        setRefused(body?.error ?? `HTTP ${response.status}`);
		    } catch (error) {
		      setRefused(error instanceof Error ? error.message : String(error));
		    } finally {
		      setRetrying(false);
		      await load();
		    }
		  }, [load]);
		  const syncModels = import_react.useCallback(async () => {
		    try {
		      const response = await fetch(SYNC_PATH, { method: "POST", headers: { accept: "application/json" } });
		      const body = await response.json().catch(() => {
		        return;
		      });
		      setSynced(response.ok ? t("providerSynced") : `${t("providerFailed")} — ${body?.error ?? `HTTP ${response.status}`}`);
		      await load();
		    } catch (error) {
		      setSynced(`${t("providerFailed")} — ${error instanceof Error ? error.message : String(error)}`);
		    }
		    setTimeout(() => {
		      setSynced(undefined);
		    }, APPLIED_FEEDBACK_MS);
		  }, [load, t]);
		  const facts = state.phase === "ready" ? state.facts : undefined;
		  const needsSetup = facts?.needsSetup === true;
		  const progress = facts?.progress;
		  const booting = progress?.phase === "preparing" || progress?.phase === "downloading" || progress?.phase === "starting" || progress?.phase === "provisioning" || progress?.phase === "retrying";
		  const failed = facts !== undefined && facts.running !== true && progress?.phase === "failed";
		  const waiting = accepted || needsSetup || booting;
		  import_react.useEffect(() => {
		    load();
		    const timer = setInterval(() => {
		      load();
		    }, waiting ? SETUP_POLL_MS : POLL_MS);
		    return () => {
		      clearInterval(timer);
		    };
		  }, [load, waiting]);
		  if (needsSetup && !accepted) {
		    return /* @__PURE__ */ jsx_runtime.jsx(SettingsPanel, {
		      t,
		      firstRun: true,
		      initialPort: facts.defaultPort ?? 3000,
		      onAccepted: () => {
		        setAccepted(true);
		      }
		    });
		  }
		  const running = facts?.running === true;
		  const hasProgress = progress !== undefined;
		  const starting = !running && !failed && (booting || accepted && hasProgress) && state.phase !== "error";
		  const acceptedNotice = !running && !failed && !starting && accepted && state.phase !== "error";
		  const statusText = facts === undefined ? t("loading") : running ? t("running") : booting ? t("starting") : t("stopped");
		  const crossSite = !/^https?:$/.test(window.location.protocol);
		  const bridged = facts?.consoleProxyUrl !== undefined;
		  const consoleSrc = bridged ? `${facts.consoleProxyUrl}/console` : facts?.consoleUrl;
		  const shownUrl = facts?.lanBaseUrl ?? facts?.baseUrl;
		  const openUrl = facts?.lanConsoleUrl ?? facts?.consoleUrl;
		  if (running && configuring) {
		    return /* @__PURE__ */ jsx_runtime.jsx(SettingsPanel, {
		      t,
		      firstRun: false,
		      initialPort: facts.port,
		      initialPassword: facts.adminPassword,
		      onCancel: () => {
		        setConfiguring(false);
		      },
		      onApplied: (result) => {
		        setConfiguring(false);
		        setApplied(result);
		        setReloadKey((value) => value + 1);
		        load();
		        setTimeout(() => {
		          setApplied(undefined);
		        }, APPLIED_FEEDBACK_MS);
		      }
		    });
		  }
		  if (failed) {
		    return /* @__PURE__ */ jsx_runtime.jsx(FailurePanel, {
		      t,
		      facts,
		      retrying,
		      refused,
		      onRetry: () => {
		        retryBoot();
		      }
		    });
		  }
		  if (starting && state.phase !== "error") {
		    return /* @__PURE__ */ jsx_runtime.jsx(BootPanel, {
		      t,
		      facts
		    });
		  }
		  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
		    style: styles.page,
		    children: [
		      /* @__PURE__ */ jsx_runtime.jsxs("div", {
		        style: styles.toolbar,
		        children: [
		          /* @__PURE__ */ jsx_runtime.jsx("span", {
		            style: { ...styles.dot, background: running ? "#3fb950" : "#8b949e" }
		          }),
		          /* @__PURE__ */ jsx_runtime.jsx("span", {
		            style: styles.statusText,
		            children: "New API"
		          }),
		          /* @__PURE__ */ jsx_runtime.jsx("span", {
		            style: styles.muted,
		            children: statusText
		          }),
		          running && /* @__PURE__ */ jsx_runtime.jsx("code", {
		            style: styles.url,
		            children: shownUrl
		          }),
		          /* @__PURE__ */ jsx_runtime.jsx("span", {
		            style: styles.spacer
		          }),
		          running && /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
		            children: [
		              /* @__PURE__ */ jsx_runtime.jsx("button", {
		                type: "button",
		                style: styles.button,
		                onClick: () => {
		                  setReloadKey((value) => value + 1);
		                },
		                children: t("reload")
		              }),
		              /* @__PURE__ */ jsx_runtime.jsx("button", {
		                type: "button",
		                style: styles.button,
		                onClick: () => {
		                  syncModels();
		                },
		                children: t("syncModels")
		              }),
		              /* @__PURE__ */ jsx_runtime.jsx("a", {
		                href: openUrl,
		                target: "_blank",
		                rel: "noreferrer noopener",
		                style: styles.button,
		                children: t("openExternal")
		              }),
		              /* @__PURE__ */ jsx_runtime.jsx("button", {
		                type: "button",
		                style: styles.button,
		                onClick: () => {
		                  setConfiguring(true);
		                },
		                children: t("configure")
		              })
		            ]
		          }),
		          facts !== undefined && !running && !starting && !failed && /* @__PURE__ */ jsx_runtime.jsx("button", {
		            type: "button",
		            style: styles.button,
		            disabled: retrying,
		            onClick: () => {
		              if (booting || retrying || facts.canRetry === false) {
		                load();
		                return;
		              }
		              retryBoot();
		            },
		            children: t("retry")
		          })
		        ]
		      }),
		      state.phase === "error" && /* @__PURE__ */ jsx_runtime.jsxs("p", {
		        style: styles.notice,
		        children: [
		          t("unreachable"),
		          " — ",
		          state.message
		        ]
		      }),
		      facts !== undefined && facts.panelApi !== PANEL_API && /* @__PURE__ */ jsx_runtime.jsx("p", {
		        style: styles.setupError,
		        children: t("staleHost")
		      }),
		      facts !== undefined && facts.error !== undefined && facts.error !== null && /* @__PURE__ */ jsx_runtime.jsxs("p", {
		        style: styles.notice,
		        children: [
		          t("error"),
		          ": ",
		          facts.error
		        ]
		      }),
		      applied !== undefined && /* @__PURE__ */ jsx_runtime.jsx("p", {
		        style: styles.notice,
		        children: appliedText(t, applied)
		      }),
		      synced !== undefined && /* @__PURE__ */ jsx_runtime.jsx("p", {
		        style: styles.notice,
		        children: synced
		      }),
		      running && crossSite && !bridged && /* @__PURE__ */ jsx_runtime.jsx("p", {
		        style: styles.hint,
		        children: t("crossSiteHint")
		      }),
		      running && /* @__PURE__ */ jsx_runtime.jsx("iframe", {
		        src: consoleSrc,
		        title: t("consoleTitle"),
		        style: styles.frame
		      }, `${consoleSrc}#${reloadKey}`),
		      facts !== undefined && !running && /* @__PURE__ */ jsx_runtime.jsx("p", {
		        style: styles.notice,
		        children: acceptedNotice ? t("setupAccepted") : t("notRunning")
		      })
		    ]
		  });
		}
		function appliedText(t, applied) {
		  if (applied.passwordChanged === true && applied.portChanged === true) {
		    return t("setupAppliedBoth").replace("{port}", applied.port);
		  }
		  if (applied.passwordChanged === true)
		    return t("setupAppliedPassword");
		  if (applied.portChanged === true)
		    return t("setupAppliedPort").replace("{port}", applied.port);
		  return t("setupApplied");
		}
		var mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
		var secondary = "var(--dsw-alias-label-secondary, #6b7280)";
		var border = "var(--dsw-alias-border-l1, #e3e5ea)";
		var layer = "var(--dsw-alias-bg-layer-1, #f7f8fa)";
		var accent = "#3b6ef5";
		var focusRing = {
		  onFocus: (event) => {
		    event.currentTarget.style.borderColor = accent;
		    event.currentTarget.style.boxShadow = `0 0 0 3px ${accent}2e`;
		  },
		  onBlur: (event) => {
		    event.currentTarget.style.borderColor = border;
		    event.currentTarget.style.boxShadow = "none";
		  }
		};
		var styles = {
		  page: {
		    boxSizing: "border-box",
		    display: "flex",
		    flexDirection: "column",
		    height: "100%",
		    color: "var(--dsw-alias-label-primary, #1c1e26)",
		    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
		    fontSize: "13px"
		  },
		  toolbar: {
		    alignItems: "center",
		    borderBottom: `1px solid ${border}`,
		    display: "flex",
		    flex: "0 0 auto",
		    flexWrap: "wrap",
		    gap: "8px",
		    padding: "8px 14px"
		  },
		  dot: { width: "8px", height: "8px", borderRadius: "50%", display: "inline-block" },
		  statusText: { fontWeight: 600 },
		  spacer: { flex: "1 1 auto" },
		  url: { color: secondary, fontFamily: mono, fontSize: "12px" },
		  muted: { color: secondary },
		  notice: { color: secondary, margin: "12px 14px" },
		  setupScreen: {
		    alignItems: "center",
		    boxSizing: "border-box",
		    display: "flex",
		    height: "100%",
		    justifyContent: "center",
		    padding: "24px",
		    width: "100%"
		  },
		  setup: {
		    background: layer,
		    border: `1px solid ${border}`,
		    borderRadius: "12px",
		    boxSizing: "border-box",
		    display: "flex",
		    flexDirection: "column",
		    gap: "14px",
		    maxWidth: "440px",
		    padding: "20px 22px 22px",
		    width: "100%",
		    color: "var(--dsw-alias-label-primary, #1c1e26)",
		    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
		    fontSize: "13px"
		  },
		  setupHeader: { alignItems: "flex-start", display: "flex", gap: "10px" },
		  setupGlyph: {
		    alignItems: "center",
		    background: "var(--dsw-alias-bg-base, #fff)",
		    border: `1px solid ${border}`,
		    borderRadius: "8px",
		    color: accent,
		    display: "flex",
		    flex: "0 0 auto",
		    height: "28px",
		    justifyContent: "center",
		    width: "28px"
		  },
		  setupHeading: { display: "flex", flexDirection: "column", gap: "3px" },
		  setupTitle: { fontSize: "14px", fontWeight: 600, margin: 0 },
		  setupIntro: { color: secondary, fontSize: "12px", lineHeight: 1.6, margin: 0 },
		  field: { display: "flex", flexDirection: "column", gap: "6px" },
		  fieldLabel: { fontSize: "12px", fontWeight: 600 },
		  fieldHint: { color: secondary, fontSize: "12px", lineHeight: 1.5, margin: 0 },
		  input: {
		    background: "var(--dsw-alias-bg-base, #fff)",
		    border: `1px solid ${border}`,
		    borderRadius: "8px",
		    boxSizing: "border-box",
		    color: "inherit",
		    fontFamily: "inherit",
		    fontSize: "13px",
		    height: "32px",
		    padding: "0 10px",
		    transition: "border-color 120ms ease, box-shadow 120ms ease",
		    width: "100%"
		  },
		  setupError: {
		    background: "rgba(209, 36, 47, 0.08)",
		    border: "1px solid rgba(209, 36, 47, 0.35)",
		    borderRadius: "8px",
		    color: "var(--dsw-alias-label-error, #d1242f)",
		    fontSize: "12px",
		    lineHeight: 1.5,
		    margin: 0,
		    padding: "8px 10px"
		  },
		  bootScreen: {
		    alignItems: "flex-start",
		    boxSizing: "border-box",
		    display: "flex",
		    height: "100%",
		    justifyContent: "center",
		    overflow: "auto",
		    padding: "24px",
		    width: "100%"
		  },
		  bootCard: {
		    background: layer,
		    border: `1px solid ${border}`,
		    borderRadius: "12px",
		    boxSizing: "border-box",
		    display: "flex",
		    flexDirection: "column",
		    gap: "14px",
		    maxWidth: "560px",
		    padding: "20px 22px 22px",
		    width: "100%",
		    color: "var(--dsw-alias-label-primary, #1c1e26)",
		    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
		    fontSize: "13px"
		  },
		  setupGlyphError: {
		    borderColor: "rgba(209, 36, 47, 0.35)",
		    color: "var(--dsw-alias-label-error, #d1242f)"
		  },
		  code: { fontFamily: mono, fontSize: "11px", wordBreak: "break-all" },
		  steps: { display: "flex", flexDirection: "column", gap: "8px", listStyle: "none", margin: 0, padding: 0 },
		  step: { alignItems: "center", display: "flex", gap: "8px" },
		  stepDot: {
		    alignItems: "center",
		    background: "var(--dsw-alias-bg-base, #fff)",
		    border: `1px solid ${border}`,
		    borderRadius: "50%",
		    color: secondary,
		    display: "flex",
		    flex: "0 0 auto",
		    fontSize: "11px",
		    height: "20px",
		    justifyContent: "center",
		    width: "20px"
		  },
		  stepDotDone: { background: "rgba(63, 185, 80, 0.12)", borderColor: "rgba(63, 185, 80, 0.5)", color: "#2f9e44" },
		  stepDotNow: { background: "rgba(59, 110, 245, 0.12)", borderColor: accent, color: accent },
		  stepDotFailed: {
		    background: "rgba(209, 36, 47, 0.1)",
		    borderColor: "rgba(209, 36, 47, 0.45)",
		    color: "var(--dsw-alias-label-error, #d1242f)"
		  },
		  stepLabel: { color: "var(--dsw-alias-label-primary, #1c1e26)", fontSize: "12px" },
		  stepLabelTodo: { color: secondary, fontSize: "12px" },
		  stepMark: { color: accent, fontSize: "11px" },
		  stepMarkFailed: { color: "var(--dsw-alias-label-error, #d1242f)", fontSize: "11px" },
		  download: {
		    background: "var(--dsw-alias-bg-base, #fff)",
		    border: `1px solid ${border}`,
		    borderRadius: "10px",
		    display: "flex",
		    flexDirection: "column",
		    gap: "8px",
		    padding: "12px 14px"
		  },
		  progressHead: { alignItems: "baseline", display: "flex", gap: "8px", justifyContent: "space-between" },
		  progressLabel: { fontFamily: mono, fontSize: "12px" },
		  progressTrack: {
		    background: "rgba(127, 127, 127, 0.18)",
		    borderRadius: "999px",
		    height: "6px",
		    overflow: "hidden",
		    width: "100%"
		  },
		  progressBar: {
		    background: accent,
		    borderRadius: "999px",
		    height: "100%",
		    transition: "width 400ms linear"
		  },
		  progressMeta: { color: secondary, display: "flex", flexWrap: "wrap", fontSize: "12px", gap: "12px" },
		  bootMeta: { alignItems: "baseline", display: "flex", flexWrap: "wrap", fontSize: "12px", gap: "12px" },
		  retryNote: { color: "var(--dsw-alias-label-error, #d1242f)" },
		  bootCause: {
		    color: secondary,
		    fontFamily: mono,
		    fontSize: "11px",
		    lineHeight: 1.5,
		    margin: 0,
		    maxHeight: "80px",
		    overflow: "auto",
		    wordBreak: "break-all"
		  },
		  failBlock: { display: "flex", flexDirection: "column", gap: "6px" },
		  failLabel: { fontSize: "12px", fontWeight: 600 },
		  failPre: {
		    background: "var(--dsw-alias-bg-base, #fff)",
		    border: `1px solid ${border}`,
		    borderRadius: "8px",
		    color: secondary,
		    fontFamily: mono,
		    fontSize: "11px",
		    lineHeight: 1.5,
		    margin: 0,
		    maxHeight: "140px",
		    overflow: "auto",
		    padding: "8px 10px",
		    whiteSpace: "pre-wrap",
		    wordBreak: "break-all"
		  },
		  failWays: {
		    color: "var(--dsw-alias-label-primary, #1c1e26)",
		    display: "flex",
		    flexDirection: "column",
		    fontSize: "12px",
		    gap: "6px",
		    lineHeight: 1.6,
		    margin: 0,
		    paddingLeft: "18px"
		  },
		  failWay: { wordBreak: "break-word" },
		  actions: { alignItems: "center", display: "flex", gap: "8px", marginTop: "2px" },
		  passwordRow: { alignItems: "center", display: "flex", gap: "4px" },
		  readonly: { color: secondary, cursor: "default", fontFamily: mono, fontSize: "12px" },
		  iconButton: {
		    alignItems: "center",
		    background: "transparent",
		    border: "none",
		    borderRadius: "6px",
		    color: secondary,
		    cursor: "pointer",
		    display: "flex",
		    flex: "0 0 auto",
		    height: "28px",
		    justifyContent: "center",
		    padding: 0,
		    width: "28px"
		  },
		  primary: {
		    background: accent,
		    borderColor: accent,
		    color: "#fff",
		    fontWeight: 600,
		    padding: "5px 18px"
		  },
		  hint: {
		    background: layer,
		    borderBottom: `1px solid ${border}`,
		    color: secondary,
		    flex: "0 0 auto",
		    fontSize: "12px",
		    lineHeight: 1.5,
		    margin: 0,
		    padding: "8px 14px"
		  },
		  frame: {
		    background: "var(--dsw-alias-bg-base, #fff)",
		    border: "none",
		    display: "block",
		    flex: "1 1 auto",
		    minHeight: 0,
		    width: "100%"
		  },
		  button: {
		    background: "var(--dsw-alias-bg-base, #fff)",
		    border: `1px solid ${border}`,
		    borderRadius: "6px",
		    color: "inherit",
		    cursor: "pointer",
		    fontSize: "12px",
		    padding: "3px 10px",
		    textDecoration: "none"
		  }
		};
		var inject = ["slots", "locale"];
		function apply(ctx) {
		  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-newapi: dictionaries");
		  const t = ctx.locale.bind(NS);
		  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, locale: NS }, GatewayPanel));
		  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: ORDER, label: () => t("panel"), locale: NS }, GatewayIcon));
		}

		return module.exports;
	}
});

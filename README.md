# dsh-newapi

把本机 New API 网关作为 DeepSeek Harness 的托管 sidecar：启动 Harness 时自动拉起，首次运行由面板里的配置界面决定端口与 root 密码，并把 Claude Code / Harness 需要的接入信息写到固定位置。

## 它能做什么

- **随 Harness 启动**：DSH 启动时优先复用本机已有的 new-api 二进制（数据目录里自备的，或上次下载留下的缓存），都没有才下载（并校验）官方 release，然后作为受管子进程拉起；DSH 退出或插件卸载时回收该进程。
- **首启先配置再开通**：第一次使用时，侧边栏面板显示配置界面（端口号 + root 密码），点「完成」后插件才拉起网关、用这两个值完成 `/api/setup` 初始化与 Token 生成，并直接进入 New API 控制台。配置结果记在数据目录里，以后进入面板不再显示该界面（见「首次运行」）。
- **侧边栏面板内嵌控制台**：在 Harness 侧边栏的「插件」下方多出一个 **New API** 入口，点开就在 Harness 主区域里直接显示 new-api 的 Web 界面（主页 / 控制台 / 模型广场 / 排行榜等），上方一条工具条给出网关状态、地址、「重新加载」「新窗口打开」「配置」。
- **随时改端口与 root 密码**：工具条的「配置」打开的就是首启那个配置界面，改完立即生效——换端口会重启网关（同一份数据库），换 root 密码走网关自己的安全验证流程（见「重新配置」）。`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 等接入信息写在 `<dataDir>/connection.json` 并打印到日志。
- **自动进 Harness 的模型选择器**：网关起来后，插件把网关 Token 写进 Harness 的凭据存储，并在 `llm-pi-ai` 设置里登记一个 provider 路由（默认叫 `new-api`），模型列表就是该 Token 能用的那些——于是对话框的模型选择器里直接就能选 New API 里的模型，不必手填 key、也不必改 cordis 配置（见「配置上游并选模型」）。同一处还声明了每个模型的**思考强度档位**（默认 `off/low/medium/high/xhigh`）、**输入模态**与**上下文窗口 / 输出上限**（后两者在模型能被 Harness 自带目录描述时按模型取真实值，见「上下文窗口与输出上限」）。
- **启动过程看得见，失败可以直接重试**：面板不停在「未运行」上——它在下载时显示文件名、下载源、已下载字节、速度与预计剩余时间，在启动与开通时显示当前步骤；失败时给出分类后的原因（连不上下载服务器 / 校验不通过 / 端口不可用 / 进程退出 / 无响应）、插件打印的原始错误与针对性的解法，并提供一个「重试启动」按钮，处理完点一下即可继续，不必关开插件或重启 DSH（见「启动过程在面板上」）。
- **不阻塞 Harness，启动失败会自己重试**：网关起不来时只记录原因，Harness 照常启动；插件随即再试（共 3 次，间隔 5s / 15s），失败的那次不会留下占用端口的僵尸进程，所以**不需要重启 DSH**。三次都失败后停止尝试，把分类后的原因与解法留在面板上，并保留「重试启动」。

## 首次运行

`<dataDir>/.dsh-gateway.json` 里没有可用的开通记录时，插件**不会**自己挑一个密码就开通，而是等你回答两个问题：

| 配置 | 说明 |
|---|---|
| 端口号 | 网关监听的端口，面板默认填插件行的 `port`（默认 `3000`）；被别的进程占用时会自动向后找可用端口，实际端口以工具条显示和 `connection.json` 为准 |
| root 密码 | 首次 `/api/setup` 创建管理员账号用的密码，8–128 个字符（与网关自身的口令策略一致），只写入本机 `.dsh-gateway.json`（`0600`） |

点「完成」后：插件先把这个回答写进 `.dsh-gateway.json`（`setupCompleted: true`），再拉起网关并用它完成开通，面板随后自动切到 New API 控制台。因此**下一次进入面板不会再显示配置界面**（要再改就用工具条的「配置」，见下）。

### 启动过程在面板上

从点「完成」到控制台出现之间，面板不会停在「未运行」上，而是显示插件正在做的事，共四步：

| 步骤 | 面板显示 |
|---|---|
| 1 查找本机已有的网关程序 | 依次看 `config.binaryPath`、`<dataDir>`、下载缓存，任一命中就跳过下载 |
| 2 查找可用的网络出口（代理） | 本机代理是从哪读到的、走的哪个地址；直连时也会写明 |
| 3 下载网关程序 | **只在冷装、或换了 `version` 时出现**：文件名与下载源、已下载 / 总量、速度、预计剩余时间、缓存目录 |
| 4 启动网关进程 | 进程已拉起，正在轮询 `/api/status` |
| 5 初始化实例、创建访问令牌 | 首次开通管理员账号并生成网关 Token |

第 3 步是唯一以分钟计的一步（约 128 MB），所以它单独显示进度；面板每 1.5 秒刷新一次，下载在 Host 进程里进行，**刷新页面或切走都不会中断它**。下载完成后二进制连同校验清单一起缓存在 `$DSH_HOME/cache/newapi/<版本>/`，之后的启动直接命中缓存，不再联网。

失败时的面板给出四样东西：**分类后的原因**（连不上下载服务器 / 校验不通过 / 找不到可用端口 / 进程启动后退出 / 启动后无响应）、**插件自己打印的原始错误**、**这一类原因对应的解法**、以及一个**「重试启动」按钮**（`POST /api/dsh-newapi/retry`）。

按钮会重跑整个启动流程，所以启动代理客户端、手动放好二进制、腾出端口、改完防火墙之后点一下就能继续，不必关开插件或重启 DSH；**改环境变量是例外**——那需要重启 DSH 才生效。

## 下载要走代理的机器

`fetch` 不会自动使用系统代理：Windows 上 Clash / v2ray 这类只写 WinINET 设置的客户端对它无效，所以「浏览器能打开 GitHub」并不代表插件能下载。插件因此自己找出口，顺序是**从最确定到最靠猜**：

1. **环境变量**：`HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `ALL_PROXY`（`NO_PROXY` 里的主机直连）；
2. **Windows 的代理设置**：读 `HKCU\...\Internet Settings` 里的 `ProxyEnable` / `ProxyServer` / `ProxyOverride`（浏览器和安装程序用的就是这一份）；
3. **本机常见代理端口**（`7890`、`7897`、`10809`、`10808`、`1080`、`8888`、`8118`）：**只在直连已经失败之后**才探一次，且只连回环地址——避免把一个本来能用的直连硬塞进陌生端口。

找到代理后，HTTPS 请求走 `CONNECT` 隧道（`http://` 目标用 absolute-form），重定向由插件自己跟随；代理地址里的用户名密码会用于认证，但**不会**出现在日志或面板里。若本机配的是 SOCKS-only 代理，插件会说清楚这一点，而不是谎称「没有代理」。

面板会把这次用的出口写在下载步骤旁边（例如「通过 `http://127.0.0.1:7890` 下载（Windows 系统代理设置）」）；失败时，「原因」下面还会列出**已经尝试过的出口**——是没找到代理，还是走了代理仍然不通，两种情况的处理方式不同。

三条兜底路径始终有效：给 DSH 进程设 `HTTPS_PROXY=http://127.0.0.1:7890` 与 `NODE_USE_ENV_PROXY=1` 后重启（Node 24 会让 `fetch` 走该代理）；把二进制与 `checksums-*.txt` 一起放进下载缓存 `$DSH_HOME/cache/newapi/<版本>/`（也可直接放进 `<dataDir>`，文件名为 `new-api.exe` / `new-api`）；或用 `binaryPath` 指向已有文件。

不经过面板的组合（纯 CLI、无 Web 服务的 profile）没有配置界面可填，请在插件行里显式给出：

```yaml
- id: newapi
  name: 'dsh-newapi'
  config:
    rootPassword: '<8–128 个字符>'
```

此时插件跳过配置界面，直接用该密码与 `port` 完成首次开通（这是自动化安装的推荐做法）。没有面板、也没有 `rootPassword` 时，插件只会在日志里等你回答，不会启动网关。

## 重新配置

网关启动后，工具条上的「配置」会打开同一个配置界面，两个字段的含义按「改」来算：

| 字段 | 行为 |
|---|---|
| 端口号 | 与当前端口不同才会动：停掉当前子进程，用**同一份数据库**在新端口重新拉起，并刷新 `connection.json` 与面板里的控制台地址 |
| root 密码 | 只**展示**正在用的密码（掩码），旁边三个图标：复制、显示/隐藏、编辑。点铅笔图标后输入框才变成可编辑的空框（并自动聚焦），在那里输入新密码；点撤回图标放弃编辑、恢复展示。不改动（未编辑）时提交不会带上密码 |

改成新密码才走网关自己的安全验证流程（登录 → `POST /api/verify` 取一次性 `proof` → 带 `X-Security-Proof` 调 `PUT /api/user/self`），改完会作废所有会话，控制台需要重新登录一次。

改密码失败时界面会显示网关给出的原因，并在下面提示改走控制台「个人设置」。账号一旦启用二次验证或 Passkey，网关**只允许**用那种方式做安全验证，插件不会绕过——这时请在控制台里改密码。

配置界面的提交走 Host 的 `POST /api/dsh-newapi/setup`，与状态路由同一个浏览器信任边界（下面的「面板与信任边界」）：Host 侧重校验端口与口令长度（不依赖前端）、请求体上限 8 KB、root 密码不回显也不写进日志；首启的那次提交只被接受一次，之后同一路由只用于上面这种重新配置。

> 改了 Host 半（`index.js` / `src/`）需要让插件重新加载才会生效（重启 DSH，或在 Plugins 页关开一次）；只改浏览器端时页面热更新就能看到新界面。两边版本不一致时（状态里缺 `panelApi`）面板会直接提示「Host 还是旧代码」，而不是把旧 Host 的拒绝当成配置错误。


## 面板与信任边界

主区域用 iframe 加载 `<网关地址>/`。这能成立是因为：new-api 不发送 `X-Frame-Options`，也不发送 `Content-Security-Policy`（源码与运行时响应头都确认过）；Harness 的页面同样没有 CSP 元标签；两边都没有 framebusting 代码。

工具条显示的地址与「新窗口打开」用**本机在局域网上的 IPv4**（例如 `http://192.168.10.101:3000/`）而不是 `127.0.0.1`：new-api 监听所有网卡，别的设备也能打开这个地址。插件只在该地址确实能应答时才用它（启动时探测一次），否则回退到回环地址；`connection.json` 里本机客户端继续用 `baseUrl`（回环），局域网地址另存为 `lanBaseUrl` / `lanConsoleUrl`。内嵌的控制台仍走回环上的会话代理，这样登录态才保得住。

> Windows 防火墙可能拦截来自局域网其他设备的入站连接：本机自测（访问自己的局域网地址）会走本地路径、看不出这一点，请在另一台设备上验证。

工具条数据走 Host 的 `GET /api/dsh-newapi/status`，由 Harness 的 Connection 服务执行浏览器信任检查（Host/Origin 校验 + 浏览器会话认证）；没有挂载 Connection 的组合退回只允许回环请求。该路由只读，不接受任何参数。除了网关事实，它还会下发启动进度 `progress`（阶段、第几次尝试、下载的字节与速度）、失败提示 `hint`（分类 + 解法所需的事实：发布地址、该放二进制的路径、探测到的本机代理）与 `canRetry`——面板正是靠这几项才能在下载中与失败后说话。

写入走 Host 的 `POST /api/dsh-newapi/setup`，同一道信任检查：只接受 `POST`、只接受 `{ port, rootPassword? }`、端口与口令长度在 Host 侧重新校验（不依赖前端）、请求体上限 8 KB。没有在等首启回答、也没有运行中的网关时一律 `409`。

第三道路由 `POST /api/dsh-newapi/sync` 同样过信任检查，且**不接受任何请求体**：它的输入（运行中的网关、Harness 的模型配置）都在 Host 侧，作用只是让插件重读一次 `/v1/models` 并把结果再登记一次。网关没在运行时 `409`，网关起了但一个模型都没有时 `409` 并给出原因。

第四道路由 `POST /api/dsh-newapi/retry` 让**已经放弃的启动再跑一轮**，同样不接受请求体：面板的「重试启动」按钮是它唯一的调用者。正在启动、网关已在运行、首启设置还没收到时一律 `409`（不会因此跑出第二个网关）；插件已卸载时也 `409`。

状态路由仍会下发网关 Token 与管理员用户名/密码（同机、同源、已认证的浏览器，与 Harness 其他管理页一致；面板本身不再提供复制按钮）。不希望这些值出现在浏览器里，就别加载这个插件，直接读 `<dataDir>/.dsh-gateway.json`。

## 内嵌控制台的登录态

**在浏览器里打开 Harness 时**（顶层站点是 `http://127.0.0.1`），网关与之同站，new-api 的 `SameSite=Strict` 会话 Cookie 正常收发，登录一次即可长期保持（刷新 Cookie 有效期 30 天）。

**在桌面 App 里**（顶层文档来自 `dsh-app://app`，见 `apps/desktop/src/main.ts` 的 `applicationUrl`），内嵌网关是**跨站框架**，浏览器既不会保存也不会发送 new-api 的会话 Cookie；而 new-api 前端的访问令牌只存在内存里（`web/src/stores/auth-store.ts`），15 分钟过期，续期必须走那个 Cookie（`web/src/lib/auth-session.ts`）。直接内嵌的结果就是每次重新加载 iframe 都回到登录页。

### 本地会话桥（默认启用）

插件因此在 Host 侧起一个**只监听回环**的反向代理，替内嵌控制台持有会话：

- **它跟随你在控制台里登录的账号**。控制台就是从这个源提供的，所以你在登录页提交的 `POST /api/user/login` 会经过代理——代理据此记住 `用户名 + 口令`，并接管这次登录产生的会话。代理**不会**自己挑账号登录；首启开通创建的 root 只用于开通本身（`/api/setup` 与生成网关 Token）。
- 它把内嵌控制台发往 `/api/user/auth/refresh` 的请求，用自己的会话转发到网关真实的刷新端点并原样回传——令牌照常轮换，`session.sid` 保持不变，所以前端带 `X-Auth-Session` 的校验也能通过；网关返回 401 时用记住的账号重新登录一次。
- 你**没有登录过**任何账号时，代理直接回 401，控制台照常显示它自己的登录页——不会偷偷用某个账号把你登进去。
- 你在控制台里**主动退出登录**时，记住的账号会被清掉，下次进入需要重新登录（退出必须算数）。
- 其余请求（页面、静态资源、`/api/*`）原样透传，代理不解析也不改写业务响应。
- 网关那边**没有任何改动**：它依旧用同一套口令、Cookie 与 Origin 校验，只是持 Cookie 的人从浏览器换成了本机的代理进程。

记住的账号存在 `<dataDir>/.dsh-gateway.json`（权限 `0600`）的 `consoleAccount` 字段。开启网关的口令加密登录（`PASSWORD_LOGIN_ENCRYPTION_ENABLED=true`）时，代理在传输中读到的是密文，无法记住口令——此时只维持当次会话，重启后需要重新登录一次。

因此切走面板、重进、甚至重启 App，控制台都不需要重新登录。会话在网关侧失效时（例如 30 天到期或网关重建数据库），代理会用记住的账号自动重新登录一次。

代理用 OS 分配的随机端口，且只绑定 `127.0.0.1`（不同于网关自身的 `:port` 全接口绑定）。它确实让**本机**进程无需口令就能换到一个网关会话——同一用户本来就能读到 `<dataDir>/.dsh-gateway.json` 里的口令，所以对同用户进程没有增加暴露面；多用户机器上若不接受这一点，把插件行的 `enabled` 设为 `false`，或直接用工具条的「新窗口打开」。


## 安装

```sh
# 从目录安装（开发用；先装好本包的依赖）
cd dsh-plugins/newapi && bun install
dsh plugin --profile web add /absolute/path/to/dsh-plugins/newapi

# 或从 tarball / npm
dsh plugin --profile web add ./dsh-newapi-0.1.0.tgz
```

`dsh plugin add` 会把本包加入 profile 的 `dsh.profile.bundles`，下次启动 `dsh web` 时生效。

> `link:` 方式安装本地目录时，pnpm 不会自动安装被链接包的依赖，所以需要先在该目录执行 `bun install`（或 `npm install`）。从 npm / tarball 安装不需要这一步。

## 配置

在 profile 的 `cordis.patch.yml` 或 `--patch` 覆盖层里覆盖同名行：

```yaml
- id: newapi
  name: 'dsh-newapi'
  config:
    port: 3000
    version: v1.0.0-rc.39
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 关闭后完全不启动网关 |
| `version` | `v1.0.0-rc.39` | 下载的 release tag |
| `binaryPath` | 自动发现，找不到才下载 | 指定已有二进制，跳过下面的发现与下载 |
| `port` | `3000` | 首选端口，也是首次运行配置界面里的默认值；被占用时自动向后找可用端口并记住 |
| `dataDir` | `$DSH_HOME/newapi` | SQLite、日志、凭证与 `connection.json` 所在目录 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | Harness home，用于定位下载缓存 |
| `downloadBaseUrl` | GitHub releases | 发布地址前缀 |
| `rootUsername` | `root` | 管理员用户名 |
| `rootPassword` | 首次运行时由面板填写 | 管理员密码；显式配置则跳过首次运行配置界面，实例已初始化但凭证丢失时也需要它 |
| `tokenName` | `dsh` | 自动创建的网关 Token 名称 |
| `readyTimeoutMs` | `120000` | 等待网关就绪的上限 |
| `publishProvider` | `true` | 是否把网关登记进 Harness 的模型配置（provider 路由 + 凭据），关掉则只有客户端接入信息 |
| `providerName` | `new-api` | 登记的路由名，也就是 `llm-pi-ai.providers` 下的键与选择器里的分组 id |
| `providerDisplayName` | `New API` | 选择器里显示的名字 |
| `providerApiKeyRef` | `NEW_API_KEY` | 存 key 用的凭据引用名；该名字已被环境变量占用（只读来源遮蔽）时会拒绝写入，换个名字即可 |
| `providerContextWindow` | `131072` | 上下文窗口：模型自己的目录没给出时用的兜底值（详见下面的「上下文窗口与输出上限」） |
| `providerMaxTokens` | `32768` | 输出上限：同上，也是没被描述时的兜底值 |
| `providerReasoningEfforts` | `off,low,medium,high,xhigh,max` | 每个模型提供的思考强度档位（逗号分隔，顺序即下拉框顺序）；留空表示不声明任何推理能力 |
| `providerImageModels` | 空 | 覆盖自动判断：**接受图片输入**的模型名（逗号分隔）、`*` 表示每个模型、`!名字` 表示排除某个模型；详见下面的「多模态」 |
| `providerDefaultInput` | `text,image` | 两个来源都描述不到的模型按什么声明输入类型（`text` / `image` / 留空 = 什么都不声明，交回 pi-ai 的纯文本兜底） |

产物文件：

- `<dataDir>/.dsh-gateway.json` — 端口、`SESSION_SECRET`、管理员密码、网关 Token、`setupCompleted`（权限 `0600`）
- `<dataDir>/connection.json` — `baseUrl`、`lanBaseUrl` / `lanConsoleUrl`（局域网地址）、`token`、OpenAI/Anthropic 地址、模型列表、`claudeCodeEnv`
- `$DSH_HOME/.credentials.yaml` 的 `refs.<providerApiKeyRef>` — 上面那个 Token，供 Harness 的 provider 按次解析
- `$DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers.<providerName>` — provider 路由；这两个文件都是 Harness 自己的设置文档，也可以在「设置 → 模型」里直接看和改

## 二进制从哪来

插件按下面的顺序取一个可执行文件，第一个可用的胜出；全程不需要网络，除非走到了最后一步：

| 顺序 | 位置 | 说明 |
|---|---|---|
| 1 | `config.binaryPath` | 你显式指定的路径；插件不再查找也不再下载 |
| 2 | `<dataDir>/new-api.exe`（非 Windows 为 `new-api`） | 自备的二进制丢进数据目录即可 |
| 3 | `<dataDir>/new-api-<版本>.exe` | 同上，按 release 资源名命名（macOS 为 `new-api-macos-<版本>` 等） |
| 4 | `$DSH_HOME/cache/newapi/<版本>/new-api-<版本>.exe` | 之前下载留下的缓存 |
| 5 | `downloadBaseUrl` | 从发布地址下载 |

信任规则：

- **从网络下载的必须过校验**：按同目录的 `checksums-*.txt` 校验 sha256，不符就删掉重下一次（两次仍不符则报错，不会执行）。
- **本机已有的文件按原样使用**：它是本机所有者放的，插件不替你判断它是否可信；启动日志会打印来源与该文件自己的 sha256，例如
  `[newapi] gateway binary: C:\Users\...\new-api-v1.0.0-rc.39.exe (release cache; no release manifest covers it, sha256 cbfe…)`。
- 但**本机已缓存的 manifest 与文件不符时，该文件会被跳过**，转而走下载；只有本机没有 manifest（或 manifest 里没有这条）时才会“未校验使用”。
- Windows 之外的文件会被 `chmod 0755`，所以从 U 盘或压缩包解出来的二进制不需要自己补执行位。

于是离线环境只要把二进制放进 `<dataDir>`、或让它留在下载缓存里，就能正常启动；`version` 变化时缓存路径随之变化，需要重新提供或联网下载。

## 配置上游并选模型

网关起来后，**在 New API 自带控制台里添加上游渠道**（`http://127.0.0.1:<port>/`，用 `root` 和 `.dsh-gateway.json` 里的密码登录）。

Harness 侧不用手填任何东西：插件在每次网关就绪后自动完成下面两件事，用的正是 Harness 自己的「设置 → 模型」页面会写的那两处：

| 写到哪里 | 内容 |
|---|---|
| `$DSH_HOME/.credentials.yaml` 的 `refs` | `NEW_API_KEY` = 网关 Token（48 位，不带 `sk-`），即「生成 Token」那一步读回的 key |
| `$DSH_HOME/settings.yaml` 的 `llm-pi-ai` | `providers.new-api`：`api: openai-completions`、`baseURL: http://127.0.0.1:<port>/v1`、`apiKeyEnv: NEW_API_KEY`、思考强度档位，以及该 Token 能用的全部模型 id |

两处 seam 都是**按次读取**的，所以换端口后写进去的新 `baseURL`、轮换后的新 key 都直接作用于下一次请求，不需要重启 Harness；provider 路由的变化也是热生效，选择器会立刻多出 `New API` 这一组模型。面板上会显示这一行结果，例如「已写入 DSH 模型配置：New API（12 个模型）」。

**在控制台里加了新渠道/新模型之后**，点工具条的「同步模型」（`POST /api/dsh-newapi/sync`）：插件重新读一次 `/v1/models`、刷新 `connection.json`，并把新的模型列表再登记一次。不点也可以，下次 Harness 启动时会自动同步一次。

不想要这一步（例如已经手工配好了 provider，或不想让网关的 key 进 `settings.yaml`），把插件行的 `publishProvider` 设为 `false`；想换名字、换位置、换容量假设，用下面的 `provider*` 字段。

### 思考强度（对话栏里的第二个下拉框）

每个登记出来的模型都带同一套档位，默认 `off,low,medium,high,xhigh,max`（用 `providerReasoningEfforts` 改）。选中的档位就是发给网关的 `reasoning_effort`，取值与档位同名——它们正是 New API 自己的请求解析器接受的拼写（`relaykit/relayconvert/reasoning`：`none/minimal/low/medium/high/xhigh/max`），所以不需要任何转换表：

| 档位 | 发出去的内容 |
|---|---|
| `off`（默认） | **不发** `reasoning_effort`（注意：New API 不接受字面量 `off`，因此「关闭」= 保持上游默认；对本身就会思考的模型，上游可能照旧思考） |
| `low` / `medium` / `high` | `reasoning_effort: low` / `medium` / `high` |
| `xhigh` / `max` | `reasoning_effort: xhigh` / `max`（New API 认识这两个值；具体上游能不能吃下由它的渠道决定，被拒时把这一档删掉即可） |

档位名在 DSH 界面里显示为 `Off / Low / Medium / High / Xhigh / Max`（名字由 Harness 的 pi-ai 适配器给出，跟随档位 id，不随语言变化）。路由同时声明了 `compat.thinkingFormat: openai` 与 `supportsReasoningEffort: true`：这条路由是配置声明出来的、pi-ai 目录里没有它，所以不能靠 URL 自动探测。

**同一处还声明了 `supportsDeveloperRole: false`**，这一条与推理无关但同样必须：pi-ai 只有在「这个模型会思考」时才会把系统提示词写成 `role: "developer"`，而它判断兼容性的依据是**地址**——`http://127.0.0.1:<port>/v1` 不属于它认得的任何非标准端点，于是它按「标准 OpenAI 端点」处理，发出去的 `developer` 被网关背后的上游拒掉：

```
422: Failed to deserialize the JSON body into the target type: messages[0].role:
     unknown variant `developer`, expected one of `system`, `user`, `assistant`, `tool`, `latest_reminder`
```

这类上游只认 `system`，而 `system` 是到处都认的（连偏好 `developer` 的 OpenAI 新模型也接受），所以路由固定按 `system` 发。声明与推理档位无关：即使 `providerReasoningEfforts` 留空，这条 compat 也照写。

> ⚠️ New API 聚合的上游各不相同，网关**无法告诉 Harness 哪个模型真的会思考**，所以这套档位是给全线模型声明的：默认档不发送任何参数，因此不影响普通对话；但给一个不支持 `reasoning_effort` 的模型选「高」可能被上游拒绝（界面会显示上游的报错）。只想给部分模型开档位、或某个模型的档位不同，请在「设置 → 模型」里按模型改 `reasoningEfforts`；整套都不需要就设 `providerReasoningEfforts: ''`（此时路由不声明任何推理能力，对话栏也不会出现强度选项）。


> 频道为空时（网关一个新模型都没有）插件**不会**登记路由——pi-ai 会拒绝一个「声明了却一个模型也解析不出来」的 provider，登记了也是空的。此时面板显示的是原因（`serves no models yet`），先在控制台加渠道即可。

### 多模态（图像输入）

New API 没有任何地方把「模型接受什么输入」讲出来：`/v1/models` 只回 `id` / `owned_by` / `supported_endpoint_types`，控制台模型元数据里的 `tags` 是自由文本（默认往往是空的），pi-ai 的兜底又是纯文本。所以插件自己去找答案，**不需要你在 Harness 侧配置任何东西**，而且答案跟着网关的模型列表走——在控制台加了模型、打了标签，下次启动或点「同步模型」就自动跟上。

判断顺序（前面的先答，答了就不再往后问）：

| 顺序 | 来源 | 说什么 |
|---|---|---|
| 1 | 插件行 `providerImageModels` | 你显式点名的模型（`*` = 全部，`!名字` = 排除） |
| 2 | **New API 的模型标签** | 在控制台「模型」页给该模型打的标签（`vision` / `vlm` / `multimodal` / `多模态` / `视觉` / `图像`，大小写随意），官方元数据同步导入的标签同样算 |
| 3 | **Harness 自带的模型目录** | 已安装的目录里就有同 id 的模型（已配置的 provider，以及整个已安装目录：`glm-5.3-flash`、`deepseek-flash` 这类模型本来就带着模态信息），只读内存、不发请求 |
| 4 | `providerDefaultInput`（默认 `text,image`） | 以上全都没提到这个模型时的答案 |

插件每次登记都会把结果和来源写进日志（`<dataDir>/dsh-newapi.log`），例如：

```
[newapi] image input: deepseek-flash (model catalog), glm-5.3-flash (model catalog); text only: glm-5.3, deepseek-v4-flash, deepseek-v4-pro
[newapi] image input: nothing describes deepseek-4.1-flash; they take providerDefaultInput (text,image), and a leading ! withholds one
```

`(model catalog)` = Harness 目录说的，`(New API tag)` = 控制台标签说的，`(plugin row)` = 你在插件行点名的，`(assumed)` / `nothing describes` = 谁都没提到，按第 4 条办。

> **为什么没被描述的模型默认「能看图」**：网关服务的模型是你自己加进去的，而被描述不到的模型如果按纯文本处理，附图会被 Harness 直接拒掉——这个死结只有改插件行才能解开。反过来，一个其实不吃图的模型收到图片，会把上游自己的报错带回来（New API 通常回 `Model only support text input`），那一轮你就知道它的真实能力了。想让这类模型继续走纯文本，把 `providerDefaultInput` 设成 `text`（或留空，交回 pi-ai 的纯文本兜底）。
>
> **目录说错了怎么办**：第 1 条可以否决后面所有条——`providerImageModels: '!glm-5.3'` 就把目录认为能吃图的模型按纯文本处理。

边界（都是明说的）：

- **标签是控制台里的自由文本，不是结构化字段**，所以只有整个标签命中才算（`image-generation` 不算「接受图片输入」）。
- **控制台的定价页若被设成需要登录**（`HeaderNavModules` 里给 `pricing` 开了 `requireAuth`），标签这一路就读不到，日志会写 `the gateway's model tags answered nothing: …`，其余来源照常。
- **兜底只识别文字与图像两种模态**：pi-ai 只有 `text` / `image`，音频、视频不在声明范围内。
- **「设置 → 模型」里对单个模型的修改不会被保留**：每次启动/同步插件都按网关当前的模型列表整体重写 `models`（`input`、`name`、`contextWindow`… 一起被替换）。要长期生效请写进插件行，或让模型能被目录描述（见下）。

### 上下文窗口与输出上限

和模态一样，New API 也不告诉 Harness「这个模型能装多少 token」：`/v1/models` 的每个条目只有 `id` / `owned_by` / `supported_endpoint_types`，控制台的模型元数据里也没有能放这个数的字段（`description` / `icon` / `tags` / `vendor` / `endpoints` / `name_rule` / `status`）。所以插件同样去问 **Harness 自己已经知道这个模型多少**——两处合起来读：

- **模型目录**：`@earendil-works/pi-ai` 的每个模型条目本来就带着 `contextWindow` 与 `maxTokens`（`dist/providers/data/*.json`），已配置的路由与整个已安装目录都会读；
- **路由自己的适配器**：有些 provider 不靠 pi-ai 目录、而是自带一份目录（Harness 的 DeepSeek 适配器就是这样，它服务的 `deepseek-flash` 恰好是网关背后最常见的那个上游），这份信息通过 `resolveModelInfo` 拿到——**1M 上下文（`DEFAULT_CONTEXT_WINDOW`）与 256k 输出就写在这里**。

模型 id 一样，就是同一个模型：

```
[newapi] capacities: deepseek-flash 1000000 in/256000 out, deepseek-v4-pro 1000000 in/384000 out
[newapi] capacities: nothing states one for deepseek-4.1-flash; they take providerContextWindow/providerMaxTokens (131072 in/32768 out)
```

于是「上下文长度不对」这件事按模型解决，而不是全线一个数：能问出容量的模型带上它自己的窗口与输出上限（写进该模型的 `contextWindow` / `maxTokens`），问不出来的名字（自建别名、刚发布还没进任何目录的型号）才落到 `providerContextWindow` / `providerMaxTokens` 这两个兜底值上——上面第二行日志就是点名告诉你哪些模型是兜底的。

几条明说的规则：

- **按模型 id 认**。别名（例如把 `deepseek-v4-flash` 在 New API 里映射成自己的名字）在任何目录里都查不到，还是会落到兜底值；给这类模型一个真实的数字，只能调 `providerContextWindow` / `providerMaxTokens`。
- **谁说的都算，取较小的那个容量**：同一个 id 被多处描述时（模型自己的目录、某个网关对它的列举、它自己适配器的解析），逐字段取最小值——放进的 token 更少的那一读，是哪个端点都不会拒的一读。
- **输出上限高于上下文窗口时会被压到窗口大小**（pi-ai 把两者当独立上限读，自相矛盾的一对会放进一个模型满足不了的请求）。
- 模态与容量走的是**同一次读取**，只读内存、不发请求；读不到时（组合里没有 `llm` 服务）这一路整体缺席，日志会写 `the harness' model catalogs answered nothing: …`，模型全部落到兜底值。
- 这条修正**不改变路由级字段**：`defaultContextWindow` / `defaultMaxTokens` 仍然是兜底，你手改它们不会影响已经问出容量的模型。

> 如果你希望网关自己就能说出每个模型的容量（这样连别名也能自动正确），那需要 New API 在模型元数据里增加容量字段并在 `/v1/models` 或 `/api/pricing` 里暴露——当前版本没有这个信息，插件的兜底值只是「网关没说」的诚实结果，不是对模型的断言。

> 顺带说明这条读取为什么必须问**两处**：pi-ai 的目录只管它自己带的那些 provider，而 `deepseek-flash` 这类 id 属于 Harness 自己的 DeepSeek 适配器，它的目录只在 `resolveModelInfo` 里给出（`llm-deepseek/src/common/defaults.ts` 的 `DEFAULT_CONTEXT_WINDOW`）——只读 pi-ai 目录的话，正好会漏掉这个最常用的模型。

## 在 Claude Code 里使用

```sh
# PowerShell
$env:ANTHROPIC_BASE_URL="http://127.0.0.1:3000"
$env:ANTHROPIC_AUTH_TOKEN="<connection.json 中的 token>"
claude
```

或写进 `~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3000",
    "ANTHROPIC_AUTH_TOKEN": "<token>"
  }
}
```

## 已知限制

- **网关监听所有网卡**：New API 内部按 `Addr: ":" + port` 绑定（`main.go`），因此端口在局域网上可达，不受 `127.0.0.1` 限制。请把端口和 Token 视为对外凭证；需要严格只监听回环时，必须给 New API 增加绑定主机配置并自行编译。
- **`/v1/messages/count_tokens` 不可用**：该路由在上游被注释停用（`router/relay-router.go`），Claude Code 会退化成本地估算上下文，不影响对话。
- **只有本机找不到可用二进制时才需要网络**：此时从 GitHub 下载约 128 MB 的二进制（带校验和验证与重试）。离线环境请把二进制放进 `<dataDir>`、保留在下载缓存里，或用 `binaryPath` 指定。
- **下载的出口由插件自己找**：Node 的 `fetch` 不使用系统代理，所以插件按「环境变量 → Windows 代理设置 → 直连失败后探测本机常见代理端口」的顺序自己选路（见上文「下载要走代理的机器」）。找不到出口时的日志是 `gateway unavailable: fetch failed <- Connect Timeout Error (attempted address: github.com:443 ...)`；找到了代理但仍然不通时，日志与面板都会点名那个代理。它只会说 HTTP 代理，SOCKS-only 的机器需要另开 HTTP 端口，或把二进制与 `checksums-*.txt` 一起放进下载缓存 `$DSH_HOME/cache/newapi/<版本>/`（也可直接放进 `<dataDir>`，文件名为 `new-api.exe` / `new-api`），或用 `binaryPath` 指向已有文件。
- **端口被占用时端口会变化**：真实端口记录在 `connection.json`，不要假设一定是 `port` 配置值。
- **没有面板的首次运行需要显式配置**：纯 CLI / 无 Web 服务的 profile 无法显示配置界面，插件会停在日志里等回答；请在插件行配 `rootPassword`（可选 `port`）。
- **模型配置的登记依赖 Harness 的 settings / credentials 两个 seam**：组合里没有它们时（例如 `sdk-minimal` 这类精简 profile），插件只在日志与面板里报告原因，网关本身照常工作，仍然可以用 `<dataDir>/connection.json` 里的地址与 Token 手工接入。
- **登记过的 provider 路由不会被插件撤下**：把 `publishProvider` 设为 `false`、或在 Plugins 页卸载插件，都只是不再写入；`settings.yaml` 里那条路由会留在原地（也可以自己删）。这样插件重载不会把你手改过的路由一起抹掉，代价是网关长期停用后需要在「设置 → 模型」里手动清理。
- **路由里的 `models` 由网关决定，会被整体重写**：每个模型的 id、思考档位、图像声明与容量都由插件行的配置、Harness 自带的模型目录加上网关当前的 `/v1/models` 决定，所以「设置 → 模型」里对单个模型做的改动（`input`、`name`、`contextWindow`…）会在下次启动或点「同步模型」时被替换掉：想改模态就写 `providerImageModels`，想改容量就调 `providerContextWindow` / `providerMaxTokens`（或让模型 id 能被目录描述）。路由级字段不受影响：插件只写 `api` / `baseURL` / `apiKeyEnv` / 容量兜底 / `models` / 推理相关字段，你手加的 `defaultInput` 之类会原样保留。
- **模型别名没有容量来源**：目录按模型 id 认模型，New API 里的自建别名（或还没进目录的新型号）查不到条目，只能拿到 `providerContextWindow` / `providerMaxTokens` 的兜底值——日志的 `capacities: nothing states one for …` 一行会点名这些模型。

## 本地自检

不启动 Harness 也能验证两条链路：

```sh
node scripts/smoke.mjs          # 首次运行的配置界面 → 复用/下载二进制 → 启动 → 开通 → 生成 Token → 会话桥 → 加渠道后同步模型配置（写 provider 路由与凭据引用）→ 改端口与 root 密码 → 再跑一次确认不再被问 → 停止
node scripts/check-binary.mjs   # 本地二进制的查找顺序、不走网络的保证、与 manifest 冲突时拒绝执行
node scripts/check-startup.mjs  # 启动失败的那一次会终止子进程，不留下占用端口的僵尸
node scripts/check-boot.mjs     # 启动进程上报的内容：失败的分类与解法事实、下载的字节/速度/剩余时间随流上报、重试路由的接受与拒绝
node scripts/check-net.mjs      # 出口的选择与使用：环境变量/Windows 设置/绕过列表的优先级，代理地址与凭据的处理，CONNECT 隧道与 absolute-form 请求、重定向、被拒的 CONNECT，以及「直连失败后才探测端口」
node scripts/check-retry.mjs    # 整条失败链路：三次尝试后留下面板可描述的状态，面板的重试真的重跑一轮启动（而不是重读同一份状态）
node scripts/check-config.mjs   # 插件行的默认值与拒绝规则
node scripts/check-setup.mjs    # 配置路由：何时被问、哪些提交会被拒（越权/重复/超长/非法取值）、运行中如何应用、同步模型
node scripts/check-provider.mjs # 写进 Harness 模型配置的内容：协议/地址/凭据引用、key 不进设置文档、空模型与两种拒绝、图像能力的四个来源与优先级，以及容量的来源与「取小 / 压到窗口」的规则
bun run build:client            # 由 src/client/index.jsx 生成 lib/client.js
node scripts/check-client.mjs   # 用模块加载器桩件加载 lib/client.js，校验注册并渲染面板与配置界面
```

### 启动失败了怎么办

插件自己的每一行日志都会同时写进 **`<dataDir>/dsh-newapi.log`**（默认 `~/.dsh/newapi/dsh-newapi.log`），因为桌面壳的控制台不一定看得到。出问题先读它。

两种「装了但没运行」要分开处理：

1. **插件根本没被加载** —— 走的是 **Plugins 页的「移除 + 安装」**时属于这一种。DSH 插件管理器明确写着「包替换需要重启进程才能载入新的 JS 模块代」（`packages/boot/plugin-manager/README.md` 的 Known Limitations），所以移除再装回之后必须**重启 DSH**。若只是想让插件重新加载，用**配置级**的开关（Plugins 页里把 `dsh-newapi` 关掉再打开）即可即时生效，不必重启。
2. **插件加载了、网关没起来** —— 面板会直接显示分类后的原因与对应解法，`dsh-newapi.log` 里则是每次尝试的完整原因。插件自动重试 3 次（间隔 5s / 15s）；三次都失败后它停下，把状态留在面板上，**处理完点面板上的「重试启动」**即可继续（改环境变量需要重启 DSH 才生效）。
3. **首次运行停在 `waiting for the New API panel ...`** —— 这不是失败，是插件在等你在侧边栏 **New API** 面板里填端口和 root 密码。若这个 profile 没有面板，就按上面那条限制在插件行里配 `rootPassword`。

冷装（缓存里没有二进制）时第一次尝试要先下完约 128 MB，面板在这一步显示已下载的字节、速度与预计剩余时间，日志里对应的行是 `looking for a gateway binary ...`。嫌慢就把二进制放进 `<dataDir>` 或给插件行配 `binaryPath`。重装/换 `dataDir` 会新建数据库，root 密码随之回到「首次运行配置界面」或被显式配置的值——想固定密码，就在插件行里显式配 `rootPassword`。

## 修改浏览器端代码

浏览器端源文件在 `src/client/index.jsx`，**产物 `lib/client.js` 必须提交**（Harness 只按包名加载 `./client` 导出）。改完源码后：

```sh
bun run build:client
```

产物是页面要求的 lazy-CJS 工厂格式（`window.__ModuleLoader__.load({ id, factory })`），`react` 与 `react/jsx-runtime` 保持 external——它们由页面的模块表提供，不能打进包里。


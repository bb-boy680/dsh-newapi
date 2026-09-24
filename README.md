<p align="center">
  <a href="README.md">English</a> · <a href="docs/README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">DSH New API</h1>

<p align="center">
  <strong>New API, installed inside DeepSeek Harness — a local gateway that starts with DSH.</strong><br>
  No manual download, launch or initialisation: the plugin owns the child process, the database and the access token, and hands the gateway's models to the DSH model selector.<br>
  The same endpoint then serves Claude Code, Codex, or any OpenAI / Anthropic-compatible client.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-AGPL--3.0-3178C6?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-success?style=flat-square" alt="Node version">
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-0075de?style=flat-square" alt="DSH plugin">
  <img src="https://img.shields.io/badge/New%20API-v1.0.0--rc.39-2a9d99?style=flat-square" alt="New API">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-x64-0078d4?style=flat-square&logo=windows&logoColor=white" alt="Windows x64">
  <img src="https://img.shields.io/badge/macOS-universal-f6f5f4?style=flat-square&logo=apple&logoColor=black" alt="macOS">
  <img src="https://img.shields.io/badge/Linux-x64%20%7C%20arm64-f6b73c?style=flat-square&logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-1aae39?style=flat-square" alt="No runtime dependencies">
  <img src="https://img.shields.io/badge/UI-zh%20%2F%20en-391c57?style=flat-square" alt="Bilingual">
</p>

<p align="center">
  <a href="https://github.com/bb-boy680/dsh-newapi">GitHub</a> ·
  <a href="https://github.com/bb-boy680/dsh-newapi/issues">Issues</a> ·
  <a href="https://github.com/QuantumNous/new-api">Upstream New API</a>
</p>

<p align="center">
  <img src="./static/new-api.png" width="90%" alt="The New API panel and embedded console inside DeepSeek Harness">
</p>
<p align="center">
  <em>A <code>New API</code> panel in the sidebar, the console in the main column; the toolbar carries the gateway status, its address, and Reload / Sync models / Open in a new window / Configure.</em>
</p>

---

## Why DSH New API?

New API is good. Running it is the annoying part.

- **Nothing to host by hand.** Enable the plugin and the gateway comes up with DSH: the plugin downloads and verifies the binary, keeps the SQLite database, the logs and the access token in DSH's own data directory.
- **Nothing to initialise by hand.** First run asks for two values in the panel (port and root password); the plugin then completes `/api/setup`, logs in, creates a token and reads the model list for you.
- **No keys copied between clients.** The gateway issues one token, and DSH, Claude Code, Codex and anything OpenAI / Anthropic-compatible point at `http://127.0.0.1:<port>`.
- **Models show up in DSH.** The plugin writes the gateway's model list into DSH's own model configuration (an `llm-pi-ai` route plus a credential reference) — no restart, no key retyped.
- **One download, then offline.** The binary is cached per release tag and checked against the published sha256 manifest; the second start touches no network.
- **Works behind a blocked network.** The plugin finds a way out by itself — a proxy in the environment, the Windows system proxy settings, and as a last resort the local ports desktop proxy clients listen on. Or drop a binary in place yourself.
- **A failed install is not a dead end.** The boot reports its phases, classifies the failure (network / checksum / port / gateway / timeout), and the panel offers the reason, the ways out, and a Retry button.

## Features

> [!TIP]
> This is not a fork of New API, and not a wrapper script around it — it is the integration that runs New API as a **managed sidecar of DSH**: fetch the binary, start it, initialise it, publish its models, embed its console.

- **Managed lifecycle** — starts the gateway as a child process through DSH's `subprocess` service (`SQLITE_PATH` / `SESSION_SECRET` / `GIN_MODE=release` / `TRUSTED_PROXIES=none`), polls `/api/status` until it answers, and stops it cleanly on unload or on a port change.
- **Adopts an existing instance** — if something already answers `/api/status` on the preferred port (say, a New API you started yourself), the plugin adopts it instead of starting a second one.
- **Binary source precedence** — `new-api(.exe)` in the data directory → the release asset name in the data directory → the per-version cache → and only then a download. A hand-placed binary is used as it stands and its sha256 is reported; only bytes fetched over the network must prove themselves against the published manifest.
- **Finds the way out of the machine** — resolves a proxy as environment variable → Windows Internet Settings registry → local port probe after a direct attempt has already failed, and actually speaks it (a `CONNECT` tunnel for HTTPS, absolute form for HTTP). `NO_PROXY` / `ProxyOverride` are honoured, and proxy credentials never reach the log.
- **First run decided by the panel** — the port and the root password are collected *before* the gateway creates its database. In a composition with no panel (a command-line one, say), setting `rootPassword` on the plugin row skips the question entirely.
- **Publishes the gateway into DSH** — the gateway token goes to the credential service, the `new-api` route goes into `llm-pi-ai` settings, and the model list reaches the model selector. Add a channel in the console later, press Sync models once, and no DSH restart is needed.
- **Declarable thinking levels** — `providerReasoningEfforts` states which levels the route offers (`off` / `low` / `medium` / `high` / `xhigh` / `max`) and pins the OpenAI dispatch format; an empty value declares no reasoning at all, which is the honest answer for upstreams that ignore the parameter.
- **Image input decided by precedence** — the plugin row's `providerImageModels` (with `*` and `!` exclusions) → the model's own tag in the New API console (`vision` / `vlm` / `multimodal` / `多模态` / `视觉` …) → DSH's installed model catalogs (matched by id); a model nothing describes takes `providerDefaultInput`.
- **Per-model capacity** — a model the installed catalogs describe keeps its own context window and output cap (the smallest any source states); a model a relay renamed — `deepseek-v4.1-flash` for the catalogs' `deepseek-flash` — takes the numbers the catalogs state for the id it aliases, out of the box and already on the first sync; a model nothing describes keeps the numbers the route already states for it (what you typed in 「设置 → 模型」), and only a model that carries none of those falls back to the route's `providerContextWindow` / `providerMaxTokens`.
- **Console session bridge** — the desktop shell serves its document from `dsh-app://`, which makes the embedded console a cross-site frame whose `SameSite=Strict` cookies the browser drops. The plugin runs a loopback reverse proxy that owns one real gateway session for the account a person signed in with, so the console stops falling back to its sign-in page.
- **Classified, retryable failures** — three boot attempts (5s / 15s apart); if they are spent, the cause lands in the panel and a Retry button runs the boot again, instead of toggling the plugin off and on.
- **Bilingual panel** — copy goes through DSH's locale service, with `zh` and `en` both shipped.
- **Zero runtime dependencies** — the plugin pulls in nothing; its config fields are read and checked in code, so installing it never needs a package manager to resolve anything.

## Quick start

> [!NOTE]
> Requires the DeepSeek Harness desktop app (with the `webServer` and `subprocess` services) and Node.js `^22.19` or `>=24`.

### 1. Install the plugin

Open DSH's **Plugins** page → **Add plugin** → paste the repository address → **Install**:

```text
https://github.com/bb-boy680/dsh-newapi
```

A package name or a local directory path works too; pointing at a checkout of this repository is recognised as well.

<p align="center">
  <img src="./static/setup.png" width="56%" alt="Adding dsh-newapi on the DSH Plugins page">
</p>
<p align="center">
  <em>The Add plugin dialog accepts a package name, a GitHub repository address or a local directory path.</em>
</p>

### 2. Complete the first-run setup

Once the plugin is enabled, a **New API** panel appears in the sidebar:

1. On the first run the panel first asks for the **port** (default `3000`) and the **root password** (8–128 characters — save it somewhere).
2. Choose **Finish**. The first install downloads the ~**128 MB** gateway binary, and the panel shows the download source, bytes received, speed and estimated time left.
3. The download is verified with sha256, the process starts, the instance is initialised, an access token is created — and the New API console appears.

> [!IMPORTANT]
> Keep DSH open while it downloads. Refreshing the browser or leaving the page does not interrupt the download; closing DSH does.

### 3. Add an upstream channel in the console

The embedded console *is* New API's own console (**Channels → Add channel**); that is where upstream services and keys go. Then press **Sync models** in the panel and the new models appear in DSH's model selector.

### 4. Hand it to other clients

The address and the token live in a connection file (Windows: `%USERPROFILE%\.dsh\newapi\connection.json`; macOS / Linux: `~/.dsh/newapi/connection.json`, mode `0600`):

```json
{
  "port": 3000,
  "baseUrl": "http://127.0.0.1:3000",
  "openaiBaseUrl": "http://127.0.0.1:3000/v1",
  "anthropicBaseUrl": "http://127.0.0.1:3000",
  "modelsEndpoint": "http://127.0.0.1:3000/v1/models",
  "consoleUrl": "http://127.0.0.1:3000/",
  "lanBaseUrl": "http://192.168.1.10:3000",
  "lanConsoleUrl": "http://192.168.1.10:3000/",
  "token": "sk-...",
  "claudeCodeEnv": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3000",
    "ANTHROPIC_AUTH_TOKEN": "sk-..."
  },
  "models": ["deepseek-chat", "gpt-4o-mini"]
}
```

`lanBaseUrl` / `lanConsoleUrl` appear only when this machine has a network address that actually answers — they are there so a phone or another computer on the same network can use the gateway too.

The same facts are written to the log (`<dataDir>/dsh-newapi.log`).

## Using it from Claude Code / Codex

The gateway speaks both protocols: the OpenAI-compatible surface under `/v1`, and the Anthropic-compatible one under `/v1/messages`. One gateway can feed both.

### Claude Code

```bash
# macOS / Linux
export ANTHROPIC_BASE_URL="http://127.0.0.1:3000"
export ANTHROPIC_AUTH_TOKEN="<the token from connection.json>"
claude
```

```powershell
# Windows PowerShell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:3000"
$env:ANTHROPIC_AUTH_TOKEN = "<the token from connection.json>"
claude
```

That is exactly the `claudeCodeEnv` field — copy it straight across.

### Codex / any OpenAI-compatible client

`~/.codex/config.toml`:

```toml
model = "deepseek-chat"
model_provider = "newapi"

[model_providers.newapi]
name = "New API"
base_url = "http://127.0.0.1:3000/v1"
env_key = "NEW_API_KEY"
wire_api = "chat"
```

```bash
export NEW_API_KEY="<the token from connection.json>"
```

> [!TIP]
> `NEW_API_KEY` is not an arbitrary name: it is the reference the plugin publishes to DSH's model configuration (`providerApiKeyRef`'s default), so DSH and a command-line client can share one environment variable.

Every other client needs two things: **Base URL** `http://127.0.0.1:<port>/v1`, and **API key** = the token. Switching models, changing rates and reading usage all happen in the gateway console; clients stay untouched.

## How it works

The plugin decides nothing on your behalf — it just walks the gateway from "does not exist" to "usable":

```text
DSH starts
   │
   ├── 1. Config     plugin row → effective config; an unknown key or a wrong type stops the load
   │
   ├── 2. First run  the panel collects the port + root password (or rootPassword / binaryPath skips it)
   │
   ├── 3. Binary     data directory → version cache; only then the network
   │
   ├── 4. Route      environment → Windows system proxy → local port probe after a direct failure
   │
   ├── 5. Download   stream ~128 MB, verify sha256 against checksums-<os>.txt, cache in <DSH_HOME>/cache/newapi/<version>/
   │
   ├── 6. Start      adopt an instance already on the port, else spawn a child and poll /api/status
   │
   ├── 7. Provision  /api/setup → login → create/reuse a token → read the models → write connection.json
   │
   ├── 8. Publish    token → credential service; models and route → llm-pi-ai settings (visible in the selector)
   │
   └── 9. Console    a loopback reverse proxy holds the gateway session and embeds the console
```

### Boot phases and failure kinds

The panel renders the phases the plugin reports (`src/progress.js`), so "not running" is never a sentence without information:

| Phase | What the panel says |
| ----- | ------------------- |
| `idle` | Nothing started yet: the first run is waiting for the form |
| `preparing` | Looking for a local gateway binary / resolving the network route / fetching the checksum manifest |
| `downloading` | Streaming the release binary (the only phase with byte counts) |
| `starting` | The child is spawned and `/api/status` is being polled |
| `provisioning` | Initialising the instance and creating the access token |
| `retrying` | This attempt failed and the next one is scheduled |
| `ready` | The gateway answers and the panel shows its console |
| `failed` | The attempts are spent; the panel shows why and offers Retry |

A failure is classified, and the panel turns the class into advice:

| Kind | Typical cause | What to do |
| ---- | ------------- | ---------- |
| `network` | `fetch failed` / `ECONNREFUSED` / `ETIMEDOUT` / TLS / a refused `CONNECT` | Set `HTTPS_PROXY` and restart DSH; change the route and press Retry; or download in a browser and drop the file where the panel says |
| `checksum` | The bytes do not match the published manifest | Press Retry to download again; if it keeps failing, download in a browser and place the file |
| `port` | No free port in the 20 above the preferred one | Change the port under Configure, or set `port` on the plugin row |
| `gateway` | The child exited right after starting | Port in use, an unwritable data directory, antivirus interception — the panel carries the child's own output |
| `timeout` | The process lives but `/api/status` never answers | A firewall, or a first start still migrating; press Retry and wait |
| `unknown` | Nothing matched | Post the log |

## Configuration

Configuration goes on the plugin row (the one in a profile's `cordis.patch.yml`). **An unknown key stops the plugin from loading** rather than being quietly ignored — a typo that silently produces a gateway nobody asked for is the hardest kind of problem to find.

| Key | Type | Default | Meaning |
| --- | ---- | ------- | ------- |
| `enabled` | boolean | `true` | Turn it off to start nothing |
| `version` | string | `v1.0.0-rc.39` | Upstream release tag; `latest` asks the GitHub API at boot (GitHub download bases only) |
| `binaryPath` | string | — | Point straight at a gateway binary, skipping lookup and download |
| `port` | number | `3000` | Preferred port; if taken, the next 20 ports are tried. A value the panel collected on the first run wins |
| `dataDir` | string | `<DSH_HOME>/newapi` | Database, logs, state file and connection facts |
| `dshHome` | string | `$DSH_HOME` or `~/.dsh` | The harness home |
| `downloadBaseUrl` | string | `https://github.com/QuantumNous/new-api/releases/download` | Release download prefix |
| `rootUsername` | string | `root` | Administrator account name |
| `rootPassword` | string | — | A preset root password; setting it stops the panel asking, for compositions without a panel |
| `tokenName` | string | `dsh` | Name of the token the plugin creates in the gateway |
| `readyTimeoutMs` | number | `120000` | How long to wait for `/api/status` |
| `publishProvider` | boolean | `true` | Whether to publish the gateway into DSH's model configuration |
| `providerName` | string | `new-api` | Route name published into `llm-pi-ai` |
| `providerDisplayName` | string | `New API` | The name shown in the model selector |
| `providerApiKeyRef` | string | `NEW_API_KEY` | The reference the token is stored under in the credential service |
| `providerContextWindow` | number | `131072` | Context-window guess for a model no catalog describes |
| `providerMaxTokens` | number | `32768` | The same, for the output cap |
| `providerReasoningEfforts` | string | `off,low,medium,high,xhigh,max` | Declared thinking levels; empty declares none at all |
| `providerImageModels` | string | empty | Models declared image-capable; `*` and `!` exclusions supported, highest precedence |
| `providerModelAliases` | string | empty | `served-id=catalog-id` pairs saying which model the catalogs describe under another id; outranks the plugin's own pairings |
| `providerDefaultInput` | string | `text,image` | Input types a model nothing describes gets |

Example — pin the gateway to an existing instance and skip the panel question:

```yaml
- id: newapi
  name: 'dsh-newapi'
  config:
    port: 3080
    rootPassword: 'change-me-please'
    version: v1.0.0-rc.39
```

Example — upstreams are mostly text models, so declare no thinking levels:

```yaml
  config:
    providerReasoningEfforts: ''
    providerImageModels: '!deepseek-chat'
    providerDefaultInput: 'text'
```

Example — the gateway resells a model under a relay's own id, so say which model that is:

```yaml
  config:
    providerModelAliases: 'relay-model-x=glm-5.3, another-relay-id=deepseek-v4-pro'
```

## The panel

<p align="center">
  <img src="./static/new-api.png" width="90%" alt="The New API panel, its toolbar and the embedded console">
</p>
<p align="center">
  <em>The toolbar carries the status and the address; the console opens in a new window, in a browser, or in the desktop shell.</em>
</p>

Every toolbar control does one concrete thing:

| Control | What it does |
| ------- | ------------ |
| Status dot + address | Green while running; the address shown is the one another device on the network can open, when there is one |
| **Reload** | Rebuilds the iframe, for a console that has got itself stuck |
| **Sync models** | Re-reads the gateway's model list and publishes it to DSH again (use it after adding a channel) |
| **Open in a new window** | Opens the console in the system browser, where a session is the most durable |
| **Configure** | Changes the port (restarts the gateway) and the root password (through the gateway's own security-proof flow; with 2FA enrolled the gateway refuses, and that refusal is reported as-is) |

The panel polls its status every 15 seconds, and every 1.5 seconds while settings are being configured or the gateway is starting.

> [!NOTE]
> If the panel is newer than the Host half (a fresh bundle against an older module generation), the panel says so and points at toggling the plugin on the Plugins page — instead of reporting a refusal it cannot explain.

## Download and proxies

The only step of a first install that leaves the machine is the release download — and it is also the step most likely to fail behind a proxy: Node's `fetch` opens its own connection and ignores the settings Windows, macOS and GNOME keep for every other program, so "the browser can open GitHub" says nothing about this download.

The route is resolved most-certain-first:

1. **Environment** — `HTTPS_PROXY` → `https_proxy` → `HTTP_PROXY` → `http_proxy` → `ALL_PROXY` → `all_proxy`.
2. **Windows system proxy** — `ProxyEnable` / `ProxyServer` / `ProxyOverride` under `HKCU\...\Internet Settings`, the same value every browser on the machine obeys.
3. **Local proxy ports** — `7890`, `7897`, `7891`, `10809`, `10808`, `1080`, `8888`, `8118`, and only *after* a direct attempt has already failed. A port that merely answers is never preferred to a direct connection, because routing a working download through a stranger's port is a worse failure than the one it tries to repair.

Details:

- `NO_PROXY` / `ProxyOverride` apply to every route; when a bypass entry sends a host direct, the panel says so instead of claiming a proxy it never used.
- An HTTP proxy is genuinely spoken: an `https://` target is tunnelled with `CONNECT` and then carries its own TLS, an `http://` target is sent in absolute form, and redirects are followed along the same route (up to 5 hops).
- **SOCKS is not supported.** A machine that only names a SOCKS proxy is told exactly that, rather than a vague "no proxy found".
- Proxy addresses are stripped of their credentials before they reach a log line or the panel.

### Four ways out of a failed download

The panel lists them with the real paths and links; here they are again:

1. Open an HTTP port in the proxy client, or set `HTTPS_PROXY=http://127.0.0.1:<port>` and restart DSH, then press **Retry**.
2. Download the release in a browser from the address the panel names and put the file in the directory it names (for example `~/.dsh/newapi/new-api.exe`). **A file placed there is used as it stands, with no network check.**
3. If `new-api` already exists on the machine, point the plugin row's `binaryPath` at it.
4. Or point `downloadBaseUrl` at a mirror prefix you can reach.

## How the models reach DSH

Publishing performs the same two writes the web Models page performs by hand:

- the token goes into the **credential service** (reference `NEW_API_KEY` by default);
- the route and its model list go into **`llm-pi-ai`** settings (route `new-api` by default).

Two things worth knowing:

- **The gateway's model list is the only source of truth.** A model the token cannot reach is never advertised, and every start and every Sync models replaces the whole model list — so adding or removing models is done in the console, not on the DSH side. The two capacity fields are the one exception: a context window or output cap already stated for a model is kept whenever the catalogs state nothing, because a gateway serving a relay's own model id (`deepseek-v4.1-flash`, say) matches no catalog and the number you typed is the only answer there is.
- **No models is a refusal, not an empty route.** A brand-new gateway has no channel yet, and the plugin reports "the gateway serves no models yet" rather than registering a route with nothing behind it. Add a channel in the console, then press Sync models.

Neither request modalities nor capacities are on New API's `/v1/models`, so the plugin asks, in this order:

```text
providerImageModels (the plugin row; `*` and `!` exclusions supported)
        │  nothing said
        ▼
the model's own tag in the New API console (vision / vlm / multimodal / 多模态 / 视觉 / 图像)
        │  nothing said
        ▼
DSH's installed model catalogs (matched by id, including each provider's own catalog)
        │  nothing said
        ▼
providerDefaultInput (default text,image — the models in this gateway were added on purpose,
                      and only the plugin row can undo a refusal)
```

Capacities come from the model catalogs alone (`/v1/models` carries no token limit at all): a model the catalogs describe keeps its own context window and output cap, with the **smallest** value winning when sources disagree. A model the gateway serves under a relay's own id reaches those numbers through an **alias** — `deepseek-v4.1-flash` is `deepseek-flash`, the id llm-deepseek ships it under, paired in the plugin and overridable with `providerModelAliases` — so the first sync already carries them and nothing has to be typed. A field no catalog states and no alias reaches keeps the number that route already carries (the one you typed on the model's row), because deleting it would silently revert the model to the route's guess. Only a model that carries none of those falls back to `providerContextWindow` / `providerMaxTokens`, and the log names which models took the guess, which kept their own numbers, and which took an alias's.

## Files and directories

```text
<DSH_HOME>/                       # ~/.dsh by default
├── newapi/                       # dataDir
│   ├── one-api.db                # the gateway's SQLite database
│   ├── .dsh-gateway.json         # port, root password, token, console account (0600)
│   ├── connection.json           # the facts a client needs (0600)
│   ├── dsh-newapi.log            # plugin and gateway log
│   └── new-api.exe               # optional: a hand-placed binary is used as it stands
└── cache/newapi/<version>/       # release cache, keyed by tag
    ├── new-api-<version>[.exe]
    └── checksums-<os>.txt
```

## HTTP routes

The panel reads and writes the Host half through exactly these routes, and every one of them first has to pass DSH's own browser-trust check (falling back to a loopback-only, same-origin check when no Connection service is mounted):

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/dsh-newapi/status` | Every fact the panel reads: state, address, phase, progress, failure cause and hint, model-configuration result |
| `POST` | `/api/dsh-newapi/setup` | Submit the port and root password (first run), or apply a change (running gateway) |
| `POST` | `/api/dsh-newapi/sync` | Re-read the gateway's models and publish them to DSH again |
| `POST` | `/api/dsh-newapi/retry` | Run one more boot round after it gave up |

The status payload carries a `panelApi` version: when the front end and the Host are out of step, the panel points at toggling the plugin instead of reporting a failure it cannot explain.

## Development

```bash
git clone https://github.com/bb-boy680/dsh-newapi.git
cd dsh-newapi
bun install
bun run build:client      # build lib/client.js from src/client/index.jsx
node scripts/check-client.mjs
```

The panel is a committed build artifact (`lib/client.js`), and CI rebuilds it and requires `git diff --exit-code` to be empty — changing the source without rebuilding fails CI.

| Script | What it checks |
| ------ | -------------- |
| `bun run build:client` | Produces `lib/client.js` from `src/client/index.jsx` |
| `node scripts/check-client.mjs` | The panel registers and renders: the first-run form, the settings form, boot progress, the failure panel and its Retry button |
| `node scripts/check-config.mjs` | Plugin rows are read correctly; unknown keys and wrong types are refused |
| `node scripts/check-setup.mjs` | When the first run is asked, password and port validation, reconfiguring a running gateway |
| `node scripts/check-provider.mjs` | The published model route is correct, and the settings document **never** carries the token |
| `node scripts/check-binary.mjs` | A binary the machine already has wins over the download |
| `node scripts/check-startup.mjs` | A failed start leaves nothing running |
| `node scripts/check-boot.mjs` | Boot phases are reported correctly, and a retry runs another round |
| `node scripts/check-net.mjs` | Proxy discovery, Windows registry parsing, tunnels and absolute-form requests, bypass lists, credentials kept out of the log |
| `node scripts/check-retry.mjs` | The panel's Retry really does start another round |
| `node scripts/smoke.mjs` | Real end to end: downloads the real binary and walks the first run, the console session bridge, model publishing and a port change (~128 MB download; run it on purpose) |

CI runs the whole offline suite on every push and pull request; `smoke` runs only when dispatched by hand.

## Platform support

| Platform | Release asset | Status |
| -------- | ------------- | :----: |
| Windows x64 | `new-api-<version>.exe` | ✅ |
| macOS (Intel / Apple Silicon) | `new-api-macos-<version>` | ✅ |
| Linux x64 | `new-api-<version>` | ✅ |
| Linux arm64 | `new-api-arm64-<version>` | ✅ |
| Windows arm64 | not published upstream | ❌ |

The binary comes from the official [QuantumNous/new-api](https://github.com/QuantumNous/new-api) releases and is verified with sha256 against the checksum manifest they publish. The plugin itself ships no runtime dependencies.

## Compared with the alternatives

| Approach | Cost | dsh-newapi |
| -------- | ---- | ---------- |
| Download, start and upgrade New API by hand | You own the process and the database; forgetting to start it means no models | The plugin manages it across the DSH lifecycle and exits cleanly on unload or a port change |
| Give every client its own upstream key | Keys scattered across config files | One token issued by the gateway; clients only know an endpoint |
| Use DSH's built-in model configuration alone | Reconfigure for every other client | One gateway speaking both OpenAI and Anthropic protocols |
| iframe the console straight into the desktop shell | A cross-site frame cannot keep its session, so every visit means a new sign-in | A loopback reverse proxy owns one real session, and the console stays signed in |
| Tell the user to set a proxy variable | "The browser can open GitHub" gets mistaken for "this works too" | Reads the system proxy, probes local ports after a failure, and reports the route it took |

## Roadmap

| Capability | Status | Notes |
| ---------- | :----: | ----- |
| Sidebar panel and embedded console | ✅ | Status, address, Reload, Sync models, Open in a new window, Configure |
| Automatic binary download and sha256 verification | ✅ | Cached per version; the second start touches no network |
| Automatic proxy discovery | ✅ | Environment → Windows system proxy → local port probe |
| First-run setup in the panel | ✅ | Port and root password collected and validated before the database exists |
| Models published into the DSH model selector | ✅ | `llm-pi-ai` route plus a credential reference; the token never enters the settings document |
| Image input and capacity resolution | ✅ | Plugin row → console tags → model catalogs, with the smallest capacity winning, a relay's renamed id followed to the id the catalogs know, and the route's own numbers kept where nothing speaks |
| Boot phase reporting and failure classification | ✅ | Bytes, speed, ETA, and six classes of failure |
| Retry from the panel after a failed boot | ✅ | No trip to the Plugins page |
| Console session bridge | ✅ | Holds a session only for an account a person signed in with |
| Bilingual panel | ✅ | Copy goes through DSH's locale service |
| Following the newest upstream release | ✅ | `version: latest` resolves against the GitHub API on each boot |
| Several gateways, one per profile | ☐ | One plugin row means one data directory today |
| Usage, quota and logs inside the panel | ☐ | Open the console, or read `dsh-newapi.log` |
| SOCKS proxies | ☐ | HTTP proxies only; a SOCKS-only machine is told so plainly |
| Newer-upstream notices | ☐ | Change `version`, or set it to `latest` |

## FAQ

<details>
<summary><strong>How does the panel relate to DSH's own Models settings? Do they conflict?</strong></summary>

They are the same data: the plugin writes the two places the web Models page writes (the `llm-pi-ai` settings and the credential service). The difference is ownership — the model list of the route the gateway provides is decided by the gateway, and the plugin replaces it wholesale on every start and every Sync models. So change model settings on the gateway side or on the plugin row, not on the DSH side.

</details>

<details>
<summary><strong>Why does the first run download 128 MB? Can it be installed offline?</strong></summary>

That 128 MB *is* New API's own release binary; the plugin does not repackage it, it downloads, verifies, caches and starts it. Offline works fine:

- download the release asset in a browser or on another machine and put it in the data directory under the name the panel names (for example `new-api.exe`) — it will be used as it stands;
- or point `binaryPath` at a `new-api` anywhere on the machine;
- or point `downloadBaseUrl` at a mirror prefix you can reach.

</details>

<details>
<summary><strong>The download keeps failing. What now?</strong></summary>

First read which route the panel says it took:

- **Direct** → the machine has no usable HTTP proxy. Set `HTTPS_PROXY=http://127.0.0.1:<port>` (Clash / v2ray usually listen on 7890 or 10809) and restart DSH, or just download the file and drop it in place.
- **Through a proxy, and still failing** → check that proxy can open `github.com` right now, or change the route and press Retry.
- **SOCKS only** → the plugin speaks HTTP proxies; open an HTTP port in the proxy client.

</details>

<details>
<summary><strong>Where do my upstream keys go?</strong></summary>

Only to the upstreams you configured in the gateway console. The plugin has no telemetry and no server of its own; the DSH-side gateway token lives in DSH's credential service, and `connection.json` and `.dsh-gateway.json` are written with mode `0600`. Proxy credentials never reach a log. Do note that those files do hold a plaintext token and root password — treat them as secrets on a shared machine.

</details>

<details>
<summary><strong>Where is the root password, and what if I forget it?</strong></summary>

It is in `.dsh-gateway.json`, and while the gateway runs you can also read it under Configure in the panel (with copy and reveal buttons). Change it there: the plugin goes through the gateway's own security-proof flow. If the account has a second factor enrolled, the gateway refuses the change and the panel reports that refusal as it is — change it in the console's own profile page instead.

</details>

<details>
<summary><strong>If I edit a model's context length in DSH, is it overwritten?</strong></summary>

The model list is: that route belongs to the gateway and is replaced on every start and every Sync models, so a model you add or remove on the DSH side is gone after the next sync. The context window and output cap you set on a model's row are kept, though — they are carried over whenever nothing else describes that id. Something usually does describe it: a model a relay renamed is matched to the id the catalogs know through the alias table (`deepseek-v4.1-flash` is `deepseek-flash`), so its row is filled on the very first sync, and `providerModelAliases` on the plugin row adds or corrects a pairing. A catalog fact still wins over the row, so a corrected reading reaches it too. For a number that should apply to every undescribed model at once, use `providerContextWindow` / `providerMaxTokens` on the plugin row.

</details>

<details>
<summary><strong>Port 3000 is already taken. What happens?</strong></summary>

The plugin first checks whether a New API is already answering on that port: if it is, the plugin adopts it (and the port cannot be changed from the panel then, because the plugin did not start it). Otherwise it picks the first free port among the 20 above 3000. To pin a port, change it under Configure in the panel, or set `port` on the plugin row.

</details>

<details>
<summary><strong>The console shows a sign-in page inside the desktop app?</strong></summary>

Normally it does not: the plugin runs a loopback reverse proxy that owns a real session precisely so a cross-site iframe under `dsh-app://` keeps its login. If you see the "cross-site frame" notice, the proxy is not running (an older Host half, for instance) — Open in a new window is the reliable route then, or toggle the plugin off and on.

</details>

<details>
<summary><strong>Is the desktop app required? Can I use it from the command line?</strong></summary>

The plugin needs DSH's `webServer` and `subprocess` services. A composition without a panel still works: set `rootPassword` on the plugin row (plus `port` and `binaryPath` as needed) and the first-run question is skipped, with everything written to `connection.json` and the log.

</details>

<details>
<summary><strong>Which clients are supported?</strong></summary>

Anything that speaks an OpenAI-compatible endpoint (`<baseUrl>/v1`) or an Anthropic-compatible one (`<baseUrl>/v1/messages`): Claude Code, Codex, the OpenAI SDK, editors with custom endpoints, and so on. DSH itself uses the `new-api` route the plugin publishes.

</details>

## Contributing

The plugin is iterating quickly. Issues, PRs, new checks and feedback are all welcome.

> [!TIP]
> Good places to start: add a signature and its panel copy to the failure classification in `src/progress.js`, add a source to the route discovery in `src/net.js`, write another `scripts/check-*.mjs`, or improve the `zh` / `en` copy in `src/client/index.jsx`.

```bash
git clone https://github.com/bb-boy680/dsh-newapi.git
cd dsh-newapi
bun install
node scripts/check-client.mjs   # one of the offline checks
```

After touching the panel, run `bun run build:client` — CI requires the committed `lib/client.js` to match its source.

## License

[AGPL-3.0](./LICENSE), the same license as upstream New API.

New API is [QuantumNous/new-api](https://github.com/QuantumNous/new-api); this repository is only the integration that hosts it inside DeepSeek Harness.

If this plugin saved you a few manual steps, a ⭐ is the best way to say thanks.

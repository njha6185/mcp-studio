# MCP Studio

**Web-based MCP client with a widget renderer — inspect servers, call tools, and
render their UIs the way ChatGPT renders apps.**

MCP Studio does everything you'd expect from an inspector — connect to any
[Model Context Protocol](https://modelcontextprotocol.io) server, browse its
tools / resources / prompts, call tools from auto-generated forms, watch the
request history — and adds the piece inspectors are missing: when a tool
carries UI metadata, its result is rendered as a **live, interactive widget**
in a sandboxed iframe, exactly like apps onboarded to ChatGPT. Both major
conventions are supported: the **OpenAI Apps SDK** (`window.openai` bridge)
and **MCP-UI** (`ui://` embedded resources).

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Using the app](#using-the-app)
- [Widget rendering](#widget-rendering)
  - [OpenAI Apps SDK convention](#openai-apps-sdk-convention)
  - [MCP-UI convention](#mcp-ui-convention)
  - [Building a widget-enabled server](#building-a-widget-enabled-server)
- [Proxy API reference](#proxy-api-reference)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

---

## Features

| Area | What you get |
|---|---|
| **Connect** | Streamable HTTP, SSE, and STDIO transports; custom HTTP headers (e.g. `Authorization`); **OAuth** for protected remote servers (discovery, dynamic client registration, PKCE — authorize in a browser tab, tokens cached per server URL for reconnects); recent connections remembered |
| **Tools** | List with search; title/description; annotation chips (read-only / destructive / idempotent / open-world with ✓ / ✕ / undeclared states); input schema as a generated form *or* raw JSON; tool `_meta` viewer; optional request `_meta` key-value pairs sent with `tools/call` |
| **Widgets** | Tools with UI metadata get a ✦ badge and a **Widget** result tab rendering the live UI; widget-initiated `callTool` round-trips through the real session; fullscreen mode; auto-height |
| **Results** | Widget / Content / Raw tabs; text, images, audio, embedded resources, resource links, `structuredContent`; per-call duration and error display |
| **Resources** | List + read with text/HTML/binary display; **resource templates** with `{variable}` inputs and live URI expansion |
| **Prompts** | List, argument form, `prompts/get` result view |
| **History** | Inspector-style bottom drawer with two views: **Requests** (every MCP operation, including widget-initiated calls, with request/response JSON, ↻ replay, ✎ load-into-form, copy-as-curl) and **Raw frames** (every JSON-RPC message on the wire in both directions, including the initialize handshake); session export as JSON |
| **Events** | Live server notifications — `notifications/message` log entries formatted with level/logger, `tools/list_changed` auto-refreshes, resource-updated notices — plus widget actions; log-level selector sends `logging/setLevel` |
| **Multi-server** | Connect several MCP servers at once (checkbox-select saved servers, or ＋ in the top bar). Server chips show per-server health/latency; click to switch the workspace focus. Disconnecting one leaves the rest connected, and each server auto-reconnects independently |
| **Chat simulator** | A separate Chat screen where a real Claude model (your Anthropic API key, set in Settings) acts as the host — across **all** connected servers at once: tools are namespaced per server (`my-server__tool`), the model picks whichever fits the request, calls are routed to the owning server, and results render as widgets inline in the transcript — a local ChatGPT-developer-mode preview |
| **Widget dev mode** | Point the widget at a local HTML file (Inspect → Dev template): it hot-re-renders on every save, so you iterate on a widget without touching the server |
| **Snapshots** | 📌 Pin any tool result as an expected output; the Snapshots screen replays pinned calls and shows a structural JSON diff on mismatch (accept-new-result supported) — a lightweight regression suite |
| **Persistence** | Saved servers, OAuth tokens, snapshots, and settings live in one local JSON file (`server/data/mcp-studio-store.json`) — no database; Settings shows the path and has per-section clear buttons |
| **Config import** | Detect `claude_desktop_config.json` / `.mcp.json` / `.cursor/mcp.json` / `.claude.json` automatically, or paste any config JSON — imported servers become named one-click connections |
| **Health** | Periodic ping with live latency in the topbar; automatic reconnect with backoff when the connection drops (reuses cached OAuth tokens) |
| **Completions** | Prompt arguments and resource-template variables autocomplete via `completion/complete` where the server supports it |
| **Debugging** | Output-schema validation (`schema ✓/✗` badge on results, plus SDK-level validation errors surfaced); progress bar for long-running tools (`notifications/progress`); widget **bridge inspector** (postMessage log, live `window.openai` globals, mock-toolOutput editor to re-render without calling the tool) with Inline / Mobile / Full display presets; resource subscriptions with auto re-read on `updated`; sampling & elicitation dialogs — when the server sends `sampling/createMessage` or `elicitation/create`, a modal lets you answer |
| **UX** | Full-screen modern UI, light/dark themes (system default, persisted, propagated into widgets via `openai:set_globals`), ⓘ info tooltips explaining every MCP concept inline |

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐          ┌──────────────┐
│  Browser            │  HTTP   │  Proxy               │   MCP    │  Your MCP    │
│  React + Vite       │ ──────▶ │  Express + MCP SDK   │ ───────▶ │  server      │
│  localhost:5180     │  + SSE  │  localhost:3400      │          │              │
└─────────────────────┘         └──────────────────────┘          └──────────────┘
                                   stdio │ SSE │ streamable-HTTP
```

The proxy exists for the same reason MCP Inspector ships one: browsers can't
spawn stdio processes, and remote servers often don't send CORS headers. The
proxy holds the actual MCP client sessions and exposes a small REST API plus
an SSE stream for server notifications.

## Getting started

**Prerequisites:** Node.js ≥ 20 and npm.

```bash
git clone <this-repo>
cd mcp-studio
npm install        # installs client + server workspaces
npm run dev        # starts proxy (:3400) and web app (:5180) together
```

Open **http://localhost:5180**.

No MCP server handy? Try the official reference server — choose **STDIO** on
the connect screen with:

- Command: `npx`
- Arguments: `-y @modelcontextprotocol/server-everything`

### Production build

```bash
npm run build      # builds the client to client/dist
```

Serve `client/dist` with any static file server and run the proxy with
`npm run start -w server` (set `PORT` to change the proxy port; the client dev
proxy config in `client/vite.config.ts` maps `/api` → `localhost:3400`).

## Using the app

1. **Connect** — pick a transport:
   - *Streamable HTTP* — modern remote servers (`http://host/mcp`). Add
     headers if the server needs auth.
   - *SSE* — legacy HTTP transport.
   - *STDIO* — a local server process (`npx …`, `node …`, `python …`,
     `uvx …`). The proxy spawns it and talks over stdin/stdout.

   Recent connections appear below the form for one-click reconnect.

2. **Browse** — the sidebar lists **Tools / Resources / Prompts** with a
   filter box. ✦ marks tools that render a widget. Resource *templates* are
   listed under the concrete resources.

3. **Call a tool** — fill the generated form (strings, numbers, booleans,
   enums, JSON editors for objects/arrays; required fields are enforced),
   optionally add request `_meta` pairs, hit **▶ Run tool**. Results appear
   in tabs:
   - **✦ Widget** — the rendered interactive UI (when the tool has one)
   - **Content** — content blocks + `structuredContent`
   - **Raw** — exact `tools/call` response JSON

4. **Debug** — topbar buttons:
   - **History** — every request of the session, newest first; click a row
     for request/response JSON side by side.
   - **Events** — server notifications and widget actions as they happen.
   - **⟳ Refresh** — re-fetch tools/resources/prompts.

5. Hover any **ⓘ** icon for an inline explanation of the concept next to it.

## Widget rendering

`client/src/widget/detect.ts` decides how to render a result:

1. If the tool declares `_meta["openai/outputTemplate"]` → **OpenAI Apps SDK**
   path.
2. Else if the result contains an embedded resource whose URI starts with
   `ui://` → **MCP-UI** path.
3. Otherwise there is no widget and the Content tab is shown.

All widgets run in an iframe with
`sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"`
and **no** `allow-same-origin` — widget code cannot touch the app's origin or
the proxy; everything goes through the postMessage bridge.

### OpenAI Apps SDK convention

The template URI is fetched via `resources/read` and the HTML is loaded with
an injected `window.openai` object — the same surface ChatGPT apps code
against:

| Member | Behavior |
|---|---|
| `toolInput` | The arguments the tool was called with |
| `toolOutput` | The result's `structuredContent` |
| `toolResponseMetadata` | The result's `_meta` |
| `widgetState` | State saved by `setWidgetState` |
| `theme`, `locale`, `displayMode`, `maxHeight` | Host context; theme follows the app's light/dark toggle live |
| `callTool(name, args)` | Executes a real `tools/call` on the session; returns the result. Appears in History and Events |
| `setWidgetState(state)` | Persists widget state (session-local) |
| `sendFollowUpMessage({prompt})` | Logged to the Events panel (no LLM attached) |
| `requestDisplayMode({mode})` | `fullscreen` opens a full-viewport overlay; ✕ or the widget returns it inline |
| `openExternal({href})` | Opens `http(s)` links in a new tab |
| Event `openai:set_globals` | Dispatched on the widget's `window` when globals change (e.g. theme toggle) — no iframe reload, state is preserved |

The iframe height follows the widget content automatically (ResizeObserver →
postMessage).

### MCP-UI convention

Embedded resources with `ui://` URIs render as:

- `text/html` → iframe `srcdoc`
- `text/uri-list` → iframe `src` (external URL)

Host handles the standard MCP-UI messages: `tool` (executes a real tool call
and replies with `ui-message-response`), `link`, `intent`, `prompt`, `notify`
(logged to Events), `ui-size-change`, and `ui-lifecycle-iframe-ready` (replies
with render data).

### Building a widget-enabled server

Minimal TypeScript example (OpenAI Apps SDK style) using
`@modelcontextprotocol/sdk`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "my-widgets", version: "1.0.0" });
const TEMPLATE_URI = "ui://widget/weather.html";

// 1. Expose the widget HTML as a resource
server.registerResource("weather-widget", TEMPLATE_URI, { mimeType: "text/html" },
  async () => ({
    contents: [{
      uri: TEMPLATE_URI, mimeType: "text/html",
      text: `<div id="root"></div>
        <script>
          const out = window.openai.toolOutput;
          document.getElementById("root").textContent =
            out.city + ": " + out.temperature + "°C";
          window.addEventListener("openai:set_globals", () => {/* re-render */});
        </script>`,
    }],
  }));

// 2. Point the tool at it via _meta
server.registerTool("get-weather", {
  description: "Get weather for a city",
  inputSchema: { city: z.string() },
  _meta: { "openai/outputTemplate": TEMPLATE_URI },
}, async ({ city }) => ({
  content: [{ type: "text", text: `Weather in ${city}: 21°C` }],
  structuredContent: { city, temperature: 21 },   // ← becomes toolOutput
}));

await server.connect(new StdioServerTransport());
```

Connect with STDIO (`node my-server.mjs`), run `get-weather`, and the Widget
tab renders it.

## Proxy API reference

All endpoints are JSON over HTTP on the proxy (default `:3400`).

| Endpoint | Method | Body / notes |
|---|---|---|
| `/api/connect` | POST | `{type: "streamable-http"\|"sse"\|"stdio", url?, headers?, command?, args?, env?}` → `{sessionId, serverInfo, capabilities}` |
| `/api/:session/disconnect` | POST | Closes the MCP session |
| `/api/:session/events` | GET (SSE) | `notification` events (server notifications), `closed` on disconnect |
| `/api/:session/tools` | GET | `tools/list` (empty list if capability absent) |
| `/api/:session/tools/call` | POST | `{name, arguments, _meta?}` |
| `/api/:session/resources` | GET | `resources/list` |
| `/api/:session/resource-templates` | GET | `resources/templates/list` |
| `/api/:session/resources/read` | POST | `{uri}` |
| `/api/:session/prompts` | GET | `prompts/list` |
| `/api/:session/prompts/get` | POST | `{name, arguments}` |
| `/api/:session/resources/subscribe` | POST | `{uri}` — server then pushes `notifications/resources/updated` |
| `/api/:session/resources/unsubscribe` | POST | `{uri}` |
| `/api/:session/logging/level` | POST | `{level}` → `logging/setLevel` |
| `/api/:session/respond` | POST | `{id, result?, error?}` — answers a server-initiated sampling/elicitation request |
| `/api/oauth/callback` | GET | OAuth redirect target (`code`, `state`) — completes the token exchange and connects |
| `/api/oauth/pending/:id` | GET | Poll an in-flight authorization: `{status: waiting\|ready\|error, session?}` |

**OAuth flow:** `POST /api/connect` to a protected server returns
`{authRequired, pendingId, authorizationUrl}`. The app opens the URL in a new
tab; after you authorize, the identity provider redirects to
`/api/oauth/callback`, the proxy exchanges the code (PKCE) and finishes the
connection, and the app's poll on `/api/oauth/pending/:id` resolves with the
session. Tokens and client registrations are cached in-memory per server URL,
so reconnects skip the flow until the proxy restarts.

Try it against the SDK's demo:
`node node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/simpleStreamableHttp.js --oauth`
(MCP on :3000, demo IdP on :3001 — connect to `http://localhost:3000/mcp`).

The `/events` SSE stream carries `notification`, `frame` (raw JSON-RPC frames,
with the buffered handshake replayed to new subscribers), `progress`,
`serverRequest`, and `closed` events. `tools/call` accepts an optional `callId`
used to correlate progress events.

## Project structure

```
├── package.json              # npm workspaces (client, server) + dev script
├── server/
│   └── src/index.ts          # Express proxy: session map, REST endpoints, SSE stream
└── client/
    ├── vite.config.ts        # dev server :5180, /api → :3400 proxy
    └── src/
        ├── App.tsx           # shell: topbar, sidebar, panels, history, events
        ├── api.ts            # typed proxy client + history tracking
        ├── theme.tsx         # light/dark ThemeProvider + toggle
        ├── types.ts          # MCP protocol types used by the UI
        ├── components/
        │   ├── ConnectScreen.tsx      # transport picker + recents
        │   ├── ToolDetail.tsx         # schema form, annotations, _meta, results
        │   ├── SchemaForm.tsx         # JSON Schema → form fields
        │   ├── ResultView.tsx         # Widget/Content/Raw tabs
        │   ├── ResourcePanel.tsx      # resource read + preview
        │   ├── ResourceTemplatePanel.tsx  # {variable} expansion + read
        │   ├── PromptPanel.tsx        # prompt args + get
        │   ├── HistoryPanel.tsx       # request history drawer
        │   ├── JsonView.tsx           # JSON block with copy
        │   └── InfoTip.tsx            # ⓘ hover/focus tooltips
        └── widget/
            ├── detect.ts     # which convention (if any) a tool/result uses
            ├── bridge.ts     # the injected window.openai bridge script
            └── WidgetFrame.tsx  # sandboxed iframe host + postMessage router
```

## Troubleshooting

- **`EADDRINUSE` on 3400 / Vite picks 5181** — another instance is running:
  `lsof -nP -iTCP:3400 -sTCP:LISTEN` and kill it, then `npm run dev` again.
- **Connect fails for a remote server** — check the URL path (streamable HTTP
  servers usually mount at `/mcp`) and try the SSE transport for older
  servers; add auth headers if required. The proxy surfaces the server's
  error message on the connect screen.
- **STDIO server won't start** — the command runs with the proxy's
  environment; use absolute paths if the binary isn't on `PATH`. Server
  stderr is piped, and connection errors are shown in the UI.
- **Widget tab missing** — the tool must either declare
  `_meta["openai/outputTemplate"]` (and the template resource must be
  readable) or return a `ui://` embedded resource. Check the Raw tab and the
  Tool `_meta` panel.
- **Widget renders blank** — open the browser devtools; the widget's own
  errors appear in the console. Verify `structuredContent` (the widget's
  `toolOutput`) in the Content tab — a schema mismatch is the usual cause.

## Security notes

- Widgets are untrusted code: they run sandboxed without `allow-same-origin`,
  so they can't read cookies/localStorage or call the proxy directly; the only
  host surface is the postMessage bridge, and `openExternal`/links are
  restricted to `http(s)`.
- The proxy can launch arbitrary local commands (that's what the STDIO
  transport is). **Never expose port 3400 beyond localhost.**
- Headers you enter (e.g. bearer tokens) are sent to the proxy and stored in
  browser localStorage as part of "recent connections" — clear them there if
  the machine is shared.

# MCP Studio

An MCP-Inspector-style web app with a **widget renderer**: connect to any MCP
server, browse tools / resources / prompts, call tools from schema-generated
forms — and when a tool carries UI metadata, its result is rendered as a live,
interactive widget in a sandboxed iframe, the way ChatGPT renders apps.

## Supported widget conventions

| Convention | How it's detected | How it's rendered |
|---|---|---|
| **OpenAI Apps SDK** | `tool._meta["openai/outputTemplate"]` → a `ui://` HTML resource | Template HTML is fetched via `resources/read` and loaded into a sandboxed iframe with an injected `window.openai` bridge: `toolInput`, `toolOutput` (structuredContent), `callTool()`, `setWidgetState()`, `sendFollowUpMessage()`, `requestDisplayMode()` (fullscreen supported), `openExternal()`, and `openai:set_globals` events |
| **MCP-UI** | Tool result contains an embedded resource with a `ui://` URI (`text/html` or `text/uri-list`) | HTML srcdoc / external URL iframe; handles `tool`, `link`, `intent`, `prompt`, `notify`, `ui-size-change`, and `ui-lifecycle-iframe-ready` postMessages |

Widget-initiated `callTool` requests round-trip through the real MCP session,
so interactive widgets (buttons that refresh data, etc.) fully work.

## Architecture

```
browser (React, port 5180)  ──HTTP──▶  proxy (Express, port 3400)  ──MCP──▶  your server
                                        stdio | SSE | streamable-HTTP
```

The proxy exists because browsers can't spawn stdio processes and often hit
CORS on direct HTTP — same reason MCP Inspector ships one.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5180, pick a transport, and connect:

- **Streamable HTTP / SSE** — server URL (+ optional headers, e.g. `Authorization: Bearer …`)
- **STDIO** — command + args (e.g. `npx -y @modelcontextprotocol/server-everything`)

Recent connections are remembered. Tools with a UI template show a ✦ badge.

## Layout

- `server/` — Express proxy holding MCP client sessions (`/api/connect`,
  `/api/:session/tools`, `/tools/call`, `/resources`, `/resources/read`,
  `/prompts`, `/prompts/get`, plus an SSE `/events` stream for server
  notifications such as `tools/list_changed`, which auto-refreshes the list)
- `client/` — Vite + React app: connect screen, sidebar (tools/resources/prompts
  with filter), schema-driven argument forms, result tabs (Widget / Content /
  Raw), event log panel
- `client/src/widget/` — widget detection, the `window.openai` bridge script,
  and the sandboxed iframe host (`WidgetFrame`)

## Security notes

Widgets run in iframes with `sandbox="allow-scripts allow-forms allow-popups"`
(no `allow-same-origin`), so widget code cannot touch the app's origin,
cookies, or the proxy directly — all host interaction goes through the audited
postMessage bridge. The proxy can launch arbitrary local commands for stdio
servers, so don't expose port 3400 beyond localhost.

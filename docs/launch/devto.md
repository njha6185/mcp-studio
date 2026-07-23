---
title: MCP Inspector can't show you widgets — so I built one that can
published: false
tags: mcp, ai, opensource, webdev
cover_image:
---

If you've built a [Model Context Protocol](https://modelcontextprotocol.io)
server, you know the MCP Inspector: connect, list tools, call one, read the
JSON that comes back. It's the default way everyone develops MCP servers.

But MCP tools can now return **UI**. The OpenAI Apps SDK lets a tool declare an
`openai/outputTemplate` — an HTML widget that renders in the host with a
`window.openai` bridge. [MCP-UI](https://mcpui.dev) lets a tool return a
`ui://` resource. These are how "apps" show up as rich, interactive cards
inside ChatGPT and Claude instead of a wall of JSON.

The problem: **there's no way to see that widget render while you're
developing.** The Inspector shows you the JSON. To actually see the UI, you
have to onboard your server into ChatGPT or Claude first — a slow loop for
something you're changing every few minutes.

So I built **MCP Widget Studio**.

![demo](https://raw.githubusercontent.com/njha6185/mcp-widget-studio/main/docs/demo.gif)

```bash
npx mcp-widget-studio --demo
```

## What it is

Everything the Inspector does — connect over stdio / SSE / streamable-HTTP,
browse tools/resources/prompts, call tools from schema-generated forms, watch
the raw JSON-RPC frames, replay calls — **plus** it renders tool results as
live widgets in a sandboxed iframe.

For OpenAI-Apps-SDK tools it injects the same `window.openai` surface the real
hosts provide: `toolInput`, `toolOutput`, `callTool()`, `setWidgetState()`,
`requestDisplayMode()`, theme, locale. So a widget that refreshes itself by
calling another tool, or persists state, or adapts to dark mode — all of it
works exactly as it would in production. For MCP-UI it renders `ui://` HTML and
external-URL resources and handles the MCP-UI postMessage actions.

## The parts that surprised me

**A chat simulator.** There's a screen where a real LLM acts as the host across
*all* your connected servers at once. You bring an API key — any
OpenAI-compatible provider (OpenAI, OpenRouter, Groq, Mistral, Ollama, LM
Studio…) or Anthropic — and the model sees your tools (namespaced per server),
decides which to call, and the results render as widgets inline in the
transcript. It turns out this is the fastest way to answer the real question:
*does a model actually understand my tool descriptions well enough to use them
right?*

**Widget dev mode.** Point a tool at a local HTML file and it hot-reloads on
save. You iterate on the widget without touching or redeploying the server.

**Snapshots.** Pin a tool's result as "expected," replay later, get a
structural diff. A lightweight regression suite for your server.

Plus multi-server (connect several at once), OAuth for protected remote
servers, output-schema validation, progress bars, sampling/elicitation
dialogs, config import from `claude_desktop_config.json`, and light/dark
themes propagated into the widgets.

## How it's built

It's a single Node process that serves a React UI and proxies MCP for the
browser — necessary because browsers can't spawn stdio subprocesses and remote
MCP servers usually don't send CORS headers (the same reason the Inspector
ships a proxy). Each session lives in the proxy, which is what makes the raw
frame tap, multi-server, and reload-survival fall out naturally.

Auth is a token-as-account model: your token is an account key mapping to an
isolated data space, so the same binary works as a private local tool or a
shared multi-user deployment. There's a free-tier GCP deploy guide with GitHub
Actions CI/CD in the repo.

## Try it

```bash
npx mcp-widget-studio --demo   # bundled demo server with example widgets
```

MIT licensed, source at
**https://github.com/njha6185/mcp-widget-studio**.

If you build MCP servers — especially ones with UIs — I'd love to know what's
missing. What would make this the thing you reach for instead of the Inspector?

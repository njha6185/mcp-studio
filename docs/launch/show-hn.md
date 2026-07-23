# Show HN

## Title (pick one — keep it plain, no hype; HN penalizes marketing tone)

- `Show HN: MCP Widget Studio – an MCP inspector that renders tool UIs like ChatGPT`
- `Show HN: A local MCP client that renders tool widgets (OpenAI Apps SDK & MCP-UI)`

## URL

https://github.com/njha6185/mcp-widget-studio

## First comment (post immediately after submitting — this is what people read)

I've been building MCP servers and kept hitting the same gap: the official
Inspector lets you call tools and see the JSON they return, but if your tool
ships a UI (an OpenAI Apps SDK `outputTemplate`, or an MCP-UI `ui://` resource)
there's no way to actually *see* it render without wiring the server into
ChatGPT or Claude first.

So I built MCP Widget Studio. It does the normal inspector things — connect
over stdio / SSE / streamable-HTTP, browse tools/resources/prompts, call tools
from schema-generated forms, watch the raw JSON-RPC frames — and then renders
tool results as live, interactive widgets in a sandboxed iframe, with the same
`window.openai` bridge ChatGPT gives apps (so `callTool`, `setWidgetState`,
theme, display modes all work).

A couple of things that turned out more useful than I expected:

- A chat simulator where a real LLM (any OpenAI-compatible or Anthropic
  provider — bring your own key) acts as the host across all your connected
  servers at once, so you can watch how a model actually picks and calls your
  tools, with the widgets rendering inline in the transcript.
- Widget "dev mode" — point a tool at a local HTML file and it hot-reloads on
  save, so you can iterate on a widget without redeploying the server.
- A snapshot/regression mode: pin a tool result as expected, replay later,
  diff.

Try it: `npx mcp-widget-studio --demo` (spins up a bundled demo server with
example widgets so there's something to look at immediately).

It's a Node server that serves a React UI and proxies MCP for the browser
(browsers can't spawn stdio or dodge CORS). MIT licensed. Architecture,
security notes, and a self-hosting guide are in the README.

Happy to answer anything — and genuinely interested in what's missing for
people building MCP servers with UIs.

## Notes for the poster

- Post on a weekday morning US time; be around for ~2–3h to reply.
- Don't ask for upvotes anywhere (HN auto-penalizes it).
- If it doesn't get traction the first time, a second Show HN weeks later with
  a materially new feature is allowed.

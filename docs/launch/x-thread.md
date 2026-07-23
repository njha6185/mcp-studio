# X / Twitter launch thread

Attach `docs/demo.gif` to tweet 1 (media in the first tweet massively boosts
reach). Tag @modelcontextprotocol / the MCP-UI + OpenAI Apps SDK accounts
where relevant. Post the thread, then reply to the last tweet with the HN link
once your Show HN is live.

---

**1/**
MCP Inspector shows you the JSON a tool returns.

But MCP tools can return UI now (OpenAI Apps SDK, MCP-UI) — and there's no way
to *see* that widget render while you build.

So I made MCP Widget Studio. One command:

`npx mcp-widget-studio --demo`

🧵

[attach demo.gif]

**2/**
It's a full MCP inspector — stdio / SSE / streamable-HTTP, schema-generated
tool forms, resources, prompts, raw JSON-RPC frame view, replay —

then it renders tool results as live widgets in a sandboxed iframe, with the
real `window.openai` bridge (callTool, setWidgetState, theme, display modes).

**3/**
The part I use most: a chat simulator.

A real LLM (any OpenAI-compatible or Anthropic provider — your key) acts as the
host across all your connected servers at once. Watch it pick and call your
tools, widgets rendering inline.

Best way to test if a model *understands* your tool descriptions.

**4/**
Plus:
• widget dev mode — edit a local HTML template, hot-reloads, no redeploy
• snapshots + diff for regression testing
• multi-server, OAuth, config import
• any LLM provider, models listed live
• light/dark, propagated into widgets

**5/**
It's a tiny Node server that serves the UI + proxies MCP for the browser. MIT.
Runs locally or self-hosted (free-tier GCP guide + CI/CD included).

Repo: https://github.com/njha6185/mcp-widget-studio

If you build MCP servers with UIs, tell me what's missing 🙏

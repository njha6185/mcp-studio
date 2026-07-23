# Reddit posts

Read each subreddit's rules first (some require flair, some restrict
self-promotion to certain days/threads). Lead with value, not "please try my
thing." Reply to every comment early — engagement drives the algorithm.

---

## r/mcp (most on-topic)

**Title:** I built an MCP inspector that renders tool UIs as live widgets (OpenAI Apps SDK & MCP-UI)

**Body:**

The official Inspector is great for calling tools and reading their JSON, but
if your tool returns a UI — an OpenAI Apps SDK `outputTemplate` or an MCP-UI
`ui://` resource — you can't actually see it render without onboarding the
server into ChatGPT/Claude first.

MCP Widget Studio fills that gap. Inspector features (stdio/SSE/HTTP, schema
forms, resources, prompts, raw JSON-RPC frame view) **plus**:

- renders tool widgets in a sandboxed iframe with the real `window.openai`
  bridge (callTool, setWidgetState, theme, display modes)
- a chat simulator: any LLM (OpenAI-compatible or Anthropic, your key) drives
  all your connected servers' tools at once, widgets rendering inline
- widget dev mode (edit a local HTML template, hot-reloads)
- snapshots/regression diffs, multi-server, OAuth, config import

`npx mcp-widget-studio --demo` to try it with a bundled example server.
MIT, self-hostable. Repo: https://github.com/njha6185/mcp-widget-studio

What would make this genuinely useful for how you build MCP servers?

---

## r/ClaudeAI

**Title:** Made a local tool to preview & test MCP servers — including ones with UI widgets

**Body (angle: Claude/MCP users, less protocol-deep):**

If you're building or tinkering with MCP servers, this is a local app to
connect to them, call their tools from auto-generated forms, and — the part I
couldn't find elsewhere — actually *see* tools that ship a UI render as live
widgets, the way apps show up inside ChatGPT/Claude.

It also has a chat mode where a real model drives your tools so you can see how
it decides to use them.

`npx mcp-widget-studio --demo`. MIT, bring-your-own API key for the chat part.
https://github.com/njha6185/mcp-widget-studio

---

## r/LocalLLaMA (angle: local + any provider)

**Title:** MCP client with a built-in chat simulator that works with any OpenAI-compatible endpoint (Ollama, Groq, etc.)

**Body:**

Sharing a tool for working with MCP servers. Beyond the usual inspecting/
calling, it has a chat simulator where the "host" LLM can be **any**
OpenAI-compatible provider — Ollama, LM Studio, Groq, OpenRouter, etc. — so you
can watch a local model actually select and call MCP tools, with any UI widgets
the tools return rendering inline. Models are listed live from the provider's
`/models` endpoint.

Runs locally, `npx mcp-widget-studio --demo`, MIT.
https://github.com/njha6185/mcp-widget-studio

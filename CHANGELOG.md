# Changelog

## 0.1.0

Initial release.

- **Inspector**: connect over streamable HTTP / SSE / STDIO; browse tools,
  resources (incl. templates with variable expansion + completions), and
  prompts; schema-generated argument forms; annotations, tool `_meta`,
  request `_meta`; request history with raw JSON-RPC frame view, replay,
  copy-as-curl, and session export; live events with server log levels;
  progress bars; resource subscriptions; sampling & elicitation dialogs;
  output-schema validation; OAuth (discovery, DCR, PKCE) for protected
  servers.
- **Widget renderer**: OpenAI Apps SDK (`window.openai` bridge — callTool,
  setWidgetState, display modes, live theme) and MCP-UI (`ui://` resources);
  bridge inspector with postMessage log, live globals, mock output; widget
  dev mode with hot-reload from a local HTML file.
- **Multi-server**: connect several servers at once with a focus switcher;
  independent health/latency/auto-reconnect per server.
- **Chat simulator**: any LLM provider (Anthropic API or any
  OpenAI-compatible endpoint — OpenAI, OpenRouter, Groq, Mistral, Ollama, …)
  with live model listing; the model drives tools across all connected
  servers (namespaced), widgets render inline; conversations persist.
- **Snapshots**: pin tool results as expectations, replay with structural
  JSON diff.
- **Accounts**: `mcps_…` tokens are account keys with isolated per-token
  data in one local JSON file; generate-or-paste gate; persistent local
  token for the launcher; `DISABLE_STDIO` for shared hosting.
- **Packaging**: `npx mcp-widget-studio` launcher (free port, browser auto-open,
  `--demo` bundled widget server) or run from source.

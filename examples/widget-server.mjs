/**
 * MCP Studio demo server — exercises every headline feature:
 *
 *   get-weather   OpenAI-Apps-SDK-style widget (window.openai bridge)
 *   show-card     MCP-UI ui:// embedded HTML resource
 *   slow-task     progress notifications (progress bar in the UI)
 *   ask-user      elicitation (the UI shows a dialog)
 *   good-schema   outputSchema + matching structuredContent (schema ✓ badge)
 *   bad-schema    outputSchema violation (surfaces as a tool error)
 *
 * Run:  node examples/widget-server.mjs   (connect via STDIO)
 * Or:   npx mcp-widget-studio --demo             (pre-saves this server for you)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-studio-demo", version: "1.0.0" });

// --------------------------------------------------------------------------
// 1. An OpenAI-Apps-SDK-style widget: the tool points at an HTML template
//    resource via _meta["openai/outputTemplate"]; the template reads
//    window.openai.toolInput / toolOutput and can call tools itself.
// --------------------------------------------------------------------------

const TEMPLATE_URI = "ui://widget/weather.html";

const TEMPLATE_HTML = `
<div id="root" style="font-family: system-ui, sans-serif; padding: 20px;"></div>
<script>
  const root = document.getElementById("root");
  function render() {
    const out = window.openai.toolOutput || {};
    const input = window.openai.toolInput || {};
    const dark = window.openai.theme === "dark";
    document.body.style.background = dark ? "#12151d" : "#ffffff";
    document.body.style.color = dark ? "#e6e9f2" : "#1b2334";
    root.innerHTML =
      '<h2 style="margin:0 0 10px">' + (out.title || "Weather") + '</h2>' +
      '<div style="font-size:42px;font-weight:700">' + (out.temperature ?? "?") + '°C</div>' +
      '<p style="opacity:.7">' + (out.condition || "") + " in " + (input.city || "?") + '</p>' +
      '<button id="btn" style="padding:8px 14px;border-radius:8px;border:1px solid #8884;cursor:pointer">' +
      "Refresh via window.openai.callTool()</button> <span id=\\"status\\"></span>";
    document.getElementById("btn").onclick = async () => {
      document.getElementById("status").textContent = "calling…";
      const res = await window.openai.callTool("get-weather", { city: input.city || "Paris" });
      document.getElementById("status").textContent =
        "→ " + JSON.stringify(res.structuredContent);
    };
  }
  window.addEventListener("openai:set_globals", render); // live theme changes
  render();
</script>`;

server.registerResource(
  "weather-widget",
  TEMPLATE_URI,
  { mimeType: "text/html" },
  async () => ({
    contents: [{ uri: TEMPLATE_URI, mimeType: "text/html", text: TEMPLATE_HTML }],
  })
);

server.registerTool(
  "get-weather",
  {
    description:
      "Get the weather for a city — renders as an interactive widget (OpenAI Apps SDK style)",
    inputSchema: { city: z.string().describe("City name") },
    _meta: { "openai/outputTemplate": TEMPLATE_URI },
  },
  async ({ city }) => ({
    content: [{ type: "text", text: `Weather in ${city}: 21°C, sunny` }],
    structuredContent: { title: `Weather — ${city}`, temperature: 21, condition: "sunny" },
  })
);

// --------------------------------------------------------------------------
// 2. MCP-UI style: the RESULT carries a ui:// embedded HTML resource.
// --------------------------------------------------------------------------

server.registerTool(
  "show-card",
  {
    description: "Returns an MCP-UI ui:// embedded HTML resource",
    inputSchema: { label: z.string().describe("Card label") },
  },
  async ({ label }) => ({
    content: [
      {
        type: "resource",
        resource: {
          uri: "ui://card/demo",
          mimeType: "text/html",
          text: `<div style="font-family:system-ui;padding:20px;background:#eef;border-radius:10px">
                   <h3 style="margin:0 0 8px">MCP-UI card: ${label}</h3>
                   <button style="padding:6px 12px;border-radius:6px;border:1px solid #99a;cursor:pointer"
                     onclick="window.parent.postMessage({type:'tool',messageId:'m1',payload:{toolName:'get-weather',params:{city:'Tokyo'}}},'*')">
                     Call a tool from this widget
                   </button>
                   <script>
                     window.addEventListener('message', (e) => {
                       if (e.data && e.data.type === 'ui-message-response')
                         document.body.insertAdjacentHTML('beforeend',
                           '<p style="font-size:13px">response: ' +
                           JSON.stringify(e.data.payload).slice(0, 120) + '</p>');
                     });
                   <\/script>
                 </div>`,
        },
      },
    ],
  })
);

// --------------------------------------------------------------------------
// 3. Long-running tool with progress notifications.
// --------------------------------------------------------------------------

server.registerTool(
  "slow-task",
  {
    description: "Runs for ~3s and reports progress (watch the progress bar)",
    inputSchema: { steps: z.number().default(6) },
  },
  async ({ steps }, extra) => {
    const n = steps || 6;
    for (let i = 1; i <= n; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (extra._meta?.progressToken !== undefined) {
        await extra.sendNotification({
          method: "notifications/progress",
          params: {
            progressToken: extra._meta.progressToken,
            progress: i,
            total: n,
            message: `step ${i} of ${n}`,
          },
        });
      }
    }
    return { content: [{ type: "text", text: `Done after ${n} steps` }] };
  }
);

// --------------------------------------------------------------------------
// 4. Elicitation: the server asks the user a question mid-call.
// --------------------------------------------------------------------------

server.registerTool(
  "ask-user",
  {
    description: "Asks you a question via elicitation (a dialog appears)",
    inputSchema: {},
  },
  async (_args, extra) => {
    const answer = await extra.sendRequest(
      {
        method: "elicitation/create",
        params: {
          message: "Do you want to proceed with the demo?",
          requestedSchema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        },
      },
      z.object({}).passthrough()
    );
    return {
      content: [{ type: "text", text: `You answered: ${JSON.stringify(answer)}` }],
    };
  }
);

// --------------------------------------------------------------------------
// 5. Output-schema validation, both directions.
// --------------------------------------------------------------------------

server.registerTool(
  "good-schema",
  {
    description: "structuredContent matches its outputSchema (schema ✓ badge)",
    inputSchema: {},
    outputSchema: { city: z.string(), temperature: z.number() },
  },
  async () => ({
    content: [{ type: "text", text: "ok" }],
    structuredContent: { city: "Paris", temperature: 21 },
  })
);

server.registerTool(
  "bad-schema",
  {
    description: "structuredContent VIOLATES its outputSchema (see the error)",
    inputSchema: {},
    outputSchema: { city: z.string(), temperature: z.number(), humidity: z.number() },
  },
  async () => ({
    content: [{ type: "text", text: "oops" }],
    structuredContent: { city: "Paris", temperature: "21" },
  })
);

await server.connect(new StdioServerTransport());

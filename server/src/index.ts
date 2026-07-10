import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT || 3400);

interface Session {
  id: string;
  client: Client;
  serverInfo: unknown;
  capabilities: unknown;
  subscribers: Set<express.Response>;
}

const sessions = new Map<string, Session>();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

function broadcast(session: Session, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of session.subscribers) res.write(payload);
}

app.post("/api/connect", async (req, res) => {
  const { type, url, command, args, env, headers } = req.body ?? {};
  try {
    let transport;
    if (type === "stdio") {
      if (!command) throw new Error("command is required for stdio");
      transport = new StdioClientTransport({
        command,
        args: Array.isArray(args) ? args : [],
        env: { ...(process.env as Record<string, string>), ...(env ?? {}) },
        stderr: "pipe",
      });
    } else if (type === "sse") {
      if (!url) throw new Error("url is required for sse");
      transport = new SSEClientTransport(new URL(url), {
        requestInit: { headers: headers ?? {} },
      });
    } else {
      if (!url) throw new Error("url is required for streamable-http");
      transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: headers ?? {} },
      });
    }

    const client = new Client(
      { name: "chatgpt-mcp-renderer", version: "0.1.0" },
      { capabilities: {} }
    );

    const id = randomUUID();
    const session: Session = {
      id,
      client,
      serverInfo: null,
      capabilities: null,
      subscribers: new Set(),
    };

    client.fallbackNotificationHandler = async (notification) => {
      broadcast(session, "notification", notification);
    };

    await client.connect(transport);
    session.serverInfo = client.getServerVersion();
    session.capabilities = client.getServerCapabilities();

    transport.onclose = () => {
      broadcast(session, "closed", {});
      for (const sub of session.subscribers) sub.end();
      sessions.delete(id);
    };

    sessions.set(id, session);
    res.json({
      sessionId: id,
      serverInfo: session.serverInfo,
      capabilities: session.capabilities,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

function getSession(req: express.Request, res: express.Response): Session | null {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Unknown session — connection may have closed" });
    return null;
  }
  return session;
}

app.post("/api/:sessionId/disconnect", async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session) {
    sessions.delete(session.id);
    try {
      await session.client.close();
    } catch {
      /* already closed */
    }
  }
  res.json({ ok: true });
});

app.get("/api/:sessionId/events", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("event: hello\ndata: {}\n\n");
  session.subscribers.add(res);
  req.on("close", () => session.subscribers.delete(res));
});

async function handle<T>(res: express.Response, fn: () => Promise<T>) {
  try {
    res.json(await fn());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

function hasCapability(session: Session, key: string): boolean {
  return Boolean((session.capabilities as Record<string, unknown> | null)?.[key]);
}

app.get("/api/:sessionId/tools", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  if (!hasCapability(session, "tools")) return void res.json({ tools: [] });
  handle(res, () => session.client.listTools());
});

app.post("/api/:sessionId/tools/call", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const { name, arguments: toolArgs, _meta } = req.body ?? {};
  handle(res, () =>
    session.client.callTool({ name, arguments: toolArgs ?? {}, _meta })
  );
});

app.get("/api/:sessionId/resources", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  if (!hasCapability(session, "resources")) return void res.json({ resources: [] });
  handle(res, () => session.client.listResources());
});

app.get("/api/:sessionId/resource-templates", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  if (!hasCapability(session, "resources"))
    return void res.json({ resourceTemplates: [] });
  handle(res, () => session.client.listResourceTemplates());
});

app.post("/api/:sessionId/resources/read", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  handle(res, () => session.client.readResource({ uri: req.body?.uri }));
});

app.get("/api/:sessionId/prompts", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  if (!hasCapability(session, "prompts")) return void res.json({ prompts: [] });
  handle(res, () => session.client.listPrompts());
});

app.post("/api/:sessionId/prompts/get", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const { name, arguments: promptArgs } = req.body ?? {};
  handle(res, () => session.client.getPrompt({ name, arguments: promptArgs ?? {} }));
});

app.listen(PORT, () => {
  console.log(`MCP proxy listening on http://localhost:${PORT}`);
});

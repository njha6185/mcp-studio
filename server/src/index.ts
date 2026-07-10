import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  type LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";

const PORT = Number(process.env.PORT || 3400);
const FRAME_BUFFER = 1000;
const SERVER_REQUEST_TIMEOUT = 10 * 60 * 1000;
const TOOL_CALL_TIMEOUT = 10 * 60 * 1000;

interface FrameRecord {
  seq: number;
  dir: "send" | "recv";
  ts: number;
  frame: unknown;
}

interface Session {
  id: string;
  client: Client;
  serverInfo: unknown;
  capabilities: unknown;
  subscribers: Set<express.Response>;
  frames: FrameRecord[];
  frameSeq: number;
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
}

const sessions = new Map<string, Session>();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

function sseWrite(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(session: Session, event: string, data: unknown) {
  for (const res of session.subscribers) sseWrite(res, event, data);
}

/** Record every JSON-RPC frame crossing the transport, in both directions. */
function tapTransport(transport: Transport, session: Session) {
  const record = (dir: "send" | "recv", frame: unknown) => {
    const rec: FrameRecord = { seq: ++session.frameSeq, dir, ts: Date.now(), frame };
    session.frames.push(rec);
    if (session.frames.length > FRAME_BUFFER) session.frames.shift();
    broadcast(session, "frame", rec);
  };

  const origSend = transport.send.bind(transport);
  transport.send = (message, options) => {
    record("send", message);
    return origSend(message, options);
  };

  // The SDK's connect() chains any pre-existing onmessage handler in front of
  // its own dispatcher, so installing a plain recorder before connect captures
  // every inbound frame, including the initialize response.
  transport.onmessage = (message) => record("recv", message);
}

/** Forward a server-initiated request (sampling/elicitation) to the browser and await its answer. */
function askBrowser(session: Session, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`No response from user for ${method}`));
    }, SERVER_REQUEST_TIMEOUT);
    session.pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    broadcast(session, "serverRequest", { id, method, params });
  });
}

app.post("/api/connect", async (req, res) => {
  const { type, url, command, args, env, headers } = req.body ?? {};
  try {
    let transport: Transport;
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
      { name: "mcp-studio", version: "0.1.0" },
      { capabilities: { sampling: {}, elicitation: {} } }
    );

    const id = randomUUID();
    const session: Session = {
      id,
      client,
      serverInfo: null,
      capabilities: null,
      subscribers: new Set(),
      frames: [],
      frameSeq: 0,
      pending: new Map(),
    };

    client.fallbackNotificationHandler = async (notification) => {
      broadcast(session, "notification", notification);
    };
    client.setRequestHandler(CreateMessageRequestSchema, (request) =>
      askBrowser(session, "sampling/createMessage", request.params) as never
    );
    client.setRequestHandler(ElicitRequestSchema, (request) =>
      askBrowser(session, "elicitation/create", request.params) as never
    );

    tapTransport(transport, session);
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

function hasCapability(session: Session, key: string): boolean {
  return Boolean((session.capabilities as Record<string, unknown> | null)?.[key]);
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
  sseWrite(res, "hello", {});
  // Replay buffered frames (e.g. the initialize handshake) to the new subscriber.
  for (const frame of session.frames) sseWrite(res, "frame", frame);
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

app.get("/api/:sessionId/tools", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  if (!hasCapability(session, "tools")) return void res.json({ tools: [] });
  handle(res, () => session.client.listTools());
});

app.post("/api/:sessionId/tools/call", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const { name, arguments: toolArgs, _meta, callId } = req.body ?? {};
  handle(res, () =>
    session.client.callTool({ name, arguments: toolArgs ?? {}, _meta }, undefined, {
      timeout: TOOL_CALL_TIMEOUT,
      resetTimeoutOnProgress: true,
      onprogress: (progress) => broadcast(session, "progress", { ...progress, callId }),
    })
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

app.post("/api/:sessionId/resources/subscribe", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  handle(res, () => session.client.subscribeResource({ uri: req.body?.uri }));
});

app.post("/api/:sessionId/resources/unsubscribe", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  handle(res, () => session.client.unsubscribeResource({ uri: req.body?.uri }));
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

app.post("/api/:sessionId/logging/level", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  handle(res, () => session.client.setLoggingLevel(req.body?.level as LoggingLevel));
});

// Browser's answer to a server-initiated request (sampling / elicitation).
app.post("/api/:sessionId/respond", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const { id, result, error } = req.body ?? {};
  const pending = session.pending.get(id);
  if (!pending) return void res.status(404).json({ error: "Unknown request id" });
  session.pending.delete(id);
  if (error) pending.reject(new Error(String(error)));
  else pending.resolve(result);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`MCP proxy listening on http://localhost:${PORT}`);
});

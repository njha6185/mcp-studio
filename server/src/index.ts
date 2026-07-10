import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
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

// ---------------------------------------------------------------------------
// OAuth support for remote servers
// ---------------------------------------------------------------------------

interface OAuthRecord {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

/** Credentials keyed by server URL so reconnects reuse tokens without a new flow. */
const oauthStore = new Map<string, OAuthRecord>();

interface PendingAuth {
  params: ConnectRequest;
  provider: StudioOAuthProvider;
  transport: {
    finishAuth(code: string): Promise<void>;
  };
  status: "waiting" | "ready" | "error";
  session?: { sessionId: string; serverInfo: unknown; capabilities: unknown };
  error?: string;
  createdAt: number;
}

const pendingAuths = new Map<string, PendingAuth>();

class StudioOAuthProvider implements OAuthClientProvider {
  /** Captured instead of redirecting — the browser opens it in a new tab. */
  authorizationUrl: string | null = null;

  constructor(
    private serverUrl: string,
    private stateId: string
  ) {}

  get redirectUrl(): string {
    return `http://localhost:${PORT}/api/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "MCP Studio",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.stateId;
  }

  private record(): OAuthRecord {
    let rec = oauthStore.get(this.serverUrl);
    if (!rec) {
      rec = {};
      oauthStore.set(this.serverUrl, rec);
    }
    return rec;
  }

  clientInformation() {
    return oauthStore.get(this.serverUrl)?.clientInformation;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.record().clientInformation = info;
  }
  tokens() {
    return oauthStore.get(this.serverUrl)?.tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.record().tokens = tokens;
  }
  saveCodeVerifier(verifier: string) {
    this.record().codeVerifier = verifier;
  }
  codeVerifier(): string {
    const v = oauthStore.get(this.serverUrl)?.codeVerifier;
    if (!v) throw new Error("No PKCE code verifier saved for this server");
    return v;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url.toString();
  }
  invalidateCredentials?(scope: "all" | "client" | "tokens" | "verifier") {
    const rec = oauthStore.get(this.serverUrl);
    if (!rec) return;
    if (scope === "all") oauthStore.delete(this.serverUrl);
    if (scope === "client") delete rec.clientInformation;
    if (scope === "tokens") delete rec.tokens;
    if (scope === "verifier") delete rec.codeVerifier;
  }
}

interface ConnectRequest {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

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

function buildTransport(
  params: ConnectRequest,
  authProvider?: OAuthClientProvider
): Transport {
  const { type, url, command, args, env, headers } = params;
  if (type === "stdio") {
    if (!command) throw new Error("command is required for stdio");
    return new StdioClientTransport({
      command,
      args: Array.isArray(args) ? args : [],
      env: { ...(process.env as Record<string, string>), ...(env ?? {}) },
      stderr: "pipe",
    });
  }
  if (!url) throw new Error(`url is required for ${type}`);
  if (type === "sse") {
    return new SSEClientTransport(new URL(url), {
      requestInit: { headers: headers ?? {} },
      authProvider,
    });
  }
  return new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: headers ?? {} },
    authProvider,
  });
}

async function establishSession(
  params: ConnectRequest,
  authProvider?: OAuthClientProvider
): Promise<{ sessionId: string; serverInfo: unknown; capabilities: unknown }> {
  const transport = buildTransport(params, authProvider);
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
  return {
    sessionId: id,
    serverInfo: session.serverInfo,
    capabilities: session.capabilities,
  };
}

app.post("/api/connect", async (req, res) => {
  const params = (req.body ?? {}) as ConnectRequest;
  const isRemote = params.type === "sse" || params.type === "streamable-http";
  const stateId = randomUUID();
  const provider =
    isRemote && params.url ? new StudioOAuthProvider(params.url, stateId) : undefined;
  try {
    res.json(await establishSession(params, provider));
  } catch (err) {
    // Server requires OAuth: hand the authorization URL to the browser and
    // keep the transport around to complete the code exchange on callback.
    if (err instanceof UnauthorizedError && provider?.authorizationUrl) {
      const transport = buildTransport(params, provider) as unknown as PendingAuth["transport"];
      pendingAuths.set(stateId, {
        params,
        provider,
        transport,
        status: "waiting",
        createdAt: Date.now(),
      });
      res.json({
        authRequired: true,
        pendingId: stateId,
        authorizationUrl: provider.authorizationUrl,
      });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/oauth/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const pending = pendingAuths.get(state);
  const page = (title: string, body: string, ok: boolean) =>
    res
      .status(ok ? 200 : 400)
      .type("html")
      .send(
        `<!doctype html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:90vh"><div style="text-align:center"><h2>${title}</h2><p>${body}</p></div></body>`
      );
  if (!pending) return page("Unknown authorization request", "Restart the connection from MCP Studio.", false);
  if (req.query.error) {
    const reason = String(req.query.error_description ?? req.query.error);
    finishPending(pending, reason);
    return page("Authorization failed", reason, false);
  }
  try {
    await pending.transport.finishAuth(code);
    // Tokens are now stored — connect fresh with the same provider.
    pending.session = await establishSession(pending.params, pending.provider);
    pending.status = "ready";
    page("✓ Authorized", "You can close this tab and return to MCP Studio.", true);
  } catch (err) {
    finishPending(pending, err instanceof Error ? err.message : String(err));
    page("Authorization failed", pending.error ?? "unknown error", false);
  }
});

function finishPending(pending: PendingAuth, error: string) {
  pending.status = "error";
  pending.error = error;
  return undefined;
}

app.get("/api/oauth/pending/:id", (req, res) => {
  const pending = pendingAuths.get(req.params.id);
  if (!pending) return void res.status(404).json({ error: "Unknown pending auth" });
  if (pending.status === "ready") {
    pendingAuths.delete(req.params.id);
    return void res.json({ status: "ready", session: pending.session });
  }
  if (pending.status === "error") {
    pendingAuths.delete(req.params.id);
    return void res.json({ status: "error", error: pending.error });
  }
  res.json({ status: "waiting" });
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

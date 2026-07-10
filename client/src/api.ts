import type {
  ConnectParams,
  McpPrompt,
  McpResource,
  McpResourceContents,
  McpResourceTemplate,
  McpTool,
  SessionInfo,
  ToolCallResult,
} from "./types";

export interface HistoryEntry {
  id: number;
  method: string;
  params: unknown;
  status: "pending" | "ok" | "error";
  response?: unknown;
  error?: string;
  startedAt: number;
  durationMs?: number;
}

type HistoryListener = (entry: HistoryEntry) => void;
let historyListeners: HistoryListener[] = [];
let historySeq = 0;

export function subscribeHistory(fn: HistoryListener): () => void {
  historyListeners.push(fn);
  return () => {
    historyListeners = historyListeners.filter((l) => l !== fn);
  };
}

function emitHistory(entry: HistoryEntry) {
  for (const l of historyListeners) l({ ...entry });
}

/** Record an MCP operation in the session history (like Inspector's History pane). */
async function tracked<T>(
  method: string,
  params: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const entry: HistoryEntry = {
    id: ++historySeq,
    method,
    params,
    status: "pending",
    startedAt: Date.now(),
  };
  emitHistory(entry);
  try {
    const response = await fn();
    emitHistory({
      ...entry,
      status: "ok",
      response,
      durationMs: Date.now() - entry.startedAt,
    });
    return response;
  } catch (err) {
    emitHistory({
      ...entry,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - entry.startedAt,
    });
    throw err;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (body as { error?: string }).error ?? `${res.status} ${res.statusText}`
    );
  }
  return body as T;
}

export interface AuthRequired {
  authRequired: true;
  pendingId: string;
  authorizationUrl: string;
}

export function connect(params: ConnectParams): Promise<SessionInfo | AuthRequired> {
  return tracked("initialize", params, () =>
    request("/api/connect", {
      method: "POST",
      body: JSON.stringify(params),
    })
  );
}

/** Poll until the user completes the OAuth flow in the other tab. */
export async function waitForOAuth(
  pendingId: string,
  timeoutMs = 5 * 60 * 1000
): Promise<SessionInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request<{
      status: "waiting" | "ready" | "error";
      session?: SessionInfo;
      error?: string;
    }>(`/api/oauth/pending/${pendingId}`);
    if (res.status === "ready" && res.session) return res.session;
    if (res.status === "error") throw new Error(res.error ?? "Authorization failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for authorization");
}

export function disconnect(sessionId: string): Promise<void> {
  return tracked("disconnect", { sessionId }, () =>
    request(`/api/${sessionId}/disconnect`, { method: "POST" })
  );
}

export function listTools(sessionId: string): Promise<{ tools: McpTool[] }> {
  return tracked("tools/list", {}, () => request(`/api/${sessionId}/tools`));
}

export function callTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
  callId?: string
): Promise<ToolCallResult> {
  const body = {
    name,
    arguments: args,
    ...(meta && Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
  return tracked("tools/call", body, () =>
    request(`/api/${sessionId}/tools/call`, {
      method: "POST",
      body: JSON.stringify({ ...body, callId }),
    })
  );
}

export function listResources(
  sessionId: string
): Promise<{ resources: McpResource[] }> {
  return tracked("resources/list", {}, () => request(`/api/${sessionId}/resources`));
}

export function listResourceTemplates(
  sessionId: string
): Promise<{ resourceTemplates: McpResourceTemplate[] }> {
  return tracked("resources/templates/list", {}, () =>
    request(`/api/${sessionId}/resource-templates`)
  );
}

export function readResource(
  sessionId: string,
  uri: string
): Promise<{ contents: McpResourceContents[] }> {
  return tracked("resources/read", { uri }, () =>
    request(`/api/${sessionId}/resources/read`, {
      method: "POST",
      body: JSON.stringify({ uri }),
    })
  );
}

export function listPrompts(sessionId: string): Promise<{ prompts: McpPrompt[] }> {
  return tracked("prompts/list", {}, () => request(`/api/${sessionId}/prompts`));
}

export function getPrompt(
  sessionId: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ messages: unknown[]; description?: string }> {
  return tracked("prompts/get", { name, arguments: args }, () =>
    request(`/api/${sessionId}/prompts/get`, {
      method: "POST",
      body: JSON.stringify({ name, arguments: args }),
    })
  );
}

export interface RawFrame {
  seq: number;
  dir: "send" | "recv";
  ts: number;
  frame: Record<string, unknown>;
}

export interface ProgressEvent {
  callId?: string;
  progress: number;
  total?: number;
  message?: string;
}

export interface ServerRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface EventHandlers {
  onNotification?: (n: unknown) => void;
  onFrame?: (f: RawFrame) => void;
  onProgress?: (p: ProgressEvent) => void;
  onServerRequest?: (r: ServerRequest) => void;
  onClosed?: () => void;
}

export function subscribeEvents(
  sessionId: string,
  handlers: EventHandlers
): () => void {
  const es = new EventSource(`/api/${sessionId}/events`);
  const on = <T,>(event: string, fn?: (data: T) => void) => {
    if (!fn) return;
    es.addEventListener(event, (e) => {
      try {
        fn(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore malformed */
      }
    });
  };
  on("notification", handlers.onNotification);
  on("frame", handlers.onFrame);
  on("progress", handlers.onProgress);
  on("serverRequest", handlers.onServerRequest);
  es.addEventListener("closed", () => {
    es.close();
    handlers.onClosed?.();
  });
  return () => es.close();
}

export function setLoggingLevel(sessionId: string, level: string): Promise<unknown> {
  return tracked("logging/setLevel", { level }, () =>
    request(`/api/${sessionId}/logging/level`, {
      method: "POST",
      body: JSON.stringify({ level }),
    })
  );
}

export function subscribeResource(sessionId: string, uri: string): Promise<unknown> {
  return tracked("resources/subscribe", { uri }, () =>
    request(`/api/${sessionId}/resources/subscribe`, {
      method: "POST",
      body: JSON.stringify({ uri }),
    })
  );
}

export function unsubscribeResource(sessionId: string, uri: string): Promise<unknown> {
  return tracked("resources/unsubscribe", { uri }, () =>
    request(`/api/${sessionId}/resources/unsubscribe`, {
      method: "POST",
      body: JSON.stringify({ uri }),
    })
  );
}

export function respondToServerRequest(
  sessionId: string,
  id: string,
  result?: unknown,
  error?: string
): Promise<void> {
  return request(`/api/${sessionId}/respond`, {
    method: "POST",
    body: JSON.stringify({ id, result, error }),
  });
}

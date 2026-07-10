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

export function connect(params: ConnectParams): Promise<SessionInfo> {
  return tracked("initialize", params, () =>
    request("/api/connect", {
      method: "POST",
      body: JSON.stringify(params),
    })
  );
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
  meta?: Record<string, unknown>
): Promise<ToolCallResult> {
  const body = {
    name,
    arguments: args,
    ...(meta && Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
  return tracked("tools/call", body, () =>
    request(`/api/${sessionId}/tools/call`, {
      method: "POST",
      body: JSON.stringify(body),
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

export function subscribeEvents(
  sessionId: string,
  onNotification: (n: unknown) => void,
  onClosed: () => void
): () => void {
  const es = new EventSource(`/api/${sessionId}/events`);
  es.addEventListener("notification", (e) => {
    try {
      onNotification(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore malformed */
    }
  });
  es.addEventListener("closed", () => {
    es.close();
    onClosed();
  });
  return () => es.close();
}

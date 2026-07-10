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
  onDevWidget?: (d: { path: string; ts: number }) => void;
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
  on("devwidget", handlers.onDevWidget);
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

// ---------------------------------------------------------------------------
// Health & completions
// ---------------------------------------------------------------------------

export function ping(sessionId: string): Promise<{ ok: boolean; latencyMs: number }> {
  return request(`/api/${sessionId}/ping`, { method: "POST" });
}

export interface CompletionRef {
  type: "ref/prompt" | "ref/resource";
  name?: string;
  uri?: string;
}

export function complete(
  sessionId: string,
  ref: CompletionRef,
  argName: string,
  value: string
): Promise<{ completion: { values: string[] } }> {
  return request(`/api/${sessionId}/complete`, {
    method: "POST",
    body: JSON.stringify({ ref, argument: { name: argName, value } }),
  });
}

// ---------------------------------------------------------------------------
// Widget dev mode
// ---------------------------------------------------------------------------

export function startDevWidget(
  sessionId: string,
  path: string
): Promise<{ ok: boolean; html: string }> {
  return request(`/api/${sessionId}/devwidget`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function getDevWidgetContent(sessionId: string): Promise<{ html: string }> {
  return request(`/api/${sessionId}/devwidget/content`);
}

export function stopDevWidget(sessionId: string): Promise<void> {
  return request(`/api/${sessionId}/devwidget`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Config import & persistent store
// ---------------------------------------------------------------------------

export interface ImportedServer {
  name: string;
  params: ConnectParams;
}

export function detectConfigs(): Promise<{
  configs: { path: string; servers: ImportedServer[] }[];
}> {
  return request("/api/configs/detect");
}

export function parseConfig(json: string): Promise<{ servers: ImportedServer[] }> {
  return request("/api/configs/parse", {
    method: "POST",
    body: JSON.stringify({ json }),
  });
}

export interface SavedServer {
  id: string;
  name: string;
  params: ConnectParams;
  createdAt: number;
}

export function listSavedServers(): Promise<{ servers: SavedServer[] }> {
  return request("/api/store/servers");
}

export function saveServer(
  name: string,
  params: ConnectParams
): Promise<{ servers: SavedServer[] }> {
  return request("/api/store/servers", {
    method: "POST",
    body: JSON.stringify({ name, params }),
  });
}

export function deleteSavedServer(id: string): Promise<{ servers: SavedServer[] }> {
  return request(`/api/store/servers/${id}`, { method: "DELETE" });
}

export interface Snapshot {
  id: string;
  name: string;
  serverName?: string;
  toolName: string;
  args: Record<string, unknown>;
  meta?: Record<string, unknown>;
  expected: unknown;
  createdAt: number;
  updatedAt: number;
}

export function listSnapshots(): Promise<{ snapshots: Snapshot[] }> {
  return request("/api/store/snapshots");
}

export function createSnapshot(snapshot: {
  name?: string;
  serverName?: string;
  toolName: string;
  args: Record<string, unknown>;
  meta?: Record<string, unknown>;
  expected: unknown;
}): Promise<{ snapshot: Snapshot }> {
  return request("/api/store/snapshots", {
    method: "POST",
    body: JSON.stringify(snapshot),
  });
}

export function updateSnapshot(
  id: string,
  patch: { expected?: unknown; name?: string }
): Promise<{ snapshot: Snapshot }> {
  return request(`/api/store/snapshots/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteSnapshot(id: string): Promise<void> {
  return request(`/api/store/snapshots/${id}`, { method: "DELETE" });
}

export interface OAuthEntryView {
  serverUrl: string;
  registered: boolean;
  hasTokens: boolean;
  tokenPreview: string | null;
  scope: string | null;
  savedAt: number | null;
}

export function listOAuthEntries(): Promise<{ entries: OAuthEntryView[] }> {
  return request("/api/store/oauth");
}

export function forgetOAuth(url?: string): Promise<void> {
  return request(`/api/store/oauth${url ? `?url=${encodeURIComponent(url)}` : ""}`, {
    method: "DELETE",
  });
}

export interface StudioSettings {
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  chatModel: string;
  storePath: string;
}

export function getSettings(): Promise<StudioSettings> {
  return request("/api/store/settings");
}

export function saveSettings(patch: {
  anthropicApiKey?: string;
  chatModel?: string;
}): Promise<void> {
  return request("/api/store/settings", {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export function clearStore(
  section: "savedServers" | "oauth" | "snapshots" | "settings" | "all"
): Promise<void> {
  return request(`/api/store?section=${section}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Chat simulator
// ---------------------------------------------------------------------------

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

export interface ChatResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;
}

export function chat(
  sessionId: string,
  messages: AnthropicMessage[],
  model?: string
): Promise<ChatResponse> {
  return request(`/api/${sessionId}/chat`, {
    method: "POST",
    body: JSON.stringify({ messages, model }),
  });
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectParams,
  McpPrompt,
  McpResource,
  McpResourceTemplate,
  McpTool,
  SessionInfo,
} from "./types";
import ConnectScreen, { saveRecent } from "./components/ConnectScreen";
import ToolDetail, { type ToolPrefill } from "./components/ToolDetail";
import ServerRequestModal from "./components/ServerRequestModal";
import ResourcePanel from "./components/ResourcePanel";
import ResourceTemplatePanel from "./components/ResourceTemplatePanel";
import PromptPanel from "./components/PromptPanel";
import { getOpenAiTemplateUri } from "./widget/detect";
import { ThemeToggle } from "./theme";
import InfoTip from "./components/InfoTip";
import HistoryPanel, { type HistoryUseMode } from "./components/HistoryPanel";
import SnapshotsScreen from "./components/SnapshotsScreen";
import SettingsScreen from "./components/SettingsScreen";
import ChatScreen from "./components/ChatScreen";
import * as api from "./api";
import type {
  HistoryEntry,
  ProgressEvent,
  RawFrame,
  ServerRequest,
} from "./api";

type SidebarTab = "tools" | "resources" | "prompts";
type Selection =
  | { kind: "tool"; name: string }
  | { kind: "resource"; uri: string }
  | { kind: "template"; uriTemplate: string }
  | { kind: "prompt"; name: string }
  | null;

interface LogEntry {
  id: number;
  time: string;
  message: string;
}

export interface ActiveSession extends SessionInfo {
  params: ConnectParams;
}

export function sessionName(s: SessionInfo): string {
  return s.serverInfo?.title ?? s.serverInfo?.name ?? "MCP server";
}

let logId = 0;

export default function App() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [resources, setResources] = useState<McpResource[]>([]);
  const [templates, setTemplates] = useState<McpResourceTemplate[]>([]);
  const [prompts, setPrompts] = useState<McpPrompt[]>([]);
  const [tab, setTab] = useState<SidebarTab>("tools");
  const [selection, setSelection] = useState<Selection>(null);
  const [filter, setFilter] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [framesBySession, setFramesBySession] = useState<Record<string, RawFrame[]>>({});
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [serverRequests, setServerRequests] = useState<
    (ServerRequest & { sessionId: string })[]
  >([]);
  const [resourceUpdate, setResourceUpdate] = useState<{ uri: string; ts: number } | null>(null);
  const [prefill, setPrefill] = useState<ToolPrefill | null>(null);
  const [logLevel, setLogLevel] = useState("");
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [view, setView] = useState<
    "workspace" | "chat" | "snapshots" | "settings" | "addserver"
  >("workspace");
  const [devTick, setDevTick] = useState(0);
  const [latencyMap, setLatencyMap] = useState<Record<string, number | null>>({});

  const session = sessions.find((s) => s.sessionId === focusedId) ?? sessions[0] ?? null;
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    return api.subscribeHistory((entry) => {
      setHistory((prev) => {
        const idx = prev.findIndex((e) => e.id === entry.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = entry;
          return next;
        }
        return [entry, ...prev].slice(0, 300);
      });
    });
  }, []);

  const addLog = useCallback((message: string) => {
    setLog((prev) =>
      [
        { id: ++logId, time: new Date().toLocaleTimeString(), message },
        ...prev,
      ].slice(0, 200)
    );
  }, []);

  const refresh = useCallback(async (sessionId: string, autoSelect = true) => {
    const [t, r, rt, p] = await Promise.allSettled([
      api.listTools(sessionId),
      api.listResources(sessionId),
      api.listResourceTemplates(sessionId),
      api.listPrompts(sessionId),
    ]);
    setTools(t.status === "fulfilled" ? t.value.tools ?? [] : []);
    setResources(r.status === "fulfilled" ? r.value.resources ?? [] : []);
    setTemplates(rt.status === "fulfilled" ? rt.value.resourceTemplates ?? [] : []);
    setPrompts(p.status === "fulfilled" ? p.value.prompts ?? [] : []);
    if (autoSelect && t.status === "fulfilled" && (t.value.tools?.length ?? 0) > 0) {
      setSelection({ kind: "tool", name: t.value.tools[0].name });
    }
  }, []);

  function focusSession(sessionId: string) {
    if (sessionId === session?.sessionId) return;
    setFocusedId(sessionId);
    setSelection(null);
    setPrefill(null);
    refresh(sessionId);
  }

  async function connect(params: ConnectParams): Promise<void> {
    if (sessionsRef.current.length === 0) setHistory([]);
    let info;
    try {
      info = await api.connect(params);
      if ("authRequired" in info) {
        // Server requires OAuth: user authorizes in a new tab, we wait here.
        window.open(info.authorizationUrl, "_blank", "noopener");
        setConnectStatus(
          "Waiting for authorization — complete the sign-in in the tab that just opened…"
        );
        info = await api.waitForOAuth(info.pendingId);
      }
    } finally {
      setConnectStatus(null);
    }
    saveRecent(params);
    const active: ActiveSession = { ...info, params };
    setSessions((prev) => [...prev, active]);
    setFocusedId(active.sessionId);
    setView("workspace");
    addLog(
      `Connected to ${info.serverInfo?.name ?? "server"} v${info.serverInfo?.version ?? "?"}`
    );
    await refresh(active.sessionId);
  }

  async function connectMany(paramsList: ConnectParams[]) {
    for (const params of paramsList) await connect(params);
  }

  async function disconnect(sessionId?: string) {
    const target = sessionId ?? session?.sessionId;
    if (!target) return;
    await api.disconnect(target).catch(() => {});
    removeSession(target);
  }

  function removeSession(sessionId: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.sessionId !== sessionId);
      if (focusedId === sessionId || !next.some((s) => s.sessionId === focusedId)) {
        const nextFocus = next[0]?.sessionId ?? null;
        setFocusedId(nextFocus);
        setSelection(null);
        setPrefill(null);
        if (nextFocus) refresh(nextFocus);
        else {
          setTools([]);
          setResources([]);
          setTemplates([]);
          setPrompts([]);
          setProgress(null);
          setLogLevel("");
        }
      }
      return next;
    });
    setServerRequests((prev) => prev.filter((r) => r.sessionId !== sessionId));
    setFramesBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }

  // Auto-reconnect with backoff after a connection drops.
  const reconnect = useCallback(
    async (params: ConnectParams, name: string) => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await new Promise((r) => setTimeout(r, Math.min(15000, attempt * 2000)));
        try {
          let info = await api.connect(params);
          if ("authRequired" in info) return; // needs user interaction — give up silently
          const active: ActiveSession = { ...info, params };
          setSessions((prev) => [...prev, active]);
          setFocusedId((cur) => cur ?? active.sessionId);
          addLog(`Reconnected to ${name} (attempt ${attempt})`);
          refresh(active.sessionId);
          return;
        } catch {
          addLog(`Reconnect to ${name}: attempt ${attempt} failed`);
        }
      }
      addLog(`Gave up reconnecting to ${name}`);
    },
    [refresh, addLog]
  );

  // One event subscription per connected session.
  const sessionIds = sessions.map((s) => s.sessionId).join(",");
  useEffect(() => {
    if (sessions.length === 0) return;
    const unsubscribers = sessions.map((s) => {
      const name = sessionName(s);
      const tag = sessions.length > 1 ? `[${name}] ` : "";
      setFramesBySession((prev) => ({ ...prev, [s.sessionId]: [] }));
      return api.subscribeEvents(s.sessionId, {
        onNotification: (n) => {
          const notif = n as { method?: string; params?: Record<string, unknown> };
          const method = notif.method ?? "notification";
          if (method === "notifications/message") {
            const p = notif.params ?? {};
            const data = typeof p.data === "string" ? p.data : JSON.stringify(p.data);
            addLog(`${tag}[${p.level ?? "log"}]${p.logger ? ` ${p.logger}:` : ""} ${data}`);
          } else if (method === "notifications/resources/updated") {
            const uri = String(notif.params?.uri ?? "");
            addLog(`${tag}resource updated: ${uri}`);
            setResourceUpdate({ uri, ts: Date.now() });
          } else {
            addLog(`${tag}⤷ ${method}`);
          }
          if (method === "notifications/tools/list_changed" && s.sessionId === focusedId)
            refresh(s.sessionId, false);
        },
        onFrame: (f) =>
          setFramesBySession((prev) => ({
            ...prev,
            [s.sessionId]: [...(prev[s.sessionId] ?? []), f].slice(-1000),
          })),
        onProgress: (p) => setProgress(p),
        onServerRequest: (r) => {
          addLog(`${tag}server request: ${r.method}`);
          setServerRequests((prev) => [...prev, { ...r, sessionId: s.sessionId }]);
        },
        onDevWidget: () => setDevTick((t) => t + 1),
        onClosed: () => {
          addLog(`${tag}connection closed — attempting to reconnect`);
          removeSession(s.sessionId);
          reconnect(s.params, name);
        },
      });
    });
    return () => unsubscribers.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIds]);

  // Periodic ping for latency + liveness, across all sessions.
  useEffect(() => {
    if (sessions.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      for (const s of sessionsRef.current) {
        try {
          const res = await api.ping(s.sessionId);
          if (!cancelled)
            setLatencyMap((prev) => ({ ...prev, [s.sessionId]: res.latencyMs }));
        } catch {
          if (!cancelled) setLatencyMap((prev) => ({ ...prev, [s.sessionId]: null }));
        }
      }
    };
    tick();
    const interval = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIds]);

  const handleHistoryUse = useCallback(
    (entry: HistoryEntry, mode: HistoryUseMode) => {
      const p = entry.params as {
        name?: string;
        arguments?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
      };
      if (!p?.name) return;
      setTab("tools");
      setSelection({ kind: "tool", name: p.name });
      setPrefill({
        nonce: Date.now(),
        toolName: p.name,
        args: p.arguments ?? {},
        meta: p._meta,
        autoRun: mode === "replay",
      });
    },
    []
  );

  async function answerServerRequest(result?: unknown, error?: string) {
    const current = serverRequests[0];
    if (!current) return;
    setServerRequests((prev) => prev.slice(1));
    await api
      .respondToServerRequest(current.sessionId, current.id, result, error)
      .catch((err) => addLog(`Failed to respond: ${err.message}`));
  }

  const q = filter.trim().toLowerCase();
  const filteredTools = useMemo(
    () =>
      tools.filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q)
      ),
    [tools, q]
  );
  const filteredResources = useMemo(
    () =>
      resources.filter(
        (r) =>
          !q ||
          r.uri.toLowerCase().includes(q) ||
          (r.name ?? "").toLowerCase().includes(q)
      ),
    [resources, q]
  );
  const filteredTemplates = useMemo(
    () =>
      templates.filter(
        (t) =>
          !q ||
          t.uriTemplate.toLowerCase().includes(q) ||
          (t.name ?? "").toLowerCase().includes(q)
      ),
    [templates, q]
  );
  const filteredPrompts = useMemo(
    () => prompts.filter((p) => !q || p.name.toLowerCase().includes(q)),
    [prompts, q]
  );

  if (view === "settings") {
    return <SettingsScreen onClose={() => setView("workspace")} />;
  }

  if (view === "addserver" && session) {
    return (
      <div className="addserver-wrap">
        <ConnectScreen
          onConnect={connect}
          onConnectMany={connectMany}
          status={connectStatus}
          onOpenSettings={() => setView("settings")}
          onBack={() => setView("workspace")}
        />
      </div>
    );
  }

  if (!session) {
    return (
      <ConnectScreen
        onConnect={connect}
        onConnectMany={connectMany}
        status={connectStatus}
        onOpenSettings={() => setView("settings")}
      />
    );
  }

  const serverName = sessionName(session);

  if (view === "snapshots") {
    return (
      <SnapshotsScreen sessionId={session.sessionId} onClose={() => setView("workspace")} />
    );
  }

  if (view === "chat") {
    return (
      <ChatScreen
        sessions={sessions.map((s) => ({
          sessionId: s.sessionId,
          serverName: sessionName(s),
        }))}
        onClose={() => setView("workspace")}
        onHostEvent={addLog}
      />
    );
  }

  const selectedTool =
    selection?.kind === "tool" ? tools.find((t) => t.name === selection.name) : undefined;
  const selectedResource =
    selection?.kind === "resource"
      ? resources.find((r) => r.uri === selection.uri)
      : undefined;
  const selectedTemplate =
    selection?.kind === "template"
      ? templates.find((t) => t.uriTemplate === selection.uriTemplate)
      : undefined;
  const selectedPrompt =
    selection?.kind === "prompt"
      ? prompts.find((p) => p.name === selection.name)
      : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">◈ MCP Studio</div>
        <div className="topbar-servers">
          {sessions.map((s) => {
            const isFocused = s.sessionId === session.sessionId;
            const latency = latencyMap[s.sessionId];
            return (
              <button
                key={s.sessionId}
                className={`server-chip ${isFocused ? "active" : ""}`}
                title={
                  isFocused ? "Focused server" : "Click to focus this server's workspace"
                }
                onClick={() => focusSession(s.sessionId)}
              >
                <span
                  className="status-dot"
                  style={latency === null ? { background: "var(--error)", boxShadow: "none" } : undefined}
                />
                {sessionName(s)}
                {typeof latency === "number" && (
                  <span className="field-type">{latency} ms</span>
                )}
              </button>
            );
          })}
          <button
            className="server-chip add"
            title="Connect another MCP server"
            onClick={() => setView("addserver")}
          >
            ＋
          </button>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setView("chat")}>
            💬 Chat
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setView("snapshots")}>
            📌 Snapshots
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setView("settings")}>
            ⚙
          </button>
          <ThemeToggle />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => refresh(session.sessionId)}
          >
            ⟳
          </button>
          <button
            className={`btn btn-ghost btn-sm ${logOpen ? "active" : ""}`}
            onClick={() => setLogOpen(!logOpen)}
          >
            Events {log.length > 0 && <span className="log-count">{log.length}</span>}
          </button>
          <button
            className={`btn btn-ghost btn-sm ${historyOpen ? "active" : ""}`}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            History{" "}
            {history.length > 0 && <span className="log-count">{history.length}</span>}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title={
              sessions.length > 1
                ? `Disconnect ${serverName} (other servers stay connected)`
                : "Disconnect"
            }
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-tabs">
            {(
              [
                ["tools", `Tools ${tools.length}`],
                ["resources", `Resources ${resources.length + templates.length}`],
                ["prompts", `Prompts ${prompts.length}`],
              ] as [SidebarTab, string][]
            ).map(([t, tLabel]) => (
              <button
                key={t}
                className={`sidebar-tab ${tab === t ? "active" : ""}`}
                onClick={() => setTab(t)}
              >
                {tLabel}
              </button>
            ))}
          </div>
          <div className="sidebar-search-row">
            <input
              className="input sidebar-search"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <InfoTip
              pos="right"
              text="Everything the focused server exposes. Tools = actions you can call with arguments (✦ marks tools that render a UI widget). Resources = read-only data addressed by URI, including parameterized templates. Prompts = reusable message templates. With multiple servers connected, switch focus via the chips in the top bar — Chat always sees all servers."
            />
          </div>
          <div className="sidebar-list">
            {tab === "tools" &&
              filteredTools.map((t) => (
                <button
                  key={t.name}
                  className={`list-item ${
                    selection?.kind === "tool" && selection.name === t.name ? "active" : ""
                  }`}
                  onClick={() => setSelection({ kind: "tool", name: t.name })}
                >
                  <div className="list-item-title">
                    {t.title ?? t.name}
                    {getOpenAiTemplateUri(t) && <span className="widget-dot">✦</span>}
                  </div>
                  {t.description && (
                    <div className="list-item-desc">{t.description}</div>
                  )}
                </button>
              ))}
            {tab === "resources" &&
              filteredResources.map((r) => (
                <button
                  key={r.uri}
                  className={`list-item ${
                    selection?.kind === "resource" && selection.uri === r.uri ? "active" : ""
                  }`}
                  onClick={() => setSelection({ kind: "resource", uri: r.uri })}
                >
                  <div className="list-item-title">{r.title ?? r.name ?? r.uri}</div>
                  <div className="list-item-desc">{r.uri}</div>
                </button>
              ))}
            {tab === "resources" && filteredTemplates.length > 0 && (
              <div className="list-section">Templates</div>
            )}
            {tab === "resources" &&
              filteredTemplates.map((t) => (
                <button
                  key={t.uriTemplate}
                  className={`list-item ${
                    selection?.kind === "template" &&
                    selection.uriTemplate === t.uriTemplate
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    setSelection({ kind: "template", uriTemplate: t.uriTemplate })
                  }
                >
                  <div className="list-item-title">{t.title ?? t.name ?? t.uriTemplate}</div>
                  <div className="list-item-desc">{t.uriTemplate}</div>
                </button>
              ))}
            {tab === "prompts" &&
              filteredPrompts.map((p) => (
                <button
                  key={p.name}
                  className={`list-item ${
                    selection?.kind === "prompt" && selection.name === p.name ? "active" : ""
                  }`}
                  onClick={() => setSelection({ kind: "prompt", name: p.name })}
                >
                  <div className="list-item-title">{p.title ?? p.name}</div>
                  {p.description && <div className="list-item-desc">{p.description}</div>}
                </button>
              ))}
            {tab === "tools" && filteredTools.length === 0 && (
              <div className="empty-note">No tools</div>
            )}
            {tab === "resources" &&
              filteredResources.length === 0 &&
              filteredTemplates.length === 0 && (
                <div className="empty-note">No resources</div>
              )}
            {tab === "prompts" && filteredPrompts.length === 0 && (
              <div className="empty-note">No prompts</div>
            )}
          </div>
        </aside>

        <main className="content">
          {selectedTool ? (
            <ToolDetail
              sessionId={session.sessionId}
              tool={selectedTool}
              onHostEvent={addLog}
              prefill={prefill}
              progress={progress}
              serverName={serverName}
              devTick={devTick}
            />
          ) : selectedResource ? (
            <ResourcePanel
              sessionId={session.sessionId}
              resource={selectedResource}
              canSubscribe={Boolean(
                (session.capabilities?.resources as { subscribe?: boolean } | undefined)
                  ?.subscribe
              )}
              lastUpdate={resourceUpdate}
            />
          ) : selectedTemplate ? (
            <ResourceTemplatePanel
              sessionId={session.sessionId}
              template={selectedTemplate}
            />
          ) : selectedPrompt ? (
            <PromptPanel sessionId={session.sessionId} prompt={selectedPrompt} />
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">◈</div>
              <p>Select a tool, resource, or prompt to inspect it.</p>
            </div>
          )}
        </main>

        {logOpen && (
          <aside className="log-panel">
            <div className="panel-title">
              <span>
                Event log
                <InfoTip
                  pos="bottom-left"
                  text="Live activity across all connected servers: notifications (log messages, list-changed events) and actions taken by widgets. With multiple servers, entries are prefixed with the server name."
                />
              </span>
              <span className="history-actions">
                {session.capabilities?.logging !== undefined && (
                  <select
                    className="input input-sm"
                    title="Ask the focused server to send log messages at this level and above"
                    value={logLevel}
                    onChange={async (e) => {
                      const level = e.target.value;
                      setLogLevel(level);
                      if (level)
                        await api
                          .setLoggingLevel(session.sessionId, level)
                          .catch((err) => addLog(`setLevel failed: ${err.message}`));
                    }}
                  >
                    <option value="">log level…</option>
                    {["debug", "info", "notice", "warning", "error", "critical"].map(
                      (l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      )
                    )}
                  </select>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setLog([])}>
                  Clear
                </button>
              </span>
            </div>
            <div className="log-entries">
              {log.length === 0 && <div className="empty-note">No events yet.</div>}
              {log.map((entry) => (
                <div key={entry.id} className="log-entry">
                  <span className="log-time">{entry.time}</span>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {historyOpen && (
        <HistoryPanel
          sessionId={session.sessionId}
          serverInfo={session.serverInfo}
          entries={history}
          frames={framesBySession[session.sessionId] ?? []}
          onUse={handleHistoryUse}
          onClear={() => {
            setHistory([]);
            setFramesBySession((prev) => ({ ...prev, [session.sessionId]: [] }));
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {serverRequests.length > 0 && (
        <ServerRequestModal
          key={serverRequests[0].id}
          request={serverRequests[0]}
          onRespond={(result) => answerServerRequest(result)}
          onReject={(error) => answerServerRequest(undefined, error)}
        />
      )}
    </div>
  );
}

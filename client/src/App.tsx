import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConnectParams,
  McpPrompt,
  McpResource,
  McpResourceTemplate,
  McpTool,
  SessionInfo,
} from "./types";
import ConnectScreen, { saveRecent } from "./components/ConnectScreen";
import ToolDetail from "./components/ToolDetail";
import ResourcePanel from "./components/ResourcePanel";
import ResourceTemplatePanel from "./components/ResourceTemplatePanel";
import PromptPanel from "./components/PromptPanel";
import { getOpenAiTemplateUri } from "./widget/detect";
import { ThemeToggle } from "./theme";
import InfoTip from "./components/InfoTip";
import HistoryPanel from "./components/HistoryPanel";
import * as api from "./api";
import type { HistoryEntry } from "./api";

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

let logId = 0;

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
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

  const refresh = useCallback(
    async (sessionId: string) => {
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
      if (t.status === "fulfilled" && (t.value.tools?.length ?? 0) > 0) {
        setSelection({ kind: "tool", name: t.value.tools[0].name });
      }
    },
    []
  );

  async function connect(params: ConnectParams) {
    setHistory([]);
    const info = await api.connect(params);
    saveRecent(params);
    setSession(info);
    addLog(
      `Connected to ${info.serverInfo?.name ?? "server"} v${info.serverInfo?.version ?? "?"}`
    );
    await refresh(info.sessionId);
  }

  async function disconnect() {
    if (session) {
      await api.disconnect(session.sessionId).catch(() => {});
    }
    setSession(null);
    setTools([]);
    setResources([]);
    setPrompts([]);
    setSelection(null);
  }

  useEffect(() => {
    if (!session) return;
    const unsubscribe = api.subscribeEvents(
      session.sessionId,
      (n) => {
        const method = (n as { method?: string }).method ?? "notification";
        addLog(`⤷ ${method}`);
        if (method === "notifications/tools/list_changed") refresh(session.sessionId);
      },
      () => {
        addLog("Connection closed by server");
        setSession(null);
      }
    );
    return unsubscribe;
  }, [session?.sessionId]);

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

  if (!session) {
    return <ConnectScreen onConnect={connect} />;
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
        <div className="topbar-server">
          <span className="status-dot" />
          {session.serverInfo?.title ?? session.serverInfo?.name ?? "MCP server"}
          {session.serverInfo?.version && (
            <span className="field-type">v{session.serverInfo.version}</span>
          )}
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => refresh(session.sessionId)}
          >
            ⟳ Refresh
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
          <button className="btn btn-ghost btn-sm" onClick={disconnect}>
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
              text="Everything the connected server exposes. Tools = actions you can call with arguments (✦ marks tools that render a UI widget). Resources = read-only data addressed by URI, including parameterized templates. Prompts = reusable message templates."
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
            />
          ) : selectedResource ? (
            <ResourcePanel sessionId={session.sessionId} resource={selectedResource} />
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
                  text="Live activity: notifications pushed by the server (log messages, list-changed events) and actions taken by widgets (tool calls, follow-up messages, links)."
                />
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => setLog([])}>
                Clear
              </button>
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
          entries={history}
          onClear={() => setHistory([])}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

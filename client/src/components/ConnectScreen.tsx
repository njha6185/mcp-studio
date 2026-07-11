import { useEffect, useState } from "react";
import type { ConnectParams, TransportType } from "../types";
import { ThemeToggle } from "../theme";
import InfoTip from "./InfoTip";
import * as api from "../api";
import type { ImportedServer, SavedServer } from "../api";

interface Props {
  onConnect: (params: ConnectParams) => Promise<void>;
  onConnectMany?: (params: ConnectParams[]) => Promise<void>;
  status?: string | null;
  onOpenSettings?: () => void;
  /** Present when adding a server to an existing workspace. */
  onBack?: () => void;
}

const RECENT_KEY = "mcp-studio-recent";

function loadRecent(): ConnectParams[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveRecent(params: ConnectParams) {
  const recent = loadRecent().filter(
    (r) => JSON.stringify(r) !== JSON.stringify(params)
  );
  recent.unshift(params);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 6)));
}

function describeParams(p: ConnectParams): string {
  return p.type === "stdio" ? `${p.command} ${(p.args ?? []).join(" ")}` : p.url ?? "";
}

export default function ConnectScreen({
  onConnect,
  onConnectMany,
  status,
  onOpenSettings,
  onBack,
}: Props) {
  const [type, setType] = useState<TransportType>("streamable-http");
  const [url, setUrl] = useState("http://localhost:8000/mcp");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedServer[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFound, setImportFound] = useState<{ source: string; server: ImportedServer }[]>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const recent = loadRecent();

  const refreshSaved = () =>
    api.listSavedServers().then((r) => setSaved(r.servers)).catch(() => {});
  useEffect(() => {
    refreshSaved();
  }, []);

  function currentParams(): ConnectParams {
    if (type === "stdio")
      return {
        type,
        command: command.trim(),
        args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      };
    let headers: Record<string, string> | undefined;
    if (headersText.trim()) {
      headers = {};
      for (const line of headersText.split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    return { type, url: url.trim(), headers };
  }

  async function submit(params?: ConnectParams) {
    setError(null);
    setBusy(true);
    try {
      await onConnect(params ?? currentParams());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitChecked() {
    const list = saved.filter((s) => checked.has(s.id)).map((s) => s.params);
    if (list.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      if (onConnectMany) await onConnectMany(list);
      else for (const p of list) await onConnect(p);
      setChecked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveCurrent() {
    const name = window.prompt("Name for this server:");
    if (!name) return;
    await api.saveServer(name, currentParams());
    refreshSaved();
  }

  async function detect() {
    setImportMsg(null);
    const { configs } = await api.detectConfigs();
    const found = configs.flatMap((c) =>
      c.servers.map((server) => ({ source: c.path.replace(/^.*\//, ""), server }))
    );
    setImportFound(found);
    if (!found.length) setImportMsg("No MCP configs found in the usual locations.");
  }

  async function parsePasted() {
    setImportMsg(null);
    try {
      const { servers } = await api.parseConfig(importText);
      setImportFound(servers.map((server) => ({ source: "pasted", server })));
      if (!servers.length) setImportMsg("No servers found in that JSON.");
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function addImported(items: { server: ImportedServer }[]) {
    for (const { server } of items) await api.saveServer(server.name, server.params);
    setImportFound([]);
    setImportOpen(false);
    setImportMsg(null);
    refreshSaved();
  }

  return (
    <div className="connect-screen">
      <div className="connect-theme-toggle">
        {onBack && (
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            ← Back to workspace
          </button>
        )}
        {onOpenSettings && (
          <button className="btn btn-ghost btn-sm" onClick={onOpenSettings}>
            ⚙ Settings
          </button>
        )}
        <ThemeToggle />
      </div>
      <div className="connect-card">
        <div className="connect-logo">◈</div>
        <h1>MCP Widget Studio</h1>
        <p className="connect-sub">
          Inspect MCP servers, call tools, and render their UI widgets — the way
          ChatGPT renders apps.
        </p>

        <div className="field-label" style={{ marginBottom: 6 }}>
          <span className="field-name">Transport</span>
          <InfoTip text="How to reach the MCP server. Streamable HTTP is the current standard for remote servers; SSE is the older HTTP transport; STDIO launches a local server process (e.g. an npx package) and talks over stdin/stdout." />
        </div>
        <div className="transport-tabs">
          {(
            [
              ["streamable-http", "Streamable HTTP"],
              ["sse", "SSE"],
              ["stdio", "STDIO"],
            ] as [TransportType, string][]
          ).map(([t, tLabel]) => (
            <button
              key={t}
              className={`transport-tab ${type === t ? "active" : ""}`}
              onClick={() => setType(t)}
            >
              {tLabel}
            </button>
          ))}
        </div>

        {type === "stdio" ? (
          <>
            <div className="field">
              <label className="field-label">
                <span className="field-name">Command</span>
                <InfoTip text="The executable that starts the MCP server locally, e.g. npx, node, python, or uvx. The app's proxy spawns it and communicates over stdin/stdout." />
              </label>
              <input
                className="input"
                placeholder="npx"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">
                <span className="field-name">Arguments</span>
              </label>
              <input
                className="input"
                placeholder="-y @modelcontextprotocol/server-everything"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label className="field-label">
                <span className="field-name">Server URL</span>
              </label>
              <input
                className="input"
                placeholder="http://localhost:8000/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            <div className="field">
              <label className="field-label">
                <span className="field-name">Headers</span>
                <span className="field-type">optional, one per line</span>
                <InfoTip text="Extra HTTP headers sent with every request to the server — most commonly an Authorization header for servers that need an API key or bearer token. Servers requiring OAuth are handled automatically: a sign-in tab opens on connect." />
              </label>
              <textarea
                className="input input-code"
                rows={2}
                placeholder={"Authorization: Bearer <token>"}
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
              />
            </div>
          </>
        )}

        {error && <div className="connect-error">{error}</div>}

        <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => submit()}>
          {busy ? "Connecting…" : "Connect"}
        </button>
        {status && <div className="connect-status">{status}</div>}

        <div className="recent">
          <div className="recent-title">
            <span>Saved servers</span>
            <span className="recent-title-actions">
              <button className="btn-link" onClick={saveCurrent}>
                ＋ save current
              </button>
              <button className="btn-link" onClick={() => setImportOpen(!importOpen)}>
                {importOpen ? "close import" : "import config"}
              </button>
            </span>
          </div>

          {importOpen && (
            <div className="import-box">
              <div className="import-actions">
                <button className="btn btn-ghost btn-sm" onClick={detect}>
                  Detect local configs
                </button>
                <InfoTip text="Scans the usual locations — claude_desktop_config.json, .mcp.json (project & home), .cursor/mcp.json, .claude.json — or paste any config JSON with an mcpServers / servers map below." />
              </div>
              <textarea
                className="input input-code"
                rows={3}
                placeholder='{"mcpServers": {"my-server": {"command": "npx", "args": ["-y", "..."]}}}'
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              {importText.trim() && (
                <button className="btn btn-ghost btn-sm" onClick={parsePasted}>
                  Parse pasted JSON
                </button>
              )}
              {importMsg && <div className="field-error">{importMsg}</div>}
              {importFound.length > 0 && (
                <div className="import-found">
                  {importFound.map((f, i) => (
                    <div key={i} className="import-found-row">
                      <span className="recent-target">
                        <b>{f.server.name}</b> · {describeParams(f.server.params)}
                      </span>
                      <span className="field-type">{f.source}</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => addImported([f])}>
                        Add
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => addImported(importFound)}
                  >
                    Add all ({importFound.length})
                  </button>
                </div>
              )}
            </div>
          )}

          {saved.length === 0 && !importOpen && (
            <div className="empty-note">
              No saved servers yet — save the current form or import a config.
            </div>
          )}
          {saved.map((s) => (
            <div key={s.id} className="recent-item saved-item">
              <input
                type="checkbox"
                title="Select to connect multiple servers at once"
                checked={checked.has(s.id)}
                onChange={() => toggleChecked(s.id)}
              />
              <button
                className="saved-connect"
                disabled={busy}
                onClick={() => submit(s.params)}
              >
                <span className="badge">{s.params.type}</span>
                <b>{s.name}</b>
                <span className="recent-target">{describeParams(s.params)}</span>
              </button>
              <button
                className="btn-link"
                title="Remove saved server"
                onClick={() => api.deleteSavedServer(s.id).then(refreshSaved)}
              >
                ✕
              </button>
            </div>
          ))}
          {checked.size > 0 && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={submitChecked}>
              {busy ? "Connecting…" : `Connect ${checked.size} selected — Chat can use them all together`}
            </button>
          )}

          {recent.length > 0 && (
            <>
              <div className="recent-title" style={{ marginTop: 14 }}>
                Recent
              </div>
              {recent.map((r, i) => (
                <button
                  key={i}
                  className="recent-item"
                  disabled={busy}
                  onClick={() => submit(r)}
                >
                  <span className="badge">{r.type}</span>
                  <span className="recent-target">{describeParams(r)}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

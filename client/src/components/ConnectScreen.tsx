import { useState } from "react";
import type { ConnectParams, TransportType } from "../types";
import { ThemeToggle } from "../theme";
import InfoTip from "./InfoTip";

interface Props {
  onConnect: (params: ConnectParams) => Promise<void>;
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

export default function ConnectScreen({ onConnect }: Props) {
  const [type, setType] = useState<TransportType>("streamable-http");
  const [url, setUrl] = useState("http://localhost:8000/mcp");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = loadRecent();

  async function submit(params?: ConnectParams) {
    setError(null);
    setBusy(true);
    try {
      let headers: Record<string, string> | undefined;
      if (!params && headersText.trim()) {
        headers = {};
        for (const line of headersText.split("\n")) {
          const idx = line.indexOf(":");
          if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      const p: ConnectParams =
        params ??
        (type === "stdio"
          ? {
              type,
              command: command.trim(),
              args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
            }
          : { type, url: url.trim(), headers });
      await onConnect(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect-screen">
      <div className="connect-theme-toggle">
        <ThemeToggle />
      </div>
      <div className="connect-card">
        <div className="connect-logo">◈</div>
        <h1>MCP Studio</h1>
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
                <InfoTip text="Extra HTTP headers sent with every request to the server — most commonly an Authorization header for servers that need an API key or bearer token." />
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

        {recent.length > 0 && (
          <div className="recent">
            <div className="recent-title">Recent</div>
            {recent.map((r, i) => (
              <button key={i} className="recent-item" disabled={busy} onClick={() => submit(r)}>
                <span className="badge">{r.type}</span>
                <span className="recent-target">
                  {r.type === "stdio" ? `${r.command} ${(r.args ?? []).join(" ")}` : r.url}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

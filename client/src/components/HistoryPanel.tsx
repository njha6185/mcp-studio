import { useState } from "react";
import type { HistoryEntry, RawFrame } from "../api";
import JsonView from "./JsonView";
import InfoTip from "./InfoTip";

export type HistoryUseMode = "replay" | "load";

interface Props {
  sessionId: string;
  serverInfo: unknown;
  entries: HistoryEntry[];
  frames: RawFrame[];
  onUse: (entry: HistoryEntry, mode: HistoryUseMode) => void;
  onClear: () => void;
  onClose: () => void;
}

function StatusBadge({ entry }: { entry: HistoryEntry }) {
  if (entry.status === "pending") return <span className="badge">…</span>;
  if (entry.status === "error") return <span className="badge badge-error">error</span>;
  return <span className="badge badge-ok">ok</span>;
}

function summarize(e: HistoryEntry): string {
  const p = e.params as Record<string, unknown> | null;
  if (!p) return "";
  if (typeof p.name === "string") return p.name;
  if (typeof p.uri === "string") return p.uri;
  if (typeof p.url === "string") return String(p.url);
  if (typeof p.command === "string")
    return `${p.command} ${Array.isArray(p.args) ? p.args.join(" ") : ""}`.trim();
  return "";
}

function frameLabel(f: RawFrame): string {
  const fr = f.frame as Record<string, unknown>;
  if (typeof fr.method === "string")
    return fr.id !== undefined ? `${fr.method} (#${fr.id})` : `${fr.method} (notify)`;
  if (fr.id !== undefined) return "error" in fr ? `error (#${fr.id})` : `result (#${fr.id})`;
  return "frame";
}

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HistoryPanel({
  sessionId,
  serverInfo,
  entries,
  frames,
  onUse,
  onClear,
  onClose,
}: Props) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [openFrame, setOpenFrame] = useState<number | null>(null);
  const [view, setView] = useState<"requests" | "frames">("requests");
  const [copied, setCopied] = useState(false);

  function copyCurl(e: HistoryEntry) {
    const p = e.params as Record<string, unknown>;
    const cmd = `curl -X POST http://localhost:3400/api/${sessionId}/tools/call \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(p).replace(/'/g, "'\\''")}'`;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <footer className="history-panel">
      <div className="panel-title history-title">
        <span className="history-view-tabs">
          <button
            className={`result-tab ${view === "requests" ? "active" : ""}`}
            onClick={() => setView("requests")}
          >
            Requests {entries.length > 0 && `(${entries.length})`}
          </button>
          <button
            className={`result-tab ${view === "frames" ? "active" : ""}`}
            onClick={() => setView("frames")}
          >
            Raw frames {frames.length > 0 && `(${frames.length})`}
          </button>
          <InfoTip
            pos="right"
            text="Requests = the MCP operations this app made (including widget-initiated calls). Raw frames = every JSON-RPC message on the wire in both directions — requests, responses, and notifications, including the initialize handshake."
          />
        </span>
        <span className="history-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              download(`mcp-studio-session-${Date.now()}.json`, {
                exportedAt: new Date().toISOString(),
                serverInfo,
                requests: entries,
                frames,
              })
            }
          >
            Export
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClear}>
            Clear
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </span>
      </div>

      {view === "requests" && (
        <div className="history-rows">
          {entries.length === 0 && <div className="empty-note">No requests yet.</div>}
          {entries.map((e) => (
            <div key={e.id} className="history-row-wrap">
              <button
                className={`history-row ${openId === e.id ? "open" : ""}`}
                onClick={() => setOpenId(openId === e.id ? null : e.id)}
              >
                <span className="history-num">#{e.id}</span>
                <span className="history-method">{e.method}</span>
                <span className="history-summary">{summarize(e)}</span>
                <StatusBadge entry={e} />
                <span className="history-duration">
                  {e.durationMs !== undefined ? `${e.durationMs} ms` : ""}
                </span>
                <span className="history-time">
                  {new Date(e.startedAt).toLocaleTimeString()}
                </span>
              </button>
              {openId === e.id && (
                <>
                  {e.method === "tools/call" && (
                    <div className="history-row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => onUse(e, "replay")}>
                        ↻ Replay
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => onUse(e, "load")}>
                        ✎ Load into form
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => copyCurl(e)}>
                        {copied ? "Copied ✓" : "Copy as curl"}
                      </button>
                    </div>
                  )}
                  <div className="history-detail">
                    <JsonView data={e.params} label="request params" />
                    {e.status === "error" ? (
                      <div className="result-error">⚠ {e.error}</div>
                    ) : (
                      <JsonView
                        data={e.response ?? null}
                        label={e.status === "pending" ? "response (pending…)" : "response"}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {view === "frames" && (
        <div className="history-rows">
          {frames.length === 0 && <div className="empty-note">No frames captured yet.</div>}
          {[...frames].reverse().map((f) => (
            <div key={f.seq} className="history-row-wrap">
              <button
                className={`history-row ${openFrame === f.seq ? "open" : ""}`}
                onClick={() => setOpenFrame(openFrame === f.seq ? null : f.seq)}
              >
                <span className="history-num">#{f.seq}</span>
                <span className={`bridge-dir ${f.dir === "send" ? "out" : "in"}`}>
                  {f.dir === "send" ? "→ server" : "← server"}
                </span>
                <span className="history-summary">{frameLabel(f)}</span>
                <span className="history-time">
                  {new Date(f.ts).toLocaleTimeString()}
                </span>
              </button>
              {openFrame === f.seq && (
                <div className="history-detail single">
                  <JsonView data={f.frame} label="JSON-RPC frame" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </footer>
  );
}

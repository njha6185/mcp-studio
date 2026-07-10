import { useState } from "react";
import type { HistoryEntry } from "../api";
import JsonView from "./JsonView";
import InfoTip from "./InfoTip";

interface Props {
  entries: HistoryEntry[];
  onClear: () => void;
  onClose: () => void;
}

function StatusBadge({ entry }: { entry: HistoryEntry }) {
  if (entry.status === "pending") return <span className="badge">…</span>;
  if (entry.status === "error") return <span className="badge badge-error">error</span>;
  return <span className="badge badge-ok">ok</span>;
}

export default function HistoryPanel({ entries, onClear, onClose }: Props) {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <footer className="history-panel">
      <div className="panel-title history-title">
        <span>
          History
          <InfoTip
            pos="right"
            text="Every MCP request this session made, newest first — including calls triggered from inside widgets. Click a row to see the request parameters and the full response."
          />
        </span>
        <span className="history-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClear}>
            Clear
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </span>
      </div>
      <div className="history-rows">
        {entries.length === 0 && (
          <div className="empty-note">No requests yet.</div>
        )}
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
            )}
          </div>
        ))}
      </div>
    </footer>
  );
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

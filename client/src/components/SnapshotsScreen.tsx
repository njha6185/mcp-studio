import { useEffect, useState } from "react";
import type { Snapshot } from "../api";
import { jsonDiff, type DiffEntry } from "../jsonDiff";
import JsonView from "./JsonView";
import InfoTip from "./InfoTip";
import * as api from "../api";

interface Props {
  sessionId: string;
  onClose: () => void;
}

type RunState =
  | { status: "running" }
  | { status: "pass" }
  | { status: "fail"; diff: DiffEntry[]; actual: unknown }
  | { status: "error"; error: string };

export default function SnapshotsScreen({ sessionId, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = () =>
    api.listSnapshots().then((r) => setSnapshots(r.snapshots)).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  async function runOne(s: Snapshot) {
    setRuns((prev) => ({ ...prev, [s.id]: { status: "running" } }));
    try {
      const actual = await api.callTool(sessionId, s.toolName, s.args, s.meta);
      const diff = jsonDiff(s.expected, actual);
      setRuns((prev) => ({
        ...prev,
        [s.id]: diff.length === 0 ? { status: "pass" } : { status: "fail", diff, actual },
      }));
    } catch (err) {
      setRuns((prev) => ({
        ...prev,
        [s.id]: { status: "error", error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }

  async function runAll() {
    for (const s of snapshots) await runOne(s);
  }

  async function updateExpected(s: Snapshot) {
    const run = runs[s.id];
    if (run?.status !== "fail") return;
    await api.updateSnapshot(s.id, { expected: run.actual });
    setRuns((prev) => ({ ...prev, [s.id]: { status: "pass" } }));
    refresh();
  }

  const passed = Object.values(runs).filter((r) => r.status === "pass").length;
  const failed = Object.values(runs).filter(
    (r) => r.status === "fail" || r.status === "error"
  ).length;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ← Back
        </button>
        <h2>
          Snapshots
          <InfoTip text="Pinned tool calls with their expected results. Run replays the call against the connected server and diffs the response — a lightweight regression suite for your MCP server." />
        </h2>
        <span className="screen-header-actions">
          {(passed > 0 || failed > 0) && (
            <span className="field-type">
              {passed} pass · {failed} fail
            </span>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={snapshots.length === 0}
            onClick={runAll}
          >
            ▶ Run all
          </button>
        </span>
      </div>

      <div className="screen-body">
        {snapshots.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">📌</div>
            <p>
              No snapshots yet. Run a tool, then use <b>Pin result</b> on the result
              panel to save it as an expected output.
            </p>
          </div>
        )}
        {snapshots.map((s) => {
          const run = runs[s.id];
          return (
            <div key={s.id} className="panel snapshot-panel">
              <div className="snapshot-row">
                <button
                  className="snapshot-title"
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                >
                  <b>{s.name}</b>
                  <span className="badge badge-mono">{s.toolName}</span>
                  {s.serverName && <span className="field-type">{s.serverName}</span>}
                </button>
                <span className="history-actions">
                  {run?.status === "running" && <span className="badge">running…</span>}
                  {run?.status === "pass" && <span className="badge badge-ok">pass</span>}
                  {run?.status === "fail" && (
                    <span className="badge badge-error">{run.diff.length} diffs</span>
                  )}
                  {run?.status === "error" && (
                    <span className="badge badge-error">error</span>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => runOne(s)}>
                    ▶ Run
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => api.deleteSnapshot(s.id).then(refresh)}
                  >
                    ✕
                  </button>
                </span>
              </div>

              {run?.status === "error" && (
                <div className="result-error">⚠ {run.error}</div>
              )}
              {run?.status === "fail" && (
                <div className="snapshot-diff">
                  <div className="result-error schema-issues">
                    <div>Result differs from the pinned expectation:</div>
                    <ul>
                      {run.diff.slice(0, 15).map((d, i) => (
                        <li key={i}>
                          <code>{d.path}</code> {d.kind}
                          {d.kind !== "added" && <> — expected {JSON.stringify(d.expected)?.slice(0, 60)}</>}
                          {d.kind !== "missing" && <> · got {JSON.stringify(d.actual)?.slice(0, 60)}</>}
                        </li>
                      ))}
                      {run.diff.length > 15 && <li>…and {run.diff.length - 15} more</li>}
                    </ul>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => updateExpected(s)}>
                    Accept new result as expected
                  </button>
                </div>
              )}
              {openId === s.id && (
                <div className="history-detail">
                  <JsonView data={s.args} label="arguments" />
                  <JsonView data={s.expected} label="expected result" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

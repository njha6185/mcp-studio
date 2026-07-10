import { useMemo, useState } from "react";
import type { CallRecord, McpTool } from "../types";
import { getOpenAiTemplateUri } from "../widget/detect";
import SchemaForm from "./SchemaForm";
import JsonView from "./JsonView";
import ResultView from "./ResultView";
import InfoTip from "./InfoTip";
import * as api from "../api";

interface Props {
  sessionId: string;
  tool: McpTool;
  onHostEvent: (message: string) => void;
}

function defaultsFromSchema(tool: McpTool): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(tool.inputSchema?.properties ?? {})) {
    if (prop.default !== undefined) out[key] = prop.default;
  }
  return out;
}

function AnnotationChip({ label, value }: { label: string; value: boolean | undefined }) {
  const cls =
    value === true ? "chip chip-on" : value === false ? "chip chip-off" : "chip chip-unset";
  const mark = value === true ? "✓" : "✕";
  return (
    <span className={cls} title={value === undefined ? `${label}: not declared` : undefined}>
      {mark} {label}
    </span>
  );
}

interface MetaPair {
  key: string;
  value: string;
}

/** Best-effort typing: JSON if it parses, raw string otherwise. */
function parseMetaValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default function ToolDetail({ sessionId, tool, onHostEvent }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    defaultsFromSchema(tool)
  );
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [showSchema, setShowSchema] = useState(false);
  const [running, setRunning] = useState(false);
  const [metaPairs, setMetaPairs] = useState<MetaPair[]>([]);

  // Reset form + history when switching tools.
  const [lastTool, setLastTool] = useState(tool.name);
  if (lastTool !== tool.name) {
    setLastTool(tool.name);
    setValues(defaultsFromSchema(tool));
    setRecords([]);
    setShowSchema(false);
    setMetaPairs([]);
  }

  const templateUri = getOpenAiTemplateUri(tool);
  const missingRequired = useMemo(
    () => (tool.inputSchema?.required ?? []).filter((r) => values[r] === undefined),
    [tool, values]
  );

  async function run() {
    const record: CallRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      toolName: tool.name,
      args: values,
      result: null,
      startedAt: Date.now(),
    };
    setRecords((prev) => [record, ...prev].slice(0, 20));
    setRunning(true);
    try {
      const requestMeta: Record<string, unknown> = {};
      for (const p of metaPairs)
        if (p.key.trim()) requestMeta[p.key.trim()] = parseMetaValue(p.value);
      const result = await api.callTool(sessionId, tool.name, values, requestMeta);
      record.result = result;
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
    } finally {
      record.durationMs = Date.now() - record.startedAt;
      setRunning(false);
      setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...record } : r)));
    }
  }

  const latest = records[0];
  const annotations = tool.annotations ?? {};

  return (
    <div className="tool-detail">
      <div className="tool-header">
        <div>
          <h2>{tool.title ?? annotations.title ?? tool.name}</h2>
          <div className="tool-badges">
            <span className="badge badge-mono">{tool.name}</span>
            {tool.title && tool.title !== tool.name && (
              <span className="badge">title: {tool.title}</span>
            )}
            {templateUri && (
              <span className="badge badge-widget">
                ✦ UI widget
                <InfoTip text="This tool declares a UI template (like a ChatGPT app). After it runs, its result is rendered as an interactive widget in the Widget tab instead of plain JSON." />
              </span>
            )}
          </div>
          <div className="tool-badges">
            <AnnotationChip label="Read-only" value={annotations.readOnlyHint} />
            <AnnotationChip label="Destructive" value={annotations.destructiveHint} />
            <AnnotationChip label="Idempotent" value={annotations.idempotentHint} />
            <AnnotationChip label="Open-world" value={annotations.openWorldHint} />
            <InfoTip text="Behavior hints declared by the server: Read-only = doesn't modify anything; Destructive = may make irreversible changes; Idempotent = calling twice with the same arguments has no extra effect; Open-world = interacts with external systems. ✓ declared true, ✕ declared false, dashed = not declared." />
          </div>
          {tool.description && <p className="tool-desc">{tool.description}</p>}
          {templateUri && (
            <div className="tool-template-uri">
              template: <code>{templateUri}</code>
            </div>
          )}
        </div>
      </div>

      <section className="panel">
        <div className="panel-title">
          <span>
            Arguments
            <InfoTip text="This form is generated from the tool's input schema (the JSON Schema the server publishes). Fill it in and Run to send a tools/call request. Toggle 'Schema JSON' to see the raw schema." />
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSchema(!showSchema)}>
            {showSchema ? "Form view" : "Schema JSON"}
          </button>
        </div>
        {showSchema ? (
          <JsonView data={tool.inputSchema} label="inputSchema" />
        ) : (
          <SchemaForm schema={tool.inputSchema ?? {}} values={values} onChange={setValues} />
        )}
        <div className="meta-pairs">
          <div className="panel-title" style={{ marginTop: 16 }}>
            <span>
              Request metadata (_meta)
              <InfoTip text="Optional key/value pairs attached to the call as _meta — extra context for the server that isn't a tool argument (e.g. openai/locale). Values that parse as JSON are sent typed; anything else is sent as a string." />
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setMetaPairs([...metaPairs, { key: "", value: "" }])}
            >
              + Add pair
            </button>
          </div>
          {metaPairs.length === 0 && (
            <div className="empty-note">
              No metadata pairs — sent as <code>_meta</code> on tools/call.
            </div>
          )}
          {metaPairs.map((pair, i) => (
            <div key={i} className="meta-pair-row">
              <input
                className="input input-code"
                placeholder="key (e.g. openai/locale)"
                value={pair.key}
                onChange={(e) =>
                  setMetaPairs(metaPairs.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))
                }
              />
              <input
                className="input input-code"
                placeholder='value (JSON or string)'
                value={pair.value}
                onChange={(e) =>
                  setMetaPairs(metaPairs.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))
                }
              />
              <button
                className="btn btn-ghost btn-sm"
                title="Remove pair"
                onClick={() => setMetaPairs(metaPairs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="run-row">
          <button className="btn btn-primary" disabled={running} onClick={run}>
            {running ? "Running…" : "▶ Run tool"}
          </button>
          {missingRequired.length > 0 && (
            <span className="run-hint">
              missing required: {missingRequired.join(", ")}
            </span>
          )}
        </div>
      </section>

      {tool._meta && Object.keys(tool._meta).length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <span>
              Tool _meta
              <InfoTip text="Metadata the server attached to this tool's definition. Keys like openai/outputTemplate point to the HTML widget used to render results; others carry hints for hosts (invocation messages, capabilities, etc.)." />
            </span>
          </div>
          <JsonView data={tool._meta} label="_meta" />
        </section>
      )}

      {latest && (
        <section className="panel">
          <div className="panel-title">
            <span>
              Result
              <InfoTip text="The tools/call response. Widget = the interactive UI rendered from the tool's template or embedded ui:// resource; Content = the content blocks (text, images, resources) plus structuredContent; Raw = the exact JSON returned by the server." />
            </span>
            {records.length > 1 && (
              <span className="field-type">{records.length} calls this session</span>
            )}
          </div>
          <ResultView
            sessionId={sessionId}
            tool={tool}
            record={latest}
            onHostEvent={onHostEvent}
          />
        </section>
      )}
    </div>
  );
}

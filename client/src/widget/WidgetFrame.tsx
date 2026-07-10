import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToolCallResult } from "../types";
import type { WidgetSource } from "./detect";
import { decodeResourceText } from "./detect";
import { buildOpenAiWidgetDoc } from "./bridge";
import { useTheme } from "../theme";
import JsonView from "../components/JsonView";
import * as api from "../api";

export interface DevControls {
  enabled: boolean;
  path: string;
  error: string | null;
  onPathChange: (path: string) => void;
  onEnable: () => void;
  onDisable: () => void;
}

interface Props {
  sessionId: string;
  source: WidgetSource;
  templateHtml: string | null; // resolved HTML for openai-template sources
  toolInput: Record<string, unknown>;
  result: ToolCallResult;
  onHostEvent: (message: string) => void;
  dev?: DevControls;
}

interface BridgeEvent {
  id: number;
  dir: "in" | "out"; // in = widget → host, out = host → widget
  type: string;
  payload: unknown;
  ts: number;
}

type Preset = "inline" | "mobile" | "fullscreen";
type InspectorTab = "log" | "globals" | "mock" | "dev";

const SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
const MIN_HEIGHT = 220;
const MAX_HEIGHT = 4000;

let bridgeEventSeq = 0;

export default function WidgetFrame({
  sessionId,
  source,
  templateHtml,
  toolInput,
  result,
  onHostEvent,
  dev,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const [preset, setPreset] = useState<Preset>("inline");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("log");
  const [bridgeLog, setBridgeLog] = useState<BridgeEvent[]>([]);
  const [widgetState, setWidgetState] = useState<unknown>(null);
  const [mockText, setMockText] = useState<string | null>(null);
  const [mockError, setMockError] = useState<string | null>(null);
  const [mockOutput, setMockOutput] = useState<Record<string, unknown> | null>(null);
  const { theme } = useTheme();
  // Only the initial theme goes into the document; later changes are pushed
  // via set_globals so the iframe doesn't reload and lose widget state.
  const initialThemeRef = useRef(theme);

  const effectiveOutput = mockOutput ?? result.structuredContent ?? null;

  const logBridge = useCallback((dir: "in" | "out", type: string, payload: unknown) => {
    setBridgeLog((prev) =>
      [{ id: ++bridgeEventSeq, dir, type, payload, ts: Date.now() }, ...prev].slice(0, 200)
    );
  }, []);

  const srcDoc = useMemo(() => {
    if (source.kind === "openai-template") {
      if (!templateHtml) return null;
      return buildOpenAiWidgetDoc(templateHtml, {
        toolInput,
        toolOutput: effectiveOutput,
        toolResponseMetadata: result._meta ?? null,
        widgetState: null,
        displayMode: "inline",
        maxHeight: MAX_HEIGHT,
        theme: initialThemeRef.current,
        locale: navigator.language || "en",
      });
    }
    if (source.kind === "mcp-ui-html") return decodeResourceText(source.resource);
    return null;
  }, [source, templateHtml, toolInput, result, effectiveOutput]);

  const pushGlobals = useCallback(
    (globals: Record<string, unknown>) => {
      logBridge("out", "set_globals", globals);
      iframeRef.current?.contentWindow?.postMessage(
        { __mcpWidgetHost: true, type: "set_globals", payload: globals },
        "*"
      );
    },
    [logBridge]
  );

  useEffect(() => {
    if (theme === initialThemeRef.current) return;
    pushGlobals({ theme });
  }, [theme, pushGlobals]);

  const externalUrl =
    source.kind === "mcp-ui-url"
      ? decodeResourceText(source.resource).split(/\r?\n/).find((l) => l && !l.startsWith("#")) ?? null
      : null;

  const respond = useCallback(
    (id: string, ok: boolean, payload: unknown) => {
      logBridge("out", ok ? "response" : "response-error", payload);
      iframeRef.current?.contentWindow?.postMessage(
        ok
          ? { __mcpWidgetResponse: true, id, ok: true, result: payload }
          : { __mcpWidgetResponse: true, id, ok: false, error: String(payload) },
        "*"
      );
    },
    [logBridge]
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      // ---- OpenAI-style bridge messages ----
      if (data.__mcpWidget) {
        const { id, type, payload } = data as {
          id?: string;
          type: string;
          payload?: Record<string, unknown>;
        };
        if (type !== "resize") logBridge("in", type, payload);
        switch (type) {
          case "resize": {
            const h = Number(payload?.height);
            if (Number.isFinite(h) && h > 0)
              setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h + 4)));
            return;
          }
          case "callTool": {
            const name = String(payload?.name ?? "");
            const args = (payload?.args as Record<string, unknown>) ?? {};
            onHostEvent(`Widget called tool "${name}"`);
            api
              .callTool(sessionId, name, args)
              .then((res) => id && respond(id, true, res))
              .catch((err) => id && respond(id, false, err.message));
            return;
          }
          case "setWidgetState":
            setWidgetState(payload?.state ?? null);
            if (id) respond(id, true, { ok: true });
            return;
          case "sendFollowUpMessage":
            onHostEvent(
              `Widget follow-up message: ${JSON.stringify(payload?.prompt ?? payload)}`
            );
            if (id) respond(id, true, { ok: true });
            return;
          case "openExternal": {
            const href = String(payload?.href ?? "");
            if (/^https?:\/\//.test(href)) window.open(href, "_blank", "noopener");
            if (id) respond(id, true, { ok: true });
            return;
          }
          case "requestDisplayMode": {
            const mode = payload?.mode === "fullscreen" ? "fullscreen" : "inline";
            setPreset(mode === "fullscreen" ? "fullscreen" : "inline");
            pushGlobals({ displayMode: mode });
            if (id) respond(id, true, { mode });
            return;
          }
          default:
            if (id) respond(id, false, `Unsupported host call: ${type}`);
            return;
        }
      }

      // ---- MCP-UI messages ----
      if (typeof data.type === "string") {
        const messageId = (data as { messageId?: string }).messageId;
        if (data.type !== "ui-size-change") logBridge("in", data.type, data.payload);
        const reply = (payload: unknown) => {
          logBridge("out", "ui-message-response", payload);
          iframeRef.current?.contentWindow?.postMessage(
            { type: "ui-message-response", messageId, payload },
            "*"
          );
        };
        switch (data.type) {
          case "ui-size-change": {
            const h = Number(data.payload?.height);
            if (Number.isFinite(h) && h > 0)
              setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h + 4)));
            return;
          }
          case "tool": {
            const { toolName, params } = data.payload ?? {};
            onHostEvent(`Widget called tool "${toolName}"`);
            api
              .callTool(sessionId, String(toolName), params ?? {})
              .then((res) => reply({ response: res }))
              .catch((err) => reply({ error: err.message }));
            return;
          }
          case "link": {
            const url = String(data.payload?.url ?? "");
            if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener");
            return;
          }
          case "intent":
          case "prompt":
          case "notify":
            onHostEvent(`Widget ${data.type}: ${JSON.stringify(data.payload)}`);
            return;
          case "ui-lifecycle-iframe-ready": {
            const payload = {
              renderData: { toolInput, toolOutput: effectiveOutput },
            };
            logBridge("out", "ui-lifecycle-iframe-render-data", payload);
            iframeRef.current?.contentWindow?.postMessage(
              { type: "ui-lifecycle-iframe-render-data", payload },
              "*"
            );
            return;
          }
        }
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sessionId, respond, onHostEvent, toolInput, effectiveOutput, logBridge, pushGlobals]);

  if (source.kind === "openai-template" && !templateHtml) {
    return <div className="widget-loading">Loading widget template…</div>;
  }

  const fullscreen = preset === "fullscreen";

  const frame = externalUrl ? (
    <iframe
      ref={iframeRef}
      className="widget-iframe"
      title="Tool widget"
      src={externalUrl}
      sandbox={SANDBOX}
      style={{ height: fullscreen ? "100%" : height }}
    />
  ) : (
    <iframe
      ref={iframeRef}
      className="widget-iframe"
      title="Tool widget"
      srcDoc={srcDoc ?? ""}
      sandbox={SANDBOX}
      style={{ height: fullscreen ? "100%" : height }}
    />
  );

  function applyMock() {
    if (mockText === null) return;
    if (mockText.trim() === "") {
      setMockOutput(null);
      setMockError(null);
      return;
    }
    try {
      setMockOutput(JSON.parse(mockText));
      setMockError(null);
    } catch (err) {
      setMockError(err instanceof Error ? err.message : String(err));
    }
  }

  const toolbar = (
    <div className="widget-toolbar">
      <div className="widget-presets">
        {(
          [
            ["inline", "Inline"],
            ["mobile", "Mobile"],
            ["fullscreen", "Full"],
          ] as [Preset, string][]
        ).map(([p, label]) => (
          <button
            key={p}
            className={`widget-preset ${preset === p ? "active" : ""}`}
            onClick={() => setPreset(p)}
          >
            {label}
          </button>
        ))}
      </div>
      {mockOutput && <span className="badge badge-widget">mocked output</span>}
      {dev?.enabled && <span className="badge badge-widget">dev template</span>}
      <button
        className={`btn btn-ghost btn-sm ${inspectorOpen ? "active" : ""}`}
        onClick={() => setInspectorOpen(!inspectorOpen)}
      >
        Inspect
      </button>
    </div>
  );

  const inspector = inspectorOpen && (
    <div className="bridge-inspector">
      <div className="result-tabs">
        {(
          [
            ["log", `Bridge log ${bridgeLog.length ? `(${bridgeLog.length})` : ""}`],
            ["globals", "Globals"],
            ["mock", "Mock output"],
            ...(dev && source.kind === "openai-template"
              ? ([["dev", dev.enabled ? "Dev template ●" : "Dev template"]] as [
                  InspectorTab,
                  string,
                ][])
              : []),
          ] as [InspectorTab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            className={`result-tab ${inspectorTab === t ? "active" : ""}`}
            onClick={() => setInspectorTab(t)}
          >
            {label}
          </button>
        ))}
      </div>

      {inspectorTab === "log" && (
        <div className="bridge-log">
          {bridgeLog.length === 0 && (
            <div className="empty-note">
              No bridge traffic yet — interact with the widget. (resize events are
              not logged)
            </div>
          )}
          {bridgeLog.map((e) => (
            <details key={e.id} className="bridge-log-row">
              <summary>
                <span className={`bridge-dir ${e.dir}`}>
                  {e.dir === "in" ? "widget → host" : "host → widget"}
                </span>
                <span className="bridge-type">{e.type}</span>
                <span className="history-time">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
              </summary>
              <pre className="json-pre">{JSON.stringify(e.payload, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}

      {inspectorTab === "globals" && (
        <JsonView
          data={{
            toolInput,
            toolOutput: effectiveOutput,
            widgetState,
            theme,
            displayMode: fullscreen ? "fullscreen" : "inline",
          }}
          label="current widget globals"
        />
      )}

      {inspectorTab === "dev" && dev && (
        <div>
          <div className="field-desc" style={{ marginBottom: 8 }}>
            Load the widget template from a local HTML file instead of the server's
            resource. The widget re-renders automatically whenever the file is
            saved — edit-and-see without touching your server.
          </div>
          <div className="run-row">
            <input
              className="input input-code"
              placeholder="/absolute/path/to/widget.html"
              value={dev.path}
              disabled={dev.enabled}
              onChange={(e) => dev.onPathChange(e.target.value)}
            />
            {dev.enabled ? (
              <button className="btn btn-ghost btn-sm" onClick={dev.onDisable}>
                Stop
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                disabled={!dev.path.trim()}
                onClick={dev.onEnable}
              >
                Enable
              </button>
            )}
          </div>
          {dev.error && <div className="field-error">{dev.error}</div>}
        </div>
      )}

      {inspectorTab === "mock" && (
        <div>
          <div className="field-desc" style={{ marginBottom: 8 }}>
            Edit toolOutput (structuredContent) and re-render the widget without
            calling the tool. Empty + Apply restores the real output.
          </div>
          <textarea
            className={`input input-code ${mockError ? "input-error" : ""}`}
            rows={8}
            value={mockText ?? JSON.stringify(result.structuredContent ?? {}, null, 2)}
            onChange={(e) => setMockText(e.target.value)}
          />
          {mockError && <div className="field-error">{mockError}</div>}
          <div className="run-row">
            <button className="btn btn-primary btn-sm" onClick={applyMock}>
              Apply & re-render
            </button>
            {mockOutput && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setMockOutput(null);
                  setMockText(null);
                  setMockError(null);
                }}
              >
                Restore real output
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="widget-fullscreen-overlay">
        <div className="widget-fullscreen-bar">
          <span>Widget — fullscreen</span>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setPreset("inline");
              pushGlobals({ displayMode: "inline" });
            }}
          >
            ✕ Exit fullscreen
          </button>
        </div>
        {frame}
      </div>
    );
  }

  return (
    <div>
      {toolbar}
      <div className={`widget-frame-wrap ${preset === "mobile" ? "mobile" : ""}`}>
        {frame}
      </div>
      {inspector}
    </div>
  );
}

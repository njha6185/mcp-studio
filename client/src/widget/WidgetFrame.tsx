import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToolCallResult } from "../types";
import type { WidgetSource } from "./detect";
import { decodeResourceText } from "./detect";
import { buildOpenAiWidgetDoc } from "./bridge";
import { useTheme } from "../theme";
import * as api from "../api";

interface Props {
  sessionId: string;
  source: WidgetSource;
  templateHtml: string | null; // resolved HTML for openai-template sources
  toolInput: Record<string, unknown>;
  result: ToolCallResult;
  onHostEvent: (message: string) => void;
}

const SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
const MIN_HEIGHT = 220;
const MAX_HEIGHT = 4000;

export default function WidgetFrame({
  sessionId,
  source,
  templateHtml,
  toolInput,
  result,
  onHostEvent,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const [fullscreen, setFullscreen] = useState(false);
  const { theme } = useTheme();
  // Only the initial theme goes into the document; later changes are pushed
  // via set_globals so the iframe doesn't reload and lose widget state.
  const initialThemeRef = useRef(theme);

  const srcDoc = useMemo(() => {
    if (source.kind === "openai-template") {
      if (!templateHtml) return null;
      return buildOpenAiWidgetDoc(templateHtml, {
        toolInput,
        toolOutput: result.structuredContent ?? null,
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
  }, [source, templateHtml, toolInput, result]);

  useEffect(() => {
    if (theme === initialThemeRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(
      { __mcpWidgetHost: true, type: "set_globals", payload: { theme } },
      "*"
    );
  }, [theme]);

  const externalUrl =
    source.kind === "mcp-ui-url"
      ? decodeResourceText(source.resource).split(/\r?\n/).find((l) => l && !l.startsWith("#")) ?? null
      : null;

  const respond = useCallback((id: string, ok: boolean, payload: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(
      ok
        ? { __mcpWidgetResponse: true, id, ok: true, result: payload }
        : { __mcpWidgetResponse: true, id, ok: false, error: String(payload) },
      "*"
    );
  }, []);

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
            setFullscreen(mode === "fullscreen");
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
        const reply = (payload: unknown) =>
          iframeRef.current?.contentWindow?.postMessage(
            { type: "ui-message-response", messageId, payload },
            "*"
          );
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
          case "ui-lifecycle-iframe-ready":
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "ui-lifecycle-iframe-render-data",
                payload: { renderData: { toolInput, toolOutput: result.structuredContent ?? null } },
              },
              "*"
            );
            return;
        }
      }
    }

    function pushGlobals(globals: Record<string, unknown>) {
      iframeRef.current?.contentWindow?.postMessage(
        { __mcpWidgetHost: true, type: "set_globals", payload: globals },
        "*"
      );
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sessionId, respond, onHostEvent, toolInput, result]);

  if (source.kind === "openai-template" && !templateHtml) {
    return <div className="widget-loading">Loading widget template…</div>;
  }

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

  if (fullscreen) {
    return (
      <div className="widget-fullscreen-overlay">
        <div className="widget-fullscreen-bar">
          <span>Widget — fullscreen</span>
          <button className="btn btn-ghost" onClick={() => setFullscreen(false)}>
            ✕ Exit fullscreen
          </button>
        </div>
        {frame}
      </div>
    );
  }
  return <div className="widget-frame-wrap">{frame}</div>;
}

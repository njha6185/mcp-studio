import { useEffect, useState } from "react";
import type { CallRecord, McpTool } from "../types";
import { detectWidget, getOpenAiTemplateUri, decodeResourceText } from "../widget/detect";
import WidgetFrame from "../widget/WidgetFrame";
import JsonView from "./JsonView";
import * as api from "../api";

interface Props {
  sessionId: string;
  tool: McpTool;
  record: CallRecord;
  onHostEvent: (message: string) => void;
}

type Tab = "widget" | "content" | "raw";

export default function ResultView({ sessionId, tool, record, onHostEvent }: Props) {
  const result = record.result;
  const widget = result && !record.error ? detectWidget(tool, result) : null;
  const [tab, setTab] = useState<Tab>(widget ? "widget" : "content");
  const [templateHtml, setTemplateHtml] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // Resolve the OpenAI-style template resource (ui:// HTML) once per tool.
  const templateUri = getOpenAiTemplateUri(tool);
  const widgetKind = widget?.kind;
  useEffect(() => {
    if (!templateUri || widgetKind !== "openai-template") return;
    let cancelled = false;
    setTemplateHtml(null);
    setTemplateError(null);
    api
      .readResource(sessionId, templateUri)
      .then(({ contents }) => {
        if (cancelled) return;
        const html = contents?.[0] ? decodeResourceText(contents[0]) : "";
        if (html) setTemplateHtml(html);
        else setTemplateError(`Template resource ${templateUri} returned no HTML`);
      })
      .catch((err) => !cancelled && setTemplateError(err.message));
    return () => {
      cancelled = true;
    };
  }, [sessionId, templateUri, widgetKind, record.id]);

  const hasWidget = Boolean(widget);
  useEffect(() => {
    setTab(hasWidget ? "widget" : "content");
  }, [record.id, hasWidget]);

  if (record.error) {
    return <div className="result-error">⚠ {record.error}</div>;
  }
  if (!result) return <div className="empty-note">Running…</div>;

  return (
    <div className="result-view">
      <div className="result-tabs">
        {widget && (
          <button
            className={`result-tab ${tab === "widget" ? "active" : ""}`}
            onClick={() => setTab("widget")}
          >
            ✦ Widget
          </button>
        )}
        <button
          className={`result-tab ${tab === "content" ? "active" : ""}`}
          onClick={() => setTab("content")}
        >
          Content
        </button>
        <button
          className={`result-tab ${tab === "raw" ? "active" : ""}`}
          onClick={() => setTab("raw")}
        >
          Raw
        </button>
        <span className="result-meta">
          {result.isError ? (
            <span className="badge badge-error">tool error</span>
          ) : (
            <span className="badge badge-ok">ok</span>
          )}
          {record.durationMs !== undefined && <span>{record.durationMs} ms</span>}
        </span>
      </div>

      {tab === "widget" && widget && (
        <div className="result-widget">
          {templateError ? (
            <div className="result-error">⚠ {templateError}</div>
          ) : (
            <WidgetFrame
              key={record.id}
              sessionId={sessionId}
              source={widget}
              templateHtml={templateHtml}
              toolInput={record.args}
              result={result}
              onHostEvent={onHostEvent}
            />
          )}
        </div>
      )}

      {tab === "content" && (
        <div className="result-content">
          {(result.content ?? []).length === 0 && !result.structuredContent && (
            <div className="empty-note">No content returned.</div>
          )}
          {(result.content ?? []).map((block, i) => {
            if (block.type === "text")
              return (
                <pre key={i} className="content-text">
                  {block.text}
                </pre>
              );
            if (block.type === "image")
              return (
                <img
                  key={i}
                  className="content-image"
                  src={`data:${block.mimeType};base64,${block.data}`}
                  alt="tool result"
                />
              );
            if (block.type === "audio")
              return (
                <audio key={i} controls src={`data:${block.mimeType};base64,${block.data}`} />
              );
            if (block.type === "resource_link")
              return (
                <div key={i} className="content-resource">
                  <span className="badge">resource link</span> {block.uri}
                </div>
              );
            if (block.type === "resource")
              return (
                <div key={i} className="content-resource">
                  <div>
                    <span className="badge">embedded resource</span>{" "}
                    {block.resource.uri}{" "}
                    <span className="field-type">{block.resource.mimeType}</span>
                  </div>
                  {block.resource.text && (
                    <pre className="content-text">{block.resource.text.slice(0, 4000)}</pre>
                  )}
                </div>
              );
            return <JsonView key={i} data={block} />;
          })}
          {result.structuredContent && (
            <JsonView data={result.structuredContent} label="structuredContent" />
          )}
        </div>
      )}

      {tab === "raw" && <JsonView data={result} label="tools/call result" />}
    </div>
  );
}

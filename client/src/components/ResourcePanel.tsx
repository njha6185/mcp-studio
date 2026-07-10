import { useState } from "react";
import type { McpResource, McpResourceContents } from "../types";
import { decodeResourceText } from "../widget/detect";
import JsonView from "./JsonView";
import InfoTip from "./InfoTip";
import * as api from "../api";

interface Props {
  sessionId: string;
  resource: McpResource;
}

export default function ResourcePanel({ sessionId, resource }: Props) {
  const [contents, setContents] = useState<McpResourceContents[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.readResource(sessionId, resource.uri);
      setContents(res.contents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tool-detail">
      <div className="tool-header">
        <div>
          <h2>{resource.title ?? resource.name ?? resource.uri}</h2>
          <div className="tool-badges">
            <span className="badge badge-mono">{resource.uri}</span>
            {resource.mimeType && <span className="badge">{resource.mimeType}</span>}
          </div>
          {resource.description && <p className="tool-desc">{resource.description}</p>}
        </div>
      </div>

      <section className="panel">
        <div className="panel-title">
          <span>
            Contents
            <InfoTip text="Resources are read-only data the server exposes by URI (files, documents, templates…). Reading sends resources/read and shows what comes back — text, HTML (previewed in a sandbox), or binary." />
          </span>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={read}>
            {busy ? "Reading…" : contents ? "Re-read" : "Read resource"}
          </button>
        </div>
        {error && <div className="result-error">⚠ {error}</div>}
        {contents?.map((c, i) => {
          const text = decodeResourceText(c);
          const isHtml = c.mimeType === "text/html";
          return (
            <div key={i} className="resource-content">
              <div className="tool-badges">
                <span className="badge badge-mono">{c.uri}</span>
                {c.mimeType && <span className="badge">{c.mimeType}</span>}
              </div>
              {isHtml ? (
                <iframe
                  className="widget-iframe"
                  title={c.uri}
                  srcDoc={text}
                  sandbox="allow-scripts"
                  style={{ height: 420 }}
                />
              ) : text ? (
                <pre className="content-text">{text.slice(0, 20000)}</pre>
              ) : (
                <JsonView data={c} />
              )}
            </div>
          );
        })}
        {contents && contents.length === 0 && (
          <div className="empty-note">Resource returned no contents.</div>
        )}
      </section>
    </div>
  );
}

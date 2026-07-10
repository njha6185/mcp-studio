import { useMemo, useState } from "react";
import type { McpResourceContents, McpResourceTemplate } from "../types";
import { decodeResourceText } from "../widget/detect";
import JsonView from "./JsonView";
import InfoTip from "./InfoTip";
import * as api from "../api";

interface Props {
  sessionId: string;
  template: McpResourceTemplate;
}

/** Variable names from an RFC 6570 level-1 URI template, e.g. demo://{city}/weather */
function templateVariables(uriTemplate: string): string[] {
  const vars: string[] = [];
  for (const match of uriTemplate.matchAll(/\{([^}]+)\}/g)) {
    // strip operators/modifiers like {+path} or {id*}
    const name = match[1].replace(/^[+#./;?&]/, "").replace(/\*$/, "");
    if (!vars.includes(name)) vars.push(name);
  }
  return vars;
}

function expandTemplate(uriTemplate: string, values: Record<string, string>): string {
  return uriTemplate.replace(/\{([^}]+)\}/g, (_, expr: string) => {
    const name = expr.replace(/^[+#./;?&]/, "").replace(/\*$/, "");
    const raw = values[name] ?? "";
    // {+var} means no percent-encoding (reserved expansion)
    return expr.startsWith("+") ? raw : encodeURIComponent(raw);
  });
}

export default function ResourceTemplatePanel({ sessionId, template }: Props) {
  const vars = useMemo(() => templateVariables(template.uriTemplate), [template]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [contents, setContents] = useState<McpResourceContents[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const expandedUri = expandTemplate(template.uriTemplate, values);
  const missing = vars.filter((v) => !values[v]);

  async function read() {
    setBusy(true);
    setError(null);
    setContents(null);
    try {
      const res = await api.readResource(sessionId, expandedUri);
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
          <h2>{template.title ?? template.name ?? template.uriTemplate}</h2>
          <div className="tool-badges">
            <span className="badge badge-mono">{template.uriTemplate}</span>
            <span className="badge">template</span>
            {template.mimeType && <span className="badge">{template.mimeType}</span>}
          </div>
          {template.description && <p className="tool-desc">{template.description}</p>}
        </div>
      </div>

      <section className="panel">
        <div className="panel-title">
          <span>
            Template variables
            <InfoTip text="A resource template is a parameterized URI — each {variable} below is a placeholder. Fill them in to build a concrete URI, then read it like any resource." />
          </span>
        </div>
        {vars.length === 0 && (
          <div className="empty-note">This template has no variables.</div>
        )}
        {vars.map((v) => (
          <div key={v} className="field">
            <label className="field-label">
              <span className="field-name">{v}</span>
              <span className="field-required">required</span>
            </label>
            <input
              className="input"
              value={values[v] ?? ""}
              onChange={(e) => setValues({ ...values, [v]: e.target.value })}
            />
          </div>
        ))}
        <div className="tool-template-uri" style={{ marginBottom: 12 }}>
          resolved: <code>{expandedUri}</code>
        </div>
        <div className="run-row">
          <button className="btn btn-primary" disabled={busy || missing.length > 0} onClick={read}>
            {busy ? "Reading…" : "▶ Read resource"}
          </button>
          {missing.length > 0 && (
            <span className="run-hint">missing: {missing.join(", ")}</span>
          )}
        </div>
      </section>

      {(error || contents) && (
        <section className="panel">
          <div className="panel-title">
            <span>Contents</span>
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
      )}
    </div>
  );
}

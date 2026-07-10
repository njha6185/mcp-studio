import { useState } from "react";
import type { McpPrompt } from "../types";
import JsonView from "./JsonView";
import InfoTip from "./InfoTip";
import * as api from "../api";

interface Props {
  sessionId: string;
  prompt: McpPrompt;
}

export default function PromptPanel({ sessionId, prompt }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const args: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) if (v !== "") args[k] = v;
      setResult(await api.getPrompt(sessionId, prompt.name, args));
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
          <h2>{prompt.title ?? prompt.name}</h2>
          <div className="tool-badges">
            <span className="badge badge-mono">{prompt.name}</span>
          </div>
          {prompt.description && <p className="tool-desc">{prompt.description}</p>}
        </div>
      </div>

      <section className="panel">
        <div className="panel-title">
          <span>
            Arguments
            <InfoTip text="Prompts are reusable message templates the server offers. Fill the arguments and fetch to see the messages the server would hand to an LLM (prompts/get)." />
          </span>
        </div>
        {(prompt.arguments ?? []).length === 0 && (
          <div className="empty-note">This prompt takes no arguments.</div>
        )}
        {(prompt.arguments ?? []).map((arg) => (
          <div key={arg.name} className="field">
            <label className="field-label">
              <span className="field-name">{arg.name}</span>
              {arg.required && <span className="field-required">required</span>}
            </label>
            {arg.description && <div className="field-desc">{arg.description}</div>}
            <input
              className="input"
              value={values[arg.name] ?? ""}
              onChange={(e) => setValues({ ...values, [arg.name]: e.target.value })}
            />
          </div>
        ))}
        <div className="run-row">
          <button className="btn btn-primary" disabled={busy} onClick={run}>
            {busy ? "Fetching…" : "▶ Get prompt"}
          </button>
        </div>
        {error && <div className="result-error">⚠ {error}</div>}
        {result != null && <JsonView data={result} label="prompts/get result" />}
      </section>
    </div>
  );
}

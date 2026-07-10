import { useEffect, useState } from "react";
import type { OAuthEntryView, StudioSettings } from "../api";
import InfoTip from "./InfoTip";
import * as api from "../api";

interface Props {
  onClose: () => void;
}

export default function SettingsScreen({ onClose }: Props) {
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [oauthEntries, setOauthEntries] = useState<OAuthEntryView[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(false);

  const refresh = () => {
    api.getSettings().then((s) => {
      setSettings(s);
      setModel(s.chatModel);
    });
    api.listOAuthEntries().then((r) => setOauthEntries(r.entries));
  };
  useEffect(refresh, []);

  async function save() {
    await api.saveSettings({
      ...(apiKey ? { anthropicApiKey: apiKey } : {}),
      chatModel: model,
    });
    setApiKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    refresh();
  }

  async function clear(section: Parameters<typeof api.clearStore>[0]) {
    if (!window.confirm(`Clear ${section === "all" ? "ALL stored data" : section}?`)) return;
    await api.clearStore(section);
    refresh();
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ← Back
        </button>
        <h2>Settings</h2>
        <span />
      </div>

      <div className="screen-body screen-body-narrow">
        <section className="panel">
          <div className="panel-title">
            <span>
              Chat simulator
              <InfoTip text="The Chat screen uses the Anthropic API so a real Claude model can drive your MCP tools. The key is stored in the proxy's local JSON file, never sent anywhere except api.anthropic.com." />
            </span>
          </div>
          <div className="field">
            <label className="field-label">
              <span className="field-name">Anthropic API key</span>
              {settings?.hasApiKey && (
                <span className="badge badge-ok">set · {settings.apiKeyPreview}</span>
              )}
            </label>
            <input
              className="input input-code"
              type="password"
              placeholder={settings?.hasApiKey ? "•••••• (enter to replace)" : "sk-ant-…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">
              <span className="field-name">Model</span>
            </label>
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              {["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="run-row">
            <button className="btn btn-primary btn-sm" onClick={save}>
              {saved ? "Saved ✓" : "Save"}
            </button>
            {settings?.hasApiKey && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => api.saveSettings({ anthropicApiKey: "" }).then(refresh)}
              >
                Remove key
              </button>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <span>
              OAuth credentials
              <InfoTip text="Tokens and client registrations cached from OAuth sign-ins, keyed by server URL. Forget one to force a fresh authorization on the next connect." />
            </span>
            {oauthEntries.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => clear("oauth")}>
                Forget all
              </button>
            )}
          </div>
          {oauthEntries.length === 0 && (
            <div className="empty-note">No OAuth credentials stored.</div>
          )}
          {oauthEntries.map((e) => (
            <div key={e.serverUrl} className="oauth-row">
              <span className="recent-target">{e.serverUrl}</span>
              {e.hasTokens && (
                <span className="badge badge-ok">token {e.tokenPreview}</span>
              )}
              {e.registered && <span className="badge">registered</span>}
              {e.savedAt && (
                <span className="field-type">{new Date(e.savedAt).toLocaleString()}</span>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => api.forgetOAuth(e.serverUrl).then(refresh)}
              >
                Forget
              </button>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-title">
            <span>
              Stored data
              <InfoTip text="Everything is kept in one local JSON file — no database. Clearing a section takes effect immediately." />
            </span>
          </div>
          {settings && (
            <div className="field-desc" style={{ marginBottom: 12 }}>
              File: <code>{settings.storePath}</code>
            </div>
          )}
          <div className="run-row" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => clear("savedServers")}>
              Clear saved servers
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => clear("snapshots")}>
              Clear snapshots
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => clear("settings")}>
              Clear settings
            </button>
            <button className="btn btn-ghost btn-sm danger" onClick={() => clear("all")}>
              Clear everything
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

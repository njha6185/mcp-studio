import { useEffect, useId, useState } from "react";
import type { LlmProviderView, OAuthEntryView, StudioSettings } from "../api";
import InfoTip from "./InfoTip";
import * as api from "../api";

interface Props {
  onClose: () => void;
}

/** Well-known providers; "openai" kind covers every OpenAI-compatible API. */
const PRESETS = [
  { label: "Anthropic", kind: "anthropic" as const, baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  { label: "OpenAI", kind: "openai" as const, baseUrl: "https://api.openai.com/v1", needsKey: true },
  { label: "OpenRouter", kind: "openai" as const, baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  { label: "Groq", kind: "openai" as const, baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  { label: "Mistral", kind: "openai" as const, baseUrl: "https://api.mistral.ai/v1", needsKey: true },
  { label: "Ollama (local)", kind: "openai" as const, baseUrl: "http://localhost:11434/v1", needsKey: false },
  { label: "Custom (OpenAI-compatible)", kind: "openai" as const, baseUrl: "", needsKey: false },
];

export default function SettingsScreen({ onClose }: Props) {
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [oauthEntries, setOauthEntries] = useState<OAuthEntryView[]>([]);
  const modelListId = useId();

  // add-provider form
  const [presetIdx, setPresetIdx] = useState(0);
  const [baseUrl, setBaseUrl] = useState(PRESETS[0].baseUrl);
  const [providerName, setProviderName] = useState(PRESETS[0].label);
  const [apiKey, setApiKey] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // active selection
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = () => {
    api.getSettings().then((s) => {
      setSettings(s);
      setModel(s.chatModel ?? "");
    });
    api.listOAuthEntries().then((r) => setOauthEntries(r.entries));
  };
  useEffect(refresh, []);

  const activeId = settings?.activeProviderId ?? null;

  // Fetch models whenever the active provider changes.
  useEffect(() => {
    setModels([]);
    setModelsError(null);
    if (!activeId) return;
    api
      .listProviderModels(activeId)
      .then((r) => setModels(r.models))
      .catch((err) => setModelsError(err.message));
  }, [activeId]);

  function pickPreset(idx: number) {
    setPresetIdx(idx);
    setBaseUrl(PRESETS[idx].baseUrl);
    setProviderName(PRESETS[idx].label.replace(/ \(.*\)$/, ""));
  }

  async function addProvider() {
    setAddError(null);
    try {
      await api.saveProvider({
        name: providerName.trim() || undefined,
        kind: PRESETS[presetIdx].kind,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey || undefined,
      });
      setApiKey("");
      refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    }
  }

  async function activate(providerId: string) {
    await api.setActiveLlm(providerId);
    refresh();
  }

  async function saveModel() {
    await api.setActiveLlm(undefined, model.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    refresh();
  }

  async function clear(section: Parameters<typeof api.clearStore>[0]) {
    if (!window.confirm(`Clear ${section === "all" ? "ALL stored data" : section}?`)) return;
    await api.clearStore(section);
    refresh();
  }

  function providerRow(p: LlmProviderView) {
    const isActive = p.id === activeId;
    return (
      <div key={p.id} className="oauth-row">
        <input
          type="radio"
          name="active-provider"
          title="Use this provider for the chat simulator"
          checked={isActive}
          onChange={() => activate(p.id)}
        />
        <span className="recent-target">
          <b>{p.name}</b> · {p.baseUrl}
        </span>
        <span className="badge">{p.kind}</span>
        {p.hasKey ? (
          <span className="badge badge-ok">key {p.keyPreview}</span>
        ) : (
          <span className="badge">no key</span>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => api.deleteProvider(p.id).then(refresh)}
        >
          ✕
        </button>
      </div>
    );
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
              Account token
              <InfoTip text="Your mcps_ token is the key to everything saved here — servers, snapshots, chats, API keys. Use it in another browser or device to open the same account. If you lose it, the data can't be recovered." />
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const token = api.authToken();
                if (token) navigator.clipboard.writeText(token);
              }}
            >
              Copy token
            </button>
          </div>
          <div className="field-desc">
            <code>{api.authToken()?.slice(0, 12) ?? "none"}…</code> — keep it
            somewhere safe; it's this account's only key.
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <span>
              LLM providers
              <InfoTip text="The Chat simulator can use any provider. 'anthropic' speaks the Anthropic Messages API; 'openai' speaks the OpenAI-compatible API used by OpenAI, OpenRouter, Groq, Mistral, Ollama, LM Studio, and most others. Models are fetched live from the provider. Keys are stored only in the local JSON file." />
            </span>
          </div>

          {(settings?.providers ?? []).length === 0 && (
            <div className="empty-note">No providers yet — add one below.</div>
          )}
          {(settings?.providers ?? []).map(providerRow)}

          {activeId && (
            <div className="run-row" style={{ marginTop: 14 }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">
                  <span className="field-name">Model</span>
                  {modelsError ? (
                    <span className="field-error" style={{ margin: 0 }}>
                      couldn't list models: {modelsError}
                    </span>
                  ) : (
                    <span className="field-type">
                      {models.length
                        ? `${models.length} available — type to search`
                        : "loading…"}
                    </span>
                  )}
                </label>
                <input
                  className="input input-code"
                  list={modelListId}
                  placeholder="pick or type a model id"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
                <datalist id={modelListId}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name && m.name !== m.id ? m.name : undefined}
                    </option>
                  ))}
                </datalist>
              </div>
              <button
                className="btn btn-primary btn-sm"
                disabled={!model.trim()}
                onClick={saveModel}
                style={{ alignSelf: "flex-end" }}
              >
                {saved ? "Saved ✓" : "Use this model"}
              </button>
            </div>
          )}

          <div className="add-provider">
            <div className="panel-title" style={{ marginTop: 18 }}>
              <span>Add provider</span>
            </div>
            <div className="run-row" style={{ flexWrap: "wrap" }}>
              {PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  className={`widget-preset ${presetIdx === i ? "active" : ""}`}
                  onClick={() => pickPreset(i)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label">
                <span className="field-name">Base URL</span>
              </label>
              <input
                className="input input-code"
                placeholder="https://api.example.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">
                <span className="field-name">API key</span>
                {!PRESETS[presetIdx].needsKey && (
                  <span className="field-type">optional for this provider</span>
                )}
              </label>
              <input
                className="input input-code"
                type="password"
                placeholder="sk-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">
                <span className="field-name">Display name</span>
              </label>
              <input
                className="input"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
              />
            </div>
            {addError && <div className="field-error">{addError}</div>}
            <button
              className="btn btn-primary btn-sm"
              disabled={!baseUrl.trim()}
              onClick={addProvider}
            >
              Add provider
            </button>
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
            <button className="btn btn-ghost btn-sm" onClick={() => clear("conversations")}>
              Clear chats
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => clear("settings")}>
              Clear providers & settings
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

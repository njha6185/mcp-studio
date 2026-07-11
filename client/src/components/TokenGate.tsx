import { useEffect, useState } from "react";
import * as api from "../api";

interface Props {
  onUnlocked: () => void;
}

/**
 * Shown when no valid token is present in this browser. The token is an
 * ACCOUNT KEY: generate a new one (fresh, isolated data space) or paste an
 * existing one to open that account — e.g. the same account from another
 * device. Cached in localStorage; losing the token orphans its data.
 */
export default function TokenGate({ onUnlocked }: Props) {
  const [canGenerate, setCanGenerate] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setCanGenerate(s.canGenerate))
      .catch(() => setCanGenerate(false)); // fall back to paste-only
  }, []);

  function finish(value: string) {
    api.saveAuthToken(value);
    // Reflect the token in the URL, then land on the home screen.
    const url = new URL(window.location.href);
    url.searchParams.set("token", value);
    window.history.replaceState(null, "", url.toString());
    onUnlocked();
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      finish(await api.generateToken());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const candidate = token.trim();
    if (!candidate) return;
    setBusy(true);
    setError(null);
    try {
      if (await api.verifyToken(candidate)) finish(candidate);
      else setError("That token was rejected — check it and try again.");
    } catch {
      setError("Could not reach the proxy — is MCP Widget Studio still running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect-screen">
      <div className="connect-card token-gate">
        <div className="connect-logo">◈</div>
        <h1>Welcome to MCP Widget Studio</h1>
        <p className="connect-sub">
          Your data here (saved servers, snapshots, chats, API keys) lives under
          a personal <code>mcps_…</code> token — it works like an account key.
          Generate a new one, or paste an existing token to open that account.
          <b> Save your token somewhere safe: token gone, data gone.</b>
        </p>

        {canGenerate !== false && (
          <button
            className="btn btn-primary btn-lg"
            disabled={busy || canGenerate === null}
            onClick={generate}
          >
            {busy ? "Working…" : "🔑 Generate new token & continue"}
          </button>
        )}

        <div className="token-divider">
          {canGenerate === false
            ? "This instance uses a fixed token — paste it below"
            : "or use an existing token"}
        </div>

        <div className="field">
          <input
            className="input input-code"
            placeholder="mcps_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        {error && <div className="connect-error">{error}</div>}
        <button
          className="btn btn-ghost"
          style={{ width: "100%" }}
          disabled={busy || !token.trim()}
          onClick={submit}
        >
          Use this token
        </button>
      </div>
    </div>
  );
}

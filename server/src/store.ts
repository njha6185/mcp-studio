import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tiny JSON-file persistence for the proxy. Everything the app wants to keep
 * across restarts lives in one human-readable file with a debounced writer.
 */

export interface SavedServer {
  id: string;
  name: string;
  params: Record<string, unknown>;
  createdAt: number;
}

export interface OAuthEntry {
  clientInformation?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  codeVerifier?: string;
  savedAt?: number;
}

export interface Snapshot {
  id: string;
  name: string;
  serverName?: string;
  toolName: string;
  args: Record<string, unknown>;
  meta?: Record<string, unknown>;
  expected: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface StoreData {
  savedServers: SavedServer[];
  oauth: Record<string, OAuthEntry>;
  snapshots: Snapshot[];
  settings: {
    anthropicApiKey?: string;
    chatModel?: string;
  };
}

const DEFAULTS: StoreData = {
  savedServers: [],
  oauth: {},
  snapshots: [],
  settings: {},
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORE_PATH =
  process.env.STORE_PATH ?? path.join(dirname, "..", "data", "mcp-studio-store.json");

function load(): StoreData {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return { ...DEFAULTS, ...raw, settings: { ...DEFAULTS.settings, ...raw.settings } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const store: StoreData = load();

let saveTimer: NodeJS.Timeout | null = null;

export function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
    } catch (err) {
      console.error("Failed to persist store:", err);
    }
  }, 250);
}

export function clearSection(section: "savedServers" | "oauth" | "snapshots" | "settings" | "all") {
  if (section === "all") {
    store.savedServers = [];
    store.oauth = {};
    store.snapshots = [];
    store.settings = {};
  } else if (section === "savedServers") store.savedServers = [];
  else if (section === "oauth") store.oauth = {};
  else if (section === "snapshots") store.snapshots = [];
  else store.settings = {};
  persist();
}

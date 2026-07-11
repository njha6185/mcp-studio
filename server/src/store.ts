import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Multi-tenant JSON-file persistence. The session token acts as an account:
 * each token maps (via hash) to its own isolated StoreData — saved servers,
 * snapshots, conversations, LLM providers, OAuth credentials. Token gone,
 * data gone. Everything still lives in one human-readable file.
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

export interface ChatConversation {
  id: string;
  title: string;
  messages: unknown[];
  toolRuns: Record<string, unknown>;
  usage?: { input: number; output: number };
  createdAt: number;
  updatedAt: number;
}

export interface LlmProvider {
  id: string;
  name: string;
  kind: "anthropic" | "openai";
  baseUrl: string;
  apiKey?: string;
}

export interface StoreData {
  savedServers: SavedServer[];
  oauth: Record<string, OAuthEntry>;
  snapshots: Snapshot[];
  conversations: ChatConversation[];
  settings: {
    /** @deprecated migrated into providers[] on load */
    anthropicApiKey?: string;
    chatModel?: string;
    providers?: LlmProvider[];
    activeProviderId?: string;
  };
}

interface FileData {
  tenants: Record<string, StoreData>;
}

const DEFAULTS: StoreData = {
  savedServers: [],
  oauth: {},
  snapshots: [],
  conversations: [],
  settings: {},
};

export function emptyTenant(): StoreData {
  return structuredClone(DEFAULTS);
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORE_PATH =
  process.env.STORE_PATH ?? path.join(dirname, "..", "data", "mcp-studio-store.json");

/** Tenant id: hash of the token so the secret itself isn't used as a key. */
export function tenantIdFor(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export const DEFAULT_TENANT = "default";

function load(): FileData {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    // Legacy single-tenant format → becomes the "default" tenant.
    if (raw && !raw.tenants) {
      return { tenants: { [DEFAULT_TENANT]: { ...emptyTenant(), ...raw } } };
    }
    return { tenants: raw.tenants ?? {} };
  } catch {
    return { tenants: {} };
  }
}

const data: FileData = load();

export function getTenant(id: string): StoreData {
  let tenant = data.tenants[id];
  if (!tenant) {
    tenant = emptyTenant();
    data.tenants[id] = tenant;
  }
  // Backfill any fields added since the tenant was written.
  const record = tenant as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof StoreData)[]) {
    if (record[key] === undefined) record[key] = structuredClone(DEFAULTS[key]);
  }
  return tenant;
}

export function tenantExists(id: string): boolean {
  return Boolean(data.tenants[id]);
}

export function tenantCount(): number {
  return Object.keys(data.tenants).length;
}

/**
 * One-time adoption: the first account generated on an instance inherits the
 * legacy "default" tenant's data (pre-multi-tenant installs), so nobody loses
 * their saved servers after upgrading.
 */
export function adoptDefaultTenant(newId: string): boolean {
  const legacy = data.tenants[DEFAULT_TENANT];
  const others = Object.keys(data.tenants).filter((k) => k !== DEFAULT_TENANT);
  if (!legacy || others.length > 0) return false;
  data.tenants[newId] = legacy;
  delete data.tenants[DEFAULT_TENANT];
  persist();
  return true;
}

let saveTimer: NodeJS.Timeout | null = null;

export function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("Failed to persist store:", err);
    }
  }, 250);
}

export function clearSection(
  tenant: StoreData,
  section:
    | "savedServers"
    | "oauth"
    | "snapshots"
    | "conversations"
    | "settings"
    | "all"
) {
  if (section === "all") {
    Object.assign(tenant, emptyTenant());
  } else if (section === "savedServers") tenant.savedServers = [];
  else if (section === "oauth") tenant.oauth = {};
  else if (section === "snapshots") tenant.snapshots = [];
  else if (section === "conversations") tenant.conversations = [];
  else tenant.settings = {};
  persist();
}

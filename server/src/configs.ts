import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Parse the common MCP client config formats (Claude Desktop, .mcp.json,
 * Cursor, VS Code-style "servers") into MCP Widget Studio connect params.
 */

export interface ImportedServer {
  name: string;
  params: {
    type: "stdio" | "sse" | "streamable-http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
}

export function normalizeEntry(name: string, entry: Record<string, unknown>): ImportedServer | null {
  if (typeof entry !== "object" || entry === null) return null;
  const url = typeof entry.url === "string" ? entry.url : undefined;
  const command = typeof entry.command === "string" ? entry.command : undefined;
  const declared = typeof entry.type === "string" ? entry.type : undefined;
  if (url) {
    const type = declared === "sse" ? "sse" : "streamable-http";
    return {
      name,
      params: {
        type,
        url,
        headers: (entry.headers as Record<string, string>) ?? undefined,
      },
    };
  }
  if (command) {
    return {
      name,
      params: {
        type: "stdio",
        command,
        args: Array.isArray(entry.args) ? entry.args.map(String) : [],
        env: (entry.env as Record<string, string>) ?? undefined,
      },
    };
  }
  return null;
}

export function parseConfigJson(json: unknown): ImportedServer[] {
  if (typeof json !== "object" || json === null) return [];
  const root = json as Record<string, unknown>;
  // claude_desktop_config.json / .mcp.json / .cursor/mcp.json → mcpServers
  // VS Code style → servers
  const map = (root.mcpServers ?? root.servers ?? root) as Record<string, unknown>;
  if (typeof map !== "object" || map === null) return [];
  const out: ImportedServer[] = [];
  for (const [name, entry] of Object.entries(map)) {
    const normalized = normalizeEntry(name, entry as Record<string, unknown>);
    if (normalized) out.push(normalized);
  }
  return out;
}

const CANDIDATE_PATHS = [
  path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json"),
  path.join(process.cwd(), ".mcp.json"),
  path.join(os.homedir(), ".mcp.json"),
  path.join(os.homedir(), ".cursor", "mcp.json"),
  path.join(os.homedir(), ".claude.json"),
];

export function detectConfigs(): { path: string; servers: ImportedServer[] }[] {
  const results: { path: string; servers: ImportedServer[] }[] = [];
  for (const p of CANDIDATE_PATHS) {
    try {
      if (!fs.existsSync(p)) continue;
      const json = JSON.parse(fs.readFileSync(p, "utf8"));
      const servers = parseConfigJson(json);
      if (servers.length) results.push({ path: p, servers });
    } catch {
      /* unreadable or invalid — skip */
    }
  }
  return results;
}

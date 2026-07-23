export type TransportType = "streamable-http" | "sse" | "stdio";

export interface ConnectParams {
  type: TransportType;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  /** Skip TLS cert verification for this connection (local dev / self-signed). */
  insecureTls?: boolean;
}

export interface ServerInfo {
  name?: string;
  version?: string;
  title?: string;
}

export interface SessionInfo {
  sessionId: string;
  serverInfo: ServerInfo | null;
  capabilities: Record<string, unknown> | null;
}

export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  [key: string]: unknown;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  _meta?: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}

export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
}

export interface McpPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface EmbeddedResourceContent {
  type: "resource";
  resource: McpResourceContents;
  _meta?: Record<string, unknown>;
}

export type ContentBlock =
  | { type: "text"; text: string; _meta?: Record<string, unknown> }
  | { type: "image"; data: string; mimeType: string; _meta?: Record<string, unknown> }
  | { type: "audio"; data: string; mimeType: string; _meta?: Record<string, unknown> }
  | {
      type: "resource_link";
      uri: string;
      name?: string;
      description?: string;
      mimeType?: string;
      _meta?: Record<string, unknown>;
    }
  | EmbeddedResourceContent;

export interface ToolCallResult {
  content?: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  error?: string;
}

export interface CallRecord {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolCallResult | null;
  error?: string;
  startedAt: number;
  durationMs?: number;
}

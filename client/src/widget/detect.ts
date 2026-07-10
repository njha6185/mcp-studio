import type { ContentBlock, EmbeddedResourceContent, McpTool, ToolCallResult } from "../types";

export type WidgetSource =
  | { kind: "openai-template"; templateUri: string }
  | { kind: "mcp-ui-html"; resource: EmbeddedResourceContent["resource"] }
  | { kind: "mcp-ui-url"; resource: EmbeddedResourceContent["resource"] };

/** OpenAI Apps SDK convention: the tool declares an HTML template resource in _meta. */
export function getOpenAiTemplateUri(tool: McpTool | undefined): string | null {
  const uri = tool?._meta?.["openai/outputTemplate"];
  return typeof uri === "string" ? uri : null;
}

/** MCP-UI convention: the result carries an embedded resource with a ui:// URI. */
export function getMcpUiResource(
  result: ToolCallResult | null
): WidgetSource | null {
  for (const block of result?.content ?? []) {
    if (block.type !== "resource") continue;
    const res = (block as EmbeddedResourceContent).resource;
    if (!res?.uri?.startsWith("ui://")) continue;
    if (res.mimeType === "text/uri-list") return { kind: "mcp-ui-url", resource: res };
    if (res.mimeType === "text/html" || res.text || res.blob)
      return { kind: "mcp-ui-html", resource: res };
  }
  return null;
}

export function detectWidget(
  tool: McpTool | undefined,
  result: ToolCallResult | null
): WidgetSource | null {
  const templateUri = getOpenAiTemplateUri(tool);
  if (templateUri) return { kind: "openai-template", templateUri };
  return getMcpUiResource(result);
}

export function decodeResourceText(res: {
  text?: string;
  blob?: string;
}): string {
  if (res.text) return res.text;
  if (res.blob) {
    try {
      return atob(res.blob);
    } catch {
      return "";
    }
  }
  return "";
}

export function firstTextBlock(content: ContentBlock[] | undefined): string | null {
  const block = content?.find((c) => c.type === "text");
  return block && block.type === "text" ? block.text : null;
}

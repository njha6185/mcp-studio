import { useEffect, useState } from "react";
import type { McpTool, ToolCallResult } from "../types";
import { detectWidget, getOpenAiTemplateUri, decodeResourceText } from "../widget/detect";
import WidgetFrame from "../widget/WidgetFrame";
import * as api from "../api";

interface Props {
  sessionId: string;
  tool: McpTool;
  args: Record<string, unknown>;
  result: ToolCallResult;
  onHostEvent: (message: string) => void;
}

/** Renders a tool result's widget inside the chat transcript. */
export default function ChatToolWidget({ sessionId, tool, args, result, onHostEvent }: Props) {
  const widget = detectWidget(tool, result);
  const templateUri = getOpenAiTemplateUri(tool);
  const [templateHtml, setTemplateHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!templateUri || widget?.kind !== "openai-template") return;
    let cancelled = false;
    api
      .readResource(sessionId, templateUri)
      .then(({ contents }) => {
        if (cancelled) return;
        const html = contents?.[0] ? decodeResourceText(contents[0]) : "";
        if (html) setTemplateHtml(html);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, templateUri, widget?.kind]);

  if (!widget) return null;
  return (
    <WidgetFrame
      sessionId={sessionId}
      source={widget}
      templateHtml={templateHtml}
      toolInput={args}
      result={result}
      onHostEvent={onHostEvent}
    />
  );
}

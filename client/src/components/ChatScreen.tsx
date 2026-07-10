import { useEffect, useRef, useState } from "react";
import type { McpTool, ToolCallResult } from "../types";
import type { AnthropicContentBlock, AnthropicMessage } from "../api";
import ChatToolWidget from "./ChatToolWidget";
import JsonView from "./JsonView";
import InfoTip from "./InfoTip";
import * as api from "../api";

export interface ChatSession {
  sessionId: string;
  serverName: string;
}

interface Props {
  sessions: ChatSession[];
  onClose: () => void;
  onHostEvent: (message: string) => void;
}

interface ToolRun {
  toolName: string;
  serverName: string;
  sessionId: string;
  args: Record<string, unknown>;
  result?: ToolCallResult;
  error?: string;
}

/** A tool exposed to the model, mapped back to its owning server. */
interface RoutedTool {
  exposedName: string;
  tool: McpTool;
  sessionId: string;
  serverName: string;
}

const MAX_TOOL_ROUNDS = 10;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "server"
  );
}

/** Namespace tools as <server>__<tool> when several servers are connected. */
function buildRoutedTools(
  perSession: { session: ChatSession; tools: McpTool[] }[]
): RoutedTool[] {
  const multi = perSession.length > 1;
  const usedSlugs = new Map<string, number>();
  const routed: RoutedTool[] = [];
  for (const { session, tools } of perSession) {
    let slug = slugify(session.serverName);
    const seen = usedSlugs.get(slug) ?? 0;
    usedSlugs.set(slug, seen + 1);
    if (seen > 0) slug = `${slug}-${seen + 1}`;
    for (const tool of tools) {
      routed.push({
        exposedName: multi ? `${slug}__${tool.name}`.slice(0, 128) : tool.name,
        tool,
        sessionId: session.sessionId,
        serverName: session.serverName,
      });
    }
  }
  return routed;
}

function toolResultText(result: ToolCallResult): string {
  const text = (result.content ?? [])
    .map((b) => (b.type === "text" ? b.text : `[${b.type}]`))
    .join("\n");
  const structured = result.structuredContent
    ? `\nstructuredContent: ${JSON.stringify(result.structuredContent)}`
    : "";
  return (text + structured).slice(0, 8000) || "(empty result)";
}

export default function ChatScreen({ sessions, onClose, onHostEvent }: Props) {
  const [messages, setMessages] = useState<AnthropicMessage[]>([]);
  const [toolRuns, setToolRuns] = useState<Record<string, ToolRun>>({});
  const [routedTools, setRoutedTools] = useState<RoutedTool[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [llm, setLlm] = useState<{ name: string; model: string | null } | null | undefined>(
    undefined
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) =>
        setLlm(s.activeProvider ? { name: s.activeProvider.name, model: s.activeProvider.model } : null)
      );
  }, []);
  const llmReady = Boolean(llm && llm.model);

  // Aggregate tools from every connected server.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      sessions.map(async (session) => ({
        session,
        tools: await api
          .listTools(session.sessionId)
          .then((r) => r.tools ?? [])
          .catch(() => [] as McpTool[]),
      }))
    ).then((perSession) => {
      if (!cancelled) setRoutedTools(buildRoutedTools(perSession));
    });
    return () => {
      cancelled = true;
    };
  }, [sessions.map((s) => s.sessionId).join(",")]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy || sessions.length === 0) return;
    setInput("");
    setError(null);
    setBusy(true);

    const anthropicTools = routedTools.map((rt) => ({
      name: rt.exposedName,
      description:
        (sessions.length > 1 ? `[server: ${rt.serverName}] ` : "") +
        (rt.tool.description ?? ""),
      input_schema: rt.tool.inputSchema ?? { type: "object" },
    }));

    const transcript: AnthropicMessage[] = [
      ...messages,
      { role: "user", content: [{ type: "text", text }] },
    ];
    setMessages(transcript);

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const resp = await api.chat(
          sessions[0].sessionId,
          transcript,
          undefined,
          anthropicTools
        );
        setUsage((u) => ({
          input: u.input + (resp.usage?.input_tokens ?? 0),
          output: u.output + (resp.usage?.output_tokens ?? 0),
        }));
        transcript.push({ role: "assistant", content: resp.content });
        setMessages([...transcript]);

        const toolUses = resp.content.filter((b) => b.type === "tool_use");
        if (resp.stop_reason !== "tool_use" || toolUses.length === 0) break;

        const resultBlocks: AnthropicContentBlock[] = [];
        for (const block of toolUses) {
          const id = block.id as string;
          const exposedName = String(block.name);
          const routed = routedTools.find((rt) => rt.exposedName === exposedName);
          const args = (block.input as Record<string, unknown>) ?? {};

          if (!routed) {
            resultBlocks.push({
              type: "tool_result",
              tool_use_id: id,
              content: `Unknown tool: ${exposedName}`,
              is_error: true,
            });
            continue;
          }

          setToolRuns((prev) => ({
            ...prev,
            [id]: {
              toolName: routed.tool.name,
              serverName: routed.serverName,
              sessionId: routed.sessionId,
              args,
            },
          }));
          onHostEvent(
            `Chat model called "${routed.tool.name}" on ${routed.serverName}`
          );
          try {
            const result = await api.callTool(routed.sessionId, routed.tool.name, args);
            setToolRuns((prev) => ({ ...prev, [id]: { ...prev[id], result } }));
            resultBlocks.push({
              type: "tool_result",
              tool_use_id: id,
              content: toolResultText(result),
              ...(result.isError ? { is_error: true } : {}),
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setToolRuns((prev) => ({ ...prev, [id]: { ...prev[id], error: message } }));
            resultBlocks.push({
              type: "tool_result",
              tool_use_id: id,
              content: `Tool call failed: ${message}`,
              is_error: true,
            });
          }
        }
        transcript.push({ role: "user", content: resultBlocks });
        setMessages([...transcript]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function renderAssistantBlock(block: AnthropicContentBlock, key: number) {
    if (block.type === "text") {
      return (
        <div key={key} className="chat-bubble assistant">
          {block.text}
        </div>
      );
    }
    if (block.type === "tool_use") {
      const id = block.id as string;
      const run = toolRuns[id];
      const routed = routedTools.find((rt) => rt.exposedName === String(block.name));
      return (
        <div key={key} className="chat-tool-card">
          <details>
            <summary>
              <span className="badge badge-mono">🔧 {run?.toolName ?? String(block.name)}</span>
              {sessions.length > 1 && run && (
                <span className="badge">{run.serverName}</span>
              )}
              {!run?.result && !run?.error && <span className="field-type">running…</span>}
              {run?.error && <span className="badge badge-error">failed</span>}
              {run?.result?.isError && <span className="badge badge-error">tool error</span>}
            </summary>
            <JsonView data={block.input} label="arguments" />
            {run?.error && <div className="result-error">⚠ {run.error}</div>}
            {run?.result && <JsonView data={run.result} label="result" />}
          </details>
          {run?.result && routed && (
            <ChatToolWidget
              sessionId={routed.sessionId}
              tool={routed.tool}
              args={run.args}
              result={run.result}
              onHostEvent={onHostEvent}
            />
          )}
        </div>
      );
    }
    return null;
  }

  const serverSummary =
    sessions.length === 1
      ? sessions[0].serverName
      : `${sessions.length} servers: ${sessions.map((s) => s.serverName).join(", ")}`;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ← Back
        </button>
        <h2>
          Chat simulator
          <InfoTip text="A real Claude model acts as the host: it sees the tools of every connected server (namespaced per server), decides which to call, and results render as widgets inline — like previewing your apps inside ChatGPT, but local." />
          <span className="field-type" style={{ marginLeft: 8 }}>
            {serverSummary} · {routedTools.length} tools
            {llmReady && ` · ${llm!.name} / ${llm!.model}`}
          </span>
        </h2>
        <span className="screen-header-actions">
          {(usage.input > 0 || usage.output > 0) && (
            <span className="field-type">
              {usage.input.toLocaleString()} in / {usage.output.toLocaleString()} out tok
            </span>
          )}
          <button
            className="btn btn-ghost btn-sm"
            disabled={messages.length === 0}
            onClick={() => {
              setMessages([]);
              setToolRuns({});
              setUsage({ input: 0, output: 0 });
              setError(null);
            }}
          >
            New chat
          </button>
        </span>
      </div>

      <div className="screen-body chat-body">
        {llm !== undefined && !llmReady && (
          <div className="connect-error">
            {llm === null
              ? "No LLM provider configured — add one in Settings to use the chat simulator."
              : "No model selected for the active provider — pick one in Settings."}
          </div>
        )}
        {messages.length === 0 && llmReady && (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <p>
              Ask something that would make the model use the connected servers'
              tools — you'll see its reasoning, the calls it makes (and which server
              they go to), and the widgets render inline.
            </p>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === "user") {
            const texts = m.content.filter((b) => b.type === "text");
            return texts.map((b, j) => (
              <div key={`${i}-${j}`} className="chat-bubble user">
                {b.text}
              </div>
            ));
          }
          return m.content.map((b, j) => renderAssistantBlock(b, i * 100 + j));
        })}
        {busy && <div className="chat-bubble assistant thinking">…</div>}
        {error && <div className="result-error">⚠ {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          className="input"
          rows={2}
          placeholder="Message the simulated assistant…"
          value={input}
          disabled={busy || (llm !== undefined && !llmReady)}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="btn btn-primary"
          disabled={busy || !input.trim() || (llm !== undefined && !llmReady)}
          onClick={send}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

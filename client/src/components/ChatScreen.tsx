import { useEffect, useRef, useState } from "react";
import type { McpTool, ToolCallResult } from "../types";
import type { AnthropicContentBlock, AnthropicMessage } from "../api";
import ChatToolWidget from "./ChatToolWidget";
import JsonView from "./JsonView";
import InfoTip from "./InfoTip";
import * as api from "../api";

interface Props {
  sessionId: string;
  tools: McpTool[];
  serverName: string;
  onClose: () => void;
  onHostEvent: (message: string) => void;
}

interface ToolRun {
  toolName: string;
  args: Record<string, unknown>;
  result?: ToolCallResult;
  error?: string;
}

const MAX_TOOL_ROUNDS = 10;

function toolResultText(result: ToolCallResult): string {
  const text = (result.content ?? [])
    .map((b) => (b.type === "text" ? b.text : `[${b.type}]`))
    .join("\n");
  const structured = result.structuredContent
    ? `\nstructuredContent: ${JSON.stringify(result.structuredContent)}`
    : "";
  return (text + structured).slice(0, 8000) || "(empty result)";
}

export default function ChatScreen({ sessionId, tools, serverName, onClose, onHostEvent }: Props) {
  const [messages, setMessages] = useState<AnthropicMessage[]>([]);
  const [toolRuns, setToolRuns] = useState<Record<string, ToolRun>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getSettings().then((s) => setHasKey(s.hasApiKey));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);

    const transcript: AnthropicMessage[] = [
      ...messages,
      { role: "user", content: [{ type: "text", text }] },
    ];
    setMessages(transcript);

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const resp = await api.chat(sessionId, transcript);
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
          const name = String(block.name);
          const args = (block.input as Record<string, unknown>) ?? {};
          setToolRuns((prev) => ({ ...prev, [id]: { toolName: name, args } }));
          onHostEvent(`Chat model called tool "${name}"`);
          try {
            const result = await api.callTool(sessionId, name, args);
            setToolRuns((prev) => ({ ...prev, [id]: { toolName: name, args, result } }));
            resultBlocks.push({
              type: "tool_result",
              tool_use_id: id,
              content: toolResultText(result),
              ...(result.isError ? { is_error: true } : {}),
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setToolRuns((prev) => ({
              ...prev,
              [id]: { toolName: name, args, error: message },
            }));
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
      const tool = tools.find((t) => t.name === block.name);
      return (
        <div key={key} className="chat-tool-card">
          <details>
            <summary>
              <span className="badge badge-mono">🔧 {String(block.name)}</span>
              {!run?.result && !run?.error && <span className="field-type">running…</span>}
              {run?.error && <span className="badge badge-error">failed</span>}
              {run?.result?.isError && <span className="badge badge-error">tool error</span>}
            </summary>
            <JsonView data={block.input} label="arguments" />
            {run?.error && <div className="result-error">⚠ {run.error}</div>}
            {run?.result && <JsonView data={run.result} label="result" />}
          </details>
          {run?.result && tool && (
            <ChatToolWidget
              sessionId={sessionId}
              tool={tool}
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

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ← Back
        </button>
        <h2>
          Chat simulator
          <InfoTip text="A real Claude model acts as the host: it sees this server's tools, decides when to call them, and tool results render as widgets inline — like previewing your app inside ChatGPT, but local." />
          <span className="field-type" style={{ marginLeft: 8 }}>
            {serverName} · {tools.length} tools
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
        {hasKey === false && (
          <div className="connect-error">
            No Anthropic API key configured — add one in Settings to use the chat
            simulator.
          </div>
        )}
        {messages.length === 0 && hasKey && (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <p>
              Ask something that would make the model use this server's tools —
              you'll see its reasoning, the calls it makes, and the widgets render
              inline.
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
          disabled={busy || hasKey === false}
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
          disabled={busy || !input.trim() || hasKey === false}
          onClick={send}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

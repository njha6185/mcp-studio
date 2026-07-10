import type { LlmProvider } from "./store.js";

/**
 * Minimal LLM provider layer — no framework needed. Two protocols cover
 * effectively every provider:
 *  - "anthropic": the Anthropic Messages API
 *  - "openai":    the OpenAI-compatible Chat Completions API, spoken by
 *                 OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Gemini
 *                 (compat endpoint), Ollama, LM Studio, vLLM, …
 *
 * The chat loop in the client uses Anthropic-style content blocks; the
 * openai adapter converts both directions so the client never notices.
 */

export interface NormalizedResponse {
  content: Record<string, unknown>[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
  model?: string;
}

interface ToolDef {
  name: string;
  description: string;
  input_schema: unknown;
}

type Message = { role: "user" | "assistant"; content: Record<string, unknown>[] };

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.error?.message ?? json.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || `${res.status} ${res.statusText}`;
  }
}

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

export async function listModels(
  provider: LlmProvider
): Promise<{ id: string; name?: string }[]> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> =
    provider.kind === "anthropic"
      ? { "x-api-key": provider.apiKey ?? "", "anthropic-version": "2023-06-01" }
      : provider.apiKey
        ? { Authorization: `Bearer ${provider.apiKey}` }
        : {};
  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as {
    data?: { id: string; display_name?: string; name?: string }[];
  };
  return (body.data ?? []).map((m) => ({
    id: m.id,
    name: m.display_name ?? m.name,
  }));
}

// ---------------------------------------------------------------------------
// Chat completion (normalized to Anthropic-style blocks)
// ---------------------------------------------------------------------------

export async function chatComplete(
  provider: LlmProvider,
  model: string,
  system: string,
  messages: Message[],
  tools: ToolDef[]
): Promise<NormalizedResponse> {
  return provider.kind === "anthropic"
    ? anthropicChat(provider, model, system, messages, tools)
    : openaiChat(provider, model, system, messages, tools);
}

async function anthropicChat(
  provider: LlmProvider,
  model: string,
  system: string,
  messages: Message[],
  tools: ToolDef[]
): Promise<NormalizedResponse> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as NormalizedResponse;
  return {
    content: body.content ?? [],
    stop_reason: body.stop_reason ?? "end_turn",
    usage: {
      input_tokens: (body.usage as { input_tokens?: number })?.input_tokens ?? 0,
      output_tokens: (body.usage as { output_tokens?: number })?.output_tokens ?? 0,
    },
    model: body.model,
  };
}

function toOpenAiMessages(system: string, messages: Message[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      // tool_result blocks become role:"tool" messages
      for (const block of m.content) {
        if (block.type !== "tool_result") continue;
        out.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content:
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content ?? ""),
        });
      }
      const text = m.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text) out.push({ role: "user", content: text });
    } else {
      const text = m.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const toolCalls = m.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    }
  }
  return out;
}

async function openaiChat(
  provider: LlmProvider,
  model: string,
  system: string,
  messages: Message[],
  tools: ToolDef[]
): Promise<NormalizedResponse> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(system, messages),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema ?? { type: "object" },
              },
            })),
          }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as {
    choices: {
      message: {
        content?: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      };
      finish_reason?: string;
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const choice = body.choices?.[0];
  const content: Record<string, unknown>[] = [];
  if (choice?.message?.content)
    content.push({ type: "text", text: choice.message.content });
  for (const tc of choice?.message?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = JSON.parse(tc.function.arguments || "{}");
    } catch {
      input = { _raw: tc.function.arguments };
    }
    content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }
  return {
    content,
    stop_reason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    usage: {
      input_tokens: body.usage?.prompt_tokens ?? 0,
      output_tokens: body.usage?.completion_tokens ?? 0,
    },
    model: body.model,
  };
}

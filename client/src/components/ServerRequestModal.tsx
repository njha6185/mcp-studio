import { useState } from "react";
import type { ServerRequest } from "../api";
import JsonView from "./JsonView";

interface Props {
  request: ServerRequest;
  onRespond: (result: unknown) => void;
  onReject: (error: string) => void;
}

/**
 * Dialog for server-initiated requests. The server is waiting for this answer:
 * - sampling/createMessage → you play the LLM and type the assistant reply
 * - elicitation/create → the server asks the user for structured input
 */
export default function ServerRequestModal({ request, onRespond, onReject }: Props) {
  const isSampling = request.method === "sampling/createMessage";
  const [text, setText] = useState("");
  const [jsonText, setJsonText] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);

  function submit() {
    if (isSampling) {
      onRespond({
        model: "mcp-studio/manual",
        role: "assistant",
        content: { type: "text", text },
        stopReason: "endTurn",
      });
      return;
    }
    try {
      const content = JSON.parse(jsonText || "{}");
      setJsonError(null);
      onRespond({ action: "accept", content });
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>
          {isSampling ? "Server requests an LLM completion" : "Server requests input"}
          <span className="badge badge-mono" style={{ marginLeft: 8 }}>
            {request.method}
          </span>
        </h3>
        <p className="field-desc">
          {isSampling
            ? "The server sent a sampling request — no LLM is attached, so you answer as the model. Your text is returned as the assistant message."
            : "The server is asking for structured input (elicitation). Review the message and requested schema, then provide matching JSON."}
        </p>

        {!isSampling && typeof request.params.message === "string" && (
          <p className="modal-message">{request.params.message}</p>
        )}

        <div className="modal-params">
          <JsonView
            data={
              isSampling
                ? { messages: request.params.messages, systemPrompt: request.params.systemPrompt }
                : { requestedSchema: request.params.requestedSchema }
            }
            label="request"
          />
        </div>

        {isSampling ? (
          <textarea
            className="input"
            rows={4}
            autoFocus
            placeholder="Type the assistant response…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <>
            <textarea
              className={`input input-code ${jsonError ? "input-error" : ""}`}
              rows={5}
              autoFocus
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
            {jsonError && <div className="field-error">{jsonError}</div>}
          </>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit}>
            {isSampling ? "Send response" : "Accept"}
          </button>
          {!isSampling && (
            <button
              className="btn btn-ghost"
              onClick={() => onRespond({ action: "decline" })}
            >
              Decline
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() =>
              isSampling
                ? onReject("User rejected the sampling request")
                : onRespond({ action: "cancel" })
            }
          >
            {isSampling ? "Reject" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";

export default function JsonView({ data, label }: { data: unknown; label?: string }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(data, null, 2) ?? "undefined";

  return (
    <div className="json-view">
      <div className="json-view-bar">
        <span>{label ?? "JSON"}</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="json-pre">{text}</pre>
    </div>
  );
}

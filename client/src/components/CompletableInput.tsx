import { useEffect, useId, useRef, useState } from "react";
import * as api from "../api";
import type { CompletionRef } from "../api";

interface Props {
  sessionId: string;
  completionRef: CompletionRef;
  argName: string;
  value: string;
  onChange: (v: string) => void;
}

/**
 * Text input with MCP argument autocompletion (completion/complete) surfaced
 * through a native <datalist> — zero custom dropdown UI.
 */
export default function CompletableInput({
  sessionId,
  completionRef,
  argName,
  value,
  onChange,
}: Props) {
  const listId = useId();
  const [options, setOptions] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .complete(sessionId, completionRef, argName, value)
        .then((res) => setOptions(res.completion?.values ?? []))
        .catch(() => setOptions([]));
    }, 250);
    return () => timer.current && clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, argName, sessionId]);

  return (
    <>
      <input
        className="input"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

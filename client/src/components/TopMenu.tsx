import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme";

interface Props {
  serverName: string;
  multiServer: boolean;
  onSettings: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  onDisconnectAll: () => void;
}

/** ☰ menu for the low-frequency actions; closes on click-outside and Escape. */
export default function TopMenu({
  serverName,
  multiServer,
  onSettings,
  onRefresh,
  onDisconnect,
  onDisconnectAll,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function item(
    label: string,
    desc: string,
    action: () => void,
    danger = false
  ) {
    return (
      <button
        className={`menu-item ${danger ? "danger" : ""}`}
        onClick={() => {
          setOpen(false);
          action();
        }}
      >
        <span className="menu-item-label">{label}</span>
        <span className="menu-item-desc">{desc}</span>
      </button>
    );
  }

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className={`btn btn-ghost btn-sm ${open ? "active" : ""}`}
        title="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ☰
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          {item("⚙ Settings", "LLM providers, stored data, OAuth credentials", onSettings)}
          {item(
            theme === "dark" ? "☀ Light theme" : "☾ Dark theme",
            "Widgets are notified live via set_globals",
            toggle
          )}
          {item(
            "⟳ Refresh lists",
            "Re-fetch tools, resources, and prompts from the focused server",
            onRefresh
          )}
          <div className="menu-divider" />
          {item(
            `Disconnect ${serverName}`,
            multiServer ? "Other servers stay connected" : "Return to the connect screen",
            onDisconnect,
            true
          )}
          {multiServer &&
            item("Disconnect all", "Close every server connection", onDisconnectAll, true)}
        </div>
      )}
    </div>
  );
}

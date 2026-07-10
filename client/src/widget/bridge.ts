/**
 * Builds the HTML document loaded into the widget iframe.
 *
 * For OpenAI-Apps-SDK-style widgets we prepend a script that defines
 * `window.openai` (globals + host API) before the widget's own code runs,
 * mirroring what ChatGPT provides to apps. Host calls (callTool, etc.) are
 * relayed to the parent frame over postMessage and answered asynchronously.
 */

export interface WidgetGlobals {
  toolInput: unknown;
  toolOutput: unknown;
  toolResponseMetadata: unknown;
  widgetState: unknown;
  displayMode: "inline" | "fullscreen" | "pip";
  maxHeight: number;
  theme: "light" | "dark";
  locale: string;
}

const BRIDGE_SOURCE = String.raw`
(function () {
  var globals = window.__WIDGET_GLOBALS__ || {};
  var pending = {};
  var counter = 0;

  function rpc(type, payload) {
    return new Promise(function (resolve, reject) {
      var id = "rpc-" + ++counter;
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage(
        { __mcpWidget: true, id: id, type: type, payload: payload },
        "*"
      );
    });
  }

  function dispatchGlobals(changed) {
    try {
      window.dispatchEvent(
        new CustomEvent("openai:set_globals", { detail: { globals: changed } })
      );
    } catch (e) {}
  }

  var openai = {
    toolInput: globals.toolInput ?? null,
    toolOutput: globals.toolOutput ?? null,
    toolResponseMetadata: globals.toolResponseMetadata ?? null,
    widgetState: globals.widgetState ?? null,
    displayMode: globals.displayMode || "inline",
    maxHeight: globals.maxHeight || 0,
    theme: globals.theme || "dark",
    locale: globals.locale || "en",
    userAgent: { device: { type: "desktop" }, capabilities: {} },
    safeArea: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },

    callTool: function (name, args) {
      return rpc("callTool", { name: name, args: args || {} });
    },
    setWidgetState: function (state) {
      openai.widgetState = state;
      dispatchGlobals({ widgetState: state });
      return rpc("setWidgetState", { state: state });
    },
    sendFollowUpMessage: function (opts) {
      return rpc("sendFollowUpMessage", opts || {});
    },
    sendFollowupTurn: function (opts) {
      return rpc("sendFollowUpMessage", opts || {});
    },
    openExternal: function (opts) {
      return rpc("openExternal", opts || {});
    },
    requestDisplayMode: function (opts) {
      return rpc("requestDisplayMode", opts || {});
    },
    requestModal: function () {
      return rpc("requestDisplayMode", { mode: "fullscreen" });
    },
    notifyIntrinsicHeight: function () {},
    log: function () {
      try { console.log.apply(console, arguments); } catch (e) {}
    }
  };

  window.openai = openai;
  window.webplus = openai; // legacy alias some widgets use

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.__mcpWidgetResponse && pending[data.id]) {
      var p = pending[data.id];
      delete pending[data.id];
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error || "Host call failed"));
      return;
    }
    if (data.__mcpWidgetHost && data.type === "set_globals") {
      var changed = data.payload || {};
      Object.keys(changed).forEach(function (k) { openai[k] = changed[k]; });
      dispatchGlobals(changed);
    }
  });

  // Report content height so the host can size the iframe.
  function reportHeight() {
    var h = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0
    );
    window.parent.postMessage(
      { __mcpWidget: true, type: "resize", payload: { height: h } },
      "*"
    );
  }
  var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(reportHeight) : null;
  window.addEventListener("DOMContentLoaded", function () {
    if (ro && document.body) ro.observe(document.body);
    reportHeight();
  });
  window.addEventListener("load", reportHeight);
})();
`;

export function buildOpenAiWidgetDoc(html: string, globals: WidgetGlobals): string {
  const bootstrap = `<script>window.__WIDGET_GLOBALS__ = ${JSON.stringify(
    globals
  ).replace(/</g, "\\u003c")};<\/script><script>${BRIDGE_SOURCE}<\/script>`;

  // Inject the bridge before any widget code. If the document has a <head>,
  // put it at the top of it; otherwise prepend to the whole document.
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + bootstrap + html.slice(at);
  }
  return bootstrap + html;
}

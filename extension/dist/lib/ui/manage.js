import { c as clientExports, j as jsxRuntimeExports, r as reactExports, g as getOrCreateAuthToken } from "./authToken.js";
const ManageApp = () => {
  const [sessions, setSessions] = reactExports.useState([]);
  const [tokenValue, setTokenValue] = reactExports.useState(getOrCreateAuthToken);
  const [showToken, setShowToken] = reactExports.useState(false);
  const [tokenCopied, setTokenCopied] = reactExports.useState(false);
  const [envCopied, setEnvCopied] = reactExports.useState(false);
  const [promptCopied, setPromptCopied] = reactExports.useState(false);
  const [showPrompt, setShowPrompt] = reactExports.useState(false);
  const [profile, setProfile] = reactExports.useState("Default");
  const [time, setTime] = reactExports.useState("");
  const [version, setVersion] = reactExports.useState("0.9.7");
  const getBrowserName = () => {
    const ua = navigator.userAgent;
    if (ua.includes("Edg/")) return "Microsoft Edge";
    if (navigator.brave) return "Brave";
    return "Chrome";
  };
  const formatAgentName = (rawName) => {
    if (!rawName || !rawName.trim()) return "AI Agent";
    let text = rawName.trim().replace(/^dynamic[-_]session[-_]/i, "").trim();
    if (!text) return "AI Agent";
    text = text.replace(/([a-z\d])([A-Z])/g, "$1 $2");
    const tokens = text.split(/[-_.\s]+/).filter(Boolean);
    if (tokens.length === 0) return "AI Agent";
    const formatted = tokens.map((token) => {
      const upper = token.toUpperCase();
      if (["AI", "MCP", "API", "UI", "ID", "URL", "PR", "DB", "CLI"].includes(upper)) {
        return upper;
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    });
    const result = formatted.join(" ");
    const lower = result.toLowerCase();
    const hasRoleSuffix = /\b(agent|bot|worker|crawler|scraper|runner|assistant|service)\b/i.test(lower);
    if (!hasRoleSuffix) {
      return `${result} Agent`;
    }
    return result;
  };
  reactExports.useEffect(() => {
    try {
      const manifest = chrome.runtime.getManifest();
      if (manifest == null ? void 0 : manifest.version) {
        setVersion(manifest.version);
      }
      chrome.storage.local.get(["auth-token"], (result) => {
        if (result && result["auth-token"]) {
          setTokenValue(result["auth-token"]);
          localStorage.setItem("auth-token", result["auth-token"]);
        }
      });
    } catch (_) {
    }
    const updateTime = () => {
      setTime((/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    };
    updateTime();
    const timer = setInterval(updateTime, 3e4);
    return () => clearInterval(timer);
  }, []);
  const loadStatus = reactExports.useCallback(async () => {
    var _a;
    try {
      const response = await chrome.runtime.sendMessage({ type: "getStatus" }).catch(() => void 0);
      const rawSessions = (response == null ? void 0 : response.sessions) || [];
      const sessionsList = [];
      for (const s of rawSessions) {
        const agentTabs = [];
        const seenTabIds = /* @__PURE__ */ new Set();
        if (s.tabIds && s.tabIds.length > 0) {
          for (const tabId of s.tabIds) {
            try {
              const tab = await chrome.tabs.get(tabId);
              if (tab && !seenTabIds.has(tab.id)) {
                seenTabIds.add(tab.id);
                agentTabs.push(tab);
              }
            } catch (_) {
            }
          }
        }
        let windowExists = !s.windowId;
        let windowFocused = false;
        if (s.windowId) {
          try {
            const win = await chrome.windows.get(s.windowId, { populate: true });
            if (win) {
              windowExists = true;
              windowFocused = !!win.focused;
              if (win.tabs) {
                for (const tab of win.tabs) {
                  if (tab.id && !seenTabIds.has(tab.id) && !((_a = tab.url) == null ? void 0 : _a.startsWith("chrome-extension://"))) {
                    seenTabIds.add(tab.id);
                    agentTabs.push(tab);
                  }
                }
              }
            }
          } catch (_) {
            windowExists = false;
          }
        }
        if (!windowExists || agentTabs.length === 0) {
          void chrome.runtime.sendMessage({ type: "disconnect", sessionId: s.id }).catch(() => {
          });
          continue;
        }
        sessionsList.push({
          sessionId: s.id,
          clientName: formatAgentName(s.clientName),
          windowId: s.windowId,
          tabs: agentTabs,
          focused: windowFocused
        });
      }
      setSessions(sessionsList);
    } catch (_) {
    }
  }, []);
  reactExports.useEffect(() => {
    void loadStatus();
    const reload = () => void loadStatus();
    chrome.tabs.onCreated.addListener(reload);
    chrome.tabs.onUpdated.addListener(reload);
    chrome.tabs.onRemoved.addListener(reload);
    chrome.windows.onCreated.addListener(reload);
    chrome.windows.onRemoved.addListener(reload);
    const interval = setInterval(loadStatus, 3e3);
    return () => {
      chrome.tabs.onCreated.removeListener(reload);
      chrome.tabs.onUpdated.removeListener(reload);
      chrome.tabs.onRemoved.removeListener(reload);
      chrome.windows.onCreated.removeListener(reload);
      chrome.windows.onRemoved.removeListener(reload);
      clearInterval(interval);
    };
  }, [loadStatus]);
  const focusWindow = async (windowId, tabId) => {
    if (tabId) {
      await chrome.tabs.update(tabId, { active: true }).catch(() => {
      });
    }
    if (windowId) {
      await chrome.windows.update(windowId, { focused: true }).catch(() => {
      });
    }
    await loadStatus();
  };
  const disconnectSession = async (sessionId) => {
    await chrome.runtime.sendMessage({ type: "disconnect", sessionId }).catch(() => {
    });
    await loadStatus();
  };
  const onRotateToken = () => {
    if (!confirm("Rotate the token? You will need to update your MCP config.")) return;
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const newToken = btoa(String.fromCharCode.apply(null, Array.from(array))).replace(/[+/=]/g, (m) => m === "+" ? "-" : m === "/" ? "_" : "");
    localStorage.setItem("auth-token", newToken);
    try {
      chrome.storage.local.set({ "auth-token": newToken });
    } catch (_) {
    }
    setTokenValue(newToken);
  };
  const buildPrompt = (maskToken) => {
    const prof = profile.trim() || "Default";
    const config = {
      mcpServers: {
        "playwright-extension": {
          command: "playwright-mcp-extension",
          env: {
            PLAYWRIGHT_MCP_EXTENSION_TOKEN: maskToken ? "<hidden: added when copied>" : tokenValue,
            PLAYWRIGHT_CHROME_PROFILE: prof
          }
        }
      }
    };
    return [
      'Add an MCP server called "playwright-extension" to your environment.',
      "",
      "1. Open your MCP config file (for Google Antigravity: ~/.gemini/config/mcp_config.json).",
      '2. Merge this entry into the "mcpServers" object. Keep any servers already there:',
      "",
      JSON.stringify(config, null, 2),
      "",
      "3. Save the file, then restart the agent so it loads the new server.",
      "",
      'How to use it: every browser tool takes a session_id. Use a different session_id for each agent (for example "agent-1", "agent-2"). Each session_id opens its own Chrome window. Reuse the same session_id to stay in the same window, and call browser_close_session when you are done.'
    ].join("\n");
  };
  const copyText = async (text, setCopied) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (_) {
    }
    setTimeout(() => setCopied(false), 1500);
  };
  const totalTabs = sessions.reduce((n, s) => n + s.tabs.length, 0);
  const getInitialHostLetter = (url) => {
    if (!url) return "W";
    try {
      const host = new URL(url).hostname;
      return host.replace(/^www\./, "").charAt(0).toUpperCase() || "W";
    } catch {
      return "W";
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "wrap", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "logo", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "3", y: "4", width: "18", height: "12", rx: "2" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M8 20h8M12 16v4" })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "title", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("h1", { children: [
          "Playwright Control Center ",
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "chip", children: [
            "v",
            version
          ] }),
          " ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip", children: getBrowserName() })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "sub", children: "One dedicated window per Antigravity agent" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stats", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "stat", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: sessions.length }),
          " active ",
          sessions.length === 1 ? "agent" : "agents"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "stat", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: totalTabs }),
          " agent ",
          totalTabs === 1 ? "tab" : "tabs"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("main", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "section-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("h2", { children: [
            "Agent workspaces",
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "count", children: sessions.length })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "hint", children: [
            "Live · ",
            time
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "lead", children: "Only windows and tabs controlled by AI agents are shown. Click a tab to bring it to the front." }),
        sessions.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card empty", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { children: "No active agent sessions" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "Your browser is connected and listening on port 45454. When an agent starts browsing, its dedicated window appears here." })
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sessions", children: sessions.map((s) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "session-head", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "name", children: s.clientName }),
            s.windowId && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "chip mono", children: [
              "Window #",
              s.windowId
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "chip", children: [
              "Session #",
              s.sessionId
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "chip", children: [
              s.tabs.length,
              " ",
              s.tabs.length === 1 ? "tab" : "tabs"
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "actions", children: [
              s.windowId && /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => {
                var _a;
                return focusWindow(s.windowId, (_a = s.tabs[0]) == null ? void 0 : _a.id);
              }, children: "Focus window" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => disconnectSession(s.sessionId), children: "Disconnect" })
            ] })
          ] }),
          s.tabs.map((t) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "div",
            {
              className: `tab ${t.active ? "focused" : ""}`,
              tabIndex: 0,
              title: "Focus this tab",
              onClick: () => focusWindow(s.windowId, t.id),
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  focusWindow(s.windowId, t.id);
                }
              },
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "fav", children: t.favIconUrl ? /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "img",
                  {
                    src: t.favIconUrl,
                    alt: "",
                    onError: (e) => {
                      e.target.style.display = "none";
                    }
                  }
                ) : getInitialHostLetter(t.url) }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "info", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "t", children: t.title || "Loading..." }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "u mono", children: t.url || "about:blank" })
                ] })
              ]
            },
            t.id
          ))
        ] }, s.sessionId)) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "card pad", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "section-head", children: /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: "Authentication token" }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "lead", children: "Add this to your MCP configuration so agents connect without a browser prompt." }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "token-key-badge", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "token-key-label", children: "Environment variable:" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "mono", children: "PLAYWRIGHT_MCP_EXTENSION_TOKEN" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "field token-field", children: /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "mono token-value", "aria-label": "Authentication token", children: showToken ? tokenValue : "•".repeat(32) }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "btn-row", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "primary grow",
                title: "Copy token value only",
                onClick: () => copyText(tokenValue, setTokenCopied),
                children: tokenCopied ? "✓ Copied Token" : "Copy token"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                title: "Copy full env: PLAYWRIGHT_MCP_EXTENSION_TOKEN=token",
                onClick: () => copyText(`PLAYWRIGHT_MCP_EXTENSION_TOKEN=${tokenValue}`, setEnvCopied),
                children: envCopied ? "✓ Copied Env" : "Copy as KEY=VAL"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "btn-row sub-row", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "grow", onClick: () => setShowToken(!showToken), children: showToken ? "Hide token" : "Show token" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: onRotateToken, title: "Regenerate authentication token", children: "Rotate" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "foot", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Control plane" }),
              " 127.0.0.1:45454"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "card pad", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "section-head", children: /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: "Set up an AI agent" }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "lead", children: "Give an agent this prompt and it will add the MCP server to its own environment." }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("label", { htmlFor: "profile", children: "Browser profile" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              id: "profile",
              className: "mono",
              spellCheck: false,
              value: profile,
              onChange: (e) => setProfile(e.target.value)
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "note", id: "profile-note", children: "Folder name from the Profile Path on the browser’s version page." }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "btn-row", style: { marginTop: 0 }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setShowPrompt(!showPrompt), children: showPrompt ? "Hide prompt" : "Show prompt" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "primary grow",
                onClick: () => copyText(buildPrompt(false), setPromptCopied),
                children: promptCopied ? "Copied" : "Copy prompt"
              }
            )
          ] }),
          showPrompt && /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { children: buildPrompt(true) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "note", style: { margin: "10px 0 0" }, children: "Your token is included when you copy, and hidden in the preview." })
        ] })
      ] })
    ] })
  ] });
};
const root = clientExports.createRoot(document.getElementById("root"));
root.render(/* @__PURE__ */ jsxRuntimeExports.jsx(ManageApp, {}));

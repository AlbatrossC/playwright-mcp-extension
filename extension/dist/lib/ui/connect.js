import { j as jsxRuntimeExports, R as React, c as clientExports, r as reactExports, g as getOrCreateAuthToken } from "./authToken.js";
const cross = () => {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { className: "octicon color-text-danger", viewBox: "0 0 16 16", version: "1.1", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { fillRule: "evenodd", d: "M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" }) });
};
const check = () => {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { "aria-hidden": "true", height: "16", viewBox: "0 0 16 16", version: "1.1", width: "16", "data-view-component": "true", className: "octicon color-icon-success", children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { fillRule: "evenodd", d: "M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" }) });
};
const alert = () => {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { className: "octicon", viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" }) });
};
const page = () => {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { className: "tab-favicon", viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "1.75", y: "2.75", width: "12.5", height: "10.5", rx: "2" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M2 6.25h12" })
  ] });
};
const Button = ({
  variant,
  onClick,
  children
}) => {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: `button ${variant}`, onClick, children });
};
const PageHeader = ({ children }) => {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "page-header", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("img", { className: "page-logo", src: "icons/icon-48.png", alt: "" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "page-title", children: "Playwright Extension" }),
    children
  ] });
};
const ListItem = ({ icon, title, subtitle, checked, onClick }) => {
  const content = /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    icon,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tab-content", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tab-title", title, children: title }),
      subtitle && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tab-url", title: subtitle, children: subtitle })
    ] })
  ] });
  if (checked === void 0)
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tab-item" + (onClick ? " clickable" : ""), onClick, children: content });
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "tab-item clickable" + (checked ? " selected" : ""), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", className: "tab-checkbox", checked, onChange: onClick }),
    content
  ] });
};
const TabItem = ({ tab, checked, onClick }) => {
  const [iconFailed, setIconFailed] = React.useState(false);
  const icon = tab.favIconUrl && !iconFailed ? /* @__PURE__ */ jsxRuntimeExports.jsx("img", { className: "tab-favicon", src: tab.favIconUrl, alt: "", onError: () => setIconFailed(true) }) : page();
  return /* @__PURE__ */ jsxRuntimeExports.jsx(ListItem, { icon, title: tab.title || "Untitled", subtitle: tab.url, checked, onClick });
};
const SUPPORTED_PROTOCOL_VERSION = 2;
const params = new URLSearchParams(window.location.search);
const options = sessionOptions();
function sessionOptions() {
  let clientName = "unknown";
  try {
    clientName = JSON.parse(params.get("client") || "{}").name || clientName;
  } catch {
  }
  const tabGroup = params.get("tabGroup") === "false" ? void 0 : {
    title: params.get("tabGroupTitle") ?? void 0,
    color: params.get("tabGroupColor") ?? void 0
  };
  return { clientName, tabGroup, background: params.get("background") === "true" };
}
function relayUrlError(relayUrl) {
  if (!relayUrl)
    return "Missing mcpRelayUrl parameter in URL.";
  try {
    const host = new URL(relayUrl).hostname;
    if (host !== "127.0.0.1" && host !== "[::1]")
      return `Playwright extension only allows loopback connections (127.0.0.1 or [::1]). Received host: ${host}`;
  } catch (e) {
    return `Invalid mcpRelayUrl parameter in URL: ${relayUrl}. ${e}`;
  }
}
function protocolVersionError() {
  const parsedVersion = parseInt(params.get("protocolVersion") ?? "", 10);
  const requestedVersion = isNaN(parsedVersion) ? 1 : parsedVersion;
  if (requestedVersion > SUPPORTED_PROTOCOL_VERSION)
    return { type: "error", versionMismatch: { extensionVersion: chrome.runtime.getManifest().version } };
  if (requestedVersion < 1)
    return { type: "error", message: "The client uses an unsupported protocol version. Update Playwright MCP or CLI to the latest version." };
}
const ConnectApp = () => {
  const [status, setStatus] = reactExports.useState(null);
  const [candidates, setCandidates] = reactExports.useState(null);
  const [selection, setSelection] = reactExports.useState({});
  const connect = reactExports.useCallback(async (selection2) => {
    setCandidates(null);
    const response = await chrome.runtime.sendMessage({ type: "connect", options, selection: selection2 }).catch((e) => ({ error: String(e) }));
    if (response == null ? void 0 : response.success)
      setStatus({ type: "connected", message: `"${options.clientName}" connected.` });
    else
      setStatus({ type: "error", message: (response == null ? void 0 : response.error) || `"${options.clientName}" failed to connect.` });
  }, []);
  reactExports.useEffect(() => {
    const start = async () => {
      const relayUrl = params.get("mcpRelayUrl");
      const urlError = relayUrlError(relayUrl);
      if (urlError) {
        setStatus({ type: "error", message: urlError });
        return;
      }
      const versionError = protocolVersionError();
      if (versionError) {
        setStatus(versionError);
        return;
      }
      setStatus({ type: "connecting", message: `"${options.clientName}" is trying to connect to the Playwright Extension.` });
      await chrome.runtime.sendMessage({ type: "connectionRequested", mcpRelayUrl: relayUrl });
      const token = params.get("token");
      if (!token) {
        setCandidates(await chrome.runtime.sendMessage({ type: "getCandidates" }));
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      window.history.replaceState(null, "", url);
      if (token === getOrCreateAuthToken())
        await connect({});
      else
        setStatus({ type: "error", message: "Invalid token provided." });
    };
    void start();
    const keepalive = setInterval(() => void chrome.runtime.sendMessage({ type: "keepalive" }).catch(() => {
    }), 2e4);
    return () => clearInterval(keepalive);
  }, [connect]);
  const toggleGroup = (groupId) => setSelection(selection.groupId === groupId ? {} : { groupId });
  const toggleTab = (tabId) => {
    const tabIds = selection.tabIds ?? [];
    setSelection({ tabIds: tabIds.includes(tabId) ? tabIds.filter((id) => id !== tabId) : [...tabIds, tabId] });
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "page", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsx("a", { className: "page-header-link", href: "manage.html", target: "_blank", rel: "noreferrer", children: "Manage clients" }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card", children: [
      status && /* @__PURE__ */ jsxRuntimeExports.jsx(StatusBanner, { status }),
      (status == null ? void 0 : status.type) === "connecting" && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card-body", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "warning-banner", children: [
          alert(),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            "Allowing this connection exposes the entire browser to the client, including any signed-in sessions, cookies, and content in other tabs and windows. Once approved, the client may also be able to reconnect later without showing this dialog again, unless you rotate the token on the ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: "manage.html", target: "_blank", rel: "noreferrer", children: "Manage clients" }),
            " page and then restart the browser."
          ] })
        ] }),
        candidates && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "muted", children: [
            "Select one tab group or some tabs for the client.",
            options.tabGroup && /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children: " You can drag more tabs into the tab group of the client later." })
          ] }),
          candidates.groups.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "list-title", children: "Tab groups" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "list", children: candidates.groups.map((group) => /* @__PURE__ */ jsxRuntimeExports.jsx(
              GroupItem,
              {
                group,
                checked: selection.groupId === group.id,
                onClick: () => toggleGroup(group.id)
              },
              group.id
            )) })
          ] }),
          candidates.tabs.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "list-title", children: "Tabs" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "list", children: candidates.tabs.map((tab) => {
              var _a;
              return /* @__PURE__ */ jsxRuntimeExports.jsx(
                TabItem,
                {
                  tab,
                  checked: !!((_a = selection.tabIds) == null ? void 0 : _a.includes(tab.id)),
                  onClick: () => toggleTab(tab.id)
                },
                tab.id
              );
            }) })
          ] })
        ] })
      ] }),
      candidates && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card-footer", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "muted", children: selectionSummary(selection) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "primary", onClick: () => connect(selection), children: "Allow" })
      ] })
    ] })
  ] });
};
function selectionSummary(selection) {
  var _a;
  if (selection.groupId !== void 0)
    return "1 tab group selected.";
  const count = ((_a = selection.tabIds) == null ? void 0 : _a.length) ?? 0;
  if (count)
    return count === 1 ? "1 tab selected." : `${count} tabs selected.`;
  return "Nothing selected. The client gets a new blank tab.";
}
const GROUP_COLORS = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#d01884",
  purple: "#a142f4",
  cyan: "#007b83",
  orange: "#fa903e"
};
const GroupItem = ({ group, checked, onClick }) => {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    ListItem,
    {
      icon: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tab-favicon group-dot", style: { backgroundColor: GROUP_COLORS[group.color] } }),
      title: group.title || "Unnamed group",
      subtitle: `Tab group, ${group.tabs.length === 1 ? "1 tab" : `${group.tabs.length} tabs`}`,
      checked,
      onClick
    }
  );
};
const VersionMismatchError = ({ extensionVersion }) => {
  const readmeUrl = "https://github.com/microsoft/playwright/blob/main/packages/extension/README.md";
  const chromeWebStoreUrl = "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
    "Playwright client trying to connect requires newer extension version (current version: ",
    extensionVersion,
    ").",
    " ",
    "Update ",
    /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: chromeWebStoreUrl, target: "_blank", rel: "noopener noreferrer", children: "Playwright Extension" }),
    " from the Chrome Web Store to the latest version.",
    " ",
    "See ",
    /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: readmeUrl, target: "_blank", rel: "noopener noreferrer", children: "installation instructions" }),
    " for more details."
  ] });
};
const StatusBanner = ({ status }) => {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: `status-banner ${status.type}`, children: [
    status.type === "connected" && check(),
    status.type === "error" && cross(),
    "versionMismatch" in status ? /* @__PURE__ */ jsxRuntimeExports.jsx(VersionMismatchError, { extensionVersion: status.versionMismatch.extensionVersion }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: status.message })
  ] });
};
const container = document.getElementById("root");
if (container)
  clientExports.createRoot(container).render(/* @__PURE__ */ jsxRuntimeExports.jsx(ConnectApp, {}));

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class ChromeListeners {
  constructor() {
    __publicField(this, "_listeners", []);
    __publicField(this, "_enabled", false);
  }
  add(event, listener) {
    this._listeners.push({ event, listener });
    if (this._enabled)
      event.addListener(listener);
  }
  setEnabled(enabled) {
    if (this._enabled === enabled)
      return;
    this._enabled = enabled;
    for (const { event, listener } of this._listeners) {
      if (enabled)
        event.addListener(listener);
      else
        event.removeListener(listener);
    }
  }
}
const OPEN_TIMEOUT_MS = 5e3;
class Channel {
  constructor(ws) {
    __publicField(this, "_ws");
    __publicField(this, "_closed", false);
    __publicField(this, "onCommand");
    __publicField(this, "onClose");
    this._ws = ws;
    this._ws.onmessage = (event) => void this._onMessage(event.data);
    this._ws.onclose = () => this._didClose();
  }
  static async open(url) {
    const ws = new WebSocket(url);
    let timer;
    try {
      await new Promise((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket error"));
        timer = setTimeout(() => reject(new Error("Connection timeout")), OPEN_TIMEOUT_MS);
      });
    } catch (error) {
      ws.close();
      throw new Error(`Failed to connect to MCP relay: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
    return new Channel(ws);
  }
  get closed() {
    return this._closed;
  }
  sendEvent(method, params) {
    this._send({ method, params });
  }
  close(reason) {
    this._ws.close(1e3, reason);
    this._didClose();
  }
  async _onMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      this.close(`Error parsing message: ${error.message}`);
      return;
    }
    try {
      const result = await this.onCommand(message.method, message.params ?? []);
      this._send({ id: message.id, result: result ?? {} });
    } catch (error) {
      this._send({ id: message.id, error: error.message });
    }
  }
  _send(message) {
    if (this._ws.readyState === WebSocket.OPEN)
      this._ws.send(JSON.stringify(message));
  }
  _didClose() {
    var _a;
    if (this._closed)
      return;
    this._closed = true;
    (_a = this.onClose) == null ? void 0 : _a.call(this);
  }
}
const BROWSER_STATE_METHODS = /* @__PURE__ */ new Set([
  "Storage.setCookies",
  "Storage.clearCookies",
  "Network.clearBrowserCookies",
  "Network.clearBrowserCache",
  "Browser.grantPermissions",
  "Browser.resetPermissions",
  "Browser.setPermission",
  "Browser.setDownloadBehavior",
  "Target.createTarget",
  "Target.closeTarget",
  "Target.attachToTarget",
  "Target.activateTarget"
]);
function checkCdpMethod(method) {
  if (BROWSER_STATE_METHODS.has(method))
    throw new Error(`${method} is not allowed: it changes the state of the browser, not of the tab`);
}
class ClientSession {
  constructor(channel, registry, options, windowId) {
    __publicField(this, "options");
    // Dedicated Chrome window assigned to this client.
    __publicField(this, "windowId");
    __publicField(this, "_channel");
    __publicField(this, "_registry");
    __publicField(this, "onClose");
    this.options = options;
    this.windowId = windowId;
    this._channel = channel;
    this._registry = registry;
    this._channel.onCommand = (method, params) => this._handleCommand(method, params);
    this._channel.onClose = () => {
      var _a;
      return (_a = this.onClose) == null ? void 0 : _a.call(this);
    };
  }
  close(reason) {
    this._channel.close(reason);
  }
  didInitialize() {
    this._channel.sendEvent("extension.initialized", []);
  }
  tabClaimed(tab) {
    this._channel.sendEvent("chrome.tabs.onCreated", [tab]);
  }
  tabReleased(tabId) {
    this.debuggerDetached(tabId, "target_closed");
  }
  tabClosed(tabId, removeInfo) {
    this._channel.sendEvent("chrome.tabs.onRemoved", [
      tabId,
      removeInfo
    ]);
  }
  debuggerDetached(tabId, reason) {
    this._channel.sendEvent("chrome.debugger.onDetach", [
      { tabId },
      reason
    ]);
  }
  cdpEvent(source, method, params) {
    this._channel.sendEvent("chrome.debugger.onEvent", [
      source,
      method,
      params
    ]);
  }
  async _handleCommand(method, params) {
    switch (method) {
      case "chrome.debugger.attach": {
        const [target, requiredVersion] = params;
        return await this._ownedTab(target).attach(requiredVersion);
      }
      case "chrome.debugger.detach": {
        const [target] = params;
        return await this._ownedTab(target).detach();
      }
      case "chrome.debugger.sendCommand": {
        const [target, cdpMethod, cdpParams] = params;
        checkCdpMethod(cdpMethod);
        return await this._ownedTab(target).sendCommand(
          target.sessionId,
          cdpMethod,
          cdpParams
        );
      }
      case "chrome.tabs.create": {
        const [createProperties = {}] = params;
        const tab = await chrome.tabs.create({
          windowId: this.windowId,
          url: createProperties.url || void 0,
          active: createProperties.active !== false
        });
        if (!tab || tab.id === void 0)
          throw new Error("Failed to create tab in dedicated window");
        if (!this._channel.closed) {
          this._registry.claim(tab, this, {
            announce: false
          });
        }
        return tab;
      }
      case "chrome.tabs.remove": {
        const tabIds = [params[0]].flat();
        for (const tabId of tabIds)
          this._ownedTab({ tabId });
        return await chrome.tabs.remove(tabIds);
      }
    }
    throw new Error(`Unknown method: ${method}`);
  }
  _ownedTab(target) {
    const onlyTabId = (target == null ? void 0 : target.tabId) !== void 0 && target.targetId === void 0 && target.extensionId === void 0;
    const tab = onlyTabId ? this._registry.ownedTab(target.tabId) : void 0;
    if ((tab == null ? void 0 : tab.session) !== this) {
      throw new Error(
        `Tab ${target == null ? void 0 : target.tabId} is not owned by this client`
      );
    }
    return tab;
  }
}
const KEEPALIVE_INTERVAL_MS = 2e4;
class ConnectionBroker {
  constructor(registry, groups, picker, listeners) {
    __publicField(this, "_registry");
    __publicField(this, "_groups");
    __publicField(this, "_picker");
    __publicField(this, "_listeners");
    __publicField(this, "_relayUrls", /* @__PURE__ */ new Map());
    __publicField(this, "_sessions", /* @__PURE__ */ new Map());
    __publicField(this, "_lastSessionId", 0);
    __publicField(this, "_keepaliveTimer");
    this._registry = registry;
    this._groups = groups;
    this._picker = picker;
    this._listeners = listeners;
    listeners.add(chrome.tabs.onRemoved, (tabId) => {
      this._relayUrls.delete(tabId);
      this._didChangeActivity();
      for (const [, session] of this._sessions) {
        if (this._registry.tabIdsOf(session).length === 0) {
          void chrome.windows.get(session.windowId).then((win) => {
            if (!win) session.close("Window closed");
          }).catch(() => {
            session.close("Window closed");
          });
        }
      }
    });
    listeners.add(chrome.windows.onRemoved, (windowId) => {
      for (const [, session] of this._sessions) {
        if (session.windowId === windowId) {
          session.close("Client window closed");
          break;
        }
      }
    });
  }
  async request(connectTabId, relayUrl) {
    this._relayUrls.set(connectTabId, relayUrl);
    this._didChangeActivity();
    await this._registry.reserve(connectTabId);
    await this._groups.ungroup(connectTabId);
  }
  async connect(connectTabId, options, selection) {
    const relayUrl = this._relayUrls.get(connectTabId);
    if (!relayUrl)
      throw new Error("Pending client connection closed");
    this._relayUrls.delete(connectTabId);
    this._registry.unreserve(connectTabId);
    const channel = await Channel.open(relayUrl).catch((error) => {
      this._didChangeActivity();
      throw error;
    });
    let session;
    try {
      if (selection.groupId !== void 0) {
        const { groups } = await this._picker.candidates();
        const group = groups.find((g) => g.id === selection.groupId);
        if (!group)
          throw new Error("This tab group is already connected to another client");
      }
      const selectedTabIds = selection.tabIds ?? [];
      if (selectedTabIds.length > 0) {
        for (const tabId of selectedTabIds) {
          if (tabId === connectTabId)
            throw new Error("Cannot select the connection tab itself.");
          if (!this._registry.isFree(tabId))
            throw new Error(`Tab ${tabId} is already connected to another client`);
          await chrome.tabs.get(tabId);
        }
      }
      const clientWindow = await chrome.windows.create({
        tabId: connectTabId,
        focused: !options.background,
        type: "normal"
      });
      const windowId = clientWindow == null ? void 0 : clientWindow.id;
      if (windowId === void 0) {
        throw new Error(
          "Failed to create a dedicated Chrome window for this client."
        );
      }
      if (selection.groupId !== void 0) {
        try {
          await chrome.tabGroups.move(selection.groupId, {
            windowId,
            index: -1
          });
        } catch {
          const groupTabs = (await chrome.tabs.query({ groupId: selection.groupId })).map((t) => t.id).filter((id) => id !== void 0);
          if (groupTabs.length) {
            await chrome.tabs.move(groupTabs, {
              windowId,
              index: -1
            });
          }
        }
      } else if (selectedTabIds.length > 0) {
        await chrome.tabs.move(selectedTabIds, {
          windowId,
          index: -1
        });
      }
      const newSession = new ClientSession(
        channel,
        this._registry,
        options,
        windowId
      );
      session = newSession;
      const sessionId = ++this._lastSessionId;
      this._sessions.set(sessionId, newSession);
      this._didChangeActivity();
      newSession.onClose = () => {
        this._sessions.delete(sessionId);
        this._didChangeActivity();
        void this._registry.releaseAll(newSession);
        void this._groups.orphan(newSession);
      };
      this._groups.register(newSession);
      const tabs = await this._picker.apply(
        selection,
        newSession,
        connectTabId
      );
      newSession.didInitialize();
      await this._show(tabs, connectTabId, options.background);
    } catch (error) {
      const reason = (error == null ? void 0 : error.message) ?? String(error);
      if (session)
        session.close(reason);
      else
        channel.close(reason);
      this._didChangeActivity();
      throw error;
    }
  }
  async connectDirect(relayUrl, options) {
    const channel = await Channel.open(relayUrl);
    let session;
    try {
      const clientWindow = await chrome.windows.create({
        url: "about:blank",
        focused: !options.background,
        type: "normal"
      });
      const windowId = clientWindow == null ? void 0 : clientWindow.id;
      if (windowId === void 0)
        throw new Error("Failed to create a dedicated Chrome window for this client.");
      const tabs = await chrome.tabs.query({ windowId });
      const workingTab = tabs[0];
      if (!workingTab || workingTab.id === void 0)
        throw new Error("No working tab found in new Chrome window.");
      const newSession = new ClientSession(
        channel,
        this._registry,
        options,
        windowId
      );
      session = newSession;
      const sessionId = ++this._lastSessionId;
      this._sessions.set(sessionId, newSession);
      this._didChangeActivity();
      newSession.onClose = () => {
        this._sessions.delete(sessionId);
        this._didChangeActivity();
        void this._registry.releaseAll(newSession);
        void this._groups.orphan(newSession);
      };
      this._groups.register(newSession);
      await this._registry.claim(workingTab, newSession);
      newSession.didInitialize();
      if (!options.background) {
        await Promise.all([
          chrome.tabs.update(workingTab.id, { active: true }),
          chrome.windows.update(windowId, { focused: true })
        ]).catch(() => {
        });
      }
    } catch (error) {
      const reason = (error == null ? void 0 : error.message) ?? String(error);
      if (session)
        session.close(reason);
      else
        channel.close(reason);
      this._didChangeActivity();
      throw error;
    }
  }
  disconnect(sessionId) {
    var _a;
    (_a = this._sessions.get(sessionId)) == null ? void 0 : _a.close("User disconnected");
  }
  status() {
    return [...this._sessions].map(([id, session]) => ({
      id,
      clientName: session.options.clientName,
      tabIds: this._registry.tabIdsOf(session),
      windowId: session.windowId
    }));
  }
  _didChangeActivity() {
    this._listeners.setEnabled(
      this._sessions.size > 0 || this._relayUrls.size > 0
    );
    if (this._sessions.size && !this._keepaliveTimer) {
      this._keepaliveTimer = setInterval(() => {
        void chrome.runtime.getPlatformInfo();
        void this._pruneDeadSessions();
      }, KEEPALIVE_INTERVAL_MS);
    } else if (!this._sessions.size) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = void 0;
    }
  }
  async _pruneDeadSessions() {
    for (const [, session] of this._sessions) {
      try {
        const win = await chrome.windows.get(session.windowId).catch(() => void 0);
        if (!win) {
          session.close("Window no longer exists");
          continue;
        }
        const tabs = this._registry.tabIdsOf(session);
        if (tabs.length === 0) {
          const winTabs = await chrome.tabs.query({ windowId: session.windowId }).catch(() => []);
          const validTabs = winTabs.filter((t) => {
            var _a;
            return !((_a = t.url) == null ? void 0 : _a.startsWith("chrome-extension://"));
          });
          if (validTabs.length === 0) {
            session.close("No active tabs in window");
          }
        }
      } catch (_) {
        session.close("Session verification failed");
      }
    }
  }
  async _show(tabs, connectTabId, background) {
    const [firstTab] = tabs;
    if (firstTab && !background) {
      await Promise.all([
        chrome.tabs.update(firstTab.id, { active: true }),
        chrome.windows.update(firstTab.windowId, { focused: true })
      ]).catch(() => {
      });
    }
    if (!tabs.some((tab) => tab.id === connectTabId))
      await chrome.tabs.remove(connectTabId).catch(() => {
      });
  }
}
const CLIENT_COLORS = ["green", "blue", "purple", "orange", "pink", "cyan", "yellow", "red"];
const ORPHAN_COLOR = "grey";
const STORAGE_KEY = "clientGroupIds";
class ClientTabGroup {
  constructor(title, defaultTitle, color) {
    __publicField(this, "color");
    __publicField(this, "groupId");
    __publicField(this, "_title");
    __publicField(this, "_defaultTitle");
    this._title = title;
    this._defaultTitle = defaultTitle;
    this.color = color;
  }
  async add(tabId) {
    const isNewGroup = await changeGroups(async () => {
      const isNewGroup2 = this.groupId === void 0;
      this.groupId = await chrome.tabs.group({ groupId: this.groupId, tabIds: [tabId] });
      return isNewGroup2;
    });
    if (isNewGroup)
      await this._applyStyle(this._title ?? this._defaultTitle);
  }
  async adopt(groupId) {
    this.groupId = groupId;
    await this._applyStyle(this._title);
  }
  async _applyStyle(title) {
    const style = title === void 0 ? { color: this.color } : { color: this.color, title };
    await changeGroups(() => chrome.tabGroups.update(this.groupId, style));
  }
}
class TabGroupManager {
  constructor(registry, listeners) {
    __publicField(this, "ready");
    __publicField(this, "_registry");
    __publicField(this, "_groups", /* @__PURE__ */ new Map());
    this._registry = registry;
    this.ready = this._orphanGroupsOfPreviousServiceWorker();
    this._registry.onTabClaimed = (tab, session) => void this._moveIntoGroup(tab, session);
    listeners.add(chrome.tabs.onUpdated, (tabId, changeInfo, tab) => {
      if (changeInfo.groupId !== void 0)
        void this._onTabChangedGroup(tab);
    });
    listeners.add(chrome.tabGroups.onRemoved, (removed) => {
      const session = this._sessionOfGroup(removed.id);
      if (!session)
        return;
      this._groups.get(session).groupId = void 0;
      void this._recordClientGroups();
    });
  }
  register(session) {
    const options = session.options.tabGroup;
    if (!options)
      return;
    const color = options.color ?? this._firstFreeColor();
    if (!CLIENT_COLORS.includes(color))
      throw new Error(`Unsupported tab group color "${color}". Use one of: ${CLIENT_COLORS.join(", ")}.`);
    this._groups.set(session, new ClientTabGroup(options.title, `Playwright · ${session.options.clientName}`, color));
  }
  async adopt(groupId, session) {
    const group = this._groups.get(session);
    if (!group)
      return;
    await group.adopt(groupId);
    await this._recordClientGroups();
  }
  async orphan(session) {
    var _a;
    const groupId = (_a = this._groups.get(session)) == null ? void 0 : _a.groupId;
    this._groups.delete(session);
    if (groupId === void 0)
      return;
    await markOrphan(groupId);
    await this._recordClientGroups();
  }
  async unclaimedGroups() {
    const groups = await chrome.tabGroups.query({});
    return groups.filter((group) => !this._sessionOfGroup(group.id));
  }
  async ungroup(tabId) {
    await changeGroups(() => chrome.tabs.ungroup(tabId)).catch(() => {
    });
  }
  // The registry changed an owner: bring the group in line with it.
  async _moveIntoGroup(tab, session) {
    const group = this._groups.get(session);
    if (!group || tab.groupId === group.groupId)
      return;
    if (tab.windowId !== session.windowId)
      return;
    const isNewGroup = group.groupId === void 0;
    await group.add(tab.id).catch(() => {
    });
    if (isNewGroup)
      await this._recordClientGroups();
  }
  // The user changed a group: bring the owner in line with it.
  async _onTabChangedGroup(tab) {
    const tabId = tab.id;
    await pendingGroupChanges;
    const groupOwner = this._sessionOfGroup(tab.groupId);
    const owner = this._registry.ownerOf(tabId);
    if (groupOwner === owner)
      return;
    if (groupOwner && this._registry.isReserved(tabId))
      await this.ungroup(tabId);
    else if (groupOwner)
      await this._registry.transfer(tab, groupOwner);
    else if (this._groups.has(owner)) {
      const session = owner;
      if (tab.windowId !== session.windowId)
        return;
      await this._registry.release(tabId);
    }
  }
  _sessionOfGroup(groupId) {
    for (const [session, group] of this._groups) {
      if (group.groupId === groupId)
        return session;
    }
  }
  _firstFreeColor() {
    const used = new Set([...this._groups.values()].map((group) => group.color));
    return CLIENT_COLORS.find((color) => !used.has(color)) ?? CLIENT_COLORS[0];
  }
  async _recordClientGroups() {
    const groupIds = [...this._groups.values()].map((group) => group.groupId).filter((groupId) => groupId !== void 0);
    await chrome.storage.session.set({ [STORAGE_KEY]: groupIds });
  }
  // A new service worker has no sessions, so the client groups it finds have no client.
  async _orphanGroupsOfPreviousServiceWorker() {
    const { [STORAGE_KEY]: groupIds = [] } = await chrome.storage.session.get(STORAGE_KEY);
    await Promise.all(groupIds.map(markOrphan));
    await chrome.storage.session.remove(STORAGE_KEY);
  }
}
async function markOrphan(groupId) {
  await changeGroups(() => chrome.tabGroups.update(groupId, { color: ORPHAN_COLOR })).catch(() => {
  });
}
let pendingGroupChanges = Promise.resolve();
function changeGroups(change) {
  const result = pendingGroupChanges.then(() => retryOnDrag(change));
  pendingGroupChanges = result.catch(() => {
  });
  return result;
}
async function retryOnDrag(action) {
  var _a;
  for (const delay of [100, 200, 400, 800]) {
    try {
      return await action();
    } catch (error) {
      if (!((_a = error == null ? void 0 : error.message) == null ? void 0 : _a.includes("user may be dragging a tab")))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return await action();
}
const NON_DEBUGGABLE_SCHEMES = ["chrome:", "edge:", "devtools:"];
const REANNOUNCE_DELAY_MS = 150;
const REANNOUNCE_COOLDOWN_MS = 3e3;
function isDebuggableUrl(url) {
  return !NON_DEBUGGABLE_SCHEMES.some((scheme) => url == null ? void 0 : url.startsWith(scheme));
}
class OwnedTab {
  constructor(tab, session, announce) {
    __publicField(this, "tabId");
    __publicField(this, "session");
    __publicField(this, "_announced");
    __publicField(this, "_attached", false);
    __publicField(this, "_disposed", false);
    __publicField(this, "_lastReannounceTime", 0);
    this.tabId = tab.id;
    this.session = session;
    this._announced = !announce;
    this._announce(tab);
  }
  async attach(requiredVersion) {
    await chrome.debugger.attach({ tabId: this.tabId }, requiredVersion);
    if (this._disposed) {
      await this._detachDebugger();
      return;
    }
    this._setAttached(true);
  }
  async detach() {
    this._setAttached(false);
    await chrome.debugger.detach({ tabId: this.tabId });
  }
  async sendCommand(cdpSessionId, method, params) {
    const target = cdpSessionId ? { tabId: this.tabId, sessionId: cdpSessionId } : { tabId: this.tabId };
    return await chrome.debugger.sendCommand(target, method, params);
  }
  async dispose() {
    this._disposed = true;
    if (!this._attached)
      return;
    this._setAttached(false);
    await this._detachDebugger();
  }
  didNavigate(tab) {
    if (this._attached)
      showBadge(this.tabId, true);
    this._announce(tab);
  }
  didReceiveDebuggerEvent(source, method, params) {
    if (this._attached)
      this.session.cdpEvent(source, method, params);
  }
  didDetachDebugger(reason) {
    this._setAttached(false);
    this.session.debuggerDetached(this.tabId, reason);
    if (reason === "target_closed")
      this._reannounceLater();
  }
  _reannounceLater() {
    const now = Date.now();
    if (now - this._lastReannounceTime < REANNOUNCE_COOLDOWN_MS)
      return;
    this._lastReannounceTime = now;
    setTimeout(async () => {
      const tab = await chrome.tabs.get(this.tabId).catch(() => void 0);
      if (tab && !this._disposed)
        this._announce(tab);
    }, REANNOUNCE_DELAY_MS);
  }
  // The client attaches the debugger to each tab that is announced to it.
  _announce(tab) {
    if (this._announced || !isDebuggableUrl(tab.url))
      return;
    this._announced = true;
    this.session.tabClaimed(tab);
  }
  _setAttached(attached) {
    this._attached = attached;
    if (!attached)
      this._announced = false;
    showBadge(this.tabId, attached);
  }
  async _detachDebugger() {
    await chrome.debugger.detach({ tabId: this.tabId }).catch(() => {
    });
  }
}
async function detachDebuggersOfPreviousServiceWorker() {
  const targets = await chrome.debugger.getTargets();
  await Promise.all(targets.map(async ({ tabId, attached }) => {
    if (tabId === void 0 || !attached)
      return;
    await chrome.debugger.detach({ tabId }).then(() => showBadge(tabId, false), () => {
    });
  }));
}
function showBadge(tabId, attached) {
  const updates = attached ? [
    chrome.action.setBadgeText({ tabId, text: "✓" }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#4CAF50" }),
    chrome.action.setTitle({ tabId, title: "Connected to Playwright client" })
  ] : [
    chrome.action.setBadgeText({ tabId, text: "" }),
    chrome.action.setTitle({ tabId, title: "" })
  ];
  void Promise.all(updates).catch(() => {
  });
}
class TabPicker {
  constructor(registry, groups) {
    __publicField(this, "_registry");
    __publicField(this, "_groups");
    this._registry = registry;
    this._groups = groups;
  }
  async candidates() {
    const [allTabs, groups] = await Promise.all([chrome.tabs.query({}), this._groups.unclaimedGroups()]);
    const isFree = (tab) => this._registry.isFree(tab.id);
    return {
      // A group is taken as a whole, so all its tabs must be free.
      groups: groups.map((group) => ({
        id: group.id,
        title: group.title ?? "",
        color: group.color,
        tabs: allTabs.filter((tab) => tab.groupId === group.id)
      })).filter((group) => group.tabs.every(isFree)),
      tabs: allTabs.filter((tab) => isFree(tab) && isDebuggableUrl(tab.url))
    };
  }
  async apply(selection, session, connectTabId) {
    const tabs = await this._selectedTabs(selection, session, connectTabId);
    for (const tab of tabs)
      this._registry.claim(tab, session);
    return tabs;
  }
  async _selectedTabs(selection, session, connectTabId) {
    var _a;
    if (selection.groupId !== void 0) {
      const { groups } = await this.candidates();
      const group = groups.find((group2) => group2.id === selection.groupId);
      if (!group)
        throw new Error("This tab group is already connected to another client");
      await this._groups.adopt(group.id, session);
      return group.tabs;
    }
    if ((_a = selection.tabIds) == null ? void 0 : _a.length)
      return await Promise.all(selection.tabIds.map((tabId) => chrome.tabs.get(tabId)));
    const blankTab = await chrome.tabs.update(connectTabId, { url: "about:blank" });
    return [blankTab];
  }
}
class TabRegistry {
  constructor(listeners) {
    __publicField(this, "ready", detachDebuggersOfPreviousServiceWorker());
    __publicField(this, "_tabs", /* @__PURE__ */ new Map());
    __publicField(this, "_reservedTabIds", /* @__PURE__ */ new Set());
    __publicField(this, "onTabClaimed");
    listeners.add(chrome.tabs.onCreated, (tab) => this._onTabCreated(tab));
    listeners.add(chrome.tabs.onRemoved, (tabId, removeInfo) => this._onTabRemoved(tabId, removeInfo));
    listeners.add(chrome.tabs.onUpdated, (tabId, changeInfo, tab) => {
      var _a;
      if (changeInfo.url !== void 0)
        (_a = this._tabs.get(tabId)) == null ? void 0 : _a.didNavigate(tab);
    });
    listeners.add(chrome.debugger.onEvent, (source, method, params) => {
      var _a;
      (_a = this._tabs.get(source.tabId)) == null ? void 0 : _a.didReceiveDebuggerEvent(source, method, params);
    });
    listeners.add(chrome.debugger.onDetach, (source, reason) => {
      var _a;
      (_a = this._tabs.get(source.tabId)) == null ? void 0 : _a.didDetachDebugger(reason);
    });
  }
  // A reserved tab has no owner, and no client can claim it.
  async reserve(tabId) {
    this._reservedTabIds.add(tabId);
    await this.release(tabId);
  }
  unreserve(tabId) {
    this._reservedTabIds.delete(tabId);
  }
  isReserved(tabId) {
    return this._reservedTabIds.has(tabId);
  }
  isFree(tabId) {
    return !this._tabs.has(tabId) && !this._reservedTabIds.has(tabId);
  }
  ownedTab(tabId) {
    return this._tabs.get(tabId);
  }
  ownerOf(tabId) {
    var _a;
    return (_a = this._tabs.get(tabId)) == null ? void 0 : _a.session;
  }
  tabIdsOf(session) {
    return [...this._tabs.values()].filter((tab) => tab.session === session).map((tab) => tab.tabId);
  }
  claim(tab, session, options = { announce: true }) {
    var _a;
    const tabId = tab.id;
    const owner = this.ownerOf(tabId);
    if (owner === session)
      return;
    if (owner)
      throw new Error("This tab is already connected to another client");
    if (this._reservedTabIds.has(tabId))
      throw new Error("This tab is a connect page");
    this._tabs.set(tabId, new OwnedTab(tab, session, options.announce));
    (_a = this.onTabClaimed) == null ? void 0 : _a.call(this, tab, session);
  }
  async release(tabId) {
    const tab = this._tabs.get(tabId);
    if (!tab)
      return;
    this._tabs.delete(tabId);
    tab.session.tabReleased(tabId);
    await tab.dispose();
  }
  async transfer(tab, to) {
    await this.release(tab.id);
    this.claim(tab, to);
  }
  async releaseAll(session) {
    await Promise.all(this.tabIdsOf(session).map((tabId) => this.release(tabId)));
  }
  _onTabCreated(tab) {
    const opener = tab.openerTabId === void 0 ? void 0 : this.ownerOf(tab.openerTabId);
    if (opener)
      this.claim(tab, opener);
  }
  _onTabRemoved(tabId, removeInfo) {
    this._reservedTabIds.delete(tabId);
    const tab = this._tabs.get(tabId);
    if (!tab)
      return;
    this._tabs.delete(tabId);
    tab.session.tabClosed(tabId, removeInfo);
    void tab.dispose();
  }
}
class Extension {
  constructor() {
    __publicField(this, "_broker");
    __publicField(this, "_picker");
    __publicField(this, "_ready");
    __publicField(this, "_controlWs", null);
    const listeners = new ChromeListeners();
    const registry = new TabRegistry(listeners);
    const groups = new TabGroupManager(registry, listeners);
    this._ready = Promise.all([registry.ready, groups.ready]);
    this._picker = new TabPicker(registry, groups);
    this._broker = new ConnectionBroker(registry, groups, this._picker, listeners);
    chrome.runtime.onMessage.addListener(this._onMessage.bind(this));
    chrome.action.onClicked.addListener(() => void this._showManagePage());
    chrome.alarms.create("mcp_keepalive", { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "mcp_keepalive") {
        void this._connectControlPlane();
      }
    });
    this._connectControlPlane();
  }
  async _connectControlPlane() {
    if (this._controlWs && (this._controlWs.readyState === WebSocket.OPEN || this._controlWs.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      const reachable = await fetch("http://127.0.0.1:45454/ping").then((r) => r.ok).catch(() => false);
      if (!reachable) {
        this._controlWs = null;
        setTimeout(() => void this._connectControlPlane(), 2500);
        return;
      }
      if (this._controlWs && (this._controlWs.readyState === WebSocket.OPEN || this._controlWs.readyState === WebSocket.CONNECTING)) {
        return;
      }
      const ws = new WebSocket("ws://127.0.0.1:45454");
      this._controlWs = ws;
      ws.onopen = () => {
        console.log("[Playwright Extension] Connected to multiplexer on 45454");
      };
      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "connectDirect") {
            await this._ready;
            await this._broker.connectDirect(msg.relayUrl, msg.options || { clientName: "Agent", background: false });
          }
        } catch (err) {
          console.error("[Playwright Extension] Control plane error:", err);
        }
      };
      ws.onclose = () => {
        if (this._controlWs === ws) this._controlWs = null;
        setTimeout(() => void this._connectControlPlane(), 2e3);
      };
      ws.onerror = () => {
        if (this._controlWs === ws) this._controlWs = null;
        try {
          ws.close();
        } catch (_) {
        }
      };
    } catch {
      this._controlWs = null;
      setTimeout(() => void this._connectControlPlane(), 2500);
    }
  }
  async _showManagePage() {
    const url = chrome.runtime.getURL("manage.html");
    const [tab] = await chrome.tabs.query({ url });
    if (!tab) {
      await chrome.tabs.create({ url });
      return;
    }
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  // Chrome does not support promise-based message handlers: https://issues.chromium.org/issues/40753031
  _onMessage(message, sender, sendResponse) {
    var _a;
    this._handleMessage(message, (_a = sender.tab) == null ? void 0 : _a.id).then(
      (result) => sendResponse({ success: true, ...result }),
      (error) => sendResponse({ success: false, error: error.message })
    );
    return true;
  }
  async _handleMessage(message, senderTabId) {
    await this._ready;
    switch (message.type) {
      case "connectionRequested":
        return await this._broker.request(senderTabId, message.mcpRelayUrl);
      case "getCandidates":
        return await this._picker.candidates();
      case "connect":
        return await this._broker.connect(senderTabId, message.options, message.selection);
      case "getStatus":
        return { sessions: this._broker.status() };
      case "disconnect":
        return this._broker.disconnect(message.sessionId);
      case "keepalive":
        return;
    }
  }
}
new Extension();

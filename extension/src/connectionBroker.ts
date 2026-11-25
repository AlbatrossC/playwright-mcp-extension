/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Channel } from './channel';
import { ClientSession } from './clientSession';

import type { ChromeListeners } from './chromeListeners';
import type { TabGroupManager } from './tabGroupManager';
import type { TabPicker } from './tabPicker';
import type { TabRegistry } from './tabRegistry';
import type { Selection, SessionOptions, SessionStatus } from './types';

const KEEPALIVE_INTERVAL_MS = 20_000;

export class ConnectionBroker {
  private _registry: TabRegistry;
  private _groups: TabGroupManager;
  private _picker: TabPicker;
  private _listeners: ChromeListeners;

  private _relayUrls = new Map<number, string>();
  private _sessions = new Map<number, ClientSession>();

  private _lastSessionId = 0;
  private _keepaliveTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    registry: TabRegistry,
    groups: TabGroupManager,
    picker: TabPicker,
    listeners: ChromeListeners
  ) {
    this._registry = registry;
    this._groups = groups;
    this._picker = picker;
    this._listeners = listeners;

    listeners.add(chrome.tabs.onRemoved, tabId => {
      this._relayUrls.delete(tabId);
      this._didChangeActivity();
      for (const [, session] of this._sessions) {
        if (this._registry.tabIdsOf(session).length === 0) {
          void chrome.windows.get(session.windowId).then(win => {
            if (!win) session.close('Window closed');
          }).catch(() => {
            session.close('Window closed');
          });
        }
      }
    });

    listeners.add(chrome.windows.onRemoved, windowId => {
      for (const [, session] of this._sessions) {
        if (session.windowId === windowId) {
          session.close('Client window closed');
          break;
        }
      }
    });
  }

  async request(connectTabId: number, relayUrl: string): Promise<void> {
    this._relayUrls.set(connectTabId, relayUrl);
    this._didChangeActivity();

    // Chrome can open the connect page inside the group of a client.
    await this._registry.reserve(connectTabId);
    await this._groups.ungroup(connectTabId);
  }

  async connect(
    connectTabId: number,
    options: SessionOptions,
    selection: Selection
  ): Promise<void> {
    const relayUrl = this._relayUrls.get(connectTabId);

    if (!relayUrl)
      throw new Error('Pending client connection closed');

    this._relayUrls.delete(connectTabId);
    this._registry.unreserve(connectTabId);

    const channel = await Channel.open(relayUrl).catch(error => {
      this._didChangeActivity();
      throw error;
    });

    let session: ClientSession | undefined;

    try {
      /*
       * Validate the selection before creating a dedicated window or moving tabs.
       */
      if (selection.groupId !== undefined) {
        const { groups } = await this._picker.candidates();
        const group = groups.find(g => g.id === selection.groupId);
        if (!group)
          throw new Error('This tab group is already connected to another client');
      }

      const selectedTabIds = selection.tabIds ?? [];
      if (selectedTabIds.length > 0) {
        for (const tabId of selectedTabIds) {
          if (tabId === connectTabId)
            throw new Error('Cannot select the connection tab itself.');

          if (!this._registry.isFree(tabId))
            throw new Error(`Tab ${tabId} is already connected to another client`);

          // Ensure the tab exists
          await chrome.tabs.get(tabId);
        }
      }

      /*
       * Create a dedicated Chrome window for this MCP client.
       *
       * Chrome moves the existing connection tab into this new window.
       * This avoids creating an unnecessary extra connection tab.
       *
       * background=true creates an unfocused window.
       */
      const clientWindow = await chrome.windows.create({
        tabId: connectTabId,
        focused: !options.background,
        type: 'normal',
      });

      const windowId = clientWindow?.id;

      if (windowId === undefined) {
        throw new Error(
          'Failed to create a dedicated Chrome window for this client.'
        );
      }

      /*
       * Move selected resources into this client's dedicated window.
       * If selecting a group, move the group (or its tabs) into the window.
       * If selecting individual tabs, move them into the window.
       * Otherwise, TabPicker converts the connection tab into the working tab.
       */
      if (selection.groupId !== undefined) {
        try {
          await chrome.tabGroups.move(selection.groupId, {
            windowId,
            index: -1,
          });
        } catch {
          const groupTabs = (await chrome.tabs.query({ groupId: selection.groupId })).map(t => t.id!).filter((id): id is number => id !== undefined);
          if (groupTabs.length) {
            await chrome.tabs.move(groupTabs, {
              windowId,
              index: -1,
            });
          }
        }
      } else if (selectedTabIds.length > 0) {
        await chrome.tabs.move(selectedTabIds, {
          windowId,
          index: -1,
        });
      }

      // Every session now knows which Chrome window it owns.
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

        // Release browser debugging ownership.
        void this._registry.releaseAll(newSession);

        // Preserve the tab group as an orphaned group.
        void this._groups.orphan(newSession);
      };

      this._groups.register(newSession);

      const tabs = await this._picker.apply(
        selection,
        newSession,
        connectTabId
      );

      newSession.didInitialize();

      // Activate the client's working tab when background mode is disabled.
      // Remove the temporary connection page if it is no longer needed.
      await this._show(tabs, connectTabId, options.background);

    } catch (error: any) {
      const reason = error?.message ?? String(error);

      if (session)
        session.close(reason);
      else
        channel.close(reason);

      this._didChangeActivity();

      throw error;
    }
  }

  async connectDirect(
    relayUrl: string,
    options: SessionOptions
  ): Promise<void> {
    const channel = await Channel.open(relayUrl);

    let session: ClientSession | undefined;

    try {
      const clientWindow = await chrome.windows.create({
        url: 'about:blank',
        focused: !options.background,
        type: 'normal',
      });

      const windowId = clientWindow?.id;
      if (windowId === undefined)
        throw new Error('Failed to create a dedicated Chrome window for this client.');

      const tabs = await chrome.tabs.query({ windowId });
      const workingTab = tabs[0];
      if (!workingTab || workingTab.id === undefined)
        throw new Error('No working tab found in new Chrome window.');

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
          chrome.windows.update(windowId, { focused: true }),
        ]).catch(() => {});
      }
    } catch (error: any) {
      const reason = error?.message ?? String(error);
      if (session)
        session.close(reason);
      else
        channel.close(reason);
      this._didChangeActivity();
      throw error;
    }
  }

  disconnect(sessionId: number): void {
    this._sessions.get(sessionId)?.close('User disconnected');
  }

  status(): SessionStatus[] {
    return [...this._sessions].map(([id, session]) => ({
      id,
      clientName: session.options.clientName,
      tabIds: this._registry.tabIdsOf(session),
      windowId: session.windowId,
    }));
  }

  getWindowIdForSession(sessionName?: string): number | undefined {
    if (sessionName) {
      for (const [, session] of this._sessions) {
        if (session.options.clientName === sessionName)
          return session.windowId;
      }
      for (const [, session] of this._sessions) {
        if (session.options.clientName?.includes(sessionName))
          return session.windowId;
      }
    }
    const all = [...this._sessions.values()];
    return all.length ? all[all.length - 1].windowId : undefined;
  }

  private _didChangeActivity(): void {
    this._listeners.setEnabled(
      this._sessions.size > 0 || this._relayUrls.size > 0
    );

    // Chrome stops an idle service worker, and the sessions with it.
    // A call of an extension API resets the idle timer.
    if (this._sessions.size && !this._keepaliveTimer) {
      this._keepaliveTimer = setInterval(() => {
        void chrome.runtime.getPlatformInfo();
        void this._pruneDeadSessions();
      }, KEEPALIVE_INTERVAL_MS);
    } else if (!this._sessions.size) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = undefined;
    }
  }

  private async _pruneDeadSessions(): Promise<void> {
    for (const [, session] of this._sessions) {
      try {
        const win = await chrome.windows.get(session.windowId).catch(() => undefined);
        if (!win) {
          session.close('Window no longer exists');
          continue;
        }
        const tabs = this._registry.tabIdsOf(session);
        if (tabs.length === 0) {
          const winTabs = await chrome.tabs.query({ windowId: session.windowId }).catch(() => []);
          const validTabs = winTabs.filter(t => !t.url?.startsWith('chrome-extension://'));
          if (validTabs.length === 0) {
            session.close('No active tabs in window');
          }
        }
      } catch (_) {
        session.close('Session verification failed');
      }
    }
  }

  private async _show(
    tabs: chrome.tabs.Tab[],
    connectTabId: number,
    background: boolean
  ): Promise<void> {
    const [firstTab] = tabs;

    if (firstTab && !background) {
      await Promise.all([
        chrome.tabs.update(firstTab.id!, { active: true }),
        chrome.windows.update(firstTab.windowId, { focused: true }),
      ]).catch(() => { });
    }

    // In selected-tab or group mode, the original connection tab is temporary.
    // In automatic mode, the connection tab becomes the working tab.
    if (!tabs.some(tab => tab.id === connectTabId))
      await chrome.tabs.remove(connectTabId).catch(() => { });
  }
}

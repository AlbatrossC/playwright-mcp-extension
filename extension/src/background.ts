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


import { ChromeListeners } from './chromeListeners';
import { ConnectionBroker } from './connectionBroker';
import { runMultiTabExtract } from './multiTabExtract';
import { TabGroupManager } from './tabGroupManager';
import { TabPicker } from './tabPicker';
import { TabRegistry } from './tabRegistry';

import type { PageMessage } from './types';

class Extension {
  private _broker: ConnectionBroker;
  private _picker: TabPicker;
  private _ready: Promise<unknown>;
  private _controlWs: WebSocket | null = null;

  constructor() {
    const listeners = new ChromeListeners();
    const registry = new TabRegistry(listeners);
    const groups = new TabGroupManager(registry, listeners);
    this._ready = Promise.all([registry.ready, groups.ready]);
    this._picker = new TabPicker(registry, groups);
    this._broker = new ConnectionBroker(registry, groups, this._picker, listeners);
    chrome.runtime.onMessage.addListener(this._onMessage.bind(this));
    chrome.action.onClicked.addListener(() => void this._showManagePage());

    // Keepalive alarm to wake up background service worker in MV3
    chrome.alarms.create('mcp_keepalive', { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === 'mcp_keepalive') {
        void this._connectControlPlane();
      }
    });

    this._connectControlPlane();
  }

  private async _connectControlPlane(): Promise<void> {
    if (this._controlWs && (this._controlWs.readyState === WebSocket.OPEN || this._controlWs.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      // Quietly probe /ping via fetch first so Chromium doesn't log ERR_CONNECTION_REFUSED
      // to chrome://extensions when the server isn't running yet
      const reachable = await fetch('http://127.0.0.1:45454/ping')
        .then(r => r.ok)
        .catch(() => false);

      if (!reachable) {
        this._controlWs = null;
        setTimeout(() => void this._connectControlPlane(), 2500);
        return;
      }

      if (this._controlWs && (this._controlWs.readyState === WebSocket.OPEN || this._controlWs.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const ws = new WebSocket('ws://127.0.0.1:45454');
      this._controlWs = ws;

      ws.onopen = () => {
        console.log('[Playwright Extension] Connected to multiplexer on 45454');
      };
      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connectDirect') {
            await this._ready;
            await this._broker.connectDirect(msg.relayUrl, msg.options || { clientName: 'Agent', background: false });
          } else if (msg.type === 'multiTabExtract') {
            await this._ready;
            const windowId = this._broker.getWindowIdForSession(msg.sessionId);
            const result = await runMultiTabExtract(msg, windowId);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'multiTabExtractResult',
                requestId: msg.requestId,
                result
              }));
            }
          }
        } catch (err) {
          console.error('[Playwright Extension] Control plane error:', err);
        }
      };
      ws.onclose = () => {
        if (this._controlWs === ws) this._controlWs = null;
        setTimeout(() => void this._connectControlPlane(), 2000);
      };
      ws.onerror = () => {
        if (this._controlWs === ws) this._controlWs = null;
        try { ws.close(); } catch (_) {}
      };
    } catch {
      this._controlWs = null;
      setTimeout(() => void this._connectControlPlane(), 2500);
    }
  }

  private async _showManagePage(): Promise<void> {
    const url = chrome.runtime.getURL('manage.html');
    const [tab] = await chrome.tabs.query({ url });
    if (!tab) {
      await chrome.tabs.create({ url });
      return;
    }
    await chrome.tabs.update(tab.id!, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  // Chrome does not support promise-based message handlers: https://issues.chromium.org/issues/40753031
  private _onMessage(message: PageMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: object) => void): boolean {
    this._handleMessage(message, sender.tab?.id).then(
        result => sendResponse({ success: true, ...result }),
        error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  private async _handleMessage(message: PageMessage, senderTabId: number | undefined): Promise<object | void> {
    await this._ready;
    switch (message.type) {
      case 'connectionRequested':
        return await this._broker.request(senderTabId!, message.mcpRelayUrl);
      case 'getCandidates':
        return await this._picker.candidates();
      case 'connect':
        return await this._broker.connect(senderTabId!, message.options, message.selection);
      case 'getStatus':
        return { sessions: this._broker.status() };
      case 'disconnect':
        return this._broker.disconnect(message.sessionId);
      case 'keepalive':
        // The message itself resets the idle timer of the service worker.
        return;
    }
  }
}

new Extension();

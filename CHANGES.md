# Playwright MCP Extension: Changelog & Architecture Guide

This document details the motivations, architectural overhaul, and code-level modifications implemented in this fork of `@playwright/mcp`. It is written for developers and engineers integrating or extending multi-agent browser automation.

---

## 1. Motivation: Why This Fork Was Built

### The Problem with Default `@playwright/mcp`
In standard `@playwright/mcp`, all browser interactions are routed to tabs inside a **single shared browser window**. While sufficient for a single human user or a sequential task, this model breaks down completely in modern multi-agent systems:

1. **Focus Stealing & Keystroke Interception**:
   When two or more AI agents run concurrently (e.g., an agent scraping job postings while another conducts research on GitHub), they constantly switch the active tab. Keystrokes (`browser_type`), clicks (`browser_click`), and scrolling actions collide, corrupting both workflows.
2. **Conflicting Tab Groups**:
   Standard Playwright MCP creates tab groups inside one window. Concurrent agents accidentally modify each other's tab groups, leading to tab closing race conditions.
3. **No Side-by-Side Visual Monitoring**:
   Developers cannot tile agent windows across desktop displays to visually inspect agent decisions in real time.
4. **Fragility of Headless Environments**:
   Modern platforms (LinkedIn, Google, financial portals, internal intranets) employ sophisticated anti-bot challenges. Agents must operate within the user's **real, authenticated browser profile** (`Profile 1`, `Profile 4`, `Default`) with persistent cookies, active sessions, and 2FA credentials retained.

### The Objective
Transform `@playwright/mcp` into an enterprise-grade **multi-agent browser multiplexer** where:
- Every agent session (`session_id`) receives its own **physically isolated desktop window**.
- Multiple agents run concurrently without interference or cross-talk.
- Multiple MCP client applications (e.g., Google Antigravity, OpenMausBot, Dusk Bot, Claude Desktop, Cursor) can run on the same machine simultaneously without port conflicts.
- All window lifecycles are clean, deterministic, and self-healing.

---

## 2. Architecture Overview

```
                      +-------------------------------------------------------------+
                      |                      AI Host Applications                   |
                      |   (Antigravity, OpenMausBot, Dusk Bot, Claude, LangGraph)   |
                      +------------------------------+------------------------------+
                                                     | stdio (JSON-RPC 2.0)
                                                     v
                      +-------------------------------------------------------------+
                      |         playwright-mcp-extension Multiplexer (index.js)     |
                      |                                                             |
                      |  * Primary Mode: Binds Port 45454 (WebSocket + HTTP)        |
                      |  * Satellite Mode: Gracefully shares Port 45454 with primary|
                      |  * Session Map: SESSIONS.get(sessionId)                     |
                      +--------------+------------------------------+---------------+
                                     |                              |
               HTTP POST /connect    |                              | HTTP POST /connect
               (Session "jobs")      |                              | (Session "news")
                                     v                              v
               +-----------------------------+      +-------------------------------+
               | Child @playwright/mcp Cli 1 |      | Child @playwright/mcp Cli 2   |
               | (PID: 1024, Session: jobs)  |      | (PID: 1025, Session: news)    |
               +--------------+--------------+      +---------------+---------------+
                              |                                     |
                              | ws://[::1]:PORT1                    | ws://[::1]:PORT2
                              v                                     v
+-----------------------------------------------------------------------------------+
|                            Chrome Extension (MV3)                                 |
|                                                                                   |
|  * background.ts: Connects to ws://127.0.0.1:45454                                |
|  * connectionBroker.ts: Creates Window A for PORT1, Window B for PORT2            |
|  * clientSession.ts: Confines all tabs to their dedicated windowId                |
|  * Background Pruning: Reaps dead sessions when windows close                     |
+-----------------------------------+-------------------------------+---------------+
                                    |                               |
                                    v                               v
                     +-----------------------------+ +------------------------------+
                     | Dedicated Chrome Window 1   | | Dedicated Chrome Window 2    |
                     | "Agent Jobs" (Profile 4)    | | "Agent News" (Profile 4)     |
                     +-----------------------------+ +------------------------------+
```

---

## 3. Detailed Breakdown of Code Changes

### A. Dynamic Primary / Satellite Multiplexer (`index.js`)

#### 1. Multi-Host Port 45454 Conflict Resolution
- **Problem**: When multiple AI applications (e.g. Antigravity and Dusk Bot) run concurrently on the same machine, both spawn `playwright-mcp-extension`. The second instance encountered `EADDRINUSE` on port 45454 and called `process.exit(1)`, causing the second app to fail with:
  `"The server stopped before the MCP handshake finished."`
- **Solution**: Removed the fatal `process.exit(1)`. When port 45454 is in use, the server logs:
  `[Multiplexer] Port 45454 is active (shared control plane detected). Running in satellite mode.`
  and immediately continues running its MCP stdio loop.
- **Satellite Signaling**: When an agent in a satellite instance calls a tool, its child Playwright process sends `POST http://127.0.0.1:45454/connect`. The *primary* instance (which owns port 45454) receives this request and signals the Chrome extension via WebSocket. Both hosts share the single Chrome extension bridge seamlessly.

#### 2. Automatic Failover & Self-Promotion
- If the primary host process exits or terminates, the satellite instance detects the dropped `/ping` health check (checked every 5 seconds) and automatically promotes itself to **Primary**, binding port 45454. The Chrome extension reconnects to it automatically.

#### 3. Environment Variable Sanitization
- Added `.trim()` to `PLAYWRIGHT_CHROME_PROFILE`, `PLAYWRIGHT_MCP_EXTENSION_TOKEN`, and `PLAYWRIGHT_BROWSER`. Prevents accidental whitespace or leading tab characters (e.g., `"\tProfile 4"`) pasted into GUI settings forms from breaking profile directory discovery.

---

### B. Core Patcher (`patcher.js`)

#### 1. Direct-Connect Window Hooking
- Patches `playwright-core/lib/coreBundle.js` dynamically via `postinstall` and `setup.js`.
- Intercepts `_openConnectPageInBrowser`. Instead of opening a noisy `connect.html` browser tab, it dispatches an HTTP POST payload directly to `http://127.0.0.1:45454/connect`:
  ```javascript
  const payload = JSON.stringify({
    relayUrl: mcpRelayEndpoint,
    options: { clientName, tabGroup: tabGroup ? { title: tabGroup.title, color: tabGroup.color } : undefined, background: !!this._background }
  });
  ```
- Guarantees instant window creation with zero user friction.

#### 2. Robustness & Incompatibility Guards
- Replaced silent fallbacks with clear warnings if `playwright-core` is missing or if bundle paths change across versions.
- Ensures idempotency: skips re-patching if the marker string (`45454`) is already detected in the bundle.

---

### C. Extension Background Engine (`extension/src/`)

#### 1. Strict Window Confinement (`clientSession.ts`)
- **Problem**: When an agent clicked a link or triggered an action that opened a new tab, standard Playwright MCP extension code called `chrome.windows.create`, spawning an unmanaged separate window.
- **Solution**: Replaced `chrome.windows.create` with:
  ```typescript
  await chrome.tabs.create({ windowId: this.windowId, url: 'about:blank' });
  ```
  All subsequent tabs opened during an agent's turn remain strictly confined to that agent's dedicated window ID.

#### 2. Self-Healing Background Session Pruning (`connectionBroker.ts`)
- Added `_pruneDeadSessions()`: Periodically queries Chrome's active window registry. If an agent window is manually closed by the user or terminated by the host, the extension automatically purges the session from memory.
- Ensures the `manage.html` dashboard accurately returns to `0 active agents` instead of holding orphaned zombie sessions.

#### 3. Cross-Context Token Storage (`authToken.tsx`, `manage.tsx`)
- Tokens generated in `manage.html` are now synchronized to `chrome.storage.local` in addition to `localStorage`. This ensures Manifest V3 background service workers always have immediate, non-blocking access to the authentication token without race conditions.

---

### D. Dashboard & UI/UX Improvements (`extension/src/ui/`)

#### 1. Raw Token Copying vs. Env Export
- **Problem**: Previously, clicking "Copy token" in `manage.html` copied:
  `PLAYWRIGHT_MCP_EXTENSION_TOKEN=a1b2c3d4-sample-token-XYZ`
  When pasting into GUI configuration forms (OpenMausBot, Cursor, Dusk Bot), users had to manually delete the prefix.
- **Solution**:
  - **"Copy token"**: Copies *only* the raw token string (`a1b2c3d4-sample...`).
  - **"Copy as KEY=VAL"**: Added a dedicated secondary button for developers needing the full export line for bash or `.env` files.

#### 2. Elimination of Token Truncation
- **Problem**: In `manage.css`, `.field code` had `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`. In a 360px card, half the 43-character token was cut off with `...`.
- **Solution**:
  - Applied `word-break: break-all; overflow-wrap: anywhere; white-space: normal; user-select: all;`.
  - The token wraps cleanly across two lines, displays all 43 characters, and can be selected with a single click.
  - Placed the variable name (`PLAYWRIGHT_MCP_EXTENSION_TOKEN`) in an informational badge above the token field for clear visual hierarchy.

---

### E. Packaging & Setup Automation (`setup.js`, `package.json`, `README.md`)

1. **Zero-Configuration 1-Click Installer (`setup.js`)**:
   - Compiles the extension bundle (`vite build`).
   - Executes `patcher.js` to patch `playwright-core`.
   - Links the package globally (`npm link`) so `playwright-mcp-extension` / `playwright-mcp-extension.cmd` is universally accessible on `PATH`.
2. **Fixed Extension Key (`manifest.json`)**:
   - Pinned public key in `manifest.json` guarantees a permanent extension ID (`mmlmfjhmonkocbjadbfplnigmagldckm`), eliminating broken extension URLs across reloads.
3. **Multi-Platform Setup Documentation**:
   - Added configuration blueprints and parameter guides for Claude Desktop, Cursor IDE, Google Antigravity, OpenMausBot, Dusk Bot, and Python multi-agent frameworks (LangGraph, CrewAI, AutoGen).

---

## 4. Summary of Modified & Added Files

| File | Type | Changes Made |
|---|---|---|
| `index.js` | Server | Added Primary/Satellite multiplexer, removed fatal `process.exit(1)`, added `/ping` failover watcher, trimmed environment variables. |
| `patcher.js` | Build / Hook | Automated `playwright-core` patching to route window creation through port 45454. |
| `setup.js` | Build / CLI | 1-click cross-platform setup script (`npm run setup`). |
| `extension/src/clientSession.ts` | Extension | Replaced `chrome.windows.create` with `chrome.tabs.create({ windowId })` for window confinement. |
| `extension/src/connectionBroker.ts` | Extension | Added background session pruning (`_pruneDeadSessions()`). |
| `extension/src/ui/manage.tsx` | UI | Separated raw token copy from KEY=VAL copy; added informational key badge. |
| `extension/src/ui/manage.css` | Styling | Fixed token truncation with `break-all` and `overflow-wrap: anywhere`. |
| `extension/src/ui/authToken.tsx` | UI | Fixed token display and copying without prepended key string. |
| `extension/src/ui/authToken.css` | Styling | Added multi-line wrapping and text selection. |
| `README.md` | Docs | Universal 1-liner install, architecture diagrams, GUI bot instructions. |
| `CHANGES.md` | Docs | Comprehensive technical changelog and architectural reference. |

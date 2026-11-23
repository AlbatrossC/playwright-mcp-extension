# Playwright MCP Extension

**Give every AI agent its own browser window.**

## What is this?

A browser extension and MCP server (a fork of `@playwright/mcp`) that lets AI agents control your real Chrome, Edge, or Brave browser, with each agent working in its own separate window.

Works with any MCP-compatible app, such as Claude Desktop, Cursor, or bot platforms like OpenMausBot and Dusk Bots.

## What does it do?

Each agent gets a `session_id`. Every `session_id` opens its own dedicated browser window. Agents use your real browser profile, so they are already logged in (cookies, 2FA, and extensions all work). When an agent finishes or its window closes, the session is cleaned up automatically.

## Before and after

| | Before (normal browser MCP) | After (this extension) |
|---|---|---|
| **Windows** | All agents share one window, each in a tab | Each agent gets its own window |
| **Focus** | Agents steal focus and switch each other's tabs | No interference, each agent stays in its own window |
| **Tab groups** | Chrome forces agents into conflicting tab groups | Separate windows, so no tab group clashes |
| **Typing** | Keystrokes can land in the wrong page | Each agent types only in its own window |
| **Visibility** | Hard to see what each agent is doing | Windows sit side by side so you can watch them all |
| **Logins** | Often needs a fresh or headless browser | Uses your real profile, already logged in |
| **Cleanup** | Leftover tabs and sessions | Sessions are removed automatically |

## Setup

### 1. Install

```bash
git clone https://github.com/AlbatrossC/playwright-mcp-extension.git
cd playwright-mcp-extension
npm install && npm run setup
```

This does three things: registers the global `playwright-mcp-extension` command (so no file paths are needed in your config), patches `playwright-core` to route window requests through the local multiplexer, and builds the extension into `extension/dist/`.

### 2. Load the extension in your browser

> Do this in the **same browser profile** you set as `PLAYWRIGHT_CHROME_PROFILE` in step 4.

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension/dist` folder.

### 3. Copy your token

Open this page and click **Copy token**:

```
chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/manage.html
```

### 4. Add the MCP server

**Apps with a JSON config (Claude Desktop, Cursor, Windsurf, etc.)**

Add this to the app's MCP config and replace `YOUR_TOKEN_HERE`:

```json
{
  "mcpServers": {
    "playwright-extension": {
      "command": "playwright-mcp-extension",
      "env": {
        "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "YOUR_TOKEN_HERE",
        "PLAYWRIGHT_CHROME_PROFILE": "Default",
        "PLAYWRIGHT_BROWSER": "chrome"
      }
    }
  }
}
```

**Apps with a form (OpenMausBot, Dusk Bots, etc.)**

1. Click **Add MCP server**.
2. Choose **Run a command** (not "Connect to a URL").
3. Fill in the fields:

| Field | Value |
|---|---|
| Server name | `playwright-extension` |
| Command | `playwright-mcp-extension.cmd` on Windows, `playwright-mcp-extension` on macOS/Linux |
| Arguments | *(leave blank)* |
| Environment variables | Click **Add another** for each one below |
| Result size limit | `0` (so page snapshots are never cut off) |

Environment variables:

| Key | Value |
|---|---|
| `PLAYWRIGHT_MCP_EXTENSION_TOKEN` | Your token from step 3 |
| `PLAYWRIGHT_CHROME_PROFILE` | `Default` (or `Profile 1`, `Profile 4`, etc.) |
| `PLAYWRIGHT_BROWSER` | `chrome` (or `msedge` for Edge) |

4. Click **Save**. The browser tools are now available to your bots.

> **Not sure which profile you use?** Open `chrome://version` and check **Profile Path**. The last folder name is your profile.

## How to use it

Add a unique `session_id` to every tool call. Each one gets its own window.

```json
{
  "name": "browser_navigate",
  "arguments": { "session_id": "researcher", "url": "https://news.ycombinator.com" }
}
```

When the agent is done:

```json
{
  "name": "browser_close_session",
  "arguments": { "session_id": "researcher" }
}
```

## Essential Tools (18 Curated Tools)

Every tool accepts `session_id` to route commands to its dedicated Chrome window.

| Tool | Category | What it does | Key Parameters |
|---|---|---|---|
| `browser_start_session` | Session | Explicitly opens a dedicated window for an agent session (optional; tools auto-start if needed). | `session_id` |
| `browser_close_session` | Session | Terminates the agent's Playwright process and cleanly closes its physical Chrome window. | `session_id` |
| `browser_list_sessions` | Session | Lists all currently active agent sessions and window statuses. | *(none)* |
| `browser_navigate` | Navigation | Navigates the current tab to a specified URL. | `url`, `include_snapshot` |
| `browser_navigate_back` | Navigation | Goes back to the previous page in history. | `include_snapshot` |
| `browser_tabs` | Navigation | Lists, opens, selects, or closes tabs strictly inside the agent's dedicated window. | `action` (`"list"`, `"new"`, `"close"`, `"select"`), `index` |
| `browser_snapshot` | Visual | Captures the page's accessibility tree, text, and interactive element references (`ref`). | `depth` |
| `browser_take_screenshot` | Visual | Captures a PNG screenshot of the page or target element. | `target` / `ref`, `fullPage` |
| `browser_click` | Interaction | Clicks an element. Supports long-press and composite snapshots. | `target` / `ref`, `delay` (ms hold), `doubleClick`, `button`, `include_snapshot` |
| `browser_type` | Interaction | Fills or types text into an input or contenteditable element. | `target` / `ref`, `text`, `submit`, `include_snapshot` |
| `browser_press_key` | Interaction | Presses a keyboard key (e.g. `Enter`, `Escape`, `ArrowDown`, `Tab`). | `key`, `include_snapshot` |
| `browser_hover` | Interaction | Hovers the mouse cursor over an element. | `target` / `ref`, `include_snapshot` |
| `browser_select_option` | Interaction | Selects one or more options in a `<select>` dropdown. | `target` / `ref`, `values`, `include_snapshot` |
| `browser_handle_dialog` | Dialogs | Accepts or dismisses JavaScript `alert`, `confirm`, or `prompt` dialogs. | `accept`, `prompt_text` / `promptText`, `include_snapshot` |
| `browser_file_upload` | Files | Uploads local files into an active file chooser dialog. | `paths` |
| `browser_wait_for` | Sync | Waits for text, an element selector, or a time delay. | `text`, `target` / `ref`, `time`, `include_snapshot` |
| `browser_evaluate` | Scripting | Evaluates a JavaScript function expression in the page context. | `function`, `target` / `ref` |
| `browser_run_action` | Escape Hatch | Dynamic safety-valve to invoke any other native Playwright MCP tool. | `action_name`, `args`, `include_snapshot` |

### High-Performance Capabilities

- **Inline Snapshots (`include_snapshot: true`)**: Pass `include_snapshot: true` to any interaction tool (`browser_click`, `browser_type`, `browser_press_key`, `browser_navigate`, `browser_handle_dialog`). The response immediately includes the post-action accessibility tree, cutting tool roundtrips and latency by 50%.
- **Native Press-and-Hold (`delay`)**: Pass `delay: 1000` to `browser_click` to hold the mouse button down for 1 second before releasing. No manual mouse down/up scripting required.
- **Background Automation Support**: Windows can remain completely hidden or occluded behind other apps without stalling. Background layout stability checks execute instantly without requestAnimationFrame occlusion freezes.
- **Unified Element References**: Both `ref` (e.g. `ref: "e42"`) and `target` (e.g. `target: "#submit-btn"`) are accepted interchangeably across all tools.

## Dashboard

Open `chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/manage.html` to:

- See active sessions with their current tabs and URLs
- **Focus window** to bring an agent's window to the front
- **Disconnect** to release a session
- Reveal, copy, or rotate your token
- Generate ready-made prompt snippets for onboarding new agents

## Troubleshooting

- **`playwright-mcp-extension` command not found:** run `npm run setup` again in the repo folder. It re-registers the command.
- **Agents open in the wrong profile or aren't logged in:** check `PLAYWRIGHT_CHROME_PROFILE` against **Profile Path** at `chrome://version`, and make sure the extension is loaded in that same profile.
- **Authentication fails:** copy a fresh token from the dashboard and update `PLAYWRIGHT_MCP_EXTENSION_TOKEN`.
- **Windows not closing:** call `browser_close_session`, or click **Disconnect** in the dashboard.

## Development

```bash
npm run build:extension   # rebuild the extension
node index.js             # run the multiplexer standalone
npm test                  # launch a sample multi-window test
```

## License

Apache-2.0
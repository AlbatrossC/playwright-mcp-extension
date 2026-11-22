/**
 * Playwright Core Multiplexer Patcher
 *
 * Automatically patches playwright-core in node_modules to notify the direct-window
 * control plane (ws://127.0.0.1:45454) when establishing extension connections.
 * This guarantees instant, collision-free multi-window creation in Chrome.
 */

const fs = require('fs');
const path = require('path');

function patchPlaywrightCore() {
  let coreBundlePath;
  try {
    coreBundlePath = require.resolve('playwright-core/lib/coreBundle', { paths: [__dirname] });
  } catch (e) {
    // If not found in __dirname, check parent
    try {
      coreBundlePath = require.resolve('playwright-core/lib/coreBundle');
    } catch (_) {
      console.warn('[Patcher] playwright-core not found in node_modules yet. Run "npm install" first.');
      return false;
    }
  }

  if (!fs.existsSync(coreBundlePath)) {
    console.warn(`[Patcher] File does not exist: ${coreBundlePath}`);
    return false;
  }

  let content = fs.readFileSync(coreBundlePath, 'utf8');
  let modified = false;

  // 1. Hook _openConnectPageInBrowser to notify control plane on 45454
  const targetHook = 'const mcpRelayEndpoint = `${this._wsHost}${this._extensionPath}`;';
  const controlPlaneNotification = `const mcpRelayEndpoint = \`\${this._wsHost}\${this._extensionPath}\`;
        try {
          const http = require("http");
          const payload = JSON.stringify({
            relayUrl: mcpRelayEndpoint,
            options: { clientName, tabGroup: tabGroup ? { title: tabGroup.title, color: tabGroup.color } : undefined, background: !!this._background }
          });
          const req = http.request({
            hostname: "127.0.0.1",
            port: 45454,
            path: "/connect",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload)
            }
          });
          req.on("error", () => {});
          req.write(payload);
          req.end();
          return;
        } catch (_) {}`;

  const isAlreadyPatched = content.includes('45454');
  if (!isAlreadyPatched) {
    if (content.includes(targetHook)) {
      content = content.replace(targetHook, controlPlaneNotification);
      modified = true;
      console.error('[Patcher] Injected 45454 control plane notification hook into coreBundle.js');
    } else {
      console.error('[Patcher] WARNING: Could not find patch target in coreBundle.js — Playwright version may be incompatible.');
      return false;
    }
  }

  // 2. Fix Windows command line quoting for --profile-directory
  const badProfileArg = 'args.push(`--profile-directory=${this._profileDirectory}`);';
  const goodProfileArg = 'args.push("--profile-directory", this._profileDirectory);';
  if (content.includes(badProfileArg)) {
    content = content.replace(badProfileArg, goodProfileArg);
    modified = true;
    console.error('[Patcher] Fixed Windows switch quoting for --profile-directory in coreBundle.js');
  }

  if (modified) {
    fs.writeFileSync(coreBundlePath, content, 'utf8');
    console.error('[Patcher] Successfully patched playwright-core for multi-agent window isolation.');
    return true;
  }

  if (isAlreadyPatched) {
    console.error('[Patcher] playwright-core is already patched.');
    return true;
  }

  return false;
}

if (require.main === module) {
  patchPlaywrightCore();
}

module.exports = patchPlaywrightCore;

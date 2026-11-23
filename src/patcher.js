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
    coreBundlePath = require.resolve('playwright-core/lib/coreBundle', { paths: [__dirname, path.join(__dirname, '..')] });
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

  // 3. Fix background/minimized window click freeze (requestAnimationFrame occlusion throttling)
  const targetStableRaf = 'const raf = () => {\\n      try {\\n        const success = check();\\n        if (success !== continuePolling)\\n          fulfill(success);\\n        else\\n          this.utils.builtins.requestAnimationFrame(raf);\\n      } catch (e) {\\n        reject(e);\\n      }\\n    };\\n    this.utils.builtins.requestAnimationFrame(raf);';
  const backgroundStableRaf = 'const schedule = (fn) => { let _t = this.utils.builtins.setTimeout(fn, 25); this.utils.builtins.requestAnimationFrame(() => { this.utils.builtins.clearTimeout(_t); fn(); }); };\\n    const raf = () => {\\n      try {\\n        const success = check();\\n        if (success !== continuePolling)\\n          fulfill(success);\\n        else\\n          schedule(raf);\\n      } catch (e) {\\n        reject(e);\\n      }\\n    };\\n    schedule(raf);';
  if (content.includes(targetStableRaf)) {
    content = content.replace(targetStableRaf, backgroundStableRaf);
    modified = true;
    console.error('[Patcher] Patched _checkElementIsStable for background window click support in coreBundle.js');
  }

  // 3b. Immediate stability in hidden / occluded background tabs
  const targetStableFn = 'async _checkElementIsStable(node) {\\n    const continuePolling =';
  const backgroundStableFn = 'async _checkElementIsStable(node) {\\n    if (typeof document !== "undefined" && document.hidden) return true;\\n    const continuePolling =';
  if (content.includes(targetStableFn)) {
    content = content.replace(targetStableFn, backgroundStableFn);
    modified = true;
    console.error('[Patcher] Patched _checkElementIsStable to bypass background RAF throttling in coreBundle.js');
  }

  // 4. Fix rafrafTimeout in background/hidden tabs for screenshots
  const targetDoubleRaf = 'requestAnimationFrame(() => {\n              requestAnimationFrame(x);\n            });';
  const backgroundDoubleRaf = 'const _r = (typeof document !== "undefined" && document.hidden) ? (f) => setTimeout(f, 16) : requestAnimationFrame;\n            _r(() => {\n              _r(x);\n            });';
  if (content.includes(targetDoubleRaf)) {
    content = content.replace(targetDoubleRaf, backgroundDoubleRaf);
    modified = true;
    console.error('[Patcher] Patched rafrafTimeout for background window screenshots in coreBundle.js');
  }

  // 5. Add delay parameter support to browser_click in coreBundle.js
  const badClickSchema = 'modifiers: z2.array(z2.enum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"])).optional().describe("Modifier keys to press")\n    });';
  const goodClickSchema = 'modifiers: z2.array(z2.enum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"])).optional().describe("Modifier keys to press"),\n      delay: z2.number().optional().describe("Time to wait between mousedown and mouseup in milliseconds")\n    });';
  if (content.includes(badClickSchema)) {
    content = content.replace(badClickSchema, goodClickSchema);
    modified = true;
    console.error('[Patcher] Patched clickSchema to accept delay parameter in coreBundle.js');
  }

  const badClickOptions = 'const options = {\n          button: params2.button,\n          modifiers: params2.modifiers,\n          delay: params2.delay,\n          ...tab2.actionTimeoutOptions\n        };';
  const goodClickOptions = 'const options = {\n          ...tab2.actionTimeoutOptions,\n          button: params2.button,\n          modifiers: params2.modifiers,\n          delay: params2.delay,\n          timeout: params2.delay ? Math.max(20000, params2.delay + 10000) : tab2.actionTimeoutOptions?.timeout\n        };';
  if (content.includes(badClickOptions)) {
    content = content.replace(badClickOptions, goodClickOptions);
    modified = true;
    console.error('[Patcher] Patched click handler options to scale timeout for delay in coreBundle.js');
  }

  if (modified) {
    fs.writeFileSync(coreBundlePath, content, 'utf8');
    console.error('[Patcher] Successfully patched playwright-core for background actions and window isolation.');
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

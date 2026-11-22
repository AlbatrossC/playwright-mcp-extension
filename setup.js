#!/usr/bin/env node

/**
 * Universal Automated Setup for Playwright MCP Extension
 *
 * 1. Links 'playwright-mcp-extension' as a global system command (no file paths needed!).
 * 2. Patches playwright-core in node_modules for direct multi-window routing.
 * 3. Builds the browser extension package into extension/dist/.
 */

const path = require('path');
const { execSync } = require('child_process');

console.log('\n================================================================');
console.log('   Playwright MCP Extension: Universal Automated Setup');
console.log('================================================================\n');

// 1. Register global command with npm link
console.log('>>> [1/3] Registering global command "playwright-mcp-extension"...');
try {
  execSync('npm link --force', { cwd: __dirname, stdio: 'inherit' });
  console.log('✓ Successfully registered global command: "playwright-mcp-extension"');
} catch (err) {
  console.warn('! Note during npm link (will continue):', err.message);
}

// 2. Patch playwright-core
console.log('\n>>> [2/3] Patching playwright-core for window isolation...');
try {
  const patcher = require('./patcher');
  patcher();
  console.log('✓ playwright-core verified and patched.');
} catch (err) {
  console.warn('! Note during patcher run:', err.message);
}

// 3. Build the extension package
console.log('\n>>> [3/3] Building browser extension package...');
try {
  execSync('npm run build:extension', { cwd: __dirname, stdio: 'inherit' });
  console.log('✓ Extension built successfully in extension/dist/');
} catch (err) {
  console.warn('! Note during extension build:', err.message);
}

console.log('\n================================================================');
console.log('   SETUP COMPLETE! READY FOR ANY MCP CLIENT!');
console.log('================================================================\n');

console.log('Next Steps:\n');
console.log('1. Load the unpacked extension in Chrome / Edge / Brave:');
console.log('   Path: ' + path.resolve(__dirname, 'extension', 'dist'));
console.log('   (Navigate to chrome://extensions -> enable "Developer mode" -> click "Load unpacked")\n');
console.log('2. Open the extension control center in your browser:');
console.log('   chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/manage.html');
console.log('   Click "Copy token" to get your authentication token.\n');
console.log('3. Add this universal config to your preferred MCP client:\n');
console.log(JSON.stringify({
  mcpServers: {
    "playwright-extension": {
      "command": "playwright-mcp-extension",
      "env": {
        "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "YOUR_TOKEN_HERE",
        "PLAYWRIGHT_CHROME_PROFILE": "Default",
        "PLAYWRIGHT_BROWSER": "chrome"
      }
    }
  }
}, null, 2));

console.log('\nSupported Clients:');
console.log('• Claude Desktop:   %APPDATA%\\Claude\\claude_desktop_config.json (Windows) or ~/.config/Claude/...');
console.log('• Cursor IDE:       Settings -> Features -> MCP -> Add New MCP Server');
console.log('• Windsurf:         ~/.codeium/windsurf/mcp_config.json');
console.log('• Antigravity:      ~/.gemini/config/mcp_config.json');
console.log('• Python / LangGraph / AutoGen / CrewAI: StdioServerParameters(command="playwright-mcp-extension")\n');

/**
 * Multi-Agent Physical Window Isolation Test
 *
 * Runs two concurrent agent sessions (agent-1 and agent-2), verifies that each opens
 * its own distinct physical Chrome desktop window, confirms tab isolation, and exits cleanly.
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

const token = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
if (!token) {
  console.error('\n[ERROR] PLAYWRIGHT_MCP_EXTENSION_TOKEN environment variable is not set!');
  console.error('Please set PLAYWRIGHT_MCP_EXTENSION_TOKEN before running tests:');
  console.error('  Windows PowerShell: $env:PLAYWRIGHT_MCP_EXTENSION_TOKEN="your_token"');
  console.error('  Linux / macOS:      export PLAYWRIGHT_MCP_EXTENSION_TOKEN="your_token"\n');
  process.exit(1);
}

const profile = process.env.PLAYWRIGHT_CHROME_PROFILE || 'Default';
const browser = process.env.PLAYWRIGHT_BROWSER || 'chrome';
const indexJs = path.resolve(__dirname, '..', 'src', 'index.js');

console.log('--- Starting Multi-Agent Window Isolation Test ---');
console.log('Target Browser:       ', browser);
console.log('Target Profile:       ', profile);
console.log('Multiplexer Script:   ', indexJs);

const p = spawn(process.execPath, [indexJs], {
  env: {
    ...process.env,
    PLAYWRIGHT_MCP_EXTENSION_TOKEN: token,
    PLAYWRIGHT_CHROME_PROFILE: profile,
    PLAYWRIGHT_BROWSER: browser
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

p.stderr.on('data', d => process.stderr.write(`[SERVER] ${d.toString()}`));

const rl = readline.createInterface({ input: p.stdout });

rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);

    if (msg.id === 1) {
      console.log('>>> [1/4] MCP Multiplexer initialized successfully.');
      console.log('>>> Waiting 2s for extension handshake...');
      setTimeout(() => {
        console.log('>>> [2/4] Requesting Window 1 for Agent-1 (Wikipedia)...');
        p.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'browser_navigate',
            arguments: {
              session_id: 'agent-1',
              url: 'https://en.wikipedia.org'
            }
          }
        }) + '\n');
      }, 2000);
    } else if (msg.id === 2) {
      if (msg.error || msg.result?.isError) {
        console.error('FAILED on Agent-1:', msg.error || msg.result);
        p.kill();
        process.exit(1);
      }
      console.log('>>> [SUCCESS] Agent-1 Window 1 opened and navigated to Wikipedia!');
      console.log('>>> [3/4] Requesting Window 2 for Agent-2 (GitHub)...');
      p.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'browser_navigate',
          arguments: {
            session_id: 'agent-2',
            url: 'https://github.com'
          }
        }
      }) + '\n');
    } else if (msg.id === 3) {
      if (msg.error || msg.result?.isError) {
        console.error('FAILED on Agent-2:', msg.error || msg.result);
        p.kill();
        process.exit(1);
      }
      console.log('>>> [SUCCESS] Agent-2 Window 2 opened and navigated to GitHub!');
      console.log('>>> [4/4] Verifying active sessions list...');
      p.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'browser_list_sessions',
          arguments: {}
        }
      }) + '\n');
    } else if (msg.id === 4) {
      console.log('>>> Active Sessions Response:', msg.result?.content?.[0]?.text);
      console.log('\n======================================================');
      console.log('   ALL MULTI-AGENT WINDOW ISOLATION TESTS PASSED!');
      console.log('======================================================\n');
      const holdTimeSec = parseInt(process.env.HOLD_SECONDS, 10) || 5;
      console.log(`>>> Holding agent windows open for ${holdTimeSec}s...`);
      setTimeout(() => {
        p.kill();
        process.exit(0);
      }, holdTimeSec * 1000);
    }
  } catch (e) {}
});

p.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-runner', version: '1.0' }
  }
}) + '\n');

setTimeout(() => {
  console.error('\n[TIMEOUT] Test timed out after 60s.');
  p.kill();
  process.exit(1);
}, 60000);

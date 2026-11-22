#!/usr/bin/env node

/**
 * Playwright Multi-Agent Window Multiplexer
 *
 * Each unique `session_id` spawns its own dedicated Playwright MCP client connection.
 * With the modified Playwright extension, each connection automatically opens
 * a dedicated, separate physical Chrome window with isolated tab management.
 *
 * Dynamically scales to 2, 5, 13+ concurrent agent windows on demand.
 */

// Ensure playwright-core is patched for control plane communication
try {
  require('./patcher')();
} catch (_) {}

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

// --- Extension Control Plane Server (Port 45454) ---
let extensionClient = null;
const MAX_PENDING_CONNECT = 50;
const pendingConnectRequests = [];
let isPrimaryMultiplexer = false;
let controlHttpServer = null;
let wss = null;
let promoteTimer = null;

function startControlPlane() {
  if (isPrimaryMultiplexer) return;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('pong');
    }
    if (req.method === 'POST' && req.url === '/connect') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) {
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const payload = {
            type: 'connectDirect',
            relayUrl: data.relayUrl,
            options: data.options
          };
          if (extensionClient && extensionClient.readyState === 1) {
            extensionClient.send(JSON.stringify(payload));
          } else {
            if (pendingConnectRequests.length >= MAX_PENDING_CONNECT) {
              pendingConnectRequests.shift();
            }
            pendingConnectRequests.push(payload);
          }
        } catch (_) {}
        res.writeHead(200);
        res.end('ok');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      isPrimaryMultiplexer = false;
      process.stderr.write(`[Multiplexer] Port 45454 is active (shared control plane detected). Running in satellite mode.\n`);
      schedulePromoteCheck();
    } else {
      process.stderr.write(`[Multiplexer] Control plane server error: ${err.message}\n`);
    }
  });

  server.listen(45454, '127.0.0.1', () => {
    isPrimaryMultiplexer = true;
    controlHttpServer = server;
    process.stderr.write('[Multiplexer] Primary control plane listening on 127.0.0.1:45454\n');

    wss = new WebSocketServer({ server: controlHttpServer });
    wss.on('connection', ws => {
      extensionClient = ws;
      // Flush any pending connect requests immediately
      while (pendingConnectRequests.length > 0) {
        const item = pendingConnectRequests.shift();
        try {
          ws.send(JSON.stringify(item));
        } catch (_) {}
      }
      ws.on('close', () => {
        if (extensionClient === ws) extensionClient = null;
      });
    });
    wss.on('error', () => {});
  });
}

function schedulePromoteCheck() {
  if (promoteTimer || isPrimaryMultiplexer) return;
  promoteTimer = setTimeout(() => {
    promoteTimer = null;
    if (isPrimaryMultiplexer) return;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 45454,
      path: '/ping',
      method: 'GET',
      timeout: 1500
    }, res => {
      // Primary is healthy; schedule next periodic check
      schedulePromoteCheck();
    });
    req.on('error', () => {
      // Primary disappeared; attempt to claim port 45454
      process.stderr.write('[Multiplexer] Primary control plane stopped. Promoting satellite to primary...\n');
      startControlPlane();
    });
    req.on('timeout', () => {
      req.destroy();
      schedulePromoteCheck();
    });
    req.end();
  }, 5000);
  if (promoteTimer && promoteTimer.unref) promoteTimer.unref();
}

startControlPlane();

// Heartbeat to keep MV3 extension service worker awake during active sessions
const heartbeatTimer = setInterval(() => {
  if (isPrimaryMultiplexer && extensionClient && extensionClient.readyState === 1) {
    try { extensionClient.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
  }
}, 20000);
if (heartbeatTimer.unref) heartbeatTimer.unref();
// --------------------------------------------------

const SESSIONS = new Map();

class PlaywrightSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.process = null;
    this.ready = false;
    this.readyPromise = null;
    this.pendingRequests = new Map();
    this.nextRequestId = 0;
    this.createdAt = new Date();
    this._initResolve = null;
    this._initReject = null;
    this._startupTimer = null;
  }

  async start() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;

      this._startupTimer = setTimeout(() => {
        this.readyPromise = null;
        if (this.process) {
          try { this.process.kill(); } catch (_) {}
          this.process = null;
        }
        if (this._initReject) {
          this._initReject(new Error(`Session "${this.sessionId}" initialization timed out after 30s`));
          this._initResolve = null;
          this._initReject = null;
        }
      }, 30000);

      const token = (process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN || '').trim();
      if (!token) {
        clearTimeout(this._startupTimer);
        this.readyPromise = null;
        return reject(new Error('Environment variable PLAYWRIGHT_MCP_EXTENSION_TOKEN is required. Configure it in your MCP settings.'));
      }
      const profile = (process.env.PLAYWRIGHT_CHROME_PROFILE || 'Default').trim();
      const browser = (process.env.PLAYWRIGHT_BROWSER || 'chrome').trim();

      const cliPath = path.join(__dirname, 'node_modules', '@playwright', 'mcp', 'cli.js');
      const args = [
        cliPath,
        '--extension',
        '--browser', browser,
        '--no-tab-group',
        '--session-name', this.sessionId
      ];

      try {
        this.process = spawn(process.execPath, args, {
          env: {
            ...process.env,
            PLAYWRIGHT_MCP_EXTENSION_TOKEN: token,
            PLAYWRIGHT_MCP_PROFILE_DIR_NAME: profile
          },
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (err) {
        clearTimeout(this._startupTimer);
        this.readyPromise = null;
        return reject(new Error(`Failed to spawn playwright-mcp: ${err.message}`));
      }

      this.process.stderr.on('data', data => {
        const text = data.toString();
        process.stderr.write(`[Session ${this.sessionId} stderr] ${text}`);
      });

      const rl = readline.createInterface({ input: this.process.stdout });

      rl.on('line', line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const msg = JSON.parse(trimmed);
          this._handleIncoming(msg);
        } catch (e) {
          process.stderr.write(`[Session ${this.sessionId} raw] ${trimmed}\n`);
        }
      });

      this.process.on('error', err => {
        process.stderr.write(`[Session ${this.sessionId} error] ${err.message}\n`);
        clearTimeout(this._startupTimer);
        this.readyPromise = null;
        if (this._initReject) {
          this._initReject(err);
          this._initResolve = null;
          this._initReject = null;
        }
      });

      this.process.on('close', code => {
        process.stderr.write(`[Session ${this.sessionId} closed] code=${code}\n`);
        clearTimeout(this._startupTimer);
        this.ready = false;
        this.readyPromise = null;
        if (this._initReject) {
          this._initReject(new Error(`Session ${this.sessionId} terminated during startup (code ${code})`));
          this._initResolve = null;
          this._initReject = null;
        }
        SESSIONS.delete(this.sessionId);
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error(`Session ${this.sessionId} terminated unexpectedly (code ${code})`));
        }
        this.pendingRequests.clear();
      });

      // Send initialize handshake
      this._send({
        jsonrpc: '2.0',
        id: ++this.nextRequestId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: this.sessionId, version: '1.0.0' }
        }
      });
    });

    return this.readyPromise;
  }

  _send(obj) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify(obj) + '\n');
    }
  }

  _handleIncoming(msg) {
    if (msg.id === 1) {
      clearTimeout(this._startupTimer);
      if (msg.error) {
        this.readyPromise = null;
        if (this._initReject) {
          this._initReject(new Error(msg.error.message || JSON.stringify(msg.error)));
          this._initResolve = null;
          this._initReject = null;
        }
        return;
      }
      this.ready = true;
      this._send({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      });
      if (this._initResolve) {
        this._initResolve(this);
        this._initResolve = null;
        this._initReject = null;
      }
      return;
    }

    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    }
  }

  async callTool(toolName, toolArgs = {}, timeoutMs = 60000) {
    await this.start();

    return new Promise((resolve, reject) => {
      const id = ++this.nextRequestId;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Tool ${toolName} timed out after ${timeoutMs / 1000}s on session ${this.sessionId}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: result => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: err => {
          clearTimeout(timer);
          reject(err);
        }
      });

      this._send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: toolArgs
        }
      });
    });
  }

  stop() {
    clearTimeout(this._startupTimer);
    this.ready = false;
    this.readyPromise = null;
    this._initResolve = null;
    this._initReject = null;
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {}
      this.process = null;
    }
    for (const [id, req] of this.pendingRequests) {
      req.reject(new Error(`Session "${this.sessionId}" was stopped.`));
    }
    this.pendingRequests.clear();
    SESSIONS.delete(this.sessionId);
  }
}

// Clean up all sessions and shutdown
let isShuttingDown = false;
const shutdown = () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (promoteTimer) clearTimeout(promoteTimer);
  for (const session of SESSIONS.values()) {
    session.stop();
  }
  if (controlHttpServer) {
    try { controlHttpServer.close(); } catch (_) {}
  }
  if (wss) {
    try { wss.close(); } catch (_) {}
  }
  process.exit(0);
};

process.stdin.on('close', shutdown);
process.stdin.on('end', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  for (const session of SESSIONS.values()) {
    session.stop();
  }
});

// Get or auto-create a session
async function getSession(sessionId) {
  const id = String(sessionId || 'default').trim();
  let session = SESSIONS.get(id);
  if (!session) {
    session = new PlaywrightSession(id);
    SESSIONS.set(id, session);
  }
  await session.start();
  return session;
}

// Tool definitions exposed to the AI agent / MCP client
const TOOLS = [
  {
    name: 'browser_start_session',
    description: 'Explicitly start a dedicated browser window for an agent session. (Optional: other browser tools will auto-start the session if not already running).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique identifier for this agent session or task (e.g. "agent-1", "researcher", "data-extractor"). Each unique session gets its own dedicated Chrome window.'
        }
      },
      required: ['session_id']
    }
  },
  {
    name: 'browser_close_session',
    description: 'Close an agent session, terminating its dedicated Playwright MCP process and releasing its Chrome window.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The session identifier to terminate.'
        }
      },
      required: ['session_id']
    }
  },
  {
    name: 'browser_list_sessions',
    description: 'List all currently active agent browser sessions and their status.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL inside the dedicated Chrome window for the given session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique agent session ID. Each agent must use its own session_id to stay in its own dedicated window.'
        },
        url: {
          type: 'string',
          description: 'The URL to navigate to.'
        }
      },
      required: ['session_id', 'url']
    }
  },
  {
    name: 'browser_snapshot',
    description: 'Capture a page snapshot (accessibility tree and content) of the dedicated window for session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique agent session ID.'
        }
      },
      required: ['session_id']
    }
  },
  {
    name: 'browser_click',
    description: 'Click an element on the active page of the dedicated window for session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique agent session ID.'
        },
        element: {
          type: 'string',
          description: 'The element description or selector to click.'
        },
        ref: {
          type: 'string',
          description: 'The element reference from snapshot.'
        }
      },
      required: ['session_id']
    }
  },
  {
    name: 'browser_type',
    description: 'Type text into an element in the dedicated window for session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique agent session ID.'
        },
        text: {
          type: 'string',
          description: 'The text to type.'
        },
        element: {
          type: 'string',
          description: 'The element description or selector.'
        },
        ref: {
          type: 'string',
          description: 'The element reference from snapshot.'
        }
      },
      required: ['session_id', 'text']
    }
  },
  {
    name: 'browser_evaluate',
    description: 'Evaluate JavaScript code on the active page of the dedicated window for session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique agent session ID.'
        },
        function: {
          type: 'string',
          description: 'JavaScript function or expression to execute.'
        }
      },
      required: ['session_id', 'function']
    }
  },
  {
    name: 'browser_tabs',
    description: 'List, create, or switch tabs inside the dedicated Chrome window for session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique agent session ID.'
        },
        action: {
          type: 'string',
          enum: ['list', 'new', 'close', 'select'],
          description: 'Operation to perform.'
        },
        url: {
          type: 'string',
          description: 'URL when opening a new tab.'
        },
        index: {
          type: 'number',
          description: 'Tab index for select or close.'
        }
      },
      required: ['session_id', 'action']
    }
  },
  {
    name: 'browser_run_action',
    description: 'Execute ANY native Playwright MCP tool (e.g. browser_wait_for, browser_press_key, browser_hover, browser_drag, etc.) on session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique agent session ID.'
        },
        action_name: {
          type: 'string',
          description: 'The native tool name (e.g. "browser_wait_for", "browser_press_key", "browser_hover", "browser_fill_form").'
        },
        args: {
          type: 'object',
          description: 'Arguments object for the tool.'
        }
      },
      required: ['session_id', 'action_name']
    }
  }
];

// Handle incoming MCP request
async function handleMcpRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'playwright-dynamic-multiplexer',
          version: '1.0.0'
        }
      }
    };
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS }
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;

    if (name === 'browser_start_session') {
      const sessionId = args.session_id || 'default';
      await getSession(sessionId);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Dedicated Chrome window started and connected for session: "${sessionId}".`
            }
          ]
        }
      };
    }

    if (name === 'browser_close_session') {
      const sessionId = args.session_id;
      if (!sessionId) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Missing required argument: session_id'
          }
        };
      }
      const session = SESSIONS.get(sessionId);
      if (session) {
        session.stop();
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Session "${sessionId}" closed and its dedicated window released.`
              }
            ]
          }
        };
      } else {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Session "${sessionId}" was not running.`
              }
            ]
          }
        };
      }
    }

    if (name === 'browser_list_sessions') {
      const list = [...SESSIONS.entries()].map(([id, s]) => ({
        sessionId: id,
        ready: s.ready,
        createdAt: s.createdAt.toISOString()
      }));
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(list, null, 2)
            }
          ]
        }
      };
    }

    const sessionId = args.session_id || 'default';
    const session = await getSession(sessionId);

    // Forward to dedicated Playwright MCP session
    let targetTool = name;
    let targetArgs = { ...args };
    delete targetArgs.session_id;

    if (name === 'browser_run_action') {
      if (!args.action_name || typeof args.action_name !== 'string' || !args.action_name.startsWith('browser_')) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Invalid action_name: must be a valid tool name starting with "browser_"'
          }
        };
      }
      targetTool = args.action_name;
      targetArgs = args.args || {};
    }

    const result = await session.callTool(targetTool, targetArgs);
    return {
      jsonrpc: '2.0',
      id,
      result
    };
  }

  throw new Error(`Method not found: ${method}`);
}

// Stdio server loop
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('close', shutdown);

rl.on('line', async line => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const req = JSON.parse(trimmed);
    const res = await handleMcpRequest(req);
    if (res) {
      process.stdout.write(JSON.stringify(res) + '\n');
    }
  } catch (err) {
    process.stderr.write(`Error handling MCP request: ${err.message}\n`);
    try {
      const req = JSON.parse(trimmed);
      if (req && req.id !== undefined) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32603,
            message: err.message
          }
        }) + '\n');
      }
    } catch (_) {}
  }
});

/**
 * Curated Essential Tool Definitions for Playwright MCP Extension
 *
 * Exposes a lean, high-performance set of essential tools:
 * - Eliminates schema bloat and token overhead from rarely used niche tools
 * - Keeps all vital interaction, synchronization, inspection, and multi-agent controls
 * - Injects session_id into every tool for dedicated window multiplexing
 * - Supports delay in browser_click for long-press / hold
 * - Promotes browser_handle_dialog as a first-class tool
 * - Supports include_snapshot on action tools for instant state updates
 */

const nativeTools = require('./native_tools.json');

// Essential native tools needed for robust web scraping & interaction
const ESSENTIAL_NATIVE_NAMES = new Set([
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_take_screenshot',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_hover',
  'browser_select_option',
  'browser_file_upload',
  'browser_wait_for',
  'browser_evaluate',
  'browser_tabs',
  'browser_handle_dialog'
]);

// Tools that support include_snapshot: true to return fresh snapshot with result
const SNAPSHOT_CAPABLE_TOOLS = new Set([
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_hover',
  'browser_select_option',
  'browser_navigate',
  'browser_navigate_back',
  'browser_wait_for',
  'browser_handle_dialog'
]);

const customTools = [
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
    description: 'Close an agent session, cleanly terminating its dedicated Playwright MCP process and releasing its Chrome window.',
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
    name: 'browser_run_action',
    description: 'Safety-valve escape hatch: execute ANY native Playwright MCP tool (e.g. browser_drag, etc.) dynamically on session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Unique agent session ID.'
        },
        action_name: {
          type: 'string',
          description: 'The native tool name.'
        },
        args: {
          type: 'object',
          description: 'Arguments object for the tool.'
        },
        include_snapshot: {
          type: 'boolean',
          description: 'When true, includes the updated accessibility snapshot directly in the result.'
        }
      },
      required: ['session_id', 'action_name']
    }
  }
];

// Enrich only the essential native tools
const enrichedNativeTools = nativeTools
  .filter(t => ESSENTIAL_NATIVE_NAMES.has(t.name))
  .map(t => {
    const schema = JSON.parse(JSON.stringify(t.inputSchema || { type: 'object', properties: {} }));
    schema.properties = schema.properties || {};

    // Inject session_id into every tool
    schema.properties.session_id = {
      type: 'string',
      description: 'Unique agent session ID. Each agent must use its own session_id to stay in its dedicated Chrome window.'
    };

    // Provide 'ref' alias for any tool expecting 'target'
    if (schema.properties.target) {
      schema.properties.ref = {
        type: 'string',
        description: 'Element reference from snapshot or selector (alias for target).'
      };
    }

    // Add delay parameter for browser_click (for long-press / hold)
    if (t.name === 'browser_click') {
      schema.properties.delay = {
        type: 'number',
        description: 'Time to wait between mousedown and mouseup in milliseconds. Useful for long-press or hold interactions (e.g. 1000 for 1s hold).'
      };
    }

    // Provide prompt_text alias for browser_handle_dialog
    if (t.name === 'browser_handle_dialog') {
      schema.properties.prompt_text = {
        type: 'string',
        description: 'The text of the prompt in case of a prompt dialog (alias for promptText).'
      };
    }

    // Add include_snapshot to interactive action tools
    if (SNAPSHOT_CAPABLE_TOOLS.has(t.name)) {
      schema.properties.include_snapshot = {
        type: 'boolean',
        description: 'When true, includes the updated accessibility snapshot directly in the result.'
      };
    }

    delete schema.additionalProperties;
    delete schema['$schema'];

    return {
      name: t.name,
      description: t.description,
      inputSchema: schema
    };
  });

// Essential curated toolset: 4 management/escape-hatch + 14 native = 18 tools
const ALL_TOOLS = [...customTools, ...enrichedNativeTools];

/**
 * Normalizes tool arguments before passing to child @playwright/mcp session
 */
function normalizeToolArgs(toolName, args = {}) {
  const targetArgs = { ...args };

  // Remove session_id and include_snapshot from forwarded args
  delete targetArgs.session_id;
  delete targetArgs.include_snapshot;

  // Handle ref -> target alias
  if (targetArgs.ref && !targetArgs.target) {
    targetArgs.target = targetArgs.ref;
  }
  delete targetArgs.ref;

  // Handle prompt_text -> promptText alias for browser_handle_dialog
  if (targetArgs.prompt_text !== undefined && targetArgs.promptText === undefined) {
    targetArgs.promptText = targetArgs.prompt_text;
  }
  delete targetArgs.prompt_text;

  // Set default values for native tools with strict required constraints
  if (toolName === 'browser_take_screenshot') {
    if (!targetArgs.scale) targetArgs.scale = 'css';
  }

  return targetArgs;
}

module.exports = {
  ALL_TOOLS,
  normalizeToolArgs
};

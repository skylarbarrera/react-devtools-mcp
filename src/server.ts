/**
 * React DevTools MCP Server
 *
 * Exposes React DevTools functionality via Model Context Protocol.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { DevToolsBridge } from './bridge.js';
import { createLogger, getLogLevelFromEnv, type Logger } from './logger.js';
import type { ComponentFilter } from './types.js';
import { HeadlessDevToolsServer, startHeadlessServer } from './headless-server.js';

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const TOOLS: Tool[] = [
  // Connection
  {
    name: 'connect',
    description: 'Connect to React DevTools backend via WebSocket',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Host (default: localhost)' },
        port: { type: 'number', description: 'Port (default: 8097)' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 5000)' },
      },
    },
  },
  {
    name: 'disconnect',
    description: 'Disconnect from React DevTools backend',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_connection_status',
    description: 'Get current connection status',
    inputSchema: { type: 'object', properties: {} },
  },

  // Component Tree
  {
    name: 'get_component_tree',
    description: 'Get the React component tree for all roots',
    inputSchema: {
      type: 'object',
      properties: {
        rootID: { type: 'number', description: 'Filter by root ID (optional)' },
        maxDepth: { type: 'number', description: 'Maximum depth to return (optional)' },
      },
    },
  },
  {
    name: 'get_element_by_id',
    description: 'Get basic element info by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_components',
    description: 'Search for components by name',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (component name)' },
        caseSensitive: { type: 'boolean', description: 'Case sensitive (default: false)' },
        isRegex: { type: 'boolean', description: 'Regex search (default: false)' },
      },
      required: ['query'],
    },
  },

  // Inspection
  {
    name: 'inspect_element',
    description: 'Get full inspection data for a component including props, state, hooks',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID to inspect' },
        paths: {
          type: 'array',
          items: {
            type: 'array',
            items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          },
          description: 'Paths to hydrate for lazy loading',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_owners_list',
    description: 'Get the chain of components that rendered this element',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_element_source',
    description: 'Get source location for an element',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
      },
      required: ['id'],
    },
  },

  // Overrides
  {
    name: 'override_props',
    description: 'Override a prop value on a component',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          description: 'Path to the prop',
        },
        value: { description: 'New value' },
      },
      required: ['id', 'path', 'value'],
    },
  },
  {
    name: 'override_state',
    description: 'Override a state value on a class component',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          description: 'Path to state key',
        },
        value: { description: 'New value' },
      },
      required: ['id', 'path', 'value'],
    },
  },
  {
    name: 'override_hooks',
    description: 'Override a hook value on a function component',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        hookIndex: { type: 'number', description: 'Hook index' },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          description: 'Path within hook value',
        },
        value: { description: 'New value' },
      },
      required: ['id', 'hookIndex', 'path', 'value'],
    },
  },
  {
    name: 'override_context',
    description: 'Override a context value',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          description: 'Path within context',
        },
        value: { description: 'New value' },
      },
      required: ['id', 'path', 'value'],
    },
  },
  {
    name: 'delete_path',
    description: 'Delete a path from props/state/hooks/context',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        target: { type: 'string', enum: ['props', 'state', 'hooks', 'context'], description: 'Target' },
        hookIndex: { type: 'number', description: 'Hook index (if target is hooks)' },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          description: 'Path to delete',
        },
      },
      required: ['id', 'target', 'path'],
    },
  },
  {
    name: 'rename_path',
    description: 'Rename a key in props/state/hooks/context',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        target: { type: 'string', enum: ['props', 'state', 'hooks', 'context'], description: 'Target' },
        hookIndex: { type: 'number', description: 'Hook index (if target is hooks)' },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          description: 'Path to the key',
        },
        oldKey: { type: 'string', description: 'Old key name' },
        newKey: { type: 'string', description: 'New key name' },
      },
      required: ['id', 'target', 'path', 'oldKey', 'newKey'],
    },
  },

  // Profiling
  {
    name: 'start_profiling',
    description: 'Start profiling React renders',
    inputSchema: {
      type: 'object',
      properties: {
        recordTimeline: { type: 'boolean', description: 'Record timeline data' },
        recordChangeDescriptions: { type: 'boolean', description: 'Record why components rendered' },
      },
    },
  },
  {
    name: 'stop_profiling',
    description: 'Stop profiling and get data',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_profiling_data',
    description: 'Get profiling data without stopping',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_profiling_status',
    description: 'Check if profiling is active',
    inputSchema: { type: 'object', properties: {} },
  },

  // Error & Suspense
  {
    name: 'get_errors_and_warnings',
    description: 'Get all errors and warnings from components',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'clear_errors_and_warnings',
    description: "Clear all or specific element's errors/warnings",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID (optional, clears all if omitted)' },
        clearErrors: { type: 'boolean', description: 'Clear errors' },
        clearWarnings: { type: 'boolean', description: 'Clear warnings' },
      },
    },
  },
  {
    name: 'toggle_error',
    description: 'Toggle error boundary state for testing',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        isErrored: { type: 'boolean', description: 'Force error state' },
      },
      required: ['id', 'isErrored'],
    },
  },
  {
    name: 'toggle_suspense',
    description: 'Toggle suspense state for testing',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        isSuspended: { type: 'boolean', description: 'Force suspended state' },
      },
      required: ['id', 'isSuspended'],
    },
  },

  // Debugging
  {
    name: 'highlight_element',
    description: 'Highlight an element in the app UI',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID to highlight' },
        duration: { type: 'number', description: 'Highlight duration in ms (default: 2000)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'clear_highlight',
    description: 'Clear any active element highlight',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'scroll_to_element',
    description: 'Scroll the app to show an element',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'log_to_console',
    description: 'Log an element to the browser/app console as $r',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'store_as_global',
    description: 'Store a value as a global variable for console access',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          description: 'Path to the value',
        },
        globalName: { type: 'string', description: 'Global variable name' },
      },
      required: ['id', 'path', 'globalName'],
    },
  },
  {
    name: 'view_source',
    description: 'Open element source in IDE (if supported)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
      },
      required: ['id'],
    },
  },

  // Filters
  {
    name: 'get_component_filters',
    description: 'Get current component filters',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_component_filters',
    description: 'Set component filters (hide certain components)',
    inputSchema: {
      type: 'object',
      properties: {
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['name', 'location', 'type', 'hoc'] },
              value: { type: 'string' },
              isEnabled: { type: 'boolean' },
              isRegex: { type: 'boolean' },
            },
            required: ['type', 'value', 'isEnabled'],
          },
        },
      },
      required: ['filters'],
    },
  },
  {
    name: 'set_trace_updates_enabled',
    description: 'Enable/disable visual update highlighting',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Enable trace updates' },
      },
      required: ['enabled'],
    },
  },

  // React Native
  {
    name: 'get_native_style',
    description: 'Get native style and layout info (React Native only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_native_style',
    description: 'Set a native style property (React Native only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        property: { type: 'string', description: 'Style property name' },
        value: { description: 'New value' },
      },
      required: ['id', 'property', 'value'],
    },
  },

  // Health & Monitoring
  {
    name: 'health_check',
    description: 'Get server and connection health status',
    inputSchema: { type: 'object', properties: {} },
  },

  // Phase 2: Protocol & Renderer Management
  {
    name: 'get_capabilities',
    description: 'Get negotiated protocol capabilities (features supported by backend)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_renderers',
    description: 'Get all connected React renderers (for multi-renderer apps)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_renderer',
    description: 'Get a specific renderer by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Renderer ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_elements_by_renderer',
    description: 'Get all elements for a specific renderer',
    inputSchema: {
      type: 'object',
      properties: {
        rendererID: { type: 'number', description: 'Renderer ID' },
      },
      required: ['rendererID'],
    },
  },

  // Phase 2: Native Inspection
  {
    name: 'start_inspecting_native',
    description: 'Start native element inspection mode (tap-to-select)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'stop_inspecting_native',
    description: 'Stop native element inspection mode',
    inputSchema: {
      type: 'object',
      properties: {
        selectNextElement: { type: 'boolean', description: 'Select element under pointer (default: true)' },
      },
    },
  },
  {
    name: 'get_inspecting_native_status',
    description: 'Check if native inspection mode is active',
    inputSchema: { type: 'object', properties: {} },
  },

  // Phase 2: Additional Features
  {
    name: 'capture_screenshot',
    description: 'Capture screenshot of an element (if supported)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'save_to_clipboard',
    description: 'Save content to system clipboard',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Content to save' },
      },
      required: ['value'],
    },
  },
  {
    name: 'view_attribute_source',
    description: 'Get source location for a specific attribute path',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Element ID' },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          description: 'Path to attribute',
        },
      },
      required: ['id', 'path'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SERVER CREATION
// ═══════════════════════════════════════════════════════════════════════════

export interface ServerOptions {
  host?: string;
  port?: number;
  autoConnect?: boolean;
  logger?: Logger;
  /**
   * Run in standalone mode with embedded DevTools server.
   * When true, starts a headless WebSocket server that React apps can connect to directly.
   * No need for external `npx react-devtools` - works fully standalone.
   *
   * Default: true (can be disabled via DEVTOOLS_STANDALONE=false env var)
   */
  standalone?: boolean;
}

export function createServer(options: ServerOptions = {}) {
  const logger = options.logger ?? createLogger({
    level: getLogLevelFromEnv(),
    prefix: 'devtools-mcp',
  });

  const host = options.host ?? process.env.DEVTOOLS_HOST ?? 'localhost';
  const port = options.port ?? (Number(process.env.DEVTOOLS_PORT) || 8097);

  // Standalone mode: run embedded DevTools server (default: true)
  const standalone = options.standalone ?? (process.env.DEVTOOLS_STANDALONE !== 'false');
  let headlessServer: HeadlessDevToolsServer | null = null;

  const bridge = new DevToolsBridge({
    host,
    port,
    timeout: Number(process.env.DEVTOOLS_TIMEOUT) || 5000,
    logger: logger.child('bridge'),
  });

  const server = new Server(
    {
      name: 'react-devtools-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'devtools://components',
        name: 'Component Tree',
        description: 'Live component tree updates',
        mimeType: 'application/json',
      },
      {
        uri: 'devtools://selection',
        name: 'Current Selection',
        description: 'Currently selected element',
        mimeType: 'application/json',
      },
    ],
  }));

  // Read resources
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    if (uri === 'devtools://components') {
      const tree = bridge.getComponentTree();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(tree, null, 2),
          },
        ],
      };
    }

    if (uri === 'devtools://selection') {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ selectedElementID: null }),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(bridge, name, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: message }),
          },
        ],
        isError: true,
      };
    }
  });

  // Auto-connect on start if configured
  const autoConnect = options.autoConnect ?? (process.env.DEVTOOLS_AUTO_CONNECT !== 'false');

  return {
    server,
    bridge,
    headlessServer: () => headlessServer,
    async start() {
      // Start embedded DevTools server in standalone mode
      if (standalone) {
        try {
          logger.info('Starting standalone mode with embedded DevTools server', { host, port });
          headlessServer = await startHeadlessServer({
            host,
            port,
            logger: logger.child('headless'),
          });

          let bridgeHandle: { receiveMessage: (data: string) => void; detach: () => void } | null = null;

          // Add message listener BEFORE any connections happen
          // This ensures we don't miss early messages
          headlessServer!.addMessageListener((event, payload) => {
            if (bridgeHandle) {
              // Convert to JSON string for bridge's handleMessage
              const data = JSON.stringify({ event, payload });
              bridgeHandle.receiveMessage(data);
            } else {
              logger.debug('Message received before bridge attached', { event });
            }
          });

          // When React app connects, wire up the MCP bridge
          headlessServer.on('connected', () => {
            logger.info('React app connected to embedded DevTools server');

            // Attach MCP bridge to receive messages from headless server
            bridgeHandle = bridge.attachToExternal(
              (event, payload) => {
                // Send messages through headless server's WebSocket
                headlessServer!.sendMessage(event, payload);
              },
              () => {
                logger.info('MCP bridge detached from headless server');
              }
            );
          });

          headlessServer.on('disconnected', () => {
            logger.info('React app disconnected from embedded DevTools server');
            bridgeHandle?.detach();
            bridgeHandle = null;
          });

          headlessServer.on('error', (err: Error) => {
            logger.error('Embedded DevTools server error', { error: err.message });
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          logger.error('Failed to start embedded DevTools server', { error: message });
          // Continue without standalone mode - user can run external devtools
        }
      }

      // Connect MCP transport
      const transport = new StdioServerTransport();
      await server.connect(transport);

      // Connect bridge to DevTools (skip if using standalone mode - bridge is attached to headless server)
      if (autoConnect && !standalone) {
        try {
          await bridge.connect();
        } catch {
          // Connection failure is not fatal - tools can connect later
        }
      }
    },

    async stop() {
      if (headlessServer) {
        await headlessServer.stop();
        headlessServer = null;
      }
      bridge.disconnect();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleToolCall(
  bridge: DevToolsBridge,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    // Connection
    case 'connect': {
      const status = await bridge.connect();
      return { success: true, status };
    }

    case 'disconnect': {
      bridge.disconnect();
      return { success: true };
    }

    case 'get_connection_status': {
      return { status: bridge.getStatus() };
    }

    // Component Tree
    case 'get_component_tree': {
      const roots = bridge.getComponentTree(
        args.rootID as number | undefined,
        args.maxDepth as number | undefined
      );
      return { roots };
    }

    case 'get_element_by_id': {
      const element = bridge.getElementById(args.id as number);
      return { element };
    }

    case 'search_components': {
      const matches = bridge.searchComponents(
        args.query as string,
        args.caseSensitive as boolean,
        args.isRegex as boolean
      );
      return { matches, totalCount: matches.length };
    }

    // Inspection
    case 'inspect_element': {
      const result = await bridge.inspectElement(
        args.id as number,
        args.paths as Array<Array<string | number>> | undefined
      );

      if (result.type === 'full-data') {
        return { success: true, element: result.element, error: null };
      } else if (result.type === 'not-found') {
        return { success: false, element: null, error: { type: 'not_found', message: 'Element not found' } };
      } else if (result.type === 'error') {
        return { success: false, element: null, error: { type: result.errorType, message: result.message, stack: result.stack } };
      } else {
        return { success: true, element: null, error: null };
      }
    }

    case 'get_owners_list': {
      const owners = await bridge.getOwnersList(args.id as number);
      return { owners };
    }

    case 'get_element_source': {
      const result = await bridge.inspectElement(args.id as number);
      if (result.type === 'full-data') {
        return { source: result.element.source, stack: result.element.stack };
      }
      return { source: null, stack: null };
    }

    // Overrides
    case 'override_props': {
      bridge.overrideValueAtPath(
        'props',
        args.id as number,
        args.path as Array<string | number>,
        args.value
      );
      return { success: true };
    }

    case 'override_state': {
      bridge.overrideValueAtPath(
        'state',
        args.id as number,
        args.path as Array<string | number>,
        args.value
      );
      return { success: true };
    }

    case 'override_hooks': {
      bridge.overrideValueAtPath(
        'hooks',
        args.id as number,
        args.path as Array<string | number>,
        args.value,
        args.hookIndex as number
      );
      return { success: true };
    }

    case 'override_context': {
      bridge.overrideValueAtPath(
        'context',
        args.id as number,
        args.path as Array<string | number>,
        args.value
      );
      return { success: true };
    }

    case 'delete_path': {
      bridge.deletePath(
        args.target as 'props' | 'state' | 'hooks' | 'context',
        args.id as number,
        args.path as Array<string | number>,
        args.hookIndex as number | undefined
      );
      return { success: true };
    }

    case 'rename_path': {
      bridge.renamePath(
        args.target as 'props' | 'state' | 'hooks' | 'context',
        args.id as number,
        args.path as Array<string | number>,
        args.oldKey as string,
        args.newKey as string,
        args.hookIndex as number | undefined
      );
      return { success: true };
    }

    // Profiling
    case 'start_profiling': {
      bridge.startProfiling(
        args.recordTimeline as boolean | undefined,
        args.recordChangeDescriptions as boolean | undefined
      );
      return { success: true, requiresReload: false };
    }

    case 'stop_profiling': {
      bridge.stopProfiling();
      const data = await bridge.getProfilingData();
      return { success: true, data };
    }

    case 'get_profiling_data': {
      const status = bridge.getProfilingStatus();
      const data = await bridge.getProfilingData();
      return { isActive: status.isProfiling, data };
    }

    case 'get_profiling_status': {
      const status = bridge.getProfilingStatus();
      return {
        isProfiling: status.isProfiling,
        recordTimeline: false,
        recordChangeDescriptions: true,
      };
    }

    // Error & Suspense
    case 'get_errors_and_warnings': {
      const { errors, warnings } = bridge.getErrorsAndWarnings();
      return {
        errors: Object.fromEntries(errors),
        warnings: Object.fromEntries(warnings),
      };
    }

    case 'clear_errors_and_warnings': {
      bridge.clearErrorsAndWarnings(args.id as number | undefined);
      return { success: true };
    }

    case 'toggle_error': {
      bridge.overrideError(args.id as number, args.isErrored as boolean);
      return { success: true };
    }

    case 'toggle_suspense': {
      bridge.overrideSuspense(args.id as number, args.isSuspended as boolean);
      return { success: true };
    }

    // Debugging
    case 'highlight_element': {
      bridge.highlightElement(args.id as number);
      const duration = (args.duration as number) ?? 2000;
      setTimeout(() => bridge.clearHighlight(), duration);
      return { success: true };
    }

    case 'clear_highlight': {
      bridge.clearHighlight();
      return { success: true };
    }

    case 'scroll_to_element': {
      bridge.scrollToElement(args.id as number);
      return { success: true };
    }

    case 'log_to_console': {
      bridge.logToConsole(args.id as number);
      return { success: true };
    }

    case 'store_as_global': {
      bridge.storeAsGlobal(
        args.id as number,
        args.path as Array<string | number>,
        1 // count
      );
      return { success: true };
    }

    case 'view_source': {
      bridge.viewElementSource(args.id as number);
      const result = await bridge.inspectElement(args.id as number);
      if (result.type === 'full-data') {
        return { success: true, source: result.element.source };
      }
      return { success: true, source: null };
    }

    // Filters
    case 'get_component_filters': {
      // Filters are managed by DevTools, return empty for now
      return { filters: [] };
    }

    case 'set_component_filters': {
      bridge.setComponentFilters(args.filters as ComponentFilter[]);
      return { success: true };
    }

    case 'set_trace_updates_enabled': {
      bridge.setTraceUpdatesEnabled(args.enabled as boolean);
      return { success: true };
    }

    // React Native
    case 'get_native_style': {
      const result = await bridge.getNativeStyle(args.id as number);
      return result;
    }

    case 'set_native_style': {
      bridge.setNativeStyle(
        args.id as number,
        args.property as string,
        args.value
      );
      return { success: true };
    }

    // Health & Monitoring
    case 'health_check': {
      const status = bridge.getStatus();
      const lastMessageTime = bridge.getLastMessageTime();
      const pendingRequests = bridge.getPendingRequestCount();
      const now = Date.now();

      return {
        connected: status.state === 'connected',
        state: status.state,
        rendererCount: status.rendererCount,
        reactVersion: status.reactVersion,
        error: status.error,
        lastMessageAgo: lastMessageTime > 0 ? now - lastMessageTime : null,
        pendingRequests,
        uptime: process.uptime(),
      };
    }

    // Phase 2: Protocol & Renderer Management
    case 'get_capabilities': {
      const capabilities = bridge.getCapabilities();
      const negotiated = bridge.hasNegotiatedCapabilities();
      return { capabilities, negotiated };
    }

    case 'get_renderers': {
      const renderers = bridge.getRenderers();
      return {
        renderers: renderers.map((r) => ({
          id: r.id,
          version: r.version,
          packageName: r.packageName,
          rootCount: r.rootIDs.size,
          elementCount: r.elementIDs.size,
        })),
      };
    }

    case 'get_renderer': {
      const renderer = bridge.getRenderer(args.id as number);
      if (!renderer) {
        return { renderer: null };
      }
      return {
        renderer: {
          id: renderer.id,
          version: renderer.version,
          packageName: renderer.packageName,
          rootIDs: Array.from(renderer.rootIDs),
          elementCount: renderer.elementIDs.size,
        },
      };
    }

    case 'get_elements_by_renderer': {
      const elements = bridge.getElementsByRenderer(args.rendererID as number);
      return { elements, count: elements.length };
    }

    // Phase 2: Native Inspection
    case 'start_inspecting_native': {
      bridge.startInspectingNative();
      return { success: true, isInspecting: true };
    }

    case 'stop_inspecting_native': {
      const selectNextElement = args.selectNextElement !== false;
      const elementID = await bridge.stopInspectingNative(selectNextElement);
      return { success: true, selectedElementID: elementID };
    }

    case 'get_inspecting_native_status': {
      return { isInspecting: bridge.isInspectingNativeMode() };
    }

    // Phase 2: Additional Features
    case 'capture_screenshot': {
      const screenshot = await bridge.captureScreenshot(args.id as number);
      return { success: screenshot !== null, screenshot };
    }

    case 'save_to_clipboard': {
      const clipResult = await bridge.saveToClipboard(args.value as string);
      return clipResult;
    }

    case 'view_attribute_source': {
      const source = await bridge.viewAttributeSource(
        args.id as number,
        args.path as Array<string | number>
      );
      return { source };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

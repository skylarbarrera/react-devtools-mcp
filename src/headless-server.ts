/**
 * Headless React DevTools Server
 *
 * Embeds the DevTools server directly into the MCP package, allowing it to work
 * without the Electron DevTools app. Supports both React Native and Web apps.
 *
 * Based on: react-devtools-core/src/standalone.js
 * Key difference: No DOM/UI rendering - purely headless for MCP integration.
 */

import WebSocket, { WebSocketServer } from 'ws';
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import type { Logger } from './logger.js';
import { noopLogger } from './logger.js';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface HeadlessServerOptions {
  port?: number;
  host?: string;
  httpsOptions?: {
    key: string;
    cert: string;
  };
  logger?: Logger;
}

export type ServerStatus = 'stopped' | 'starting' | 'listening' | 'connected' | 'error';

export interface ServerState {
  status: ServerStatus;
  port: number;
  host: string;
  connectedAt: number | null;
  error: string | null;
}

interface Message {
  event: string;
  payload: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// HEADLESS SERVER
// ═══════════════════════════════════════════════════════════════════════════

export class HeadlessDevToolsServer extends EventEmitter {
  private _options: Required<Omit<HeadlessServerOptions, 'httpsOptions'>> & { httpsOptions?: HeadlessServerOptions['httpsOptions'] };
  private _httpServer: HttpServer | null = null;
  private _wsServer: WebSocketServer | null = null;
  private _socket: WebSocket | null = null;
  private _state: ServerState;
  private _backendScript: string | null = null;

  constructor(options: HeadlessServerOptions = {}) {
    super();
    this._options = {
      port: options.port ?? 8097,
      host: options.host ?? 'localhost',
      httpsOptions: options.httpsOptions,
      logger: options.logger ?? noopLogger,
    };

    this._state = {
      status: 'stopped',
      port: this._options.port,
      host: this._options.host,
      connectedAt: null,
      error: null,
    };

    // Pre-load backend script
    this._loadBackendScript();
  }

  private _loadBackendScript(): void {
    try {
      // Try to load from react-devtools-core package (require is created at module level for ESM)
      const backendPath = require.resolve('react-devtools-core/dist/backend.js');
      this._backendScript = readFileSync(backendPath, 'utf-8');
      this._options.logger.debug('Loaded backend.js from react-devtools-core');
    } catch (err) {
      this._options.logger.warn('Could not load backend.js - web apps will need to include it manually');
    }
  }

  get state(): ServerState {
    return { ...this._state };
  }

  get isConnected(): boolean {
    return this._socket !== null && this._socket.readyState === WebSocket.OPEN;
  }

  // External message listeners (for MCP bridge integration)
  private _externalMessageListeners: Array<(event: string, payload: unknown) => void> = [];

  /**
   * Add an external message listener that receives all messages from React app.
   * Used to relay messages to the MCP's DevToolsBridge.
   */
  addMessageListener(fn: (event: string, payload: unknown) => void): () => void {
    this._externalMessageListeners.push(fn);
    return () => {
      const idx = this._externalMessageListeners.indexOf(fn);
      if (idx >= 0) this._externalMessageListeners.splice(idx, 1);
    };
  }

  /**
   * Send a message to the React app via WebSocket.
   * Used by the MCP's DevToolsBridge to send messages.
   */
  sendMessage(event: string, payload: unknown): void {
    if (this._socket && this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(JSON.stringify({ event, payload }));
    }
  }

  /**
   * Start the headless DevTools server
   */
  async start(): Promise<void> {
    if (this._state.status === 'listening' || this._state.status === 'connected') {
      this._options.logger.debug('Server already running');
      return;
    }

    this._setState({ status: 'starting', error: null });
    const { port, host, httpsOptions } = this._options;
    const logger = this._options.logger;

    return new Promise((resolve, reject) => {
      try {
        // Create HTTP(S) server
        this._httpServer = httpsOptions
          ? createHttpsServer(httpsOptions)
          : createHttpServer();

        // Handle HTTP requests - serve backend.js for web apps
        this._httpServer.on('request', (req, res) => {
          this._handleHttpRequest(req, res);
        });

        // Create WebSocket server
        this._wsServer = new WebSocketServer({
          server: this._httpServer,
          maxPayload: 1e9, // 1GB - same as standalone.js
        });

        // Handle WebSocket connections
        this._wsServer.on('connection', (socket) => {
          this._handleConnection(socket);
        });

        this._wsServer.on('error', (err) => {
          logger.error('WebSocket server error', { error: err.message });
          this._setState({ status: 'error', error: err.message });
          this.emit('error', err);
        });

        this._httpServer.on('error', (err: NodeJS.ErrnoException) => {
          logger.error('HTTP server error', { error: err.message, code: err.code });
          if (err.code === 'EADDRINUSE') {
            this._setState({
              status: 'error',
              error: `Port ${port} is already in use. Another DevTools instance may be running.`,
            });
          } else {
            this._setState({ status: 'error', error: err.message });
          }
          this.emit('error', err);
          reject(err);
        });

        this._httpServer.listen(port, host, () => {
          logger.info('Headless DevTools server listening', { port, host });
          this._setState({ status: 'listening' });
          this.emit('listening', { port, host });
          resolve();
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.error('Failed to start server', { error: message });
        this._setState({ status: 'error', error: message });
        reject(err);
      }
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    const logger = this._options.logger;
    logger.info('Stopping headless DevTools server');

    // Clean up connection
    if (this._socket) {
      this._socket.close();
      this._socket = null;
    }

    // Close servers
    if (this._wsServer) {
      this._wsServer.close();
      this._wsServer = null;
    }

    if (this._httpServer) {
      this._httpServer.close();
      this._httpServer = null;
    }

    this._setState({
      status: 'stopped',
      connectedAt: null,
      error: null,
    });

    this.emit('stopped');
  }

  /**
   * Handle HTTP requests - serve backend.js for web apps
   */
  private _handleHttpRequest(_req: IncomingMessage, res: ServerResponse): void {
    const { port, host, httpsOptions, logger } = this._options;
    const useHttps = !!httpsOptions;

    if (!this._backendScript) {
      logger.warn('Backend script not available');
      res.writeHead(503);
      res.end('Backend script not available. Web apps need to include react-devtools backend manually.');
      return;
    }

    logger.debug('Serving backend.js to web client');

    // Serve backend.js with auto-connect code (same as standalone.js)
    const responseScript = `${this._backendScript}
;ReactDevToolsBackend.initialize();
ReactDevToolsBackend.connectToDevTools({port: ${port}, host: '${host}', useHttps: ${useHttps}});
`;

    res.end(responseScript);
  }

  /**
   * Handle new WebSocket connection from React app
   */
  private _handleConnection(socket: WebSocket): void {
    const logger = this._options.logger;

    // Only allow one connection at a time (same as standalone.js)
    if (this._socket !== null) {
      logger.warn('Only one connection allowed at a time. Closing previous connection.');
      this._socket.close();
    }

    logger.info('React app connected');
    this._socket = socket;

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as Message;
        logger.debug('Received message', { event: message.event });

        // Notify external listeners (for MCP bridge integration)
        this._externalMessageListeners.forEach((fn) => {
          try {
            fn(message.event, message.payload);
          } catch (err) {
            logger.error('Error in external message listener', { error: err instanceof Error ? err.message : 'Unknown' });
          }
        });
      } catch (err) {
        logger.error('Failed to parse message', { data: data.toString().slice(0, 100) });
      }
    });

    socket.on('close', () => {
      logger.info('React app disconnected');
      this._onDisconnected();
    });

    socket.on('error', (err) => {
      logger.error('WebSocket connection error', { error: err.message });
      this._onDisconnected();
    });

    this._setState({
      status: 'connected',
      connectedAt: Date.now(),
    });

    this.emit('connected');
  }

  /**
   * Handle disconnection
   */
  private _onDisconnected(): void {
    this._socket = null;

    this._setState({
      status: 'listening',
      connectedAt: null,
    });

    this.emit('disconnected');
  }

  private _setState(updates: Partial<ServerState>): void {
    this._state = { ...this._state, ...updates };
    this.emit('stateChange', this._state);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create and start a headless DevTools server
 */
export async function startHeadlessServer(
  options: HeadlessServerOptions = {}
): Promise<HeadlessDevToolsServer> {
  const server = new HeadlessDevToolsServer(options);
  await server.start();
  return server;
}


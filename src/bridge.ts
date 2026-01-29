/**
 * React DevTools Bridge
 *
 * Manages WebSocket connection to React DevTools backend and maintains
 * component tree state. Translates between MCP requests and DevTools protocol.
 *
 * Phase 1 Fixes Implemented:
 * - Logging infrastructure
 * - Connection race condition fix (deduplication)
 * - Automatic reconnection with exponential backoff
 * - Bounds checking in operations parser
 * - Memory leak fix in request handling
 * - Request/response ID correlation
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import type {
  ConnectionConfig,
  ConnectionState,
  ConnectionStatus,
  Element,
  ElementType,
  RootTree,
  InspectElementPayload,
  SerializedElement,
  ProfilingData,
  ComponentFilter,
  OverrideTarget,
  ProtocolCapabilities,
  Renderer,
  RendererInterface,
  SourceLocation,
} from './types.js';
import { noopLogger, type Logger } from './logger.js';
import { ConnectionError, TimeoutError } from './errors.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// DevTools element type constants (from react-devtools-shared)
const ELEMENT_TYPE_MAP: Record<number, ElementType> = {
  1: 'class',
  2: 'context',
  5: 'function',
  6: 'forward_ref',
  7: 'fragment',
  8: 'host',
  9: 'memo',
  10: 'portal',
  11: 'root',
  12: 'profiler',
  13: 'suspense',
  14: 'lazy',
  15: 'cache',
  16: 'activity',
  17: 'virtual',
};

// Tree operation codes
const TREE_OP = {
  ADD: 1,
  REMOVE: 2,
  REORDER: 3,
  UPDATE_TREE_BASE_DURATION: 4,
  UPDATE_ERRORS_OR_WARNINGS: 5,
} as const;

// Default configuration
const DEFAULT_CONFIG: ConnectionConfig = {
  host: 'localhost',
  port: 8097,
  timeout: 5000,
  autoReconnect: true,
};

// Reconnection settings
const RECONNECT = {
  MAX_ATTEMPTS: 5,
  BASE_DELAY: 1000,
  MAX_DELAY: 30000,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  createdAt: number;
  operation: string;
}

// Default protocol capabilities (Phase 2.2)
const DEFAULT_CAPABILITIES: ProtocolCapabilities = {
  bridgeProtocolVersion: 2,
  backendVersion: null,
  supportsInspectElementPaths: false,
  supportsProfilingChangeDescriptions: false,
  supportsTimeline: false,
  supportsNativeStyleEditor: false,
  supportsErrorBoundaryTesting: false,
  supportsTraceUpdates: false,
  isBackendStorageAPISupported: false,
  isSynchronousXHRSupported: false,
};

export interface BridgeOptions extends Partial<ConnectionConfig> {
  logger?: Logger;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRIDGE CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class DevToolsBridge extends EventEmitter {
  private config: ConnectionConfig;
  private logger: Logger;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private error: string | null = null;

  // Connection management (Phase 1.2: Race condition fix)
  private connectPromise: Promise<ConnectionStatus> | null = null;

  // Reconnection state (Phase 1.3: Auto-reconnection)
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manualDisconnect = false;

  // Component tree state
  private elements: Map<number, Element> = new Map();
  private rootIDs: Set<number> = new Set();
  private renderers: Map<number, Renderer> = new Map();
  private elementToRenderer: Map<number, number> = new Map(); // Phase 2.3: Element-to-renderer mapping

  // Request tracking (Phase 1.5 & 1.6: Memory leak fix + ID correlation)
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestIdCounter = 0;
  private staleRequestCleanupTimer: NodeJS.Timeout | null = null;

  // Errors/warnings state
  private elementErrors: Map<number, Array<[string, number]>> = new Map();
  private elementWarnings: Map<number, Array<[string, number]>> = new Map();

  // Profiling state
  private isProfiling = false;
  private profilingData: ProfilingData | null = null;

  // Protocol info (Phase 2.2)
  private backendVersion: string | null = null;
  private capabilities: ProtocolCapabilities = { ...DEFAULT_CAPABILITIES };
  private capabilitiesNegotiated = false;
  private lastMessageAt = 0;

  // Native inspection state (Phase 2.1)
  private isInspectingNative = false;

  constructor(options: BridgeOptions = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.logger = options.logger ?? noopLogger;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Connect to DevTools backend.
   * Handles deduplication of concurrent connect calls (Phase 1.2).
   */
  async connect(): Promise<ConnectionStatus> {
    // Return existing connection attempt (Phase 1.2: Deduplicate)
    if (this.connectPromise) {
      this.logger.debug('Returning existing connection attempt');
      return this.connectPromise;
    }

    // Already connected
    if (this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      this.logger.debug('Already connected');
      return this.getStatus();
    }

    // Clean up stale connection
    if (this.ws) {
      this.logger.debug('Cleaning up stale WebSocket');
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    this.manualDisconnect = false;
    this.connectPromise = this.doConnect();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  /**
   * Internal connection logic
   */
  private async doConnect(): Promise<ConnectionStatus> {
    this.setState('connecting');
    const url = `ws://${this.config.host}:${this.config.port}`;
    this.logger.info('Connecting to DevTools', { url });

    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        this.logger.error('Connection timeout', { url, timeout: this.config.timeout });
        this.ws?.close();
        this.setError('Connection timeout');
        reject(new ConnectionError('Connection timeout', { url, timeout: this.config.timeout }));
      }, this.config.timeout);

      try {
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          clearTimeout(connectionTimeout);
          this.logger.info('Connected to DevTools');
          this.onConnected();
          resolve(this.getStatus());
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('close', (code, reason) => {
          this.handleClose(code, reason.toString());
        });

        this.ws.on('error', (err) => {
          clearTimeout(connectionTimeout);
          this.logger.error('WebSocket error', { error: err.message });
          this.setError(err.message);
          reject(new ConnectionError(err.message));
        });
      } catch (err) {
        clearTimeout(connectionTimeout);
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error('Connection failed', { error: message });
        this.setError(message);
        reject(new ConnectionError(message));
      }
    });
  }

  /**
   * Called when connection is established
   */
  private onConnected(): void {
    this.setState('connected');
    this.error = null;
    this.reconnectAttempts = 0;
    this.lastMessageAt = Date.now();

    // Cancel any pending reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Start stale request cleanup (Phase 1.5)
    this.startStaleRequestCleanup();

    // Send initial handshake
    this.send('bridge', { version: 2 });

    // Request protocol capabilities (Phase 2.2)
    this.negotiateCapabilities();

    this.emit('connected');
  }

  /**
   * Negotiate protocol capabilities with backend (Phase 2.2)
   */
  private negotiateCapabilities(): void {
    this.logger.debug('Negotiating protocol capabilities');

    // Request capability detection from backend
    this.send('isBackendStorageAPISupported', {});
    this.send('isSynchronousXHRSupported', {});
    this.send('getSupportedRendererInterfaces', {});
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(code: number, reason: string): void {
    this.logger.info('Connection closed', { code, reason });
    this.setState('disconnected');
    this.emit('disconnected', { code, reason });

    // Stop stale request cleanup
    this.stopStaleRequestCleanup();

    // Reject all pending requests
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timeout);
      req.reject(new ConnectionError('Connection closed'));
    }
    this.pendingRequests.clear();

    // Auto-reconnect on abnormal closure (Phase 1.3)
    if (!this.manualDisconnect && this.config.autoReconnect && code !== 1000 && code !== 1001) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff (Phase 1.3)
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= RECONNECT.MAX_ATTEMPTS) {
      this.logger.error('Max reconnection attempts reached', { attempts: this.reconnectAttempts });
      this.emit('reconnectFailed', { attempts: this.reconnectAttempts });
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      RECONNECT.BASE_DELAY * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      RECONNECT.MAX_DELAY
    );

    this.reconnectAttempts++;
    this.logger.info('Scheduling reconnection', { attempt: this.reconnectAttempts, delay });
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.warn('Reconnection failed', { error: err.message });
        // Will trigger another scheduleReconnect via handleClose
      });
    }, delay);
  }

  /**
   * Disconnect from DevTools backend
   */
  disconnect(): void {
    this.logger.info('Disconnecting');
    this.manualDisconnect = true;

    // Cancel any pending reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setState('disconnected');
    this.reset();
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return {
      state: this.state,
      rendererCount: this.renderers.size,
      reactVersion: this.backendVersion,
      error: this.error,
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.emit('stateChange', state);
  }

  private setError(message: string): void {
    this.error = message;
    this.setState('error');
  }

  private reset(): void {
    this.elements.clear();
    this.rootIDs.clear();
    this.renderers.clear();
    this.elementToRenderer.clear();
    this.elementErrors.clear();
    this.elementWarnings.clear();
    this.isProfiling = false;
    this.profilingData = null;
    this.isInspectingNative = false;
    this.capabilities = { ...DEFAULT_CAPABILITIES };
    this.capabilitiesNegotiated = false;
    this.stopStaleRequestCleanup();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUEST MANAGEMENT (Phase 1.5 & 1.6)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate unique request ID (Phase 1.6)
   */
  private nextRequestId(): number {
    return ++this.requestIdCounter;
  }

  /**
   * Create a pending request with proper cleanup (Phase 1.5)
   */
  private createPending(key: string, operation: string, timeout?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        const req = this.pendingRequests.get(key);
        if (req) {
          clearTimeout(req.timeout);
          this.pendingRequests.delete(key);
        }
      };

      const timeoutMs = timeout ?? this.config.timeout;
      const timeoutId = setTimeout(() => {
        this.logger.warn('Request timeout', { key, operation, timeout: timeoutMs });
        cleanup();
        reject(new TimeoutError(operation, timeoutMs, { key }));
      }, timeoutMs);

      this.pendingRequests.set(key, {
        resolve: (value: unknown) => {
          cleanup();
          resolve(value);
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
        timeout: timeoutId,
        createdAt: Date.now(),
        operation,
      });
    });
  }

  /**
   * Resolve a pending request
   */
  private resolvePending(key: string, value: unknown): void {
    const pending = this.pendingRequests.get(key);
    if (pending) {
      this.logger.debug('Resolving request', { key, operation: pending.operation });
      pending.resolve(value);
    }
  }

  /**
   * Start periodic cleanup of stale requests (Phase 1.5)
   */
  private startStaleRequestCleanup(): void {
    this.staleRequestCleanupTimer = setInterval(() => {
      const now = Date.now();
      const maxAge = this.config.timeout * 2;

      for (const [key, req] of this.pendingRequests) {
        const age = now - req.createdAt;
        if (age > maxAge) {
          this.logger.warn('Cleaning stale request', { key, operation: req.operation, age });
          clearTimeout(req.timeout);
          this.pendingRequests.delete(key);
          req.reject(new TimeoutError(req.operation, age, { key, stale: true }));
        }
      }
    }, 60000); // Every minute
  }

  /**
   * Stop stale request cleanup
   */
  private stopStaleRequestCleanup(): void {
    if (this.staleRequestCleanupTimer) {
      clearInterval(this.staleRequestCleanupTimer);
      this.staleRequestCleanupTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  private send(event: string, payload?: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ConnectionError('Not connected');
    }

    const message = JSON.stringify({ event, payload });
    this.logger.debug('Sending message', { event, payloadSize: message.length });
    this.ws.send(message);
  }

  private handleMessage(data: string): void {
    this.lastMessageAt = Date.now();

    // Phase 1.1: Don't swallow parse errors
    let parsed: { event?: string; payload?: unknown };
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown parse error';
      this.logger.error('Failed to parse message', { error, dataPreview: data.substring(0, 100) });
      this.emit('parseError', { data: data.substring(0, 100), error });
      return;
    }

    const { event, payload } = parsed;

    if (!event) {
      this.logger.warn('Message missing event field', { dataPreview: data.substring(0, 100) });
      return;
    }

    this.logger.debug('Received message', { event });

    switch (event) {
      case 'operations':
        this.handleOperations(payload as number[]);
        break;

      case 'inspectedElement':
        this.handleInspectedElement(payload as InspectElementPayload & { requestID?: number; id?: number });
        break;

      case 'ownersList':
        this.handleOwnersList(payload as { id: number; requestID?: number; owners: SerializedElement[] });
        break;

      case 'profilingData':
        this.handleProfilingData(payload as ProfilingData);
        break;

      case 'profilingStatus':
        this.handleProfilingStatus(payload as { isProfiling: boolean });
        break;

      case 'backendVersion':
        this.backendVersion = payload as string;
        this.logger.info('Backend version', { version: this.backendVersion });
        break;

      case 'bridge':
      case 'bridgeProtocol':
        this.logger.debug('Bridge protocol', { payload });
        break;

      case 'renderer':
        this.handleRenderer(payload as { id: number; rendererPackageName: string; rendererVersion: string });
        break;

      case 'unsupportedRendererVersion':
        this.logger.error('Unsupported React version', { version: payload });
        this.setError(`Unsupported React version: ${payload}`);
        break;

      case 'shutdown':
        this.logger.info('Backend shutdown received');
        this.disconnect();
        break;

      case 'NativeStyleEditor_styleAndLayout':
        this.resolvePending('nativeStyle', payload);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // Phase 2.1: Additional Message Handlers
      // ═══════════════════════════════════════════════════════════════════════

      case 'isBackendStorageAPISupported':
        this.handleStorageSupport(payload as { isSupported: boolean });
        break;

      case 'isSynchronousXHRSupported':
        this.handleXHRSupport(payload as { isSupported: boolean });
        break;

      case 'getSupportedRendererInterfaces':
        this.handleRendererInterfaces(payload as { rendererInterfaces: RendererInterface[] });
        break;

      case 'updateComponentFilters':
        this.logger.debug('Component filters updated');
        this.emit('filtersUpdated');
        break;

      case 'savedToClipboard':
        this.logger.debug('Content saved to clipboard');
        this.resolvePending('clipboard', { success: true });
        break;

      case 'viewAttributeSourceResult':
        this.handleAttributeSourceResult(payload as { source: SourceLocation | null });
        break;

      case 'overrideContextResult':
        this.resolvePending('overrideContext', payload);
        break;

      case 'inspectingNativeStarted':
        this.isInspectingNative = true;
        this.logger.info('Native inspection started');
        this.emit('inspectingNativeStarted');
        break;

      case 'inspectingNativeStopped':
        this.isInspectingNative = false;
        this.handleInspectingNativeStopped(payload as { elementID: number | null });
        break;

      case 'captureScreenshotResult':
        this.resolvePending('screenshot', payload);
        break;

      default:
        this.logger.debug('Unknown message type', { event });
        this.emit('unknown', { event, payload });
    }
  }

  private handleRenderer(payload: { id: number; rendererPackageName: string; rendererVersion: string }): void {
    // Phase 2.3: Enhanced renderer tracking
    const renderer: Renderer = {
      id: payload.id,
      version: payload.rendererVersion,
      packageName: payload.rendererPackageName,
      rootIDs: new Set(),
      elementIDs: new Set(),
    };
    this.renderers.set(payload.id, renderer);
    this.logger.info('Renderer connected', { id: payload.id, version: payload.rendererVersion });
    this.emit('renderer', { id: payload.id, rendererVersion: payload.rendererVersion });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2.1: Capability Detection Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  private handleStorageSupport(payload: { isSupported: boolean }): void {
    this.capabilities.isBackendStorageAPISupported = payload.isSupported;
    this.logger.debug('Storage API support', { isSupported: payload.isSupported });
    this.checkCapabilitiesComplete();
  }

  private handleXHRSupport(payload: { isSupported: boolean }): void {
    this.capabilities.isSynchronousXHRSupported = payload.isSupported;
    this.logger.debug('Synchronous XHR support', { isSupported: payload.isSupported });
    this.checkCapabilitiesComplete();
  }

  private handleRendererInterfaces(payload: { rendererInterfaces: RendererInterface[] }): void {
    this.logger.debug('Renderer interfaces received', { count: payload.rendererInterfaces?.length ?? 0 });

    if (payload.rendererInterfaces) {
      for (const iface of payload.rendererInterfaces) {
        // Update renderer with interface info
        const renderer = this.renderers.get(iface.id);
        if (renderer) {
          renderer.version = iface.version;
          renderer.packageName = iface.renderer;
        }

        // Infer capabilities from renderer version
        const versionNum = parseFloat(iface.version);
        if (versionNum >= 18) {
          this.capabilities.supportsProfilingChangeDescriptions = true;
          this.capabilities.supportsTimeline = true;
          this.capabilities.supportsErrorBoundaryTesting = true;
        }
      }
    }

    this.checkCapabilitiesComplete();
  }

  private checkCapabilitiesComplete(): void {
    // Mark as negotiated once we have basic capability info
    if (!this.capabilitiesNegotiated) {
      this.capabilitiesNegotiated = true;
      this.logger.info('Protocol capabilities negotiated', { capabilities: this.capabilities });
      this.emit('capabilitiesNegotiated', this.capabilities);
    }
  }

  private handleAttributeSourceResult(payload: { source: SourceLocation | null }): void {
    this.resolvePending('attributeSource', payload.source);
    if (payload.source) {
      this.emit('attributeSource', payload.source);
    }
  }

  private handleInspectingNativeStopped(payload: { elementID: number | null }): void {
    this.logger.info('Native inspection stopped', { elementID: payload.elementID });
    this.resolvePending('inspectNative', payload.elementID);
    this.emit('inspectingNativeStopped', payload.elementID);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATIONS PARSING (Phase 1.4: Bounds Checking)
  // ═══════════════════════════════════════════════════════════════════════════

  private handleOperations(operations: number[]): void {
    if (!Array.isArray(operations)) {
      this.logger.warn('Invalid operations: not an array');
      return;
    }

    if (operations.length < 2) {
      this.logger.debug('Empty operations array');
      return;
    }

    const rendererID = operations[0];
    let i = 1;

    this.logger.debug('Processing operations', { rendererID, count: operations.length });

    while (i < operations.length) {
      const op = operations[i];

      // Bounds check: need at least the operation code
      if (typeof op !== 'number') {
        this.logger.warn('Invalid operation code', { index: i, value: op });
        break;
      }

      switch (op) {
        case TREE_OP.ADD:
          i = this.processAddOperation(operations, i + 1, rendererID);
          break;

        case TREE_OP.REMOVE:
          i = this.processRemoveOperation(operations, i + 1);
          break;

        case TREE_OP.REORDER:
          i = this.processReorderOperation(operations, i + 1);
          break;

        case TREE_OP.UPDATE_TREE_BASE_DURATION:
          // Skip: id + baseDuration
          i += 3;
          break;

        case TREE_OP.UPDATE_ERRORS_OR_WARNINGS:
          i = this.processErrorsWarningsOperation(operations, i + 1);
          break;

        default:
          this.logger.warn('Unknown operation code', { code: op, index: i });
          i++;
      }

      // Safety check: ensure we're making progress
      if (i <= 0) {
        this.logger.error('Operations parser stuck', { index: i });
        break;
      }
    }

    this.emit('operationsComplete');
  }

  /**
   * Process ADD operation with bounds checking (Phase 1.4) and renderer tracking (Phase 2.3)
   */
  private processAddOperation(ops: number[], i: number, rendererID: number): number {
    // Minimum fields: id, type, parentID, ownerID, displayNameLen
    const minRequired = 5;
    if (i + minRequired > ops.length) {
      this.logger.warn('ADD operation: insufficient data', { index: i, available: ops.length - i, needed: minRequired });
      return ops.length; // Skip to end
    }

    const id = ops[i++];
    const type = ops[i++];
    const parentID = ops[i++];
    const ownerID = ops[i++];
    const displayNameLength = ops[i++];

    // Validate displayNameLength
    if (displayNameLength < 0 || displayNameLength > 10000) {
      this.logger.warn('ADD operation: invalid displayNameLength', { displayNameLength, id });
      return ops.length;
    }

    // Check we have enough bytes for display name
    if (i + displayNameLength > ops.length) {
      this.logger.warn('ADD operation: displayName extends past array', {
        needed: displayNameLength,
        available: ops.length - i,
      });
      return ops.length;
    }

    // Read display name
    let displayName = '';
    for (let j = 0; j < displayNameLength; j++) {
      const charCode = ops[i++];
      if (typeof charCode === 'number' && charCode >= 0 && charCode <= 0x10FFFF) {
        displayName += String.fromCharCode(charCode);
      }
    }

    // Check for key length field
    if (i >= ops.length) {
      this.logger.warn('ADD operation: missing keyLength field', { id });
      return ops.length;
    }

    const keyLength = ops[i++];
    let key: string | null = null;

    // Validate keyLength
    if (keyLength < 0 || keyLength > 10000) {
      this.logger.warn('ADD operation: invalid keyLength', { keyLength, id });
      return ops.length;
    }

    // Check we have enough bytes for key
    if (keyLength > 0) {
      if (i + keyLength > ops.length) {
        this.logger.warn('ADD operation: key extends past array', {
          needed: keyLength,
          available: ops.length - i,
        });
        return ops.length;
      }

      key = '';
      for (let j = 0; j < keyLength; j++) {
        const charCode = ops[i++];
        if (typeof charCode === 'number' && charCode >= 0 && charCode <= 0x10FFFF) {
          key += String.fromCharCode(charCode);
        }
      }
    }

    const element: Element = {
      id,
      parentID: parentID === 0 ? null : parentID,
      displayName: displayName || 'Unknown',
      type: ELEMENT_TYPE_MAP[type] ?? 'function',
      key,
      depth: 0,
      weight: 1,
      ownerID: ownerID === 0 ? null : ownerID,
      hasChildren: false,
      env: null,
      hocDisplayNames: null,
    };

    // Calculate depth from parent
    if (element.parentID !== null) {
      const parent = this.elements.get(element.parentID);
      if (parent) {
        element.depth = parent.depth + 1;
        parent.hasChildren = true;
      }
    }

    // Track root
    if (element.type === 'root') {
      this.rootIDs.add(id);
      // Phase 2.3: Track root in renderer
      const renderer = this.renderers.get(rendererID);
      if (renderer) {
        renderer.rootIDs.add(id);
      }
    }

    this.elements.set(id, element);

    // Phase 2.3: Track element-to-renderer mapping
    this.elementToRenderer.set(id, rendererID);
    const renderer = this.renderers.get(rendererID);
    if (renderer) {
      renderer.elementIDs.add(id);
    }

    this.emit('elementAdded', element);

    return i;
  }

  /**
   * Process REMOVE operation with bounds checking
   */
  private processRemoveOperation(ops: number[], i: number): number {
    if (i >= ops.length) {
      this.logger.warn('REMOVE operation: missing count');
      return ops.length;
    }

    const count = ops[i++];

    if (count < 0 || count > 100000) {
      this.logger.warn('REMOVE operation: invalid count', { count });
      return ops.length;
    }

    if (i + count > ops.length) {
      this.logger.warn('REMOVE operation: not enough IDs', { count, available: ops.length - i });
      return ops.length;
    }

    for (let j = 0; j < count; j++) {
      const id = ops[i++];
      const element = this.elements.get(id);

      if (element) {
        // Phase 2.3: Clean up renderer tracking
        const rendererID = this.elementToRenderer.get(id);
        if (rendererID !== undefined) {
          const renderer = this.renderers.get(rendererID);
          if (renderer) {
            renderer.elementIDs.delete(id);
            renderer.rootIDs.delete(id);
          }
          this.elementToRenderer.delete(id);
        }

        this.elements.delete(id);
        this.rootIDs.delete(id);
        this.elementErrors.delete(id);
        this.elementWarnings.delete(id);
        this.emit('elementRemoved', element);
      }
    }

    return i;
  }

  /**
   * Process REORDER operation with bounds checking
   */
  private processReorderOperation(ops: number[], i: number): number {
    if (i + 1 >= ops.length) {
      this.logger.warn('REORDER operation: insufficient data');
      return ops.length;
    }

    const id = ops[i++];
    const childCount = ops[i++];

    if (childCount < 0 || childCount > 100000) {
      this.logger.warn('REORDER operation: invalid childCount', { childCount });
      return ops.length;
    }

    if (i + childCount > ops.length) {
      this.logger.warn('REORDER operation: not enough child IDs', { childCount, available: ops.length - i });
      return ops.length;
    }

    // Skip child IDs (reorder doesn't change our flat map)
    i += childCount;
    this.emit('elementReordered', { id, childCount });

    return i;
  }

  /**
   * Process ERRORS/WARNINGS operation with bounds checking
   */
  private processErrorsWarningsOperation(ops: number[], i: number): number {
    if (i + 2 >= ops.length) {
      this.logger.warn('ERRORS_WARNINGS operation: insufficient data');
      return ops.length;
    }

    const id = ops[i++];
    const errorCount = ops[i++];
    const warningCount = ops[i++];

    if (errorCount > 0) {
      this.elementErrors.set(id, []);
    } else {
      this.elementErrors.delete(id);
    }

    if (warningCount > 0) {
      this.elementWarnings.set(id, []);
    } else {
      this.elementWarnings.delete(id);
    }

    return i;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSE HANDLERS (Phase 1.6: ID Correlation)
  // ═══════════════════════════════════════════════════════════════════════════

  private handleInspectedElement(payload: InspectElementPayload & { requestID?: number; id?: number }): void {
    // Try to match by requestID first (Phase 1.6), fall back to element ID
    const key = payload.requestID !== undefined
      ? `inspect_${payload.requestID}`
      : `inspect_${payload.id ?? 'unknown'}`;

    this.resolvePending(key, payload);
  }

  private handleOwnersList(payload: { id: number; requestID?: number; owners: SerializedElement[] }): void {
    const key = payload.requestID !== undefined
      ? `owners_${payload.requestID}`
      : `owners_${payload.id}`;

    this.resolvePending(key, payload.owners);
  }

  private handleProfilingData(payload: ProfilingData): void {
    this.profilingData = payload;
    this.resolvePending('profilingData', payload);
  }

  private handleProfilingStatus(payload: { isProfiling: boolean }): void {
    this.isProfiling = payload.isProfiling;
    this.resolvePending('profilingStatus', payload);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  getComponentTree(rootID?: number, maxDepth?: number): RootTree[] {
    const result: RootTree[] = [];
    const rootsToProcess = rootID ? [rootID] : Array.from(this.rootIDs);

    for (const rid of rootsToProcess) {
      const root = this.elements.get(rid);
      if (!root) continue;

      const elements: Element[] = [];
      const collectElements = (id: number, depth: number) => {
        const el = this.elements.get(id);
        if (!el) return;
        if (maxDepth !== undefined && depth > maxDepth) return;

        elements.push(el);

        // Find children
        for (const [, child] of this.elements) {
          if (child.parentID === id) {
            collectElements(child.id, depth + 1);
          }
        }
      };

      collectElements(rid, 0);

      result.push({
        rootID: rid,
        displayName: root.displayName,
        elements,
      });
    }

    return result;
  }

  getElementById(id: number): Element | null {
    return this.elements.get(id) ?? null;
  }

  searchComponents(query: string, caseSensitive = false, isRegex = false): Element[] {
    const matches: Element[] = [];
    let pattern: RegExp | null = null;

    if (isRegex) {
      try {
        pattern = new RegExp(query, caseSensitive ? '' : 'i');
      } catch {
        this.logger.warn('Invalid regex pattern', { query });
        return [];
      }
    }

    const searchLower = caseSensitive ? query : query.toLowerCase();

    for (const [, element] of this.elements) {
      const name = caseSensitive ? element.displayName : element.displayName.toLowerCase();

      if (pattern) {
        if (pattern.test(element.displayName)) {
          matches.push(element);
        }
      } else if (name.includes(searchLower)) {
        matches.push(element);
      }
    }

    return matches;
  }

  /**
   * Inspect element with request ID correlation (Phase 1.6)
   */
  async inspectElement(id: number, paths?: Array<Array<string | number>>): Promise<InspectElementPayload> {
    this.ensureConnected();

    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) {
      return { type: 'not-found' };
    }

    const requestID = this.nextRequestId();
    const promise = this.createPending(`inspect_${requestID}`, `inspectElement(${id})`);

    this.send('inspectElement', {
      id,
      rendererID,
      requestID,
      forceFullData: true,
      path: paths?.[0] ?? null,
    });

    return promise as Promise<InspectElementPayload>;
  }

  /**
   * Get owners list with request ID correlation (Phase 1.6)
   */
  async getOwnersList(id: number): Promise<SerializedElement[]> {
    this.ensureConnected();

    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) {
      return [];
    }

    const requestID = this.nextRequestId();
    const promise = this.createPending(`owners_${requestID}`, `getOwnersList(${id})`);

    this.send('getOwnersList', { id, rendererID, requestID });

    return promise as Promise<SerializedElement[]>;
  }

  highlightElement(id: number): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send('highlightNativeElement', { id, rendererID });
  }

  clearHighlight(): void {
    if (this.isConnected()) {
      this.send('clearNativeElementHighlight', {});
    }
  }

  scrollToElement(id: number): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send('scrollToNativeElement', { id, rendererID });
  }

  logToConsole(id: number): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send('logElementToConsole', { id, rendererID });
  }

  storeAsGlobal(id: number, path: Array<string | number>, count: number): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send('storeAsGlobal', { id, rendererID, path, count });
  }

  viewElementSource(id: number): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send('viewElementSource', { id, rendererID });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  overrideValueAtPath(
    target: OverrideTarget,
    id: number,
    path: Array<string | number>,
    value: unknown,
    hookIndex?: number
  ): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;

    this.send('overrideValueAtPath', {
      type: target,
      id,
      rendererID,
      path,
      value,
      hookID: hookIndex,
    });
  }

  deletePath(target: OverrideTarget, id: number, path: Array<string | number>, hookIndex?: number): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;

    this.send('deletePath', {
      type: target,
      id,
      rendererID,
      path,
      hookID: hookIndex,
    });
  }

  renamePath(
    target: OverrideTarget,
    id: number,
    path: Array<string | number>,
    oldKey: string,
    newKey: string,
    hookIndex?: number
  ): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;

    this.send('renamePath', {
      type: target,
      id,
      rendererID,
      path,
      oldKey,
      newKey,
      hookID: hookIndex,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR / SUSPENSE
  // ═══════════════════════════════════════════════════════════════════════════

  overrideError(id: number, isErrored: boolean): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send('overrideError', { id, rendererID, forceError: isErrored });
  }

  overrideSuspense(id: number, isSuspended: boolean): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send('overrideSuspense', { id, rendererID, forceFallback: isSuspended });
  }

  clearErrorsAndWarnings(id?: number): void {
    this.ensureConnected();

    if (id !== undefined) {
      const rendererID = this.getRendererIDForElement(id);
      if (rendererID === null) return;
      this.send('clearErrorsForFiberID', { id, rendererID });
    } else {
      this.send('clearErrorsAndWarnings', {});
    }
  }

  getErrorsAndWarnings(): {
    errors: Map<number, Array<[string, number]>>;
    warnings: Map<number, Array<[string, number]>>;
  } {
    return {
      errors: new Map(this.elementErrors),
      warnings: new Map(this.elementWarnings),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILING
  // ═══════════════════════════════════════════════════════════════════════════

  startProfiling(recordTimeline = false, recordChangeDescriptions = true): void {
    this.ensureConnected();
    this.send('startProfiling', { recordTimeline, recordChangeDescriptions });
    this.isProfiling = true;
    this.logger.info('Profiling started', { recordTimeline, recordChangeDescriptions });
  }

  stopProfiling(): void {
    this.ensureConnected();
    this.send('stopProfiling', {});
    this.isProfiling = false;
    this.logger.info('Profiling stopped');
  }

  async getProfilingData(): Promise<ProfilingData | null> {
    if (!this.isProfiling && this.profilingData) {
      return this.profilingData;
    }

    this.ensureConnected();
    const promise = this.createPending('profilingData', 'getProfilingData');
    this.send('getProfilingData', {});
    return promise as Promise<ProfilingData>;
  }

  getProfilingStatus(): { isProfiling: boolean } {
    return { isProfiling: this.isProfiling };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILTERS
  // ═══════════════════════════════════════════════════════════════════════════

  setComponentFilters(filters: ComponentFilter[]): void {
    this.ensureConnected();
    this.send('updateComponentFilters', { componentFilters: filters });
  }

  setTraceUpdatesEnabled(enabled: boolean): void {
    this.ensureConnected();
    this.send('setTraceUpdatesEnabled', { enabled });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REACT NATIVE SPECIFIC
  // ═══════════════════════════════════════════════════════════════════════════

  async getNativeStyle(id: number): Promise<{
    style: Record<string, unknown> | null;
    layout: { x: number; y: number; width: number; height: number } | null;
  }> {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) {
      return { style: null, layout: null };
    }

    const promise = this.createPending('nativeStyle', `getNativeStyle(${id})`);
    this.send('NativeStyleEditor_measure', { id, rendererID });
    return promise as Promise<{ style: Record<string, unknown>; layout: { x: number; y: number; width: number; height: number } }>;
  }

  setNativeStyle(id: number, property: string, value: unknown): void {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send('NativeStyleEditor_setValue', { id, rendererID, name: property, value });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2.1: ADDITIONAL PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save content to clipboard
   */
  async saveToClipboard(value: string): Promise<{ success: boolean }> {
    this.ensureConnected();
    const promise = this.createPending('clipboard', 'saveToClipboard');
    this.send('saveToClipboard', { value });

    // Timeout fallback - clipboard save doesn't always respond
    return Promise.race([
      promise as Promise<{ success: boolean }>,
      new Promise<{ success: boolean }>((resolve) =>
        setTimeout(() => resolve({ success: true }), 500)
      ),
    ]);
  }

  /**
   * View attribute source location
   */
  async viewAttributeSource(id: number, path: Array<string | number>): Promise<SourceLocation | null> {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return null;

    const promise = this.createPending('attributeSource', `viewAttributeSource(${id})`);
    this.send('viewAttributeSource', { id, rendererID, path });
    return promise as Promise<SourceLocation | null>;
  }

  /**
   * Override context value
   */
  async overrideContext(id: number, path: Array<string | number>, value: unknown): Promise<boolean> {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return false;

    const promise = this.createPending('overrideContext', `overrideContext(${id})`);
    this.send('overrideContext', { id, rendererID, path, value });

    try {
      const result = await promise as { success: boolean };
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Start native element inspection mode
   */
  startInspectingNative(): void {
    this.ensureConnected();
    this.send('startInspectingNative', {});
  }

  /**
   * Stop native element inspection mode
   * @param selectNextElement - Whether to select the next element under pointer
   * @returns The ID of the selected element, or null
   */
  async stopInspectingNative(selectNextElement = true): Promise<number | null> {
    this.ensureConnected();
    const promise = this.createPending('inspectNative', 'stopInspectingNative');
    this.send('stopInspectingNative', { selectNextElement });
    return promise as Promise<number | null>;
  }

  /**
   * Check if currently in native inspection mode
   */
  isInspectingNativeMode(): boolean {
    return this.isInspectingNative;
  }

  /**
   * Capture screenshot of an element
   */
  async captureScreenshot(id: number): Promise<string | null> {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return null;

    const promise = this.createPending('screenshot', `captureScreenshot(${id})`);
    this.send('captureScreenshot', { id, rendererID });

    try {
      const result = await promise as { screenshot: string | null };
      return result.screenshot;
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2.2: CAPABILITIES API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get negotiated protocol capabilities
   */
  getCapabilities(): ProtocolCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Check if capabilities have been negotiated
   */
  hasNegotiatedCapabilities(): boolean {
    return this.capabilitiesNegotiated;
  }

  /**
   * Wait for capabilities negotiation to complete
   */
  async waitForCapabilities(timeout = 5000): Promise<ProtocolCapabilities> {
    if (this.capabilitiesNegotiated) {
      return this.getCapabilities();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('capabilitiesNegotiated', handler);
        reject(new TimeoutError('waitForCapabilities', timeout));
      }, timeout);

      const handler = (capabilities: ProtocolCapabilities) => {
        clearTimeout(timer);
        resolve(capabilities);
      };

      this.once('capabilitiesNegotiated', handler);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2.3: RENDERER MANAGEMENT API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all connected renderers
   */
  getRenderers(): Renderer[] {
    return Array.from(this.renderers.values()).map((r) => ({
      ...r,
      rootIDs: new Set(r.rootIDs),
      elementIDs: new Set(r.elementIDs),
    }));
  }

  /**
   * Get renderer by ID
   */
  getRenderer(id: number): Renderer | null {
    const renderer = this.renderers.get(id);
    if (!renderer) return null;
    return {
      ...renderer,
      rootIDs: new Set(renderer.rootIDs),
      elementIDs: new Set(renderer.elementIDs),
    };
  }

  /**
   * Get renderer for a specific element
   */
  getRendererForElement(elementID: number): Renderer | null {
    const rendererID = this.getRendererIDForElement(elementID);
    if (rendererID === null) return null;
    return this.getRenderer(rendererID);
  }

  /**
   * Get elements for a specific renderer
   */
  getElementsByRenderer(rendererID: number): Element[] {
    const renderer = this.renderers.get(rendererID);
    if (!renderer) return [];

    return Array.from(renderer.elementIDs)
      .map((id) => this.elements.get(id))
      .filter((el): el is Element => el !== undefined);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new ConnectionError('Not connected to DevTools');
    }
  }

  /**
   * Get renderer ID for an element (Phase 2.3: Multi-renderer support)
   */
  private getRendererIDForElement(id: number): number | null {
    // Check element-to-renderer mapping first
    const rendererID = this.elementToRenderer.get(id);
    if (rendererID !== undefined) {
      return rendererID;
    }

    // Fall back to finding renderer by searching all renderers' element sets
    for (const renderer of this.renderers.values()) {
      if (renderer.elementIDs.has(id) || renderer.rootIDs.has(id)) {
        return renderer.id;
      }
    }

    // Default fallback: use first renderer or 1
    if (this.renderers.size === 0) {
      return 1;
    }
    return this.renderers.keys().next().value ?? 1;
  }

  /**
   * Get last message timestamp (for health monitoring)
   */
  getLastMessageTime(): number {
    return this.lastMessageAt;
  }

  /**
   * Get pending request count (for monitoring)
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }
}

#!/usr/bin/env node
#!/usr/bin/env node

// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/bridge.ts
import { WebSocket } from "ws";
import { EventEmitter } from "events";

// src/logger.ts
var LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
};
function defaultOutput(entry) {
  const timestamp = new Date(entry.timestamp).toISOString();
  const prefix = entry.prefix ? `[${entry.prefix}]` : "";
  const level = entry.level.toUpperCase().padEnd(5);
  const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : "";
  console.error(`${timestamp} ${level} ${prefix} ${entry.message}${meta}`);
}
function createLogger(options = {}) {
  const level = options.level ?? "warn";
  const prefix = options.prefix;
  const output = options.output ?? defaultOutput;
  const minLevel = LOG_LEVELS[level];
  const log = (logLevel, message, meta) => {
    if (LOG_LEVELS[logLevel] < minLevel) return;
    output({
      level: logLevel,
      message,
      timestamp: Date.now(),
      prefix,
      meta
    });
  };
  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
    child: (childPrefix) => createLogger({
      level,
      prefix: prefix ? `${prefix}:${childPrefix}` : childPrefix,
      output
    })
  };
}
var noopLogger = {
  debug: () => {
  },
  info: () => {
  },
  warn: () => {
  },
  error: () => {
  },
  child: () => noopLogger
};
function getLogLevelFromEnv() {
  const envLevel = process.env.DEVTOOLS_LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel;
  }
  return process.env.DEVTOOLS_DEBUG === "true" ? "debug" : "warn";
}

// src/errors.ts
var DevToolsError = class extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "DevToolsError";
    Error.captureStackTrace?.(this, this.constructor);
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
};
var ConnectionError = class extends DevToolsError {
  constructor(message, details) {
    super(message, "NOT_CONNECTED", details);
    this.name = "ConnectionError";
  }
};
var TimeoutError = class extends DevToolsError {
  constructor(operation, timeout, details) {
    super(`Request timeout after ${timeout}ms: ${operation}`, "TIMEOUT", {
      operation,
      timeout,
      ...details
    });
    this.name = "TimeoutError";
  }
};

// src/bridge.ts
var ELEMENT_TYPE_MAP = {
  1: "class",
  2: "context",
  5: "function",
  6: "forward_ref",
  7: "fragment",
  8: "host",
  9: "memo",
  10: "portal",
  11: "root",
  12: "profiler",
  13: "suspense",
  14: "lazy",
  15: "cache",
  16: "activity",
  17: "virtual"
};
var TREE_OP = {
  ADD: 1,
  REMOVE: 2,
  REORDER: 3,
  UPDATE_TREE_BASE_DURATION: 4,
  UPDATE_ERRORS_OR_WARNINGS: 5
};
var DEFAULT_CONFIG = {
  host: "localhost",
  port: 8097,
  timeout: 5e3,
  autoReconnect: true
};
var RECONNECT = {
  MAX_ATTEMPTS: 5,
  BASE_DELAY: 1e3,
  MAX_DELAY: 3e4
};
var DevToolsBridge = class extends EventEmitter {
  config;
  logger;
  ws = null;
  state = "disconnected";
  error = null;
  // Connection management (Phase 1.2: Race condition fix)
  connectPromise = null;
  // Reconnection state (Phase 1.3: Auto-reconnection)
  reconnectAttempts = 0;
  reconnectTimer = null;
  manualDisconnect = false;
  // Component tree state
  elements = /* @__PURE__ */ new Map();
  rootIDs = /* @__PURE__ */ new Set();
  renderers = /* @__PURE__ */ new Map();
  // Request tracking (Phase 1.5 & 1.6: Memory leak fix + ID correlation)
  pendingRequests = /* @__PURE__ */ new Map();
  requestIdCounter = 0;
  staleRequestCleanupTimer = null;
  // Errors/warnings state
  elementErrors = /* @__PURE__ */ new Map();
  elementWarnings = /* @__PURE__ */ new Map();
  // Profiling state
  isProfiling = false;
  profilingData = null;
  // Protocol info
  backendVersion = null;
  lastMessageAt = 0;
  constructor(options = {}) {
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
  async connect() {
    if (this.connectPromise) {
      this.logger.debug("Returning existing connection attempt");
      return this.connectPromise;
    }
    if (this.state === "connected" && this.ws?.readyState === WebSocket.OPEN) {
      this.logger.debug("Already connected");
      return this.getStatus();
    }
    if (this.ws) {
      this.logger.debug("Cleaning up stale WebSocket");
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
  async doConnect() {
    this.setState("connecting");
    const url = `ws://${this.config.host}:${this.config.port}`;
    this.logger.info("Connecting to DevTools", { url });
    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        this.logger.error("Connection timeout", { url, timeout: this.config.timeout });
        this.ws?.close();
        this.setError("Connection timeout");
        reject(new ConnectionError("Connection timeout", { url, timeout: this.config.timeout }));
      }, this.config.timeout);
      try {
        this.ws = new WebSocket(url);
        this.ws.on("open", () => {
          clearTimeout(connectionTimeout);
          this.logger.info("Connected to DevTools");
          this.onConnected();
          resolve(this.getStatus());
        });
        this.ws.on("message", (data) => {
          this.handleMessage(data.toString());
        });
        this.ws.on("close", (code, reason) => {
          this.handleClose(code, reason.toString());
        });
        this.ws.on("error", (err) => {
          clearTimeout(connectionTimeout);
          this.logger.error("WebSocket error", { error: err.message });
          this.setError(err.message);
          reject(new ConnectionError(err.message));
        });
      } catch (err) {
        clearTimeout(connectionTimeout);
        const message = err instanceof Error ? err.message : "Unknown error";
        this.logger.error("Connection failed", { error: message });
        this.setError(message);
        reject(new ConnectionError(message));
      }
    });
  }
  /**
   * Called when connection is established
   */
  onConnected() {
    this.setState("connected");
    this.error = null;
    this.reconnectAttempts = 0;
    this.lastMessageAt = Date.now();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.startStaleRequestCleanup();
    this.send("bridge", { version: 2 });
    this.emit("connected");
  }
  /**
   * Handle WebSocket close event
   */
  handleClose(code, reason) {
    this.logger.info("Connection closed", { code, reason });
    this.setState("disconnected");
    this.emit("disconnected", { code, reason });
    this.stopStaleRequestCleanup();
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timeout);
      req.reject(new ConnectionError("Connection closed"));
    }
    this.pendingRequests.clear();
    if (!this.manualDisconnect && this.config.autoReconnect && code !== 1e3 && code !== 1001) {
      this.scheduleReconnect();
    }
  }
  /**
   * Schedule a reconnection attempt with exponential backoff (Phase 1.3)
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= RECONNECT.MAX_ATTEMPTS) {
      this.logger.error("Max reconnection attempts reached", { attempts: this.reconnectAttempts });
      this.emit("reconnectFailed", { attempts: this.reconnectAttempts });
      return;
    }
    const delay = Math.min(
      RECONNECT.BASE_DELAY * Math.pow(2, this.reconnectAttempts) + Math.random() * 1e3,
      RECONNECT.MAX_DELAY
    );
    this.reconnectAttempts++;
    this.logger.info("Scheduling reconnection", { attempt: this.reconnectAttempts, delay });
    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.warn("Reconnection failed", { error: err.message });
      });
    }, delay);
  }
  /**
   * Disconnect from DevTools backend
   */
  disconnect() {
    this.logger.info("Disconnecting");
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1e3, "Client disconnect");
      this.ws = null;
    }
    this.setState("disconnected");
    this.reset();
  }
  /**
   * Get current connection status
   */
  getStatus() {
    return {
      state: this.state,
      rendererCount: this.renderers.size,
      reactVersion: this.backendVersion,
      error: this.error
    };
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }
  setState(state) {
    this.state = state;
    this.emit("stateChange", state);
  }
  setError(message) {
    this.error = message;
    this.setState("error");
  }
  reset() {
    this.elements.clear();
    this.rootIDs.clear();
    this.renderers.clear();
    this.elementErrors.clear();
    this.elementWarnings.clear();
    this.isProfiling = false;
    this.profilingData = null;
    this.stopStaleRequestCleanup();
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // REQUEST MANAGEMENT (Phase 1.5 & 1.6)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Generate unique request ID (Phase 1.6)
   */
  nextRequestId() {
    return ++this.requestIdCounter;
  }
  /**
   * Create a pending request with proper cleanup (Phase 1.5)
   */
  createPending(key, operation, timeout) {
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
        this.logger.warn("Request timeout", { key, operation, timeout: timeoutMs });
        cleanup();
        reject(new TimeoutError(operation, timeoutMs, { key }));
      }, timeoutMs);
      this.pendingRequests.set(key, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        timeout: timeoutId,
        createdAt: Date.now(),
        operation
      });
    });
  }
  /**
   * Resolve a pending request
   */
  resolvePending(key, value) {
    const pending = this.pendingRequests.get(key);
    if (pending) {
      this.logger.debug("Resolving request", { key, operation: pending.operation });
      pending.resolve(value);
    }
  }
  /**
   * Start periodic cleanup of stale requests (Phase 1.5)
   */
  startStaleRequestCleanup() {
    this.staleRequestCleanupTimer = setInterval(() => {
      const now = Date.now();
      const maxAge = this.config.timeout * 2;
      for (const [key, req] of this.pendingRequests) {
        const age = now - req.createdAt;
        if (age > maxAge) {
          this.logger.warn("Cleaning stale request", { key, operation: req.operation, age });
          clearTimeout(req.timeout);
          this.pendingRequests.delete(key);
          req.reject(new TimeoutError(req.operation, age, { key, stale: true }));
        }
      }
    }, 6e4);
  }
  /**
   * Stop stale request cleanup
   */
  stopStaleRequestCleanup() {
    if (this.staleRequestCleanupTimer) {
      clearInterval(this.staleRequestCleanupTimer);
      this.staleRequestCleanupTimer = null;
    }
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════
  send(event, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ConnectionError("Not connected");
    }
    const message = JSON.stringify({ event, payload });
    this.logger.debug("Sending message", { event, payloadSize: message.length });
    this.ws.send(message);
  }
  handleMessage(data) {
    this.lastMessageAt = Date.now();
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown parse error";
      this.logger.error("Failed to parse message", { error, dataPreview: data.substring(0, 100) });
      this.emit("parseError", { data: data.substring(0, 100), error });
      return;
    }
    const { event, payload } = parsed;
    if (!event) {
      this.logger.warn("Message missing event field", { dataPreview: data.substring(0, 100) });
      return;
    }
    this.logger.debug("Received message", { event });
    switch (event) {
      case "operations":
        this.handleOperations(payload);
        break;
      case "inspectedElement":
        this.handleInspectedElement(payload);
        break;
      case "ownersList":
        this.handleOwnersList(payload);
        break;
      case "profilingData":
        this.handleProfilingData(payload);
        break;
      case "profilingStatus":
        this.handleProfilingStatus(payload);
        break;
      case "backendVersion":
        this.backendVersion = payload;
        this.logger.info("Backend version", { version: this.backendVersion });
        break;
      case "bridge":
      case "bridgeProtocol":
        this.logger.debug("Bridge protocol", { payload });
        break;
      case "renderer":
        this.handleRenderer(payload);
        break;
      case "unsupportedRendererVersion":
        this.logger.error("Unsupported React version", { version: payload });
        this.setError(`Unsupported React version: ${payload}`);
        break;
      case "shutdown":
        this.logger.info("Backend shutdown received");
        this.disconnect();
        break;
      case "NativeStyleEditor_styleAndLayout":
        this.resolvePending("nativeStyle", payload);
        break;
      default:
        this.logger.debug("Unknown message type", { event });
        this.emit("unknown", { event, payload });
    }
  }
  handleRenderer(payload) {
    this.renderers.set(payload.id, {
      id: payload.id,
      version: payload.rendererVersion,
      packageName: payload.rendererPackageName
    });
    this.logger.info("Renderer connected", { id: payload.id, version: payload.rendererVersion });
    this.emit("renderer", payload);
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATIONS PARSING (Phase 1.4: Bounds Checking)
  // ═══════════════════════════════════════════════════════════════════════════
  handleOperations(operations) {
    if (!Array.isArray(operations)) {
      this.logger.warn("Invalid operations: not an array");
      return;
    }
    if (operations.length < 2) {
      this.logger.debug("Empty operations array");
      return;
    }
    const rendererID = operations[0];
    let i = 1;
    this.logger.debug("Processing operations", { rendererID, count: operations.length });
    while (i < operations.length) {
      const op = operations[i];
      if (typeof op !== "number") {
        this.logger.warn("Invalid operation code", { index: i, value: op });
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
          i += 3;
          break;
        case TREE_OP.UPDATE_ERRORS_OR_WARNINGS:
          i = this.processErrorsWarningsOperation(operations, i + 1);
          break;
        default:
          this.logger.warn("Unknown operation code", { code: op, index: i });
          i++;
      }
      if (i <= 0) {
        this.logger.error("Operations parser stuck", { index: i });
        break;
      }
    }
    this.emit("operationsComplete");
  }
  /**
   * Process ADD operation with bounds checking (Phase 1.4)
   */
  processAddOperation(ops, i, _rendererID) {
    const minRequired = 5;
    if (i + minRequired > ops.length) {
      this.logger.warn("ADD operation: insufficient data", { index: i, available: ops.length - i, needed: minRequired });
      return ops.length;
    }
    const id = ops[i++];
    const type = ops[i++];
    const parentID = ops[i++];
    const ownerID = ops[i++];
    const displayNameLength = ops[i++];
    if (displayNameLength < 0 || displayNameLength > 1e4) {
      this.logger.warn("ADD operation: invalid displayNameLength", { displayNameLength, id });
      return ops.length;
    }
    if (i + displayNameLength > ops.length) {
      this.logger.warn("ADD operation: displayName extends past array", {
        needed: displayNameLength,
        available: ops.length - i
      });
      return ops.length;
    }
    let displayName = "";
    for (let j = 0; j < displayNameLength; j++) {
      const charCode = ops[i++];
      if (typeof charCode === "number" && charCode >= 0 && charCode <= 1114111) {
        displayName += String.fromCharCode(charCode);
      }
    }
    if (i >= ops.length) {
      this.logger.warn("ADD operation: missing keyLength field", { id });
      return ops.length;
    }
    const keyLength = ops[i++];
    let key = null;
    if (keyLength < 0 || keyLength > 1e4) {
      this.logger.warn("ADD operation: invalid keyLength", { keyLength, id });
      return ops.length;
    }
    if (keyLength > 0) {
      if (i + keyLength > ops.length) {
        this.logger.warn("ADD operation: key extends past array", {
          needed: keyLength,
          available: ops.length - i
        });
        return ops.length;
      }
      key = "";
      for (let j = 0; j < keyLength; j++) {
        const charCode = ops[i++];
        if (typeof charCode === "number" && charCode >= 0 && charCode <= 1114111) {
          key += String.fromCharCode(charCode);
        }
      }
    }
    const element = {
      id,
      parentID: parentID === 0 ? null : parentID,
      displayName: displayName || "Unknown",
      type: ELEMENT_TYPE_MAP[type] ?? "function",
      key,
      depth: 0,
      weight: 1,
      ownerID: ownerID === 0 ? null : ownerID,
      hasChildren: false,
      env: null,
      hocDisplayNames: null
    };
    if (element.parentID !== null) {
      const parent = this.elements.get(element.parentID);
      if (parent) {
        element.depth = parent.depth + 1;
        parent.hasChildren = true;
      }
    }
    if (element.type === "root") {
      this.rootIDs.add(id);
    }
    this.elements.set(id, element);
    this.emit("elementAdded", element);
    return i;
  }
  /**
   * Process REMOVE operation with bounds checking
   */
  processRemoveOperation(ops, i) {
    if (i >= ops.length) {
      this.logger.warn("REMOVE operation: missing count");
      return ops.length;
    }
    const count = ops[i++];
    if (count < 0 || count > 1e5) {
      this.logger.warn("REMOVE operation: invalid count", { count });
      return ops.length;
    }
    if (i + count > ops.length) {
      this.logger.warn("REMOVE operation: not enough IDs", { count, available: ops.length - i });
      return ops.length;
    }
    for (let j = 0; j < count; j++) {
      const id = ops[i++];
      const element = this.elements.get(id);
      if (element) {
        this.elements.delete(id);
        this.rootIDs.delete(id);
        this.elementErrors.delete(id);
        this.elementWarnings.delete(id);
        this.emit("elementRemoved", element);
      }
    }
    return i;
  }
  /**
   * Process REORDER operation with bounds checking
   */
  processReorderOperation(ops, i) {
    if (i + 1 >= ops.length) {
      this.logger.warn("REORDER operation: insufficient data");
      return ops.length;
    }
    const id = ops[i++];
    const childCount = ops[i++];
    if (childCount < 0 || childCount > 1e5) {
      this.logger.warn("REORDER operation: invalid childCount", { childCount });
      return ops.length;
    }
    if (i + childCount > ops.length) {
      this.logger.warn("REORDER operation: not enough child IDs", { childCount, available: ops.length - i });
      return ops.length;
    }
    i += childCount;
    this.emit("elementReordered", { id, childCount });
    return i;
  }
  /**
   * Process ERRORS/WARNINGS operation with bounds checking
   */
  processErrorsWarningsOperation(ops, i) {
    if (i + 2 >= ops.length) {
      this.logger.warn("ERRORS_WARNINGS operation: insufficient data");
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
  handleInspectedElement(payload) {
    const key = payload.requestID !== void 0 ? `inspect_${payload.requestID}` : `inspect_${payload.id ?? "unknown"}`;
    this.resolvePending(key, payload);
  }
  handleOwnersList(payload) {
    const key = payload.requestID !== void 0 ? `owners_${payload.requestID}` : `owners_${payload.id}`;
    this.resolvePending(key, payload.owners);
  }
  handleProfilingData(payload) {
    this.profilingData = payload;
    this.resolvePending("profilingData", payload);
  }
  handleProfilingStatus(payload) {
    this.isProfiling = payload.isProfiling;
    this.resolvePending("profilingStatus", payload);
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════
  getComponentTree(rootID, maxDepth) {
    const result = [];
    const rootsToProcess = rootID ? [rootID] : Array.from(this.rootIDs);
    for (const rid of rootsToProcess) {
      const root = this.elements.get(rid);
      if (!root) continue;
      const elements = [];
      const collectElements = (id, depth) => {
        const el = this.elements.get(id);
        if (!el) return;
        if (maxDepth !== void 0 && depth > maxDepth) return;
        elements.push(el);
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
        elements
      });
    }
    return result;
  }
  getElementById(id) {
    return this.elements.get(id) ?? null;
  }
  searchComponents(query, caseSensitive = false, isRegex = false) {
    const matches = [];
    let pattern = null;
    if (isRegex) {
      try {
        pattern = new RegExp(query, caseSensitive ? "" : "i");
      } catch {
        this.logger.warn("Invalid regex pattern", { query });
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
  async inspectElement(id, paths) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) {
      return { type: "not-found" };
    }
    const requestID = this.nextRequestId();
    const promise = this.createPending(`inspect_${requestID}`, `inspectElement(${id})`);
    this.send("inspectElement", {
      id,
      rendererID,
      requestID,
      forceFullData: true,
      path: paths?.[0] ?? null
    });
    return promise;
  }
  /**
   * Get owners list with request ID correlation (Phase 1.6)
   */
  async getOwnersList(id) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) {
      return [];
    }
    const requestID = this.nextRequestId();
    const promise = this.createPending(`owners_${requestID}`, `getOwnersList(${id})`);
    this.send("getOwnersList", { id, rendererID, requestID });
    return promise;
  }
  highlightElement(id) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("highlightNativeElement", { id, rendererID });
  }
  clearHighlight() {
    if (this.isConnected()) {
      this.send("clearNativeElementHighlight", {});
    }
  }
  scrollToElement(id) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("scrollToNativeElement", { id, rendererID });
  }
  logToConsole(id) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("logElementToConsole", { id, rendererID });
  }
  storeAsGlobal(id, path, count) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("storeAsGlobal", { id, rendererID, path, count });
  }
  viewElementSource(id) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("viewElementSource", { id, rendererID });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════
  overrideValueAtPath(target, id, path, value, hookIndex) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("overrideValueAtPath", {
      type: target,
      id,
      rendererID,
      path,
      value,
      hookID: hookIndex
    });
  }
  deletePath(target, id, path, hookIndex) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("deletePath", {
      type: target,
      id,
      rendererID,
      path,
      hookID: hookIndex
    });
  }
  renamePath(target, id, path, oldKey, newKey, hookIndex) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("renamePath", {
      type: target,
      id,
      rendererID,
      path,
      oldKey,
      newKey,
      hookID: hookIndex
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR / SUSPENSE
  // ═══════════════════════════════════════════════════════════════════════════
  overrideError(id, isErrored) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("overrideError", { id, rendererID, forceError: isErrored });
  }
  overrideSuspense(id, isSuspended) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("overrideSuspense", { id, rendererID, forceFallback: isSuspended });
  }
  clearErrorsAndWarnings(id) {
    this.ensureConnected();
    if (id !== void 0) {
      const rendererID = this.getRendererIDForElement(id);
      if (rendererID === null) return;
      this.send("clearErrorsForFiberID", { id, rendererID });
    } else {
      this.send("clearErrorsAndWarnings", {});
    }
  }
  getErrorsAndWarnings() {
    return {
      errors: new Map(this.elementErrors),
      warnings: new Map(this.elementWarnings)
    };
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILING
  // ═══════════════════════════════════════════════════════════════════════════
  startProfiling(recordTimeline = false, recordChangeDescriptions = true) {
    this.ensureConnected();
    this.send("startProfiling", { recordTimeline, recordChangeDescriptions });
    this.isProfiling = true;
    this.logger.info("Profiling started", { recordTimeline, recordChangeDescriptions });
  }
  stopProfiling() {
    this.ensureConnected();
    this.send("stopProfiling", {});
    this.isProfiling = false;
    this.logger.info("Profiling stopped");
  }
  async getProfilingData() {
    if (!this.isProfiling && this.profilingData) {
      return this.profilingData;
    }
    this.ensureConnected();
    const promise = this.createPending("profilingData", "getProfilingData");
    this.send("getProfilingData", {});
    return promise;
  }
  getProfilingStatus() {
    return { isProfiling: this.isProfiling };
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // FILTERS
  // ═══════════════════════════════════════════════════════════════════════════
  setComponentFilters(filters) {
    this.ensureConnected();
    this.send("updateComponentFilters", { componentFilters: filters });
  }
  setTraceUpdatesEnabled(enabled) {
    this.ensureConnected();
    this.send("setTraceUpdatesEnabled", { enabled });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // REACT NATIVE SPECIFIC
  // ═══════════════════════════════════════════════════════════════════════════
  async getNativeStyle(id) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) {
      return { style: null, layout: null };
    }
    const promise = this.createPending("nativeStyle", `getNativeStyle(${id})`);
    this.send("NativeStyleEditor_measure", { id, rendererID });
    return promise;
  }
  setNativeStyle(id, property, value) {
    this.ensureConnected();
    const rendererID = this.getRendererIDForElement(id);
    if (rendererID === null) return;
    this.send("NativeStyleEditor_setValue", { id, rendererID, name: property, value });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  ensureConnected() {
    if (!this.isConnected()) {
      throw new ConnectionError("Not connected to DevTools");
    }
  }
  getRendererIDForElement(_id) {
    if (this.renderers.size === 0) {
      return 1;
    }
    return this.renderers.keys().next().value ?? 1;
  }
  /**
   * Get last message timestamp (for health monitoring)
   */
  getLastMessageTime() {
    return this.lastMessageAt;
  }
  /**
   * Get pending request count (for monitoring)
   */
  getPendingRequestCount() {
    return this.pendingRequests.size;
  }
};

// src/server.ts
var TOOLS = [
  // Connection
  {
    name: "connect",
    description: "Connect to React DevTools backend via WebSocket",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", description: "Host (default: localhost)" },
        port: { type: "number", description: "Port (default: 8097)" },
        timeout: { type: "number", description: "Timeout in ms (default: 5000)" }
      }
    }
  },
  {
    name: "disconnect",
    description: "Disconnect from React DevTools backend",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_connection_status",
    description: "Get current connection status",
    inputSchema: { type: "object", properties: {} }
  },
  // Component Tree
  {
    name: "get_component_tree",
    description: "Get the React component tree for all roots",
    inputSchema: {
      type: "object",
      properties: {
        rootID: { type: "number", description: "Filter by root ID (optional)" },
        maxDepth: { type: "number", description: "Maximum depth to return (optional)" }
      }
    }
  },
  {
    name: "get_element_by_id",
    description: "Get basic element info by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" }
      },
      required: ["id"]
    }
  },
  {
    name: "search_components",
    description: "Search for components by name",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (component name)" },
        caseSensitive: { type: "boolean", description: "Case sensitive (default: false)" },
        isRegex: { type: "boolean", description: "Regex search (default: false)" }
      },
      required: ["query"]
    }
  },
  // Inspection
  {
    name: "inspect_element",
    description: "Get full inspection data for a component including props, state, hooks",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID to inspect" },
        paths: {
          type: "array",
          items: {
            type: "array",
            items: { oneOf: [{ type: "string" }, { type: "number" }] }
          },
          description: "Paths to hydrate for lazy loading"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "get_owners_list",
    description: "Get the chain of components that rendered this element",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" }
      },
      required: ["id"]
    }
  },
  {
    name: "get_element_source",
    description: "Get source location for an element",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" }
      },
      required: ["id"]
    }
  },
  // Overrides
  {
    name: "override_props",
    description: "Override a prop value on a component",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        path: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
          description: "Path to the prop"
        },
        value: { description: "New value" }
      },
      required: ["id", "path", "value"]
    }
  },
  {
    name: "override_state",
    description: "Override a state value on a class component",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        path: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
          description: "Path to state key"
        },
        value: { description: "New value" }
      },
      required: ["id", "path", "value"]
    }
  },
  {
    name: "override_hooks",
    description: "Override a hook value on a function component",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        hookIndex: { type: "number", description: "Hook index" },
        path: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
          description: "Path within hook value"
        },
        value: { description: "New value" }
      },
      required: ["id", "hookIndex", "path", "value"]
    }
  },
  {
    name: "override_context",
    description: "Override a context value",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        path: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
          description: "Path within context"
        },
        value: { description: "New value" }
      },
      required: ["id", "path", "value"]
    }
  },
  {
    name: "delete_path",
    description: "Delete a path from props/state/hooks/context",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        target: { type: "string", enum: ["props", "state", "hooks", "context"], description: "Target" },
        hookIndex: { type: "number", description: "Hook index (if target is hooks)" },
        path: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
          description: "Path to delete"
        }
      },
      required: ["id", "target", "path"]
    }
  },
  {
    name: "rename_path",
    description: "Rename a key in props/state/hooks/context",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        target: { type: "string", enum: ["props", "state", "hooks", "context"], description: "Target" },
        hookIndex: { type: "number", description: "Hook index (if target is hooks)" },
        path: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
          description: "Path to the key"
        },
        oldKey: { type: "string", description: "Old key name" },
        newKey: { type: "string", description: "New key name" }
      },
      required: ["id", "target", "path", "oldKey", "newKey"]
    }
  },
  // Profiling
  {
    name: "start_profiling",
    description: "Start profiling React renders",
    inputSchema: {
      type: "object",
      properties: {
        recordTimeline: { type: "boolean", description: "Record timeline data" },
        recordChangeDescriptions: { type: "boolean", description: "Record why components rendered" }
      }
    }
  },
  {
    name: "stop_profiling",
    description: "Stop profiling and get data",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_profiling_data",
    description: "Get profiling data without stopping",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_profiling_status",
    description: "Check if profiling is active",
    inputSchema: { type: "object", properties: {} }
  },
  // Error & Suspense
  {
    name: "get_errors_and_warnings",
    description: "Get all errors and warnings from components",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "clear_errors_and_warnings",
    description: "Clear all or specific element's errors/warnings",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID (optional, clears all if omitted)" },
        clearErrors: { type: "boolean", description: "Clear errors" },
        clearWarnings: { type: "boolean", description: "Clear warnings" }
      }
    }
  },
  {
    name: "toggle_error",
    description: "Toggle error boundary state for testing",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        isErrored: { type: "boolean", description: "Force error state" }
      },
      required: ["id", "isErrored"]
    }
  },
  {
    name: "toggle_suspense",
    description: "Toggle suspense state for testing",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        isSuspended: { type: "boolean", description: "Force suspended state" }
      },
      required: ["id", "isSuspended"]
    }
  },
  // Debugging
  {
    name: "highlight_element",
    description: "Highlight an element in the app UI",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID to highlight" },
        duration: { type: "number", description: "Highlight duration in ms (default: 2000)" }
      },
      required: ["id"]
    }
  },
  {
    name: "clear_highlight",
    description: "Clear any active element highlight",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "scroll_to_element",
    description: "Scroll the app to show an element",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" }
      },
      required: ["id"]
    }
  },
  {
    name: "log_to_console",
    description: "Log an element to the browser/app console as $r",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" }
      },
      required: ["id"]
    }
  },
  {
    name: "store_as_global",
    description: "Store a value as a global variable for console access",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        path: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
          description: "Path to the value"
        },
        globalName: { type: "string", description: "Global variable name" }
      },
      required: ["id", "path", "globalName"]
    }
  },
  {
    name: "view_source",
    description: "Open element source in IDE (if supported)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" }
      },
      required: ["id"]
    }
  },
  // Filters
  {
    name: "get_component_filters",
    description: "Get current component filters",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "set_component_filters",
    description: "Set component filters (hide certain components)",
    inputSchema: {
      type: "object",
      properties: {
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["name", "location", "type", "hoc"] },
              value: { type: "string" },
              isEnabled: { type: "boolean" },
              isRegex: { type: "boolean" }
            },
            required: ["type", "value", "isEnabled"]
          }
        }
      },
      required: ["filters"]
    }
  },
  {
    name: "set_trace_updates_enabled",
    description: "Enable/disable visual update highlighting",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "Enable trace updates" }
      },
      required: ["enabled"]
    }
  },
  // React Native
  {
    name: "get_native_style",
    description: "Get native style and layout info (React Native only)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" }
      },
      required: ["id"]
    }
  },
  {
    name: "set_native_style",
    description: "Set a native style property (React Native only)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Element ID" },
        property: { type: "string", description: "Style property name" },
        value: { description: "New value" }
      },
      required: ["id", "property", "value"]
    }
  },
  // Health & Monitoring
  {
    name: "health_check",
    description: "Get server and connection health status",
    inputSchema: { type: "object", properties: {} }
  }
];
function createServer(options = {}) {
  const logger = options.logger ?? createLogger({
    level: getLogLevelFromEnv(),
    prefix: "devtools-mcp"
  });
  const bridge = new DevToolsBridge({
    host: options.host ?? process.env.DEVTOOLS_HOST ?? "localhost",
    port: options.port ?? (Number(process.env.DEVTOOLS_PORT) || 8097),
    timeout: Number(process.env.DEVTOOLS_TIMEOUT) || 5e3,
    logger: logger.child("bridge")
  });
  const server = new Server(
    {
      name: "react-devtools-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS
  }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "devtools://components",
        name: "Component Tree",
        description: "Live component tree updates",
        mimeType: "application/json"
      },
      {
        uri: "devtools://selection",
        name: "Current Selection",
        description: "Currently selected element",
        mimeType: "application/json"
      }
    ]
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === "devtools://components") {
      const tree = bridge.getComponentTree();
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(tree, null, 2)
          }
        ]
      };
    }
    if (uri === "devtools://selection") {
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ selectedElementID: null })
          }
        ]
      };
    }
    throw new Error(`Unknown resource: ${uri}`);
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(bridge, name, args ?? {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message })
          }
        ],
        isError: true
      };
    }
  });
  const autoConnect = options.autoConnect ?? process.env.DEVTOOLS_AUTO_CONNECT !== "false";
  return {
    server,
    bridge,
    async start() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      if (autoConnect) {
        try {
          await bridge.connect();
        } catch {
        }
      }
    }
  };
}
async function handleToolCall(bridge, name, args) {
  switch (name) {
    // Connection
    case "connect": {
      const status = await bridge.connect();
      return { success: true, status };
    }
    case "disconnect": {
      bridge.disconnect();
      return { success: true };
    }
    case "get_connection_status": {
      return { status: bridge.getStatus() };
    }
    // Component Tree
    case "get_component_tree": {
      const roots = bridge.getComponentTree(
        args.rootID,
        args.maxDepth
      );
      return { roots };
    }
    case "get_element_by_id": {
      const element = bridge.getElementById(args.id);
      return { element };
    }
    case "search_components": {
      const matches = bridge.searchComponents(
        args.query,
        args.caseSensitive,
        args.isRegex
      );
      return { matches, totalCount: matches.length };
    }
    // Inspection
    case "inspect_element": {
      const result = await bridge.inspectElement(
        args.id,
        args.paths
      );
      if (result.type === "full-data") {
        return { success: true, element: result.element, error: null };
      } else if (result.type === "not-found") {
        return { success: false, element: null, error: { type: "not_found", message: "Element not found" } };
      } else if (result.type === "error") {
        return { success: false, element: null, error: { type: result.errorType, message: result.message, stack: result.stack } };
      } else {
        return { success: true, element: null, error: null };
      }
    }
    case "get_owners_list": {
      const owners = await bridge.getOwnersList(args.id);
      return { owners };
    }
    case "get_element_source": {
      const result = await bridge.inspectElement(args.id);
      if (result.type === "full-data") {
        return { source: result.element.source, stack: result.element.stack };
      }
      return { source: null, stack: null };
    }
    // Overrides
    case "override_props": {
      bridge.overrideValueAtPath(
        "props",
        args.id,
        args.path,
        args.value
      );
      return { success: true };
    }
    case "override_state": {
      bridge.overrideValueAtPath(
        "state",
        args.id,
        args.path,
        args.value
      );
      return { success: true };
    }
    case "override_hooks": {
      bridge.overrideValueAtPath(
        "hooks",
        args.id,
        args.path,
        args.value,
        args.hookIndex
      );
      return { success: true };
    }
    case "override_context": {
      bridge.overrideValueAtPath(
        "context",
        args.id,
        args.path,
        args.value
      );
      return { success: true };
    }
    case "delete_path": {
      bridge.deletePath(
        args.target,
        args.id,
        args.path,
        args.hookIndex
      );
      return { success: true };
    }
    case "rename_path": {
      bridge.renamePath(
        args.target,
        args.id,
        args.path,
        args.oldKey,
        args.newKey,
        args.hookIndex
      );
      return { success: true };
    }
    // Profiling
    case "start_profiling": {
      bridge.startProfiling(
        args.recordTimeline,
        args.recordChangeDescriptions
      );
      return { success: true, requiresReload: false };
    }
    case "stop_profiling": {
      bridge.stopProfiling();
      const data = await bridge.getProfilingData();
      return { success: true, data };
    }
    case "get_profiling_data": {
      const status = bridge.getProfilingStatus();
      const data = await bridge.getProfilingData();
      return { isActive: status.isProfiling, data };
    }
    case "get_profiling_status": {
      const status = bridge.getProfilingStatus();
      return {
        isProfiling: status.isProfiling,
        recordTimeline: false,
        recordChangeDescriptions: true
      };
    }
    // Error & Suspense
    case "get_errors_and_warnings": {
      const { errors, warnings } = bridge.getErrorsAndWarnings();
      return {
        errors: Object.fromEntries(errors),
        warnings: Object.fromEntries(warnings)
      };
    }
    case "clear_errors_and_warnings": {
      bridge.clearErrorsAndWarnings(args.id);
      return { success: true };
    }
    case "toggle_error": {
      bridge.overrideError(args.id, args.isErrored);
      return { success: true };
    }
    case "toggle_suspense": {
      bridge.overrideSuspense(args.id, args.isSuspended);
      return { success: true };
    }
    // Debugging
    case "highlight_element": {
      bridge.highlightElement(args.id);
      const duration = args.duration ?? 2e3;
      setTimeout(() => bridge.clearHighlight(), duration);
      return { success: true };
    }
    case "clear_highlight": {
      bridge.clearHighlight();
      return { success: true };
    }
    case "scroll_to_element": {
      bridge.scrollToElement(args.id);
      return { success: true };
    }
    case "log_to_console": {
      bridge.logToConsole(args.id);
      return { success: true };
    }
    case "store_as_global": {
      bridge.storeAsGlobal(
        args.id,
        args.path,
        1
        // count
      );
      return { success: true };
    }
    case "view_source": {
      bridge.viewElementSource(args.id);
      const result = await bridge.inspectElement(args.id);
      if (result.type === "full-data") {
        return { success: true, source: result.element.source };
      }
      return { success: true, source: null };
    }
    // Filters
    case "get_component_filters": {
      return { filters: [] };
    }
    case "set_component_filters": {
      bridge.setComponentFilters(args.filters);
      return { success: true };
    }
    case "set_trace_updates_enabled": {
      bridge.setTraceUpdatesEnabled(args.enabled);
      return { success: true };
    }
    // React Native
    case "get_native_style": {
      const result = await bridge.getNativeStyle(args.id);
      return result;
    }
    case "set_native_style": {
      bridge.setNativeStyle(
        args.id,
        args.property,
        args.value
      );
      return { success: true };
    }
    // Health & Monitoring
    case "health_check": {
      const status = bridge.getStatus();
      const lastMessageTime = bridge.getLastMessageTime();
      const pendingRequests = bridge.getPendingRequestCount();
      const now = Date.now();
      return {
        connected: status.state === "connected",
        state: status.state,
        rendererCount: status.rendererCount,
        reactVersion: status.reactVersion,
        error: status.error,
        lastMessageAgo: lastMessageTime > 0 ? now - lastMessageTime : null,
        pendingRequests,
        uptime: process.uptime()
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// src/cli.ts
async function main() {
  const logger = createLogger({
    level: getLogLevelFromEnv(),
    prefix: "cli"
  });
  logger.info("Starting React DevTools MCP Server...");
  const { bridge, start } = createServer({
    host: process.env.DEVTOOLS_HOST,
    port: process.env.DEVTOOLS_PORT ? Number(process.env.DEVTOOLS_PORT) : void 0,
    autoConnect: process.env.DEVTOOLS_AUTO_CONNECT !== "false",
    logger
  });
  bridge.on("connected", () => {
    logger.info("Connected to DevTools backend");
  });
  bridge.on("disconnected", ({ code, reason }) => {
    logger.info("Disconnected from DevTools backend", { code, reason });
  });
  bridge.on("reconnecting", ({ attempt, delay }) => {
    logger.info("Reconnecting to DevTools backend", { attempt, delay });
  });
  bridge.on("reconnectFailed", ({ attempts }) => {
    logger.error("Failed to reconnect after max attempts", { attempts });
  });
  bridge.on("renderer", (info) => {
    logger.info("Renderer attached", { id: info.id, version: info.rendererVersion });
  });
  bridge.on("parseError", ({ error }) => {
    logger.error("Protocol parse error", { error });
  });
  const shutdown = () => {
    logger.info("Shutting down...");
    bridge.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  try {
    await start();
    logger.info("Server started successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to start server", { error: message });
    process.exit(1);
  }
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
//# sourceMappingURL=cli.js.map
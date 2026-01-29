import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { EventEmitter } from 'events';

/**
 * React DevTools MCP - Type Definitions
 *
 * Complete TypeScript types for the DevTools bridge protocol
 * and MCP tool interfaces.
 */
interface ConnectionConfig {
    host: string;
    port: number;
    timeout: number;
    autoReconnect: boolean;
}
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
interface ConnectionStatus {
    state: ConnectionState;
    rendererCount: number;
    reactVersion: string | null;
    error: string | null;
}
type ElementType = 'class' | 'function' | 'forward_ref' | 'memo' | 'context' | 'suspense' | 'profiler' | 'host' | 'root' | 'portal' | 'fragment' | 'lazy' | 'cache' | 'activity' | 'virtual';
interface Element {
    id: number;
    parentID: number | null;
    displayName: string;
    type: ElementType;
    key: string | number | null;
    depth: number;
    weight: number;
    ownerID: number | null;
    hasChildren: boolean;
    env: string | null;
    hocDisplayNames: string[] | null;
}
interface SerializedElement {
    id: number;
    displayName: string;
    type: ElementType;
    key: string | number | null;
    env: string | null;
    hocDisplayNames: string[] | null;
}
interface InspectedElement {
    id: number;
    displayName: string;
    type: ElementType;
    key: string | number | null;
    props: DehydratedData | null;
    state: DehydratedData | null;
    hooks: HooksTree | null;
    context: DehydratedData | null;
    source: SourceLocation | null;
    stack: string | null;
    owners: SerializedElement[] | null;
    rootType: string | null;
    isErrored: boolean;
    errors: Array<[string, number]>;
    warnings: Array<[string, number]>;
    isSuspended: boolean | null;
    suspendedBy: SuspenseInfo | null;
    canToggleError: boolean;
    canToggleSuspense: boolean;
    canEditHooks: boolean;
    canEditFunctionProps: boolean;
    canEditHooksAndDeletePaths: boolean;
    canEditHooksAndRenamePaths: boolean;
    hasLegacyContext: boolean;
    env: string | null;
    rendererPackageName: string | null;
    rendererVersion: string | null;
    nativeTag: number | null;
}
type InspectElementPayload = {
    type: 'full-data';
    element: InspectedElement;
} | {
    type: 'hydrated-path';
    path: Array<string | number>;
    value: unknown;
} | {
    type: 'no-change';
} | {
    type: 'not-found';
} | {
    type: 'error';
    errorType: string;
    message: string;
    stack?: string;
};
interface HooksTree {
    hooks: HookInfo[];
}
interface HookInfo {
    index: number;
    name: HookType;
    value: DehydratedData;
    subHooks: HookInfo[];
    isEditable: boolean;
    debugLabel: string | null;
}
type HookType = 'useState' | 'useReducer' | 'useContext' | 'useRef' | 'useEffect' | 'useInsertionEffect' | 'useLayoutEffect' | 'useCallback' | 'useMemo' | 'useImperativeHandle' | 'useDebugValue' | 'useDeferredValue' | 'useTransition' | 'useSyncExternalStore' | 'useId' | 'useCacheRefresh' | 'useOptimistic' | 'useFormStatus' | 'useActionState' | 'use' | 'custom';
interface SourceLocation {
    fileName: string;
    lineNumber: number;
    columnNumber?: number;
}
interface SuspenseInfo {
    resource: string | null;
    source: SourceLocation | null;
}
interface ProfilingData {
    roots: ProfilingDataForRoot[];
    timelineData: TimelineData | null;
}
interface ProfilingDataForRoot {
    rootID: number;
    displayName: string;
    commits: CommitData[];
    initialTreeBaseDurations: Map<number, number>;
}
interface CommitData {
    timestamp: number;
    duration: number;
    effectDuration: number;
    passiveEffectDuration: number;
    priorityLevel: string | null;
    fiberActualDurations: Map<number, number>;
    fiberSelfDurations: Map<number, number>;
    updaters: SerializedElement[] | null;
    changeDescriptions: Map<number, ChangeDescription> | null;
}
interface ChangeDescription {
    isFirstMount: boolean;
    props: string[] | null;
    state: string[] | null;
    hooks: number[] | null;
    context: boolean | null;
    didHooksChange: boolean;
}
interface TimelineData {
    events: TimelineEvent[];
}
interface TimelineEvent {
    type: string;
    timestamp: number;
    duration?: number;
    data?: unknown;
}
interface DehydratedData {
    cleaned: CleanedValue[];
    data: unknown;
    unserializable: Array<{
        path: Array<string | number>;
        reason: string;
    }>;
}
type CleanedValue = ['function', string] | ['symbol', string] | ['circular'] | ['date', string] | ['regexp', string] | ['map', string] | ['set', string] | ['iterator', string] | ['html_element', string] | ['html_all_collection'] | ['typed_array', string] | ['array_buffer'] | ['data_view'] | ['infinity'] | ['nan'] | ['undefined'] | ['unknown'];
interface RootTree {
    rootID: number;
    displayName: string;
    elements: Element[];
}
interface ComponentFilter {
    type: 'name' | 'location' | 'type' | 'hoc';
    value: string;
    isEnabled: boolean;
    isRegex?: boolean;
}
type ErrorCode = 'NOT_CONNECTED' | 'ELEMENT_NOT_FOUND' | 'NOT_EDITABLE' | 'INVALID_PATH' | 'SERIALIZATION_ERROR' | 'TIMEOUT' | 'INTERNAL_ERROR';
interface MCPError {
    code: ErrorCode;
    message: string;
    data?: unknown;
}
type BridgeOutgoing = {
    type: 'inspectElement';
    id: number;
    rendererID: number;
    forceFullData?: boolean;
    path?: Array<string | number> | null;
} | {
    type: 'getComponentTree';
} | {
    type: 'searchForComponent';
    query: string;
    caseSensitive?: boolean;
    isRegex?: boolean;
} | {
    type: 'getOwnersList';
    id: number;
} | {
    type: 'highlightHostInstance';
    id: number;
} | {
    type: 'clearHostInstanceHighlight';
} | {
    type: 'scrollToHostInstance';
    id: number;
} | {
    type: 'logElementToConsole';
    id: number;
} | {
    type: 'storeAsGlobal';
    id: number;
    path: Array<string | number>;
    count: number;
} | {
    type: 'viewElementSource';
    id: number;
} | {
    type: 'overrideValueAtPath';
    target: OverrideTarget;
    id: number;
    hookIndex?: number;
    path: Array<string | number>;
    value: unknown;
} | {
    type: 'deletePath';
    target: OverrideTarget;
    id: number;
    hookIndex?: number;
    path: Array<string | number>;
} | {
    type: 'renamePath';
    target: OverrideTarget;
    id: number;
    hookIndex?: number;
    path: Array<string | number>;
    oldKey: string;
    newKey: string;
} | {
    type: 'overrideError';
    id: number;
    isErrored: boolean;
} | {
    type: 'overrideSuspense';
    id: number;
    isSuspended: boolean;
} | {
    type: 'startProfiling';
    recordTimeline?: boolean;
    recordChangeDescriptions?: boolean;
} | {
    type: 'stopProfiling';
} | {
    type: 'getProfilingData';
} | {
    type: 'getProfilingStatus';
} | {
    type: 'updateComponentFilters';
    filters: ComponentFilter[];
} | {
    type: 'setTraceUpdatesEnabled';
    enabled: boolean;
} | {
    type: 'clearErrorsAndWarnings';
} | {
    type: 'clearErrorsForElementID';
    id: number;
} | {
    type: 'clearWarningsForElementID';
    id: number;
} | {
    type: 'NativeStyleEditor_measure';
    id: number;
} | {
    type: 'NativeStyleEditor_setValue';
    id: number;
    property: string;
    value: unknown;
};
type OverrideTarget = 'props' | 'state' | 'hooks' | 'context';
type BridgeIncoming = {
    type: 'inspectedElement';
    payload: InspectElementPayload;
} | {
    type: 'operations';
    operations: number[];
} | {
    type: 'ownersList';
    owners: SerializedElement[];
} | {
    type: 'profilingData';
    data: ProfilingData;
} | {
    type: 'profilingStatus';
    isProfiling: boolean;
} | {
    type: 'backendVersion';
    version: string;
} | {
    type: 'bridgeProtocol';
    version: number;
} | {
    type: 'NativeStyleEditor_styleAndLayout';
    style: Record<string, unknown>;
    layout: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
};
interface ConnectParams {
    host?: string;
    port?: number;
    timeout?: number;
}
interface ConnectResult {
    success: boolean;
    status: ConnectionStatus;
}
interface GetComponentTreeParams {
    rootID?: number;
    maxDepth?: number;
}
interface GetComponentTreeResult {
    roots: RootTree[];
}
interface SearchComponentsParams {
    query: string;
    caseSensitive?: boolean;
    isRegex?: boolean;
}
interface SearchComponentsResult {
    matches: Element[];
    totalCount: number;
}
interface InspectElementParams {
    id: number;
    paths?: Array<Array<string | number>>;
}
interface InspectElementResult {
    success: boolean;
    element: InspectedElement | null;
    error: {
        type: string;
        message: string;
        stack?: string;
    } | null;
}
interface GetOwnersListParams {
    id: number;
}
interface GetOwnersListResult {
    owners: SerializedElement[];
}
interface OverrideParams {
    id: number;
    path: Array<string | number>;
    value: unknown;
}
interface OverrideHooksParams extends OverrideParams {
    hookIndex: number;
}
interface OverrideResult {
    success: boolean;
    error?: string;
}
interface DeletePathParams {
    id: number;
    target: OverrideTarget;
    hookIndex?: number;
    path: Array<string | number>;
}
interface RenamePathParams {
    id: number;
    target: OverrideTarget;
    hookIndex?: number;
    path: Array<string | number>;
    oldKey: string;
    newKey: string;
}
interface StartProfilingParams {
    recordTimeline?: boolean;
    recordChangeDescriptions?: boolean;
}
interface StartProfilingResult {
    success: boolean;
    requiresReload: boolean;
}
interface StopProfilingResult {
    success: boolean;
    data: ProfilingData | null;
}
interface GetProfilingStatusResult {
    isProfiling: boolean;
    recordTimeline: boolean;
    recordChangeDescriptions: boolean;
}
interface GetErrorsAndWarningsResult {
    errors: Map<number, Array<[string, number]>>;
    warnings: Map<number, Array<[string, number]>>;
}
interface ToggleErrorParams {
    id: number;
    isErrored: boolean;
}
interface ToggleSuspenseParams {
    id: number;
    isSuspended: boolean;
}
interface HighlightElementParams {
    id: number;
    duration?: number;
}
interface ScrollToElementParams {
    id: number;
}
interface LogToConsoleParams {
    id: number;
}
interface StoreAsGlobalParams {
    id: number;
    path: Array<string | number>;
    globalName: string;
}
interface GetNativeStyleParams {
    id: number;
}
interface GetNativeStyleResult {
    style: Record<string, unknown> | null;
    layout: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
}
interface SetNativeStyleParams {
    id: number;
    property: string;
    value: unknown;
}

/**
 * Logging Infrastructure
 *
 * Configurable structured logging for DevTools bridge and MCP server.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: number;
    prefix?: string;
    meta?: Record<string, unknown>;
}
interface Logger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
    child(prefix: string): Logger;
}
interface LoggerOptions {
    level: LogLevel;
    prefix?: string;
    output?: (entry: LogEntry) => void;
}
/**
 * Create a logger instance
 */
declare function createLogger(options?: Partial<LoggerOptions>): Logger;
/**
 * No-op logger for testing or when logging disabled
 */
declare const noopLogger: Logger;
/**
 * Get log level from environment
 */
declare function getLogLevelFromEnv(): LogLevel;

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

interface BridgeOptions extends Partial<ConnectionConfig> {
    logger?: Logger;
}
declare class DevToolsBridge extends EventEmitter {
    private config;
    private logger;
    private ws;
    private state;
    private error;
    private connectPromise;
    private reconnectAttempts;
    private reconnectTimer;
    private manualDisconnect;
    private elements;
    private rootIDs;
    private renderers;
    private pendingRequests;
    private requestIdCounter;
    private staleRequestCleanupTimer;
    private elementErrors;
    private elementWarnings;
    private isProfiling;
    private profilingData;
    private backendVersion;
    private lastMessageAt;
    constructor(options?: BridgeOptions);
    /**
     * Connect to DevTools backend.
     * Handles deduplication of concurrent connect calls (Phase 1.2).
     */
    connect(): Promise<ConnectionStatus>;
    /**
     * Internal connection logic
     */
    private doConnect;
    /**
     * Called when connection is established
     */
    private onConnected;
    /**
     * Handle WebSocket close event
     */
    private handleClose;
    /**
     * Schedule a reconnection attempt with exponential backoff (Phase 1.3)
     */
    private scheduleReconnect;
    /**
     * Disconnect from DevTools backend
     */
    disconnect(): void;
    /**
     * Get current connection status
     */
    getStatus(): ConnectionStatus;
    /**
     * Check if connected
     */
    isConnected(): boolean;
    private setState;
    private setError;
    private reset;
    /**
     * Generate unique request ID (Phase 1.6)
     */
    private nextRequestId;
    /**
     * Create a pending request with proper cleanup (Phase 1.5)
     */
    private createPending;
    /**
     * Resolve a pending request
     */
    private resolvePending;
    /**
     * Start periodic cleanup of stale requests (Phase 1.5)
     */
    private startStaleRequestCleanup;
    /**
     * Stop stale request cleanup
     */
    private stopStaleRequestCleanup;
    private send;
    private handleMessage;
    private handleRenderer;
    private handleOperations;
    /**
     * Process ADD operation with bounds checking (Phase 1.4)
     */
    private processAddOperation;
    /**
     * Process REMOVE operation with bounds checking
     */
    private processRemoveOperation;
    /**
     * Process REORDER operation with bounds checking
     */
    private processReorderOperation;
    /**
     * Process ERRORS/WARNINGS operation with bounds checking
     */
    private processErrorsWarningsOperation;
    private handleInspectedElement;
    private handleOwnersList;
    private handleProfilingData;
    private handleProfilingStatus;
    getComponentTree(rootID?: number, maxDepth?: number): RootTree[];
    getElementById(id: number): Element | null;
    searchComponents(query: string, caseSensitive?: boolean, isRegex?: boolean): Element[];
    /**
     * Inspect element with request ID correlation (Phase 1.6)
     */
    inspectElement(id: number, paths?: Array<Array<string | number>>): Promise<InspectElementPayload>;
    /**
     * Get owners list with request ID correlation (Phase 1.6)
     */
    getOwnersList(id: number): Promise<SerializedElement[]>;
    highlightElement(id: number): void;
    clearHighlight(): void;
    scrollToElement(id: number): void;
    logToConsole(id: number): void;
    storeAsGlobal(id: number, path: Array<string | number>, count: number): void;
    viewElementSource(id: number): void;
    overrideValueAtPath(target: OverrideTarget, id: number, path: Array<string | number>, value: unknown, hookIndex?: number): void;
    deletePath(target: OverrideTarget, id: number, path: Array<string | number>, hookIndex?: number): void;
    renamePath(target: OverrideTarget, id: number, path: Array<string | number>, oldKey: string, newKey: string, hookIndex?: number): void;
    overrideError(id: number, isErrored: boolean): void;
    overrideSuspense(id: number, isSuspended: boolean): void;
    clearErrorsAndWarnings(id?: number): void;
    getErrorsAndWarnings(): {
        errors: Map<number, Array<[string, number]>>;
        warnings: Map<number, Array<[string, number]>>;
    };
    startProfiling(recordTimeline?: boolean, recordChangeDescriptions?: boolean): void;
    stopProfiling(): void;
    getProfilingData(): Promise<ProfilingData | null>;
    getProfilingStatus(): {
        isProfiling: boolean;
    };
    setComponentFilters(filters: ComponentFilter[]): void;
    setTraceUpdatesEnabled(enabled: boolean): void;
    getNativeStyle(id: number): Promise<{
        style: Record<string, unknown> | null;
        layout: {
            x: number;
            y: number;
            width: number;
            height: number;
        } | null;
    }>;
    setNativeStyle(id: number, property: string, value: unknown): void;
    private ensureConnected;
    private getRendererIDForElement;
    /**
     * Get last message timestamp (for health monitoring)
     */
    getLastMessageTime(): number;
    /**
     * Get pending request count (for monitoring)
     */
    getPendingRequestCount(): number;
}

/**
 * React DevTools MCP Server
 *
 * Exposes React DevTools functionality via Model Context Protocol.
 */

interface ServerOptions {
    host?: string;
    port?: number;
    autoConnect?: boolean;
    logger?: Logger;
}
declare function createServer(options?: ServerOptions): {
    server: Server<{
        method: string;
        params?: {
            [x: string]: unknown;
            _meta?: {
                [x: string]: unknown;
                progressToken?: string | number | undefined;
                "io.modelcontextprotocol/related-task"?: {
                    taskId: string;
                } | undefined;
            } | undefined;
        } | undefined;
    }, {
        method: string;
        params?: {
            [x: string]: unknown;
            _meta?: {
                [x: string]: unknown;
                progressToken?: string | number | undefined;
                "io.modelcontextprotocol/related-task"?: {
                    taskId: string;
                } | undefined;
            } | undefined;
        } | undefined;
    }, {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    }>;
    bridge: DevToolsBridge;
    start(): Promise<void>;
};

/**
 * Error Types
 *
 * Typed error classes for DevTools bridge operations.
 */

/**
 * Base error class for all DevTools errors
 */
declare class DevToolsError extends Error {
    readonly code: ErrorCode;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code: ErrorCode, details?: Record<string, unknown> | undefined);
    toJSON(): Record<string, unknown>;
}
/**
 * Connection-related errors
 */
declare class ConnectionError extends DevToolsError {
    constructor(message: string, details?: Record<string, unknown>);
}
/**
 * Request timeout errors
 */
declare class TimeoutError extends DevToolsError {
    constructor(operation: string, timeout: number, details?: Record<string, unknown>);
}
/**
 * Element not found errors
 */
declare class ElementNotFoundError extends DevToolsError {
    constructor(elementId: number, details?: Record<string, unknown>);
}
/**
 * Protocol/parsing errors
 */
declare class ProtocolError extends DevToolsError {
    constructor(message: string, details?: Record<string, unknown>);
}
/**
 * Validation errors for invalid inputs
 */
declare class ValidationError extends DevToolsError {
    constructor(message: string, details?: Record<string, unknown>);
}
/**
 * Operation not supported/editable
 */
declare class NotEditableError extends DevToolsError {
    constructor(operation: string, elementId: number, details?: Record<string, unknown>);
}

export { type BridgeIncoming, type BridgeOptions, type BridgeOutgoing, type ChangeDescription, type CleanedValue, type CommitData, type ComponentFilter, type ConnectParams, type ConnectResult, type ConnectionConfig, ConnectionError, type ConnectionState, type ConnectionStatus, type DehydratedData, type DeletePathParams, DevToolsBridge, DevToolsError, type Element, ElementNotFoundError, type ElementType, type ErrorCode, type GetComponentTreeParams, type GetComponentTreeResult, type GetErrorsAndWarningsResult, type GetNativeStyleParams, type GetNativeStyleResult, type GetOwnersListParams, type GetOwnersListResult, type GetProfilingStatusResult, type HighlightElementParams, type HookInfo, type HookType, type HooksTree, type InspectElementParams, type InspectElementPayload, type InspectElementResult, type InspectedElement, type LogLevel, type LogToConsoleParams, type Logger, type MCPError, NotEditableError, type OverrideHooksParams, type OverrideParams, type OverrideResult, type OverrideTarget, type ProfilingData, type ProfilingDataForRoot, ProtocolError, type RenamePathParams, type RootTree, type ScrollToElementParams, type SearchComponentsParams, type SearchComponentsResult, type SerializedElement, type ServerOptions, type SetNativeStyleParams, type SourceLocation, type StartProfilingParams, type StartProfilingResult, type StopProfilingResult, type StoreAsGlobalParams, type SuspenseInfo, type TimelineData, type TimelineEvent, TimeoutError, type ToggleErrorParams, type ToggleSuspenseParams, ValidationError, createLogger, createServer, getLogLevelFromEnv, noopLogger };

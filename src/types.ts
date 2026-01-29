/**
 * React DevTools MCP - Type Definitions
 *
 * Complete TypeScript types for the DevTools bridge protocol
 * and MCP tool interfaces.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONNECTION
// ═══════════════════════════════════════════════════════════════════════════

export interface ConnectionConfig {
  host: string;
  port: number;
  timeout: number;
  autoReconnect: boolean;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  rendererCount: number;
  reactVersion: string | null;
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ELEMENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ElementType =
  | 'class'
  | 'function'
  | 'forward_ref'
  | 'memo'
  | 'context'
  | 'suspense'
  | 'profiler'
  | 'host'
  | 'root'
  | 'portal'
  | 'fragment'
  | 'lazy'
  | 'cache'
  | 'activity'
  | 'virtual';

export interface Element {
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

export interface SerializedElement {
  id: number;
  displayName: string;
  type: ElementType;
  key: string | number | null;
  env: string | null;
  hocDisplayNames: string[] | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// INSPECTED ELEMENT
// ═══════════════════════════════════════════════════════════════════════════

export interface InspectedElement {
  id: number;
  displayName: string;
  type: ElementType;
  key: string | number | null;

  // Data
  props: DehydratedData | null;
  state: DehydratedData | null;
  hooks: HooksTree | null;
  context: DehydratedData | null;

  // Source
  source: SourceLocation | null;
  stack: string | null;

  // Ownership
  owners: SerializedElement[] | null;
  rootType: string | null;

  // Error & Suspense
  isErrored: boolean;
  errors: Array<[string, number]>;
  warnings: Array<[string, number]>;
  isSuspended: boolean | null;
  suspendedBy: SuspenseInfo | null;
  canToggleError: boolean;
  canToggleSuspense: boolean;

  // Editing
  canEditHooks: boolean;
  canEditFunctionProps: boolean;
  canEditHooksAndDeletePaths: boolean;
  canEditHooksAndRenamePaths: boolean;

  // Metadata
  hasLegacyContext: boolean;
  env: string | null;
  rendererPackageName: string | null;
  rendererVersion: string | null;
  nativeTag: number | null;
}

export type InspectElementPayload =
  | { type: 'full-data'; element: InspectedElement }
  | { type: 'hydrated-path'; path: Array<string | number>; value: unknown }
  | { type: 'no-change' }
  | { type: 'not-found' }
  | { type: 'error'; errorType: string; message: string; stack?: string };

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

export interface HooksTree {
  hooks: HookInfo[];
}

export interface HookInfo {
  index: number;
  name: HookType;
  value: DehydratedData;
  subHooks: HookInfo[];
  isEditable: boolean;
  debugLabel: string | null;
}

export type HookType =
  | 'useState'
  | 'useReducer'
  | 'useContext'
  | 'useRef'
  | 'useEffect'
  | 'useInsertionEffect'
  | 'useLayoutEffect'
  | 'useCallback'
  | 'useMemo'
  | 'useImperativeHandle'
  | 'useDebugValue'
  | 'useDeferredValue'
  | 'useTransition'
  | 'useSyncExternalStore'
  | 'useId'
  | 'useCacheRefresh'
  | 'useOptimistic'
  | 'useFormStatus'
  | 'useActionState'
  | 'use'
  | 'custom';

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE LOCATION
// ═══════════════════════════════════════════════════════════════════════════

export interface SourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

export interface SuspenseInfo {
  resource: string | null;
  source: SourceLocation | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILING
// ═══════════════════════════════════════════════════════════════════════════

export interface ProfilingData {
  roots: ProfilingDataForRoot[];
  timelineData: TimelineData | null;
}

export interface ProfilingDataForRoot {
  rootID: number;
  displayName: string;
  commits: CommitData[];
  initialTreeBaseDurations: Map<number, number>;
}

export interface CommitData {
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

export interface ChangeDescription {
  isFirstMount: boolean;
  props: string[] | null;
  state: string[] | null;
  hooks: number[] | null;
  context: boolean | null;
  didHooksChange: boolean;
}

export interface TimelineData {
  events: TimelineEvent[];
}

export interface TimelineEvent {
  type: string;
  timestamp: number;
  duration?: number;
  data?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEHYDRATED DATA (SERIALIZATION)
// ═══════════════════════════════════════════════════════════════════════════

export interface DehydratedData {
  cleaned: CleanedValue[];
  data: unknown;
  unserializable: Array<{
    path: Array<string | number>;
    reason: string;
  }>;
}

export type CleanedValue =
  | ['function', string]
  | ['symbol', string]
  | ['circular']
  | ['date', string]
  | ['regexp', string]
  | ['map', string]
  | ['set', string]
  | ['iterator', string]
  | ['html_element', string]
  | ['html_all_collection']
  | ['typed_array', string]
  | ['array_buffer']
  | ['data_view']
  | ['infinity']
  | ['nan']
  | ['undefined']
  | ['unknown'];

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT TREE
// ═══════════════════════════════════════════════════════════════════════════

export interface RootTree {
  rootID: number;
  displayName: string;
  elements: Element[];
}

export interface ComponentFilter {
  type: 'name' | 'location' | 'type' | 'hoc';
  value: string;
  isEnabled: boolean;
  isRegex?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════════════

export type ErrorCode =
  | 'NOT_CONNECTED'
  | 'ELEMENT_NOT_FOUND'
  | 'NOT_EDITABLE'
  | 'INVALID_PATH'
  | 'SERIALIZATION_ERROR'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export interface MCPError {
  code: ErrorCode;
  message: string;
  data?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRIDGE MESSAGES (Internal)
// ═══════════════════════════════════════════════════════════════════════════

export type BridgeOutgoing =
  | { type: 'inspectElement'; id: number; rendererID: number; forceFullData?: boolean; path?: Array<string | number> | null }
  | { type: 'getComponentTree' }
  | { type: 'searchForComponent'; query: string; caseSensitive?: boolean; isRegex?: boolean }
  | { type: 'getOwnersList'; id: number }
  | { type: 'highlightHostInstance'; id: number }
  | { type: 'clearHostInstanceHighlight' }
  | { type: 'scrollToHostInstance'; id: number }
  | { type: 'logElementToConsole'; id: number }
  | { type: 'storeAsGlobal'; id: number; path: Array<string | number>; count: number }
  | { type: 'viewElementSource'; id: number }
  | { type: 'overrideValueAtPath'; target: OverrideTarget; id: number; hookIndex?: number; path: Array<string | number>; value: unknown }
  | { type: 'deletePath'; target: OverrideTarget; id: number; hookIndex?: number; path: Array<string | number> }
  | { type: 'renamePath'; target: OverrideTarget; id: number; hookIndex?: number; path: Array<string | number>; oldKey: string; newKey: string }
  | { type: 'overrideError'; id: number; isErrored: boolean }
  | { type: 'overrideSuspense'; id: number; isSuspended: boolean }
  | { type: 'startProfiling'; recordTimeline?: boolean; recordChangeDescriptions?: boolean }
  | { type: 'stopProfiling' }
  | { type: 'getProfilingData' }
  | { type: 'getProfilingStatus' }
  | { type: 'updateComponentFilters'; filters: ComponentFilter[] }
  | { type: 'setTraceUpdatesEnabled'; enabled: boolean }
  | { type: 'clearErrorsAndWarnings' }
  | { type: 'clearErrorsForElementID'; id: number }
  | { type: 'clearWarningsForElementID'; id: number }
  | { type: 'NativeStyleEditor_measure'; id: number }
  | { type: 'NativeStyleEditor_setValue'; id: number; property: string; value: unknown };

export type OverrideTarget = 'props' | 'state' | 'hooks' | 'context';

export type BridgeIncoming =
  | { type: 'inspectedElement'; payload: InspectElementPayload }
  | { type: 'operations'; operations: number[] }
  | { type: 'ownersList'; owners: SerializedElement[] }
  | { type: 'profilingData'; data: ProfilingData }
  | { type: 'profilingStatus'; isProfiling: boolean }
  | { type: 'backendVersion'; version: string }
  | { type: 'bridgeProtocol'; version: number }
  | { type: 'NativeStyleEditor_styleAndLayout'; style: Record<string, unknown>; layout: { x: number; y: number; width: number; height: number } };

// ═══════════════════════════════════════════════════════════════════════════
// MCP TOOL PARAMS & RESULTS
// ═══════════════════════════════════════════════════════════════════════════

// Connection
export interface ConnectParams {
  host?: string;
  port?: number;
  timeout?: number;
}

export interface ConnectResult {
  success: boolean;
  status: ConnectionStatus;
}

// Component Tree
export interface GetComponentTreeParams {
  rootID?: number;
  maxDepth?: number;
}

export interface GetComponentTreeResult {
  roots: RootTree[];
}

export interface SearchComponentsParams {
  query: string;
  caseSensitive?: boolean;
  isRegex?: boolean;
}

export interface SearchComponentsResult {
  matches: Element[];
  totalCount: number;
}

// Inspection
export interface InspectElementParams {
  id: number;
  paths?: Array<Array<string | number>>;
}

export interface InspectElementResult {
  success: boolean;
  element: InspectedElement | null;
  error: { type: string; message: string; stack?: string } | null;
}

export interface GetOwnersListParams {
  id: number;
}

export interface GetOwnersListResult {
  owners: SerializedElement[];
}

// Overrides
export interface OverrideParams {
  id: number;
  path: Array<string | number>;
  value: unknown;
}

export interface OverrideHooksParams extends OverrideParams {
  hookIndex: number;
}

export interface OverrideResult {
  success: boolean;
  error?: string;
}

export interface DeletePathParams {
  id: number;
  target: OverrideTarget;
  hookIndex?: number;
  path: Array<string | number>;
}

export interface RenamePathParams {
  id: number;
  target: OverrideTarget;
  hookIndex?: number;
  path: Array<string | number>;
  oldKey: string;
  newKey: string;
}

// Profiling
export interface StartProfilingParams {
  recordTimeline?: boolean;
  recordChangeDescriptions?: boolean;
}

export interface StartProfilingResult {
  success: boolean;
  requiresReload: boolean;
}

export interface StopProfilingResult {
  success: boolean;
  data: ProfilingData | null;
}

export interface GetProfilingStatusResult {
  isProfiling: boolean;
  recordTimeline: boolean;
  recordChangeDescriptions: boolean;
}

// Errors & Suspense
export interface GetErrorsAndWarningsResult {
  errors: Map<number, Array<[string, number]>>;
  warnings: Map<number, Array<[string, number]>>;
}

export interface ToggleErrorParams {
  id: number;
  isErrored: boolean;
}

export interface ToggleSuspenseParams {
  id: number;
  isSuspended: boolean;
}

// Debugging
export interface HighlightElementParams {
  id: number;
  duration?: number;
}

export interface ScrollToElementParams {
  id: number;
}

export interface LogToConsoleParams {
  id: number;
}

export interface StoreAsGlobalParams {
  id: number;
  path: Array<string | number>;
  globalName: string;
}

// React Native
export interface GetNativeStyleParams {
  id: number;
}

export interface GetNativeStyleResult {
  style: Record<string, unknown> | null;
  layout: { x: number; y: number; width: number; height: number } | null;
}

export interface SetNativeStyleParams {
  id: number;
  property: string;
  value: unknown;
}

# React DevTools MCP Server Specification

**Version:** 1.0.0
**Status:** Draft
**Date:** 2026-01-28

## Overview

A Model Context Protocol (MCP) server that exposes React DevTools functionality to AI agents. Provides programmatic access to component inspection, state/props viewing, profiling, and debugging capabilities for React and React Native applications.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI Agent (Claude)                        │
│                              │                                   │
│                         MCP Protocol                             │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  react-devtools-mcp                        │  │
│  │                                                            │  │
│  │  Tools:                                                    │  │
│  │  ├── get_component_tree                                    │  │
│  │  ├── inspect_element                                       │  │
│  │  ├── search_components                                     │  │
│  │  ├── get_owners_list                                       │  │
│  │  ├── highlight_element                                     │  │
│  │  ├── start_profiling / stop_profiling                      │  │
│  │  ├── get_profiling_data                                    │  │
│  │  ├── override_props / override_state / override_hooks      │  │
│  │  ├── get_errors_and_warnings                               │  │
│  │  └── log_to_console                                        │  │
│  │                                                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                    DevTools Bridge Protocol                      │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              React App (dev mode)                          │  │
│  │                                                            │  │
│  │  __REACT_DEVTOOLS_GLOBAL_HOOK__                           │  │
│  │         │                                                  │  │
│  │         └── DevTools Backend (react-devtools-core)         │  │
│  │                                                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Connection

### WebSocket Transport

```typescript
interface ConnectionConfig {
  /** Host to connect to (default: localhost) */
  host: string;
  /** Port for DevTools WebSocket (default: 8097) */
  port: number;
  /** Connection timeout in ms (default: 5000) */
  timeout: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect: boolean;
}
```

### Connection States

```typescript
type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

interface ConnectionStatus {
  state: ConnectionState;
  rendererCount: number;
  reactVersion: string | null;
  error: string | null;
}
```

---

## Data Types

### Element (Component Tree Node)

```typescript
interface Element {
  /** Unique element ID within this session */
  id: number;

  /** Parent element ID (null for root) */
  parentID: number | null;

  /** Component display name */
  displayName: string;

  /** Element type */
  type: ElementType;

  /** React key prop if present */
  key: string | number | null;

  /** Depth in component tree (for indentation) */
  depth: number;

  /** Number of descendants (including self) */
  weight: number;

  /** Owner component ID (what rendered this) */
  ownerID: number | null;

  /** Whether this has child elements */
  hasChildren: boolean;

  /** Environment (server/client) */
  env: string | null;

  /** HOC badges (memo, forwardRef, etc.) */
  hocDisplayNames: string[] | null;
}

type ElementType =
  | 'class'           // Class component
  | 'function'        // Function component
  | 'forward_ref'     // forwardRef wrapper
  | 'memo'            // React.memo wrapper
  | 'context'         // Context Provider/Consumer
  | 'suspense'        // Suspense boundary
  | 'profiler'        // Profiler component
  | 'host'            // DOM/Native element
  | 'root'            // React root
  | 'portal'          // Portal
  | 'fragment'        // Fragment
  | 'lazy'            // React.lazy
  | 'cache'           // Cache component
  | 'activity'        // Activity/Offscreen
  | 'virtual';        // Virtual instance
```

### InspectedElement (Full Component Data)

```typescript
interface InspectedElement {
  /** Element ID */
  id: number;

  /** Component display name */
  displayName: string;

  /** Element type */
  type: ElementType;

  /** React key */
  key: string | number | null;

  // ═══════════════════════════════════════════════════════════════
  // PROPS, STATE, HOOKS, CONTEXT
  // ═══════════════════════════════════════════════════════════════

  /** Component props (dehydrated for serialization) */
  props: DehydratedData | null;

  /** Component state (class components) */
  state: DehydratedData | null;

  /** Hooks data (function components) */
  hooks: HooksTree | null;

  /** Context value consumed by this component */
  context: DehydratedData | null;

  // ═══════════════════════════════════════════════════════════════
  // SOURCE LOCATION
  // ═══════════════════════════════════════════════════════════════

  /** Source file location */
  source: SourceLocation | null;

  /** Component stack trace */
  stack: string | null;

  // ═══════════════════════════════════════════════════════════════
  // OWNERSHIP & HIERARCHY
  // ═══════════════════════════════════════════════════════════════

  /** Components that rendered this one (owner chain) */
  owners: SerializedElement[] | null;

  /** Root type (concurrent, legacy, etc.) */
  rootType: string | null;

  // ═══════════════════════════════════════════════════════════════
  // ERROR & SUSPENSE STATE
  // ═══════════════════════════════════════════════════════════════

  /** Whether component has error boundary triggered */
  isErrored: boolean;

  /** Errors logged by this component [message, count][] */
  errors: Array<[string, number]>;

  /** Warnings logged by this component [message, count][] */
  warnings: Array<[string, number]>;

  /** Whether component is currently suspended */
  isSuspended: boolean | null;

  /** What caused suspension */
  suspendedBy: SuspenseInfo | null;

  /** Can toggle error state for testing */
  canToggleError: boolean;

  /** Can toggle suspense state for testing */
  canToggleSuspense: boolean;

  // ═══════════════════════════════════════════════════════════════
  // EDITING CAPABILITIES
  // ═══════════════════════════════════════════════════════════════

  /** Can edit hooks values */
  canEditHooks: boolean;

  /** Can edit function props */
  canEditFunctionProps: boolean;

  /** Can edit hooks with delete operations */
  canEditHooksAndDeletePaths: boolean;

  /** Can edit hooks with rename operations */
  canEditHooksAndRenamePaths: boolean;

  // ═══════════════════════════════════════════════════════════════
  // METADATA
  // ═══════════════════════════════════════════════════════════════

  /** Has legacy context API */
  hasLegacyContext: boolean;

  /** Environment (server/client) */
  env: string | null;

  /** Renderer package name */
  rendererPackageName: string | null;

  /** Renderer version */
  rendererVersion: string | null;

  /** Native view tag (React Native only) */
  nativeTag: number | null;
}
```

### Hooks Data

```typescript
interface HooksTree {
  hooks: HookInfo[];
}

interface HookInfo {
  /** Hook index in component */
  index: number;

  /** Hook type name */
  name: HookType;

  /** Current value (dehydrated) */
  value: DehydratedData;

  /** Sub-hooks (for custom hooks) */
  subHooks: HookInfo[];

  /** Whether this hook is editable */
  isEditable: boolean;

  /** Debug label from useDebugValue */
  debugLabel: string | null;
}

type HookType =
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
  | 'custom';  // Custom hook wrapper
```

### Source Location

```typescript
interface SourceLocation {
  /** Source file name/path */
  fileName: string;

  /** Line number (1-indexed) */
  lineNumber: number;

  /** Column number (1-indexed, optional) */
  columnNumber?: number;
}
```

### Profiling Data

```typescript
interface ProfilingData {
  /** Data for each React root */
  roots: ProfilingDataForRoot[];

  /** Timeline events (if timeline profiling enabled) */
  timelineData: TimelineData | null;
}

interface ProfilingDataForRoot {
  /** Root element ID */
  rootID: number;

  /** Root display name */
  displayName: string;

  /** Commit-level data */
  commits: CommitData[];

  /** Initial render durations by fiber ID */
  initialTreeBaseDurations: Map<number, number>;
}

interface CommitData {
  /** Commit timestamp */
  timestamp: number;

  /** Total commit duration (ms) */
  duration: number;

  /** Effect duration (ms) */
  effectDuration: number;

  /** Passive effect duration (ms) */
  passiveEffectDuration: number;

  /** Priority level */
  priorityLevel: string | null;

  /** Fiber actual durations Map<fiberID, duration> */
  fiberActualDurations: Map<number, number>;

  /** Fiber self durations Map<fiberID, duration> */
  fiberSelfDurations: Map<number, number>;

  /** What caused this commit */
  updaters: SerializedElement[] | null;

  /** Change descriptions per fiber */
  changeDescriptions: Map<number, ChangeDescription> | null;
}

interface ChangeDescription {
  /** Whether this was first mount */
  isFirstMount: boolean;

  /** Which props changed */
  props: string[] | null;

  /** Which state keys changed */
  state: string[] | null;

  /** Which hooks changed (by index) */
  hooks: number[] | null;

  /** Context changed */
  context: boolean | null;

  /** Whether any hooks changed */
  didHooksChange: boolean;
}
```

### Dehydrated Data (Serialization)

```typescript
/**
 * Complex values are "dehydrated" for serialization.
 * This allows safe transfer of functions, symbols, circular refs, etc.
 */
interface DehydratedData {
  /** Cleaned/serializable representation */
  cleaned: CleanedValue[];

  /** Data with special values marked */
  data: any;

  /** Paths that were truncated (too deep/large) */
  unserializable: Array<{
    path: Array<string | number>;
    reason: string;
  }>;
}

type CleanedValue =
  | ['function', string]      // [type, name]
  | ['symbol', string]        // [type, description]
  | ['circular']              // Circular reference
  | ['date', string]          // [type, ISO string]
  | ['regexp', string]        // [type, pattern]
  | ['map', string]           // [type, preview]
  | ['set', string]           // [type, preview]
  | ['iterator', string]      // [type, name]
  | ['html_element', string]  // [type, tag]
  | ['html_all_collection']
  | ['typed_array', string]   // [type, name]
  | ['array_buffer']
  | ['data_view']
  | ['infinity']
  | ['nan']
  | ['undefined']
  | ['unknown'];
```

### Supporting Types

```typescript
interface SerializedElement {
  /** Element ID */
  id: number;

  /** Display name */
  displayName: string;

  /** Element type */
  type: ElementType;

  /** React key */
  key: string | number | null;

  /** Environment */
  env: string | null;

  /** HOC display names */
  hocDisplayNames: string[] | null;
}

interface SuspenseInfo {
  /** What resource caused suspension */
  resource: string | null;

  /** Suspension source location */
  source: SourceLocation | null;
}
```

---

## MCP Tools

### Connection Management

#### `connect`

Establish connection to React DevTools backend.

```typescript
interface ConnectParams {
  /** Host (default: "localhost") */
  host?: string;
  /** Port (default: 8097) */
  port?: number;
  /** Timeout in ms (default: 5000) */
  timeout?: number;
}

interface ConnectResult {
  success: boolean;
  status: ConnectionStatus;
}
```

#### `disconnect`

Close connection to DevTools backend.

```typescript
interface DisconnectResult {
  success: boolean;
}
```

#### `get_connection_status`

Get current connection status.

```typescript
interface GetConnectionStatusResult {
  status: ConnectionStatus;
}
```

---

### Component Tree

#### `get_component_tree`

Get the full component tree for all roots.

```typescript
interface GetComponentTreeParams {
  /** Filter by root ID (optional) */
  rootID?: number;
  /** Maximum depth to return (default: unlimited) */
  maxDepth?: number;
}

interface GetComponentTreeResult {
  roots: RootTree[];
}

interface RootTree {
  rootID: number;
  displayName: string;
  elements: Element[];
}
```

#### `get_element_by_id`

Get basic element info by ID.

```typescript
interface GetElementByIdParams {
  id: number;
}

interface GetElementByIdResult {
  element: Element | null;
}
```

#### `search_components`

Search for components by name.

```typescript
interface SearchComponentsParams {
  /** Search query (component name) */
  query: string;
  /** Case sensitive (default: false) */
  caseSensitive?: boolean;
  /** Regex search (default: false) */
  isRegex?: boolean;
}

interface SearchComponentsResult {
  matches: Element[];
  totalCount: number;
}
```

---

### Element Inspection

#### `inspect_element`

Get full inspection data for a component.

```typescript
interface InspectElementParams {
  /** Element ID to inspect */
  id: number;
  /** Request specific paths to hydrate (for lazy loading deep data) */
  paths?: Array<Array<string | number>>;
}

interface InspectElementResult {
  /** Inspection succeeded */
  success: boolean;
  /** Full element data (if success) */
  element: InspectedElement | null;
  /** Error info (if failed) */
  error: InspectError | null;
}

interface InspectError {
  type: 'not_found' | 'error' | 'timeout';
  message: string;
  stack?: string;
}
```

#### `get_owners_list`

Get the chain of components that rendered this element.

```typescript
interface GetOwnersListParams {
  id: number;
}

interface GetOwnersListResult {
  owners: SerializedElement[];
}
```

#### `get_element_source`

Get source location for an element.

```typescript
interface GetElementSourceParams {
  id: number;
}

interface GetElementSourceResult {
  source: SourceLocation | null;
  /** Full component stack as string */
  stack: string | null;
}
```

---

### State & Props Modification

#### `override_props`

Override a prop value on a component.

```typescript
interface OverridePropsParams {
  /** Element ID */
  id: number;
  /** Path to the prop (e.g., ["style", "backgroundColor"]) */
  path: Array<string | number>;
  /** New value */
  value: any;
}

interface OverrideResult {
  success: boolean;
  error?: string;
}
```

#### `override_state`

Override a state value on a class component.

```typescript
interface OverrideStateParams {
  /** Element ID */
  id: number;
  /** Path to state key (e.g., ["user", "name"]) */
  path: Array<string | number>;
  /** New value */
  value: any;
}

interface OverrideResult {
  success: boolean;
  error?: string;
}
```

#### `override_hooks`

Override a hook value on a function component.

```typescript
interface OverrideHooksParams {
  /** Element ID */
  id: number;
  /** Hook index */
  hookIndex: number;
  /** Path within hook value (e.g., ["current"] for refs) */
  path: Array<string | number>;
  /** New value */
  value: any;
}

interface OverrideResult {
  success: boolean;
  error?: string;
}
```

#### `override_context`

Override a context value.

```typescript
interface OverrideContextParams {
  /** Element ID */
  id: number;
  /** Path within context */
  path: Array<string | number>;
  /** New value */
  value: any;
}

interface OverrideResult {
  success: boolean;
  error?: string;
}
```

#### `delete_path`

Delete a path from props/state/hooks/context.

```typescript
interface DeletePathParams {
  /** Element ID */
  id: number;
  /** Target: 'props' | 'state' | 'hooks' | 'context' */
  target: 'props' | 'state' | 'hooks' | 'context';
  /** Hook index (required if target is 'hooks') */
  hookIndex?: number;
  /** Path to delete */
  path: Array<string | number>;
}

interface DeletePathResult {
  success: boolean;
  error?: string;
}
```

#### `rename_path`

Rename a key in props/state/hooks/context.

```typescript
interface RenamePathParams {
  /** Element ID */
  id: number;
  /** Target: 'props' | 'state' | 'hooks' | 'context' */
  target: 'props' | 'state' | 'hooks' | 'context';
  /** Hook index (required if target is 'hooks') */
  hookIndex?: number;
  /** Path to the key */
  path: Array<string | number>;
  /** Old key name */
  oldKey: string;
  /** New key name */
  newKey: string;
}

interface RenamePathResult {
  success: boolean;
  error?: string;
}
```

---

### Profiling

#### `start_profiling`

Start profiling React renders.

```typescript
interface StartProfilingParams {
  /** Record timeline data (more detailed, higher overhead) */
  recordTimeline?: boolean;
  /** Record change descriptions (why did component render) */
  recordChangeDescriptions?: boolean;
}

interface StartProfilingResult {
  success: boolean;
  /** Whether app reload is required */
  requiresReload: boolean;
}
```

#### `stop_profiling`

Stop profiling and get data.

```typescript
interface StopProfilingResult {
  success: boolean;
  data: ProfilingData | null;
}
```

#### `get_profiling_data`

Get profiling data without stopping.

```typescript
interface GetProfilingDataResult {
  isActive: boolean;
  data: ProfilingData | null;
}
```

#### `get_profiling_status`

Check if profiling is active.

```typescript
interface GetProfilingStatusResult {
  isProfiling: boolean;
  recordTimeline: boolean;
  recordChangeDescriptions: boolean;
}
```

---

### Error & Suspense

#### `get_errors_and_warnings`

Get all errors and warnings from components.

```typescript
interface GetErrorsAndWarningsResult {
  /** Map of element ID to errors */
  errors: Map<number, Array<[string, number]>>;
  /** Map of element ID to warnings */
  warnings: Map<number, Array<[string, number]>>;
}
```

#### `clear_errors_and_warnings`

Clear all or specific element's errors/warnings.

```typescript
interface ClearErrorsAndWarningsParams {
  /** Element ID (optional, clears all if omitted) */
  id?: number;
  /** Clear errors */
  clearErrors?: boolean;
  /** Clear warnings */
  clearWarnings?: boolean;
}

interface ClearErrorsAndWarningsResult {
  success: boolean;
}
```

#### `toggle_error`

Toggle error boundary state for testing.

```typescript
interface ToggleErrorParams {
  /** Element ID */
  id: number;
  /** Force error state */
  isErrored: boolean;
}

interface ToggleErrorResult {
  success: boolean;
  error?: string;
}
```

#### `toggle_suspense`

Toggle suspense state for testing.

```typescript
interface ToggleSuspenseParams {
  /** Element ID */
  id: number;
  /** Force suspended state */
  isSuspended: boolean;
}

interface ToggleSuspenseResult {
  success: boolean;
  error?: string;
}
```

---

### Debugging Utilities

#### `highlight_element`

Highlight an element in the app UI.

```typescript
interface HighlightElementParams {
  /** Element ID to highlight */
  id: number;
  /** Highlight duration in ms (default: 2000) */
  duration?: number;
}

interface HighlightElementResult {
  success: boolean;
}
```

#### `clear_highlight`

Clear any active element highlight.

```typescript
interface ClearHighlightResult {
  success: boolean;
}
```

#### `scroll_to_element`

Scroll the app to show an element.

```typescript
interface ScrollToElementParams {
  /** Element ID */
  id: number;
}

interface ScrollToElementResult {
  success: boolean;
}
```

#### `log_to_console`

Log an element to the browser/app console as `$r`.

```typescript
interface LogToConsoleParams {
  /** Element ID */
  id: number;
}

interface LogToConsoleResult {
  success: boolean;
}
```

#### `store_as_global`

Store a value as a global variable for console access.

```typescript
interface StoreAsGlobalParams {
  /** Element ID */
  id: number;
  /** Path to the value */
  path: Array<string | number>;
  /** Global variable name */
  globalName: string;
}

interface StoreAsGlobalResult {
  success: boolean;
}
```

#### `view_source`

Open element source in IDE (if supported).

```typescript
interface ViewSourceParams {
  /** Element ID */
  id: number;
}

interface ViewSourceResult {
  success: boolean;
  source: SourceLocation | null;
}
```

---

### Settings & Filters

#### `get_component_filters`

Get current component filters.

```typescript
interface ComponentFilter {
  type: 'name' | 'location' | 'type' | 'hoc';
  value: string;
  isEnabled: boolean;
  isRegex?: boolean;
}

interface GetComponentFiltersResult {
  filters: ComponentFilter[];
}
```

#### `set_component_filters`

Set component filters (hide certain components).

```typescript
interface SetComponentFiltersParams {
  filters: ComponentFilter[];
}

interface SetComponentFiltersResult {
  success: boolean;
}
```

#### `set_trace_updates_enabled`

Enable/disable visual update highlighting.

```typescript
interface SetTraceUpdatesEnabledParams {
  enabled: boolean;
}

interface SetTraceUpdatesEnabledResult {
  success: boolean;
}
```

---

### React Native Specific

#### `get_native_style`

Get native style and layout info (React Native only).

```typescript
interface GetNativeStyleParams {
  /** Element ID */
  id: number;
}

interface GetNativeStyleResult {
  style: Record<string, any> | null;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}
```

#### `set_native_style`

Set a native style property (React Native only).

```typescript
interface SetNativeStyleParams {
  /** Element ID */
  id: number;
  /** Style property name */
  property: string;
  /** New value */
  value: any;
}

interface SetNativeStyleResult {
  success: boolean;
  error?: string;
}
```

---

## Events (MCP Resources/Subscriptions)

The server can expose real-time updates via MCP resources:

### `devtools://components`

Live component tree updates.

```typescript
interface ComponentsUpdate {
  type: 'mount' | 'unmount' | 'update' | 'reorder';
  elements: Element[];
}
```

### `devtools://selection`

Current DevTools selection changes.

```typescript
interface SelectionUpdate {
  selectedElementID: number | null;
}
```

### `devtools://profiling`

Profiling data stream (when active).

```typescript
interface ProfilingUpdate {
  type: 'commit';
  commit: CommitData;
}
```

---

## Error Handling

All tools return errors in a consistent format:

```typescript
interface MCPError {
  code: ErrorCode;
  message: string;
  data?: any;
}

type ErrorCode =
  | 'NOT_CONNECTED'      // No connection to DevTools
  | 'ELEMENT_NOT_FOUND'  // Element ID doesn't exist
  | 'NOT_EDITABLE'       // Element can't be edited
  | 'INVALID_PATH'       // Path doesn't exist
  | 'SERIALIZATION_ERROR' // Can't serialize value
  | 'TIMEOUT'            // Operation timed out
  | 'INTERNAL_ERROR';    // Unexpected error
```

---

## Configuration

### MCP Server Config

```json
{
  "mcpServers": {
    "react-devtools": {
      "command": "npx",
      "args": ["-y", "@anthropic/react-devtools-mcp"],
      "env": {
        "DEVTOOLS_HOST": "localhost",
        "DEVTOOLS_PORT": "8097",
        "DEVTOOLS_TIMEOUT": "5000"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVTOOLS_HOST` | `localhost` | DevTools WebSocket host |
| `DEVTOOLS_PORT` | `8097` | DevTools WebSocket port |
| `DEVTOOLS_TIMEOUT` | `5000` | Connection timeout (ms) |
| `DEVTOOLS_AUTO_CONNECT` | `true` | Auto-connect on server start |
| `DEVTOOLS_DEBUG` | `false` | Enable debug logging |

---

## Usage Examples

### Inspect a component's state

```typescript
// 1. Get component tree
const tree = await mcp.call('get_component_tree', {});

// 2. Find the component
const loginForm = tree.roots[0].elements.find(e => e.displayName === 'LoginForm');

// 3. Inspect it
const inspection = await mcp.call('inspect_element', { id: loginForm.id });

// 4. Read state
console.log(inspection.element.hooks);
// [{ name: 'useState', value: { data: { isLoading: false } }, ... }]
```

### Debug a re-render

```typescript
// 1. Start profiling with change descriptions
await mcp.call('start_profiling', { recordChangeDescriptions: true });

// 2. Trigger some interaction...

// 3. Stop and analyze
const result = await mcp.call('stop_profiling', {});
const commits = result.data.roots[0].commits;

for (const commit of commits) {
  for (const [fiberID, description] of commit.changeDescriptions) {
    if (!description.isFirstMount) {
      console.log(`Fiber ${fiberID} re-rendered because:`);
      console.log(`  Props changed: ${description.props}`);
      console.log(`  State changed: ${description.state}`);
      console.log(`  Hooks changed: ${description.hooks}`);
    }
  }
}
```

### Hot-patch a value for testing

```typescript
// Override a prop
await mcp.call('override_props', {
  id: buttonId,
  path: ['disabled'],
  value: true
});

// Override hook state
await mcp.call('override_hooks', {
  id: formId,
  hookIndex: 0,  // First useState
  path: [],
  value: { email: 'test@example.com' }
});
```

---

## Implementation Notes

### Bridge Protocol

The server communicates with DevTools backend via the bridge protocol. Key message patterns:

```typescript
// Inspection request
bridge.send('inspectElement', {
  id: elementID,
  rendererID: 1,
  forceFullData: true,
  path: null
});

// Response handling
bridge.addListener('inspectedElement', (data) => {
  // data contains InspectedElementPayload
});
```

### Renderer ID

React apps can have multiple renderers (e.g., React DOM + React Native). Most apps have a single renderer with ID `1`. The server should auto-detect available renderers.

### Caching

DevTools caches inspection data. To force fresh data, set `forceFullData: true` or wait for element updates via the `operations` event.

### Serialization

Complex values (functions, symbols, etc.) are "dehydrated" for safe serialization. The `DehydratedData` type includes markers for special values. To expand truncated paths, use the `paths` parameter in `inspect_element`.

---

## References

- [React DevTools Overview](https://github.com/facebook/react/blob/main/packages/react-devtools/OVERVIEW.md)
- [react-devtools-core on npm](https://www.npmjs.com/package/react-devtools-core)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Bridge Protocol Source](https://github.com/facebook/react/tree/main/packages/react-devtools-shared/src)

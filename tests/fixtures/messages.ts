/**
 * Test fixtures for DevTools protocol messages
 */

import type { InspectedElement, SerializedElement } from '../../src/types.js';
import { SIMPLE_TREE, NESTED_TREE } from './operations.js';

// Re-export for test convenience
export { SIMPLE_TREE, NESTED_TREE };

// ═══════════════════════════════════════════════════════════════════════════
// INCOMING MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

export const BACKEND_VERSION = {
  event: 'backendVersion',
  payload: '19.0.0',
};

export const BRIDGE_PROTOCOL = {
  event: 'bridgeProtocol',
  payload: { version: 2 },
};

export const RENDERER_ATTACHED = {
  event: 'renderer',
  payload: {
    id: 1,
    rendererPackageName: 'react-dom',
    rendererVersion: '18.2.0',
  },
};

export const RENDERER_REACT_NATIVE = {
  event: 'renderer',
  payload: {
    id: 1,
    rendererPackageName: 'react-native',
    rendererVersion: '0.72.0',
  },
};

export const OPERATIONS_SIMPLE = {
  event: 'operations',
  payload: SIMPLE_TREE,
};

export const OPERATIONS_NESTED = {
  event: 'operations',
  payload: NESTED_TREE,
};

export function createInspectedElementPayload(id: number): {
  event: string;
  payload: { type: 'full-data'; element: InspectedElement; requestID?: number };
} {
  return {
    event: 'inspectedElement',
    payload: {
      type: 'full-data',
      requestID: id,
      element: {
        id,
        displayName: `Component${id}`,
        type: 'function',
        key: null,
        props: { cleaned: [], data: { foo: 'bar' }, unserializable: [] },
        state: null,
        hooks: null,
        context: null,
        source: { fileName: '/src/Component.tsx', lineNumber: 10 },
        stack: null,
        owners: null,
        rootType: 'createRoot()',
        isErrored: false,
        errors: [],
        warnings: [],
        isSuspended: null,
        suspendedBy: null,
        canToggleError: true,
        canToggleSuspense: true,
        canEditHooks: true,
        canEditFunctionProps: true,
        canEditHooksAndDeletePaths: true,
        canEditHooksAndRenamePaths: true,
        hasLegacyContext: false,
        env: null,
        rendererPackageName: 'react-dom',
        rendererVersion: '18.2.0',
        nativeTag: null,
      },
    },
  };
}

export function createOwnersListPayload(
  id: number,
  owners: SerializedElement[]
): { event: string; payload: { id: number; requestID?: number; owners: SerializedElement[] } } {
  return {
    event: 'ownersList',
    payload: { id, requestID: id, owners },
  };
}

export const PROFILING_STATUS = {
  event: 'profilingStatus',
  payload: { isProfiling: true },
};

export const PROFILING_DATA = {
  event: 'profilingData',
  payload: {
    roots: [
      {
        rootID: 1,
        displayName: 'Root',
        commits: [
          {
            timestamp: 1000,
            duration: 5.5,
            effectDuration: 0.1,
            passiveEffectDuration: 0.2,
            priorityLevel: 'Normal',
            fiberActualDurations: new Map(),
            fiberSelfDurations: new Map(),
            updaters: null,
            changeDescriptions: null,
          },
        ],
        initialTreeBaseDurations: new Map(),
      },
    ],
    timelineData: null,
  },
};

export const NATIVE_STYLE = {
  event: 'NativeStyleEditor_styleAndLayout',
  payload: {
    style: { backgroundColor: '#ffffff', padding: 16 },
    layout: { x: 0, y: 0, width: 375, height: 100 },
  },
};

export const STORAGE_API_SUPPORTED = {
  event: 'isBackendStorageAPISupported',
  payload: { isSupported: true },
};

export const XHR_SUPPORTED = {
  event: 'isSynchronousXHRSupported',
  payload: { isSupported: false },
};

export const RENDERER_INTERFACES = {
  event: 'getSupportedRendererInterfaces',
  payload: {
    rendererInterfaces: [
      {
        id: 1,
        renderer: 'react-dom',
        version: '18.2.0',
        bundleType: 'development',
        hasOwnerMetadata: true,
        hasManyWarnings: false,
      },
    ],
  },
};

export const SHUTDOWN = {
  event: 'shutdown',
  payload: null,
};

export const UNSUPPORTED_VERSION = {
  event: 'unsupportedRendererVersion',
  payload: '15.0.0',
};

// ═══════════════════════════════════════════════════════════════════════════
// ERROR MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

export const ELEMENT_NOT_FOUND = {
  event: 'inspectedElement',
  payload: { type: 'not-found' },
};

export const INSPECTION_ERROR = {
  event: 'inspectedElement',
  payload: {
    type: 'error',
    errorType: 'unknown',
    message: 'Failed to inspect element',
    stack: 'Error at line 42',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MALFORMED MESSAGES FOR ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

export const MALFORMED_JSON = 'not valid json {{{';

export const MISSING_EVENT = JSON.stringify({ payload: {} });

export const NULL_PAYLOAD = {
  event: 'operations',
  payload: null,
};

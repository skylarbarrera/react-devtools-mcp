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

export function createInspectedElementPayload(id: number, responseID?: number): {
  event: string;
  payload: { type: 'full-data'; id: number; element: InspectedElement; responseID?: number; requestID?: number };
} {
  return {
    event: 'inspectedElement',
    payload: {
      type: 'full-data',
      id,
      responseID: responseID ?? id,
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
  owners: SerializedElement[],
  responseID?: number
): { event: string; payload: { id: number; responseID?: number; requestID?: number; owners: SerializedElement[] } } {
  return {
    event: 'ownersList',
    payload: { id, responseID: responseID ?? id, owners },
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

export function createNativeStylePayload(id: number, responseID?: number): {
  event: string;
  payload: { id: number; responseID?: number; style: Record<string, unknown>; layout: { x: number; y: number; width: number; height: number } };
} {
  return {
    event: 'NativeStyleEditor_styleAndLayout',
    payload: {
      id,
      responseID,
      style: { backgroundColor: '#ffffff', padding: 16 },
      layout: { x: 0, y: 0, width: 375, height: 100 },
    },
  };
}

// Legacy constant for backwards compatibility
export const NATIVE_STYLE = createNativeStylePayload(1);

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

export function createElementNotFoundPayload(id: number, responseID?: number): {
  event: string;
  payload: { type: 'not-found'; id: number; responseID?: number };
} {
  return {
    event: 'inspectedElement',
    payload: { type: 'not-found', id, responseID },
  };
}

export function createInspectionErrorPayload(id: number, message: string, responseID?: number): {
  event: string;
  payload: { type: 'error'; id: number; responseID?: number; errorType: string; message: string; stack?: string };
} {
  return {
    event: 'inspectedElement',
    payload: {
      type: 'error',
      id,
      responseID,
      errorType: 'unknown',
      message,
      stack: 'Error at line 42',
    },
  };
}

// Legacy constants for backwards compatibility
export const ELEMENT_NOT_FOUND = createElementNotFoundPayload(1);
export const INSPECTION_ERROR = createInspectionErrorPayload(1, 'Failed to inspect element');

// ═══════════════════════════════════════════════════════════════════════════
// MALFORMED MESSAGES FOR ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

export const MALFORMED_JSON = 'not valid json {{{';

export const MISSING_EVENT = JSON.stringify({ payload: {} });

export const NULL_PAYLOAD = {
  event: 'operations',
  payload: null,
};

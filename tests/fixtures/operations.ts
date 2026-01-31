/**
 * Test fixtures for tree operations
 *
 * Operations use the React DevTools protocol with string table:
 * Format: [rendererID, rootID, stringTableSize, ...stringTableEntries, ...operations]
 *
 * String table entries: [length, ...charCodes] for each string
 * String table indices: 0 = null, 1+ = actual strings
 *
 * Operation codes:
 *   1 = ADD (root): id, type=11, isStrictModeCompliant, profilerFlags, supportsStrictMode, hasOwnerMetadata
 *   1 = ADD (other): id, type, parentID, ownerID, displayNameStringID, keyStringID, namePropStringID
 *   2 = REMOVE: count, ...ids
 *   3 = REORDER: id, childCount, ...childIds
 *   4 = UPDATE_TREE_BASE_DURATION: id, baseDuration
 *   5 = UPDATE_ERRORS_OR_WARNINGS: id, errorCount, warningCount
 */

// Element types (from react-devtools-shared)
export const ELEMENT_TYPES = {
  CLASS: 1,
  CONTEXT: 2,
  FUNCTION: 5,
  FORWARD_REF: 6,
  FRAGMENT: 7,
  HOST: 8,
  MEMO: 9,
  PORTAL: 10,
  ROOT: 11,
  PROFILER: 12,
  SUSPENSE: 13,
  LAZY: 14,
};

// Operation codes
export const TREE_OP = {
  ADD: 1,
  REMOVE: 2,
  REORDER: 3,
  UPDATE_TREE_BASE_DURATION: 4,
  UPDATE_ERRORS_OR_WARNINGS: 5,
};

/**
 * Encode a string into the string table format [length, ...charCodes]
 */
function encodeString(str: string): number[] {
  const codePoints: number[] = [];
  for (let i = 0; i < str.length; ) {
    const charCode = str.charCodeAt(i);
    // Handle surrogate pairs for emoji
    if ((charCode & 0xf800) === 0xd800 && i + 1 < str.length) {
      const nextCharCode = str.charCodeAt(i + 1);
      codePoints.push(((charCode & 0x3ff) << 10 | (nextCharCode & 0x3ff)) + 0x10000);
      i += 2;
    } else {
      codePoints.push(charCode);
      i++;
    }
  }
  return [codePoints.length, ...codePoints];
}

/**
 * Build a string table from array of strings
 * Returns [stringTableSize, ...entries] and a map of string -> index
 */
function buildStringTable(strings: string[]): { table: number[]; indexMap: Map<string, number> } {
  const indexMap = new Map<string, number>();
  const entries: number[] = [];

  strings.forEach((str, i) => {
    indexMap.set(str, i + 1); // 1-indexed (0 = null)
    entries.push(...encodeString(str));
  });

  return { table: [entries.length, ...entries], indexMap };
}

/**
 * Create a complete operations array with string table
 */
export function createOperationsWithTable(
  rendererID: number,
  rootID: number,
  strings: string[],
  operations: number[]
): number[] {
  const { table } = buildStringTable(strings);
  return [rendererID, rootID, ...table, ...operations];
}

/**
 * Create an ADD ROOT operation
 */
export function createAddRootOp(
  id: number,
  isStrictModeCompliant = false,
  profilerFlags = 0,
  supportsStrictMode = true,
  hasOwnerMetadata = true
): number[] {
  return [
    TREE_OP.ADD,
    id,
    ELEMENT_TYPES.ROOT,
    isStrictModeCompliant ? 1 : 0,
    profilerFlags,
    supportsStrictMode ? 1 : 0,
    hasOwnerMetadata ? 1 : 0,
  ];
}

/**
 * Create an ADD element operation (non-root)
 * displayNameStringID and keyStringID are 1-indexed into string table (0 = null)
 */
export function createAddElementOp(
  id: number,
  type: number,
  parentID: number,
  ownerID: number,
  displayNameStringID: number,
  keyStringID = 0,
  namePropStringID = 0
): number[] {
  return [
    TREE_OP.ADD,
    id,
    type,
    parentID,
    ownerID,
    displayNameStringID,
    keyStringID,
    namePropStringID,
  ];
}

/**
 * Create a REMOVE operation
 */
export function createRemoveOp(ids: number[]): number[] {
  return [TREE_OP.REMOVE, ids.length, ...ids];
}

/**
 * Create a REORDER operation
 */
export function createReorderOp(parentID: number, childIDs: number[]): number[] {
  return [TREE_OP.REORDER, parentID, childIDs.length, ...childIDs];
}

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE DATA - Using new string table format
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Empty operations array (just renderer ID, rootID, empty string table)
 */
export const EMPTY_OPERATIONS = [1, 0, 0];

/**
 * Simple tree with root + one component
 * Strings: ["App"]
 */
export const SIMPLE_TREE: number[] = createOperationsWithTable(
  1, // rendererID
  1, // rootID
  ['App'], // string table
  [
    ...createAddRootOp(1),
    ...createAddElementOp(2, ELEMENT_TYPES.FUNCTION, 1, 0, 1, 0, 0), // displayName = string[1] = "App"
  ]
);

/**
 * Nested tree with multiple levels
 * Strings: ["App", "Header", "Content", "Footer"]
 */
export const NESTED_TREE: number[] = createOperationsWithTable(
  1, // rendererID
  1, // rootID
  ['App', 'Header', 'Content', 'Footer'],
  [
    ...createAddRootOp(1),
    ...createAddElementOp(2, ELEMENT_TYPES.FUNCTION, 1, 0, 1, 0, 0), // App
    ...createAddElementOp(3, ELEMENT_TYPES.CLASS, 2, 2, 2, 0, 0), // Header
    ...createAddElementOp(4, ELEMENT_TYPES.FUNCTION, 2, 2, 3, 0, 0), // Content
    ...createAddElementOp(5, ELEMENT_TYPES.MEMO, 4, 2, 4, 0, 0), // Footer
  ]
);

/**
 * Tree with keyed elements
 * Strings: ["List", "Item", "item-1", "item-2", "item-3"]
 */
export const KEYED_TREE: number[] = createOperationsWithTable(
  1, // rendererID
  1, // rootID
  ['List', 'Item', 'item-1', 'item-2', 'item-3'],
  [
    ...createAddRootOp(1),
    ...createAddElementOp(2, ELEMENT_TYPES.FUNCTION, 1, 0, 1, 0, 0), // List
    ...createAddElementOp(3, ELEMENT_TYPES.HOST, 2, 0, 2, 3, 0), // Item, key="item-1"
    ...createAddElementOp(4, ELEMENT_TYPES.HOST, 2, 0, 2, 4, 0), // Item, key="item-2"
    ...createAddElementOp(5, ELEMENT_TYPES.HOST, 2, 0, 2, 5, 0), // Item, key="item-3"
  ]
);

/**
 * Remove operation example (needs prior tree state)
 */
export const REMOVE_OPERATIONS: number[] = createOperationsWithTable(
  1, 1, [],
  [...createRemoveOp([3, 4])]
);

/**
 * Reorder operation example
 */
export const REORDER_OPERATIONS: number[] = createOperationsWithTable(
  1, 1, [],
  [...createReorderOp(2, [5, 3, 4])]
);

/**
 * Multiple operations in one message
 * Strings: ["NewComponent"]
 */
export const MIXED_OPERATIONS: number[] = createOperationsWithTable(
  1, 1, ['NewComponent'],
  [
    ...createAddElementOp(6, ELEMENT_TYPES.FUNCTION, 2, 0, 1, 0, 0), // NewComponent
    ...createRemoveOp([3]),
    ...createReorderOp(2, [4, 5, 6]),
  ]
);

/**
 * Error/warning update
 */
export const ERRORS_OPERATIONS: number[] = createOperationsWithTable(
  1, 1, [],
  [TREE_OP.UPDATE_ERRORS_OR_WARNINGS, 2, 1, 2] // id=2, 1 error, 2 warnings
);

// ═══════════════════════════════════════════════════════════════════════════
// MALFORMED DATA FOR FUZZ TESTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Truncated ADD operation (missing fields)
 */
export const TRUNCATED_ADD: number[] = [
  1, 1, 0, // rendererID, rootID, stringTableSize=0
  TREE_OP.ADD, 1, ELEMENT_TYPES.ROOT, // Missing rest of root fields
];

/**
 * Invalid string table size (claims more than exists)
 */
export const HUGE_NAME_LENGTH: number[] = [
  1, 1, 999999, // stringTableSize way too big
];

/**
 * Negative counts
 */
export const NEGATIVE_COUNT: number[] = [
  1, 1, 0, // header
  TREE_OP.REMOVE, -5, // negative count
];

/**
 * Unknown operation code
 */
export const UNKNOWN_OP: number[] = [
  1, 1, 0, // header
  99, 1, 2, 3, // unknown op code 99
];

/**
 * Just renderer ID and rootID, no string table or operations
 */
export const RENDERER_ONLY: number[] = [1, 1];

/**
 * Empty array
 */
export const EMPTY_ARRAY: number[] = [];

/**
 * Generate random operation data for fuzz testing
 */
export function randomOperations(length: number): number[] {
  return Array.from({ length }, () => Math.floor(Math.random() * 256));
}

// Legacy helpers for compatibility
export function createAddOp(
  id: number,
  type: number,
  parentID: number,
  ownerID: number,
  displayName: string,
  key: string | null = null
): number[] {
  // This creates old-style operations - use createAddElementOp with string table instead
  console.warn('createAddOp is deprecated - use createAddElementOp with string table');
  const displayNameStringID = 1; // Assume first string
  const keyStringID = key ? 2 : 0;
  if (type === ELEMENT_TYPES.ROOT) {
    return createAddRootOp(id);
  }
  return createAddElementOp(id, type, parentID, ownerID, displayNameStringID, keyStringID, 0);
}

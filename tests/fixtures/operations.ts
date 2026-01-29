/**
 * Test fixtures for tree operations
 *
 * Operations are arrays of numbers representing tree mutations.
 * Format: [rendererID, op1, ...data1, op2, ...data2, ...]
 *
 * Operation codes:
 *   1 = ADD: id, type, parentID, ownerID, displayNameLen, ...displayName, keyLen, ...key
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
 * Helper to create a display name array from string
 */
function nameToArray(name: string): number[] {
  return [name.length, ...Array.from(name).map((c) => c.charCodeAt(0))];
}

/**
 * Create an ADD operation
 */
export function createAddOp(
  id: number,
  type: number,
  parentID: number,
  ownerID: number,
  displayName: string,
  key: string | null = null
): number[] {
  const result = [
    TREE_OP.ADD,
    id,
    type,
    parentID,
    ownerID,
    ...nameToArray(displayName),
  ];

  if (key) {
    result.push(...nameToArray(key));
  } else {
    result.push(0);
  }

  return result;
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
// FIXTURE DATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Empty operations array (just renderer ID)
 */
export const EMPTY_OPERATIONS = [1];

/**
 * Simple tree with root + one component
 */
export const SIMPLE_TREE: number[] = [
  1, // rendererID
  ...createAddOp(1, ELEMENT_TYPES.ROOT, 0, 0, 'Root'),
  ...createAddOp(2, ELEMENT_TYPES.FUNCTION, 1, 0, 'App'),
];

/**
 * Nested tree with multiple levels
 */
export const NESTED_TREE: number[] = [
  1, // rendererID
  ...createAddOp(1, ELEMENT_TYPES.ROOT, 0, 0, 'Root'),
  ...createAddOp(2, ELEMENT_TYPES.FUNCTION, 1, 0, 'App'),
  ...createAddOp(3, ELEMENT_TYPES.CLASS, 2, 2, 'Header'),
  ...createAddOp(4, ELEMENT_TYPES.FUNCTION, 2, 2, 'Content'),
  ...createAddOp(5, ELEMENT_TYPES.MEMO, 4, 2, 'Footer'),
];

/**
 * Tree with keyed elements
 */
export const KEYED_TREE: number[] = [
  1, // rendererID
  ...createAddOp(1, ELEMENT_TYPES.ROOT, 0, 0, 'Root'),
  ...createAddOp(2, ELEMENT_TYPES.FUNCTION, 1, 0, 'List'),
  ...createAddOp(3, ELEMENT_TYPES.HOST, 2, 0, 'Item', 'item-1'),
  ...createAddOp(4, ELEMENT_TYPES.HOST, 2, 0, 'Item', 'item-2'),
  ...createAddOp(5, ELEMENT_TYPES.HOST, 2, 0, 'Item', 'item-3'),
];

/**
 * Remove operation example
 */
export const REMOVE_OPERATIONS: number[] = [
  1, // rendererID
  ...createRemoveOp([3, 4]),
];

/**
 * Reorder operation example
 */
export const REORDER_OPERATIONS: number[] = [
  1, // rendererID
  ...createReorderOp(2, [5, 3, 4]), // Reverse order
];

/**
 * Multiple operations in one message
 */
export const MIXED_OPERATIONS: number[] = [
  1, // rendererID
  ...createAddOp(6, ELEMENT_TYPES.FUNCTION, 2, 0, 'NewComponent'),
  ...createRemoveOp([3]),
  ...createReorderOp(2, [4, 5, 6]),
];

/**
 * Error/warning update
 */
export const ERRORS_OPERATIONS: number[] = [
  1, // rendererID
  TREE_OP.UPDATE_ERRORS_OR_WARNINGS, 2, 1, 2, // id=2, 1 error, 2 warnings
];

// ═══════════════════════════════════════════════════════════════════════════
// MALFORMED DATA FOR FUZZ TESTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Truncated ADD operation (missing display name data)
 */
export const TRUNCATED_ADD: number[] = [
  1, // rendererID
  TREE_OP.ADD, 1, ELEMENT_TYPES.ROOT, 0, 0, 10, // displayNameLen=10 but no data follows
];

/**
 * Invalid display name length (huge)
 */
export const HUGE_NAME_LENGTH: number[] = [
  1, // rendererID
  TREE_OP.ADD, 1, ELEMENT_TYPES.ROOT, 0, 0, 999999, // way too big
];

/**
 * Negative counts
 */
export const NEGATIVE_COUNT: number[] = [
  1, // rendererID
  TREE_OP.REMOVE, -5, // negative count
];

/**
 * Unknown operation code
 */
export const UNKNOWN_OP: number[] = [
  1, // rendererID
  99, 1, 2, 3, // unknown op code 99
];

/**
 * Just renderer ID, no operations
 */
export const RENDERER_ONLY: number[] = [1];

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

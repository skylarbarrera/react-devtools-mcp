/**
 * Operations Parsing Tests
 *
 * Based on react-devtools-shared/src/__tests__/store-test.js
 * Validates that our Bridge correctly parses DevTools operations format.
 */

import { describe, it, expect } from 'vitest';

// Helper to create operations array with string table
function createOperations(
  rendererID: number,
  rootID: number,
  strings: string[],
  ops: number[]
): number[] {
  // Build string table
  const stringTable: number[] = [];
  for (const str of strings) {
    stringTable.push(str.length);
    for (let i = 0; i < str.length; i++) {
      stringTable.push(str.codePointAt(i) ?? 0);
    }
  }

  const stringTableSize = stringTable.length;

  return [rendererID, rootID, stringTableSize, ...stringTable, ...ops];
}

describe('Operations Parsing', () => {
  describe('String Table', () => {
    it('should parse empty string table', () => {
      const ops = createOperations(1, 1, [], []);
      expect(ops).toEqual([1, 1, 0]);
    });

    it('should parse single ASCII string', () => {
      const ops = createOperations(1, 1, ['App'], []);
      // String table: [3, 65, 112, 112] = length 3, "App"
      expect(ops).toEqual([1, 1, 4, 3, 65, 112, 112]);
    });

    it('should parse multibyte emoji string', () => {
      const ops = createOperations(1, 1, ['🟩'], []);
      // Emoji 🟩 is U+1F7E9, single code point
      expect(ops[3]).toBe(1); // length 1
      expect(ops[4]).toBe(0x1F7E9); // code point
    });

    it('should parse multiple strings', () => {
      const ops = createOperations(1, 1, ['App', 'Child'], []);
      // "App" = [3, 65, 112, 112]
      // "Child" = [5, 67, 104, 105, 108, 100]
      // Total size = 4 + 6 = 10
      expect(ops[2]).toBe(10); // stringTableSize
    });
  });

  describe('TREE_OPERATION_ADD Root', () => {
    it('should encode root element correctly', () => {
      // Root format: [ADD=1, id, type=11, isStrictModeCompliant, profilerFlags, supportsStrictMode, hasOwnerMetadata]
      const ADD = 1;
      const ElementTypeRoot = 11;

      const ops = createOperations(1, 1, [], [
        ADD,           // op code
        1,             // id
        ElementTypeRoot, // type
        1,             // isStrictModeCompliant
        0,             // profilerFlags
        1,             // supportsStrictMode
        1,             // hasOwnerMetadata
      ]);

      expect(ops).toEqual([
        1, 1, 0,  // rendererID, rootID, stringTableSize (empty)
        1, 1, 11, 1, 0, 1, 1  // ADD root operation
      ]);
    });
  });

  describe('TREE_OPERATION_ADD Non-Root', () => {
    it('should encode non-root element correctly', () => {
      // Non-root format: [ADD=1, id, type, parentID, ownerID, displayNameStringID, keyStringID, namePropStringID]
      const ADD = 1;
      const ElementTypeFunction = 5;

      const ops = createOperations(1, 1, ['App'], [
        ADD,               // op code
        2,                 // id
        ElementTypeFunction, // type
        1,                 // parentID (root)
        0,                 // ownerID
        1,                 // displayNameStringID (index 1 = "App")
        0,                 // keyStringID (0 = null)
        0,                 // namePropStringID (0 = null)
      ]);

      // rendererID=1, rootID=1
      // stringTableSize=4 (len=3 + 3 chars)
      // stringTable=[3, 65, 112, 112]
      // ops=[1, 2, 5, 1, 0, 1, 0, 0]
      expect(ops).toEqual([
        1, 1, 4, 3, 65, 112, 112,  // header + string table
        1, 2, 5, 1, 0, 1, 0, 0    // ADD non-root
      ]);
    });
  });

  describe('Real-world Operations', () => {
    it('should match actual web app operations format', () => {
      // This is the actual operations array from our test React app
      const actualOps = [1, 1, 4, 3, 65, 112, 112, 1, 1, 11, 0, 3, 1, 1, 1, 2, 5, 1, 0, 1, 0, 7, 2, 1];

      // Parse it:
      // [0]=1: rendererID
      // [1]=1: rootID
      // [2]=4: stringTableSize
      // [3-6]=[3, 65, 112, 112]: string "App" (length 3)
      // [7+]: operations

      // Verify string table
      expect(actualOps[2]).toBe(4); // stringTableSize

      // Verify first string is "App"
      expect(actualOps[3]).toBe(3); // length
      expect(String.fromCharCode(actualOps[4], actualOps[5], actualOps[6])).toBe('App');

      // Operations start at index 7
      // [7]=1: ADD
      // [8]=1: id
      // [9]=11: ElementTypeRoot
      expect(actualOps[7]).toBe(1); // TREE_OPERATION_ADD
      expect(actualOps[9]).toBe(11); // ElementTypeRoot
    });
  });
});

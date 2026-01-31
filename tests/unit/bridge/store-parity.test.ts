/**
 * Store Parity Tests
 *
 * These tests mirror react-devtools-shared/src/__tests__/store-test.js
 * to ensure 1:1 compatibility with React DevTools protocol parsing.
 *
 * Reference: https://github.com/facebook/react/blob/main/packages/react-devtools-shared/src/__tests__/store-test.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Define mock WebSocket interface
interface MockWebSocketInstance extends EventEmitter {
  readyState: number;
  url: string;
  send(): void;
  close(): void;
  simulateMessage(event: string, payload?: unknown): void;
}

const mockWebSocketInstances = vi.hoisted(() => [] as MockWebSocketInstance[]);

vi.mock('ws', async () => {
  const { EventEmitter } = await import('events');

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState: number = MockWebSocket.OPEN;
    url: string;

    constructor(url: string) {
      super();
      this.url = url;
      mockWebSocketInstances.push(this as unknown as MockWebSocketInstance);
      setImmediate(() => this.emit('open'));
    }
    send(): void {}
    close(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', 1000, Buffer.from(''));
    }
    simulateMessage(event: string, payload?: unknown): void {
      const data = JSON.stringify({ event, payload });
      this.emit('message', Buffer.from(data));
    }
  }

  return { WebSocket: MockWebSocket };
});

import { DevToolsBridge } from '../../../src/bridge.js';
import { createMockLogger, flushPromises } from '../../setup.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS - Based on react-devtools-shared/src/utils.js
// ═══════════════════════════════════════════════════════════════════════════

const ELEMENT_TYPE = {
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

const TREE_OP = {
  ADD: 1,
  REMOVE: 2,
  REORDER: 3,
};

/**
 * Encode string using React DevTools' utfEncodeString logic
 * Handles surrogate pairs for emoji
 */
function utfEncodeString(str: string): number[] {
  const encoded: number[] = [];
  for (let i = 0; i < str.length; ) {
    const charCode = str.charCodeAt(i);
    if ((charCode & 0xf800) === 0xd800 && i + 1 < str.length) {
      const nextCharCode = str.charCodeAt(i + 1);
      encoded.push(((charCode & 0x3ff) << 10 | (nextCharCode & 0x3ff)) + 0x10000);
      i += 2;
    } else {
      encoded.push(charCode);
      i++;
    }
  }
  return encoded;
}

/**
 * Build operations with string table
 */
function buildOperations(
  rendererID: number,
  rootID: number,
  strings: string[],
  ops: number[]
): number[] {
  const stringTableEntries: number[] = [];
  for (const str of strings) {
    const encoded = utfEncodeString(str);
    stringTableEntries.push(encoded.length, ...encoded);
  }
  return [rendererID, rootID, stringTableEntries.length, ...stringTableEntries, ...ops];
}

function addRoot(id: number): number[] {
  return [TREE_OP.ADD, id, ELEMENT_TYPE.ROOT, 0, 0, 1, 1];
}

function addElement(
  id: number,
  type: number,
  parentID: number,
  ownerID: number,
  displayNameIdx: number,
  keyIdx = 0
): number[] {
  return [TREE_OP.ADD, id, type, parentID, ownerID, displayNameIdx, keyIdx, 0];
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS - Mirroring store-test.js
// ═══════════════════════════════════════════════════════════════════════════

describe('Store Parity Tests (from react-devtools-shared)', () => {
  let bridge: DevToolsBridge;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    mockWebSocketInstances.length = 0;
    mockLogger = createMockLogger();
    bridge = new DevToolsBridge({ logger: mockLogger.logger });
    await bridge.connect();
  });

  afterEach(() => {
    vi.clearAllMocks();
    bridge.disconnect();
  });

  describe('Multibyte character handling', () => {
    /**
     * From store-test.js:
     * it('should handle multibyte character strings', async () => {
     *   const Component = () => null;
     *   Component.displayName = '🟩💜🔵';
     *   ...
     *   expect(store).toMatchInlineSnapshot(`[root] <🟩💜🔵>`);
     * });
     */
    it('should handle multibyte character strings (emoji displayName)', async () => {
      const ws = mockWebSocketInstances[0];
      const emojiName = '🟩💜🔵';

      // Build operations with emoji display name
      const ops = buildOperations(1, 1, [emojiName], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1), // displayName = string[1] = emoji
      ]);

      ws.simulateMessage('operations', ops);
      await flushPromises();

      const tree = bridge.getComponentTree();
      expect(tree.length).toBe(1);

      const elements = tree[0].elements;
      const component = elements.find(e => e.type !== 'root');
      expect(component).toBeDefined();
      expect(component!.displayName).toBe('🟩💜🔵');
    });

    it('should handle single emoji character', async () => {
      const ws = mockWebSocketInstances[0];

      const ops = buildOperations(1, 1, ['🟩'], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1),
      ]);

      ws.simulateMessage('operations', ops);
      await flushPromises();

      const tree = bridge.getComponentTree();
      const component = tree[0].elements.find(e => e.type !== 'root');
      expect(component!.displayName).toBe('🟩');
    });
  });

  describe('Component tree structure', () => {
    /**
     * From store-test.js:
     * it('should support mount and update operations', async () => {
     *   expect(store).toMatchInlineSnapshot(`
     *     [root]
     *       ▾ <Grandparent>
     *         ▾ <Parent>
     *             <Child key="0">
     */
    it('should build nested component hierarchy', async () => {
      const ws = mockWebSocketInstances[0];

      const ops = buildOperations(1, 1, ['Grandparent', 'Parent', 'Child'], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1), // Grandparent
        ...addElement(3, ELEMENT_TYPE.FUNCTION, 2, 2, 2), // Parent (child of Grandparent)
        ...addElement(4, ELEMENT_TYPE.FUNCTION, 3, 2, 3), // Child (child of Parent)
      ]);

      ws.simulateMessage('operations', ops);
      await flushPromises();

      const tree = bridge.getComponentTree();
      expect(tree.length).toBe(1);

      const elements = tree[0].elements;
      expect(elements.length).toBe(4); // root + 3 components

      // Verify hierarchy
      const grandparent = elements.find(e => e.displayName === 'Grandparent');
      const parent = elements.find(e => e.displayName === 'Parent');
      const child = elements.find(e => e.displayName === 'Child');

      expect(grandparent).toBeDefined();
      expect(parent).toBeDefined();
      expect(child).toBeDefined();

      expect(parent!.parentID).toBe(grandparent!.id);
      expect(child!.parentID).toBe(parent!.id);

      // Verify depth
      expect(grandparent!.depth).toBe(1);
      expect(parent!.depth).toBe(2);
      expect(child!.depth).toBe(3);
    });

    /**
     * From store-test.js:
     * it('should support multiple roots', async () => {
     */
    it('should support multiple roots', async () => {
      const ws = mockWebSocketInstances[0];

      // First root
      const ops1 = buildOperations(1, 1, ['App1'], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1),
      ]);

      // Second root
      const ops2 = buildOperations(1, 10, ['App2'], [
        ...addRoot(10),
        ...addElement(11, ELEMENT_TYPE.FUNCTION, 10, 0, 1),
      ]);

      ws.simulateMessage('operations', ops1);
      await flushPromises();
      ws.simulateMessage('operations', ops2);
      await flushPromises();

      const tree = bridge.getComponentTree();
      expect(tree.length).toBe(2);

      expect(tree[0].elements.some(e => e.displayName === 'App1')).toBe(true);
      expect(tree[1].elements.some(e => e.displayName === 'App2')).toBe(true);
    });
  });

  describe('Element types', () => {
    /**
     * From store-test.js:
     * it('should show the right display names for special component types', async () => {
     *   expect(store).toMatchInlineSnapshot(`
     *     [root]
     *       ▾ <App>
     *           <MyComponent>
     *           <MyComponent> [ForwardRef]
     *           <Custom>
     *           <MyComponent4> [Memo]
     */
    it('should correctly identify element types', async () => {
      const ws = mockWebSocketInstances[0];

      const ops = buildOperations(1, 1, ['App', 'ClassComp', 'FuncComp', 'MemoComp', 'ForwardRefComp'], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1), // App
        ...addElement(3, ELEMENT_TYPE.CLASS, 2, 0, 2),    // ClassComp
        ...addElement(4, ELEMENT_TYPE.FUNCTION, 2, 0, 3), // FuncComp
        ...addElement(5, ELEMENT_TYPE.MEMO, 2, 0, 4),     // MemoComp
        ...addElement(6, ELEMENT_TYPE.FORWARD_REF, 2, 0, 5), // ForwardRefComp
      ]);

      ws.simulateMessage('operations', ops);
      await flushPromises();

      const tree = bridge.getComponentTree();
      const elements = tree[0].elements;

      const classComp = elements.find(e => e.displayName === 'ClassComp');
      const funcComp = elements.find(e => e.displayName === 'FuncComp');
      const memoComp = elements.find(e => e.displayName === 'MemoComp');
      const forwardRefComp = elements.find(e => e.displayName === 'ForwardRefComp');

      expect(classComp!.type).toBe('class');
      expect(funcComp!.type).toBe('function');
      expect(memoComp!.type).toBe('memo');
      expect(forwardRefComp!.type).toBe('forward_ref');
    });
  });

  describe('Key handling', () => {
    /**
     * From store-test.js:
     * it('should properly serialize non-string key values', async () => {
     *   <Child key={123} />
     */
    it('should parse keyed elements', async () => {
      const ws = mockWebSocketInstances[0];

      // Keys are strings in the string table
      const ops = buildOperations(1, 1, ['List', 'Item', 'key-1', 'key-2'], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1), // List
        ...addElement(3, ELEMENT_TYPE.HOST, 2, 0, 2, 3),  // Item key="key-1"
        ...addElement(4, ELEMENT_TYPE.HOST, 2, 0, 2, 4),  // Item key="key-2"
      ]);

      ws.simulateMessage('operations', ops);
      await flushPromises();

      const tree = bridge.getComponentTree();
      const elements = tree[0].elements;

      const items = elements.filter(e => e.displayName === 'Item');
      expect(items.length).toBe(2);
      expect(items[0].key).toBe('key-1');
      expect(items[1].key).toBe('key-2');
    });

    it('should handle null keys (keyStringID = 0)', async () => {
      const ws = mockWebSocketInstances[0];

      const ops = buildOperations(1, 1, ['Component'], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1, 0), // key = null (index 0)
      ]);

      ws.simulateMessage('operations', ops);
      await flushPromises();

      const tree = bridge.getComponentTree();
      const component = tree[0].elements.find(e => e.displayName === 'Component');
      expect(component!.key).toBeNull();
    });
  });

  describe('Reorder operations', () => {
    /**
     * From store-test.js:
     * it('should support reordering of children', async () => {
     */
    it('should handle REORDER operations', async () => {
      const ws = mockWebSocketInstances[0];

      // Initial tree
      const ops1 = buildOperations(1, 1, ['Parent', 'Child'], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1), // Parent
        ...addElement(3, ELEMENT_TYPE.FUNCTION, 2, 0, 2), // Child 1
        ...addElement(4, ELEMENT_TYPE.FUNCTION, 2, 0, 2), // Child 2
        ...addElement(5, ELEMENT_TYPE.FUNCTION, 2, 0, 2), // Child 3
      ]);

      ws.simulateMessage('operations', ops1);
      await flushPromises();

      // Reorder children
      const reorderOps = buildOperations(1, 1, [], [
        TREE_OP.REORDER, 2, 3, 5, 3, 4, // parent=2, 3 children: [5, 3, 4]
      ]);

      const reorderHandler = vi.fn();
      bridge.on('elementReordered', reorderHandler);

      ws.simulateMessage('operations', reorderOps);
      await flushPromises();

      expect(reorderHandler).toHaveBeenCalled();
    });
  });

  describe('Remove operations', () => {
    it('should handle REMOVE operations', async () => {
      const ws = mockWebSocketInstances[0];

      // Build initial tree
      const ops1 = buildOperations(1, 1, ['Parent', 'Child'], [
        ...addRoot(1),
        ...addElement(2, ELEMENT_TYPE.FUNCTION, 1, 0, 1),
        ...addElement(3, ELEMENT_TYPE.FUNCTION, 2, 0, 2),
      ]);

      ws.simulateMessage('operations', ops1);
      await flushPromises();

      let tree = bridge.getComponentTree();
      expect(tree[0].elements.length).toBe(3);

      // Remove child
      const removeOps = buildOperations(1, 1, [], [
        TREE_OP.REMOVE, 1, 3, // count=1, remove id=3
      ]);

      ws.simulateMessage('operations', removeOps);
      await flushPromises();

      tree = bridge.getComponentTree();
      expect(tree[0].elements.find(e => e.id === 3)).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty operations array gracefully', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', []);
      await flushPromises();
      expect(bridge.getComponentTree().length).toBe(0);
    });

    it('should handle operations with only header (no ops)', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', [1, 1, 0]); // rendererID, rootID, empty string table
      await flushPromises();
      // Should not crash
      expect(bridge.getComponentTree().length).toBe(0);
    });
  });
});

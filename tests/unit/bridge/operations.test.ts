/**
 * Tests for DevToolsBridge operations parser
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

// Create mock instances array in hoisted scope
const mockWebSocketInstances = vi.hoisted(() => [] as MockWebSocketInstance[]);

// Mock WebSocket with factory that runs after imports
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
import {
  EMPTY_ARRAY,
  SIMPLE_TREE,
  NESTED_TREE,
  KEYED_TREE,
  REMOVE_OPERATIONS,
  REORDER_OPERATIONS,
  MIXED_OPERATIONS,
  ERRORS_OPERATIONS,
  TRUNCATED_ADD,
  HUGE_NAME_LENGTH,
  NEGATIVE_COUNT,
  UNKNOWN_OP,
  RENDERER_ONLY,
} from '../../fixtures/operations.js';

describe('DevToolsBridge Operations Parser', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let bridge: DevToolsBridge;

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

  describe('ADD operations', () => {
    it('should process simple ADD operations', async () => {
      const ws = mockWebSocketInstances[0];
      const elementAddedHandler = vi.fn();
      bridge.on('elementAdded', elementAddedHandler);

      ws.simulateMessage('operations', SIMPLE_TREE);
      await flushPromises();

      expect(elementAddedHandler).toHaveBeenCalledTimes(2);

      const tree = bridge.getComponentTree();
      expect(tree.length).toBe(1);
      expect(tree[0].elements.length).toBe(2);
    });

    it('should parse display names correctly', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', SIMPLE_TREE);
      await flushPromises();

      const root = bridge.getElementById(1);
      expect(root?.displayName).toBe('Root');
      expect(root?.type).toBe('root');

      const app = bridge.getElementById(2);
      expect(app?.displayName).toBe('App');
      expect(app?.type).toBe('function');
    });

    it('should build parent-child relationships', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', NESTED_TREE);
      await flushPromises();

      const app = bridge.getElementById(2);
      expect(app?.parentID).toBe(1);
      expect(app?.hasChildren).toBe(true);

      const header = bridge.getElementById(3);
      expect(header?.parentID).toBe(2);
      expect(header?.depth).toBe(2);
    });

    it('should parse keyed elements', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', KEYED_TREE);
      await flushPromises();

      const item1 = bridge.getElementById(3);
      expect(item1?.key).toBe('item-1');

      const item2 = bridge.getElementById(4);
      expect(item2?.key).toBe('item-2');
    });

    it('should track element types correctly', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', NESTED_TREE);
      await flushPromises();

      expect(bridge.getElementById(1)?.type).toBe('root');
      expect(bridge.getElementById(2)?.type).toBe('function');
      expect(bridge.getElementById(3)?.type).toBe('class');
      expect(bridge.getElementById(5)?.type).toBe('memo');
    });
  });

  describe('REMOVE operations', () => {
    it('should remove elements', async () => {
      const ws = mockWebSocketInstances[0];

      ws.simulateMessage('operations', KEYED_TREE);
      await flushPromises();

      expect(bridge.getElementById(3)).not.toBeNull();
      expect(bridge.getElementById(4)).not.toBeNull();

      ws.simulateMessage('operations', REMOVE_OPERATIONS);
      await flushPromises();

      expect(bridge.getElementById(3)).toBeNull();
      expect(bridge.getElementById(4)).toBeNull();
      expect(bridge.getElementById(5)).not.toBeNull();
    });

    it('should emit elementRemoved events', async () => {
      const ws = mockWebSocketInstances[0];
      const elementRemovedHandler = vi.fn();
      bridge.on('elementRemoved', elementRemovedHandler);

      ws.simulateMessage('operations', KEYED_TREE);
      await flushPromises();

      ws.simulateMessage('operations', REMOVE_OPERATIONS);
      await flushPromises();

      expect(elementRemovedHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('REORDER operations', () => {
    it('should emit elementReordered event', async () => {
      const ws = mockWebSocketInstances[0];
      const reorderedHandler = vi.fn();
      bridge.on('elementReordered', reorderedHandler);

      ws.simulateMessage('operations', KEYED_TREE);
      await flushPromises();

      ws.simulateMessage('operations', REORDER_OPERATIONS);
      await flushPromises();

      expect(reorderedHandler).toHaveBeenCalledWith({ id: 2, childCount: 3 });
    });
  });

  describe('Mixed operations', () => {
    it('should handle multiple operations in one message', async () => {
      const ws = mockWebSocketInstances[0];

      ws.simulateMessage('operations', KEYED_TREE);
      await flushPromises();

      const addHandler = vi.fn();
      const removeHandler = vi.fn();
      const reorderHandler = vi.fn();
      bridge.on('elementAdded', addHandler);
      bridge.on('elementRemoved', removeHandler);
      bridge.on('elementReordered', reorderHandler);

      ws.simulateMessage('operations', MIXED_OPERATIONS);
      await flushPromises();

      expect(addHandler).toHaveBeenCalled();
      expect(removeHandler).toHaveBeenCalled();
      expect(reorderHandler).toHaveBeenCalled();
    });
  });

  describe('Error/Warning updates', () => {
    it('should track element errors and warnings', async () => {
      const ws = mockWebSocketInstances[0];

      ws.simulateMessage('operations', SIMPLE_TREE);
      await flushPromises();

      ws.simulateMessage('operations', ERRORS_OPERATIONS);
      await flushPromises();

      const { errors, warnings } = bridge.getErrorsAndWarnings();
      expect(errors.has(2)).toBe(true);
      expect(warnings.has(2)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty operations array', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', EMPTY_ARRAY);
      await flushPromises();
      expect(bridge.getComponentTree()).toEqual([]);
    });

    it('should handle operations with only renderer ID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', RENDERER_ONLY);
      await flushPromises();
      expect(bridge.getComponentTree()).toEqual([]);
    });

    it('should emit operationsComplete event', async () => {
      const ws = mockWebSocketInstances[0];
      const completeHandler = vi.fn();
      bridge.on('operationsComplete', completeHandler);

      ws.simulateMessage('operations', SIMPLE_TREE);
      await flushPromises();

      expect(completeHandler).toHaveBeenCalled();
    });
  });

  describe('Malformed operations (bounds checking)', () => {
    it('should handle truncated ADD operation', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', TRUNCATED_ADD);
      await flushPromises();
      expect(mockLogger.hasLog('warn', 'ADD operation')).toBe(true);
    });

    it('should handle huge display name length', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', HUGE_NAME_LENGTH);
      await flushPromises();
      expect(mockLogger.hasLog('warn', 'displayNameLength')).toBe(true);
    });

    it('should handle negative counts', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', NEGATIVE_COUNT);
      await flushPromises();
      expect(mockLogger.hasLog('warn', 'invalid count')).toBe(true);
    });

    it('should handle unknown operation codes', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', UNKNOWN_OP);
      await flushPromises();
      expect(mockLogger.hasLog('warn', 'Unknown operation code')).toBe(true);
    });

    it('should handle non-array operations', async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', { invalid: 'data' } as unknown as number[]);
      await flushPromises();
      expect(mockLogger.hasLog('warn', 'not an array')).toBe(true);
    });
  });

  describe('searchComponents', () => {
    beforeEach(async () => {
      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('operations', NESTED_TREE);
      await flushPromises();
    });

    it('should find components by name', () => {
      const results = bridge.searchComponents('Header');
      expect(results.length).toBe(1);
      expect(results[0].displayName).toBe('Header');
    });

    it('should support case-insensitive search', () => {
      const results = bridge.searchComponents('header', false);
      expect(results.length).toBe(1);

      const caseSensitive = bridge.searchComponents('header', true);
      expect(caseSensitive.length).toBe(0);
    });

    it('should support regex search', () => {
      const results = bridge.searchComponents('^(Header|Footer)$', false, true);
      expect(results.length).toBe(2);
    });

    it('should return empty for invalid regex', () => {
      const results = bridge.searchComponents('[invalid', false, true);
      expect(results.length).toBe(0);
      expect(mockLogger.hasLog('warn', 'Invalid regex')).toBe(true);
    });
  });
});

/**
 * Fuzz tests for operations parser
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

// Import after mock
import { DevToolsBridge } from '../../src/bridge.js';
import { createMockLogger, flushPromises } from '../setup.js';
import { randomOperations, TREE_OP, ELEMENT_TYPES } from '../fixtures/operations.js';

describe('Operations Fuzz Testing', () => {
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

  describe('Random byte arrays', () => {
    it('should survive 100 random byte arrays', async () => {
      const ws = mockWebSocketInstances[0];

      for (let i = 0; i < 100; i++) {
        const ops = randomOperations(Math.floor(Math.random() * 200));
        expect(() => ws.simulateMessage('operations', ops)).not.toThrow();
        await flushPromises();
      }
    });

    it('should survive large random arrays', async () => {
      const ws = mockWebSocketInstances[0];

      for (let i = 0; i < 5; i++) {
        const ops = randomOperations(5000);
        expect(() => ws.simulateMessage('operations', ops)).not.toThrow();
        await flushPromises();
      }
    });
  });

  describe('Edge case arrays', () => {
    const edgeCases: [string, number[]][] = [
      ['empty array', []],
      ['just 0', [0]],
      ['just 1 (renderer ID)', [1]],
      ['renderer + ADD op only', [1, TREE_OP.ADD]],
      ['renderer + REMOVE op only', [1, TREE_OP.REMOVE]],
      ['renderer + REORDER op only', [1, TREE_OP.REORDER]],
      ['all zeros', Array(100).fill(0)],
      ['all ones', Array(100).fill(1)],
      ['negative values', [-1, -2, -3, -4, -5]],
    ];

    for (const [name, ops] of edgeCases) {
      it(`should survive: ${name}`, async () => {
        const ws = mockWebSocketInstances[0];
        expect(() => ws.simulateMessage('operations', ops)).not.toThrow();
        await flushPromises();
      });
    }
  });

  describe('Malformed ADD operations', () => {
    const malformedAdds: [string, number[]][] = [
      ['ADD with no data', [1, TREE_OP.ADD]],
      ['ADD with partial data (1)', [1, TREE_OP.ADD, 100]],
      ['ADD with partial data (2)', [1, TREE_OP.ADD, 100, 1]],
      ['ADD with partial data (3)', [1, TREE_OP.ADD, 100, 1, 0]],
      ['ADD with partial data (4)', [1, TREE_OP.ADD, 100, 1, 0, 0]],
      ['ADD with huge name length', [1, TREE_OP.ADD, 1, 1, 0, 0, 999999]],
      ['ADD with negative name length', [1, TREE_OP.ADD, 1, 1, 0, 0, -5]],
      ['ADD with name length > remaining', [1, TREE_OP.ADD, 1, 1, 0, 0, 10, 65, 66]],
    ];

    for (const [name, ops] of malformedAdds) {
      it(`should survive: ${name}`, async () => {
        const ws = mockWebSocketInstances[0];
        expect(() => ws.simulateMessage('operations', ops)).not.toThrow();
        await flushPromises();
      });
    }
  });

  describe('Malformed REMOVE operations', () => {
    const malformedRemoves: [string, number[]][] = [
      ['REMOVE with no count', [1, TREE_OP.REMOVE]],
      ['REMOVE with count but no IDs', [1, TREE_OP.REMOVE, 5]],
      ['REMOVE with count > available IDs', [1, TREE_OP.REMOVE, 10, 1, 2]],
      ['REMOVE with negative count', [1, TREE_OP.REMOVE, -5]],
      ['REMOVE with huge count', [1, TREE_OP.REMOVE, 999999]],
      ['REMOVE with zero count', [1, TREE_OP.REMOVE, 0]],
    ];

    for (const [name, ops] of malformedRemoves) {
      it(`should survive: ${name}`, async () => {
        const ws = mockWebSocketInstances[0];
        expect(() => ws.simulateMessage('operations', ops)).not.toThrow();
        await flushPromises();
      });
    }
  });

  describe('Unknown operation codes', () => {
    const unknownCodes: [string, number[]][] = [
      ['unknown code 0', [1, 0, 1, 2, 3]],
      ['unknown code 6', [1, 6, 1, 2, 3]],
      ['unknown code 99', [1, 99, 1, 2, 3]],
      ['sequence of unknown codes', [1, 6, 7, 8, 9, 10, 11, 12]],
    ];

    for (const [name, ops] of unknownCodes) {
      it(`should survive: ${name}`, async () => {
        const ws = mockWebSocketInstances[0];
        expect(() => ws.simulateMessage('operations', ops)).not.toThrow();
        await flushPromises();
      });
    }
  });

  describe('Non-numeric values', () => {
    it('should survive non-array operations', async () => {
      const ws = mockWebSocketInstances[0];

      const nonArrays = [null, undefined, 'string', { object: true }, 42];

      for (const value of nonArrays) {
        expect(() => ws.simulateMessage('operations', value as unknown as number[])).not.toThrow();
        await flushPromises();
      }
    });
  });

  describe('Stress testing', () => {
    it('should remain stable after many operations', async () => {
      const ws = mockWebSocketInstances[0];

      // First add a root element
      ws.simulateMessage('operations', [
        1, // rendererID
        TREE_OP.ADD, 1, ELEMENT_TYPES.ROOT, 0, 0, 4, 82, 111, 111, 116, 0, // id=1, Root
      ]);
      await flushPromises();

      // Send valid operations adding children to root
      for (let i = 0; i < 50; i++) {
        const id = 100 + i;
        ws.simulateMessage('operations', [
          1, // rendererID
          TREE_OP.ADD, id, ELEMENT_TYPES.FUNCTION, 1, 0, 4, 84, 101, 115, 116, 0, // parentID=1
        ]);
        await flushPromises();
      }

      const tree = bridge.getComponentTree();
      expect(tree.length).toBeGreaterThan(0);

      // Send random garbage
      for (let i = 0; i < 50; i++) {
        ws.simulateMessage('operations', randomOperations(50));
        await flushPromises();
      }

      // Should still work
      const results = bridge.searchComponents('Test');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

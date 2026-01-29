/**
 * Tests for DevToolsBridge request handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Define mock WebSocket interface
interface MockWebSocketInstance extends EventEmitter {
  readyState: number;
  url: string;
  send(data: string): void;
  close(): void;
  getSentMessages(): string[];
  getLastParsedMessage(): { event: string; payload: Record<string, unknown> } | undefined;
  clearSentMessages(): void;
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
    private sentMessages: string[] = [];

    constructor(url: string) {
      super();
      this.url = url;
      mockWebSocketInstances.push(this as unknown as MockWebSocketInstance);
      setImmediate(() => this.emit('open'));
    }

    send(data: string): void {
      this.sentMessages.push(data);
    }

    close(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', 1000, Buffer.from(''));
    }

    getSentMessages(): string[] {
      return [...this.sentMessages];
    }

    getLastParsedMessage(): { event: string; payload: Record<string, unknown> } | undefined {
      const msg = this.sentMessages[this.sentMessages.length - 1];
      return msg ? JSON.parse(msg) : undefined;
    }

    clearSentMessages(): void {
      this.sentMessages = [];
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
  createInspectedElementPayload,
  createOwnersListPayload,
  SIMPLE_TREE,
} from '../../fixtures/messages.js';

describe('DevToolsBridge Request Handling', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let bridge: DevToolsBridge;

  beforeEach(async () => {
    mockWebSocketInstances.length = 0;
    mockLogger = createMockLogger();
    bridge = new DevToolsBridge({
      timeout: 1000,
      logger: mockLogger.logger,
    });
    await bridge.connect();

    const ws = mockWebSocketInstances[0];
    ws.simulateMessage('operations', SIMPLE_TREE);
    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
    bridge.disconnect();
  });

  describe('inspectElement', () => {
    it('should send inspect request with request ID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const inspectPromise = bridge.inspectElement(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      expect(msg?.event).toBe('inspectElement');
      expect(msg?.payload).toMatchObject({
        id: 2,
        rendererID: expect.any(Number),
        requestID: expect.any(Number),
        forceFullData: true,
      });

      const response = createInspectedElementPayload(2);
      (response.payload as { requestID?: number }).requestID = msg?.payload.requestID as number;
      ws.simulateMessage(response.event, response.payload);

      const result = await inspectPromise;
      expect(result.type).toBe('full-data');
    });

    it('should handle element not found', async () => {
      const result = await bridge.inspectElement(999);
      expect(result.type).toBe('not-found');
    });

    it('should timeout if no response', async () => {
      const inspectPromise = bridge.inspectElement(2);
      await expect(inspectPromise).rejects.toThrow('timeout');
    }, 2000);
  });

  describe('getOwnersList', () => {
    it('should return owners list', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const ownersPromise = bridge.getOwnersList(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      expect(msg?.event).toBe('getOwnersList');

      const response = createOwnersListPayload(2, [
        { id: 1, displayName: 'App', type: 'function', key: null, env: null, hocDisplayNames: null },
      ]);
      (response.payload as { requestID?: number }).requestID = msg?.payload.requestID as number;
      ws.simulateMessage(response.event, response.payload);

      const result = await ownersPromise;
      expect(result.length).toBe(1);
      expect(result[0].displayName).toBe('App');
    });

    it('should return empty array for unknown element', async () => {
      const result = await bridge.getOwnersList(999);
      expect(result).toEqual([]);
    });
  });

  describe('Request cleanup', () => {
    it('should clean up timeout on response', async () => {
      const ws = mockWebSocketInstances[0];

      const inspectPromise = bridge.inspectElement(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const response = createInspectedElementPayload(2);
      (response.payload as { requestID?: number }).requestID = msg?.payload.requestID as number;
      ws.simulateMessage(response.event, response.payload);

      await inspectPromise;
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should clean up on disconnect', async () => {
      // Start a request and immediately attach rejection handler to prevent unhandled rejection
      const inspectPromise = bridge.inspectElement(2).catch(() => 'rejected');
      await flushPromises();

      expect(bridge.getPendingRequestCount()).toBe(1);
      bridge.disconnect();
      await flushPromises();

      expect(bridge.getPendingRequestCount()).toBe(0);
      // The promise should have rejected and been caught
      const result = await inspectPromise;
      expect(result).toBe('rejected');
    });
  });

  describe('Override operations', () => {
    it('should send overrideValueAtPath for props', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      bridge.overrideValueAtPath('props', 2, ['foo', 'bar'], 'new value');
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      expect(msg?.event).toBe('overrideValueAtPath');
      expect(msg?.payload).toMatchObject({
        type: 'props',
        id: 2,
        path: ['foo', 'bar'],
        value: 'new value',
      });
    });

    it('should send deletePath', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      bridge.deletePath('state', 2, ['deleted', 'path']);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      expect(msg?.event).toBe('deletePath');
    });

    it('should send renamePath', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      bridge.renamePath('props', 2, [], 'oldKey', 'newKey');
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      expect(msg?.event).toBe('renamePath');
      expect(msg?.payload).toMatchObject({
        oldKey: 'oldKey',
        newKey: 'newKey',
      });
    });
  });

  describe('ensureConnected', () => {
    it('should throw if not connected', async () => {
      bridge.disconnect();
      await flushPromises();

      expect(() => bridge.highlightElement(1)).toThrow('Not connected');
    });
  });
});

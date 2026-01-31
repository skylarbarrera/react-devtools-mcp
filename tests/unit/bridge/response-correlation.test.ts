/**
 * Response Correlation Tests
 *
 * Tests for proper request/response correlation matching.
 * Official React DevTools uses responseID in responses to echo back requestID.
 * We support: responseID (official) → requestID (legacy) → element ID (fallback)
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
  getParsedMessages(): Array<{ event: string; payload: Record<string, unknown> }>;
  clearSentMessages(): void;
  simulateMessage(event: string, payload?: unknown): void;
}

// Create mock instances array in hoisted scope
const mockWebSocketInstances = vi.hoisted(() => [] as MockWebSocketInstance[]);

// Mock WebSocket
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

    getParsedMessages(): Array<{ event: string; payload: Record<string, unknown> }> {
      return this.sentMessages.map((msg) => JSON.parse(msg));
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
  createNativeStylePayload,
  createElementNotFoundPayload,
  SIMPLE_TREE,
} from '../../fixtures/messages.js';

describe('Response Correlation', () => {
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

  describe('responseID matching (official pattern)', () => {
    it('should match inspectElement by responseID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const inspectPromise = bridge.inspectElement(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;
      expect(requestID).toBeGreaterThan(0);

      // Response uses responseID (official pattern)
      const response = createInspectedElementPayload(2, requestID);
      ws.simulateMessage(response.event, response.payload);

      const result = await inspectPromise;
      expect(result.type).toBe('full-data');
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should match getOwnersList by responseID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const ownersPromise = bridge.getOwnersList(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;

      // Response uses responseID (official pattern)
      const response = createOwnersListPayload(2, [
        { id: 1, displayName: 'App', type: 'function', key: null, env: null, hocDisplayNames: null },
      ], requestID);
      ws.simulateMessage(response.event, response.payload);

      const result = await ownersPromise;
      expect(result.length).toBe(1);
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should match getNativeStyle by responseID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const stylePromise = bridge.getNativeStyle(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;
      expect(msg?.event).toBe('NativeStyleEditor_measure');

      // Response uses responseID
      const response = createNativeStylePayload(2, requestID);
      ws.simulateMessage(response.event, response.payload);

      const result = await stylePromise;
      expect(result.style).toBeDefined();
      expect(result.layout).toBeDefined();
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should match viewAttributeSource by responseID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const sourcePromise = bridge.viewAttributeSource(2, ['props', 'onClick']);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;

      // Response uses responseID
      ws.simulateMessage('viewAttributeSourceResult', {
        id: 2,
        responseID: requestID,
        source: { fileName: '/src/Component.tsx', lineNumber: 10 },
      });

      const result = await sourcePromise;
      expect(result?.fileName).toBe('/src/Component.tsx');
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should match overrideContext by responseID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const contextPromise = bridge.overrideContext(2, ['theme'], 'dark');
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;

      // Response uses responseID
      ws.simulateMessage('overrideContextResult', {
        id: 2,
        responseID: requestID,
        success: true,
      });

      const result = await contextPromise;
      expect(result).toBe(true);
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should match captureScreenshot by responseID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const screenshotPromise = bridge.captureScreenshot(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;

      // Response uses responseID
      ws.simulateMessage('captureScreenshotResult', {
        id: 2,
        responseID: requestID,
        screenshot: 'data:image/png;base64,abc123',
      });

      const result = await screenshotPromise;
      expect(result).toBe('data:image/png;base64,abc123');
      expect(bridge.getPendingRequestCount()).toBe(0);
    });
  });

  describe('fallback to element ID', () => {
    it('should fall back to element ID when responseID missing for inspectElement', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const inspectPromise = bridge.inspectElement(2);
      await flushPromises();

      // Response without responseID - uses element ID fallback
      ws.simulateMessage('inspectedElement', {
        type: 'full-data',
        id: 2, // Only element ID, no responseID
        element: createInspectedElementPayload(2).payload.element,
      });

      const result = await inspectPromise;
      expect(result.type).toBe('full-data');
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should fall back to element ID when responseID missing for getOwnersList', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const ownersPromise = bridge.getOwnersList(2);
      await flushPromises();

      // Response without responseID - uses element ID fallback
      ws.simulateMessage('ownersList', {
        id: 2, // Only element ID, no responseID
        owners: [{ id: 1, displayName: 'App', type: 'function', key: null, env: null, hocDisplayNames: null }],
      });

      const result = await ownersPromise;
      expect(result.length).toBe(1);
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should fall back to element ID when responseID missing for getNativeStyle', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const stylePromise = bridge.getNativeStyle(2);
      await flushPromises();

      // Response without responseID - uses element ID fallback
      ws.simulateMessage('NativeStyleEditor_styleAndLayout', {
        id: 2, // Only element ID, no responseID
        style: { backgroundColor: '#fff' },
        layout: { x: 0, y: 0, width: 100, height: 50 },
      });

      const result = await stylePromise;
      expect(result.style).toBeDefined();
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should clean up fallback mapping after use', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      // First request
      const inspectPromise1 = bridge.inspectElement(2);
      await flushPromises();

      // Response using fallback
      ws.simulateMessage('inspectedElement', {
        type: 'full-data',
        id: 2,
        element: createInspectedElementPayload(2).payload.element,
      });

      await inspectPromise1;

      // Second request for same element should work
      const inspectPromise2 = bridge.inspectElement(2);
      await flushPromises();

      ws.simulateMessage('inspectedElement', {
        type: 'full-data',
        id: 2,
        element: createInspectedElementPayload(2).payload.element,
      });

      const result2 = await inspectPromise2;
      expect(result2.type).toBe('full-data');
    });
  });

  describe('concurrent requests', () => {
    it('should handle multiple inspectElement for same element concurrently', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      // Start two requests for the same element
      const promise1 = bridge.inspectElement(2);
      const promise2 = bridge.inspectElement(2);
      await flushPromises();

      // Get both request IDs
      const messages = ws.getParsedMessages().filter((m) => m.event === 'inspectElement');
      expect(messages.length).toBe(2);
      const requestID1 = messages[0].payload.requestID as number;
      const requestID2 = messages[1].payload.requestID as number;
      expect(requestID1).not.toBe(requestID2);

      // Respond to second request first
      ws.simulateMessage('inspectedElement', {
        type: 'full-data',
        id: 2,
        responseID: requestID2,
        element: { ...createInspectedElementPayload(2).payload.element, displayName: 'Response2' },
      });

      // Respond to first request
      ws.simulateMessage('inspectedElement', {
        type: 'full-data',
        id: 2,
        responseID: requestID1,
        element: { ...createInspectedElementPayload(2).payload.element, displayName: 'Response1' },
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Results should be matched correctly by responseID
      expect(result1.type).toBe('full-data');
      expect(result2.type).toBe('full-data');
      if (result1.type === 'full-data' && result2.type === 'full-data') {
        expect(result1.element.displayName).toBe('Response1');
        expect(result2.element.displayName).toBe('Response2');
      }
    });

    it('should handle multiple getNativeStyle concurrently', async () => {
      const ws = mockWebSocketInstances[0];

      // First, add element 3 to the tree
      ws.simulateMessage('operations', [
        1, // rendererID
        1, // rootID
        11, // stringTableSize (1 string: "Component3" = 10 chars)
        10, 67, 111, 109, 112, 111, 110, 101, 110, 116, 51, // "Component3"
        1, // TREE_OP.ADD
        3, // id
        5, // type (function)
        1, // parentID
        0, // ownerID
        1, // displayNameStringID
        0, // keyStringID
        0, // namePropStringID
      ]);
      await flushPromises();

      ws.clearSentMessages();

      // Start two requests for different elements
      const promise1 = bridge.getNativeStyle(2);
      const promise2 = bridge.getNativeStyle(3);
      await flushPromises();

      // Get both request IDs
      const messages = ws.getParsedMessages().filter((m) => m.event === 'NativeStyleEditor_measure');
      expect(messages.length).toBe(2);
      const requestID1 = messages[0].payload.requestID as number;
      const requestID2 = messages[1].payload.requestID as number;

      // Respond out of order
      ws.simulateMessage('NativeStyleEditor_styleAndLayout', {
        id: 3,
        responseID: requestID2,
        style: { color: 'blue' },
        layout: { x: 0, y: 0, width: 200, height: 100 },
      });

      ws.simulateMessage('NativeStyleEditor_styleAndLayout', {
        id: 2,
        responseID: requestID1,
        style: { color: 'red' },
        layout: { x: 0, y: 0, width: 100, height: 50 },
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.style).toEqual({ color: 'red' });
      expect(result2.style).toEqual({ color: 'blue' });
    });

    it('should handle interleaved inspect and owners requests', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const inspectPromise = bridge.inspectElement(2);
      const ownersPromise = bridge.getOwnersList(2);
      await flushPromises();

      const messages = ws.getParsedMessages();
      const inspectMsg = messages.find((m) => m.event === 'inspectElement');
      const ownersMsg = messages.find((m) => m.event === 'getOwnersList');

      const inspectRequestID = inspectMsg?.payload.requestID as number;
      const ownersRequestID = ownersMsg?.payload.requestID as number;

      // Respond to owners first, then inspect
      ws.simulateMessage('ownersList', {
        id: 2,
        responseID: ownersRequestID,
        owners: [{ id: 1, displayName: 'App', type: 'function', key: null, env: null, hocDisplayNames: null }],
      });

      ws.simulateMessage('inspectedElement', {
        type: 'full-data',
        id: 2,
        responseID: inspectRequestID,
        element: createInspectedElementPayload(2).payload.element,
      });

      const [inspectResult, ownersResult] = await Promise.all([inspectPromise, ownersPromise]);

      expect(inspectResult.type).toBe('full-data');
      expect(ownersResult.length).toBe(1);
      expect(bridge.getPendingRequestCount()).toBe(0);
    });
  });

  describe('error responses', () => {
    it('should handle not-found response with responseID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const inspectPromise = bridge.inspectElement(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;

      // Backend returns not-found with responseID
      const response = createElementNotFoundPayload(2, requestID);
      ws.simulateMessage(response.event, response.payload);

      const result = await inspectPromise;
      expect(result.type).toBe('not-found');
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('should handle error response with responseID', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const inspectPromise = bridge.inspectElement(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;

      ws.simulateMessage('inspectedElement', {
        type: 'error',
        id: 2,
        responseID: requestID,
        errorType: 'internal',
        message: 'Something went wrong',
      });

      const result = await inspectPromise;
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message).toBe('Something went wrong');
      }
    });
  });

  describe('legacy requestID support', () => {
    it('should accept requestID in response for backwards compatibility', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const inspectPromise = bridge.inspectElement(2);
      await flushPromises();

      const msg = ws.getLastParsedMessage();
      const requestID = msg?.payload.requestID as number;

      // Legacy pattern: response uses requestID instead of responseID
      ws.simulateMessage('inspectedElement', {
        type: 'full-data',
        id: 2,
        requestID, // Legacy field
        element: createInspectedElementPayload(2).payload.element,
      });

      const result = await inspectPromise;
      expect(result.type).toBe('full-data');
      expect(bridge.getPendingRequestCount()).toBe(0);
    });
  });

  describe('request ID generation', () => {
    it('should generate unique request IDs', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      // Make multiple requests and check IDs are unique
      const promises = [
        bridge.inspectElement(2),
        bridge.getOwnersList(2),
        bridge.inspectElement(2),
        bridge.getOwnersList(2),
      ];
      await flushPromises();

      const messages = ws.getParsedMessages().filter((m) =>
        m.event === 'inspectElement' || m.event === 'getOwnersList'
      );
      const requestIDs = messages.map((m) => m.payload.requestID);

      // All IDs should be unique
      const uniqueIDs = new Set(requestIDs);
      expect(uniqueIDs.size).toBe(requestIDs.length);

      // Clean up - resolve all promises
      for (const promise of promises) {
        promise.catch(() => {}); // Ignore timeouts
      }
    });

    it('should include requestID in all outgoing requests', async () => {
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      // Test various methods send requestID
      bridge.inspectElement(2).catch(() => {});
      bridge.getOwnersList(2).catch(() => {});
      bridge.getNativeStyle(2).catch(() => {});
      bridge.viewAttributeSource(2, ['props']).catch(() => {});
      bridge.overrideContext(2, ['path'], 'value').catch(() => {});
      bridge.captureScreenshot(2).catch(() => {});
      bridge.saveToClipboard('test').catch(() => {});
      await flushPromises();

      const requestMessages = ws.getParsedMessages().filter((m) =>
        ['inspectElement', 'getOwnersList', 'NativeStyleEditor_measure',
          'viewAttributeSource', 'overrideContext', 'captureScreenshot', 'saveToClipboard'].includes(m.event)
      );

      for (const msg of requestMessages) {
        expect(msg.payload.requestID).toBeDefined();
        expect(typeof msg.payload.requestID).toBe('number');
      }
    });
  });
});

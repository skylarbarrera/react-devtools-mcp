/**
 * Tests for DevToolsBridge connection management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Define mock WebSocket interface
interface MockWebSocketInstance extends EventEmitter {
  readyState: number;
  url: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  getSentMessages(): string[];
  getLastParsedMessage(): { event: string; payload: unknown } | undefined;
  clearSentMessages(): void;
  simulateMessage(event: string, payload?: unknown): void;
  simulateAbnormalClose(): void;
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
      setImmediate(() => {
        if (this.readyState === MockWebSocket.OPEN) {
          this.emit('open');
        }
      });
    }

    send(data: string): void {
      if (this.readyState !== MockWebSocket.OPEN) {
        throw new Error('WebSocket is not open');
      }
      this.sentMessages.push(data);
    }

    close(code = 1000, reason = ''): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', code, Buffer.from(reason));
    }

    getSentMessages(): string[] {
      return [...this.sentMessages];
    }

    getLastParsedMessage(): { event: string; payload: unknown } | undefined {
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

    simulateAbnormalClose(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', 1006, Buffer.from('Abnormal closure'));
    }
  }

  return { WebSocket: MockWebSocket };
});

// Import after mock
import { DevToolsBridge } from '../../../src/bridge.js';
import { createMockLogger, flushPromises } from '../../setup.js';

describe('DevToolsBridge Connection', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let bridge: DevToolsBridge;

  beforeEach(() => {
    mockWebSocketInstances.length = 0;
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (bridge) {
      bridge.disconnect();
    }
  });

  describe('connect()', () => {
    it('should connect to WebSocket server', async () => {
      bridge = new DevToolsBridge({
        host: 'localhost',
        port: 8097,
        logger: mockLogger.logger,
      });

      const status = await bridge.connect();

      expect(mockWebSocketInstances.length).toBe(1);
      expect(mockWebSocketInstances[0].url).toBe('ws://localhost:8097');
      expect(status.state).toBe('connected');
      expect(bridge.isConnected()).toBe(true);
    });

    it('should emit connected event', async () => {
      bridge = new DevToolsBridge({ logger: mockLogger.logger });

      const connectedHandler = vi.fn();
      bridge.on('connected', connectedHandler);

      await bridge.connect();

      expect(connectedHandler).toHaveBeenCalled();
    });

    it('should send bridge handshake on connect', async () => {
      bridge = new DevToolsBridge({ logger: mockLogger.logger });
      await bridge.connect();

      const ws = mockWebSocketInstances[0] as { getSentMessages(): string[] };
      const messages = ws.getSentMessages().map((m: string) => JSON.parse(m));
      const bridgeMsg = messages.find((m: { event: string }) => m.event === 'bridge');
      expect(bridgeMsg).toBeDefined();
      expect(bridgeMsg?.payload).toEqual({ version: 2 });
    });

    it('should deduplicate concurrent connect calls', async () => {
      bridge = new DevToolsBridge({ logger: mockLogger.logger });

      const promises = [
        bridge.connect(),
        bridge.connect(),
        bridge.connect(),
      ];

      await Promise.all(promises);

      expect(mockWebSocketInstances.length).toBe(1);
    });

    it('should return existing status if already connected', async () => {
      bridge = new DevToolsBridge({ logger: mockLogger.logger });

      await bridge.connect();
      const ws = mockWebSocketInstances[0];
      ws.clearSentMessages();

      const status = await bridge.connect();
      expect(status.state).toBe('connected');
      expect(mockWebSocketInstances.length).toBe(1);
      expect(ws.getSentMessages().length).toBe(0);
    });
  });

  describe('disconnect()', () => {
    it('should disconnect and update state', async () => {
      bridge = new DevToolsBridge({ logger: mockLogger.logger });
      await bridge.connect();

      bridge.disconnect();

      expect(bridge.isConnected()).toBe(false);
      expect(bridge.getStatus().state).toBe('disconnected');
    });

    it('should emit disconnected event', async () => {
      bridge = new DevToolsBridge({ logger: mockLogger.logger });
      await bridge.connect();

      const disconnectedHandler = vi.fn();
      bridge.on('disconnected', disconnectedHandler);

      bridge.disconnect();
      await flushPromises();

      expect(disconnectedHandler).toHaveBeenCalled();
    });
  });

  describe('getStatus()', () => {
    it('should return disconnected status initially', () => {
      bridge = new DevToolsBridge({ logger: mockLogger.logger });

      const status = bridge.getStatus();
      expect(status.state).toBe('disconnected');
      expect(status.rendererCount).toBe(0);
      expect(status.reactVersion).toBeNull();
    });

    it('should include renderer info after connection', async () => {
      bridge = new DevToolsBridge({ logger: mockLogger.logger });
      await bridge.connect();

      const ws = mockWebSocketInstances[0];
      ws.simulateMessage('renderer', {
        id: 1,
        rendererPackageName: 'react-dom',
        rendererVersion: '18.2.0',
      });
      await flushPromises();

      const status = bridge.getStatus();
      expect(status.rendererCount).toBe(1);
    });
  });
});

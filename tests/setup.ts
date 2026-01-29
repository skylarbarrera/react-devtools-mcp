/**
 * Test setup and utilities
 */

import { EventEmitter } from 'events';
import { vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// MOCK WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

export const MOCK_WS_OPEN = 1;
export const MOCK_WS_CLOSED = 3;

export class MockWebSocket extends EventEmitter {
  readyState: number = MOCK_WS_OPEN;
  url: string;

  private closeCode = 1000;
  private closeReason = '';
  private sentMessages: string[] = [];

  constructor(url: string) {
    super();
    this.url = url;

    // Auto-emit open event on next tick
    setImmediate(() => {
      if (this.readyState === MOCK_WS_OPEN) {
        this.emit('open');
      }
    });
  }

  send(data: string): void {
    if (this.readyState !== MOCK_WS_OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MOCK_WS_CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }

  // Test helpers
  getSentMessages(): string[] {
    return [...this.sentMessages];
  }

  getLastMessage(): string | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  getLastParsedMessage(): { event: string; payload: unknown } | undefined {
    const msg = this.getLastMessage();
    return msg ? JSON.parse(msg) : undefined;
  }

  clearSentMessages(): void {
    this.sentMessages = [];
  }

  // Simulate incoming message
  simulateMessage(event: string, payload?: unknown): void {
    const data = JSON.stringify({ event, payload });
    this.emit('message', Buffer.from(data));
  }

  // Simulate error
  simulateError(message: string): void {
    this.emit('error', new Error(message));
  }

  // Simulate abnormal close
  simulateAbnormalClose(): void {
    this.readyState = MOCK_WS_CLOSED;
    this.emit('close', 1006, Buffer.from('Abnormal closure'));
  }
}

// Factory that tracks all created instances
export class MockWebSocketFactory {
  instances: MockWebSocket[] = [];

  create(url: string): MockWebSocket {
    const ws = new MockWebSocket(url);
    this.instances.push(ws);
    return ws;
  }

  getLatest(): MockWebSocket | undefined {
    return this.instances[this.instances.length - 1];
  }

  getAll(): MockWebSocket[] {
    return [...this.instances];
  }

  clear(): void {
    this.instances = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK LOGGER
// ═══════════════════════════════════════════════════════════════════════════

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

export function createMockLogger() {
  const logs: LogEntry[] = [];

  const logger = {
    debug: vi.fn((msg: string, meta?: Record<string, unknown>) => {
      logs.push({ level: 'debug', message: msg, meta });
    }),
    info: vi.fn((msg: string, meta?: Record<string, unknown>) => {
      logs.push({ level: 'info', message: msg, meta });
    }),
    warn: vi.fn((msg: string, meta?: Record<string, unknown>) => {
      logs.push({ level: 'warn', message: msg, meta });
    }),
    error: vi.fn((msg: string, meta?: Record<string, unknown>) => {
      logs.push({ level: 'error', message: msg, meta });
    }),
    child: vi.fn(() => logger),
  };

  return {
    logger,
    logs,
    clear: () => {
      logs.length = 0;
      vi.clearAllMocks();
    },
    hasLog: (level: LogEntry['level'], messageIncludes: string) =>
      logs.some((l) => l.level === level && l.message.includes(messageIncludes)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wait for a number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 10
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timeout');
    }
    await wait(interval);
  }
}

/**
 * Flush all pending promises
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Create a deferred promise for testing async flows
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Error Types
 *
 * Typed error classes for DevTools bridge operations.
 */

import type { ErrorCode } from './types.js';

/**
 * Base error class for all DevTools errors
 */
export class DevToolsError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DevToolsError';
    // Maintains proper stack trace in V8
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Connection-related errors
 */
export class ConnectionError extends DevToolsError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NOT_CONNECTED', details);
    this.name = 'ConnectionError';
  }
}

/**
 * Request timeout errors
 */
export class TimeoutError extends DevToolsError {
  constructor(operation: string, timeout: number, details?: Record<string, unknown>) {
    super(`Request timeout after ${timeout}ms: ${operation}`, 'TIMEOUT', {
      operation,
      timeout,
      ...details,
    });
    this.name = 'TimeoutError';
  }
}

/**
 * Element not found errors
 */
export class ElementNotFoundError extends DevToolsError {
  constructor(elementId: number, details?: Record<string, unknown>) {
    super(`Element not found: ${elementId}`, 'ELEMENT_NOT_FOUND', {
      elementId,
      ...details,
    });
    this.name = 'ElementNotFoundError';
  }
}

/**
 * Protocol/parsing errors
 */
export class ProtocolError extends DevToolsError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INTERNAL_ERROR', details);
    this.name = 'ProtocolError';
  }
}

/**
 * Validation errors for invalid inputs
 */
export class ValidationError extends DevToolsError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SERIALIZATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * Operation not supported/editable
 */
export class NotEditableError extends DevToolsError {
  constructor(operation: string, elementId: number, details?: Record<string, unknown>) {
    super(`Cannot ${operation} on element ${elementId}`, 'NOT_EDITABLE', {
      operation,
      elementId,
      ...details,
    });
    this.name = 'NotEditableError';
  }
}

/**
 * Logging Infrastructure
 *
 * Configurable structured logging for DevTools bridge and MCP server.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  prefix?: string;
  meta?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(prefix: string): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
  output?: (entry: LogEntry) => void;
}

/**
 * Default output function - writes to stderr in structured format
 */
function defaultOutput(entry: LogEntry): void {
  const timestamp = new Date(entry.timestamp).toISOString();
  const prefix = entry.prefix ? `[${entry.prefix}]` : '';
  const level = entry.level.toUpperCase().padEnd(5);
  const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';

  // Write to stderr so it doesn't interfere with MCP stdio
  console.error(`${timestamp} ${level} ${prefix} ${entry.message}${meta}`);
}

/**
 * Create a logger instance
 */
export function createLogger(options: Partial<LoggerOptions> = {}): Logger {
  const level = options.level ?? 'warn';
  const prefix = options.prefix;
  const output = options.output ?? defaultOutput;
  const minLevel = LOG_LEVELS[level];

  const log = (logLevel: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (LOG_LEVELS[logLevel] < minLevel) return;

    output({
      level: logLevel,
      message,
      timestamp: Date.now(),
      prefix,
      meta,
    });
  };

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    child: (childPrefix: string) =>
      createLogger({
        level,
        prefix: prefix ? `${prefix}:${childPrefix}` : childPrefix,
        output,
      }),
  };
}

/**
 * No-op logger for testing or when logging disabled
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

/**
 * Get log level from environment
 */
export function getLogLevelFromEnv(): LogLevel {
  const envLevel = process.env.DEVTOOLS_LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  return process.env.DEVTOOLS_DEBUG === 'true' ? 'debug' : 'warn';
}

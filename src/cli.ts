/**
 * React DevTools MCP Server - CLI Entry Point
 *
 * Starts the MCP server that exposes React DevTools functionality.
 *
 * Usage:
 *   npx react-devtools-mcp
 *
 * Environment Variables:
 *   DEVTOOLS_HOST - Host to connect to (default: localhost)
 *   DEVTOOLS_PORT - Port for DevTools WebSocket (default: 8097)
 *   DEVTOOLS_TIMEOUT - Connection timeout in ms (default: 5000)
 *   DEVTOOLS_AUTO_CONNECT - Auto-connect on start (default: true)
 *   DEVTOOLS_LOG_LEVEL - Log level: debug, info, warn, error, silent (default: warn)
 *   DEVTOOLS_DEBUG - Enable debug logging (default: false)
 */

import { createServer } from './server.js';
import { createLogger, getLogLevelFromEnv } from './logger.js';

async function main() {
  const logger = createLogger({
    level: getLogLevelFromEnv(),
    prefix: 'cli',
  });

  logger.info('Starting React DevTools MCP Server...');

  const { bridge, start } = createServer({
    host: process.env.DEVTOOLS_HOST,
    port: process.env.DEVTOOLS_PORT ? Number(process.env.DEVTOOLS_PORT) : undefined,
    autoConnect: process.env.DEVTOOLS_AUTO_CONNECT !== 'false',
    logger,
  });

  // Log bridge events
  bridge.on('connected', () => {
    logger.info('Connected to DevTools backend');
  });

  bridge.on('disconnected', ({ code, reason }: { code: number; reason: string }) => {
    logger.info('Disconnected from DevTools backend', { code, reason });
  });

  bridge.on('reconnecting', ({ attempt, delay }: { attempt: number; delay: number }) => {
    logger.info('Reconnecting to DevTools backend', { attempt, delay });
  });

  bridge.on('reconnectFailed', ({ attempts }: { attempts: number }) => {
    logger.error('Failed to reconnect after max attempts', { attempts });
  });

  bridge.on('renderer', (info: { id: number; rendererVersion: string }) => {
    logger.info('Renderer attached', { id: info.id, version: info.rendererVersion });
  });

  bridge.on('parseError', ({ error }: { error: string }) => {
    logger.error('Protocol parse error', { error });
  });

  // Handle shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    bridge.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await start();
    logger.info('Server started successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to start server', { error: message });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

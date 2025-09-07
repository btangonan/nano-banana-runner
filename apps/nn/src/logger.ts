import pino from 'pino';
import { env } from './config/env.js';
import { randomBytes } from 'node:crypto';

// Generate request ID for tracing
export function generateRequestId(): string {
  return randomBytes(8).toString('hex');
}

// Create base logger configuration
const baseConfig: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: () => ({}), // Remove default bindings (pid, hostname)
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    // Never log sensitive data
    req: (req: any) => ({
      method: req.method,
      url: req.url,
      // Never log authorization headers
      headers: Object.fromEntries(
        Object.entries(req.headers || {}).filter(
          ([key]) => !key.toLowerCase().includes('auth')
        )
      ),
    }),
  },
};

// Development pretty printing
const devTransport = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    messageFormat: '{msg} {requestId}',
  },
};

// Production JSON logging
const prodConfig: pino.LoggerOptions = {
  ...baseConfig,
  redact: {
    paths: [
      'authorization',
      'password',
      'secret',
      'token',
      'apiKey',
      'api_key',
      'GEMINI_API_KEY',
      'GOOGLE_CLOUD_PROJECT',
    ],
    remove: true,
  },
};

// Create the logger instance
export const logger = pino(
  env.NODE_ENV === 'production' ? prodConfig : baseConfig,
  env.NODE_ENV === 'development' ? pino.transport(devTransport) : undefined
);

// Create child logger with context
export function createLogger(context: Record<string, any> = {}): pino.Logger {
  return logger.child({
    requestId: generateRequestId(),
    ...context,
  });
}

// Convenience logger for operations
export function createOperationLogger(
  operation: string,
  metadata?: Record<string, any>
): pino.Logger {
  return createLogger({
    operation,
    ...metadata,
  });
}

// Log operation timing
export function logTiming(
  log: pino.Logger,
  operation: string,
  startTime: number
): void {
  const duration = Date.now() - startTime;
  log.info({ duration, operation }, `${operation} completed in ${duration}ms`);
}

// Safe error logging (never expose secrets)
export function logError(
  log: pino.Logger,
  error: unknown,
  context?: string
): void {
  if (error instanceof Error) {
    // Sanitize error message
    const sanitized = error.message
      .replace(/apikey=[\w-]+/gi, 'apikey=***')
      .replace(/token=[\w-]+/gi, 'token=***')
      .replace(/Bearer [\w-]+/gi, 'Bearer ***');
    
    log.error(
      {
        err: {
          ...error,
          message: sanitized,
        },
        context,
      },
      sanitized
    );
  } else {
    log.error({ error: String(error), context }, 'Unknown error');
  }
}

// Export convenience methods
export default logger;
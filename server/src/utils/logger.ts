export interface LogContext {
  requestId?: string;
  route?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

type LogLevel = 'info' | 'warn' | 'error';

const basePayload = (level: LogLevel, message: string, context: LogContext = {}) => ({
  timestamp: new Date().toISOString(),
  level,
  message,
  ...(context.requestId ? { requestId: context.requestId } : {}),
  ...(context.route ? { route: context.route } : {}),
  ...(context.userId ? { userId: context.userId } : {}),
  ...(context.metadata || {}),
});

export function logInfo(message: string, context?: LogContext): void {
  console.log(JSON.stringify(basePayload('info', message, context)));
}

export function logWarn(message: string, context?: LogContext): void {
  console.warn(JSON.stringify(basePayload('warn', message, context)));
}

export function logError(message: string, error: unknown, context?: LogContext): void {
  const errorPayload =
    error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : { errorMessage: String(error) };

  console.error(
    JSON.stringify({
      ...basePayload('error', message, context),
      ...errorPayload,
    }),
  );
}

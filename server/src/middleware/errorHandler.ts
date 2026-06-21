/**
 * Global error handling middleware for Express.
 */
import { Request, Response, NextFunction } from 'express';
import { NotFoundError, ObjectIdError, IncorrectPermissionsError } from '../utils/errors';
import { sanitizeErrorForLog } from '../utils/logSanitizer';
import { requiresDeployedRuntimeSecurity } from '../utils/environment';

const clientErrorStatus = (error: Error): number | null => {
  const status = (error as any).status ?? (error as any).statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return status;
  }

  return null;
};

const publicClientErrorMessage = (status: number): string => {
  if (status === 400) return 'Bad request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not found';
  if (status === 409) return 'Conflict';
  return 'Request failed';
};

/**
 * Global error handler middleware
 * This should be added LAST in your middleware chain
 */
export const errorHandler = (error: Error, req: Request, res: Response, next: NextFunction) => {
  const sanitizedError = sanitizeErrorForLog(error);
  console.error('Error:', sanitizedError.message);
  if (!requiresDeployedRuntimeSecurity() && sanitizedError.stack) {
    console.error('Stack:', sanitizedError.stack);
  }

  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof NotFoundError) {
    return res.status(error.status).json({ error: 'Not found' });
  }

  if (error instanceof ObjectIdError) {
    return res.status(error.status).json({ error: 'Not found' });
  }

  if (error instanceof IncorrectPermissionsError) {
    return res.status(error.status).json({
      error: 'Incorrect permissions',
      incorrectPermissions: true,
    });
  }

  const status = clientErrorStatus(error);
  if (status !== null) {
    return res.status(status).json({ error: publicClientErrorMessage(status) });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      details: undefined,
    });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  if (error.name === 'MongoServerError' && (error as any).code === 11000) {
    return res.status(409).json({ error: 'Duplicate key error' });
  }

  if (error.name === 'MongoNotConnectedError') {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  res.status(500).json({
    error: 'Internal server error',
    message: undefined,
  });
};

/**
 * 404 Not Found handler
 * This should be added after all routes but before errorHandler
 */
export const notFoundHandler = (req: Request, res: Response, _next: NextFunction) => {
  res.status(404).json({
    error: 'Not found',
  });
};

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors and pass to error handler
 * Usage: router.get('/', asyncHandler(async (req, res) => {...}))
 */
type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (fn: AsyncRequestHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

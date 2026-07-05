/**
 * Global error handling middleware for Express.
 */
import { Request, Response, NextFunction } from 'express';
import { NotFoundError, ObjectIdError, IncorrectPermissionsError } from '../utils/errors';
import { captureServerError } from '../utils/errorTracking';

type ErrorResponse = {
  status: number;
  body: Record<string, unknown>;
};

const getErrorResponse = (error: Error): ErrorResponse => {
  if (error instanceof NotFoundError) {
    return { status: error.status, body: { error: error.message } };
  }

  if (error instanceof ObjectIdError) {
    return { status: error.status, body: { error: error.message } };
  }

  if (error instanceof IncorrectPermissionsError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        incorrectPermissions: true,
      },
    };
  }

  if (error.name === 'ValidationError') {
    return {
      status: 400,
      body: {
        error: 'Validation error',
        details: error.message,
      },
    };
  }

  if (error.name === 'CastError') {
    return { status: 400, body: { error: 'Invalid ID format' } };
  }

  if (error.name === 'MongoServerError' && (error as any).code === 11000) {
    return { status: 409, body: { error: 'Duplicate key error' } };
  }

  return {
    status: 500,
    body: {
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    },
  };
};

/**
 * Global error handler middleware
 * This should be added LAST in your middleware chain
 */
export const errorHandler = (error: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);

  const response = getErrorResponse(error);

  if (response.status >= 500) {
    captureServerError(error, req);
  }

  res.status(response.status).json(response.body);
};

/**
 * 404 Not Found handler
 * This should be added after all routes but before errorHandler
 */
export const notFoundHandler = (req: Request, res: Response, _next: NextFunction) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
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

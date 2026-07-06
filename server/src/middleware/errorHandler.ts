/**
 * Global error handling middleware for Express.
 */
import { Request, Response, NextFunction } from 'express';
import { NotFoundError, ObjectIdError, IncorrectPermissionsError } from '../utils/errors';

/**
 * Global error handler middleware
 * This should be added LAST in your middleware chain
 */
export const errorHandler = (error: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);

  if (error instanceof NotFoundError) {
    return res.status(error.status).json({ error: error.message });
  }

  if (error instanceof ObjectIdError) {
    return res.status(error.status).json({ error: error.message });
  }

  if (error instanceof IncorrectPermissionsError) {
    return res.status(error.status).json({
      error: error.message,
      incorrectPermissions: true,
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      details: error.message,
    });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  if (error.name === 'MongoServerError' && (error as any).code === 11000) {
    return res.status(409).json({ error: 'Duplicate key error' });
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
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

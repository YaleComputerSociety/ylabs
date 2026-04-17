/**
 * Request validation middleware using express-validator.
 */
import { Request, Response, NextFunction } from 'express';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const COMPACT_POSITIVE_INTEGER_RE = /^[1-9]\d{0,5}$/;
const MAX_VALIDATED_PAGE_SIZE = 500;

const compactPositiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!COMPACT_POSITIVE_INTEGER_RE.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * Middleware to validate MongoDB ObjectId parameters
 * Usage: validateObjectId('id') or validateObjectId() for default 'id' param
 */
export const validateObjectId = (paramName: string = 'id') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.params[paramName];

    if (!id) {
      return res.status(400).json({ error: `Missing required parameter: ${paramName}` });
    }

    if (!OBJECT_ID_RE.test(id)) {
      return res.status(400).json({ error: `Invalid ${paramName}` });
    }

    next();
  };
};

const NETID_RE = /^[A-Za-z0-9]{2,12}$/;

/**
 * Middleware to validate a Yale-style netid path parameter.
 */
export const validateNetid = (paramName: string = 'netid') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    if (!value || !NETID_RE.test(value)) {
      return res.status(400).json({ error: `Invalid ${paramName}` });
    }
    next();
  };
};

const NETID_RE = /^[A-Za-z0-9]{2,12}$/;

/**
 * Middleware to validate a Yale-style netid path parameter.
 */
export const validateNetid = (paramName: string = 'netid') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    if (!value || !NETID_RE.test(value)) {
      return res.status(400).json({ error: `Invalid ${paramName}` });
    }
    next();
  };
};

/**
 * Middleware to validate request body exists
 */
export const requireBody = (req: Request, res: Response, next: NextFunction) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: 'Request body is required' });
  }
  next();
};

/**
 * Middleware to validate specific fields exist in request body
 * Usage: requireFields(['name', 'email'])
 */
export const requireFields = (fields: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const missingFields = fields.filter(
      (field) => !Object.prototype.hasOwnProperty.call(body, field),
    );

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(', ')}`,
      });
    }

    next();
  };
};

/**
 * Middleware to validate pagination parameters
 */
export const validatePagination = (req: Request, res: Response, next: NextFunction) => {
  const { page, pageSize } = req.query;

  if (page !== undefined && compactPositiveInteger(page) === undefined) {
    return res.status(400).json({ error: 'Invalid page number (must be >= 1)' });
  }

  const parsedPageSize = pageSize === undefined ? undefined : compactPositiveInteger(pageSize);
  if (
    pageSize !== undefined &&
    (parsedPageSize === undefined || parsedPageSize > MAX_VALIDATED_PAGE_SIZE)
  ) {
    return res.status(400).json({ error: 'Invalid page size (must be between 1 and 500)' });
  }

  next();
};

/**
 * Middleware to validate sort parameters
 */
export const validateSort = (allowedFields: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { sortBy, sortOrder } = req.query;

    if (sortBy && !allowedFields.includes(sortBy as string)) {
      return res.status(400).json({
        error: `Invalid sortBy field. Allowed: ${allowedFields.join(', ')}`,
      });
    }

    if (sortOrder && sortOrder !== '1' && sortOrder !== '-1') {
      return res.status(400).json({
        error: 'Invalid sortOrder. Must be "1" (ascending) or "-1" (descending)',
      });
    }

    next();
  };
};

/**
 * Middleware to validate query string parameters
 */
export const validateQuery = (allowedParams: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const queryParams = Object.keys(req.query);
    const invalidParams = queryParams.filter((param) => !allowedParams.includes(param));

    if (invalidParams.length > 0) {
      return res.status(400).json({
        error: 'Invalid query parameters',
      });
    }

    next();
  };
};

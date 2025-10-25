import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

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
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: `Invalid ${paramName}: ${id}` });
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
    const missingFields = fields.filter(field => !(field in req.body));
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: `Missing required fields: ${missingFields.join(', ')}` 
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
  
  if (page && (isNaN(Number(page)) || Number(page) < 1)) {
    return res.status(400).json({ error: 'Invalid page number (must be >= 1)' });
  }
  
  if (pageSize && (isNaN(Number(pageSize)) || Number(pageSize) < 1 || Number(pageSize) > 100)) {
    return res.status(400).json({ error: 'Invalid page size (must be between 1 and 100)' });
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
        error: `Invalid sortBy field. Allowed: ${allowedFields.join(', ')}` 
      });
    }
    
    if (sortOrder && sortOrder !== '1' && sortOrder !== '-1') {
      return res.status(400).json({ 
        error: 'Invalid sortOrder. Must be "1" (ascending) or "-1" (descending)' 
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
    const invalidParams = queryParams.filter(param => !allowedParams.includes(param));
    
    if (invalidParams.length > 0) {
      return res.status(400).json({ 
        error: `Invalid query parameters: ${invalidParams.join(', ')}` 
      });
    }
    
    next();
  };
};
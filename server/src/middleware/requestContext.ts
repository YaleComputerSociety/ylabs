import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const REQUEST_ID_SYMBOL = Symbol.for('ylabs.requestId');

export const requestIdFrom = (req: Request): string | undefined =>
  (req as unknown as Record<symbol, string | undefined>)[REQUEST_ID_SYMBOL];

const headerValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const requestId = headerValue(req.headers['x-request-id'])?.trim() || randomUUID();
  (req as unknown as Record<symbol, string>)[REQUEST_ID_SYMBOL] = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
};

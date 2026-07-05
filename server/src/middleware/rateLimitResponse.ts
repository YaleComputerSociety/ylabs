/**
 * Shared JSON response for express-rate-limit blocks.
 */
import express from 'express';

export const getRetryAfterSeconds = (req: express.Request): number | undefined => {
  const rateLimit = (req as express.Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
  if (!rateLimit?.resetTime) return undefined;

  return Math.max(1, Math.ceil((rateLimit.resetTime.getTime() - Date.now()) / 1000));
};

export const createRateLimitHandler = (message: string): express.RequestHandler => (req, res) => {
  const retryAfterSeconds = getRetryAfterSeconds(req);
  if (retryAfterSeconds) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
  }

  res.status(429).json({
    error: message,
    code: 'RATE_LIMITED',
    retryAfterSeconds,
  });
};

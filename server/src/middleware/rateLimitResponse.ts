import { Request, Response } from 'express';

const retryAfterSeconds = (req: Request): number | undefined => {
  const resetTime = (req as any).rateLimit?.resetTime;
  if (!(resetTime instanceof Date)) return undefined;
  return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
};

export const createRateLimitHandler =
  (message: string) => (req: Request, res: Response) => {
    const retryAfter = retryAfterSeconds(req);
    if (retryAfter) res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: message,
      code: 'RATE_LIMITED',
      retryAfterSeconds: retryAfter,
    });
  };

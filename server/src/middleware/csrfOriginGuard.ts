import type { NextFunction, Request, Response } from 'express';
import { allowsNonProductionSecurityBypass, isProduction } from '../utils/environment';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const originFromUrl = (value: string | undefined): string => {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

export function isTrustedUnsafeRequestOrigin(args: {
  method: string;
  origin?: string;
  referer?: string;
  allowedOrigins: Set<string>;
  production: boolean;
  allowUnsafeOriginBypass?: boolean;
}): boolean {
  if (SAFE_METHODS.has(args.method.toUpperCase())) return true;
  const allowUnsafeOriginBypass = args.allowUnsafeOriginBypass ?? !args.production;
  if (allowUnsafeOriginBypass) return true;

  const origin = originFromUrl(args.origin);
  if (origin) return args.allowedOrigins.has(origin);

  const refererOrigin = originFromUrl(args.referer);
  if (refererOrigin) return args.allowedOrigins.has(refererOrigin);

  return false;
}

export function csrfOriginGuard(
  allowedOrigins: Set<string>,
  options: { allowUnsafeOriginBypass?: boolean } = {},
) {
  const allowUnsafeOriginBypass =
    options.allowUnsafeOriginBypass ?? allowsNonProductionSecurityBypass();

  return (req: Request, res: Response, next: NextFunction) => {
    if (
      isTrustedUnsafeRequestOrigin({
        method: req.method,
        origin: req.get('origin'),
        referer: req.get('referer'),
        allowedOrigins,
        production: isProduction(),
        allowUnsafeOriginBypass,
      })
    ) {
      return next();
    }

    return res.status(403).json({ error: 'Cross-site request blocked' });
  };
}

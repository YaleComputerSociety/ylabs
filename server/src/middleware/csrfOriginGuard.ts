import type { NextFunction, Request, Response } from 'express';
import { allowsNonProductionSecurityBypass, isProduction } from '../utils/environment';
import { isAsciiControlCode } from '../utils/asciiControl';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_CSRF_ORIGIN_HEADER_LENGTH = 2048;

const originFromUrl = (value: string | undefined): string => {
  if (!value) return '';
  if (value.length > MAX_CSRF_ORIGIN_HEADER_LENGTH) return '';
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return isAsciiControlCode(code) || code === 0x20 || character === '\\';
    })
  )
    return '';
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
};

export function isTrustedUnsafeRequestOrigin(args: {
  method: string;
  path?: string;
  origin?: string;
  referer?: string;
  allowedOrigins: Set<string>;
  production: boolean;
  allowUnsafeOriginBypass?: boolean;
  writeLikeSafeMethodPaths?: ReadonlySet<string>;
}): boolean {
  const method = args.method.toUpperCase();
  const isWriteLikeSafeMethodPath =
    SAFE_METHODS.has(method) && Boolean(args.path && args.writeLikeSafeMethodPaths?.has(args.path));
  if (SAFE_METHODS.has(method) && !isWriteLikeSafeMethodPath) return true;

  const allowUnsafeOriginBypass = args.allowUnsafeOriginBypass ?? !args.production;
  if (allowUnsafeOriginBypass) return true;

  if (args.origin !== undefined) {
    const origin = originFromUrl(args.origin);
    return Boolean(origin && args.allowedOrigins.has(origin));
  }

  const refererOrigin = originFromUrl(args.referer);
  if (refererOrigin) return args.allowedOrigins.has(refererOrigin);

  return false;
}

export function csrfOriginGuard(
  allowedOrigins: Set<string>,
  options: {
    allowUnsafeOriginBypass?: boolean;
    writeLikeSafeMethodPaths?: ReadonlySet<string>;
  } = {},
) {
  const allowUnsafeOriginBypass =
    options.allowUnsafeOriginBypass ?? allowsNonProductionSecurityBypass();

  return (req: Request, res: Response, next: NextFunction) => {
    if (
      isTrustedUnsafeRequestOrigin({
        method: req.method,
        path: req.path,
        origin: req.get('origin'),
        referer: req.get('referer'),
        allowedOrigins,
        production: isProduction(),
        allowUnsafeOriginBypass,
        writeLikeSafeMethodPaths: options.writeLikeSafeMethodPaths,
      })
    ) {
      return next();
    }

    return res.status(403).json({ error: 'Cross-site request blocked' });
  };
}

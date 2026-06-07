import { Request, Response, NextFunction } from 'express';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isUnsafeMongoKey = (key: string): boolean =>
  key.startsWith('$') || key.includes('.') || PROTOTYPE_POLLUTION_KEYS.has(key);

const scrub = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scrub);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (isUnsafeMongoKey(key)) continue;
    out[key] = scrub(val);
  }
  return out;
};

export const sanitizeMongo = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    req.body = scrub(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    const cleaned = scrub(req.query) as Record<string, unknown>;
    for (const key of Object.keys(req.query)) {
      if (!Object.prototype.hasOwnProperty.call(cleaned, key)) delete (req.query as any)[key];
    }
    for (const [k, v] of Object.entries(cleaned)) {
      (req.query as any)[k] = v;
    }
  }
  next();
};

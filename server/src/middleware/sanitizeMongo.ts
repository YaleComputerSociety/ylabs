import { Request, Response, NextFunction } from 'express';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_SANITIZE_DEPTH = 32;
const MAX_SANITIZE_ARRAY_ITEMS = 200;
const MAX_SANITIZE_OBJECT_KEYS = 200;

const isUnsafeMongoKey = (key: string): boolean =>
  key.startsWith('$') ||
  key.includes('.') ||
  key.includes('[') ||
  key.includes(']') ||
  PROTOTYPE_POLLUTION_KEYS.has(key);

const hasUnsafeMongoShape = (value: unknown, depth = 0): boolean => {
  if (depth > MAX_SANITIZE_DEPTH) return true;
  if (Array.isArray(value)) {
    if (value.length > MAX_SANITIZE_ARRAY_ITEMS) return true;
    return value.some((item) => hasUnsafeMongoShape(item, depth + 1));
  }
  if (!isPlainObject(value)) return false;

  const keys = Object.keys(value);
  if (keys.length > MAX_SANITIZE_OBJECT_KEYS) return true;
  return keys.some((key) => isUnsafeMongoKey(key) || hasUnsafeMongoShape(value[key], depth + 1));
};

const scrub = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_SANITIZE_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SANITIZE_ARRAY_ITEMS).map((item) => scrub(item, depth + 1));
  }
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, MAX_SANITIZE_OBJECT_KEYS)) {
    if (isUnsafeMongoKey(key)) continue;
    const val = value[key];
    const cleaned = scrub(val, depth + 1);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
};

export const sanitizeMongo = (req: Request, res: Response, next: NextFunction) => {
  if (hasUnsafeMongoShape(req.body) || hasUnsafeMongoShape(req.query)) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

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

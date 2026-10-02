import type { Request } from 'express';

// Express 5 types every route param as `string | string[]` because a `*name`
// wildcard captures an array of segments. A named `:param` is always a single
// string, so anything else reads as the empty string and fails the caller's check.
export const routeParam = (req: Pick<Request, 'params'>, name: string): string => {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
};

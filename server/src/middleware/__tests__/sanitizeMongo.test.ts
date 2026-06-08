import { describe, expect, it, vi } from 'vitest';
import { sanitizeMongo } from '../sanitizeMongo';

const invokeSanitize = (req: Record<string, any>) => {
  const next = vi.fn();
  sanitizeMongo(req as any, {} as any, next);
  expect(next).toHaveBeenCalledOnce();
  return req;
};

describe('sanitizeMongo', () => {
  it('removes Mongo operator and dotted keys from request bodies and queries', () => {
    const req = invokeSanitize({
      body: {
        safe: 'value',
        $where: 'this.isAdmin === true',
        nested: {
          'profile.role': 'admin',
          name: 'Ada',
        },
      },
      query: {
        page: '1',
        '$ne': 'admin',
        'sort.field': 'createdAt',
      },
    });

    expect(req.body).toEqual({ safe: 'value', nested: { name: 'Ada' } });
    expect(req.query).toEqual({ page: '1' });
  });

  it('removes prototype pollution keys instead of assigning them to sanitized objects', () => {
    const req = invokeSanitize({
      body: JSON.parse(
        '{"profile":{"__proto__":{"isAdmin":true},"safe":"ok"},"constructor":{"prototype":{"polluted":true}}}',
      ),
      query: JSON.parse(
        '{"filters":{"prototype":{"polluted":true},"safe":"ok"},"__proto__":{"isAdmin":true}}',
      ),
    });

    expect(req.body).toEqual({ profile: { safe: 'ok' } });
    expect((req.body.profile as any).isAdmin).toBeUndefined();
    expect(req.body.constructor).toBe(Object.prototype.constructor);
    expect(req.query).toEqual({ filters: { safe: 'ok' } });
    expect((req.query.filters as any).polluted).toBeUndefined();
    expect((req.query as any).isAdmin).toBeUndefined();
  });
});

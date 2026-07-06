import { describe, expect, it, vi } from 'vitest';
import { sanitizeMongo } from '../sanitizeMongo';

const mockResponse = () => {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
};

const invokeSanitize = (req: Record<string, any>) => {
  const next = vi.fn();
  sanitizeMongo(req as any, mockResponse() as any, next);
  expect(next).toHaveBeenCalledOnce();
  return req;
};

const invokeRejected = (req: Record<string, any>) => {
  const res = mockResponse();
  const next = vi.fn();
  sanitizeMongo(req as any, res as any, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: 'Invalid request payload' });
};

describe('sanitizeMongo', () => {
  it('rejects Mongo operator and dotted keys from request bodies and queries', () => {
    invokeRejected({
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
  });

  it('rejects prototype pollution keys instead of assigning them to sanitized objects', () => {
    invokeRejected({
      body: JSON.parse(
        '{"profile":{"__proto__":{"isAdmin":true},"safe":"ok"},"constructor":{"prototype":{"polluted":true}}}',
      ),
      query: JSON.parse(
        '{"filters":{"prototype":{"polluted":true},"safe":"ok"},"__proto__":{"isAdmin":true}}',
      ),
    });
  });

  it('rejects overly deep user-controlled JSON', () => {
    let body: Record<string, any> = { value: 'too-deep' };
    for (let index = 0; index < 40; index += 1) {
      body = { nested: body };
    }

    invokeRejected({
      body: {
        safe: 'ok',
        nested: body,
      },
      query: {
        safe: 'ok',
        nested: body,
      },
    });
  });

  it('rejects oversized arrays and objects before recursive sanitization', () => {
    const bodyItems = Array.from({ length: 200 }, (_, index) => ({ value: index }));
    Object.defineProperty(bodyItems, '200', {
      get: () => {
        throw new Error('Mongo sanitizer read past the array cap');
      },
      enumerable: true,
    });

    const bodyMap: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`key${index}`, { value: index }]),
    );
    Object.defineProperty(bodyMap, 'late', {
      get: () => {
        throw new Error('Mongo sanitizer read past the object key cap');
      },
      enumerable: true,
    });

    invokeRejected({
      body: {
        bodyItems,
        bodyMap,
      },
      query: {
        items: bodyItems,
        map: bodyMap,
      },
    });
  });

  it('passes bounded safe arrays and objects through recursive sanitization', () => {
    const bodyItems = Array.from({ length: 200 }, (_, index) => ({ value: index }));
    const bodyMap: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`key${index}`, { value: index }]),
    );

    const req = invokeSanitize({
      body: {
        bodyItems,
        bodyMap,
      },
      query: {
        items: bodyItems,
        map: bodyMap,
      },
    });

    expect(req.body.bodyItems).toHaveLength(200);
    expect(Object.keys(req.body.bodyMap)).toHaveLength(200);
    expect(req.query.items).toHaveLength(200);
    expect(Object.keys(req.query.map)).toHaveLength(200);
  });
});

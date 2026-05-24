import { describe, expect, it, vi } from 'vitest';
import { requestContext, requestIdFrom } from '../requestContext';

describe('requestContext', () => {
  it('uses incoming request id and writes it to the response header', () => {
    const req = {
      headers: { 'x-request-id': 'req-existing' },
    } as any;
    const res = {
      setHeader: vi.fn(),
    } as any;
    const next = vi.fn();

    requestContext(req, res, next);

    expect(requestIdFrom(req)).toBe('req-existing');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-existing');
    expect(next).toHaveBeenCalled();
  });
});

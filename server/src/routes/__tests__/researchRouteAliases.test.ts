import { describe, expect, it } from 'vitest';
import router from '../index';

function mountedRouter(prefix: string): unknown {
  const probePath = `/${prefix}/search`;
  return (router as any).stack.find((layer: any) => layer.regexp?.test(probePath))?.handle;
}

describe('research routes', () => {
  it('mounts only the canonical /research router', () => {
    expect(mountedRouter('research')).toBeTruthy();
    expect(mountedRouter('research-groups')).toBeFalsy();
  });
});

import { describe, expect, it } from 'vitest';
import router from '../programs';

const routeByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).find((route: any) => route?.path === path);

const routeHandlerNames = (path: string): string[] =>
  routeByPath(path)?.stack.map((layer: any) => layer.handle?.name).filter(Boolean) || [];

describe('program routes', () => {
  it('uses canonical program handlers instead of exporting the fellowship router', () => {
    expect(routeHandlerNames('/search')).toContain('searchProgramsController');
    expect(routeHandlerNames('/filters')).toContain('getProgramFilterOptions');
    expect(routeHandlerNames('/:id')).toContain('getProgramById');
  });
});

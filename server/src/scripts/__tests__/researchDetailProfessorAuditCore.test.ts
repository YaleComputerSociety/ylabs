import { describe, expect, it } from 'vitest';

describe('research-detail professor audit core helpers', () => {
  it('accepts expected entity names present in the document title', async () => {
    const coreModulePath = new URL(
      '../../../../scripts/research-detail-professor-audit-core.mjs',
      import.meta.url,
    ).href;
    const { hasExpectedEntityName } = (await import(coreModulePath)) as {
      hasExpectedEntityName: (
        expectedName: string,
        bodyText: string,
        ui: { h1?: string; title?: string },
      ) => boolean;
    };

    expect(
      hasExpectedEntityName('Hugh Taylor Faculty Research', 'Hugh Taylor Lab', {
        h1: 'Hugh Taylor Lab',
        title: 'Hugh Taylor Faculty Research | Yale Research',
      }),
    ).toBe(true);
  });
});

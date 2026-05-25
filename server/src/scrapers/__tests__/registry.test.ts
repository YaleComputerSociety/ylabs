import { describe, expect, it } from 'vitest';
import { buildOrchestrator } from '../registry';

describe('scraper registry', () => {
  it('registers official program and fellowship catalog sources', () => {
    const names = buildOrchestrator().list().map((source) => source.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'official-yale-programs',
        'yale-college-fellowships-office',
      ]),
    );
  });
});

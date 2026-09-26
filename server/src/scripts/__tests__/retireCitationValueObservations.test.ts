import { describe, expect, it } from 'vitest';
import { planCitationListRewrite } from '../retireCitationValueObservations';

const withdrawn = new Set(['https://dead.example.edu/a', 'https://dead.example.edu/b']);

describe('planCitationListRewrite', () => {
  // Retiring a whole `sourceUrls` observation because one entry is dead would discard the
  // live citations it asserts alongside it, which is the same over-reach as deleting a row
  // to remove one field (#3362).
  it('keeps the live citations and names only the withdrawn ones', () => {
    expect(
      planCitationListRewrite(
        ['https://live.example.edu/x', 'https://dead.example.edu/a', 'https://live.example.edu/y'],
        withdrawn,
      ),
    ).toEqual({
      kept: ['https://live.example.edu/x', 'https://live.example.edu/y'],
      removed: ['https://dead.example.edu/a'],
    });
  });

  it('reports an empty remainder, which is the only case that supersedes the whole row', () => {
    expect(planCitationListRewrite(['https://dead.example.edu/a'], withdrawn)).toEqual({
      kept: [],
      removed: ['https://dead.example.edu/a'],
    });
  });

  it('plans nothing when the list carries no withdrawn citation', () => {
    expect(planCitationListRewrite(['https://live.example.edu/x'], withdrawn)).toBeNull();
  });

  it('plans nothing for a value that is not a list', () => {
    expect(planCitationListRewrite('https://dead.example.edu/a', withdrawn)).toBeNull();
    expect(planCitationListRewrite(undefined, withdrawn)).toBeNull();
  });

  it('ignores a non-string entry rather than carrying it through', () => {
    expect(planCitationListRewrite([42, 'https://dead.example.edu/a'], withdrawn)).toEqual({
      kept: [],
      removed: ['https://dead.example.edu/a'],
    });
  });
});

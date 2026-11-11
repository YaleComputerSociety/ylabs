import { describe, expect, it } from 'vitest';
import {
  numberedSlugCandidate,
  slugNamesPersonByFullName,
  slugWithoutRemovedLead,
} from '../directoryRemovalSlugNames';

const REMOVED = 'Quillon Varrow';
const KEPT = 'Brisa Tallent';

const reslug = (slug: string, remaining: string[] = [KEPT], removed: string = REMOVED) =>
  slugWithoutRemovedLead({ slug, removedLeadName: removed, remainingLeadNames: remaining });

describe('slugWithoutRemovedLead (#4160)', () => {
  it('strips the full name and keeps the lane prefix', () => {
    expect(reslug('dept-chem-quillon-varrow-brisa-tallent')).toBe('dept-chem-brisa-tallent');
  });

  it('strips a full name written with a middle name in the display name', () => {
    expect(reslug('research-yale-quillon-varrow-tallent-lab', [KEPT], 'Quillon J. Varrow')).toBe(
      'research-yale-tallent-lab',
    );
  });

  it('strips a surname alone when the slug carries only surnames', () => {
    expect(reslug('center-varrow-tallent')).toBe('center-tallent');
  });

  it('keeps a surname that a remaining lead shares', () => {
    expect(reslug('center-varrow-lab', ['Brisa Varrow'])).toBeUndefined();
  });

  it('strips a given name and surname that are not adjacent', () => {
    expect(reslug('quillon-optics-varrow-lab')).toBe('optics-lab');
  });

  it('renames nothing when the slug carries the removed given name but not the surname', () => {
    expect(reslug('quillon-tallent-lab')).toBeUndefined();
  });

  it('keeps a given name a remaining lead shares and strips the surname', () => {
    expect(reslug('quillon-tallent-varrow-lab', ['Quillon Tallent'])).toBe('quillon-tallent-lab');
  });

  it('falls back to the remaining surnames when stripping leaves nothing distinctive', () => {
    expect(reslug('research-yale-varrow-lab')).toBe('research-yale-tallent-lab');
    expect(reslug('dept-chem-quillon-varrow')).toBe('dept-chem-tallent');
  });

  it('keeps a remaining lead named before the removed one as the distinctive part', () => {
    expect(reslug('brisa-tallent-quillon-varrow-lab')).toBe('brisa-tallent-lab');
  });

  it('renames nothing when no lead remains or the slug names nobody removed', () => {
    expect(reslug('center-varrow-tallent', [])).toBeUndefined();
    expect(reslug('synthetic-optics-lab')).toBeUndefined();
  });
});

describe('numberedSlugCandidate', () => {
  it('numbers from two and stays inside the slug length', () => {
    expect(numberedSlugCandidate('center-tallent', 1)).toBe('center-tallent');
    expect(numberedSlugCandidate('center-tallent', 2)).toBe('center-tallent-2');
    expect(numberedSlugCandidate('a'.repeat(100), 3)).toHaveLength(100);
  });
});

describe('slugNamesPersonByFullName', () => {
  it('matches a given name and surname adjacent or apart and never either alone', () => {
    expect(slugNamesPersonByFullName('dept-chem-quillon-varrow', REMOVED)).toBe(true);
    expect(slugNamesPersonByFullName('quillon-optics-varrow-lab', REMOVED)).toBe(true);
    expect(slugNamesPersonByFullName('varrow-quillon-lab', REMOVED)).toBe(true);
    expect(slugNamesPersonByFullName('center-varrow-tallent', REMOVED)).toBe(false);
    expect(slugNamesPersonByFullName('quillon-tallent-lab', REMOVED)).toBe(false);
  });
});

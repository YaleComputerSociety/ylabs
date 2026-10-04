import { describe, expect, it } from 'vitest';
import { formatLeadHonors } from '../leadHonors';

describe('formatLeadHonors', () => {
  it('splits honors dated within five years from every other honor', () => {
    expect(
      formatLeadHonors(
        {
          leadHonors: [
            { key: 'guggenheim', label: 'Guggenheim Fellowship', year: 2024 },
            { key: 'acls', label: 'American Council of Learned Societies', year: 2015 },
            { key: 'amacad', label: 'American Academy of Arts and Sciences' },
          ],
        },
        2026,
      ),
    ).toEqual({
      recent: 'Recent fellowships & awards: Guggenheim Fellowship (2024)',
      other:
        'Fellowships & honors: American Council of Learned Societies, American Academy of Arts and Sciences',
    });
  });

  it('serves nothing for a row with no honors or unlabelled entries', () => {
    expect(formatLeadHonors({}, 2026)).toEqual({ recent: null, other: null });
    expect(formatLeadHonors({ leadHonors: [{ key: 'x', label: ' ' }] }, 2026)).toEqual({
      recent: null,
      other: null,
    });
  });
});

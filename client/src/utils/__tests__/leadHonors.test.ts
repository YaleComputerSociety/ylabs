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

  it('counts five calendar years ending with the current one as recent', () => {
    expect(
      formatLeadHonors(
        {
          leadHonors: [
            { key: 'sloan', label: 'Sloan Research Fellowship', year: 2022 },
            { key: 'fulbright', label: 'Fulbright', year: 2021 },
          ],
        },
        2026,
      ),
    ).toEqual({
      recent: 'Recent fellowships & awards: Sloan Research Fellowship (2022)',
      other: 'Fellowships & honors: Fulbright',
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

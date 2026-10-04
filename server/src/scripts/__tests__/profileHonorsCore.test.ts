import { describe, expect, it } from 'vitest';
import {
  parseProfileHonorsArgs,
  profileHonorsUrlsOf,
  readProfileHonors,
} from '../profileHonorsCore';

const HONORED = '<main><p>In 2024, she was awarded a Guggenheim Fellowship.</p></main>';
const PLAIN = '<main><p>She studies the history of maps.</p></main>';
const OWN_PAGE = 'https://history.yale.edu/people/avery-placeholder';
const LEAD_PAGE = 'https://medicine.yale.edu/profile/avery-placeholder';
const entity = (leadHonors?: unknown) => ({
  slug: 'synthetic-row',
  displayName: 'Avery Placeholder',
  sourceUrls: [OWN_PAGE],
  leads: [{ name: 'Avery Placeholder', netid: '', officialProfileUrls: [LEAD_PAGE] }],
  ...(leadHonors ? { leadHonors } : {}),
});

describe('readProfileHonors', () => {
  it('writes the honors a readable page states', async () => {
    const outcome = await readProfileHonors(entity(), async () => HONORED, 2026);
    expect(outcome).toMatchObject({ kind: 'write', sourceUrl: OWN_PAGE });
    expect(outcome.kind === 'write' && outcome.honors.map((h) => h.key)).toEqual(['guggenheim']);
  });

  it('falls through to the next page when one fails, and writes nothing when all fail', async () => {
    const second = await readProfileHonors(
      entity(),
      async (url) => {
        if (url === OWN_PAGE) throw new Error('404');
        return HONORED;
      },
      2026,
    );
    expect(second).toMatchObject({ kind: 'write', sourceUrl: LEAD_PAGE });
    const none = await readProfileHonors(
      entity(),
      async () => {
        throw new Error('timeout');
      },
      2026,
    );
    expect(none).toEqual({ kind: 'fetchFailed', attempted: 2 });
  });

  it('clears stored honors when the page now states none, and leaves an unchanged row alone', async () => {
    const stored = [
      { key: 'guggenheim', label: 'Guggenheim Fellowship', kind: 'fellowship', year: 2024 },
    ];
    expect(await readProfileHonors(entity(stored), async () => PLAIN, 2026)).toMatchObject({
      kind: 'write',
      honors: [],
    });
    expect(await readProfileHonors(entity(stored), async () => HONORED, 2026)).toMatchObject({
      kind: 'unchanged',
    });
    expect(
      await readProfileHonors(
        { ...entity(), sourceUrls: [], leads: [{ ...entity().leads[0], officialProfileUrls: [] }] },
        async () => HONORED,
        2026,
      ),
    ).toEqual({ kind: 'noProfilePage' });
  });
});

describe('profile honors helpers', () => {
  it("reads only the lead's own pages, never another person's or an off-Yale profile", () => {
    expect(profileHonorsUrlsOf(entity())).toEqual([OWN_PAGE, LEAD_PAGE]);
    expect(
      profileHonorsUrlsOf({
        ...entity(),
        sourceUrls: [
          'https://medicine.yale.edu/profile/jordan-codirector',
          'https://www.researchgate.net/profile/Avery-Placeholder',
        ],
      }),
    ).toEqual([LEAD_PAGE]);
  });

  it('reads nothing for a row whose title names no lead', async () => {
    const center = { ...entity(), displayName: 'Center for Synthetic Studies' };
    expect(profileHonorsUrlsOf(center)).toEqual([]);
    expect(await readProfileHonors(center, async () => HONORED, 2026)).toEqual({
      kind: 'noProfilePage',
    });
  });

  it('parses its arguments and refuses unknown ones', () => {
    expect(parseProfileHonorsArgs(['--apply', '--limit=5', '--slug=a,b'])).toEqual({
      apply: true,
      limit: 5,
      slugs: ['a', 'b'],
    });
    expect(() => parseProfileHonorsArgs(['--force'])).toThrow(/Unknown/);
  });
});

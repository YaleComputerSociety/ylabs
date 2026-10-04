import { describe, expect, it } from 'vitest';
import { parseProfileHonorsArgs, profilePersonName, readProfileHonors } from '../profileHonorsCore';

const HONORED = '<main><p>In 2024, she was awarded a Guggenheim Fellowship.</p></main>';
const PLAIN = '<main><p>She studies the history of maps.</p></main>';
const entity = (leadHonors?: unknown) => ({
  slug: 'synthetic-row',
  displayName: 'Avery Placeholder',
  leads: [{ name: 'Avery Placeholder', netid: '', officialProfileUrls: [] }],
  ...(leadHonors ? { leadHonors } : {}),
});

describe('readProfileHonors', () => {
  it('writes the honors a readable page states', async () => {
    const outcome = await readProfileHonors(
      entity(),
      ['https://example.yale.edu/a'],
      async () => HONORED,
      2026,
    );
    expect(outcome).toMatchObject({ kind: 'write', sourceUrl: 'https://example.yale.edu/a' });
    expect(outcome.kind === 'write' && outcome.honors.map((h) => h.key)).toEqual(['guggenheim']);
  });

  it('falls through to the next page when one fails, and writes nothing when all fail', async () => {
    const urls = ['https://example.yale.edu/a', 'https://example.yale.edu/b'];
    const second = await readProfileHonors(
      entity(),
      urls,
      async (url) => {
        if (url.endsWith('/a')) throw new Error('404');
        return HONORED;
      },
      2026,
    );
    expect(second).toMatchObject({ kind: 'write', sourceUrl: urls[1] });
    const none = await readProfileHonors(
      entity(),
      urls,
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
    expect(
      await readProfileHonors(
        entity(stored),
        ['https://example.yale.edu/a'],
        async () => PLAIN,
        2026,
      ),
    ).toMatchObject({
      kind: 'write',
      honors: [],
    });
    expect(
      await readProfileHonors(
        entity(stored),
        ['https://example.yale.edu/a'],
        async () => HONORED,
        2026,
      ),
    ).toMatchObject({
      kind: 'unchanged',
    });
    expect(await readProfileHonors(entity(), [], async () => HONORED, 2026)).toEqual({
      kind: 'noProfilePage',
    });
  });
});

describe('profile honors helpers', () => {
  it('reads the person from the lead the title names', () => {
    expect(profilePersonName(entity())).toBe('Avery Placeholder');
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

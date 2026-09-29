import { afterEach, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { Observation } from '../../models/observation';
import {
  computeContentHash,
  computePageSetTextDigest,
  computeVersionedContentHash,
  contentHashObservation,
  contentUnchanged,
  descriptionHashObservations,
  loadStoredLaneDescription,
  SOURCE_CONTENT_HASH_FIELD,
} from '../contentHashGate';

describe('computeContentHash', () => {
  it('is deterministic for identical input', () => {
    expect(computeContentHash('<html>lab</html>')).toBe(computeContentHash('<html>lab</html>'));
  });

  it('differs when content changes', () => {
    expect(computeContentHash('<html>lab a</html>')).not.toBe(
      computeContentHash('<html>lab b</html>'),
    );
  });
});

describe('computeVersionedContentHash', () => {
  const bytes = '<html>lab</html>';

  it('skips when bytes, prompt version, and model are all unchanged', () => {
    const stored = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    const fresh = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    expect(contentUnchanged(stored, fresh, false)).toBe(true);
  });

  it('re-runs when only the prompt version changes', () => {
    const stored = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    const fresh = computeVersionedContentHash(bytes, 'v2', 'gpt-5-mini');
    expect(fresh).not.toBe(stored);
    expect(contentUnchanged(stored, fresh, false)).toBe(false);
  });

  it('re-runs when only the model changes', () => {
    const stored = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    const fresh = computeVersionedContentHash(bytes, 'v1', 'gpt-4o-mini');
    expect(fresh).not.toBe(stored);
    expect(contentUnchanged(stored, fresh, false)).toBe(false);
  });

  it('force-llm bypasses even when the versioned hash matches', () => {
    const hash = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    expect(contentUnchanged(hash, hash, true)).toBe(false);
  });

  it('differs from the bytes-only hash so pre-versioning rows re-extract once', () => {
    expect(computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini')).not.toBe(
      computeContentHash(bytes),
    );
  });
});

describe('contentUnchanged', () => {
  const hash = computeContentHash('page');

  it('skips when a matching stored hash exists and not forced', () => {
    expect(contentUnchanged(hash, hash, false)).toBe(true);
  });

  it('does not skip when no prior hash was stored', () => {
    expect(contentUnchanged(undefined, hash, false)).toBe(false);
  });

  it('does not skip when the fresh hash differs', () => {
    expect(contentUnchanged(computeContentHash('old'), hash, false)).toBe(false);
  });

  it('never skips under forceLlm even when hashes match', () => {
    expect(contentUnchanged(hash, hash, true)).toBe(false);
  });
});

describe('contentHashObservation', () => {
  it('builds a bookkeeping observation carrying the entity ref and hash', () => {
    const hash = computeContentHash('page');
    const observation = contentHashObservation(
      { entityType: 'researchEntity', entityKey: 'smith-lab' },
      'https://example.edu/lab',
      hash,
    );
    expect(observation).toEqual({
      entityType: 'researchEntity',
      entityId: undefined,
      entityKey: 'smith-lab',
      field: SOURCE_CONTENT_HASH_FIELD,
      value: hash,
      sourceUrl: 'https://example.edu/lab',
    });
  });
});

describe('computePageSetTextDigest', () => {
  // The whole point: markup that churns while the readable text does not. 2,507 of the 4,123
  // rows this lane reads fetch from a host that returns different bytes on every fetch, so a
  // bytes hash could never let them skip (#3840).
  const stripMarkupText = (html: string) =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const stripMarkup = ({ html }: { html: string }) => stripMarkupText(html);

  it('is unchanged when markup churns but the extracted text does not', () => {
    const a = [{ url: 'https://lab.example.edu/', html: '<p data-nonce="a1">We study cilia.</p>' }];
    const b = [
      { url: 'https://lab.example.edu/', html: '<p data-nonce="zz9">We study cilia.</p>' },
    ];
    expect(computePageSetTextDigest(a, stripMarkup)).toBe(computePageSetTextDigest(b, stripMarkup));
  });

  it('changes when the extracted text changes', () => {
    const a = [{ url: 'https://lab.example.edu/', html: '<p>We study cilia.</p>' }];
    const b = [{ url: 'https://lab.example.edu/', html: '<p>We study membranes.</p>' }];
    expect(computePageSetTextDigest(a, stripMarkup)).not.toBe(
      computePageSetTextDigest(b, stripMarkup),
    );
  });

  // Precautionary and unmeasured, per the docblock: sub-page order varying was not observed.
  it('is unchanged when the same pages arrive in a different order', () => {
    const home = { url: 'https://lab.example.edu/', html: '<p>We study cilia.</p>' };
    const research = { url: 'https://lab.example.edu/research', html: '<p>Projects.</p>' };
    expect(computePageSetTextDigest([home, research], stripMarkup)).toBe(
      computePageSetTextDigest([research, home], stripMarkup),
    );
  });

  it('changes when a page joins or leaves the set, so a missing page is never silently skipped', () => {
    const home = { url: 'https://lab.example.edu/', html: '<p>We study cilia.</p>' };
    const research = { url: 'https://lab.example.edu/research', html: '<p>Projects.</p>' };
    expect(computePageSetTextDigest([home], stripMarkup)).not.toBe(
      computePageSetTextDigest([home, research], stripMarkup),
    );
  });

  // The regression the old raw-HTML input existed to prevent (#2022): the deterministic
  // embedded-JSON path reads script-tag prose that a visible-text extractor strips, so a digest
  // over visible text alone would let an official-prose-only change skip forever. The lane's
  // extractor therefore covers both, and this pins that a caller which omits the embedded prose
  // is measurably weaker.
  it('is unchanged by embedded prose when the extractor ignores it, which is why the lane includes it', () => {
    const withoutEmbedded = [
      {
        url: 'https://lab.example.edu/',
        html: '<p>We study cilia.</p><script>{"d":"old"}</script>',
      },
    ];
    const withEmbedded = [
      {
        url: 'https://lab.example.edu/',
        html: '<p>We study cilia.</p><script>{"d":"new"}</script>',
      },
    ];
    // A visible-text-only extractor drops script blocks entirely, as `htmlToText` does, so it
    // cannot see the change.
    const visibleTextOnly = ({ html }: { html: string }) =>
      stripMarkupText(html.replace(/<script[\s\S]*?<\/script>/g, ' '));
    expect(computePageSetTextDigest(withoutEmbedded, visibleTextOnly)).toBe(
      computePageSetTextDigest(withEmbedded, visibleTextOnly),
    );
    // An extractor that also reads the embedded payload does.
    const withEmbeddedProse = ({ html }: { html: string }) =>
      `${stripMarkupText(html)} ${html.match(/<script>(.*?)<\/script>/)?.[1] ?? ''}`;
    expect(computePageSetTextDigest(withoutEmbedded, withEmbeddedProse)).not.toBe(
      computePageSetTextDigest(withEmbedded, withEmbeddedProse),
    );
  });

  // The URL is part of each page's digest, so the same text served at two paths is two inputs.
  it('distinguishes identical text served at different urls', () => {
    const a = [{ url: 'https://lab.example.edu/a', html: '<p>Same words.</p>' }];
    const b = [{ url: 'https://lab.example.edu/b', html: '<p>Same words.</p>' }];
    expect(computePageSetTextDigest(a, stripMarkup)).not.toBe(
      computePageSetTextDigest(b, stripMarkup),
    );
  });
});

describe('descriptionHashObservations', () => {
  const hash = [
    contentHashObservation(
      { entityType: 'researchEntity', entityKey: 'smith-lab' },
      'https://example.edu/lab',
      'abc',
    ),
  ];
  const observation = (field: string, value: unknown) => ({
    entityType: 'researchEntity' as const,
    entityKey: 'smith-lab',
    sourceUrl: 'https://example.edu/lab',
    field,
    value,
  });

  it('records the hash when the run produced both description fields', () => {
    const emitted = [
      observation('fullDescription', 'The lab studies protein folding kinetics in living cells.'),
      observation('shortDescription', 'Studies protein folding kinetics.'),
    ];
    expect(descriptionHashObservations(emitted, hash)).toEqual(hash);
  });

  it('withholds the hash when a full description was produced without a card', () => {
    const emitted = [
      observation('fullDescription', 'The lab studies protein folding kinetics in living cells.'),
    ];
    expect(descriptionHashObservations(emitted, hash)).toEqual([]);
  });

  it('withholds the hash when the card is present but blank', () => {
    const emitted = [
      observation('fullDescription', 'The lab studies protein folding kinetics in living cells.'),
      observation('shortDescription', '   '),
    ];
    expect(descriptionHashObservations(emitted, hash)).toEqual([]);
  });

  it('records the hash when the run produced no description at all, so unchanged content is not re-read', () => {
    expect(descriptionHashObservations([observation('methods', ['western blot'])], hash)).toEqual(
      hash,
    );
    expect(descriptionHashObservations([], hash)).toEqual(hash);
  });

  // The open retry was unbounded, so a row whose card never succeeds paid for a page read and a
  // model call on every sweep forever: 362 rows on Development carried no stored hash at all
  // (#3840). The bound is the description rather than a counter, because an identical value is
  // diff-skipped and writes nothing, so the observation log cannot count attempts.
  const PROSE = 'The lab studies protein folding kinetics in living cells.';

  it('closes the retry when the run re-derived the same description and still produced no card', () => {
    const emitted = [observation('fullDescription', PROSE)];
    expect(descriptionHashObservations(emitted, hash, PROSE)).toEqual(hash);
  });

  it('keeps the retry open when the description changed, which is the case a card retry can fix', () => {
    const emitted = [observation('fullDescription', PROSE)];
    expect(descriptionHashObservations(emitted, hash, 'Something the lab used to say.')).toEqual(
      [],
    );
  });

  // Fail open: a lookup that cannot answer must not close a decision on the row's behalf, which
  // is the same contract `loadStoredContentHash` keeps.
  it('keeps the retry open on a first-seen description', () => {
    const emitted = [observation('fullDescription', PROSE)];
    expect(descriptionHashObservations(emitted, hash, undefined)).toEqual([]);
    expect(descriptionHashObservations(emitted, hash, '   ')).toEqual([]);
  });

  it('compares on trimmed text, so whitespace alone does not reopen a closed retry', () => {
    const emitted = [observation('fullDescription', `  ${PROSE}  `)];
    expect(descriptionHashObservations(emitted, hash, PROSE)).toEqual(hash);
  });

  it('compares against the stored form, so paragraph breaks do not keep the retry open', () => {
    const emitted = [
      observation(
        'fullDescription',
        'The lab studies protein folding kinetics.\n\nIt also studies living cells.',
      ),
    ];
    const stored = 'The lab studies protein folding kinetics. It also studies living cells.';
    expect(descriptionHashObservations(emitted, hash, stored)).toEqual(hash);
  });

  it('still records the hash when a card was produced, whatever the stored description says', () => {
    const emitted = [
      observation('fullDescription', PROSE),
      observation('shortDescription', 'Studies protein folding kinetics.'),
    ];
    expect(descriptionHashObservations(emitted, hash, 'Something else entirely.')).toEqual(hash);
  });

  it('passes an already-withheld hash through unchanged', () => {
    const emitted = [
      observation('fullDescription', 'The lab studies protein folding kinetics in living cells.'),
      observation('shortDescription', 'Studies protein folding kinetics.'),
    ];
    expect(descriptionHashObservations(emitted, [])).toEqual([]);
  });
});

describe('loadStoredLaneDescription', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers undefined instead of throwing when the lookup fails, so paid output is still emitted', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    vi.spyOn(Observation, 'findOne').mockReturnValue({
      sort: () => ({
        select: () => ({ lean: () => Promise.reject(new Error('connection reset')) }),
      }),
    } as unknown as ReturnType<typeof Observation.findOne>);

    await expect(
      loadStoredLaneDescription('lab-microsite-description-llm', {
        entityType: 'researchEntity',
        entityId: 'entity-1',
      }),
    ).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  assertResearchSearchRelevanceTarget,
  parseResearchSearchRelevanceArgs,
  surnameFromDisplayName,
} from '../researchSearchRelevance';

const developmentUrl = 'mongodb://127.0.0.1:27017/Development';

describe('parseResearchSearchRelevanceArgs', () => {
  it('defaults to a read-only sweep with both thresholds at 0.5', () => {
    expect(parseResearchSearchRelevanceArgs([])).toEqual({
      topK: 10,
      nameSamples: 4,
      minPrecisionAtK: 0.5,
      minAverageOverlap: 0.5,
      strict: false,
    });
  });

  it('accepts both spaced and inline flag forms', () => {
    expect(parseResearchSearchRelevanceArgs(['--top-k', '5', '--min-overlap=0.8'])).toMatchObject({
      topK: 5,
      minAverageOverlap: 0.8,
    });
    expect(parseResearchSearchRelevanceArgs(['--top-k=5', '--min-overlap', '0.8'])).toMatchObject({
      topK: 5,
      minAverageOverlap: 0.8,
    });
  });

  it('does not swallow the flag that follows a spaced value', () => {
    expect(
      parseResearchSearchRelevanceArgs(['--top-k', '5', '--name-samples', '2', '--strict']),
    ).toMatchObject({ topK: 5, nameSamples: 2, strict: true });
  });

  it('rejects a top-k of zero, which would make every metric vacuous', () => {
    expect(() => parseResearchSearchRelevanceArgs(['--top-k', '0'])).toThrow(/at least 1/);
  });

  it('allows zero name samples so a run can skip corpus sampling entirely', () => {
    expect(parseResearchSearchRelevanceArgs(['--name-samples', '0'])).toMatchObject({
      nameSamples: 0,
    });
  });

  it('rejects a top-k above the maximum page the harness probes', () => {
    expect(() => parseResearchSearchRelevanceArgs(['--top-k', '25'])).toThrow(/at most 24/);
  });

  it('rejects a threshold outside the unit interval', () => {
    expect(() => parseResearchSearchRelevanceArgs(['--min-precision', '1.5'])).toThrow(/ratio/);
    expect(() => parseResearchSearchRelevanceArgs(['--min-overlap', '-1'])).toThrow(/ratio/);
  });

  it('rejects a value for --strict and an unknown flag', () => {
    expect(() => parseResearchSearchRelevanceArgs(['--strict=true'])).toThrow(/does not accept/);
    expect(() => parseResearchSearchRelevanceArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('refuses an output path outside the approved temporary roots', () => {
    expect(() => parseResearchSearchRelevanceArgs(['--output', '/etc/report.json'])).toThrow(
      /must write under/,
    );
  });
});

describe('assertResearchSearchRelevanceTarget', () => {
  it('accepts Development on a local Meilisearch host', () => {
    expect(() =>
      assertResearchSearchRelevanceTarget({
        mongoUrl: developmentUrl,
        meiliHost: 'http://localhost:7700',
      }),
    ).not.toThrow();
  });

  it('defaults an absent Meilisearch host to the local one', () => {
    expect(() =>
      assertResearchSearchRelevanceTarget({ mongoUrl: developmentUrl, meiliHost: undefined }),
    ).not.toThrow();
  });

  it('refuses Beta and Production databases', () => {
    for (const database of ['Beta', 'Prod', 'Production', 'ProductionCopy']) {
      expect(() =>
        assertResearchSearchRelevanceTarget({
          mongoUrl: `mongodb+srv://user:pass@cluster.mongodb.net/${database}`,
          meiliHost: 'http://localhost:7700',
        }),
      ).toThrow(/Development database only/);
    }
  });

  it('refuses an unparseable or absent Mongo URL rather than guessing', () => {
    expect(() => assertResearchSearchRelevanceTarget({ mongoUrl: undefined })).toThrow(
      /Development database only/,
    );
    expect(() => assertResearchSearchRelevanceTarget({ mongoUrl: 'not-a-url' })).toThrow(
      /Development database only/,
    );
  });

  it('refuses a remote Meilisearch host even when Mongo is Development', () => {
    expect(() =>
      assertResearchSearchRelevanceTarget({
        mongoUrl: developmentUrl,
        meiliHost: 'https://search.example.com',
      }),
    ).toThrow(/local Meilisearch host/);
  });
});

describe('surnameFromDisplayName', () => {
  it('takes the trailing family-name token', () => {
    expect(surnameFromDisplayName('Ada Placeholder')).toBe('Placeholder');
    expect(surnameFromDisplayName('Placeholder, Ada')).toBe('Ada');
  });

  it('skips a credential or generational suffix', () => {
    expect(surnameFromDisplayName('Ada Placeholder, PhD')).toBe('Placeholder');
    expect(surnameFromDisplayName('Ada Placeholder Jr.')).toBe('Placeholder');
    expect(surnameFromDisplayName('Ada Placeholder III')).toBe('Placeholder');
  });

  it('keeps a hyphenated or apostrophed surname whole', () => {
    expect(surnameFromDisplayName('Ada Van-Placeholder')).toBe('Van-Placeholder');
    expect(surnameFromDisplayName("Ada O'Placeholder")).toBe("O'Placeholder");
  });

  it('drops a bare initial rather than returning it as a surname', () => {
    expect(surnameFromDisplayName('A. Placeholder')).toBe('Placeholder');
  });

  it('returns an empty string when there is no usable token', () => {
    expect(surnameFromDisplayName('')).toBe('');
    expect(surnameFromDisplayName('   ')).toBe('');
    expect(surnameFromDisplayName('J. R.')).toBe('');
  });
});

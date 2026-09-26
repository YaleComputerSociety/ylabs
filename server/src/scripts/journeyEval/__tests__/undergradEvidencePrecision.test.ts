import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { journeyCases, type JourneyEvalContext } from '../journeyEvalCases';
import {
  parseUndergradEvidenceJudgements,
  type UndergradEvidenceJudgement,
} from '../journeyEvalJudgements';
import {
  checkUndergradEvidenceQuoteAttribution,
  drawSeededSample,
  fingerprintPopulation,
  fingerprintQuote,
  scoreUndergradEvidenceJudgements,
  wilsonInterval,
  type CorpusFingerprint,
} from '../journeyEvalMetrics';
import { resolveUndergradSampleOutPath, writeUndergradSampleTemplate } from '../runJourneyEval';

const LANE = 'lab-microsite-undergrad-llm';
const still: CorpusFingerprint = { rowCount: 10, latestUpdatedAt: '2026-01-01T00:00:00.000Z' };
const moved: CorpusFingerprint = { rowCount: 11, latestUpdatedAt: '2026-01-02T00:00:00.000Z' };

const syntheticKeys = Array.from({ length: 40 }, (_, index) => `synthetic-row-${index}`);

describe('wilsonInterval', () => {
  it('matches the textbook interval for 18 of 50', () => {
    expect(wilsonInterval(18, 50)).toEqual({ low: 0.2414, high: 0.4986, z: 1.959964 });
  });

  it('stays inside 0..1 at the extremes', () => {
    expect(wilsonInterval(0, 10)?.low).toBe(0);
    expect(wilsonInterval(10, 10)?.high).toBe(1);
  });

  it('has no interval over an empty sample', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe('drawSeededSample', () => {
  it('draws the same rows for the same seed regardless of input order', () => {
    const forward = drawSeededSample(syntheticKeys, 'seed-a', 10);
    const reversed = drawSeededSample([...syntheticKeys].reverse(), 'seed-a', 10);

    expect(forward).toHaveLength(10);
    expect(reversed).toEqual(forward);
  });

  it('draws different rows for a different seed', () => {
    expect(drawSeededSample(syntheticKeys, 'seed-b', 10)).not.toEqual(
      drawSeededSample(syntheticKeys, 'seed-a', 10),
    );
  });

  it('keeps a drawn row drawn when an unrelated row joins the population', () => {
    const before = drawSeededSample(syntheticKeys, 'seed-a', 10);
    const after = drawSeededSample([...syntheticKeys, 'synthetic-row-new'], 'seed-a', 10);

    expect(after.filter((key) => !before.includes(key)).length).toBeLessThanOrEqual(1);
  });

  it('fingerprints a population independent of order', () => {
    expect(fingerprintPopulation(syntheticKeys)).toBe(
      fingerprintPopulation([...syntheticKeys].reverse()),
    );
  });
});

describe('fingerprintQuote', () => {
  it('ignores whitespace-only differences and nothing else', () => {
    expect(fingerprintQuote('  Undergraduates   welcome ')).toBe(
      fingerprintQuote('Undergraduates welcome'),
    );
    expect(fingerprintQuote('Undergraduates welcome')).not.toBe(
      fingerprintQuote('Undergraduates not welcome'),
    );
  });
});

describe('parseUndergradEvidenceJudgements', () => {
  const valid = {
    seed: 'seed-a',
    sampleSize: 2,
    judgements: [
      { rowKey: 'synthetic-row-0', quoteFingerprint: 'abc', verdict: 'correct' },
      { rowKey: 'synthetic-row-1', quoteFingerprint: 'def' },
    ],
  };

  it('defaults the lane and keeps an unjudged template row', () => {
    const set = parseUndergradEvidenceJudgements(valid);

    expect(set.lane).toBe(LANE);
    expect(set.judgements[1].verdict).toBeUndefined();
  });

  it('rejects a verdict outside the rubric', () => {
    expect(() =>
      parseUndergradEvidenceJudgements({
        ...valid,
        judgements: [{ rowKey: 'synthetic-row-0', quoteFingerprint: 'abc', verdict: 'fine' }],
      }),
    ).toThrow(/verdict outside/);
  });

  it('rejects a judgement with no quote fingerprint', () => {
    expect(() =>
      parseUndergradEvidenceJudgements({
        ...valid,
        judgements: [{ rowKey: 'synthetic-row-0', verdict: 'correct' }],
      }),
    ).toThrow(/quoteFingerprint/);
  });

  it('rejects a file that does not record how it was drawn', () => {
    expect(() => parseUndergradEvidenceJudgements({ ...valid, seed: '' })).toThrow(/seed/);
    expect(() => parseUndergradEvidenceJudgements({ ...valid, sampleSize: 0 })).toThrow(
      /sampleSize/,
    );
  });

  it('rejects a repeated row', () => {
    expect(() =>
      parseUndergradEvidenceJudgements({
        ...valid,
        judgements: [valid.judgements[0], valid.judgements[0]],
      }),
    ).toThrow(/repeats a rowKey/);
  });
});

describe('scoreUndergradEvidenceJudgements', () => {
  const population = syntheticKeys.map((rowKey) => ({
    rowKey,
    quoteFingerprint: fingerprintQuote(`synthetic quote for ${rowKey}`),
  }));
  const drawn = drawSeededSample(syntheticKeys, 'seed-a', 5);
  const judge = (
    rowKey: string,
    verdict: UndergradEvidenceJudgement['verdict'],
    backsHostedBadgeWording?: boolean,
  ): UndergradEvidenceJudgement => ({
    rowKey,
    quoteFingerprint: fingerprintQuote(`synthetic quote for ${rowKey}`),
    verdict,
    ...(backsHostedBadgeWording === undefined ? {} : { backsHostedBadgeWording }),
  });

  it('scores only the drawn rows and separates unverifiable from wrong', () => {
    const score = scoreUndergradEvidenceJudgements(
      population,
      [
        judge(drawn[0], 'correct', true),
        judge(drawn[1], 'correct', false),
        judge(drawn[2], 'not_grounded', false),
        judge(drawn[3], 'stale_or_unreachable'),
        judge(drawn[4], 'about_another_entity', false),
        judge(syntheticKeys.find((key) => !drawn.includes(key)) as string, 'correct'),
      ],
      'seed-a',
      5,
    );

    expect(score.drawn).toBe(5);
    expect(score.judged).toBe(5);
    expect(score.unjudged).toBe(0);
    expect(score.judgementsOutsideTheDraw).toBe(1);
    expect(score.verifiable).toBe(4);
    expect(score.correct).toBe(2);
    expect(score.badgePrecision).toBe(0.5);
    expect(score.laneGroundingJudged).toBe(3);
    expect(score.laneGroundingPrecision).toBe(0.6667);
    expect(score.verdicts.stale_or_unreachable).toBe(1);
    expect(score.badgeWordingJudged).toBe(4);
    expect(score.badgeWordingBacked).toBe(1);
  });

  it('does not let a verdict about an old quote score the current one', () => {
    const score = scoreUndergradEvidenceJudgements(
      population,
      [{ ...judge(drawn[0], 'correct'), quoteFingerprint: fingerprintQuote('an older quote') }],
      'seed-a',
      5,
    );

    expect(score.judgementForAChangedQuote).toBe(1);
    expect(score.judged).toBe(0);
    expect(score.badgePrecisionInterval).toBeNull();
  });
});

describe('checkUndergradEvidenceQuoteAttribution', () => {
  it('passes when every comparable quote names its source', () => {
    const result = checkUndergradEvidenceQuoteAttribution(
      [
        { servedVersionMatchesStored: true, storedSourceName: LANE },
        { servedVersionMatchesStored: false, storedSourceName: '' },
      ],
      still,
      still,
    );

    expect(result.status).toBe('pass');
    expect(result.detail).toMatchObject({ comparable: 1, skippedStaleIndex: 1 });
  });

  it('fails on a quote nothing attributes', () => {
    expect(
      checkUndergradEvidenceQuoteAttribution(
        [{ servedVersionMatchesStored: true, storedSourceName: '' }],
        still,
        still,
      ).status,
    ).toBe('fail');
  });

  it('is inconclusive when the corpus moved or nothing was comparable', () => {
    expect(
      checkUndergradEvidenceQuoteAttribution(
        [{ servedVersionMatchesStored: true, storedSourceName: '' }],
        still,
        moved,
      ).status,
    ).toBe('inconclusive');
    expect(checkUndergradEvidenceQuoteAttribution([], still, still).status).toBe('inconclusive');
  });
});

describe('undergrad-evidence-quote-precision case', () => {
  const precisionCase = journeyCases.find(
    (journeyCase) => journeyCase.id === 'undergrad-evidence-quote-precision',
  );
  const servedRows = syntheticKeys.map((slug, index) => ({
    slug,
    undergradEvidenceQuote: index % 4 === 0 ? '' : `synthetic quote for ${slug}`,
  }));
  const storedRows = new Map(
    servedRows.map((row, index) => [
      row.slug,
      {
        slug: row.slug,
        undergradEvidenceQuote: row.undergradEvidenceQuote,
        fieldProvenance: {
          undergradEvidenceQuote: {
            sourceName: index % 3 === 0 ? 'another-lane' : LANE,
            sourceUrl: 'https://example.org/synthetic',
          },
        },
      } as Record<string, unknown>,
    ]),
  );

  const buildContext = (overrides: Partial<JourneyEvalContext> = {}): JourneyEvalContext => ({
    browse: async ({ page = 1, pageSize = 100 }) => ({
      researchEntities: servedRows.slice((page - 1) * pageSize, page * pageSize),
      estimatedTotalHits: servedRows.length,
      degraded: false,
    }),
    topicQueryJudgements: null,
    readStoredRows: async (keys) =>
      new Map(keys.map((key) => [key, storedRows.get(key) as Record<string, unknown>])),
    readCorpusFingerprint: async () => still,
    window: 100,
    facetValuesChecked: 0,
    pagesChecked: 1,
    ...overrides,
  });

  it('is inconclusive without judgements and reports the lane population', async () => {
    const outcome = await precisionCase!.run(buildContext());

    expect(
      outcome.invariants.find(
        (result) => result.id === 'undergrad-evidence-precision-has-judgements',
      )?.status,
    ).toBe('inconclusive');
    expect(
      outcome.invariants.find((result) => result.id === 'undergrad-evidence-quote-names-its-source')
        ?.status,
    ).toBe('pass');
    const quoted = outcome.rates.find(
      (rate) => rate.id === 'served-cards-with-an-undergrad-evidence-quote',
    );
    expect(quoted).toMatchObject({ numerator: 30, denominator: 40 });
    expect(outcome.notes?.population).toBe(
      servedRows.filter((row, index) => row.undergradEvidenceQuote && index % 3 !== 0).length,
    );
  });

  it('leaves a row whose served quote differs from its stored row out of the lane population', async () => {
    const staleKey = servedRows[1].slug;
    const staleStoredRows = new Map(storedRows);
    staleStoredRows.set(staleKey, {
      ...(storedRows.get(staleKey) as Record<string, unknown>),
      undergradEvidenceQuote: 'a newer synthetic quote the index has not served yet',
    });
    let template:
      | Parameters<NonNullable<JourneyEvalContext['undergradEvidenceSampleRequest']>['write']>[0]
      | null = null;
    const outcome = await precisionCase!.run(
      buildContext({
        readStoredRows: async (keys) =>
          new Map(keys.map((key) => [key, staleStoredRows.get(key) as Record<string, unknown>])),
        undergradEvidenceSampleRequest: {
          seed: 'seed-a',
          sampleSize: syntheticKeys.length,
          write: async (sample) => {
            template = sample;
            return '/tmp/synthetic-template.json';
          },
        },
      }),
    );
    const lanePopulation = servedRows.filter(
      (row, index) => row.undergradEvidenceQuote && index % 3 !== 0,
    ).length;

    expect(outcome.notes?.skippedStaleIndex).toBe(1);
    expect(outcome.notes?.population).toBe(lanePopulation - 1);
    expect(template!.judgements.map((judgement) => judgement.rowKey)).not.toContain(staleKey);
    expect(
      outcome.rates.find((rate) => rate.id === 'undergrad-evidence-quotes-citing-a-page'),
    ).toMatchObject({ numerator: 29, denominator: 29 });
  });

  it('writes a template that scores as a precision once it carries verdicts', async () => {
    let template:
      | Parameters<NonNullable<JourneyEvalContext['undergradEvidenceSampleRequest']>['write']>[0]
      | null = null;
    await precisionCase!.run(
      buildContext({
        undergradEvidenceSampleRequest: {
          seed: 'seed-a',
          sampleSize: 4,
          write: async (sample) => {
            template = sample;
            return '/tmp/synthetic-template.json';
          },
        },
      }),
    );
    expect(template!.judgements).toHaveLength(4);

    const judged = parseUndergradEvidenceJudgements({
      ...template!,
      judgements: template!.judgements.map((judgement, index) => ({
        ...judgement,
        verdict: index === 0 ? 'not_grounded' : 'correct',
      })),
    });
    const outcome = await precisionCase!.run(buildContext({ undergradEvidenceJudgements: judged }));
    const precision = outcome.rates.find(
      (rate) => rate.id === 'undergrad-evidence-badge-precision',
    );

    expect(precision).toMatchObject({ numerator: 3, denominator: 4, rate: 0.75 });
    expect(outcome.invariants.every((result) => result.status === 'pass')).toBe(true);
  });
});

describe('undergraduate sample template file', () => {
  it('refuses to draw over a file that may already carry verdicts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'undergrad-sample-'));
    const samplePath = path.join(directory, 'judgements.json');
    const judged = JSON.stringify({
      seed: 's',
      sampleSize: 1,
      judgements: [{ verdict: 'correct' }],
    });
    fs.writeFileSync(samplePath, judged);

    expect(() => resolveUndergradSampleOutPath(samplePath)).toThrow(/already exists/);
    expect(() =>
      writeUndergradSampleTemplate(samplePath, {
        lane: LANE,
        seed: 's',
        sampleSize: 1,
        judgements: [],
      }),
    ).toThrow();
    expect(fs.readFileSync(samplePath, 'utf8')).toBe(judged);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('writes a template to a new path', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'undergrad-sample-'));
    const samplePath = resolveUndergradSampleOutPath(path.join(directory, 'judgements.json'));
    const sample = { lane: LANE, seed: 's', sampleSize: 1, judgements: [] };

    expect(writeUndergradSampleTemplate(samplePath, sample)).toBe(samplePath);
    expect(JSON.parse(fs.readFileSync(samplePath, 'utf8'))).toEqual(sample);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

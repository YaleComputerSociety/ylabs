import { describe, expect, it } from 'vitest';
import {
  MAX_ATTESTED_EMPTY_FRACTION,
  MIN_ATTESTED_EMPTY_READS,
  MIN_LANE_READ_ENTITIES_FOR_DROP_GUARD,
  planUnassertedDescriptionRefusals,
  sameCitedPage,
  type AttestedEmptyRead,
  type DescriptionRefusalRow,
} from '../refuseUnassertedDescriptionsCore';

const CITED_URL = 'https://example.edu/profile/example-person/';

const laneProvenance = (sourceUrl = CITED_URL) => ({
  fullDescription: { sourceName: 'lab-microsite-description-llm', sourceUrl },
  shortDescription: { sourceName: 'lab-microsite-description-llm', sourceUrl },
});

const row = (overrides: Partial<DescriptionRefusalRow> = {}): DescriptionRefusalRow => ({
  slug: 'fixture-row',
  fullDescription: 'The Fixture Lab studies how metabolic pathways are regulated in disease.',
  shortDescription: 'The Fixture Lab studies metabolic disease.',
  fieldProvenance: laneProvenance(),
  ...overrides,
});

const reads = (count: number, sourceUrl = CITED_URL, slug = 'fixture-row'): AttestedEmptyRead[] =>
  Array.from({ length: count }, (_, index) => ({
    entityKey: slug,
    sourceUrl,
    runId: `run-${index}`,
  }));

describe('planUnassertedDescriptionRefusals', () => {
  it('refuses both description fields on two attested-empty reads of the cited page', () => {
    const plan = planUnassertedDescriptionRefusals({
      rows: [row()],
      reads: reads(2),
      laneReadEntityCount: 400,
    });

    expect(plan.frozen).toBe(false);
    expect(plan.plans.map((entry) => entry.field).sort()).toEqual([
      'fullDescription',
      'shortDescription',
    ]);
    expect(plan.plans[0].attestedReadCount).toBe(2);
    expect(plan.plans[0].evidenceUrl).toBe(CITED_URL);
  });

  it('refuses nothing on a single attested-empty read', () => {
    const plan = planUnassertedDescriptionRefusals({
      rows: [row()],
      reads: reads(1),
      laneReadEntityCount: 400,
    });

    expect(plan.plans).toEqual([]);
    expect(plan.skips.every((skip) => skip.reason === 'too_few_attested_reads')).toBe(true);
  });

  it('counts two reads within one run as one', () => {
    const sameRun: AttestedEmptyRead[] = [
      { entityKey: 'fixture-row', sourceUrl: CITED_URL, runId: 'run-0' },
      { entityKey: 'fixture-row', sourceUrl: CITED_URL, runId: 'run-0' },
    ];
    const plan = planUnassertedDescriptionRefusals({
      rows: [row()],
      reads: sameRun,
      laneReadEntityCount: 400,
    });

    expect(plan.plans).toEqual([]);
  });

  it('refuses nothing when the attestation cites a different page than the stored value', () => {
    const plan = planUnassertedDescriptionRefusals({
      rows: [row()],
      reads: reads(2, 'https://example.edu/profile/somebody-else/'),
      laneReadEntityCount: 400,
    });

    expect(plan.plans).toEqual([]);
    expect(plan.skips.every((skip) => skip.reason === 'attestation_cites_another_page')).toBe(true);
  });

  it('refuses nothing on a field another lane resolved', () => {
    const plan = planUnassertedDescriptionRefusals({
      rows: [
        row({
          fieldProvenance: {
            fullDescription: { sourceName: 'dept-faculty-roster', sourceUrl: CITED_URL },
          },
        }),
      ],
      reads: reads(2),
      laneReadEntityCount: 400,
    });

    expect(plan.plans).toEqual([]);
    expect(plan.skips.every((skip) => skip.reason === 'not_this_lane')).toBe(true);
  });

  it('leaves an operator-locked field alone', () => {
    const plan = planUnassertedDescriptionRefusals({
      rows: [row({ manuallyLockedFields: ['fullDescription'] })],
      reads: reads(2),
      laneReadEntityCount: 400,
    });

    expect(plan.plans.map((entry) => entry.field)).toEqual(['shortDescription']);
    expect(plan.skips.some((skip) => skip.reason === 'operator_locked')).toBe(true);
  });

  it('is a no-op on a re-run, because the value is already refused', () => {
    const stored = row();
    const plan = planUnassertedDescriptionRefusals({
      rows: [
        {
          ...stored,
          fieldValueRefusals: {
            fullDescription: [
              {
                valueKey: (stored.fullDescription ?? '').toLowerCase(),
                rule: 'superseded_by_better_source',
                refusedBy: 'test',
                refusedAt: new Date(),
                note: '',
              },
            ],
          },
        },
      ],
      reads: reads(2),
      laneReadEntityCount: 400,
    });

    expect(plan.plans.map((entry) => entry.field)).toEqual(['shortDescription']);
    expect(plan.skips.some((skip) => skip.reason === 'already_refused')).toBe(true);
  });

  it('freezes the whole pass when more than half the examined rows are attested empty', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      row({ slug: `fixture-${index}`, fieldProvenance: laneProvenance() }),
    );
    const allEmpty = rows.flatMap((entry) => reads(2, CITED_URL, entry.slug));
    const plan = planUnassertedDescriptionRefusals({
      rows,
      reads: allEmpty,
      laneReadEntityCount: MIN_LANE_READ_ENTITIES_FOR_DROP_GUARD,
    });

    expect(plan.frozen).toBe(true);
    expect(plan.plans).toEqual([]);
    expect(plan.attestedEmptyFraction).toBeGreaterThan(MAX_ATTESTED_EMPTY_FRACTION);
    expect(plan.frozenReason).toContain('broken extraction');
  });

  it('requires two reads, as a named constant rather than a literal', () => {
    expect(MIN_ATTESTED_EMPTY_READS).toBe(2);
  });

  it('abstains from the drop guard rather than freezing when the lane read too few entities', () => {
    const plan = planUnassertedDescriptionRefusals({
      rows: [row()],
      reads: reads(2),
      laneReadEntityCount: 1,
    });

    expect(plan.dropGuard).toBe('abstained');
    expect(plan.frozen).toBe(false);
    expect(plan.plans).toHaveLength(2);
  });

  it('measures the drop fraction over the lane read population, not over its own targets', () => {
    const plan = planUnassertedDescriptionRefusals({
      rows: [row()],
      reads: reads(2),
      laneReadEntityCount: 400,
    });

    expect(plan.laneReadEntityCount).toBe(400);
    expect(plan.attestedEmptyFraction).toBeCloseTo(1 / 400);
    expect(plan.dropGuard).toBe('passed');
  });
});

describe('sameCitedPage', () => {
  it('treats a trailing slash, a query string and a case difference as one page', () => {
    expect(
      sameCitedPage(CITED_URL, 'https://example.edu/profile/example-person?tab=research'),
    ).toBe(true);
    expect(sameCitedPage(CITED_URL, 'https://EXAMPLE.edu/profile/example-person')).toBe(true);
  });

  it('separates two different pages on the same host', () => {
    expect(sameCitedPage(CITED_URL, 'https://example.edu/profile/somebody-else/')).toBe(false);
  });
});

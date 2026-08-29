import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_PAIR_FIELDS,
  describeDescriptionPairRisk,
  descriptionPairObservationFilter,
  planDescriptionPairRollback,
} from '../descriptionPairRollbackCore';

const SOURCE = 'fra-profile-research-synthesis';

const obs = (field: string, sourceName: string, extra: Record<string, unknown> = {}) => ({
  entityKey: 'e1',
  field,
  sourceName,
  value: 'x'.repeat(200),
  ...extra,
});

describe('descriptionPairObservationFilter', () => {
  it('selects BOTH description fields, never one', () => {
    // Scoping a rollback to fullDescription alone is the mistake this prevents.
    const filter = descriptionPairObservationFilter({ entityKey: 'e1', sourceName: SOURCE });
    expect(filter.field).toEqual({ $in: ['fullDescription', 'shortDescription'] });
    expect(filter.entityKey).toBe('e1');
    expect(filter.sourceName).toBe(SOURCE);
    expect(filter.superseded).toEqual({ $ne: true });
  });

  it('covers exactly the coupled pair', () => {
    expect([...DESCRIPTION_PAIR_FIELDS]).toEqual(['fullDescription', 'shortDescription']);
  });
});

describe('planDescriptionPairRollback', () => {
  it('supersedes both fields when the source wrote both', () => {
    const plan = planDescriptionPairRollback({
      entityKey: 'e1',
      sourceName: SOURCE,
      observations: [obs('fullDescription', SOURCE), obs('shortDescription', SOURCE)],
    });
    expect(plan.fieldsToSupersede).toEqual(['fullDescription', 'shortDescription']);
    expect(plan.skipped).toBeUndefined();
  });

  it('flags a short written by another source, because it may be derived from the full being removed', () => {
    // The incident shape: the synthesis lane wrote the full, the card line came
    // from elsewhere but was derived from that full text, and removing only the
    // full left the two restating each other.
    const plan = planDescriptionPairRollback({
      entityKey: 'e1',
      sourceName: SOURCE,
      observations: [obs('fullDescription', SOURCE), obs('shortDescription', 'card-synthesis-llm')],
    });
    expect(plan.fieldsToSupersede).toEqual(['fullDescription']);
    expect(plan.shortWrittenElsewhere).toBe(true);
  });

  it('does not flag when the source wrote both fields itself', () => {
    const plan = planDescriptionPairRollback({
      entityKey: 'e1',
      sourceName: SOURCE,
      observations: [obs('fullDescription', SOURCE), obs('shortDescription', SOURCE)],
    });
    expect(plan.shortWrittenElsewhere).toBe(false);
  });

  it('ignores already-superseded rows', () => {
    const plan = planDescriptionPairRollback({
      entityKey: 'e1',
      sourceName: SOURCE,
      observations: [obs('fullDescription', SOURCE, { superseded: true })],
    });
    expect(plan.skipped).toBe('no-active-observations');
    expect(plan.fieldsToSupersede).toEqual([]);
  });

  it('ignores fields outside the pair', () => {
    const plan = planDescriptionPairRollback({
      entityKey: 'e1',
      sourceName: SOURCE,
      observations: [obs('researchAreas', SOURCE), obs('methods', SOURCE)],
    });
    expect(plan.skipped).toBe('no-active-observations');
  });
});

describe('describeDescriptionPairRisk', () => {
  const isRestatement = (full: string, short: string) =>
    full.trim().toLowerCase().startsWith(short.trim().toLowerCase().slice(0, 40));

  it('reports an empty full description, the exact 404 signature', () => {
    // 14 served entities reached this state and the visibility gate did not
    // notice, because shortDescription survived and the tier stayed student_ready.
    expect(
      describeDescriptionPairRisk({
        fullDescription: '',
        shortDescription: 'Studies telomere dysfunction and genome stability in ageing.',
        isRestatement,
      }),
    ).toBe('empty-full-description');
  });

  it('reports a full that restates the short, which the materializer will blank next run', () => {
    // Observed after a repair set the two fields to identical text: the rows read
    // as fixed but blank again on the next materialize.
    const same = "Dr. Hansen's research explores how certain autoantibodies might be harnessed.";
    expect(
      describeDescriptionPairRisk({ fullDescription: same, shortDescription: same, isRestatement }),
    ).toBe('full-restates-short');
  });

  it('passes a distinct, serviceable pair', () => {
    expect(
      describeDescriptionPairRisk({
        fullDescription:
          'The laboratory investigates how telomere dysfunction activates DNA damage responses and drives premature ageing phenotypes.',
        shortDescription: 'Studies telomere dysfunction and genome stability.',
        isRestatement,
      }),
    ).toBeNull();
  });

  it('passes when there is no short to restate', () => {
    expect(
      describeDescriptionPairRisk({
        fullDescription: 'The laboratory investigates mucosal immune regulation in the intestine.',
        shortDescription: '',
        isRestatement,
      }),
    ).toBeNull();
  });
});

describe('a manufactured-duplicate pair cannot be repaired by restoring it', () => {
  // labMicrositeUndergradLLMExtractor.ts:822 pushes one studentReadyDescription
  // string as fullDescription at 0.55 and, when card-length, the same string again
  // as shortDescription at 0.55. Both are observation-backed, so "restore the
  // prior pair" recreates exactly the state the materializer blanks.
  const identical = 'Studies hand and wrist trauma, arthritis, nerve injury, and tendon pathology.';
  const isRestatement = (full: string, short: string) => full.trim() === short.trim();

  it('is reported as unstable rather than serviceable', () => {
    expect(
      describeDescriptionPairRisk({
        fullDescription: identical,
        shortDescription: identical,
        isRestatement,
      }),
    ).toBe('full-restates-short');
  });

  it('plans a rollback of both fields when one source emitted both', () => {
    const plan = planDescriptionPairRollback({
      entityKey: 'e1',
      sourceName: 'lab-microsite-undergrad-llm',
      observations: [
        {
          entityKey: 'e1',
          field: 'fullDescription',
          sourceName: 'lab-microsite-undergrad-llm',
          value: identical,
        },
        {
          entityKey: 'e1',
          field: 'shortDescription',
          sourceName: 'lab-microsite-undergrad-llm',
          value: identical,
        },
      ],
    });
    expect(plan.fieldsToSupersede).toEqual(['fullDescription', 'shortDescription']);
    // Both came from the same source, so nothing is left behind to restate.
    expect(plan.shortWrittenElsewhere).toBe(false);
  });
});

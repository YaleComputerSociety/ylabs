import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_PAIR_FIELDS,
  describeDescriptionPairRisk,
  descriptionPairObservationFilter,
  planDescriptionPairRollback,
  type DescriptionPairEntityIdentity,
} from '../descriptionPairRollbackCore';

const SOURCE = 'fra-profile-research-synthesis';

const ENTITY: DescriptionPairEntityIdentity = {
  entityType: 'researchEntity',
  entityKey: 'e1',
};

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
    const filter = descriptionPairObservationFilter({ ...ENTITY, sourceName: SOURCE });
    expect(filter.field).toEqual({ $in: ['fullDescription', 'shortDescription'] });
    expect(filter.entityKey).toBe('e1');
    expect(filter.entityType).toBe('researchEntity');
    expect(filter.sourceName).toBe(SOURCE);
    expect(filter.superseded).toEqual({ $ne: true });
  });

  it('covers exactly the coupled pair', () => {
    expect([...DESCRIPTION_PAIR_FIELDS]).toEqual(['fullDescription', 'shortDescription']);
  });

  it('matches an id-keyed caller, whose rows would otherwise be missed entirely', () => {
    const filter = descriptionPairObservationFilter({
      entityType: 'researchEntity',
      entityId: '507f1f77bcf86cd799439011',
      sourceName: SOURCE,
    });
    expect(filter.entityId).toBe('507f1f77bcf86cd799439011');
    expect(filter.entityKey).toBeUndefined();
  });

  it('matches either identity form when the caller holds both', () => {
    const filter = descriptionPairObservationFilter({
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
      entityId: '507f1f77bcf86cd799439011',
      sourceName: SOURCE,
    });
    expect(filter.$or).toEqual([
      { entityKey: 'smith-lab' },
      { entityId: '507f1f77bcf86cd799439011' },
    ]);
  });

  it('refuses to build a filter with no entity identity, which would match the whole source', () => {
    expect(() =>
      descriptionPairObservationFilter({ entityType: 'researchEntity', sourceName: SOURCE }),
    ).toThrow(/entityKey or an entityId/);
  });
});

describe('planDescriptionPairRollback', () => {
  it('supersedes both fields when the source wrote both', () => {
    const plan = planDescriptionPairRollback({
      entity: ENTITY,
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
      entity: ENTITY,
      sourceName: SOURCE,
      observations: [obs('fullDescription', SOURCE), obs('shortDescription', 'card-synthesis-llm')],
    });
    expect(plan.fieldsToSupersede).toEqual(['fullDescription']);
    expect(plan.shortWrittenElsewhere).toBe(true);
  });

  it('still flags a foreign short when this source also wrote a short of its own', () => {
    // Superseding this source's pair does not remove the other source's short, so
    // the surviving short is exactly what the materializer guard will compare the
    // replacement full against.
    const plan = planDescriptionPairRollback({
      entity: ENTITY,
      sourceName: SOURCE,
      observations: [
        obs('fullDescription', SOURCE),
        obs('shortDescription', SOURCE),
        obs('shortDescription', 'card-synthesis-llm'),
      ],
    });
    expect(plan.fieldsToSupersede).toEqual(['fullDescription', 'shortDescription']);
    expect(plan.shortWrittenElsewhere).toBe(true);
  });

  it('does not flag when this source is the only one with an active short', () => {
    const plan = planDescriptionPairRollback({
      entity: ENTITY,
      sourceName: SOURCE,
      observations: [obs('fullDescription', SOURCE), obs('shortDescription', SOURCE)],
    });
    expect(plan.shortWrittenElsewhere).toBe(false);
  });

  it('does not count an already-superseded foreign short as surviving', () => {
    const plan = planDescriptionPairRollback({
      entity: ENTITY,
      sourceName: SOURCE,
      observations: [
        obs('fullDescription', SOURCE),
        obs('shortDescription', 'card-synthesis-llm', { superseded: true }),
      ],
    });
    expect(plan.shortWrittenElsewhere).toBe(false);
  });

  it('ignores already-superseded rows', () => {
    const plan = planDescriptionPairRollback({
      entity: ENTITY,
      sourceName: SOURCE,
      observations: [obs('fullDescription', SOURCE, { superseded: true })],
    });
    expect(plan.skipped).toBe('no-active-observations');
    expect(plan.fieldsToSupersede).toEqual([]);
  });

  it('ignores fields outside the pair', () => {
    const plan = planDescriptionPairRollback({
      entity: ENTITY,
      sourceName: SOURCE,
      observations: [obs('researchAreas', SOURCE), obs('methods', SOURCE)],
    });
    expect(plan.skipped).toBe('no-active-observations');
  });
});

describe('describeDescriptionPairRisk', () => {
  it('reports an empty full description, the exact 404 signature', () => {
    // 14 served entities reached this state and the visibility gate did not
    // notice, because shortDescription survived and the tier stayed student_ready.
    expect(
      describeDescriptionPairRisk({
        fullDescription: '',
        shortDescription: 'Studies telomere dysfunction and genome stability in ageing.',
      }),
    ).toBe('empty-full-description');
  });

  it('reports a full that restates the short, which the materializer will blank next run', () => {
    // Observed after a repair set the two fields to identical text: the rows read
    // as fixed but blank again on the next materialize.
    const same =
      'The laboratory investigates how telomere dysfunction activates DNA damage responses and drives premature ageing phenotypes.';
    expect(describeDescriptionPairRisk({ fullDescription: same, shortDescription: same })).toBe(
      'full-restates-short',
    );
  });

  it('reports a full that only prepends a lead clause to the short, which the guard also rejects', () => {
    // The guard strips a leading subject clause before comparing, so a repair that
    // dresses the short up with "Dr. Hansen's research explores ..." is still a
    // restatement to the materializer even though the strings differ.
    const short =
      'how telomere dysfunction activates DNA damage responses and drives premature ageing phenotypes.';
    expect(
      describeDescriptionPairRisk({
        fullDescription: `The laboratory investigates ${short}`,
        shortDescription: short,
      }),
    ).toBe('full-restates-short');
  });

  it('reports a distinct but not-useful full, which the ranked walk refuses to write', () => {
    // The materializer accepts a winner only when it is useful AND not a
    // restatement, so a repair that clears restatement alone still leaves a row
    // the live serve path will not accept.
    expect(
      describeDescriptionPairRisk({
        fullDescription: 'Professor of Immunobiology',
        shortDescription: 'Studies telomere dysfunction and genome stability.',
      }),
    ).toBe('full-description-not-useful');
  });

  it('passes a distinct, serviceable pair', () => {
    expect(
      describeDescriptionPairRisk({
        fullDescription:
          'The laboratory investigates how telomere dysfunction activates DNA damage responses and drives premature ageing phenotypes.',
        shortDescription: 'Studies telomere dysfunction and genome stability.',
      }),
    ).toBeNull();
  });

  it('passes when there is no short to restate', () => {
    expect(
      describeDescriptionPairRisk({
        fullDescription:
          'The laboratory investigates how mucosal immune regulation in the intestine constrains inflammatory disease.',
        shortDescription: '',
      }),
    ).toBeNull();
  });
});

describe('a manufactured-duplicate pair cannot be repaired by restoring it', () => {
  // The studentReadyDescription emit block in labMicrositeUndergradLLMExtractor.ts
  // pushes one string as fullDescription at 0.55 and, when card-length, the same
  // string again as shortDescription at 0.55. Both are observation-backed, so
  // "restore the prior pair" recreates exactly the state the materializer blanks.
  const identical =
    'The laboratory studies hand and wrist trauma, arthritis, nerve injury, and tendon pathology in adults.';

  it('is reported as unstable rather than serviceable', () => {
    expect(
      describeDescriptionPairRisk({ fullDescription: identical, shortDescription: identical }),
    ).toBe('full-restates-short');
  });

  it('plans a rollback of both fields when one source emitted both', () => {
    const plan = planDescriptionPairRollback({
      entity: { entityType: 'researchEntity', entityKey: 'e1' },
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
    // No other source has an active short, so this rollback leaves nothing behind
    // for a replacement full to restate.
    expect(plan.shortWrittenElsewhere).toBe(false);
  });
});

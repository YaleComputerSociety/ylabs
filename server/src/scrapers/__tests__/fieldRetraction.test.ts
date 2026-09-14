import { describe, expect, it } from 'vitest';
import {
  assertDeclarableRetractionField,
  assertFieldRetractionContractsAreDeclarable,
  classifyFieldRetraction,
  completeReadsSupportingRetraction,
  FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION,
  fieldRetractionContractFor,
  fieldRetractionContracts,
  isIngestDroppableObservationField,
  passesFieldRetractionDropGuard,
  planFieldRetractions,
  storedValueIsRetractedValue,
  type FieldRetractionCandidateObservation,
  type FieldRetractionCompleteRead,
  type FieldRetractionEntityState,
  type SourceFieldRetractionContract,
} from '../fieldRetraction';
import { sourceCoverageRegistry } from '../sourceCoverageRegistry';

const CONTRACT: SourceFieldRetractionContract = {
  witnessFields: ['slug', 'sourceUrls'],
  retractableFields: ['websiteUrl'],
  notes: 'test',
};

const at = (iso: string) => new Date(iso);

const read = (
  entityKey: string,
  scrapeRunId: string,
  iso: string,
): FieldRetractionCompleteRead => ({ entityKey, scrapeRunId, observedAt: at(iso) });

const observation = (
  overrides: Partial<FieldRetractionCandidateObservation> = {},
): FieldRetractionCandidateObservation => ({
  observationId: 'obs-1',
  entityKey: 'ysm-faculty-rivers',
  field: 'websiteUrl',
  value: 'https://riverslab.example.org/',
  scrapeRunId: 'run-1',
  observedAt: at('2026-01-01T00:00:00Z'),
  ...overrides,
});

const entity = (
  overrides: Partial<FieldRetractionEntityState> = {},
): FieldRetractionEntityState => ({
  entityId: '000000000000000000000001',
  entityKey: 'ysm-faculty-rivers',
  manuallyLockedFields: [],
  storedValues: { websiteUrl: 'https://riverslab.example.org' },
  liveObservationCountByField: { websiteUrl: 1 },
  ...overrides,
});

describe('field-retraction contract declarability', () => {
  it('accepts the shipped contracts', () => {
    expect(() => assertFieldRetractionContractsAreDeclarable()).not.toThrow();
  });

  it('names only sources the coverage registry knows', () => {
    for (const sourceName of Object.keys(fieldRetractionContracts)) {
      expect(Object.keys(sourceCoverageRegistry)).toContain(sourceName);
    }
  });

  it('refuses a field ingest can drop, because a rejection reads as a retraction', () => {
    for (const field of ['fullDescription', 'shortDescription', 'researchAreas', 'name', 'kind']) {
      expect(isIngestDroppableObservationField(field)).toBe(true);
      expect(() => assertDeclarableRetractionField(field, 'retractable')).toThrow(
        /ingest can drop/,
      );
    }
    expect(isIngestDroppableObservationField('websiteUrl')).toBe(false);
    expect(isIngestDroppableObservationField('sourceUrls')).toBe(false);
  });

  it('refuses a latest-wins witness field', () => {
    expect(() =>
      assertFieldRetractionContractsAreDeclarable({
        'ysm-faculty-directory': {
          witnessFields: ['slug', 'sourceContentHash'],
          retractableFields: ['websiteUrl'],
          notes: 'test',
        },
      }),
    ).toThrow(/latest-wins/);
  });

  it('refuses a contract with no witness and a contract with no retractable field', () => {
    expect(() =>
      assertFieldRetractionContractsAreDeclarable({
        s: { witnessFields: [], retractableFields: ['websiteUrl'], notes: '' },
      }),
    ).toThrow(/no witness field/);
    expect(() =>
      assertFieldRetractionContractsAreDeclarable({
        s: { witnessFields: ['slug'], retractableFields: [], notes: '' },
      }),
    ).toThrow(/no retractable field/);
  });

  it('does not treat an undeclared source as retraction capable', () => {
    expect(fieldRetractionContractFor('dept-faculty-roster')).toBeUndefined();
    expect(fieldRetractionContractFor('ysm-atoz-index')).toBeUndefined();
    expect(fieldRetractionContractFor('constructor')).toBeUndefined();
    expect(fieldRetractionContractFor('ysm-faculty-directory')).toBeDefined();
  });
});

describe('completeReadsSupportingRetraction', () => {
  it('ignores the observation own run and any read that is not strictly later', () => {
    const supporting = completeReadsSupportingRetraction(
      { scrapeRunId: 'run-1', observedAt: at('2026-01-01T00:00:00Z') },
      [
        read('e', 'run-1', '2026-03-01T00:00:00Z'),
        read('e', 'run-0', '2025-12-01T00:00:00Z'),
        read('e', 'run-2', '2026-01-01T00:00:00Z'),
        read('e', 'run-3', '2026-02-01T00:00:00Z'),
      ],
    );
    expect(supporting).toEqual(['run-3']);
  });

  it('counts each run once however many witness rows it wrote', () => {
    const supporting = completeReadsSupportingRetraction(
      { scrapeRunId: 'run-1', observedAt: at('2026-01-01T00:00:00Z') },
      [read('e', 'run-2', '2026-02-01T00:00:00Z'), read('e', 'run-2', '2026-02-01T00:01:00Z')],
    );
    expect(supporting).toEqual(['run-2']);
  });
});

describe('classifyFieldRetraction', () => {
  const obs = { scrapeRunId: 'run-1', observedAt: at('2026-01-01T00:00:00Z') };

  it('reports source-has-not-reread when no later complete read exists', () => {
    expect(classifyFieldRetraction({ observation: obs, completeReads: [] })).toBe(
      'source-has-not-reread',
    );
    expect(
      classifyFieldRetraction({
        observation: obs,
        completeReads: [read('e', 'run-1', '2026-05-01T00:00:00Z')],
      }),
    ).toBe('source-has-not-reread');
  });

  it('waits for a second complete read', () => {
    expect(
      classifyFieldRetraction({
        observation: obs,
        completeReads: [read('e', 'run-2', '2026-02-01T00:00:00Z')],
      }),
    ).toBe('awaiting-second-complete-read');
  });

  it('retracts once two distinct later complete reads carry no assertion', () => {
    expect(
      classifyFieldRetraction({
        observation: obs,
        completeReads: [
          read('e', 'run-2', '2026-02-01T00:00:00Z'),
          read('e', 'run-3', '2026-03-01T00:00:00Z'),
        ],
      }),
    ).toBe('retract');
  });
});

describe('passesFieldRetractionDropGuard', () => {
  const floor = FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION;

  it('fails with no asserting population at all', () => {
    expect(passesFieldRetractionDropGuard(0, 0)).toBe(false);
  });

  it('does not apply a fraction below the population floor', () => {
    expect(passesFieldRetractionDropGuard(floor - 1, floor - 1)).toBe(true);
  });

  it('freezes a corpus-wide absence above the floor', () => {
    expect(passesFieldRetractionDropGuard(floor, floor)).toBe(false);
    expect(passesFieldRetractionDropGuard(60, 100)).toBe(false);
    expect(passesFieldRetractionDropGuard(51, 100)).toBe(false);
  });

  it('passes a delisting cohort above the floor', () => {
    expect(passesFieldRetractionDropGuard(48, 400)).toBe(true);
    expect(passesFieldRetractionDropGuard(50, 100)).toBe(true);
  });
});

describe('storedValueIsRetractedValue', () => {
  it('folds scheme, www and trailing slash so a stored url matches its observation', () => {
    expect(
      storedValueIsRetractedValue('http://www.riverslab.example.org/', [
        'https://riverslab.example.org',
      ]),
    ).toBe(true);
  });

  it('refuses a different value and an empty stored value', () => {
    expect(
      storedValueIsRetractedValue('https://other.example.org', ['https://riverslab.example.org']),
    ).toBe(false);
    expect(storedValueIsRetractedValue('', ['https://riverslab.example.org'])).toBe(false);
    expect(storedValueIsRetractedValue(undefined, ['https://riverslab.example.org'])).toBe(false);
  });

  it('compares lists as sets', () => {
    expect(storedValueIsRetractedValue(['b', 'a'], [['a', 'b']])).toBe(true);
    expect(storedValueIsRetractedValue(['a'], [['a', 'b']])).toBe(false);
  });
});

describe('planFieldRetractions', () => {
  const reads = [
    read('ysm-faculty-rivers', 'run-2', '2026-02-01T00:00:00Z'),
    read('ysm-faculty-rivers', 'run-3', '2026-03-01T00:00:00Z'),
  ];

  it('plans a retraction that clears the stored value when the last assertion goes', () => {
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: reads,
      activeObservations: [observation()],
      entities: [entity()],
    });
    expect(plan.frozenFields).toEqual([]);
    expect(plan.retractions).toEqual([
      {
        entityId: '000000000000000000000001',
        entityKey: 'ysm-faculty-rivers',
        field: 'websiteUrl',
        observationIds: ['obs-1'],
        clearsStoredValue: true,
      },
    ]);
    expect(plan.counts.retractedObservations).toBe(1);
    expect(plan.counts.storedValuesCleared).toBe(1);
  });

  it('never retracts when the source has not read the entity again', () => {
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: [read('ysm-faculty-rivers', 'run-1', '2026-01-01T00:00:00Z')],
      activeObservations: [observation()],
      entities: [entity()],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.sourceHasNotReread).toBe(1);
  });

  it('ignores an entity with no complete read at all, so silence retracts nothing', () => {
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: [],
      activeObservations: [observation()],
      entities: [entity()],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.candidateObservations).toBe(0);
  });

  it('leaves a locked field alone whatever the lock reason says', () => {
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: reads,
      activeObservations: [observation()],
      entities: [entity({ manuallyLockedFields: ['websiteUrl'] })],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.lockedSkipped).toBe(1);
  });

  it('retires the assertion but defers the clear while rival evidence survives', () => {
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: reads,
      activeObservations: [observation()],
      entities: [entity({ liveObservationCountByField: { websiteUrl: 2 } })],
    });
    expect(plan.retractions[0].clearsStoredValue).toBe(false);
    expect(plan.counts.deferredToResolver).toBe(1);
    expect(plan.counts.storedValuesCleared).toBe(0);
  });

  it('does not clear a stored value that is no longer the retracted one', () => {
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: reads,
      activeObservations: [observation()],
      entities: [entity({ storedValues: { websiteUrl: 'https://elsewhere.example.org' } })],
    });
    expect(plan.retractions[0].clearsStoredValue).toBe(false);
    expect(plan.counts.storedValueDiverged).toBe(1);
  });

  it('freezes the whole field when a corpus-wide absence looks like a broken selector', () => {
    const population = FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION + 10;
    const completeReads: FieldRetractionCompleteRead[] = [];
    const activeObservations: FieldRetractionCandidateObservation[] = [];
    const entities: FieldRetractionEntityState[] = [];
    for (let index = 0; index < population; index++) {
      const entityKey = `ysm-faculty-${index}`;
      completeReads.push(read(entityKey, 'run-2', '2026-02-01T00:00:00Z'));
      completeReads.push(read(entityKey, 'run-3', '2026-03-01T00:00:00Z'));
      activeObservations.push(observation({ observationId: `obs-${index}`, entityKey }));
      entities.push(entity({ entityId: `00000000000000000000${String(1000 + index)}`, entityKey }));
    }
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads,
      activeObservations,
      entities,
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.frozenFields).toEqual([
      {
        sourceName: 'ysm-faculty-directory',
        field: 'websiteUrl',
        absentEntities: population,
        assertingEntities: population,
      },
    ]);
  });

  it('applies a delisting cohort above the floor while reporting nothing frozen', () => {
    const population = 40;
    const absent = 8;
    const completeReads: FieldRetractionCompleteRead[] = [];
    const activeObservations: FieldRetractionCandidateObservation[] = [];
    const entities: FieldRetractionEntityState[] = [];
    for (let index = 0; index < population; index++) {
      const entityKey = `ysm-faculty-${index}`;
      const stillAsserted = index >= absent;
      completeReads.push(read(entityKey, 'run-2', '2026-02-01T00:00:00Z'));
      completeReads.push(read(entityKey, 'run-3', '2026-03-01T00:00:00Z'));
      activeObservations.push(
        observation({
          observationId: `obs-${index}`,
          entityKey,
          // A still-asserted holder's live row belongs to the newest read, which is
          // what stops it being read as an absence.
          scrapeRunId: stillAsserted ? 'run-3' : 'run-1',
          observedAt: stillAsserted ? at('2026-03-01T00:00:00Z') : at('2026-01-01T00:00:00Z'),
        }),
      );
      entities.push(entity({ entityId: `00000000000000000000${String(1000 + index)}`, entityKey }));
    }
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads,
      activeObservations,
      entities,
    });
    expect(plan.frozenFields).toEqual([]);
    expect(plan.retractions).toHaveLength(absent);
    expect(plan.counts.sourceHasNotReread).toBe(population - absent);
  });

  it('drops a retraction whose entity row is gone rather than guessing', () => {
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: reads,
      activeObservations: [observation()],
      entities: [],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.unmatchedEntities).toBe(1);
  });

  it('ignores a field the source has not declared retractable', () => {
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: reads,
      activeObservations: [observation({ field: 'departments', value: ['Neurology'] })],
      entities: [entity()],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.candidateObservations).toBe(0);
  });
});

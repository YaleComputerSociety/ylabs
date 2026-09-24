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
  classifyRetractionValueOwnership,
  withholdSoleHolderRetractionsThatStillAnswer,
  type PlannedFieldRetraction,
} from '../fieldRetraction';
import { sourceCoverageRegistry } from '../sourceCoverageRegistry';

const CONTRACT: SourceFieldRetractionContract = {
  witnessFields: ['slug', 'sourceUrls'],
  retractableFields: ['websiteUrl'],
  notes: 'test',
};

const at = (iso: string) => new Date(iso);

/**
 * Defaults to witnessing the absence of `websiteUrl`, so every case that predates
 * #2647 keeps testing what it meant to test. `silentRead` is the same read without
 * the assertion: the source looked and said nothing about the field.
 */
const read = (
  entityKey: string,
  scrapeRunId: string,
  iso: string,
  assertsNoValueFor: string[] = ['websiteUrl'],
): FieldRetractionCompleteRead => ({
  entityKey,
  scrapeRunId,
  observedAt: at(iso),
  assertsNoValueFor,
});

const silentRead = (entityKey: string, scrapeRunId: string, iso: string) =>
  read(entityKey, scrapeRunId, iso, []);

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
    expect(fieldRetractionContractFor('ysm-atoz-index')).toBeUndefined();
    expect(fieldRetractionContractFor('official-profile-pi-backfill')).toBeUndefined();
    expect(fieldRetractionContractFor('constructor')).toBeUndefined();
    expect(fieldRetractionContractFor('ysm-faculty-directory')).toBeDefined();
    expect(fieldRetractionContractFor('dept-faculty-roster')).toBeDefined();
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
      'websiteUrl',
    );
    expect(supporting).toEqual(['run-3']);
  });

  it('counts each run once however many witness rows it wrote', () => {
    const supporting = completeReadsSupportingRetraction(
      { scrapeRunId: 'run-1', observedAt: at('2026-01-01T00:00:00Z') },
      [read('e', 'run-2', '2026-02-01T00:00:00Z'), read('e', 'run-2', '2026-02-01T00:01:00Z')],
      'websiteUrl',
    );
    expect(supporting).toEqual(['run-2']);
  });

  it('ignores a later complete read that asserts nothing about the field (#2647)', () => {
    const supporting = completeReadsSupportingRetraction(
      { scrapeRunId: 'run-1', observedAt: at('2026-01-01T00:00:00Z') },
      [
        silentRead('e', 'run-2', '2026-02-01T00:00:00Z'),
        silentRead('e', 'run-3', '2026-03-01T00:00:00Z'),
      ],
      'websiteUrl',
    );
    expect(supporting).toEqual([]);
  });

  it('does not let an assertion about one field retract another', () => {
    const supporting = completeReadsSupportingRetraction(
      { scrapeRunId: 'run-1', observedAt: at('2026-01-01T00:00:00Z') },
      [read('e', 'run-2', '2026-02-01T00:00:00Z', ['methods'])],
      'websiteUrl',
    );
    expect(supporting).toEqual([]);
  });
});

describe('classifyFieldRetraction', () => {
  const obs = {
    scrapeRunId: 'run-1',
    observedAt: at('2026-01-01T00:00:00Z'),
    field: 'websiteUrl',
  };

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

  it('retracts once two distinct later complete reads witness the absence', () => {
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

  // The #2647 case: the source re-read the page twice and declined to say the value
  // is gone, because the value is still there and a classifier refused it. Reported
  // separately from source-has-not-reread, since "looked and said nothing" and "has
  // not looked" call for opposite responses.
  it('reports absence-not-witnessed when later reads assert nothing about the field', () => {
    expect(
      classifyFieldRetraction({
        observation: obs,
        completeReads: [
          silentRead('e', 'run-2', '2026-02-01T00:00:00Z'),
          silentRead('e', 'run-3', '2026-03-01T00:00:00Z'),
        ],
      }),
    ).toBe('absence-not-witnessed');
  });

  it('still waits for a second complete read when only one witnesses the absence', () => {
    expect(
      classifyFieldRetraction({
        observation: obs,
        completeReads: [
          read('e', 'run-2', '2026-02-01T00:00:00Z'),
          silentRead('e', 'run-3', '2026-03-01T00:00:00Z'),
        ],
      }),
    ).toBe('awaiting-second-complete-read');
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
        retractedValues: ['https://riverslab.example.org/'],
        maxEntitiesSharingAValue: 1,
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


describe('retraction value ownership (#3135, #2460)', () => {
  it('calls a value asserted for several entities page boilerplate', () => {
    expect(classifyRetractionValueOwnership(20)).toBe('shared-boilerplate');
    expect(classifyRetractionValueOwnership(2)).toBe('shared-boilerplate');
  });

  it('calls a value asserted for exactly one entity that row\'s own claim', () => {
    expect(classifyRetractionValueOwnership(1)).toBe('sole-holder');
  });

  it('counts the entities sharing a value, so one boilerplate link is recognised', () => {
    const donorPage = 'https://ysph.example.edu/charitable-opportunities/a-fund/';
    const keys = ['dept-a', 'dept-b', 'dept-c'];
    const plan = planFieldRetractions({
      sourceName: 'ysm-faculty-directory',
      contract: CONTRACT,
      completeReads: keys.flatMap((key) => [
        read(key, 'run-2', '2026-02-01T00:00:00Z'),
        read(key, 'run-3', '2026-03-01T00:00:00Z'),
      ]),
      activeObservations: keys.map((key, index) =>
        observation({ observationId: `obs-${index}`, entityKey: key, value: donorPage }),
      ),
      entities: keys.map((key, index) => 
        entity({
          entityId: `00000000000000000000000${index}`,
          entityKey: key,
          storedValues: { websiteUrl: donorPage },
        }),
      ),
      dropGuardMinPopulation: 100,
    });
    expect(plan.retractions).toHaveLength(3);
    for (const retraction of plan.retractions) {
      expect(retraction.maxEntitiesSharingAValue).toBe(3);
    }
    expect(plan.counts.sharedBoilerplateValue).toBe(3);
  });
});

describe('withholdSoleHolderRetractionsThatStillAnswer (#3135)', () => {
  const planned = (
    overrides: Partial<PlannedFieldRetraction> = {},
  ): PlannedFieldRetraction => ({
    entityId: '000000000000000000000001',
    entityKey: 'dept-physics-someone',
    field: 'websiteUrl',
    observationIds: ['obs-1'],
    clearsStoredValue: true,
    retractedValues: ['https://campuspress.example.edu/somelab/'],
    maxEntitiesSharingAValue: 1,
    ...overrides,
  });

  const never = async () => ({ positivelyDead: false });
  const always = async () => ({ positivelyDead: true });

  it('withholds a sole-holder value that still answers, so a live lab link survives', async () => {
    const result = await withholdSoleHolderRetractionsThatStillAnswer([planned()], never);
    expect(result.retained).toEqual([]);
    expect(result.withheld).toEqual([
      {
        entityKey: 'dept-physics-someone',
        field: 'websiteUrl',
        reason: 'sole-holder-value-still-answers',
        values: ['https://campuspress.example.edu/somelab/'],
      },
    ]);
    expect(result.probedValues).toBe(1);
  });

  it('retracts a sole-holder value a probe positively finds dead', async () => {
    const result = await withholdSoleHolderRetractionsThatStillAnswer([planned()], always);
    expect(result.retained).toHaveLength(1);
    expect(result.withheld).toEqual([]);
  });

  it('never probes a shared boilerplate value, because liveness cannot defend it', async () => {
    let probes = 0;
    const counting = async () => {
      probes += 1;
      return { positivelyDead: false };
    };
    const result = await withholdSoleHolderRetractionsThatStillAnswer(
      [planned({ maxEntitiesSharingAValue: 20 })],
      counting,
    );
    expect(result.retained).toHaveLength(1);
    expect(probes).toBe(0);
  });

  it('withholds when any one of several sole-holder values still answers', async () => {
    const mixed = async (value: string) => ({ positivelyDead: value.endsWith('dead') });
    const result = await withholdSoleHolderRetractionsThatStillAnswer(
      [planned({ retractedValues: ['https://a.example.org/dead', 'https://b.example.org/live'] })],
      mixed,
    );
    expect(result.retained).toEqual([]);
    expect(result.withheld).toHaveLength(1);
  });
});

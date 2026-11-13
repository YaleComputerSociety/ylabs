import { describe, expect, it } from 'vitest';
import {
  assertFieldRetractionContractsAreDeclarable,
  fieldRetractionContracts,
  planFieldRetractions,
  refusalsFromWitnessRows,
  withholdSoleHolderRetractionsThatStillAnswer,
  type FieldRetractionCandidateObservation,
  type FieldRetractionCompleteRead,
  type FieldRetractionEntityState,
  type FieldRetractionRefusal,
  type SourceFieldRetractionContract,
} from '../fieldRetraction';

const LISTING_PAGE = 'https://example.yale.edu/people/faculty';
const OTHER_PAGE = 'https://example.yale.edu/people/emeriti';
const STORED_LINK = 'https://synthetic-lab.example.org/';
const OTHER_LINK = 'https://another-site.example.org/';
const CLASSIFIER = 'roster-website-signal';
const ENTITY_KEY = 'synthetic-roster-entity';

const CONTRACT: SourceFieldRetractionContract = {
  witnessFields: ['slug', 'sourceUrls'],
  retractableFields: ['websiteUrl'],
  refusalClassifiers: [{ field: 'websiteUrl', classifier: CLASSIFIER }],
  notes: 'test',
};

const CONTRACT_WITHOUT_REFUSALS: SourceFieldRetractionContract = {
  ...CONTRACT,
  refusalClassifiers: undefined,
};

const at = (iso: string) => new Date(iso);

const refusal = (overrides: Partial<FieldRetractionRefusal> = {}): FieldRetractionRefusal => ({
  field: 'websiteUrl',
  value: STORED_LINK,
  reason: 'link_text_not_a_research_site',
  classifier: CLASSIFIER,
  classifierVersion: 2,
  sourceUrl: LISTING_PAGE,
  ...overrides,
});

const refusingRead = (
  scrapeRunId: string,
  iso: string,
  refusals: FieldRetractionRefusal[] = [refusal()],
): FieldRetractionCompleteRead => ({
  entityKey: ENTITY_KEY,
  scrapeRunId,
  observedAt: at(iso),
  assertsNoValueFor: [],
  refusals,
});

const assertion = (
  overrides: Partial<FieldRetractionCandidateObservation> = {},
): FieldRetractionCandidateObservation => ({
  observationId: 'obs-old',
  entityKey: ENTITY_KEY,
  field: 'websiteUrl',
  value: STORED_LINK,
  scrapeRunId: 'run-old',
  observedAt: at('2026-11-01T00:00:00Z'),
  sourceUrl: LISTING_PAGE,
  ...overrides,
});

const entity: FieldRetractionEntityState = {
  entityId: 'entity-1',
  entityKey: ENTITY_KEY,
  manuallyLockedFields: [],
  storedValues: { websiteUrl: STORED_LINK },
  liveObservationCountByField: { websiteUrl: 1 },
};

const TWO_REFUSING_READS = [
  refusingRead('run-a', '2026-11-10T00:00:00Z'),
  refusingRead('run-b', '2026-11-12T00:00:00Z'),
];

function plan(
  completeReads: FieldRetractionCompleteRead[],
  activeObservations: FieldRetractionCandidateObservation[] = [assertion()],
  contract: SourceFieldRetractionContract = CONTRACT,
  entities: FieldRetractionEntityState[] = [entity],
) {
  return planFieldRetractions({
    sourceName: 'dept-faculty-roster',
    contract,
    completeReads,
    activeObservations,
    entities,
  });
}

describe('a source retracts a value it now refuses on the same page (#5803)', () => {
  it('retracts an identical URL refused by a newer classifier version', () => {
    const result = plan(TWO_REFUSING_READS);
    expect(result.retractions).toHaveLength(1);
    expect(result.retractions[0]).toMatchObject({
      observationIds: ['obs-old'],
      clearsStoredValue: true,
      refusalObservationIds: ['obs-old'],
    });
    expect(result.counts.refusalSupportedObservations).toBe(1);
  });

  it('retracts nothing when the refused URL differs only in its query string', () => {
    const asserted = 'https://synthetic-lab.example.org/index.php?id=7';
    const refused = 'https://synthetic-lab.example.org/index.php?id=5';
    const reads = [
      refusingRead('run-a', '2026-11-10T00:00:00Z', [refusal({ value: refused })]),
      refusingRead('run-b', '2026-11-12T00:00:00Z', [refusal({ value: refused })]),
    ];
    const result = plan(reads, [assertion({ value: asserted })], CONTRACT, [
      { ...entity, storedValues: { websiteUrl: asserted } },
    ]);
    expect(result.retractions).toEqual([]);
    expect(result.counts.absenceNotWitnessed).toBe(1);
  });

  it('retracts nothing when the refusal was read from the same path with another query', () => {
    const reads = [
      refusingRead('run-a', '2026-11-10T00:00:00Z', [
        refusal({ sourceUrl: `${LISTING_PAGE}?page=2` }),
      ]),
      refusingRead('run-b', '2026-11-12T00:00:00Z', [
        refusal({ sourceUrl: `${LISTING_PAGE}?page=2` }),
      ]),
    ];
    const result = plan(reads, [assertion({ sourceUrl: `${LISTING_PAGE}?page=1` })]);
    expect(result.retractions).toEqual([]);
    expect(result.counts.absenceNotWitnessed).toBe(1);
  });

  it('retracts nothing when the refusal names a different URL', () => {
    const reads = [
      refusingRead('run-a', '2026-11-10T00:00:00Z', [refusal({ value: OTHER_LINK })]),
      refusingRead('run-b', '2026-11-12T00:00:00Z', [refusal({ value: OTHER_LINK })]),
    ];
    const result = plan(reads);
    expect(result.retractions).toEqual([]);
    expect(result.counts.absenceNotWitnessed).toBe(1);
  });

  it('retracts nothing when the refusing version is equal to or older than the admitting one', () => {
    for (const admittedVersion of [2, 3]) {
      const result = plan(TWO_REFUSING_READS, [
        assertion({ admittedUnder: [{ classifier: CLASSIFIER, version: admittedVersion }] }),
      ]);
      expect(result.retractions).toEqual([]);
      expect(result.counts.refusalSupportedObservations).toBe(0);
    }
  });

  it('re-asserts the value when a later read admits it again', () => {
    const readmitted = assertion({
      observationId: 'obs-readmitted',
      scrapeRunId: 'run-c',
      observedAt: at('2026-11-14T00:00:00Z'),
    });
    const reads = [...TWO_REFUSING_READS, refusingRead('run-c', '2026-11-14T00:00:00Z', [])];
    const result = plan(reads, [assertion(), readmitted], CONTRACT, [
      { ...entity, liveObservationCountByField: { websiteUrl: 2 } },
    ]);
    expect(result.retractions).toEqual([]);
  });

  it('plans the same retraction from the same evidence and nothing once it is retired', () => {
    const first = plan(TWO_REFUSING_READS);
    const again = plan(TWO_REFUSING_READS);
    expect(again.retractions).toEqual(first.retractions);
    const afterRetirement = plan(TWO_REFUSING_READS, [], CONTRACT, [
      { ...entity, storedValues: {}, liveObservationCountByField: {} },
    ]);
    expect(afterRetirement.retractions).toEqual([]);
    expect(afterRetirement.counts.candidateObservations).toBe(0);
  });

  it('retracts nothing when the refusal was read from a different page', () => {
    const reads = TWO_REFUSING_READS.map((read) => ({
      ...read,
      refusals: [refusal({ sourceUrl: OTHER_PAGE })],
    }));
    expect(plan(reads).retractions).toEqual([]);
  });

  it('retracts nothing when the assertion records no page', () => {
    expect(plan(TWO_REFUSING_READS, [assertion({ sourceUrl: undefined })]).retractions).toEqual([]);
  });

  it('retracts nothing on a refusal by an undeclared classifier or a contract without one', () => {
    const undeclared = TWO_REFUSING_READS.map((read) => ({
      ...read,
      refusals: [refusal({ classifier: 'some-other-classifier' })],
    }));
    expect(plan(undeclared).retractions).toEqual([]);
    expect(plan(TWO_REFUSING_READS, [assertion()], CONTRACT_WITHOUT_REFUSALS).retractions).toEqual(
      [],
    );
  });

  it('still needs two refusing reads, like an absence claim', () => {
    const result = plan([TWO_REFUSING_READS[0]]);
    expect(result.retractions).toEqual([]);
    expect(result.counts.awaitingSecondCompleteRead).toBe(1);
  });

  it('ignores a refusal from the run that made the assertion', () => {
    const reads = [
      refusingRead('run-old', '2026-11-10T00:00:00Z'),
      refusingRead('run-b', '2026-11-12T00:00:00Z'),
    ];
    expect(plan(reads).retractions).toEqual([]);
  });

  it('keeps an absence-claim retraction labelled as one', () => {
    const reads = TWO_REFUSING_READS.map((read) => ({
      ...read,
      assertsNoValueFor: ['websiteUrl'],
    }));
    const result = plan(reads);
    expect(result.retractions).toHaveLength(1);
    expect(result.retractions[0].refusalObservationIds).toBeUndefined();
    expect(result.counts.refusalSupportedObservations).toBe(0);
  });

  it('labels only the observation whose quorum needed a refusal when absence retires a sibling', () => {
    const absenceRead = (scrapeRunId: string, iso: string): FieldRetractionCompleteRead => ({
      entityKey: ENTITY_KEY,
      scrapeRunId,
      observedAt: at(iso),
      assertsNoValueFor: ['websiteUrl'],
      refusals: [],
    });
    const reads = [
      absenceRead('run-x', '2026-11-03T00:00:00Z'),
      absenceRead('run-y', '2026-11-04T00:00:00Z'),
      ...TWO_REFUSING_READS,
    ];
    const observations = [
      assertion({
        observationId: 'obs-absent',
        value: OTHER_LINK,
        scrapeRunId: 'run-older',
        observedAt: at('2026-11-01T00:00:00Z'),
      }),
      assertion({ scrapeRunId: 'run-mid', observedAt: at('2026-11-06T00:00:00Z') }),
    ];
    const result = plan(reads, observations, CONTRACT, [
      { ...entity, liveObservationCountByField: { websiteUrl: 2 } },
    ]);
    expect(result.retractions).toHaveLength(1);
    expect(result.retractions[0].observationIds).toEqual(['obs-absent', 'obs-old']);
    expect(result.retractions[0].refusalObservationIds).toEqual(['obs-old']);
    expect(result.counts.refusalSupportedObservations).toBe(1);
  });

  it('does not carry a refusal label onto a sibling planned after it', () => {
    const absenceRead = (scrapeRunId: string, iso: string): FieldRetractionCompleteRead => ({
      entityKey: ENTITY_KEY,
      scrapeRunId,
      observedAt: at(iso),
      assertsNoValueFor: ['websiteUrl'],
      refusals: [],
    });
    const reads = [
      absenceRead('run-x', '2026-11-03T00:00:00Z'),
      absenceRead('run-y', '2026-11-04T00:00:00Z'),
      ...TWO_REFUSING_READS,
    ];
    const observations = [
      assertion({ scrapeRunId: 'run-mid', observedAt: at('2026-11-06T00:00:00Z') }),
      assertion({
        observationId: 'obs-absent',
        value: OTHER_LINK,
        scrapeRunId: 'run-older',
        observedAt: at('2026-11-01T00:00:00Z'),
      }),
    ];
    const result = plan(reads, observations, CONTRACT, [
      { ...entity, liveObservationCountByField: { websiteUrl: 2 } },
    ]);
    expect(result.retractions[0].observationIds).toEqual(['obs-old', 'obs-absent']);
    expect(result.retractions[0].refusalObservationIds).toEqual(['obs-old']);
  });
});

describe('the sole-holder liveness probe and a refusal (#5803)', () => {
  const livePage = async () => ({ positivelyDead: false });

  it('retains a sole-holder retraction carried wholly by refusals without probing the still-live page', async () => {
    const [retraction] = plan(TWO_REFUSING_READS).retractions;
    const probed: string[] = [];
    const screened = await withholdSoleHolderRetractionsThatStillAnswer([retraction], (value) => {
      probed.push(value);
      return livePage();
    });
    expect(screened.retained).toEqual([retraction]);
    expect(screened.withheld).toEqual([]);
    expect(probed).toEqual([]);
  });

  it('still withholds a sole-holder retraction that an absence claim carried while the page answers', async () => {
    const reads = TWO_REFUSING_READS.map((read) => ({
      ...read,
      assertsNoValueFor: ['websiteUrl'],
    }));
    const [retraction] = plan(reads).retractions;
    const screened = await withholdSoleHolderRetractionsThatStillAnswer([retraction], livePage);
    expect(screened.retained).toEqual([]);
    expect(screened.withheld).toHaveLength(1);
  });
  it('still probes a retraction that mixes a refusal with an absence claim', async () => {
    const absenceRead = (scrapeRunId: string, iso: string): FieldRetractionCompleteRead => ({
      entityKey: ENTITY_KEY,
      scrapeRunId,
      observedAt: at(iso),
      assertsNoValueFor: ['websiteUrl'],
      refusals: [],
    });
    const reads = [
      absenceRead('run-x', '2026-11-03T00:00:00Z'),
      absenceRead('run-y', '2026-11-04T00:00:00Z'),
      ...TWO_REFUSING_READS,
    ];
    const observations = [
      assertion({
        observationId: 'obs-absent',
        value: OTHER_LINK,
        scrapeRunId: 'run-older',
        observedAt: at('2026-11-01T00:00:00Z'),
      }),
      assertion({ scrapeRunId: 'run-mid', observedAt: at('2026-11-06T00:00:00Z') }),
    ];
    const [retraction] = plan(reads, observations, CONTRACT, [
      { ...entity, liveObservationCountByField: { websiteUrl: 2 } },
    ]).retractions;
    expect(retraction.refusalObservationIds).toEqual(['obs-old']);
    expect(retraction.observationIds).toHaveLength(2);
    const probed: string[] = [];
    const screened = await withholdSoleHolderRetractionsThatStillAnswer([retraction], (value) => {
      probed.push(value);
      return livePage();
    });
    expect(probed.length).toBeGreaterThan(0);
    expect(screened.retained).toEqual([]);
    expect(screened.withheld).toHaveLength(1);
  });

  it('still probes a quorum met by one absence read and one refusal read', async () => {
    const reads: FieldRetractionCompleteRead[] = [
      {
        entityKey: ENTITY_KEY,
        scrapeRunId: 'run-a',
        observedAt: at('2026-11-10T00:00:00Z'),
        assertsNoValueFor: ['websiteUrl'],
        refusals: [],
      },
      refusingRead('run-b', '2026-11-12T00:00:00Z'),
    ];
    const [retraction] = plan(reads).retractions;
    expect(retraction.observationIds).toEqual(['obs-old']);
    expect(retraction.refusalObservationIds).toEqual(['obs-old']);
    const probed: string[] = [];
    const screened = await withholdSoleHolderRetractionsThatStillAnswer([retraction], (value) => {
      probed.push(value);
      return livePage();
    });
    expect(probed).toEqual([STORED_LINK]);
    expect(screened.retained).toEqual([]);
    expect(screened.withheld).toHaveLength(1);
  });
});

describe('refusals loaded from witness rows', () => {
  it('files each refusal under the page of the row that carried it and drops malformed entries', () => {
    const loaded = refusalsFromWitnessRows([
      {
        sourceUrl: LISTING_PAGE,
        refusedValues: [
          {
            field: 'websiteUrl',
            value: STORED_LINK,
            reason: 'r',
            classifier: CLASSIFIER,
            classifierVersion: 2,
          },
          { field: 'websiteUrl', value: STORED_LINK, reason: 'r', classifier: CLASSIFIER },
          {
            field: 'websiteUrl',
            value: '',
            reason: 'r',
            classifier: CLASSIFIER,
            classifierVersion: 2,
          },
        ],
      },
      { refusedValues: [{ field: 'websiteUrl', value: STORED_LINK }] },
    ]);
    expect(loaded).toEqual([
      {
        field: 'websiteUrl',
        value: STORED_LINK,
        reason: 'r',
        classifier: CLASSIFIER,
        classifierVersion: 2,
        sourceUrl: LISTING_PAGE,
      },
    ]);
  });
});

describe('refusal classifier declarations', () => {
  it('is declared by no production lane until one ships its own precision-graded PR', () => {
    const declaring = Object.entries(fieldRetractionContracts)
      .filter(([, contract]) => (contract.refusalClassifiers ?? []).length > 0)
      .map(([sourceName]) => sourceName);
    expect(declaring).toEqual([]);
  });

  it('refuses a declaration for a field the contract cannot retract', () => {
    expect(() =>
      assertFieldRetractionContractsAreDeclarable({
        lane: { ...CONTRACT, refusalClassifiers: [{ field: 'email', classifier: CLASSIFIER }] },
      }),
    ).toThrow(/not a retractable field/);
  });

  it('refuses a duplicated declaration', () => {
    expect(() =>
      assertFieldRetractionContractsAreDeclarable({
        lane: {
          ...CONTRACT,
          refusalClassifiers: [
            { field: 'websiteUrl', classifier: CLASSIFIER },
            { field: 'websiteUrl', classifier: CLASSIFIER },
          ],
        },
      }),
    ).toThrow(/more than once/);
  });
});

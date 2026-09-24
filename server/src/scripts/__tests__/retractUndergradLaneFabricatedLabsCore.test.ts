import { describe, expect, it } from 'vitest';
import {
  UNDERGRAD_RESEARCH_LANE,
  entityKeysWithOtherSourceLabEvidence,
  laneEvidenceAssertsALab,
  personNameForRow,
  planUndergradLaneLabRetraction,
  summarizeUndergradLaneLabRefusals,
  type UndergradLaneObservation,
  type UndergradLaneRow,
} from '../retractUndergradLaneFabricatedLabsCore';

const SLUG = 'dept-physics-jordan-avery';

const row = (overrides: Partial<UndergradLaneRow> = {}): UndergradLaneRow => ({
  id: 'id-1',
  slug: SLUG,
  name: 'Jordan Avery Lab',
  kind: 'lab',
  entityType: 'LAB',
  ...overrides,
});

const laneObservation = (
  field: string,
  value: unknown,
  overrides: Partial<UndergradLaneObservation> = {},
): UndergradLaneObservation => ({
  entityKey: SLUG,
  field,
  value,
  sourceName: UNDERGRAD_RESEARCH_LANE,
  ...overrides,
});

const fabricatedLaneClaim = (): UndergradLaneObservation[] => [
  laneObservation('name', 'Jordan Avery Lab'),
  laneObservation('kind', 'lab'),
  laneObservation('entityType', 'LAB'),
  laneObservation('contactName', 'Jordan Avery'),
  laneObservation('websiteUrl', 'https://physics.example.edu/people/jordan-avery'),
  laneObservation('undergradEvidenceQuote', 'Undergraduates may join ongoing research projects.'),
];

const plan = (
  observations: UndergradLaneObservation[],
  rowOverrides: Partial<UndergradLaneRow> = {},
) =>
  planUndergradLaneLabRetraction(
    [row(rowOverrides)],
    observations,
    entityKeysWithOtherSourceLabEvidence(observations),
  );

describe('undergraduate-research lane fabricated lab retraction (#3195)', () => {
  it('retracts a lab claim whose only lane link is a person profile', () => {
    const outcome = plan(fabricatedLaneClaim());
    expect(outcome.refused).toEqual([]);
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0]).toMatchObject({
      slug: SLUG,
      correctedName: 'Jordan Avery Faculty Research',
      correctedKind: 'individual',
      correctedEntityType: 'FACULTY_RESEARCH_AREA',
      laneNameAssertsALab: true,
      laneTypeAssertsALab: true,
    });
  });

  it('keeps the lab claim when the lane linked a lab site of its own', () => {
    const observations = fabricatedLaneClaim().map((observation) =>
      observation.field === 'websiteUrl'
        ? { ...observation, value: 'https://averylab.example.edu/' }
        : observation,
    );
    const outcome = plan(observations);
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('lane-evidence-asserts-a-lab');
  });

  it('keeps the lab claim when the lane quoted page text naming a laboratory', () => {
    const observations = fabricatedLaneClaim().map((observation) =>
      observation.field === 'undergradEvidenceQuote'
        ? { ...observation, value: 'Students work in the Avery Laboratory on detector assembly.' }
        : observation,
    );
    expect(plan(observations).refused[0].reason).toBe('lane-evidence-asserts-a-lab');
  });

  // The lane reads pages, so its own name/kind/entityType must never corroborate
  // itself: that is the whole reason the grant-cohort repair's scope could not just be
  // widened onto this one.
  it('never lets the lane’s own identity claim corroborate itself', () => {
    expect(
      laneEvidenceAssertsALab([
        laneObservation('name', 'Jordan Avery Lab'),
        laneObservation('kind', 'lab'),
        laneObservation('entityType', 'LAB'),
      ]),
    ).toBe(false);
    expect(entityKeysWithOtherSourceLabEvidence(fabricatedLaneClaim()).size).toBe(0);
  });

  it('keeps the lab claim when another page-reading source asserts it', () => {
    for (const corroboration of [
      { field: 'name', value: 'Avery Lab' },
      { field: 'kind', value: 'lab' },
      { field: 'entityType', value: 'LAB' },
    ]) {
      const observations = [
        ...fabricatedLaneClaim(),
        {
          entityKey: SLUG,
          field: corroboration.field,
          value: corroboration.value,
          sourceName: 'lab-microsite-description-llm',
        },
      ];
      const outcome = plan(observations);
      expect(outcome.plans).toEqual([]);
      expect(outcome.refused[0].reason).toBe('lab-corroborated-by-another-source');
    }
  });

  it('keeps the lab claim when the row carries a lab website of its own', () => {
    const outcome = plan(fabricatedLaneClaim(), {
      websiteUrl: 'https://averylab.example.edu/',
    });
    expect(outcome.refused[0].reason).toBe('carries-a-lab-website-of-its-own');
  });

  it('never reverses an operator decision', () => {
    for (const field of ['name', 'kind', 'entityType']) {
      const outcome = plan(fabricatedLaneClaim(), { manuallyLockedFields: [field] });
      expect(outcome.refused[0].reason).toBe('manually-locked');
    }
  });

  it('refuses a row it cannot reduce to a person name rather than guessing', () => {
    const observations = fabricatedLaneClaim().filter(
      (observation) => observation.field !== 'contactName',
    );
    const outcome = planUndergradLaneLabRetraction(
      [row({ name: 'Lab' })],
      observations.map((observation) =>
        observation.field === 'name' ? { ...observation, value: 'Lab' } : observation,
      ),
      new Set(),
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('name-does-not-reduce-to-a-person-name');
  });

  it('refuses a heading that names somebody the key does not', () => {
    const observations = fabricatedLaneClaim().map((observation) =>
      observation.field === 'contactName' ? { ...observation, value: 'Riley Nguyen' } : observation,
    );
    const outcome = plan(observations);
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('name-does-not-match-the-entity-key');
  });

  it('skips a row the lane never claimed a lab for', () => {
    const observations = [
      laneObservation('name', 'Jordan Avery Faculty Research'),
      laneObservation('kind', 'individual'),
      laneObservation('entityType', 'FACULTY_RESEARCH_AREA'),
    ];
    const outcome = plan(observations, {
      name: 'Jordan Avery Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('lane-asserts-no-lab');
  });

  // The type arm has to stand on its own: a row whose stored name was already corrected
  // by an earlier pass still serves a Lab pill off kind/entityType, and keying the type
  // arm on the name arm is how a repair reports success while doing half its job (#2858).
  it('retracts a type-only lab claim whose name no longer asserts one', () => {
    const observations = fabricatedLaneClaim().map((observation) =>
      observation.field === 'name'
        ? { ...observation, value: 'Jordan Avery Faculty Research' }
        : observation,
    );
    const outcome = plan(observations, { name: 'Jordan Avery Faculty Research' });
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0].laneNameAssertsALab).toBe(false);
    expect(outcome.plans[0].laneTypeAssertsALab).toBe(true);
  });

  it('reads the person from the heading the lane recorded, not from the fabricated name', () => {
    expect(personNameForRow(row(), fabricatedLaneClaim())).toBe('Jordan Avery');
    expect(
      personNameForRow(
        row(),
        fabricatedLaneClaim().filter((observation) => observation.field !== 'contactName'),
      ),
    ).toBe('Jordan Avery');
  });

  it('counts every refusal reason it can emit', () => {
    const counts = summarizeUndergradLaneLabRefusals([
      { reason: 'lane-evidence-asserts-a-lab' },
      { reason: 'lane-evidence-asserts-a-lab' },
      { reason: 'lab-corroborated-by-another-source' },
    ]);
    expect(counts['lane-evidence-asserts-a-lab']).toBe(2);
    expect(counts['lab-corroborated-by-another-source']).toBe(1);
    expect(counts['manually-locked']).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  edgeCarriesEvidence,
  selectWitnessedFraLabFolds,
  type WitnessedFoldEdge,
  type WitnessedFoldEntity,
} from '../witnessedFraLabFold';

const facultyRow: WitnessedFoldEntity = {
  id: 'faculty-row',
  slug: 'faculty-research-area-ada-alpha',
  name: 'Ada Alpha Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
};
const lab = (overrides: Partial<WitnessedFoldEntity> = {}): WitnessedFoldEntity => ({
  id: 'own-lab',
  slug: 'synthetic-sediment-lab',
  name: 'Coastal Sediment Lab',
  entityType: 'LAB',
  leadVerification: {
    state: 'verified',
    leads: [{ personId: 'ada', role: 'PI', verdict: 'CONFIRMED', matchedBy: 'NAMED_ON_PAGE' }],
  },
  ...overrides,
});
const entities = (...rows: WitnessedFoldEntity[]) => new Map(rows.map((row) => [row.id, row]));
const edge = (
  personId: string,
  entityId: string,
  role = 'PI',
  evidenced = true,
): WitnessedFoldEdge => ({
  personId,
  entityId,
  role,
  evidenced,
});

describe('a faculty research row folds into its lead’s own lab only on a witness (#5969)', () => {
  it('folds on the lab page naming the person who holds the lab’s PI edge', () => {
    const { folds } = selectWitnessedFraLabFolds({
      entities: entities(facultyRow, lab()),
      edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab')],
    });
    expect(folds).toEqual([
      {
        personId: 'ada',
        facultyRowId: 'faculty-row',
        labId: 'own-lab',
        witness: 'lab-page-names-pi',
      },
    ]);
  });

  it('never folds into a co-director’s separate lab', () => {
    const separateLab = lab({
      id: 'colleague-lab',
      leadVerification: {
        state: 'verified',
        leads: [
          { personId: 'bram', role: 'PI', verdict: 'CONFIRMED', matchedBy: 'NAMED_ON_PAGE' },
          {
            personId: 'ada',
            role: 'CO_DIRECTOR',
            verdict: 'CONFIRMED',
            matchedBy: 'NAMED_ON_PAGE',
          },
        ],
      },
    });
    const { folds } = selectWitnessedFraLabFolds({
      entities: entities(facultyRow, separateLab),
      edges: [
        edge('ada', 'faculty-row'),
        edge('ada', 'colleague-lab', 'CO_DIRECTOR'),
        edge('bram', 'colleague-lab'),
      ],
    });
    expect(folds).toEqual([]);
  });

  it('does not fold when the lab page does not name the person or contradicts a lead', () => {
    for (const leadVerification of [
      { state: 'unstated', leads: [{ personId: 'ada', role: 'PI', verdict: 'UNSTATED' }] },
      {
        state: 'contradicted',
        leads: [
          { personId: 'ada', role: 'PI', verdict: 'CONFIRMED' },
          { personId: 'cy', role: 'PI', verdict: 'CONTRADICTED' },
        ],
      },
      null,
    ]) {
      const { folds } = selectWitnessedFraLabFolds({
        entities: entities(facultyRow, lab({ leadVerification })),
        edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab')],
      });
      expect(folds).toEqual([]);
    }
  });

  it('does not fold into a centre or institute on the page witness', () => {
    const { folds } = selectWitnessedFraLabFolds({
      entities: entities(
        facultyRow,
        lab({ name: 'Center for Synthetic Sediments', kind: 'center' }),
      ),
      edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab')],
    });
    expect(folds).toEqual([]);
  });

  it('refuses when the person has two labs the page witness would both pick', () => {
    const { folds, refusals } = selectWitnessedFraLabFolds({
      entities: entities(facultyRow, lab(), lab({ id: 'second-lab', slug: 'second-lab' })),
      edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab'), edge('ada', 'second-lab')],
    });
    expect(folds).toEqual([]);
    expect(refusals).toEqual([{ facultyRowId: 'faculty-row', reason: 'several-own-labs' }]);
  });

  it('folds a ballot-confirmed pair whose rows share one lead’s edge, keeping the ballot label', () => {
    const { folds } = selectWitnessedFraLabFolds({
      entities: entities(facultyRow, lab({ leadVerification: null })),
      edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab', 'CO_DIRECTOR')],
      ballotPairs: [{ label: 'P99', facultyRowId: 'faculty-row', labId: 'own-lab' }],
    });
    expect(folds).toEqual([
      {
        personId: 'ada',
        facultyRowId: 'faculty-row',
        labId: 'own-lab',
        witness: 'ballot',
        label: 'P99',
      },
    ]);
  });

  it('refuses a ballot pair whose rows share no lead edge or are not a faculty row and a lab', () => {
    const { folds, refusals } = selectWitnessedFraLabFolds({
      entities: entities(
        facultyRow,
        lab({ leadVerification: null }),
        lab({ id: 'other-lab', leadVerification: null }),
      ),
      edges: [edge('ada', 'faculty-row'), edge('bram', 'own-lab')],
      ballotPairs: [
        { label: 'P98', facultyRowId: 'faculty-row', labId: 'own-lab' },
        { label: 'P97', facultyRowId: 'own-lab', labId: 'other-lab' },
      ],
    });
    expect(folds).toEqual([]);
    expect(refusals.map((refusal) => [refusal.label, refusal.reason])).toEqual([
      ['P98', 'no-shared-lead-edge'],
      ['P97', 'not-a-faculty-row-and-a-lab'],
    ]);
  });

  it('refuses when the ballot and the page point the row at different labs', () => {
    const { folds, refusals } = selectWitnessedFraLabFolds({
      entities: entities(
        facultyRow,
        lab(),
        lab({ id: 'ballot-lab', slug: 'ballot-lab', leadVerification: null }),
      ),
      edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab'), edge('ada', 'ballot-lab')],
      ballotPairs: [{ label: 'P96', facultyRowId: 'faculty-row', labId: 'ballot-lab' }],
    });
    expect(folds).toEqual([]);
    expect(refusals).toEqual([{ facultyRowId: 'faculty-row', reason: 'witnesses-disagree' }]);
  });

  it('derives the same fold twice and nothing once the row is folded', () => {
    const input = {
      entities: entities(facultyRow, lab()),
      edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab')],
    };
    expect(selectWitnessedFraLabFolds(input)).toEqual(selectWitnessedFraLabFolds(input));
    expect(
      selectWitnessedFraLabFolds({
        ...input,
        entities: entities({ ...facultyRow, archived: true }, lab()),
      }).folds,
    ).toEqual([]);
  });

  it('does not fold on a lab page that only links the person’s profile', () => {
    const { folds } = selectWitnessedFraLabFolds({
      entities: entities(
        facultyRow,
        lab({
          leadVerification: {
            state: 'verified',
            leads: [
              {
                personId: 'ada',
                role: 'PI',
                verdict: 'CONFIRMED',
                matchedBy: 'OFFICIAL_PROFILE_LINK',
              },
            ],
          },
        }),
      ),
      edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab')],
    });
    expect(folds).toEqual([]);
  });

  it('does not fold on the page witness when the person’s PI edge on the lab carries no evidence', () => {
    const { folds } = selectWitnessedFraLabFolds({
      entities: entities(facultyRow, lab()),
      edges: [edge('ada', 'faculty-row'), edge('ada', 'own-lab', 'PI', false)],
    });
    expect(folds).toEqual([]);
  });

  it('reads an edge with a source or a confidence as evidence and a bare legacy edge as none', () => {
    expect(edgeCarriesEvidence({ confidence: 0 })).toBe(false);
    expect(edgeCarriesEvidence({})).toBe(false);
    expect(edgeCarriesEvidence({ confidence: 0.7 })).toBe(true);
    expect(edgeCarriesEvidence({ sourceName: 'dept-faculty-roster' })).toBe(true);
    expect(edgeCarriesEvidence({ rosterProvenance: { sourceName: 'ysm-faculty-directory' } })).toBe(
      true,
    );
  });
});

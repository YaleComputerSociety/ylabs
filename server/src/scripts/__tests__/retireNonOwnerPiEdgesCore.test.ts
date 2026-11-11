import { describe, expect, it } from 'vitest';
import {
  planNonOwnerPiEdgeRestoration,
  planTraineeRosterArchive,
  planNonOwnerPiEdgeRetirement,
  summarizeNonOwnerPiEdgeRefusals,
  ownEvidenceTitlesByPersonId,
  type LeadTitleEvidence,
  type NonOwnerPiEdgeRow,
} from '../retireNonOwnerPiEdgesCore';
import {
  cannotOwnResearchHome,
  statesResearchOwningAppointment,
} from '../../utils/researchHomeOwnership';
import { researcherHoldsDirectoryIdentity } from '../../utils/researcherIdentity';

const isTrainee = (title?: string) => /postdoc|student/i.test(title || '');

const edge = (over: Partial<NonOwnerPiEdgeRow> = {}): NonOwnerPiEdgeRow => ({
  id: 'edge-1',
  personId: 'person-1',
  entityId: 'entity-1',
  role: 'PI',
  reviewStatus: 'UNREVIEWED',
  ...over,
});

const titles = new Map([
  ['person-1', 'Postdoctoral Associate'],
  ['person-2', 'Professor of Geology'],
]);

const storedOnly = (
  storedTitleByPersonId: ReadonlyMap<string, string>,
  cannotOwnResearchHome: (title?: string) => boolean = isTrainee,
): LeadTitleEvidence => ({
  storedTitleByPersonId,
  ownEvidenceTitlesByPersonId: new Map(),
  cannotOwnResearchHome,
  statesResearchOwningAppointment,
});

describe('planNonOwnerPiEdgeRetirement', () => {
  it('retires an unreviewed, evidence-free PI claim on someone who cannot host', () => {
    const plan = planNonOwnerPiEdgeRetirement([edge()], storedOnly(titles));
    expect(plan.retire.map((row) => row.id)).toEqual(['edge-1']);
    expect(plan.refused).toEqual([]);
  });

  it('leaves a lead who can host alone', () => {
    const plan = planNonOwnerPiEdgeRetirement([edge({ personId: 'person-2' })], storedOnly(titles));
    expect(plan.retire).toEqual([]);
    expect(plan.refused[0].reason).toBe('lead-can-host');
  });

  it('refuses an edge citing a source, since a page naming them deserves a human read', () => {
    const plan = planNonOwnerPiEdgeRetirement(
      [edge({ sourceName: 'dept-faculty-roster' })],
      storedOnly(titles),
    );
    expect(plan.retire).toEqual([]);
    expect(plan.refused[0].reason).toBe('edge-carries-provenance');
  });

  it('refuses an edge an operator already reviewed, whatever the verdict was', () => {
    for (const reviewStatus of ['CONFIRMED', 'DISPUTED', 'PENDING']) {
      const plan = planNonOwnerPiEdgeRetirement([edge({ reviewStatus })], storedOnly(titles));
      expect(plan.retire).toEqual([]);
      expect(plan.refused[0].reason).toBe('edge-already-reviewed');
    }
  });

  it('treats a missing reviewStatus as unreviewed rather than skipping it', () => {
    const plan = planNonOwnerPiEdgeRetirement(
      [edge({ reviewStatus: undefined })],
      storedOnly(titles),
    );
    expect(plan.retire).toHaveLength(1);
  });

  it('refuses a lead with no title at all, since absence is not evidence they are a trainee', () => {
    const plan = planNonOwnerPiEdgeRetirement([edge({ personId: 'person-3' })], storedOnly(titles));
    expect(plan.refused[0].reason).toBe('lead-can-host');
  });
});

describe('summarizeNonOwnerPiEdgeRefusals', () => {
  it('reports every reason including zeros', () => {
    const counts = summarizeNonOwnerPiEdgeRefusals([
      { reason: 'lead-can-host' },
      { reason: 'lead-can-host' },
    ]);
    expect(counts['lead-can-host']).toBe(2);
    expect(counts['edge-carries-provenance']).toBe(0);
    expect(counts['edge-already-reviewed']).toBe(0);
  });
});

describe('planTraineeRosterArchive', () => {
  const row = (over: Partial<Parameters<typeof planTraineeRosterArchive>[0][number]> = {}) => ({
    id: 'r1',
    title: 'Postdoctoral Associate',
    holdsDirectoryIdentity: false,
    hasAnyRoleEdge: false,
    ...over,
  });

  it('archives only a trainee row with no account and no role edge', () => {
    const plan = planTraineeRosterArchive([row()], isTrainee);
    expect(plan.archive).toEqual(['r1']);
  });

  it('keeps a row that backs a Yale account, since removing it breaks that person access', () => {
    const plan = planTraineeRosterArchive([row({ holdsDirectoryIdentity: true })], isTrainee);
    expect(plan.archive).toEqual([]);
    expect(plan.keptBecause['holds a yale directory identity']).toBe(1);
  });

  it('keeps a trainee row that holds its own directory email with no account linked (#5000)', () => {
    const holdsDirectoryIdentity = researcherHoldsDirectoryIdentity({
      identifiers: { netid: 'pd1', email: 'postdoc.fixture@example.test' },
    });
    const plan = planTraineeRosterArchive([row({ holdsDirectoryIdentity })], isTrainee);
    expect(plan.archive).toEqual([]);
    expect(plan.keptBecause['holds a yale directory identity']).toBe(1);
  });

  it('keeps a row holding any role edge, since a postdoc belongs on a lab member list', () => {
    const plan = planTraineeRosterArchive([row({ hasAnyRoleEdge: true })], isTrainee);
    expect(plan.archive).toEqual([]);
    expect(plan.keptBecause['holds a role edge']).toBe(1);
  });

  it('keeps anyone whose title can host', () => {
    const plan = planTraineeRosterArchive([row({ title: 'Professor of Geology' })], isTrainee);
    expect(plan.archive).toEqual([]);
    expect(plan.keptBecause['lead can host']).toBe(1);
  });
});

describe('planNonOwnerPiEdgeRestoration (#5323)', () => {
  const NOTE = 'Retired by this lane.';
  const retired = (over: Record<string, unknown> = {}) => ({
    id: 'edge-1',
    personId: 'person-2',
    entityId: 'entity-1',
    reviewStatus: 'DISPUTED',
    reviewNotes: NOTE,
    ...over,
  });

  it('restores an edge this lane retired once the title no longer refuses', () => {
    expect(
      planNonOwnerPiEdgeRestoration([retired()], NOTE, storedOnly(titles)).map((row) => row.id),
    ).toEqual(['edge-1']);
  });

  it('restores on a title the resolver cleared, since silence is not a refusal', () => {
    const cleared = new Map([['person-3', '']]);
    expect(
      planNonOwnerPiEdgeRestoration([retired({ personId: 'person-3' })], NOTE, storedOnly(cleared)),
    ).toHaveLength(1);
  });

  it('keeps the retirement while the title still refuses', () => {
    expect(
      planNonOwnerPiEdgeRestoration([retired({ personId: 'person-1' })], NOTE, storedOnly(titles)),
    ).toEqual([]);
  });

  it('never reverses another verdict, a cleared dispute, or an edge on a person no longer live', () => {
    expect(
      planNonOwnerPiEdgeRestoration(
        [
          retired({ reviewNotes: 'Retired by another lane.' }),
          retired({ reviewStatus: 'CONFIRMED' }),
          retired({ personId: 'person-gone' }),
        ],
        NOTE,
        storedOnly(titles),
      ),
    ).toEqual([]);
  });

  it('re-derives the same answer on a second run as the retirement half does', () => {
    const restoredOnce = planNonOwnerPiEdgeRestoration([retired()], NOTE, storedOnly(titles));
    const replan = planNonOwnerPiEdgeRetirement(
      restoredOnce.map((row) => edge({ id: row.id, personId: row.personId })),
      storedOnly(titles),
    );
    expect(replan.retire).toEqual([]);
  });
});

describe('own official-profile evidence outweighs a wrong stored title (#5855)', () => {
  const NOTE = 'Retired by this lane.';
  const OFFICIAL_URL = 'https://profiles.example.test/faculty/fixture-person-a';
  const owners = [
    { personId: 'person-a', officialProfileUrls: [OFFICIAL_URL] },
    {
      personId: 'person-b',
      officialProfileUrls: ['https://profiles.example.test/staff/fixture-b'],
    },
  ];
  const storedTitles = new Map([
    ['person-a', 'Senior Clinical Research Coordinator'],
    ['person-b', 'Senior Clinical Research Coordinator'],
  ]);
  const observations = [
    {
      entityKey: 'netid:fixture.a',
      field: 'profileUrls',
      value: { official: `${OFFICIAL_URL}/` },
    },
    {
      entityKey: 'netid:fixture.a',
      field: 'title',
      value: 'Professor of Nursing',
      sourceUrl: 'https://profiles.example.test/faculty-directory',
    },
    {
      entityKey: 'netid:fixture.b',
      field: 'title',
      value: 'Senior Clinical Research Coordinator',
      sourceUrl: 'http://www.profiles.example.test/staff/fixture-b',
    },
  ];
  const evidence = (): LeadTitleEvidence => ({
    storedTitleByPersonId: storedTitles,
    ownEvidenceTitlesByPersonId: ownEvidenceTitlesByPersonId(owners, observations),
    cannotOwnResearchHome,
    statesResearchOwningAppointment,
  });
  const retired = (personId: string) => ({
    id: `edge-${personId}`,
    personId,
    entityId: `entity-${personId}`,
    reviewStatus: 'DISPUTED',
    reviewNotes: NOTE,
  });

  it('joins a title to a person only through that person own official profile link', () => {
    const titlesByPerson = ownEvidenceTitlesByPersonId(owners, observations);
    expect(titlesByPerson.get('person-a')).toEqual(['Professor of Nursing']);
    expect(titlesByPerson.get('person-b')).toEqual(['Senior Clinical Research Coordinator']);
  });

  it('never joins through a shared listing page that names no subject profile', () => {
    const listingOnly = [
      {
        entityKey: 'netid:someone.else',
        field: 'title',
        value: 'Professor of Nursing',
        sourceUrl: 'https://profiles.example.test/faculty-directory',
      },
    ];
    expect(ownEvidenceTitlesByPersonId(owners, listingOnly).has('person-a')).toBe(false);
  });

  it('does not retire a lead whose own profile states a professorship under a stored staff title', () => {
    const plan = planNonOwnerPiEdgeRetirement(
      [edge({ id: 'edge-a', personId: 'person-a' })],
      evidence(),
    );
    expect(plan.retire).toEqual([]);
    expect(plan.refused).toEqual([
      { id: 'edge-a', reason: 'own-evidence-states-owning-appointment' },
    ]);
  });

  it('still retires a genuine staff-only lead whose own profile states the same staff title', () => {
    const plan = planNonOwnerPiEdgeRetirement(
      [edge({ id: 'edge-b', personId: 'person-b' })],
      evidence(),
    );
    expect(plan.retire.map((row) => row.id)).toEqual(['edge-b']);
  });

  it('still retires a staff-only lead with no official-profile evidence at all', () => {
    const plan = planNonOwnerPiEdgeRetirement([edge({ id: 'edge-c', personId: 'person-c' })], {
      ...evidence(),
      storedTitleByPersonId: new Map([['person-c', 'Program Manager']]),
    });
    expect(plan.retire.map((row) => row.id)).toEqual(['edge-c']);
  });

  it('restores a retirement the own-profile evidence contradicts, even while the stored title stays wrong', () => {
    const restorable = planNonOwnerPiEdgeRestoration(
      [retired('person-a'), retired('person-b')],
      NOTE,
      evidence(),
    );
    expect(restorable.map((row) => [row.id, row.ground])).toEqual([
      ['edge-person-a', 'own-evidence-states-owning-appointment'],
    ]);
  });

  it('reads a page heading or a trainee title in the evidence as no ground to keep the lead', () => {
    for (const title of ['Research Affiliates', 'Postdoctoral Associate']) {
      const plan = planNonOwnerPiEdgeRetirement([edge({ id: 'edge-a', personId: 'person-a' })], {
        ...evidence(),
        ownEvidenceTitlesByPersonId: new Map([['person-a', [title]]]),
      });
      expect(plan.retire.map((row) => row.id)).toEqual(['edge-a']);
    }
  });

  it('is a no-op on a second run: the restored edge is neither re-retired nor restored again', () => {
    const firstRun = planNonOwnerPiEdgeRestoration([retired('person-a')], NOTE, evidence());
    expect(firstRun).toHaveLength(1);
    const restoredEdges = firstRun.map((row) =>
      edge({ id: row.id, personId: row.personId, entityId: row.entityId }),
    );
    const secondRetirement = planNonOwnerPiEdgeRetirement(restoredEdges, evidence());
    expect(secondRetirement.retire).toEqual([]);
    const secondRestoration = planNonOwnerPiEdgeRestoration(
      firstRun.map((row) => ({
        ...row,
        reviewStatus: 'UNREVIEWED',
        reviewNotes: 'Restored by this lane.',
      })),
      NOTE,
      evidence(),
    );
    expect(secondRestoration).toEqual([]);
  });
});

describe('statesResearchOwningAppointment', () => {
  it('accepts a faculty appointment and refuses staff, trainee, heading and silence', () => {
    expect(statesResearchOwningAppointment('Professor of Nursing')).toBe(true);
    expect(statesResearchOwningAppointment('Associate Research Scientist')).toBe(true);
    expect(statesResearchOwningAppointment('Senior Clinical Research Coordinator')).toBe(false);
    expect(statesResearchOwningAppointment('Postdoctoral Associate')).toBe(false);
    expect(statesResearchOwningAppointment('Research Affiliates')).toBe(false);
    expect(statesResearchOwningAppointment('')).toBe(false);
    expect(statesResearchOwningAppointment(undefined)).toBe(false);
  });
});

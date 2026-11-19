import { describe, expect, it } from 'vitest';
import {
  personKeyRecordsFromObservations,
  personPageIdentityKey,
  planRekeyedPersonKeyRetirements,
  rekeyPlanCounts,
  type GoverningListingRead,
  type LanePersonObservation,
} from '../rekeyedPersonKeyPlan';
import { directoryIdentityIndexFrom, twinJoinVerdict } from '../rekeyedPersonKeyRetirement';

const ROSTER = 'https://chemistry.example.yale.edu/people/faculty';
const OTHER_ROSTER = 'https://physics.example.yale.edu/people';
const OLD_RUN = 'run-old';
const NEW_RUN = 'run-new';
const OLD_AT = new Date('2026-10-01T00:00:00Z');
const NEW_AT = new Date('2026-11-01T00:00:00Z');

let nextId = 0;

interface PersonRead {
  key: string;
  first: string;
  last: string;
  roster?: string;
  page?: string;
  netid?: string;
  department?: string;
  run: string;
}

function rows(person: PersonRead): LanePersonObservation[] {
  const roster = person.roster ?? ROSTER;
  const at = person.run === OLD_RUN ? OLD_AT : NEW_AT;
  const base = { entityKey: person.key, scrapeRunId: person.run, observedAt: at };
  const out: LanePersonObservation[] = [
    { ...base, id: `o${nextId++}`, field: 'fname', value: person.first, sourceUrl: roster },
    { ...base, id: `o${nextId++}`, field: 'lname', value: person.last, sourceUrl: roster },
    {
      ...base,
      id: `o${nextId++}`,
      field: 'departments',
      value: [person.department ?? 'Chemistry'],
      sourceUrl: roster,
    },
    { ...base, id: `o${nextId++}`, field: 'dataSources', value: ['lane'], sourceUrl: roster },
  ];
  if (person.netid) {
    out.push({
      ...base,
      id: `o${nextId++}`,
      field: 'netid',
      value: person.netid,
      sourceUrl: roster,
    });
  }
  if (person.page) {
    out.push({
      ...base,
      id: `o${nextId++}`,
      field: 'profileUrls',
      value: { departmental: person.page },
      sourceUrl: person.page,
    });
    out.push({
      ...base,
      id: `o${nextId++}`,
      field: 'title',
      value: 'Professor',
      sourceUrl: person.page,
    });
  }
  return out;
}

function governing(...pages: string[]): GoverningListingRead[] {
  return pages.map((page) => ({
    pageKey: personPageIdentityKey(page),
    runId: NEW_RUN,
    readAt: NEW_AT.getTime() - 1,
  }));
}

function plan(people: PersonRead[], reads = governing(ROSTER), directoryRows: any[] = []) {
  return planRekeyedPersonKeyRetirements({
    records: personKeyRecordsFromObservations(people.flatMap(rows)).values(),
    reads,
    directory: directoryIdentityIndexFrom(directoryRows),
  });
}

const PAGE = 'https://chemistry.example.yale.edu/people/wren-tallowmere';

describe('planRekeyedPersonKeyRetirements (#5817)', () => {
  it('admits an old key whose twin from the newer read names the same page and name (a)', () => {
    const result = plan([
      {
        key: 'dept:chem:wren-tallowmere',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        run: OLD_RUN,
      },
      {
        key: 'netid:wt482',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        netid: 'wt482',
        run: NEW_RUN,
      },
    ]);
    expect(result.admitted.map((pair) => [pair.oldKey, pair.newKey, pair.category])).toEqual([
      ['dept:chem:wren-tallowmere', 'netid:wt482', 'a'],
    ]);
    expect(result.admitted[0].observationIds).toHaveLength(6);
    expect(rekeyPlanCounts(result).admitted).toEqual({ '(a) dept: -> netid:': 1 });
  });

  it('is symmetric: a read that loses the address retires the netid key for the dept key', () => {
    const result = plan([
      {
        key: 'netid:wt482',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        netid: 'wt482',
        run: OLD_RUN,
      },
      {
        key: 'dept:chem:wren-tallowmere',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        run: NEW_RUN,
      },
    ]);
    expect(result.admitted.map((pair) => pair.oldKey)).toEqual(['netid:wt482']);
  });

  it('counts the YSM department-prefixed and canonical profile paths as one page', () => {
    const result = plan([
      {
        key: 'dept:chem:wren-tallowmere',
        first: 'Wren',
        last: 'Tallowmere',
        page: 'https://medicine.yale.edu/chemistry/profile/wren-tallowmere/',
        run: OLD_RUN,
      },
      {
        key: 'netid:wt482',
        first: 'Wren',
        last: 'Tallowmere',
        page: 'https://medicine.yale.edu/profile/wren-tallowmere',
        run: NEW_RUN,
      },
    ]);
    expect(result.admitted.map((pair) => pair.category)).toEqual(['a']);
  });

  it('retires nothing for a co-author card: the same page under a different name (f)', () => {
    const result = plan([
      {
        key: 'dept:chem:wren-tallowmere',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        run: OLD_RUN,
      },
      {
        key: 'netid:ob771',
        first: 'Orrin',
        last: 'Bexley',
        page: PAGE,
        netid: 'ob771',
        run: NEW_RUN,
      },
    ]);
    expect(result.admitted).toEqual([]);
    expect(rekeyPlanCounts(result).leftAlone).toEqual({ '(f) dept: -> netid:': 1 });
  });

  it('refuses a name-only match on the same roster with no page (c)', () => {
    const result = plan([
      { key: 'dept:chem:wren-tallowmere', first: 'Wren', last: 'Tallowmere', run: OLD_RUN },
      { key: 'netid:wt482', first: 'Wren', last: 'Tallowmere', page: PAGE, run: NEW_RUN },
    ]);
    expect(result.admitted).toEqual([]);
    expect(rekeyPlanCounts(result).leftAlone).toEqual({ '(c) dept: -> netid:': 1 });
  });

  it('refuses an old key two twins on the read admit (d)', () => {
    const result = plan([
      {
        key: 'dept:chem:wren-tallowmere',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        run: OLD_RUN,
      },
      { key: 'netid:wt482', first: 'Wren', last: 'Tallowmere', page: PAGE, run: NEW_RUN },
      { key: 'netid:wt9', first: 'Wren', last: 'Tallowmere', page: PAGE, run: NEW_RUN },
    ]);
    expect(result.admitted).toEqual([]);
    expect(result.refused.map((refusal) => refusal.reasons)).toEqual([
      ['name-shared-on-listing', 'several-twins-for-one-old-key'],
    ]);
  });

  it('refuses two old keys one twin admits (d)', () => {
    const result = plan([
      {
        key: 'dept:chem:wren-tallowmere',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        run: OLD_RUN,
      },
      {
        key: 'dept:chem:wren-tallowmere-2',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        run: OLD_RUN,
      },
      { key: 'netid:wt482', first: 'Wren', last: 'Tallowmere', page: PAGE, run: NEW_RUN },
    ]);
    expect(result.admitted).toEqual([]);
    expect(result.refused.map((refusal) => refusal.reasons)).toEqual([
      ['several-old-keys-for-one-twin'],
      ['several-old-keys-for-one-twin'],
    ]);
  });

  it('refuses a name two people share on the read, even with the page matching (d)', () => {
    const reads = governing(ROSTER).map((read) => ({
      ...read,
      nameCensus: new Map([['wren-tallowmere', 2]]),
    }));
    const result = plan(
      [
        {
          key: 'dept:chem:wren-tallowmere',
          first: 'Wren',
          last: 'Tallowmere',
          page: PAGE,
          run: OLD_RUN,
        },
        { key: 'netid:wt482', first: 'Wren', last: 'Tallowmere', page: PAGE, run: NEW_RUN },
      ],
      reads,
    );
    expect(result.admitted).toEqual([]);
    expect(result.refused[0].reasons).toEqual(['name-shared-on-listing']);
  });

  it('refuses a name the directory gives to two netids (d)', () => {
    const result = plan(
      [
        {
          key: 'dept:chem:wren-tallowmere',
          first: 'Wren',
          last: 'Tallowmere',
          page: PAGE,
          run: OLD_RUN,
        },
        { key: 'netid:wt482', first: 'Wren', last: 'Tallowmere', page: PAGE, run: NEW_RUN },
      ],
      governing(ROSTER),
      [
        { entityKey: 'wt482', field: 'fname', value: 'Wren' },
        { entityKey: 'wt482', field: 'lname', value: 'Tallowmere' },
        { entityKey: 'wt7', field: 'fname', value: 'Wren' },
        { entityKey: 'wt7', field: 'lname', value: 'Tallowmere' },
      ],
    );
    expect(result.refused[0].reasons).toEqual(['directory-name-names-several-netids']);
  });

  it('admits a directory pairing only when the name and the department agree (b)', () => {
    const people: PersonRead[] = [
      { key: 'dept:chem:wren-tallowmere', first: 'Wren', last: 'Tallowmere', run: OLD_RUN },
      {
        key: 'netid:wt482',
        first: 'Wren',
        last: 'Tallowmere',
        netid: 'wt482',
        page: PAGE,
        run: NEW_RUN,
      },
    ];
    const directory = (department: string) => [
      { entityKey: 'wt482', field: 'fname', value: 'Wren' },
      { entityKey: 'wt482', field: 'lname', value: 'Tallowmere' },
      { entityKey: 'wt482', field: 'primaryDepartment', value: department },
    ];
    expect(plan(people, governing(ROSTER), directory('Department of Chemistry')).admitted).toEqual([
      expect.objectContaining({ oldKey: 'dept:chem:wren-tallowmere', category: 'b' }),
    ]);
    expect(plan(people, governing(ROSTER), directory('Physics')).admitted).toEqual([]);
  });

  it('retires nothing when the old key was read from a listing no complete read governs', () => {
    const result = plan(
      [
        {
          key: 'dept:chem:wren-tallowmere',
          first: 'Wren',
          last: 'Tallowmere',
          page: PAGE,
          roster: ROSTER,
          run: OLD_RUN,
        },
        {
          key: 'netid:wt482',
          first: 'Wren',
          last: 'Tallowmere',
          page: PAGE,
          roster: OTHER_ROSTER,
          run: NEW_RUN,
        },
      ],
      governing(OTHER_ROSTER),
    );
    expect(result.admitted).toEqual([]);
    expect(result.admissibleButNotReread).toEqual([]);
  });

  it('holds back an old key also listed on a page the run did not read', () => {
    const people: PersonRead[] = [
      { key: 'netid:wt482', first: 'Wren', last: 'Tallowmere', page: PAGE, run: OLD_RUN },
      {
        key: 'netid:wt482',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        roster: OTHER_ROSTER,
        department: 'Physics',
        run: OLD_RUN,
      },
      {
        key: 'dept:chem:wren-tallowmere',
        first: 'Wren',
        last: 'Tallowmere',
        page: PAGE,
        run: NEW_RUN,
      },
    ];
    const result = plan(people);
    expect(result.admitted).toEqual([]);
    expect(result.admissibleButNotReread).toEqual([
      { oldKey: 'netid:wt482', newKey: 'dept:chem:wren-tallowmere', category: 'a' },
    ]);
  });
});

describe('twinJoinVerdict (#5817)', () => {
  const pair = { oldKey: 'dept:chem:wren-tallowmere', newKey: 'netid:wt482' };
  const joins =
    (byKey: Record<string, { joinedResearcherId?: string; namingResearcherIds: string[] }>) =>
    async (key: string) =>
      byKey[key] ?? { namingResearcherIds: [] };

  it('retires when the twin joins and is named by the researcher the old key reaches', async () => {
    const verdict = await twinJoinVerdict(
      pair,
      joins({
        [pair.oldKey]: { namingResearcherIds: ['r1'] },
        [pair.newKey]: { joinedResearcherId: 'r1', namingResearcherIds: ['r1'] },
      }),
    );
    expect(verdict).toEqual({ retire: true, basis: 'same-researcher' });
  });

  it('holds when the twin joins a different researcher', async () => {
    const verdict = await twinJoinVerdict(
      pair,
      joins({
        [pair.oldKey]: { joinedResearcherId: 'r1', namingResearcherIds: ['r1'] },
        [pair.newKey]: { joinedResearcherId: 'r2', namingResearcherIds: ['r2'] },
      }),
    );
    expect(verdict).toEqual({ retire: false, reason: 'twin-reaches-another-researcher' });
  });

  it('holds when the researcher the old key reaches cannot name the twin', async () => {
    const verdict = await twinJoinVerdict(
      pair,
      joins({
        [pair.oldKey]: { namingResearcherIds: ['r1'] },
        [pair.newKey]: { joinedResearcherId: 'r1', namingResearcherIds: [] },
      }),
    );
    expect(verdict).toEqual({ retire: false, reason: 'twin-not-named-by-researcher' });
  });

  it('holds an old key that reaches two researchers', async () => {
    const verdict = await twinJoinVerdict(
      pair,
      joins({ [pair.oldKey]: { joinedResearcherId: 'r1', namingResearcherIds: ['r2'] } }),
    );
    expect(verdict).toEqual({ retire: false, reason: 'old-key-reaches-several-researchers' });
  });

  it('retires an old key no researcher reaches, since no join can be lost', async () => {
    expect(await twinJoinVerdict(pair, joins({}))).toEqual({
      retire: true,
      basis: 'old-key-reaches-no-researcher',
    });
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('../centerConfigKeyResolution', () => ({
  resolveCenterConfigKey: vi.fn(async () => ({ kind: 'live' })),
}));
import {
  buildCenterRosterHealthSnapshot,
  centerRosterReadAdmissibility,
  centerRosterReadFromSnapshot,
  planCenterRosterRetirement,
  type CenterRosterGovernedEdge,
  type CenterRosterGovernedObservation,
  type CenterRosterRead,
  type CenterRosterReadMember,
  type CenterRosterStopReason,
} from '../centerRosterRetirement';
import {
  CentersInstitutesScraper,
  type CenterConfig,
  type CenterMember,
  type HtmlFetcher,
} from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';

const CENTER = 'center-fixture';
const at = (hour: number) => new Date(Date.UTC(2026, 8, 1, hour));

const readMember = (slug: string, role = 'core-faculty'): CenterRosterReadMember => ({
  memberKey: `${CENTER}:${slug}`,
  role,
  membershipKey: `official-profile:https://fixture.example.edu/people/${slug}|${role}`,
  relationshipKey: `${CENTER}:faculty-research-area-${slug}:MEMBER_RESEARCH_AREA`,
});

const snapshot = (
  members: CenterRosterReadMember[],
  overrides: {
    stopReason?: CenterRosterStopReason;
    cacheAllowed?: boolean;
    pagesRead?: number;
  } = {},
) =>
  buildCenterRosterHealthSnapshot({
    centerKey: 'fixture',
    entityKey: CENTER,
    members,
    pagesRead: overrides.pagesRead ?? 1,
    readMode: 'html',
    stopReason: overrides.stopReason ?? 'not-paginated',
    cacheAllowed: overrides.cacheAllowed ?? false,
    readAt: at(0),
  });

const read = (runId: string, hour: number, members: CenterRosterReadMember[]): CenterRosterRead => {
  const parsed = centerRosterReadFromSnapshot(snapshot(members), runId, at(hour));
  if (!parsed) throw new Error('fixture read was not admitted');
  return parsed;
};

const SLUGS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];

const memberObservations = (
  slugs: string[],
  hour: number,
  role: (slug: string) => string = () => 'core-faculty',
): CenterRosterGovernedObservation[] =>
  slugs.flatMap((slug) =>
    ['role', 'profileUrl'].map((field) => ({
      observationId: `${slug}-${field}-${hour}`,
      entityKey: `${CENTER}:${slug}`,
      field,
      value: field === 'role' ? role(slug) : `https://fixture.example.edu/people/${slug}`,
      scrapeRunId: `run-${hour}`,
      observedAt: at(hour),
      superseded: false,
    })),
  );

const relationshipObservations = (
  slugs: string[],
  hour: number,
): CenterRosterGovernedObservation[] =>
  slugs.map((slug) => ({
    observationId: `${slug}-rel-${hour}`,
    entityKey: `${CENTER}:faculty-research-area-${slug}:MEMBER_RESEARCH_AREA`,
    field: 'targetEntityKey',
    value: `faculty-research-area-${slug}`,
    scrapeRunId: `run-${hour}`,
    observedAt: at(hour),
    superseded: false,
  }));

const edges = (
  slugs: string[],
  hour: number,
  role = 'CORE_FACULTY',
  legacy = 'core-faculty',
): CenterRosterGovernedEdge[] =>
  slugs.map((slug) => ({
    edgeId: `edge-${slug}-${role}`,
    personId: `person-${slug}`,
    role,
    membershipKey: `official-profile:https://fixture.example.edu/people/${slug}|${legacy}`,
    observedAt: at(hour),
  }));

const fullGoverned = () => ({
  entityKey: CENTER,
  memberObservations: memberObservations(SLUGS, 1),
  relationshipObservations: relationshipObservations(SLUGS, 1),
  edges: edges(SLUGS, 1),
});

const listed = (slugs: string[]) => slugs.map((slug) => readMember(slug));
const withoutFoxtrot = SLUGS.filter((slug) => slug !== 'foxtrot');

describe('center roster read admissibility', () => {
  it('admits only a whole, fetched roster read that listed somebody', () => {
    expect(centerRosterReadAdmissibility(snapshot(listed(SLUGS)))).toBe('read-listed-members');
    expect(centerRosterReadAdmissibility(snapshot([]))).toBe('read-listed-nobody');
    expect(centerRosterReadAdmissibility(snapshot(listed(SLUGS), { stopReason: 'page-cap' }))).toBe(
      'incomplete',
    );
    expect(
      centerRosterReadAdmissibility(snapshot(listed(SLUGS), { stopReason: 'fetch-failed' })),
    ).toBe('incomplete');
    expect(
      centerRosterReadAdmissibility(snapshot(listed(SLUGS), { stopReason: 'extractor-error' })),
    ).toBe('incomplete');
    expect(centerRosterReadAdmissibility(snapshot(listed(SLUGS), { cacheAllowed: true }))).toBe(
      'cache-permitted',
    );
    expect(centerRosterReadAdmissibility(snapshot(listed(SLUGS), { pagesRead: 0 }))).toBe(
      'not-read',
    );
    expect(centerRosterReadAdmissibility({ complete: true })).toBe('unrecorded');
  });
});

describe('planCenterRosterRetirement', () => {
  it('retires nothing after a single complete read that omits a member', () => {
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      reads: [read('run-2', 2, listed(withoutFoxtrot))],
    });
    expect(plan.verdict).toBe('nothing-to-retire');
    expect(plan.counts.memberKeysAwaitingSecondRead).toBe(1);
    expect(plan.counts.edgesAwaitingSecondRead).toBe(1);
  });

  it('retires the member key, its relationship and its edge after two complete reads omit it', () => {
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      reads: [read('run-2', 2, listed(withoutFoxtrot)), read('run-3', 3, listed(withoutFoxtrot))],
    });
    expect(plan.verdict).toBe('retire');
    expect(plan.retiredMemberKeys).toEqual([`${CENTER}:foxtrot`]);
    expect(plan.retiredRelationshipKeys).toEqual([
      `${CENTER}:faculty-research-area-foxtrot:MEMBER_RESEARCH_AREA`,
    ]);
    expect(plan.retiredEdges.map((edge) => edge.edgeId)).toEqual(['edge-foxtrot-CORE_FACULTY']);
    expect(plan.observationIds.sort()).toEqual(
      ['foxtrot-profileUrl-1', 'foxtrot-rel-1', 'foxtrot-role-1'].sort(),
    );
  });

  it('does not count a read from the run that last observed the claim', () => {
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      reads: [read('run-1', 2, listed(withoutFoxtrot)), read('run-3', 3, listed(withoutFoxtrot))],
    });
    expect(plan.retiredMemberKeys).toEqual([]);
  });

  it('starts counting again when a read between two absences lists the member', () => {
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      reads: [
        read('run-2', 2, listed(withoutFoxtrot)),
        read('run-3', 3, listed(SLUGS)),
        read('run-4', 4, listed(withoutFoxtrot)),
      ],
    });
    expect(plan.verdict).toBe('nothing-to-retire');
    expect(plan.counts.edgesAwaitingSecondRead).toBe(1);
  });

  it('ends a stale lead edge and its role claim when two reads list the person under another role', () => {
    const plan = planCenterRosterRetirement({
      entityKey: CENTER,
      memberObservations: [
        ...memberObservations(['alpha'], 1, () => 'director').map((row) => ({
          ...row,
          superseded: true,
        })),
        ...memberObservations(SLUGS, 2),
      ],
      relationshipObservations: relationshipObservations(SLUGS, 2),
      edges: [...edges(['alpha'], 1, 'DIRECTOR', 'director'), ...edges(SLUGS, 2)],
      reads: [read('run-3', 3, listed(SLUGS)), read('run-4', 4, listed(SLUGS))],
    });
    expect(plan.verdict).toBe('retire');
    expect(plan.retiredEdges.map((edge) => edge.role)).toEqual(['DIRECTOR']);
    expect(plan.counts.retiredLeadEdges).toBe(1);
    expect(plan.retiredRoleClaims).toEqual([`${CENTER}:alpha|director`]);
    expect(plan.retiredMemberKeys).toEqual([]);
  });

  it('retires a stale profile URL claim of a member two reads list under another URL', () => {
    const movedAlpha: CenterRosterReadMember = {
      ...readMember('alpha'),
      membershipKey: 'official-profile:https://fixture.example.edu/faculty/alpha|core-faculty',
    };
    const listedWithMovedAlpha = [movedAlpha, ...listed(SLUGS.slice(1))];
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      memberObservations: [
        ...memberObservations(SLUGS, 1),
        {
          observationId: 'alpha-moved-profileUrl-2',
          entityKey: `${CENTER}:alpha`,
          field: 'profileUrl',
          value: 'https://fixture.example.edu/faculty/alpha',
          scrapeRunId: 'run-2',
          observedAt: at(2),
          superseded: false,
        },
      ],
      reads: [read('run-2', 2, listedWithMovedAlpha), read('run-3', 3, listedWithMovedAlpha)],
    });
    expect(plan.retiredProfileClaims).toEqual([
      `${CENTER}:alpha|official-profile:https://fixture.example.edu/people/alpha`,
    ]);
    expect(plan.observationIds).toContain('alpha-profileUrl-1');
    expect(plan.observationIds).not.toContain('alpha-moved-profileUrl-2');
    expect(plan.retiredMemberKeys).toEqual([]);
    expect(plan.retiredRoleClaims).toEqual([]);
  });

  it('freezes the center when two reads would retire more than half of its members', () => {
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      reads: [
        read('run-2', 2, listed(['alpha', 'bravo'])),
        read('run-3', 3, listed(['alpha', 'bravo'])),
      ],
    });
    expect(plan.verdict).toBe('frozen');
    expect(plan.freezeReason).toBe('member-absence-above-ceiling');
    expect(plan.observationIds).toEqual([]);
    expect(plan.retiredEdges).toEqual([]);
  });

  it('freezes the center when its edges would mostly retire even if its keys would not', () => {
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      edges: edges(SLUGS, 1).map((edge) => ({
        ...edge,
        membershipKey: `${edge.membershipKey}-stale`,
      })),
      reads: [read('run-2', 2, listed(SLUGS)), read('run-3', 3, listed(SLUGS))],
    });
    expect(plan.verdict).toBe('frozen');
    expect(plan.freezeReason).toBe('edge-absence-above-ceiling');
  });

  it('freezes the center when the latest read lists far fewer people than an earlier one', () => {
    const many = [...SLUGS, 'golf', 'hotel'];
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      reads: [
        read('run-2', 2, listed(many)),
        read('run-3', 3, listed(withoutFoxtrot)),
        read('run-4', 4, listed(withoutFoxtrot)),
      ],
    });
    expect(plan.verdict).toBe('frozen');
    expect(plan.freezeReason).toBe('discovery-regressed');
  });

  it('leaves an edge whose membership or lead role another source still asserts', () => {
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      edges: [...edges(SLUGS, 1), ...edges(['echo'], 1, 'DIRECTOR', 'director')],
      reads: [
        read('run-2', 2, listed(withoutFoxtrot.filter((slug) => slug !== 'echo'))),
        read('run-3', 3, listed(withoutFoxtrot.filter((slug) => slug !== 'echo'))),
      ],
      protectedMembershipKeys: new Set([
        'official-profile:https://fixture.example.edu/people/foxtrot|core-faculty',
      ]),
      protectedPersonRoles: new Set(['person-echo|DIRECTOR']),
    });
    expect(plan.retiredEdges.map((edge) => edge.edgeId)).toEqual(['edge-echo-CORE_FACULTY']);
    expect(plan.counts.protectedEdges).toBe(2);
  });

  it('never retires an edge that carries no membership key or no observation time', () => {
    const plan = planCenterRosterRetirement({
      ...fullGoverned(),
      edges: [
        ...edges(SLUGS, 1),
        {
          edgeId: 'unkeyed',
          personId: 'p',
          role: 'DIRECTOR',
          membershipKey: '',
          observedAt: at(1),
        },
        {
          edgeId: 'unordered',
          personId: 'q',
          role: 'DIRECTOR',
          membershipKey: 'official-profile:https://fixture.example.edu/people/zulu|director',
          observedAt: null,
        },
      ],
      reads: [read('run-2', 2, listed(withoutFoxtrot)), read('run-3', 3, listed(withoutFoxtrot))],
    });
    expect(plan.retiredEdges.map((edge) => edge.edgeId)).toEqual(['edge-foxtrot-CORE_FACULTY']);
    expect(plan.counts.unkeyedEdges).toBe(1);
    expect(plan.counts.unorderedEdges).toBe(1);
  });
});

const config = (overrides: Partial<CenterConfig> = {}): CenterConfig => ({
  centerKey: 'fixture',
  centerName: 'Fixture Center',
  schoolName: '',
  kind: 'center',
  url: 'https://fixture.example.edu/people',
  homeUrl: 'https://fixture.example.edu/',
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
  ...overrides,
});

const person = (first: string): CenterMember => ({
  name: `${first} Synthetic`,
  role: 'core-faculty',
  profileUrl: `https://fixture.example.edu/people/${first.toLowerCase()}`,
});

async function snapshotsFrom(
  centerConfig: CenterConfig,
  pages: Array<CenterMember[] | Error>,
  useCache = false,
): Promise<{ snapshots: ObservationInput[]; fetched: number }> {
  let fetched = 0;
  const fetcher: HtmlFetcher = async (url) => {
    fetched++;
    const page = pages[Number(new URL(url).searchParams.get('page') || '0')] ?? [];
    if (page instanceof Error) throw page;
    return JSON.stringify(page);
  };
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run',
    sourceId: 'source',
    sourceName: 'centers-institutes-index',
    sourceWeight: 0.8,
    options: { dryRun: true, useCache, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  await new CentersInstitutesScraper([centerConfig], null, fetcher).run(ctx);
  return { snapshots: emitted.filter((obs) => obs.entityType === 'centerRosterHealth'), fetched };
}

const admissibilityOf = (obs: ObservationInput) =>
  centerRosterReadAdmissibility(obs.value as Record<string, unknown>);

describe('the centers lane states what each roster read listed', () => {
  it('records every member key, role, membership key and relationship key of a whole read', async () => {
    const { snapshots } = await snapshotsFrom(config(), [[person('Avery'), person('Blair')]]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].entityKey).toBe('center-fixture');
    expect(admissibilityOf(snapshots[0])).toBe('read-listed-members');
    expect((snapshots[0].value as any).members).toEqual([
      {
        memberKey: 'center-fixture:avery-synthetic',
        role: 'core-faculty',
        membershipKey: 'official-profile:https://fixture.example.edu/people/avery|core-faculty',
        relationshipKey:
          'center-fixture:faculty-research-area-avery-synthetic:MEMBER_RESEARCH_AREA',
      },
      {
        memberKey: 'center-fixture:blair-synthetic',
        role: 'core-faculty',
        membershipKey: 'official-profile:https://fixture.example.edu/people/blair|core-faculty',
        relationshipKey:
          'center-fixture:faculty-research-area-blair-synthetic:MEMBER_RESEARCH_AREA',
      },
    ]);
  });

  it('keeps reading a pager that repeats its first page once before continuing', async () => {
    const first = [person('Avery')];
    const { snapshots } = await snapshotsFrom(config({ paginated: true }), [
      first,
      first,
      [person('Blair')],
      [],
    ]);
    const members = (snapshots[0].value as any).members.map((entry: any) => entry.memberKey);
    expect(members).toEqual(['center-fixture:avery-synthetic', 'center-fixture:blair-synthetic']);
    expect(admissibilityOf(snapshots[0])).toBe('read-listed-members');
  });

  it('records a read that stopped on a later page failure as incomplete', async () => {
    const notFound = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404 },
    });
    const { snapshots } = await snapshotsFrom(config({ paginated: true }), [
      [person('Avery')],
      notFound,
    ]);
    expect((snapshots[0].value as any).status).toBe('partial-read');
    expect(admissibilityOf(snapshots[0])).toBe('incomplete');
  });

  it('records a pager that never ended as incomplete', async () => {
    const pages = Array.from({ length: 40 }, (_, index) => [person(`Member${index}`)]);
    const { snapshots } = await snapshotsFrom(config({ paginated: true }), pages);
    expect((snapshots[0].value as any).read.stopReason).toBe('page-cap');
    expect(admissibilityOf(snapshots[0])).toBe('incomplete');
  });

  it('records an empty roster page as listing nobody', async () => {
    const { snapshots } = await snapshotsFrom(config(), [[]]);
    expect(admissibilityOf(snapshots[0])).toBe('read-listed-nobody');
  });

  it('records an extractor failure as incomplete', async () => {
    const { snapshots } = await snapshotsFrom(
      config({
        extractor: () => {
          throw new Error('selector changed');
        },
      }),
      [[person('Avery')]],
    );
    expect(admissibilityOf(snapshots[0])).toBe('incomplete');
  });

  it('records a cache-permitted read as not admissible', async () => {
    const { snapshots } = await snapshotsFrom(config(), [[person('Avery')]], true);
    expect(admissibilityOf(snapshots[0])).toBe('cache-permitted');
  });

  it('states nothing when the first page 404s or the roster site is refused', async () => {
    const notFound = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404 },
    });
    expect((await snapshotsFrom(config(), [notFound])).snapshots).toEqual([]);
    const refused = await snapshotsFrom(config({ url: 'https://elsewhere.example.edu/people' }), [
      [person('Avery')],
    ]);
    expect(refused.snapshots).toEqual([]);
    expect(refused.fetched).toBe(0);
  });
});

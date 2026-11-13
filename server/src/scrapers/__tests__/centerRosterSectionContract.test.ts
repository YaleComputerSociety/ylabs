import { describe, expect, it, vi } from 'vitest';

vi.mock('../centerConfigKeyResolution', () => ({
  resolveCenterConfigKey: vi.fn(async () => ({ kind: 'live' })),
}));

import {
  buildCenterRosterHealthSnapshot,
  centerRosterReadFromSnapshot,
  planCenterRosterRetirement,
  resolveCenterRosterSections,
  type CenterRosterGovernedEdge,
  type CenterRosterGovernedObservation,
  type CenterRosterRead,
  type CenterRosterReadMember,
  type CenterRosterSectionKind,
  type CenterRosterSectionRecord,
} from '../centerRosterRetirement';
import {
  CentersInstitutesScraper,
  classifyCenterRosterSectionLabel,
  ispsFacultyFellowsExtractor,
  naturalCarbonCaptureExtractor,
  nodeTeaserPersonExtractor,
  personTypeFilterOptions,
  wordpressBlockParagraphRosterExtractor,
  type CenterConfig,
  type HtmlFetcher,
} from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';

const CENTER = 'center-fixture';
const at = (hour: number) => new Date(Date.UTC(2026, 10, 1, hour));
const PROFILE = (slug: string) => `https://fixture.example.edu/people/${slug}`;

const teaser = (slug: string, title = 'Professor of Synthetic Studies') => `
  <article class="node-teaser node-teaser--person">
    <div class="node-teaser__heading"><a href="/people/${slug}"><span>${slug} Synthetic</span></a></div>
    <div class="node-teaser__professional-title">${title}</div>
  </article>`;

const referenceCard = (slug: string) => `
  <div class="reference-card">
    <a class="reference-card__heading-link" href="/people/${slug}">${slug} Synthetic</a>
    <div class="reference-card__subheading">Professor</div>
  </div>`;

const directoryCard = (slug: string) => `
  <li class="directory-listing-card">
    <a class="directory-listing-card__heading-link" href="/people/${slug}">${slug} Synthetic</a>
  </li>`;

const wrapper = (heading: string, cards: string) => `
  <div class="component-wrapper">
    <h2 class="component-wrapper__heading">${heading}</h2>${cards}
  </div>`;

const sectionsOf = (members: Array<{ name: string; sections?: unknown }>) =>
  Object.fromEntries(members.map((member) => [member.name, member.sections ?? []]));

describe('classifying center roster section labels (#6084)', () => {
  it.each<[string, CenterRosterSectionKind]>([
    ['Alumni', 'past'],
    ['Former Directors', 'past'],
    ['Past Members', 'past'],
    ['Previous Fellows', 'past'],
    ['In Memoriam', 'past'],
    ['Emeritus Faculty', 'emeritus'],
    ['Faculty Emeriti', 'emeritus'],
    ['Faculty', 'current'],
    ['Current and Former Members', 'current'],
    ['Past Events', 'unclassified'],
    ['Former Speakers', 'unclassified'],
    ['Alumni Advisory Board', 'unclassified'],
    ['Alumni Council', 'unclassified'],
    ['Former Students Steering Committee', 'unclassified'],
    ['', 'unclassified'],
  ])('reads %j as %s', (label, kind) => {
    expect(classifyCenterRosterSectionLabel(label)).toBe(kind);
  });
});

describe('section detection in the node-teaser extractor', () => {
  it('files each card under the last content heading before it, ignoring site chrome', () => {
    const html = `
      <nav><h2>Alumni</h2></nav>
      <main>
        ${teaser('alpha')}
        <h2>Faculty</h2>${teaser('bravo')}
        <h2>Emeritus Faculty</h2>${teaser('charlie', 'Professor Emeritus of Synthetic Studies')}
        <h3>Alumni</h3>${teaser('delta')}
        <h3>In Memoriam</h3>${teaser('echo')}
      </main>
      <footer><h2>Former Directors</h2></footer>`;
    const { members } = nodeTeaserPersonExtractor(html, {
      pageUrl: 'https://fixture.example.edu/',
    });
    expect(sectionsOf(members)).toEqual({
      'alpha Synthetic': [],
      'bravo Synthetic': [{ label: 'Faculty', kind: 'current' }],
      'charlie Synthetic': [{ label: 'Emeritus Faculty', kind: 'emeritus' }],
      'delta Synthetic': [{ label: 'Alumni', kind: 'past' }],
      'echo Synthetic': [{ label: 'In Memoriam', kind: 'past' }],
    });
  });

  it('reads the person-type filter a listing offers, skipping the any-type option', () => {
    const html = `
      <select name="person_type">
        <option value="All">- Any -</option>
        <option value="11">Faculty</option>
        <option value="12">Alumni</option>
        <option value="13">Emeritus Faculty</option>
      </select>`;
    expect(personTypeFilterOptions(html)).toEqual([
      { param: 'person_type', value: '11', label: 'Faculty', kind: 'current' },
      { param: 'person_type', value: '12', label: 'Alumni', kind: 'past' },
      { param: 'person_type', value: '13', label: 'Emeritus Faculty', kind: 'emeritus' },
    ]);
  });
});

describe('section detection in the heading-scoped extractors', () => {
  it('stops reading an emeritus or former faculty heading as current', () => {
    const html = [
      wrapper('Directors', referenceCard('alpha')),
      wrapper('Emeritus Faculty', referenceCard('bravo')),
      wrapper('Former Directors', referenceCard('charlie')),
      wrapper('Postdoctoral Associates', referenceCard('delta')),
    ].join('');
    const { members } = naturalCarbonCaptureExtractor(html, {
      pageUrl: 'https://fixture.example.edu/people',
    });
    expect(sectionsOf(members)).toEqual({
      'alpha Synthetic': [{ label: 'Directors', kind: 'current' }],
      'bravo Synthetic': [{ label: 'Emeritus Faculty', kind: 'emeritus' }],
      'charlie Synthetic': [{ label: 'Former Directors', kind: 'past' }],
    });
  });

  it('records a person under both a current and a past heading', () => {
    const html = [
      wrapper('Faculty Affiliates', referenceCard('alpha')),
      wrapper('Former Faculty', referenceCard('alpha')),
    ].join('');
    const { members } = naturalCarbonCaptureExtractor(html, {
      pageUrl: 'https://fixture.example.edu/people',
    });
    expect(members).toHaveLength(1);
    expect(members[0].sections).toEqual([
      { label: 'Faculty Affiliates', kind: 'current' },
      { label: 'Former Faculty', kind: 'past' },
    ]);
  });

  it('reads a former section beside the only section the ISPS reader keeps', () => {
    const html = [
      wrapper('Faculty Fellows', directoryCard('alpha')),
      wrapper('Former Faculty Fellows', directoryCard('bravo')),
      wrapper('Affiliated Faculty', directoryCard('charlie')),
    ].join('');
    const { members } = ispsFacultyFellowsExtractor(html, {
      pageUrl: 'https://fixture.example.edu/faculty',
    });
    expect(sectionsOf(members)).toEqual({
      'alpha Synthetic': [{ label: 'Faculty Fellows', kind: 'current' }],
      'bravo Synthetic': [{ label: 'Former Faculty Fellows', kind: 'past' }],
    });
  });

  it('reads a former heading in the WordPress paragraph walk', () => {
    const html = `
      <div class="entry-content">
        <h2>Faculty</h2>
        <p class="wp-block-paragraph"><a href="https://alpha.example.edu/">Alpha Synthetic</a><br><em>topics</em></p>
        <h2>Former Faculty</h2>
        <p class="wp-block-paragraph"><a href="https://bravo.example.edu/">Bravo Synthetic</a><br><em>topics</em></p>
      </div>`;
    const { members } = wordpressBlockParagraphRosterExtractor(html, {
      pageUrl: 'https://fixture.example.edu/people/',
    });
    expect(sectionsOf(members)).toEqual({
      'Alpha Synthetic': [{ label: 'Faculty', kind: 'current' }],
      'Bravo Synthetic': [{ label: 'Former Faculty', kind: 'past' }],
    });
  });
});

describe('resolving the sections of one read', () => {
  const listing = (
    slug: string,
    label: string,
    kind: CenterRosterSectionKind,
    stageKey = '',
    pageIndex = 0,
  ) => ({ memberKey: `${CENTER}:${slug}`, label, kind, stageKey, pageIndex });
  const roster = { key: '', personTypeFilter: false, stopReason: 'not-paginated' as const };

  it('drops a section whose fingerprint duplicates another, so a sidebar is not a section', () => {
    const { sections, memberSections } = resolveCenterRosterSections(
      [
        listing('alpha', 'Faculty', 'current'),
        listing('bravo', 'Faculty', 'current'),
        listing('alpha', 'Alumni', 'past'),
        listing('bravo', 'Alumni', 'past'),
      ],
      [roster],
    );
    expect(sections.map((section) => section.label)).toEqual(['Faculty']);
    expect(memberSections.get(`${CENTER}:alpha`)?.kind).toBe('current');
    expect(memberSections.get(`${CENTER}:bravo`)?.kind).toBe('current');
  });

  it('keeps a past section with its own members, and current wins for a person in both', () => {
    const { sections, memberSections } = resolveCenterRosterSections(
      [
        listing('alpha', 'Faculty', 'current'),
        listing('bravo', 'Alumni', 'past'),
        listing('alpha', 'Alumni', 'past'),
      ],
      [roster],
    );
    expect(sections.map((section) => [section.label, section.kind, section.listedCount])).toEqual([
      ['Faculty', 'current', 1],
      ['Alumni', 'past', 2],
    ]);
    expect(memberSections.get(`${CENTER}:alpha`)?.kind).toBe('current');
    expect(memberSections.get(`${CENTER}:bravo`)?.kind).toBe('past');
  });

  it('lets a finished person-type filter outrank the unfiltered listing, and an unfinished one not', () => {
    const listings = [
      listing('alpha', '', 'unclassified'),
      listing('bravo', '', 'unclassified'),
      listing('alpha', 'Faculty', 'current', 'person_type=1'),
      listing('bravo', 'Alumni', 'past', 'person_type=2'),
    ];
    const finished = resolveCenterRosterSections(listings, [
      roster,
      { key: 'person_type=1', personTypeFilter: true, stopReason: 'empty-page' },
      { key: 'person_type=2', personTypeFilter: true, stopReason: 'empty-page' },
    ]);
    expect(finished.memberSections.get(`${CENTER}:bravo`)?.kind).toBe('past');
    expect(finished.sections.find((section) => section.label === 'Alumni')).toMatchObject({
      complete: true,
      personTypeFilter: true,
    });

    const unfinished = resolveCenterRosterSections(listings, [
      roster,
      { key: 'person_type=1', personTypeFilter: true, stopReason: 'fetch-failed' },
      { key: 'person_type=2', personTypeFilter: true, stopReason: 'empty-page' },
    ]);
    expect(unfinished.memberSections.get(`${CENTER}:bravo`)?.kind).toBe('unclassified');
    expect(unfinished.sections.find((section) => section.label === 'Faculty')?.complete).toBe(
      false,
    );
  });

  it('gives no section to a member only an unfinished set of filter passes listed', () => {
    const { memberSections } = resolveCenterRosterSections(
      [
        listing('alpha', '', 'unclassified'),
        listing('alpha', 'Faculty', 'current', 'person_type=1'),
        listing('charlie', 'Alumni', 'past', 'person_type=2'),
      ],
      [
        roster,
        { key: 'person_type=1', personTypeFilter: true, stopReason: 'fetch-failed' },
        { key: 'person_type=2', personTypeFilter: true, stopReason: 'empty-page' },
      ],
    );
    expect(memberSections.has(`${CENTER}:charlie`)).toBe(false);
    expect(memberSections.get(`${CENTER}:alpha`)?.kind).toBe('unclassified');
  });
});

const readMember = (
  slug: string,
  section?: { kind: CenterRosterSectionKind; label: string; fingerprint: string },
  extra: Partial<CenterRosterReadMember> = {},
): CenterRosterReadMember => ({
  memberKey: `${CENTER}:${slug}`,
  role: 'core-faculty',
  membershipKey: `official-profile:${PROFILE(slug)}|core-faculty`,
  relationshipKey: section?.kind === 'past' ? '' : `${CENTER}:fra-${slug}:MEMBER_RESEARCH_AREA`,
  ...(section
    ? {
        sectionKind: section.kind,
        sectionLabel: section.label,
        sectionFingerprint: section.fingerprint,
      }
    : {}),
  ...extra,
});

const SLUGS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
const CURRENT_SECTION = { kind: 'current' as const, label: 'Faculty', fingerprint: 'current-fp' };
const ALUMNI_SECTION = { kind: 'past' as const, label: 'Alumni', fingerprint: 'alumni-fp' };
const EMERITUS_SECTION = {
  kind: 'emeritus' as const,
  label: 'Emeritus Faculty',
  fingerprint: 'emeritus-fp',
};

const sectionRecord = (
  section: { kind: CenterRosterSectionKind; label: string; fingerprint: string },
  complete = true,
): CenterRosterSectionRecord => ({
  label: section.label,
  kind: section.kind,
  listedCount: 1,
  fingerprint: section.fingerprint,
  complete,
  stopReason: complete ? 'not-paginated' : 'page-cap',
  pagesRead: 1,
});

const contractRead = (
  runId: string,
  hour: number,
  members: CenterRosterReadMember[],
  sections: CenterRosterSectionRecord[] = [
    sectionRecord(CURRENT_SECTION),
    sectionRecord(ALUMNI_SECTION),
    sectionRecord(EMERITUS_SECTION),
  ],
  options: { recordSections?: boolean; adoptsSectionContract?: boolean } = {},
): CenterRosterRead => {
  const snapshot = buildCenterRosterHealthSnapshot({
    centerKey: 'fixture',
    entityKey: CENTER,
    members,
    pagesRead: 1,
    readMode: 'html',
    stopReason: 'not-paginated',
    cacheAllowed: false,
    readAt: at(hour),
    ...(options.recordSections === false ? {} : { sections }),
  });
  const read = centerRosterReadFromSnapshot(snapshot, runId, at(hour), {
    adoptsSectionContract: options.adoptsSectionContract ?? true,
  });
  if (!read) throw new Error('fixture read was not admitted');
  return read;
};

const currentMembers = (except: string[] = []) =>
  SLUGS.filter((slug) => !except.includes(slug)).map((slug) => readMember(slug, CURRENT_SECTION));

const memberObservations = (slugs: string[], hour: number): CenterRosterGovernedObservation[] =>
  slugs.flatMap((slug) =>
    ['role', 'profileUrl'].map((field) => ({
      observationId: `${slug}-${field}-${hour}`,
      entityKey: `${CENTER}:${slug}`,
      field,
      value: field === 'role' ? 'core-faculty' : PROFILE(slug),
      scrapeRunId: `run-${hour}`,
      observedAt: at(hour),
      superseded: false,
    })),
  );

const edges = (slugs: string[], hour: number): CenterRosterGovernedEdge[] =>
  slugs.map((slug) => ({
    edgeId: `edge-${slug}`,
    personId: `person-${slug}`,
    role: 'CORE_FACULTY',
    membershipKey: `official-profile:${PROFILE(slug)}|core-faculty`,
    observedAt: at(hour),
  }));

const plan = (reads: CenterRosterRead[], witnessedPersonIds = new Set<string>()) =>
  planCenterRosterRetirement({
    entityKey: CENTER,
    reads,
    memberObservations: memberObservations(SLUGS, 1),
    relationshipObservations: [],
    edges: edges(SLUGS, 1),
    witnessedPersonIds,
  });

const withFoxtrotUnder = (
  section: { kind: CenterRosterSectionKind; label: string; fingerprint: string },
  extra = {},
) => [...currentMembers(['foxtrot']), readMember('foxtrot', section, extra)];

describe('departed versus omitted under the section contract', () => {
  it('does not end an edge on one read that lists the person under a past section', () => {
    const result = plan([contractRead('run-2', 2, withFoxtrotUnder(ALUMNI_SECTION))]);
    expect(result.retiredEdges).toEqual([]);
    expect(result.counts.departedEdgesAwaitingSecondRead).toBe(1);
  });

  it('ends the edge as departed, with the section label, after two reads in distinct runs', () => {
    const result = plan([
      contractRead('run-2', 2, withFoxtrotUnder(ALUMNI_SECTION)),
      contractRead('run-3', 3, withFoxtrotUnder(ALUMNI_SECTION)),
    ]);
    expect(result.retiredEdges).toEqual([
      {
        edgeId: 'edge-foxtrot',
        role: 'CORE_FACULTY',
        membershipKey: `official-profile:${PROFILE('foxtrot')}|core-faculty`,
        verdict: 'departed',
        sectionLabel: 'Alumni',
      },
    ]);
    expect(result.counts.departedEdges).toBe(1);
    expect(result.retiredMemberKeys).toEqual([]);
  });

  it('does not count the same run twice', () => {
    const result = plan([
      contractRead('run-2', 2, withFoxtrotUnder(ALUMNI_SECTION)),
      contractRead('run-2', 3, withFoxtrotUnder(ALUMNI_SECTION)),
    ]);
    expect(result.retiredEdges).toEqual([]);
  });

  it('ends an emeritus-listed edge, and only that center edge', () => {
    const result = plan([
      contractRead('run-2', 2, withFoxtrotUnder(EMERITUS_SECTION)),
      contractRead('run-3', 3, withFoxtrotUnder(EMERITUS_SECTION)),
    ]);
    expect(result.retiredEdges.map((edge) => [edge.edgeId, edge.sectionLabel])).toEqual([
      ['edge-foxtrot', 'Emeritus Faculty'],
    ]);
    expect(result.observationIds).toEqual([]);
  });

  it('reads an emeritus listing whose own page went unread as omitted, never departed', () => {
    const unread = { ownPageUnread: true };
    const result = plan([
      contractRead('run-2', 2, withFoxtrotUnder(EMERITUS_SECTION, unread)),
      contractRead('run-3', 3, withFoxtrotUnder(EMERITUS_SECTION, unread)),
    ]);
    expect(result.retiredEdges).toEqual([]);
    expect(result.counts.departedEdges).toBe(0);
    expect(result.counts.omittedUnwitnessedEdges).toBe(1);
  });

  it('lets a current appointment the own page states win over an emeritus listing', () => {
    const ownPage = { ownPageCurrentAppointment: true };
    const result = plan([
      contractRead('run-2', 2, withFoxtrotUnder(EMERITUS_SECTION, ownPage)),
      contractRead('run-3', 3, withFoxtrotUnder(EMERITUS_SECTION, ownPage)),
    ]);
    expect(result.retiredEdges).toEqual([]);
    expect(result.counts.departedEdgesAwaitingSecondRead).toBe(0);
  });

  it('never reads a past listing in an unfinished section as a departure', () => {
    const unfinished = [sectionRecord(CURRENT_SECTION), sectionRecord(ALUMNI_SECTION, false)];
    const result = plan([
      contractRead('run-2', 2, withFoxtrotUnder(ALUMNI_SECTION), unfinished),
      contractRead('run-3', 3, withFoxtrotUnder(ALUMNI_SECTION), unfinished),
    ]);
    expect(result.retiredEdges).toEqual([]);
    expect(result.counts.departedEdges).toBe(0);
    expect(result.counts.omittedUnwitnessedEdges).toBe(1);
  });

  it('holds an omitted person with no witness and counts it as omitted-unwitnessed', () => {
    const result = plan([
      contractRead('run-2', 2, currentMembers(['foxtrot'])),
      contractRead('run-3', 3, currentMembers(['foxtrot'])),
    ]);
    expect(result.verdict).toBe('nothing-to-retire');
    expect(result.retiredEdges).toEqual([]);
    expect(result.retiredMemberKeys).toEqual([]);
    expect(result.counts.omittedUnwitnessedEdges).toBe(1);
    expect(result.counts.omittedUnwitnessedMemberKeys).toBe(1);
  });

  it('retires an omitted person once their own page witnesses the departure', () => {
    const result = plan(
      [
        contractRead('run-2', 2, currentMembers(['foxtrot'])),
        contractRead('run-3', 3, currentMembers(['foxtrot'])),
      ],
      new Set(['person-foxtrot']),
    );
    expect(result.retiredEdges.map((edge) => [edge.edgeId, edge.verdict])).toEqual([
      ['edge-foxtrot', 'witnessed-omitted'],
    ]);
    expect(result.retiredMemberKeys).toEqual([`${CENTER}:foxtrot`]);
    expect(result.counts.witnessedOmittedEdges).toBe(1);
  });

  it('never ends an edge from a profile title alone, without a section', () => {
    const result = plan([
      contractRead('run-2', 2, currentMembers()),
      contractRead('run-3', 3, currentMembers()),
    ]);
    expect(result.retiredEdges).toEqual([]);
  });

  it('keeps the plain absence rule for snapshots recorded before the contract', () => {
    const result = plan([
      contractRead('run-2', 2, currentMembers(['foxtrot']), [], { recordSections: false }),
      contractRead('run-3', 3, currentMembers(['foxtrot']), [], { recordSections: false }),
    ]);
    expect(result.retiredEdges.map((edge) => [edge.edgeId, edge.verdict])).toEqual([
      ['edge-foxtrot', 'absent'],
    ]);
    expect(result.retiredMemberKeys).toEqual([`${CENTER}:foxtrot`]);
  });

  it('keeps the plain absence rule for a lane that has not adopted the contract', () => {
    const result = plan([
      contractRead('run-2', 2, currentMembers(['foxtrot']), undefined, {
        adoptsSectionContract: false,
      }),
      contractRead('run-3', 3, currentMembers(['foxtrot']), undefined, {
        adoptsSectionContract: false,
      }),
    ]);
    expect(result.retiredEdges.map((edge) => edge.edgeId)).toEqual(['edge-foxtrot']);
  });

  it('freezes a center whose sections flip most members to past', () => {
    const flipped = [
      readMember('alpha', CURRENT_SECTION),
      readMember('bravo', CURRENT_SECTION),
      ...['charlie', 'delta', 'echo', 'foxtrot'].map((slug) => readMember(slug, ALUMNI_SECTION)),
    ];
    const result = plan([contractRead('run-2', 2, flipped), contractRead('run-3', 3, flipped)]);
    expect(result.verdict).toBe('frozen');
    expect(result.freezeReason).toBe('edge-absence-above-ceiling');
  });
});

describe('the lane emits currentStatus and the section snapshot', () => {
  const YALE_PROFILE = (slug: string) => `https://fixture.yale.edu/people/${slug}`;
  const page = (cards: string) => `<main>${cards}</main>`;
  const yaleTeaser = (slug: string) => `
    <article class="node-teaser node-teaser--person">
      <div class="node-teaser__heading"><a href="${YALE_PROFILE(slug)}"><span>${slug} Synthetic</span></a></div>
    </article>`;

  const UNREADABLE = '\u0000unreadable';
  const config = (overrides: Partial<CenterConfig> = {}): CenterConfig => ({
    centerKey: 'fixture',
    centerName: 'Fixture Center',
    schoolName: '',
    kind: 'center',
    url: 'https://fixture.yale.edu/people',
    homeUrl: 'https://fixture.yale.edu/',
    paginated: false,
    extractor: nodeTeaserPersonExtractor,
    ...overrides,
  });

  async function emittedBy(
    centerConfig: CenterConfig,
    pageFor: (url: URL) => string,
    profileTitles: Record<string, string> = {},
  ): Promise<ObservationInput[]> {
    const fetcher: HtmlFetcher = async (url) => pageFor(new URL(url));
    const memberPages = async (url: string) => {
      const slug = new URL(url).pathname.split('/').pop() || '';
      if (profileTitles[slug] === UNREADABLE) throw new Error('socket hang up');
      return `<html><body><main><p class="profile-title">${profileTitles[slug] ?? ''}</p></main></body></html>`;
    };
    const emitted: ObservationInput[] = [];
    const ctx: ScraperContext = {
      scrapeRunId: 'run',
      sourceId: 'source',
      sourceName: 'centers-institutes-index',
      sourceWeight: 0.8,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: () => {},
    };
    await new CentersInstitutesScraper([centerConfig], null, fetcher, memberPages).run(ctx);
    return emitted;
  }

  const fieldOf = (emitted: ObservationInput[], slug: string, field: string) =>
    emitted.find(
      (obs) => obs.entityKey === `center-fixture:${slug}-synthetic` && obs.field === field,
    )?.value;
  const snapshotOf = (emitted: ObservationInput[]) =>
    emitted.find((obs) => obs.entityType === 'centerRosterHealth')?.value as any;

  it('marks a past listing past, records sections, and emits no relationship for it', async () => {
    const emitted = await emittedBy(config(), () =>
      page(`<h2>Faculty</h2>${yaleTeaser('alpha')}<h2>Alumni</h2>${yaleTeaser('bravo')}`),
    );
    expect(fieldOf(emitted, 'alpha', 'currentStatus')).toBe('current');
    expect(fieldOf(emitted, 'bravo', 'currentStatus')).toBe('past');
    expect(fieldOf(emitted, 'bravo', 'sectionLabel')).toBe('Alumni');
    expect(
      emitted.some(
        (obs) =>
          obs.entityType === 'researchEntityRelationship' && /bravo/.test(obs.entityKey ?? ''),
      ),
    ).toBe(false);
    const snapshot = snapshotOf(emitted);
    expect(snapshot.sectionsRecorded).toBe(true);
    expect(snapshot.sections.map((section: any) => [section.label, section.kind])).toEqual([
      ['Faculty', 'current'],
      ['Alumni', 'past'],
    ]);
    expect(snapshot.sections[1]).toMatchObject({
      listedCount: 1,
      complete: true,
      stopReason: 'not-paginated',
      pagesRead: 1,
    });
    expect(snapshot.members.map((member: any) => [member.memberKey, member.sectionKind])).toEqual([
      ['center-fixture:alpha-synthetic', 'current'],
      ['center-fixture:bravo-synthetic', 'past'],
    ]);
  });

  it('keeps an emeritus listing current when the own page states a current appointment', async () => {
    const emitted = await emittedBy(
      config(),
      () =>
        page(
          `<h2>Faculty</h2>${yaleTeaser('alpha')}<h2>Emeritus Faculty</h2>${yaleTeaser('bravo')}${yaleTeaser('charlie')}`,
        ),
      {
        bravo: 'Professor of Synthetic Studies',
        charlie: 'Professor Emeritus of Synthetic Studies',
      },
    );
    expect(fieldOf(emitted, 'bravo', 'currentStatus')).toBe('current');
    expect(fieldOf(emitted, 'charlie', 'currentStatus')).toBe('emeritus');
    const members = snapshotOf(emitted).members;
    expect(members.find((member: any) => /bravo/.test(member.memberKey))).toMatchObject({
      sectionKind: 'emeritus',
      ownPageCurrentAppointment: true,
    });
  });

  it('never moves a member out of current on an emeritus-only profile title alone', async () => {
    const emitted = await emittedBy(config(), () => page(yaleTeaser('alpha')), {
      alpha: 'Professor Emeritus of Synthetic Studies',
    });
    expect(fieldOf(emitted, 'alpha', 'currentStatus')).toBe('current');
    expect(snapshotOf(emitted).members[0].sectionKind).toBe('unclassified');
  });

  it('reads each person-type filter the listing offers and files its people under it', async () => {
    const filter = `
      <select name="person_type">
        <option value="All">- Any -</option>
        <option value="1">Faculty</option>
        <option value="2">Alumni</option>
      </select>`;
    const emitted = await emittedBy(config({ paginated: true }), (url) => {
      const type = url.searchParams.get('person_type');
      const pageIndex = Number(url.searchParams.get('page') || '0');
      if (pageIndex > 0) return page('');
      if (type === '1') return page(yaleTeaser('alpha'));
      if (type === '2') return page(yaleTeaser('bravo'));
      return page(`${filter}${yaleTeaser('alpha')}${yaleTeaser('bravo')}`);
    });
    expect(fieldOf(emitted, 'alpha', 'currentStatus')).toBe('current');
    expect(fieldOf(emitted, 'bravo', 'currentStatus')).toBe('past');
    expect(fieldOf(emitted, 'bravo', 'sectionLabel')).toBe('Alumni');
    const alumni = snapshotOf(emitted).sections.find((section: any) => section.label === 'Alumni');
    expect(alumni).toMatchObject({ kind: 'past', complete: true, personTypeFilter: true });
  });

  it('reads nothing past when a person-type filter read fails', async () => {
    const filter = `<select name="person_type"><option value="1">Faculty</option><option value="2">Alumni</option></select>`;
    const emitted = await emittedBy(config({ paginated: true }), (url) => {
      const type = url.searchParams.get('person_type');
      const pageIndex = Number(url.searchParams.get('page') || '0');
      if (type === '1') throw new Error('socket hang up');
      if (pageIndex > 0) return page('');
      if (type === '2') return page(yaleTeaser('bravo'));
      return page(`${filter}${yaleTeaser('alpha')}${yaleTeaser('bravo')}`);
    });
    expect(fieldOf(emitted, 'bravo', 'currentStatus')).toBe('current');
  });

  it('emits nothing past for a member only a filter listed when another filter read fails', async () => {
    const filter = `<select name="person_type"><option value="1">Faculty</option><option value="2">Alumni</option></select>`;
    const emitted = await emittedBy(config({ paginated: true }), (url) => {
      const type = url.searchParams.get('person_type');
      const pageIndex = Number(url.searchParams.get('page') || '0');
      if (type === '1') throw new Error('socket hang up');
      if (pageIndex > 0) return page('');
      if (type === '2') return page(yaleTeaser('charlie'));
      return page(`${filter}${yaleTeaser('alpha')}`);
    });
    expect(fieldOf(emitted, 'charlie', 'currentStatus')).toBeUndefined();
    expect(emitted.some((obs) => /charlie/.test(obs.entityKey ?? ''))).toBe(false);
    const snapshot = snapshotOf(emitted);
    expect(snapshot.members.some((member: any) => /charlie/.test(member.memberKey))).toBe(false);
    const read = centerRosterReadFromSnapshot(snapshot, 'run-a', at(2), {
      adoptsSectionContract: true,
    });
    expect(read?.sections?.departedMemberKeys.size).toBe(0);
  });

  it('marks an emeritus listing whose own page could not be read as unread', async () => {
    const emitted = await emittedBy(
      config(),
      () => page(`<h2>Emeritus Faculty</h2>${yaleTeaser('alpha')}${yaleTeaser('bravo')}`),
      { alpha: UNREADABLE, bravo: 'Professor Emeritus of Synthetic Studies' },
    );
    const members = snapshotOf(emitted).members;
    expect(members.find((member: any) => /alpha/.test(member.memberKey))).toMatchObject({
      sectionKind: 'emeritus',
      ownPageUnread: true,
    });
    expect(
      members.find((member: any) => /bravo/.test(member.memberKey))?.ownPageUnread,
    ).toBeUndefined();
  });
});

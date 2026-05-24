/**
 * Unit tests for CentersInstitutesScraper extractors and orchestration.
 *
 * The HTML snippets embedded below are minimal but structurally faithful to
 * the live pages — selectors and class names match what each Drupal/CMS theme
 * actually emits. All network is mocked via `vi.spyOn(axios, 'get')`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CentersInstitutesScraper,
  nodeTeaserPersonExtractor,
  wuTsaiExtractor,
  yaleCancerCenterExtractor,
  viewsFieldNameExtractor,
  ispsExtractor,
  ycgaExtractor,
  jacksonCentersExtractor,
  jsRenderedStub,
  centerToGroupObservations,
  centerMemberRelationshipObservations,
  memberToObservations,
  childCenterToObservations,
  type CenterConfig,
  type CenterMember,
  type ExtractorResult,
} from '../sources/centersInstitutesScraper';
import type { ScraperContext, ObservationInput } from '../types';

// ---------------------------------------------------------------------------
// Sample HTML fixtures
// ---------------------------------------------------------------------------

/** Drupal node-teaser theme used by several center roster pages. */
const NODE_TEASER_HTML = `
<html><body>
  <article id="node-person-1" class="node-teaser node-teaser--person">
    <div class="node-teaser__heading">
      <a href="/people/fixture-director"><span>Fixture Director</span></a>
    </div>
    <div class="node-teaser__professional-title"><span>Director and Named Professor of Economics</span></div>
  </article>
  <article id="node-person-2" class="node-teaser node-teaser--person">
    <div class="node-teaser__heading">
      <a href="/people/fixture-fellow"><span>Fixture Fellow</span></a>
    </div>
    <div class="node-teaser__professional-title"><span>Professor of Economics</span></div>
  </article>
  <article id="node-news-1" class="node-teaser node-teaser--news">
    <div class="node-teaser__heading"><a href="/news/123"><span>Some news</span></a></div>
  </article>
</body></html>
`;

/** Teaser-card institute roster structure. */
const WTI_HTML = `
<html><body>
  <div class="teaser teaser--person">
    <div class="teaser__media"><img alt="x"/></div>
    <div class="teaser__content">
      <h2 class="teaser__heading">Fixture Mechanist</h2>
      <p class="teaser__text">Faculty Member, Mechanical Engineering</p>
    </div>
  </div>
  <div class="teaser teaser--person">
    <div class="teaser__content">
      <h2 class="teaser__heading">Fixture Neuroscientist</h2>
      <p class="teaser__text">Faculty Member, Neuroscience</p>
    </div>
  </div>
  <div class="teaser teaser--person">
    <div class="teaser__content">
      <h2 class="teaser__heading"></h2>
      <p class="teaser__text">Empty Heading Should Be Skipped</p>
    </div>
  </div>
</body></html>
`;

/** Alphabetical medicine center directory. */
const CANCER_HTML = `
<html><body>
  <div id="A">
    <a href="/cancer/profile/alpha-analyst/" tabindex="0" class="hyperlink">Analyst, Alpha</a>
    <a href="/cancer/profile/beta-biologist/" tabindex="0" class="hyperlink">Biologist, Beta</a>
    <a href="/cancer/profile/alpha-analyst/" tabindex="0" class="hyperlink">Analyst, Alpha</a>
  </div>
  <div id="B">
    <a href="/cancer/profile/gamma-clinician/" class="hyperlink">Clinician, Gamma</a>
  </div>
  <a href="/cancer/about/contact" class="hyperlink">Contact Us</a>
</body></html>
`;

/** Common views-field roster layout. */
const VIEWS_FIELD_HTML = `
<html><body>
  <table>
    <tr>
      <td>
        <div class="views-field views-field-picture"><a href="/people/quantum-member"><img/></a></div>
        <div class="views-field views-field-name">
          <span class="field-content"><a href="/people/quantum-member" class="username">Quantum Member</a></span>
        </div>
        <div class="views-field views-field-field-title">
          <div class="field-content">Assistant Professor of Applied Physics</div>
        </div>
      </td>
      <td>
        <div class="views-field views-field-name">
          <a href="/people/optics-member" class="username">Optics Member</a>
        </div>
        <div class="views-field views-field-field-title">
          <div class="field-content">Named Professor of Applied Physics</div>
        </div>
      </td>
    </tr>
  </table>
  <div class="views-row">
    <div class="views-field views-field-name">
      <a href="/people/advisory-board" class="username">Advisory Board</a>
    </div>
  </div>
</body></html>
`;

/** ISPS faculty fellows views-row layout. */
const ISPS_HTML = `
<html><body>
  <div class="views-row views-row-1">
    <div class="ds-1col node node-team-member view-mode-isps_teaser_extended">
      <div class="field field-name-field-team-member-photo"><a href="/team/p-m-aronow"><img/></a></div>
      <div class="field field-name-team-list-member-name">
        <strong><a href="/team/methods-fellow">Methods Fellow</a></strong>
      </div>
      <div class="field field-name-field-team-member-creds">
        Associate Professor of Statistics &amp; Data Science
      </div>
    </div>
  </div>
  <div class="views-row views-row-2">
    <div class="ds-1col node node-team-member">
      <div class="field field-name-team-list-member-name">
        <strong><a href="/team/program-director">Program Director</a></strong>
      </div>
      <div class="field field-name-field-team-member-creds">
        Director, American Political Economy Exchange
      </div>
    </div>
  </div>
  <div class="views-row views-row-3">
    <div class="ds-1col node node-team-member">
      <div class="field field-name-team-list-member-name"><strong><a></a></strong></div>
    </div>
  </div>
</body></html>
`;

/** YCGA YSM-style profile-grid layout. */
const YCGA_HTML = `
<html><body>
  <div class="profile-grid-item">
    <a href="/genetics/profile/genomics-lead/" class="profile-grid-item__link-details" aria-label="Genomics Lead">
      <span class="profile-grid-item__name profile-grid-item__name--link">Genomics Lead, PhD</span>
    </a>
  </div>
  <div class="profile-grid-item">
    <a href="/genetics/profile/core-scientist/" class="profile-grid-item__link-details">
      <span class="profile-grid-item__name">Core Scientist</span>
    </a>
  </div>
  <a href="/genetics/profile/genomics-lead/" class="profile-grid-item__link-details">
    <span class="profile-grid-item__name">Duplicate Genomics Lead</span>
  </a>
</body></html>
`;

/** Jackson School centers index meta-listing. */
const JACKSON_HTML = `
<html><body>
  <div class="jordan_item">
    <div class="cta_box">
      <a href="https://jackson.yale.edu/centers-initiatives/blue-center/"><img/></a>
      <div class="cta_box_content">
        <h3 class="cta_title">Fixture Center for Global Strategic Assessment</h3>
        <div class="content">Supports interdisciplinary research on statecraft.</div>
      </div>
    </div>
  </div>
  <div class="jordan_item">
    <div class="cta_box">
      <a href="https://jackson.yale.edu/environment/"><img/></a>
      <div class="cta_box_content">
        <h3 class="cta_title">Fixture Initiative on Environment and Global Affairs</h3>
        <div class="content">Supports environmental change studies.</div>
      </div>
    </div>
  </div>
  <div class="jordan_item">
    <div class="cta_box">
      <a href="https://jackson.yale.edu/centers-initiatives/fixture-ai-program/"><img/></a>
      <div class="cta_box_content">
        <h3 class="cta_title">Fixture Program on AI and National Power</h3>
        <div class="content">AI research program.</div>
      </div>
    </div>
  </div>
</body></html>
`;

// ---------------------------------------------------------------------------
// Per-extractor tests
// ---------------------------------------------------------------------------

describe('nodeTeaserPersonExtractor', () => {
  it('extracts faculty cards and ignores unrelated articles', () => {
    const out = nodeTeaserPersonExtractor(NODE_TEASER_HTML, {
      pageUrl: 'https://egc.yale.edu/people/faculty',
    });
    expect(out.members).toHaveLength(2);
    expect(out.members[0]).toMatchObject({
      name: 'Fixture Director',
      title: 'Director and Named Professor of Economics',
      profileUrl: 'https://egc.yale.edu/people/fixture-director',
      role: 'director',
    });
    expect(out.members[1]).toMatchObject({
      name: 'Fixture Fellow',
      title: 'Professor of Economics',
      role: 'core-faculty',
    });
  });

  it('returns empty members on a page with no person cards', () => {
    const out = nodeTeaserPersonExtractor('<html><body>nothing</body></html>', {
      pageUrl: 'https://example.com',
    });
    expect(out.members).toEqual([]);
  });
});

describe('wuTsaiExtractor', () => {
  it('extracts heading + text pairs and skips empty headings', () => {
    const out = wuTsaiExtractor(WTI_HTML, { pageUrl: 'https://wti.yale.edu/humans/faculty' });
    expect(out.members).toHaveLength(2);
    expect(out.members[0]).toMatchObject({
      name: 'Fixture Mechanist',
      title: 'Faculty Member, Mechanical Engineering',
      role: 'core-faculty',
    });
    expect(out.members[1].name).toBe('Fixture Neuroscientist');
    expect(out.members[1].profileUrl).toBeUndefined();
  });
});

describe('yaleCancerCenterExtractor', () => {
  it('flips Last, First names, dedupes by href, and ignores non-profile links', () => {
    const out = yaleCancerCenterExtractor(CANCER_HTML, {
      pageUrl: 'https://medicine.yale.edu/cancer/research/membership/directory',
    });
    expect(out.members).toHaveLength(3);
    expect(out.members[0].name).toBe('Alpha Analyst');
    expect(out.members[0].profileUrl).toBe(
      'https://medicine.yale.edu/cancer/profile/alpha-analyst/',
    );
    expect(out.members[1].name).toBe('Beta Biologist');
    expect(out.members[2].name).toBe('Gamma Clinician');
    // dedupe
    expect(out.members.filter((m) => m.name === 'Alpha Analyst')).toHaveLength(1);
  });
});

describe('viewsFieldNameExtractor', () => {
  it('pairs name with title from the surrounding row and skips known meta-pages', () => {
    const out = viewsFieldNameExtractor(VIEWS_FIELD_HTML, {
      pageUrl: 'https://quantuminstitute.yale.edu/people/members',
    });
    expect(out.members).toHaveLength(2);
    expect(out.members[0]).toMatchObject({
      name: 'Quantum Member',
      title: 'Assistant Professor of Applied Physics',
      profileUrl: 'https://quantuminstitute.yale.edu/people/quantum-member',
    });
    expect(out.members[1].name).toBe('Optics Member');
    // Advisory Board entry filtered out
    expect(out.members.find((m) => m.name === 'Advisory Board')).toBeUndefined();
  });
});

describe('ispsExtractor', () => {
  it('extracts each views-row member, classifies director role, skips empty rows', () => {
    const out = ispsExtractor(ISPS_HTML, {
      pageUrl: 'https://isps.yale.edu/team/directory/faculty-fellows',
    });
    expect(out.members).toHaveLength(2);
    expect(out.members[0]).toMatchObject({
      name: 'Methods Fellow',
      profileUrl: 'https://isps.yale.edu/team/methods-fellow',
      role: 'core-faculty',
    });
    expect(out.members[0].title).toContain('Associate Professor');
    expect(out.members[1]).toMatchObject({ name: 'Program Director', role: 'director' });
  });
});

describe('ycgaExtractor', () => {
  it('extracts profile-grid items, dedupes, drops empty', () => {
    const out = ycgaExtractor(YCGA_HTML, {
      pageUrl: 'https://medicine.yale.edu/genetics/research/ycga/people/',
    });
    expect(out.members).toHaveLength(2);
    expect(out.members[0]).toMatchObject({
      name: 'Genomics Lead, PhD',
      profileUrl: 'https://medicine.yale.edu/genetics/profile/genomics-lead/',
    });
    expect(out.members[1].name).toBe('Core Scientist');
  });
});

describe('jacksonCentersExtractor', () => {
  it('emits child centers (no members) and infers kind from name', () => {
    const out = jacksonCentersExtractor(JACKSON_HTML, {
      pageUrl: 'https://jackson.yale.edu/centers-initiatives/',
    });
    expect(out.members).toEqual([]);
    expect(out.childCenters).toHaveLength(3);
    expect(out.childCenters![0]).toMatchObject({
      name: 'Fixture Center for Global Strategic Assessment',
      url: 'https://jackson.yale.edu/centers-initiatives/blue-center/',
      kind: 'center',
    });
    expect(out.childCenters![1].kind).toBe('initiative');
    expect(out.childCenters![2].kind).toBe('program');
  });
});

describe('jsRenderedStub', () => {
  it('throws to signal the page needs a headless browser', () => {
    expect(() => jsRenderedStub('<html></html>', { pageUrl: 'x' })).toThrow(/JS-rendered|gated/);
  });
});

// ---------------------------------------------------------------------------
// Observation-shaping helpers
// ---------------------------------------------------------------------------

describe('centerToGroupObservations', () => {
  it('emits ResearchGroup fields keyed by center slug, with affiliatedNames', () => {
    const config: CenterConfig = {
      centerKey: 'wu-tsai',
      centerName: 'Fixture Neuroscience Institute',
      schoolName: '',
      kind: 'institute',
      departments: ['Neuroscience', 'Psychology'],
      url: 'https://wti.yale.edu/humans/faculty',
      extractor: wuTsaiExtractor,
    };
    const members: CenterMember[] = [
      { name: 'Fixture Mechanist' },
      { name: 'Fixture Neuroscientist' },
    ];
    const { observations, entityKey } = centerToGroupObservations(
      config,
      members,
      'https://wti.yale.edu/humans/faculty',
    );
    expect(entityKey).toBe('center-wu-tsai');
    const fields = observations.map((o) => o.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'slug',
        'name',
        'kind',
        'websiteUrl',
        'sourceUrls',
        'openness',
        'departments',
        'affiliatedNames',
      ]),
    );
    expect(observations.find((o) => o.field === 'kind')!.value).toBe('institute');
    expect(observations.find((o) => o.field === 'affiliatedNames')!.value).toEqual([
      'Fixture Mechanist',
      'Fixture Neuroscientist',
    ]);
    // school is omitted when empty
    expect(observations.find((o) => o.field === 'school')).toBeUndefined();
    expect(observations.every((o) => o.entityKey === 'center-wu-tsai')).toBe(true);
  });

  it('includes school when provided and omits departments/affiliatedNames when empty', () => {
    const config: CenterConfig = {
      centerKey: 'whc',
      centerName: 'Fixture Humanities Center',
      schoolName: 'FAS',
      kind: 'center',
      url: 'https://whc.yale.edu/people/our-people',
      extractor: viewsFieldNameExtractor,
    };
    const { observations } = centerToGroupObservations(config, [], 'https://whc.yale.edu/people');
    const fields = observations.map((o) => o.field);
    expect(fields).toContain('school');
    expect(fields).not.toContain('departments');
    expect(fields).not.toContain('affiliatedNames');
  });

  it('does not emit access-signal or contact-route artifacts from center identity and membership evidence', () => {
    const config: CenterConfig = {
      centerKey: 'wu-tsai',
      centerName: 'Fixture Neuroscience Institute',
      schoolName: '',
      kind: 'institute',
      departments: ['Neuroscience'],
      url: 'https://wti.yale.edu/humans/faculty',
      extractor: wuTsaiExtractor,
    };
    const member: CenterMember = {
      name: 'Fixture Member',
      title: 'Faculty Member, Neuroscience',
      profileUrl: 'https://wti.yale.edu/person/fixture-member',
    };
    const { observations: centerObservations } = centerToGroupObservations(
      config,
      [member],
      config.url,
    );
    const observations = [
      ...centerObservations,
      ...memberToObservations(member, config, config.url),
      ...centerMemberRelationshipObservations(member, config, config.url),
      ...childCenterToObservations(
        {
          name: 'Fixture Child Initiative',
          url: 'https://jackson.yale.edu/centers-initiatives/child-initiative/',
          kind: 'initiative',
        },
        {
          ...config,
          centerKey: 'jackson-centers',
          schoolName: 'Jackson School of Global Affairs',
        },
        'https://jackson.yale.edu/centers-initiatives/',
      ),
    ];

    expect(observations.map((o) => o.entityType)).not.toEqual(
      expect.arrayContaining(['entryPathway', 'accessSignal', 'contactRoute']),
    );
    expect(observations.map((o) => o.field)).not.toEqual(
      expect.arrayContaining([
        'acceptingUndergrads',
        'undergradAccessEvidence',
        'joinPageUrl',
        'contactInstructionsQuote',
      ]),
    );
  });
});

describe('memberToObservations', () => {
  it('emits researchGroupMember observations with split name and inferred role', () => {
    const config: CenterConfig = {
      centerKey: 'cowles',
      centerName: 'Fixture Economics Center',
      schoolName: 'FAS',
      kind: 'center',
      url: 'https://egc.yale.edu/people/faculty',
      extractor: nodeTeaserPersonExtractor,
    };
    const obs = memberToObservations(
      {
        name: 'Fixture Director',
        title: 'Director and Named Professor of Economics',
        role: 'director',
        profileUrl: 'https://egc.yale.edu/people/fixture-director',
      },
      config,
      'https://egc.yale.edu/people/faculty',
    );
    expect(obs).toHaveLength(5);
    expect(obs.every((o) => o.entityKey === 'center-cowles:fixture-director')).toBe(true);
    expect(obs.every((o) => o.entityType === 'researchGroupMember')).toBe(true);
    expect(obs.find((o) => o.field === 'researchGroupKey')!.value).toBe('center-cowles');
    expect(obs.find((o) => o.field === 'role')!.value).toBe('director');
    expect(obs.find((o) => o.field === 'inferredUserName')!.value).toEqual({
      fname: 'Fixture',
      lname: 'Director',
    });
    expect(obs.find((o) => o.field === 'profileUrl')!.value).toBe(
      'https://egc.yale.edu/people/fixture-director',
    );
  });
});

describe('centerMemberRelationshipObservations', () => {
  it('emits relationship observations without materializing generated faculty research-area shells', () => {
    const config: CenterConfig = {
      centerKey: 'yale-quantum-institute',
      centerName: 'Fixture Quantum Institute',
      schoolName: '',
      kind: 'institute',
      url: 'https://quantuminstitute.yale.edu/people/members',
      extractor: viewsFieldNameExtractor,
    };
    const obs = centerMemberRelationshipObservations(
      { name: 'Quantum Member', title: 'Assistant Professor of Applied Physics' },
      config,
      'https://quantuminstitute.yale.edu/people/members',
    );

    expect(obs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntityRelationship',
          entityKey: 'center-yale-quantum-institute:faculty-research-area-quantum-member:MEMBER_RESEARCH_AREA',
          field: 'sourceEntityKey',
          value: 'center-yale-quantum-institute',
        }),
        expect.objectContaining({
          entityType: 'researchEntityRelationship',
          entityKey: 'center-yale-quantum-institute:faculty-research-area-quantum-member:MEMBER_RESEARCH_AREA',
          field: 'targetEntityKey',
          value: 'faculty-research-area-quantum-member',
        }),
        expect.objectContaining({
          entityType: 'researchEntityRelationship',
          field: 'relationshipType',
          value: 'MEMBER_RESEARCH_AREA',
        }),
      ]),
    );
    expect(obs.filter((observation) => observation.entityType === 'researchEntity')).toEqual([]);
  });

  it('does not emit relationship observations for centers outside the first ingestion scope', () => {
    const config: CenterConfig = {
      centerKey: 'cowles',
      centerName: 'Fixture Economics Center',
      schoolName: 'Yale Faculty of Arts and Sciences',
      kind: 'center',
      url: 'https://egc.yale.edu/people/faculty',
      extractor: nodeTeaserPersonExtractor,
    };

    expect(
      centerMemberRelationshipObservations(
        { name: 'Fixture Economist', title: 'Professor of Economics' },
        config,
        'https://egc.yale.edu/people/faculty',
      ),
    ).toEqual([]);
  });
});

describe('childCenterToObservations', () => {
  it('emits a ResearchGroup observation set for a discovered child center', () => {
    const parent: CenterConfig = {
      centerKey: 'jackson-centers',
      centerName: 'Jackson centers index',
      schoolName: 'Jackson School of Global Affairs',
      kind: 'center',
      url: 'https://jackson.yale.edu/centers-initiatives/',
      extractor: jacksonCentersExtractor,
    };
    const obs = childCenterToObservations(
      {
        name: 'Fixture Program on AI',
        url: 'https://jackson.yale.edu/centers-initiatives/fixture-ai-program/',
        kind: 'program',
        description: 'AI research program.',
      },
      parent,
      'https://jackson.yale.edu/centers-initiatives/',
    );
    const fields = obs.map((o) => o.field);
    expect(fields).toEqual(
      expect.arrayContaining(['slug', 'name', 'kind', 'websiteUrl', 'school', 'description']),
    );
    expect(obs[0].entityKey).toBe('center-jackson-centers-fixture-program-on-ai');
    expect(obs.find((o) => o.field === 'kind')!.value).toBe('program');
  });
});

// ---------------------------------------------------------------------------
// End-to-end orchestration (network mocked)
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'centers-institutes-index',
    sourceWeight: 0.8,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('CentersInstitutesScraper.run', () => {
  it('orchestrates extractors across canned configs and emits group + member obs', async () => {
    const cowlesExt = vi.fn(
      (): ExtractorResult => ({
        members: [
          {
            name: 'Fixture Director',
            title: 'Director and Named Professor of Economics',
            profileUrl: 'https://egc.yale.edu/people/fixture-director',
            role: 'director',
          },
          { name: 'Fixture Fellow', title: 'Professor', role: 'core-faculty' },
        ],
      }),
    );
    const wuTsaiExt = vi.fn(
      (): ExtractorResult => ({
        members: [{ name: 'Fixture Mechanist', title: 'Faculty Member, Engineering' }],
      }),
    );
    const configs: CenterConfig[] = [
      {
        centerKey: 'cowles',
        centerName: 'Fixture Economics Center',
        schoolName: 'FAS',
        kind: 'center',
        url: 'https://example.invalid/cowles',
        extractor: cowlesExt,
      },
      {
        centerKey: 'wu-tsai',
        centerName: 'Fixture Neuroscience Institute',
        schoolName: '',
        kind: 'institute',
        url: 'https://example.invalid/wti',
        extractor: wuTsaiExt,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new CentersInstitutesScraper(configs);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(cowlesExt).toHaveBeenCalledTimes(1);
    expect(wuTsaiExt).toHaveBeenCalledTimes(1);
    // 2 centers + 2 members + 1 member = 5 entities observed
    expect(result.entitiesObserved).toBe(5);

    const groupObs = emitted.filter((o) => o.entityType === 'researchEntity');
    const cowlesGroup = groupObs.filter((o) => o.entityKey === 'center-cowles');
    expect(cowlesGroup.find((o) => o.field === 'name')!.value).toBe(
      'Fixture Economics Center',
    );
    expect(cowlesGroup.find((o) => o.field === 'school')!.value).toBe('FAS');
    expect(cowlesGroup.find((o) => o.field === 'affiliatedNames')!.value).toEqual([
      'Fixture Director',
      'Fixture Fellow',
    ]);

    const memberObs = emitted.filter((o) => o.entityType === 'researchGroupMember');
    const janeObs = memberObs.filter((o) => o.entityKey === 'center-cowles:fixture-director');
    expect(janeObs.find((o) => o.field === 'role')!.value).toBe('director');
    expect(janeObs.find((o) => o.field === 'inferredUserName')!.value).toEqual({
      fname: 'Fixture',
      lname: 'Director',
    });

    // wu-tsai has no school configured
    const wtGroup = groupObs.filter((o) => o.entityKey === 'center-wu-tsai');
    expect(wtGroup.find((o) => o.field === 'school')).toBeUndefined();
    expect(wtGroup.find((o) => o.field === 'kind')!.value).toBe('institute');

    getSpy.mockRestore();
  });

  it('honors --only filter to skip non-matching centers', async () => {
    const a = vi.fn((): ExtractorResult => ({ members: [{ name: 'A Person' }] }));
    const b = vi.fn((): ExtractorResult => ({ members: [{ name: 'B Person' }] }));
    const configs: CenterConfig[] = [
      {
        centerKey: 'cowles',
        centerName: 'Fixture Economics Center',
        schoolName: 'FAS',
        kind: 'center',
        url: 'https://example.invalid/a',
        extractor: a,
      },
      {
        centerKey: 'wu-tsai',
        centerName: 'WTI',
        schoolName: '',
        kind: 'institute',
        url: 'https://example.invalid/b',
        extractor: b,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new CentersInstitutesScraper(configs);
    const { ctx } = makeContext({ only: ['wu-tsai'] });
    await scraper.run(ctx);

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    getSpy.mockRestore();
  });

  it('caps centers processed at the limit option', async () => {
    const ext = vi.fn((): ExtractorResult => ({ members: [{ name: 'x' }] }));
    const configs: CenterConfig[] = [
      { centerKey: 'a', centerName: 'A', schoolName: '', kind: 'center', url: 'https://x/a', extractor: ext },
      { centerKey: 'b', centerName: 'B', schoolName: '', kind: 'center', url: 'https://x/b', extractor: ext },
      { centerKey: 'c', centerName: 'C', schoolName: '', kind: 'center', url: 'https://x/c', extractor: ext },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: '<html></html>' } as any);
    const scraper = new CentersInstitutesScraper(configs);
    const { ctx } = makeContext({ limit: 2 });
    await scraper.run(ctx);
    expect(ext).toHaveBeenCalledTimes(2);
    getSpy.mockRestore();
  });

  it('records fetch failure status and emits no observations for that center', async () => {
    const failing = vi.fn();
    const working = vi.fn(
      (): ExtractorResult => ({ members: [{ name: 'Working Person' }] }),
    );
    const configs: CenterConfig[] = [
      {
        centerKey: 'broken',
        centerName: 'Broken',
        schoolName: '',
        kind: 'center',
        url: 'https://will-fail.invalid/page',
        extractor: failing,
      },
      {
        centerKey: 'working',
        centerName: 'Working',
        schoolName: '',
        kind: 'center',
        url: 'https://example.invalid/working',
        extractor: working,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.includes('will-fail')) throw new Error('Request failed with status 503');
      return { data: '<html></html>' } as any;
    });

    const scraper = new CentersInstitutesScraper(configs);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(failing).not.toHaveBeenCalled();
    expect(working).toHaveBeenCalledTimes(1);
    expect(result.notes).toContain('broken=fetch-failed');
    expect(result.notes).toContain('working=1');
    // only the working center should have emitted observations
    expect(emitted.some((o) => o.entityKey === 'center-broken')).toBe(false);
    expect(emitted.some((o) => o.entityKey === 'center-working')).toBe(true);

    getSpy.mockRestore();
  });

  it('skips configs marked jsRenderedSkip without invoking the extractor', async () => {
    const stubExt = vi.fn();
    const liveExt = vi.fn((): ExtractorResult => ({ members: [{ name: 'Live Person' }] }));
    const configs: CenterConfig[] = [
      {
        centerKey: 'gated',
        centerName: 'Gated Center',
        schoolName: '',
        kind: 'institute',
        url: 'https://gated.invalid/people',
        extractor: stubExt,
        jsRenderedSkip: true,
        skipReason: 'CAS-only behind login',
      },
      {
        centerKey: 'open',
        centerName: 'Open Center',
        schoolName: '',
        kind: 'center',
        url: 'https://open.invalid/people',
        extractor: liveExt,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new CentersInstitutesScraper(configs);
    const { ctx } = makeContext();
    const result = await scraper.run(ctx);

    expect(stubExt).not.toHaveBeenCalled();
    expect(liveExt).toHaveBeenCalledTimes(1);
    expect(result.notes).toContain('gated=js-rendered-skip');
    getSpy.mockRestore();
  });

  it('emits child-center ResearchGroup observations from a meta-index extractor', async () => {
    const metaExt = vi.fn(
      (): ExtractorResult => ({
        members: [],
        childCenters: [
          {
            name: 'Fixture Program',
            url: 'https://jackson.yale.edu/centers-initiatives/fixture-program/',
            kind: 'program',
          },
          {
            name: 'Fixture Blue Center',
            url: 'https://jackson.yale.edu/centers-initiatives/fixture-blue-center/',
            kind: 'center',
          },
        ],
      }),
    );
    const configs: CenterConfig[] = [
      {
        centerKey: 'jackson-centers',
        centerName: 'Jackson centers index',
        schoolName: 'Jackson School of Global Affairs',
        kind: 'center',
        url: 'https://jackson.yale.edu/centers-initiatives/',
        extractor: metaExt,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new CentersInstitutesScraper(configs);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    // 1 parent + 2 child centers = 3 entities
    expect(result.entitiesObserved).toBe(3);
    const groupKeys = new Set(
      emitted.filter((o) => o.entityType === 'researchEntity').map((o) => o.entityKey),
    );
    expect(groupKeys.has('center-jackson-centers')).toBe(true);
    expect(groupKeys.has('center-jackson-centers-fixture-program')).toBe(true);
    expect(groupKeys.has('center-jackson-centers-fixture-blue-center')).toBe(true);

    getSpy.mockRestore();
  });
});

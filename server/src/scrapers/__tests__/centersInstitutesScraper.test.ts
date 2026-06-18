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
  memberToObservations,
  centerMemberRelationshipObservations,
  childCenterToObservations,
  type CenterConfig,
  type CenterMember,
  type ExtractorResult,
} from '../sources/centersInstitutesScraper';
import type { ScraperContext, ObservationInput } from '../types';

// ---------------------------------------------------------------------------
// Sample HTML fixtures
// ---------------------------------------------------------------------------

/** Cowles / Tobin / MacMillan all use this Drupal node-teaser theme. */
const NODE_TEASER_HTML = `
<html><body>
  <article id="node-person-1" class="node-teaser node-teaser--person">
    <div class="node-teaser__heading">
      <a href="/people/jane-doe"><span>Jane Doe</span></a>
    </div>
    <div class="node-teaser__professional-title"><span>Director and Sterling Professor of Economics</span></div>
  </article>
  <article id="node-person-2" class="node-teaser node-teaser--person">
    <div class="node-teaser__heading">
      <a href="/people/bob-smith"><span>Bob Smith</span></a>
    </div>
    <div class="node-teaser__professional-title"><span>Professor of Economics</span></div>
  </article>
  <article id="node-news-1" class="node-teaser node-teaser--news">
    <div class="node-teaser__heading"><a href="/news/123"><span>Some news</span></a></div>
  </article>
</body></html>
`;

/** Wu Tsai Institute structure. */
const WTI_HTML = `
<html><body>
  <div class="teaser teaser--person">
    <div class="teaser__media"><img alt="x"/></div>
    <div class="teaser__content">
      <h2 class="teaser__heading">Ian Abraham</h2>
      <p class="teaser__text">Faculty Member, Mechanical Engineering</p>
    </div>
  </div>
  <div class="teaser teaser--person">
    <div class="teaser__content">
      <h2 class="teaser__heading">Amy Arnsten</h2>
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

/** Yale Cancer Center alphabetical directory. */
const CANCER_HTML = `
<html><body>
  <div id="A">
    <a href="/cancer/profile/fuad-abujarad/" tabindex="0" class="hyperlink">Abujarad, Fuad</a>
    <a href="/cancer/profile/nita-ahuja/" tabindex="0" class="hyperlink">Ahuja, Nita</a>
    <a href="/cancer/profile/fuad-abujarad/" tabindex="0" class="hyperlink">Abujarad, Fuad</a>
  </div>
  <div id="B">
    <a href="/cancer/profile/sarah-bell/" class="hyperlink">Bell, Sarah</a>
  </div>
  <a href="/cancer/about/contact" class="hyperlink">Contact Us</a>
</body></html>
`;

/** Yale Quantum Institute / Whitney Humanities Center common views-field layout. */
const VIEWS_FIELD_HTML = `
<html><body>
  <table>
    <tr>
      <td>
        <div class="views-field views-field-picture"><a href="/people/aleksander-kubica"><img/></a></div>
        <div class="views-field views-field-name">
          <span class="field-content"><a href="/people/aleksander-kubica" class="username">Aleksander Kubica</a></span>
        </div>
        <div class="views-field views-field-field-title">
          <div class="field-content">Assistant Professor of Applied Physics</div>
        </div>
      </td>
      <td>
        <div class="views-field views-field-name">
          <a href="/people/hayden-material" class="username">Hayden Material</a>
        </div>
        <div class="views-field views-field-field-title">
          <div class="field-content">John C. Malone Professor of Applied Physics</div>
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
        <strong><a href="/team/p-m-aronow">P. M. Aronow</a></strong>
      </div>
      <div class="field field-name-field-team-member-creds">
        Associate Professor of Statistics &amp; Data Science
      </div>
    </div>
  </div>
  <div class="views-row views-row-2">
    <div class="ds-1col node node-team-member">
      <div class="field field-name-team-list-member-name">
        <strong><a href="/team/jordan-policy-fixture">Jordan Policy</a></strong>
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
    <a href="/genetics/profile/shrikant-mane/" class="profile-grid-item__link-details" aria-label="Shrikant Mane">
      <span class="profile-grid-item__name profile-grid-item__name--link">Shrikant Mane, PhD</span>
    </a>
  </div>
  <div class="profile-grid-item">
    <a href="/genetics/profile/sonia-santana/" class="profile-grid-item__link-details">
      <span class="profile-grid-item__name">Sonia Santana</span>
    </a>
  </div>
  <a href="/genetics/profile/shrikant-mane/" class="profile-grid-item__link-details">
    <span class="profile-grid-item__name">Duplicate Shrikant</span>
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
        <h3 class="cta_title">Blue Center for Global Strategic Assessment</h3>
        <div class="content">Supports interdisciplinary research on statecraft.</div>
      </div>
    </div>
  </div>
  <div class="jordan_item">
    <div class="cta_box">
      <a href="https://jackson.yale.edu/environment/"><img/></a>
      <div class="cta_box_content">
        <h3 class="cta_title">Deitz Family Initiative on Environment and Global Affairs</h3>
        <div class="content">Supports environmental change studies.</div>
      </div>
    </div>
  </div>
  <div class="jordan_item">
    <div class="cta_box">
      <a href="https://jackson.yale.edu/centers-initiatives/schmidt-program/"><img/></a>
      <div class="cta_box_content">
        <h3 class="cta_title">Schmidt Program on AI and National Power</h3>
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
      name: 'Jane Doe',
      title: 'Director and Sterling Professor of Economics',
      profileUrl: 'https://egc.yale.edu/people/jane-doe',
      role: 'director',
    });
    expect(out.members[1]).toMatchObject({
      name: 'Bob Smith',
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
      name: 'Ian Abraham',
      title: 'Faculty Member, Mechanical Engineering',
      role: 'core-faculty',
    });
    expect(out.members[1].name).toBe('Amy Arnsten');
    expect(out.members[1].profileUrl).toBeUndefined();
  });
});

describe('yaleCancerCenterExtractor', () => {
  it('flips Last, First names, dedupes by href, and ignores non-profile links', () => {
    const out = yaleCancerCenterExtractor(CANCER_HTML, {
      pageUrl: 'https://medicine.yale.edu/cancer/research/membership/directory',
    });
    expect(out.members).toHaveLength(3);
    expect(out.members[0].name).toBe('Fuad Abujarad');
    expect(out.members[0].profileUrl).toBe(
      'https://medicine.yale.edu/cancer/profile/fuad-abujarad/',
    );
    expect(out.members[1].name).toBe('Nita Ahuja');
    expect(out.members[2].name).toBe('Sarah Bell');
    // dedupe
    expect(out.members.filter((m) => m.name === 'Fuad Abujarad')).toHaveLength(1);
  });
});

describe('viewsFieldNameExtractor', () => {
  it('pairs name with title from the surrounding row and skips known meta-pages', () => {
    const out = viewsFieldNameExtractor(VIEWS_FIELD_HTML, {
      pageUrl: 'https://quantuminstitute.yale.edu/people/members',
    });
    expect(out.members).toHaveLength(2);
    expect(out.members[0]).toMatchObject({
      name: 'Aleksander Kubica',
      title: 'Assistant Professor of Applied Physics',
      profileUrl: 'https://quantuminstitute.yale.edu/people/aleksander-kubica',
    });
    expect(out.members[1].name).toBe('Hayden Material');
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
      name: 'P. M. Aronow',
      profileUrl: 'https://isps.yale.edu/team/p-m-aronow',
      role: 'core-faculty',
    });
    expect(out.members[0].title).toContain('Associate Professor');
    expect(out.members[1]).toMatchObject({ name: 'Jordan Policy', role: 'director' });
  });
});

describe('ycgaExtractor', () => {
  it('extracts profile-grid items, dedupes, drops empty', () => {
    const out = ycgaExtractor(YCGA_HTML, {
      pageUrl: 'https://medicine.yale.edu/genetics/research/ycga/people/',
    });
    expect(out.members).toHaveLength(2);
    expect(out.members[0]).toMatchObject({
      name: 'Shrikant Mane, PhD',
      profileUrl: 'https://medicine.yale.edu/genetics/profile/shrikant-mane/',
    });
    expect(out.members[1].name).toBe('Sonia Santana');
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
      name: 'Blue Center for Global Strategic Assessment',
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
  it('emits ResearchGroup fields keyed by center slug', () => {
    const config: CenterConfig = {
      centerKey: 'wu-tsai',
      centerName: 'Wu Tsai Institute',
      schoolName: '',
      kind: 'institute',
      departments: ['Neuroscience', 'Psychology'],
      url: 'https://wti.yale.edu/humans/faculty',
      extractor: wuTsaiExtractor,
    };
    const members: CenterMember[] = [
      { name: 'Ian Abraham' },
      { name: 'Amy Arnsten' },
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
      ]),
    );
    expect(observations.find((o) => o.field === 'kind')!.value).toBe('institute');
    // affiliatedNames is a dead field — never emitted (member rows carry roster identity).
    expect(observations.find((o) => o.field === 'affiliatedNames')).toBeUndefined();
    // school is omitted when empty
    expect(observations.find((o) => o.field === 'school')).toBeUndefined();
    expect(observations.every((o) => o.entityKey === 'center-wu-tsai')).toBe(true);
  });

  it('includes school when provided and omits departments when empty', () => {
    const config: CenterConfig = {
      centerKey: 'whc',
      centerName: 'Whitney Humanities Center',
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
});

describe('memberToObservations', () => {
  it('emits researchGroupMember observations with split name and inferred role', () => {
    const config: CenterConfig = {
      centerKey: 'cowles',
      centerName: 'Cowles',
      schoolName: 'FAS',
      kind: 'center',
      url: 'https://egc.yale.edu/people/faculty',
      extractor: nodeTeaserPersonExtractor,
    };
    const obs = memberToObservations(
      {
        name: 'Jane Doe',
        title: 'Director and Sterling Professor of Economics',
        role: 'director',
        profileUrl: 'https://egc.yale.edu/people/jane-doe',
      },
      config,
      'https://egc.yale.edu/people/faculty',
    );
    expect(obs).toHaveLength(5);
    expect(obs.every((o) => o.entityKey === 'center-cowles:jane-doe')).toBe(true);
    expect(obs.every((o) => o.entityType === 'researchGroupMember')).toBe(true);
    expect(obs.find((o) => o.field === 'researchGroupKey')!.value).toBe('center-cowles');
    expect(obs.find((o) => o.field === 'role')!.value).toBe('director');
    expect(obs.find((o) => o.field === 'inferredUserName')!.value).toEqual({
      fname: 'Jane',
      lname: 'Doe',
    });
    expect(obs.find((o) => o.field === 'profileUrl')!.value).toBe(
      'https://egc.yale.edu/people/jane-doe',
    );
  });
});

describe('centerMemberRelationshipObservations', () => {
  const wuTsaiConfig: CenterConfig = {
    centerKey: 'wu-tsai',
    centerName: 'Wu Tsai Institute',
    schoolName: '',
    kind: 'institute',
    url: 'https://wti.yale.edu/humans/faculty',
    extractor: wuTsaiExtractor,
  };

  it('emits an umbrella → faculty-research-area relationship observation', () => {
    const obs = centerMemberRelationshipObservations(
      { name: 'Jane Doe', role: 'core-faculty' },
      wuTsaiConfig,
      'https://wti.yale.edu/humans/faculty',
    );
    expect(obs.every((o) => o.entityType === 'researchEntityRelationship')).toBe(true);
    expect(
      obs.every(
        (o) =>
          o.entityKey ===
          'center-wu-tsai:faculty-research-area-jane-doe:MEMBER_RESEARCH_AREA',
      ),
    ).toBe(true);
    expect(obs.find((o) => o.field === 'sourceEntityKey')!.value).toBe('center-wu-tsai');
    expect(obs.find((o) => o.field === 'targetEntityKey')!.value).toBe(
      'faculty-research-area-jane-doe',
    );
    expect(obs.find((o) => o.field === 'relationshipType')!.value).toBe('MEMBER_RESEARCH_AREA');
    expect(obs.find((o) => o.field === 'evidenceStrength')!.value).toBe('MODERATE');
  });

  it('emits for every roster center now that the allowlist is gone', () => {
    const cowles: CenterConfig = {
      centerKey: 'cowles',
      centerName: 'Cowles',
      schoolName: 'FAS',
      kind: 'center',
      url: 'https://egc.yale.edu/people/faculty',
      extractor: nodeTeaserPersonExtractor,
    };
    const obs = centerMemberRelationshipObservations({ name: 'Jane Doe' }, cowles, 'https://x');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs.find((o) => o.field === 'sourceEntityKey')!.value).toBe('center-cowles');
    expect(obs.find((o) => o.field === 'targetEntityKey')!.value).toBe(
      'faculty-research-area-jane-doe',
    );
  });

  it('emits nothing when the member name is empty', () => {
    expect(
      centerMemberRelationshipObservations({ name: '   ' }, wuTsaiConfig, 'https://x'),
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
        name: 'Schmidt Program on AI',
        url: 'https://jackson.yale.edu/centers-initiatives/schmidt-program/',
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
    expect(obs[0].entityKey).toBe('center-jackson-centers-schmidt-program-on-ai');
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
            name: 'Jane Doe',
            title: 'Director and Sterling Professor of Economics',
            profileUrl: 'https://egc.yale.edu/people/jane-doe',
            role: 'director',
          },
          { name: 'Bob Smith', title: 'Professor', role: 'core-faculty' },
        ],
      }),
    );
    const wuTsaiExt = vi.fn(
      (): ExtractorResult => ({
        members: [{ name: 'Ian Abraham', title: 'Faculty Member, Engineering' }],
      }),
    );
    const configs: CenterConfig[] = [
      {
        centerKey: 'cowles',
        centerName: 'Cowles',
        schoolName: 'FAS',
        kind: 'center',
        url: 'https://example.invalid/cowles',
        extractor: cowlesExt,
      },
      {
        centerKey: 'wu-tsai',
        centerName: 'Wu Tsai Institute',
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
    expect(cowlesGroup.find((o) => o.field === 'name')!.value).toBe('Cowles');
    expect(cowlesGroup.find((o) => o.field === 'school')!.value).toBe('FAS');

    // Cowles is no longer allowlisted-out: its members now emit relationship obs too.
    const relationshipObs = emitted.filter((o) => o.entityType === 'researchEntityRelationship');
    expect(
      relationshipObs.some((o) => o.entityKey?.startsWith('center-cowles:')),
    ).toBe(true);

    const memberObs = emitted.filter((o) => o.entityType === 'researchGroupMember');
    const janeObs = memberObs.filter((o) => o.entityKey === 'center-cowles:jane-doe');
    expect(janeObs.find((o) => o.field === 'role')!.value).toBe('director');
    expect(janeObs.find((o) => o.field === 'inferredUserName')!.value).toEqual({
      fname: 'Jane',
      lname: 'Doe',
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
        centerName: 'Cowles',
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

  it('rejects unsafe runtime limits before fetching center pages', async () => {
    const ext = vi.fn((): ExtractorResult => ({ members: [{ name: 'x' }] }));
    const configs: CenterConfig[] = [
      { centerKey: 'a', centerName: 'A', schoolName: '', kind: 'center', url: 'https://x/a', extractor: ext },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: '<html></html>' } as any);
    const scraper = new CentersInstitutesScraper(configs);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(getSpy).not.toHaveBeenCalled();
    expect(ext).not.toHaveBeenCalled();
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
            name: 'Schmidt Program',
            url: 'https://jackson.yale.edu/centers-initiatives/schmidt-program/',
            kind: 'program',
          },
          {
            name: 'Blue Center',
            url: 'https://jackson.yale.edu/centers-initiatives/blue-center/',
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
    expect(groupKeys.has('center-jackson-centers-schmidt-program')).toBe(true);
    expect(groupKeys.has('center-jackson-centers-blue-center')).toBe(true);

    getSpy.mockRestore();
  });
});

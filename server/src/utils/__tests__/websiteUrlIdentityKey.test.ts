import { describe, expect, it } from 'vitest';
import {
  normalizeWebsiteUrlIdentityKey,
  redirectLandingIdentityKeys,
  websiteUrlIdentityKeyThroughRedirect,
  websiteUrlIdentityKeyVariants,
} from '../websiteUrlIdentityKey';
import { classifySourceLinkHealth } from '../../services/sourceLinkHealth';
import {
  buildWebsiteUrlResearchEntityDedupePlan,
  groupEntitiesByWebsiteUrlIdentity,
  type ResearchEntityPiDedupeRow,
} from '../../scripts/researchEntityPiDedupeCore';

type Entity = ResearchEntityPiDedupeRow['entities'][number];

const lab = (overrides: Partial<Entity> & { id: string; websiteUrl: string }): Entity => ({
  slug: overrides.id,
  name: 'Quill Lab',
  kind: 'lab',
  entityType: 'LAB',
  sourceUrls: [],
  departments: [],
  researchAreas: [],
  ...overrides,
});

const planFor = (entities: Entity[], landings: ReadonlyMap<string, string> = new Map()) =>
  buildWebsiteUrlResearchEntityDedupePlan(groupEntitiesByWebsiteUrlIdentity(entities, landings));

const archiveDuplicates = (entities: Entity[], plan: ReturnType<typeof planFor>): Entity[] => {
  const archived = new Set(plan.flatMap((group) => group.duplicateEntityIds));
  return entities.filter((entity) => !archived.has(entity.id));
};

describe('normalizeWebsiteUrlIdentityKey default documents (#5638)', () => {
  it.each([
    'https://med.example.edu/lab/quill/index.aspx',
    'https://med.example.edu/lab/quill/index.html',
    'https://med.example.edu/lab/quill/index.htm',
    'https://med.example.edu/lab/quill/default.aspx',
    'https://med.example.edu/lab/quill/Index.ASPX',
    'http://www.med.example.edu/lab/quill/index.aspx/',
    'https://med.example.edu/lab/quill/',
  ])('folds %s into the directory key', (url) => {
    expect(normalizeWebsiteUrlIdentityKey(url)).toBe('med.example.edu/lab/quill');
  });

  it('folds a default document at the host root into the host', () => {
    expect(normalizeWebsiteUrlIdentityKey('https://quilllab.example.edu/index.html')).toBe(
      'quilllab.example.edu',
    );
  });

  it('keeps a path segment that only begins like a default document', () => {
    expect(normalizeWebsiteUrlIdentityKey('https://med.example.edu/lab/indexing/')).toBe(
      'med.example.edu/lab/indexing',
    );
    expect(normalizeWebsiteUrlIdentityKey('https://med.example.edu/lab/quill/index.aspx.bak')).toBe(
      'med.example.edu/lab/quill/index.aspx.bak',
    );
  });

  it('keeps two labs at different paths of one host apart', () => {
    expect(
      normalizeWebsiteUrlIdentityKey('https://med.example.edu/lab/quill-a/index.aspx'),
    ).not.toBe(normalizeWebsiteUrlIdentityKey('https://med.example.edu/lab/quill-b/index.aspx'));
  });

  it('enumerates the default-document spellings in the inverse, each folding back to the key', () => {
    const key = 'med.example.edu/lab/quill';
    const variants = websiteUrlIdentityKeyVariants(key);
    expect(variants).toContain('https://med.example.edu/lab/quill/index.aspx');
    expect(variants).toContain('http://www.med.example.edu/lab/quill/default.aspx');
    expect(variants).toContain('https://med.example.edu/lab/quill/');
    for (const variant of variants) expect(normalizeWebsiteUrlIdentityKey(variant)).toBe(key);
  });
});

describe('recorded redirect landings (#5638)', () => {
  const MOVED_FROM = 'http://www.example.edu/quilllab/';
  const MOVED_TO = 'https://quilllab.example.edu/';

  it('link health records the page a cross-host move landed on', () => {
    expect(
      classifySourceLinkHealth({ status: 200, requestedUrl: MOVED_FROM, finalUrl: MOVED_TO }),
    ).toMatchObject({ healthStatus: 'HEALTHY', redirectLandingUrl: MOVED_TO });
  });

  it('link health records a same-host move to another path', () => {
    const verdict = classifySourceLinkHealth({
      status: 200,
      requestedUrl: 'https://med.example.edu/peds/quill_program/',
      finalUrl: 'https://med.example.edu/peds/sections/quill-program/',
    });
    expect(verdict.redirectLandingUrl).toBe('https://med.example.edu/peds/sections/quill-program/');
  });

  it.each([
    ['http://quilllab.example.edu/', 'https://quilllab.example.edu/'],
    ['https://quilllab.example.edu', 'https://www.quilllab.example.edu/'],
    ['https://med.example.edu/lab/quill/index.aspx', 'https://med.example.edu/lab/quill/'],
    ['https://med.example.edu/lab/Quill/', 'https://med.example.edu/lab/quill/'],
  ])('records no landing when %s only respells %s', (requestedUrl, finalUrl) => {
    expect(
      classifySourceLinkHealth({ status: 200, requestedUrl, finalUrl }).redirectLandingUrl,
    ).toBeUndefined();
  });

  it('records no landing on a verdict that is not HEALTHY', () => {
    const softMissing = classifySourceLinkHealth({
      status: 200,
      requestedUrl: 'https://med.example.edu/lab/quill/',
      finalUrl: 'https://med.example.edu/',
    });
    expect(softMissing.healthStatus).toBe('UNAVAILABLE');
    expect(softMissing.redirectLandingUrl).toBeUndefined();
    expect(
      classifySourceLinkHealth({ status: 301, requestedUrl: MOVED_FROM, finalUrl: MOVED_TO })
        .redirectLandingUrl,
    ).toBeUndefined();
  });

  it('keeps the newest landing when two verdicts disagree about one URL', () => {
    const landings = redirectLandingIdentityKeys([
      { url: MOVED_FROM, redirectLandingUrl: 'https://old.example.edu/', checkedAt: '2026-01-01' },
      { url: MOVED_FROM, redirectLandingUrl: MOVED_TO, checkedAt: '2026-06-01' },
      { url: 'https://quilllab.example.edu/', redirectLandingUrl: 'https://quilllab.example.edu' },
    ]);
    expect([...landings]).toEqual([['example.edu/quilllab', 'quilllab.example.edu']]);
    expect(websiteUrlIdentityKeyThroughRedirect(MOVED_FROM, landings)).toBe('quilllab.example.edu');
    expect(websiteUrlIdentityKeyThroughRedirect(MOVED_TO, landings)).toBe('quilllab.example.edu');
  });
});

describe('website-url dedupe lane through the new identity (#5638)', () => {
  const movedLandings = redirectLandingIdentityKeys([
    {
      url: 'http://www.example.edu/quilllab/',
      redirectLandingUrl: 'https://quilllab.example.edu/',
    },
  ]);

  const movedPair = [
    lab({
      id: 'dept-physics-quill',
      slug: 'dept-physics-ada-quill',
      websiteUrl: 'http://www.example.edu/quilllab/',
      piRoleCorroborated: true,
      sourceUrls: ['https://physics.example.edu/profile/ada-quill'],
    }),
    lab({
      id: 'dept-applied-quill',
      slug: 'dept-applied-physics-ada-quill',
      websiteUrl: 'https://quilllab.example.edu/',
    }),
  ];

  it('pairs one lab whose rows cite its old path and its new host once the redirect is recorded', () => {
    const plan = planFor(movedPair, movedLandings);
    expect(plan).toHaveLength(1);
    expect(plan[0].canonicalSlug).toBe('dept-physics-ada-quill');
    expect(plan[0].duplicateSlugs).toEqual(['dept-applied-physics-ada-quill']);
  });

  it('fails closed without a recorded redirect: no pattern aliases a path to a host', () => {
    expect(planFor(movedPair)).toEqual([]);
  });

  it('pairs a default-document spelling of one lab directory', () => {
    const plan = planFor([
      lab({
        id: 'ysm-quill-a',
        slug: 'ysm-faculty-ada-quill',
        websiteUrl: 'https://med.example.edu/lab/quill/index.aspx',
        piRoleCorroborated: true,
      }),
      lab({
        id: 'ysm-quill-b',
        slug: 'ysm-quill',
        websiteUrl: 'https://med.example.edu/lab/quill/',
      }),
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].duplicateEntityIds).toEqual(['ysm-quill-b']);
  });

  it('never pairs two same-surname labs at separate paths of one host', () => {
    const twoLabs = [
      lab({
        id: 'ysm-ada-quill',
        slug: 'ysm-ada-quill',
        websiteUrl: 'https://med.example.edu/lab/ada_quill/index.aspx',
      }),
      lab({ id: 'ysm-quill', slug: 'ysm-quill', websiteUrl: 'https://med.example.edu/lab/quill/' }),
    ];
    const unrelatedLanding = redirectLandingIdentityKeys([
      {
        url: 'https://med.example.edu/lab/quill/old/',
        redirectLandingUrl: 'https://med.example.edu/lab/ada_quill/',
      },
    ]);
    expect(planFor(twoLabs)).toEqual([]);
    expect(planFor(twoLabs, unrelatedLanding)).toEqual([]);
  });

  it('keeps rows with different lead people apart even when their URLs now agree', () => {
    const plan = planFor([
      lab({
        id: 'ysm-faculty-ada-quill',
        slug: 'ysm-faculty-ada-quill',
        name: 'QuillLab',
        websiteUrl: 'https://med.example.edu/lab/quilllab/index.aspx',
      }),
      lab({
        id: 'ysm-faculty-bo-reed',
        slug: 'ysm-faculty-bo-reed',
        name: 'QuillLab',
        websiteUrl: 'https://med.example.edu/lab/quilllab/',
      }),
    ]);
    expect(plan).toEqual([]);
  });

  it('is a no-op when run a second time after the merge', () => {
    const first = planFor(movedPair, movedLandings);
    const survivors = archiveDuplicates(movedPair, first);
    expect(survivors.map((entity) => entity.id)).toEqual(['dept-physics-quill']);
    expect(planFor(survivors, movedLandings)).toEqual([]);
  });
});

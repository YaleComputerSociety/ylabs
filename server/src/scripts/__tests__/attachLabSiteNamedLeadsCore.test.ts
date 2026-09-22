import { describe, expect, it } from 'vitest';
import {
  corroboratedResearchHome,
  isWithinResearchHomeSubtree,
  planLabSiteNamedLeadAttachment,
  researchHomeUrlCandidates,
  summarizeLabSiteNamedLeadRefusals,
  type LabSiteNamedLeadEntity,
  type OfficialProfileOwner,
} from '../attachLabSiteNamedLeadsCore';

const HOME = 'https://medicine.yale.edu/lab/quimby/';
const PEOPLE = `${HOME}people/`;

const entity = (overrides: Partial<LabSiteNamedLeadEntity> = {}): LabSiteNamedLeadEntity => ({
  slug: 'ysm-quimby',
  name: 'Quimby Lab',
  entityType: 'LAB',
  websiteUrl: HOME,
  sourceUrls: [HOME],
  studentVisibilityReasons: ['source_backed_description', 'missing_lead'],
  ...overrides,
});

const owner = (overrides: Partial<OfficialProfileOwner> = {}): OfficialProfileOwner => ({
  personId: 'person-quimby',
  displayName: 'Robin Quimby',
  profileUrl: 'https://medicine.yale.edu/profile/robin-quimby/',
  ...overrides,
});

const peoplePage = (...profileSlugs: string[]) => ({
  url: PEOPLE,
  html: profileSlugs.map((slug) => `<a href="/profile/${slug}/">x</a>`).join(''),
});

const plan = (input: {
  entity?: LabSiteNamedLeadEntity;
  pages?: Array<{ url: string; html: string }>;
  owners?: OfficialProfileOwner[];
  priorLeadEdges?: string[];
}) =>
  planLabSiteNamedLeadAttachment({
    entity: input.entity ?? entity(),
    pages: input.pages ?? [{ url: HOME, html: '' }, peoplePage('robin-quimby')],
    officialProfileOwners: input.owners ?? [owner()],
    personIdsWithPriorLeadEdge: new Set(input.priorLeadEdges ?? []),
  });

describe('research home candidates', () => {
  it('offers the served website first, then the cited sources, https only', () => {
    expect(
      researchHomeUrlCandidates({
        websiteUrl: HOME,
        sourceUrls: ['http://insecure.yale.edu/lab/quimby/', `${HOME}research/`, HOME],
      }),
    ).toEqual([HOME, `${HOME}research/`]);
  });

  it('never treats a person profile or faculty directory page as the research home', () => {
    expect(
      researchHomeUrlCandidates({
        sourceUrls: [
          'https://medicine.yale.edu/profile/alex-quimby/',
          'https://medicine.yale.edu/faculty/quimby/',
          HOME,
        ],
      }),
    ).toEqual([HOME]);
  });

  it("claims no eponym when a profile page is the row's only citation", () => {
    expect(
      corroboratedResearchHome({
        name: 'Quimby Lab',
        sourceUrls: ['https://medicine.yale.edu/profile/alex-quimby/'],
      }),
    ).toBeNull();
  });

  it('corroborates the eponym only when the row url path spells the same surname', () => {
    expect(corroboratedResearchHome(entity())).toEqual({
      researchHomeUrl: HOME,
      eponym: 'quimby',
      spellings: { corroborated: 'quimby', alternates: [], particle: '' },
    });
    expect(corroboratedResearchHome(entity({ name: 'Neonatal Outcomes Lab' }))).toBeNull();
    expect(
      corroboratedResearchHome(
        entity({ websiteUrl: 'https://medicine.yale.edu/lab/neonatal/', sourceUrls: [] }),
      ),
    ).toBeNull();
  });

  it('carries both spellings of a particle surname, joined as the path spells it and apart', () => {
    expect(
      corroboratedResearchHome(
        entity({
          name: 'De Camilli Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/decamilli/',
          sourceUrls: [],
        }),
      ),
    ).toEqual({
      researchHomeUrl: 'https://medicine.yale.edu/lab/decamilli/',
      eponym: 'decamilli',
      spellings: { corroborated: 'decamilli', alternates: ['camilli'], particle: 'de' },
    });
  });
});

describe('confining a served page to the research home', () => {
  it('keeps the home and its own subtree', () => {
    expect(isWithinResearchHomeSubtree(HOME, HOME)).toBe(true);
    expect(isWithinResearchHomeSubtree(PEOPLE, HOME)).toBe(true);
    expect(isWithinResearchHomeSubtree('https://www.medicine.yale.edu/lab/quimby/', HOME)).toBe(
      true,
    );
  });

  it('drops a redirect that left the subtree, including a sibling lab and another host', () => {
    expect(isWithinResearchHomeSubtree('https://medicine.yale.edu/', HOME)).toBe(false);
    expect(isWithinResearchHomeSubtree('https://medicine.yale.edu/lab/quimby-two/', HOME)).toBe(
      false,
    );
    expect(isWithinResearchHomeSubtree('https://nursing.yale.edu/lab/quimby/', HOME)).toBe(false);
  });

  it('confines a root-level file research home to its own page, never the whole host', () => {
    const fileHome = 'https://medicine.yale.edu/quimby.aspx';
    expect(isWithinResearchHomeSubtree(fileHome, fileHome)).toBe(true);
    expect(isWithinResearchHomeSubtree('https://medicine.yale.edu/lab/other/', fileHome)).toBe(
      false,
    );
  });
});

describe('planning an attachment from the research home itself', () => {
  it('attaches the one person the site names whose surname is the claimed eponym', () => {
    const outcome = plan({});
    expect(outcome).toEqual({
      plan: {
        researchHomeUrl: HOME,
        eponym: 'quimby',
        personId: 'person-quimby',
        personDisplayName: 'Robin Quimby',
        profileUrl: 'https://medicine.yale.edu/profile/robin-quimby/',
        evidenceUrl: PEOPLE,
      },
    });
  });

  it('records the page the matching person was found on, not the last page read', () => {
    const outcome = plan({
      pages: [
        { url: HOME, html: '' },
        peoplePage('robin-quimby'),
        { url: `${HOME}publications/`, html: '' },
      ],
    });
    expect('plan' in outcome && outcome.plan.evidenceUrl).toBe(PEOPLE);
  });

  it('refuses a row another hard blocker also holds, so an attachment is never miscounted as a release', () => {
    const outcome = plan({
      entity: entity({ studentVisibilityReasons: ['missing_lead', 'exact_url_duplicate_risk'] }),
    });
    expect(outcome).toEqual({
      refusal: { reason: 'lead_is_not_the_only_blocker', researchHomeUrl: HOME },
    });
  });

  it('refuses a topical name, because no surname is claimed to corroborate', () => {
    const outcome = plan({ entity: entity({ name: 'Neonatal Outcomes Lab' }) });
    expect(outcome).toEqual({ refusal: { reason: 'name_claims_no_eponym', researchHomeUrl: '' } });
  });

  it('refuses when the site names nobody with the claimed surname', () => {
    const outcome = plan({ pages: [peoplePage('dana-okonkwo')] });
    expect(outcome).toEqual({
      refusal: { reason: 'site_names_no_matching_person', researchHomeUrl: HOME },
    });
  });

  it('refuses two same-surname people on the site rather than guessing which one leads', () => {
    const outcome = plan({ pages: [peoplePage('robin-quimby', 'alex-quimby')] });
    expect(outcome).toEqual({
      refusal: { reason: 'site_names_several_matching_people', researchHomeUrl: HOME },
    });
  });

  it('refuses a profile on another school host, which is the namesake this lane must not graft', () => {
    const outcome = plan({
      owners: [owner({ profileUrl: 'https://nursing.yale.edu/profile/robin-quimby/' })],
    });
    expect(outcome).toEqual({
      refusal: { reason: 'profile_owner_not_in_corpus', researchHomeUrl: HOME },
    });
  });

  it('accepts the same school spelled with and without a www prefix', () => {
    const withWww = 'https://www.medicine.yale.edu/lab/quimby/';
    const outcome = plan({
      entity: entity({ websiteUrl: withWww, sourceUrls: [withWww] }),
      pages: [
        { url: withWww, html: '' },
        { url: `${withWww}people/`, html: '<a href="/profile/robin-quimby/">x</a>' },
      ],
    });
    expect('plan' in outcome && outcome.plan.personId).toBe('person-quimby');
  });

  it('matches a particle surname the site slug spells apart and the url path spells joined', () => {
    const home = 'https://medicine.yale.edu/lab/decamilli/';
    const outcome = plan({
      entity: entity({ name: 'De Camilli Lab', websiteUrl: home, sourceUrls: [home] }),
      pages: [{ url: home, html: '<a href="/profile/pietro-de-camilli/">x</a>' }],
      owners: [
        owner({
          personId: 'person-de-camilli',
          displayName: 'Pietro De Camilli',
          profileUrl: 'https://medicine.yale.edu/profile/pietro-de-camilli/',
        }),
      ],
    });
    expect('plan' in outcome && outcome.plan.personId).toBe('person-de-camilli');
  });

  it('refuses a bare-core namesake of a particle surname, who is a different person', () => {
    const home = 'https://medicine.yale.edu/lab/vandyke/';
    const outcome = plan({
      entity: entity({ name: 'Van Dyke Lab', websiteUrl: home, sourceUrls: [home] }),
      pages: [{ url: home, html: '<a href="/profile/bob-dyke/">x</a>' }],
      owners: [
        owner({
          personId: 'person-dyke',
          displayName: 'Bob Dyke',
          profileUrl: 'https://medicine.yale.edu/profile/bob-dyke/',
        }),
      ],
    });
    expect(outcome).toEqual({
      refusal: { reason: 'site_names_no_matching_person', researchHomeUrl: home },
    });
  });

  it('accepts the bare-core spelling when the particle is present in the name too', () => {
    const home = 'https://medicine.yale.edu/lab/vandyke/';
    const outcome = plan({
      entity: entity({ name: 'Van Dyke Lab', websiteUrl: home, sourceUrls: [home] }),
      pages: [{ url: home, html: '<a href="/profile/mary-van-dyke/">x</a>' }],
      owners: [
        owner({
          personId: 'person-van-dyke',
          displayName: 'Mary Van Dyke',
          profileUrl: 'https://medicine.yale.edu/profile/mary-van-dyke/',
        }),
      ],
    });
    expect('plan' in outcome && outcome.plan.personId).toBe('person-van-dyke');
  });

  it('ignores a page a redirect took off the research home subtree', () => {
    const outcome = plan({
      pages: [
        { url: HOME, html: '' },
        {
          url: 'https://medicine.yale.edu/departments/',
          html: '<a href="/profile/robin-quimby/">x</a>',
        },
      ],
    });
    expect(outcome).toEqual({
      refusal: { reason: 'site_names_no_matching_person', researchHomeUrl: HOME },
    });
  });

  it('refuses a person the corpus does not already carry behind that profile', () => {
    const outcome = plan({ owners: [] });
    expect(outcome).toEqual({
      refusal: { reason: 'profile_owner_not_in_corpus', researchHomeUrl: HOME },
    });
  });

  it('refuses a mononym, because a surname with no given name is not a person match', () => {
    const outcome = plan({ owners: [owner({ displayName: 'Quimby' })] });
    expect(outcome).toEqual({
      refusal: { reason: 'profile_owner_not_in_corpus', researchHomeUrl: HOME },
    });
  });

  it('refuses when two corpus rows claim the same official profile', () => {
    const outcome = plan({
      owners: [owner(), owner({ personId: 'person-duplicate' })],
    });
    expect(outcome).toEqual({
      refusal: { reason: 'profile_owner_is_ambiguous', researchHomeUrl: HOME },
    });
  });

  it('never re-mints over a retirement, whether or not the lane that retired it stamped a verdict', () => {
    const outcome = plan({ priorLeadEdges: ['person-quimby'] });
    expect(outcome).toEqual({
      refusal: { reason: 'prior_lead_edge_was_retired', researchHomeUrl: HOME },
    });
  });

  it('counts every refusal reason, including the ones that did not fire', () => {
    expect(
      summarizeLabSiteNamedLeadRefusals([
        { reason: 'prior_lead_edge_was_retired', researchHomeUrl: HOME },
      ]),
    ).toEqual({
      lead_is_not_the_only_blocker: 0,
      name_claims_no_eponym: 0,
      site_names_no_matching_person: 0,
      site_names_several_matching_people: 0,
      profile_owner_not_in_corpus: 0,
      profile_owner_is_ambiguous: 0,
      prior_lead_edge_was_retired: 1,
    });
  });
});

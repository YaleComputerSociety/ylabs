import { describe, expect, it } from 'vitest';
import {
  classifyFacultyResearchPromotion,
  hasOnlySharedCitations,
  hasPlaceholderFacultyResearchName,
  looksLikeDepartmentBioPage,
  looksLikeOrgPage,
  normalizeEntityName,
  normalizeWebsiteUrl,
  planFacultyResearchPromotion,
  summarizeFacultyResearchPromotion,
  type FacultyResearchPromotionCandidate,
} from '../promoteFacultyResearchToLabCore';

const promotable = (
  overrides: Partial<FacultyResearchPromotionCandidate> = {},
): FacultyResearchPromotionCandidate => ({
  id: 'id-1',
  slug: 'robert-schoelkopf-faculty-research',
  name: 'Robert Schoelkopf Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  websiteUrl: 'http://rsl.yale.edu/',
  urlUsageCount: 1,
  ...overrides,
});

describe('promoteFacultyResearchToLabCore', () => {
  it('recognizes the synthesized placeholder name only as a suffix', () => {
    expect(hasPlaceholderFacultyResearchName('Robert Schoelkopf Faculty Research')).toBe(true);
    expect(hasPlaceholderFacultyResearchName('Ada Fenick faculty research  ')).toBe(true);
    expect(hasPlaceholderFacultyResearchName('Faculty Research Committee on Ethics')).toBe(false);
    expect(hasPlaceholderFacultyResearchName('Crair Laboratory')).toBe(false);
    expect(hasPlaceholderFacultyResearchName(null)).toBe(false);
  });

  it('normalizes names and urls for comparison', () => {
    expect(normalizeEntityName('  Crair   Laboratory ')).toBe('crair laboratory');
    expect(normalizeEntityName('O’Hern Lab')).toBe("o'hern lab");
    expect(normalizeWebsiteUrl('HTTPS://WWW.Example.ORG/path/')).toBe('example.org/path');
    expect(normalizeWebsiteUrl(null)).toBe('');
  });

  it('promotes a placeholder row that owns a real lab site', () => {
    const row = classifyFacultyResearchPromotion(promotable());
    expect(row.decision).toBe('PROMOTE');
    expect(row.name).toBe('Robert Schoelkopf Faculty Research');
    expect(row.toEntityType).toBe('LAB');
    expect(row.toKind).toBe('lab');
  });

  it('does not realign kind that is already lab', () => {
    const row = classifyFacultyResearchPromotion(promotable({ kind: 'lab' }));
    expect(row.decision).toBe('PROMOTE');
    expect(row.toKind).toBeUndefined();
  });

  it('holds a row whose url is shared with another live entity', () => {
    const row = classifyFacultyResearchPromotion(promotable({ urlUsageCount: 2 }));
    expect(row.decision).toBe('HOLD');
    expect(row.holdReason).toBe('website_url_shared');
  });

  it('holds a row with no url at all', () => {
    const row = classifyFacultyResearchPromotion(promotable({ websiteUrl: '' }));
    expect(row.decision).toBe('HOLD');
    expect(row.holdReason).toBe('missing_website_url');
  });

  it('holds a row pointed at an org or program page', () => {
    const row = classifyFacultyResearchPromotion(
      promotable({
        name: 'Emma Hodge Faculty Research',
        websiteUrl: 'https://medicine.yale.edu/psychiatry/research/clinics-and-programs/ocd/',
      }),
    );
    expect(row.decision).toBe('HOLD');
    expect(row.holdReason).toBe('website_url_is_org_page');
  });

  it('holds a row pointed at the person own department bio page', () => {
    const row = classifyFacultyResearchPromotion(
      promotable({
        name: 'Paul Fleury Faculty Research',
        websiteUrl: 'https://appliedphysics.yale.edu/paul-fleury',
      }),
    );
    expect(row.decision).toBe('HOLD');
    expect(row.holdReason).toBe('website_url_is_department_bio_page');
  });

  it('holds a row that is not a faculty research area', () => {
    const row = classifyFacultyResearchPromotion(promotable({ entityType: 'LAB' }));
    expect(row.decision).toBe('HOLD');
    expect(row.holdReason).toBe('not_faculty_research_area');
  });

  it('holds a row whose name is already a real lab name', () => {
    const row = classifyFacultyResearchPromotion(promotable({ name: 'Crair Laboratory' }));
    expect(row.decision).toBe('HOLD');
    expect(row.holdReason).toBe('name_not_placeholder');
  });

  it('keeps a /lab/ path promotable even though "lab" is not an org marker', () => {
    const row = classifyFacultyResearchPromotion(
      promotable({
        name: 'Hualiang Pi Faculty Research',
        websiteUrl: 'https://medicine.yale.edu/lab/pi/',
      }),
    );
    expect(row.decision).toBe('PROMOTE');
  });

  it('holds a row whose every citation is a widely-shared page', () => {
    const row = classifyFacultyResearchPromotion(promotable({ sourceUrlUsageCounts: [516, 40] }));
    expect(row.decision).toBe('HOLD');
    expect(row.holdReason).toBe('only_shared_citations');
  });

  it('promotes a row that cites at least one page about itself', () => {
    const row = classifyFacultyResearchPromotion(promotable({ sourceUrlUsageCounts: [516, 1] }));
    expect(row.decision).toBe('PROMOTE');
  });

  it('treats the shared-citation rule as unmet when there are no citations', () => {
    expect(hasOnlySharedCitations([])).toBe(false);
    expect(hasOnlySharedCitations(undefined)).toBe(false);
    expect(hasOnlySharedCitations([26])).toBe(true);
    expect(hasOnlySharedCitations([25])).toBe(false);
    expect(hasOnlySharedCitations([100, 3])).toBe(false);
  });

  it('summarizes promotions and hold reasons', () => {
    const rows = planFacultyResearchPromotion([
      promotable({ id: 'a' }),
      promotable({ id: 'b', name: 'Sean Barrett Faculty Research', websiteUrl: '' }),
      promotable({ id: 'c', name: 'Ada Fenick Faculty Research', urlUsageCount: 3 }),
    ]);
    const summary = summarizeFacultyResearchPromotion(3, rows);
    expect(summary.scanned).toBe(3);
    expect(summary.promoted).toBe(1);
    expect(summary.held).toBe(2);
    expect(summary.kindRealigned).toBe(1);
    expect(summary.byHoldReason).toEqual({
      missing_website_url: 1,
      website_url_shared: 1,
    });
  });

  it('classifies org and bio page shapes directly', () => {
    expect(looksLikeOrgPage('https://medicine.yale.edu/psychiatry/tobacco/tcors/')).toBe(true);
    expect(looksLikeOrgPage('https://cs.yale.edu/homes/abhishek/')).toBe(true);
    expect(looksLikeOrgPage('https://medicine.yale.edu/')).toBe(true);
    expect(looksLikeOrgPage('https://medicine.yale.edu/lab/townsend/')).toBe(false);
    expect(looksLikeOrgPage('https://rsl.yale.edu/')).toBe(false);
    expect(looksLikeOrgPage('https://campuspress.yale.edu/karatekinlab/')).toBe(false);
    expect(looksLikeOrgPage('http://www.marthamunoz.com/')).toBe(false);
    expect(looksLikeOrgPage('not a url')).toBe(true);
    expect(looksLikeOrgPage(null)).toBe(true);

    expect(
      looksLikeDepartmentBioPage(
        'Paul Fleury Faculty Research',
        'https://appliedphysics.yale.edu/paul-fleury',
      ),
    ).toBe(true);
    expect(
      looksLikeDepartmentBioPage('Amir A. Pahlavan Faculty Research', 'https://pahlavan.yale.edu/'),
    ).toBe(false);
    expect(
      looksLikeDepartmentBioPage('Martha Munoz Faculty Research', 'http://www.marthamunoz.com/'),
    ).toBe(false);
  });
});

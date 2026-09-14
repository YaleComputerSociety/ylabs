import { describe, expect, it } from 'vitest';
import {
  buildLookupTarget,
  isAdoptableLabSite,
  isWorthFetching,
  judgePage,
  needsLabWebsite,
  piNameFromEntityName,
} from '../findLabWebsitesCore';

describe('needsLabWebsite', () => {
  it('selects a row citing the professor but no lab site', () => {
    expect(
      needsLabWebsite({
        sourceUrls: [
          'https://medicine.yale.edu/profile/lauren-cohn/',
          'https://reporter.nih.gov/project-details/1',
        ],
      }),
    ).toBe(true);
  });

  it('skips a row that already has a lab site', () => {
    expect(
      needsLabWebsite({
        sourceUrls: ['https://medicine.yale.edu/profile/x/', 'https://xlab.org/'],
      }),
    ).toBe(false);
  });

  it('skips a row with no professor citation at all', () => {
    expect(needsLabWebsite({ sourceUrls: ['https://reporter.nih.gov/project-details/1'] })).toBe(
      false,
    );
    expect(needsLabWebsite({})).toBe(false);
  });
});

describe('buildLookupTarget', () => {
  it('strips product words to get the PI name', () => {
    expect(piNameFromEntityName('Lauren Cohn Lab')).toBe('Lauren Cohn');
    expect(piNameFromEntityName('The Berro Laboratory')).toBe('Berro');
  });

  it('refuses a one-token PI name, which would search for a surname alone', () => {
    expect(buildLookupTarget({ slug: 'x', name: 'Cohn Lab' })).toBeNull();
    expect(buildLookupTarget({ slug: 'x', name: 'Lab' })).toBeNull();
  });

  it('builds a quoted query for a full name', () => {
    expect(buildLookupTarget({ slug: 'ysm-cohn', name: 'Lauren Cohn Lab' })).toEqual({
      entitySlug: 'ysm-cohn',
      entityName: 'Lauren Cohn Lab',
      piName: 'Lauren Cohn',
      query: '"Lauren Cohn" Yale lab research group',
    });
  });
});

describe('isWorthFetching', () => {
  it('rejects the hosts that dominate a name search', () => {
    for (const url of [
      'https://www.linkedin.com/in/someone/',
      'https://twitter.com/someone',
      'https://bsky.app/profile/someone',
      'https://www.researchgate.net/profile/Someone',
      'https://scholar.google.com/citations?user=x',
      'https://pubmed.ncbi.nlm.nih.gov/123456/',
      'https://doi.org/10.1000/x',
      'https://en.wikipedia.org/wiki/Someone',
      'https://www.doximity.com/pub/someone',
    ]) {
      expect(isWorthFetching(url), url).toBe(false);
    }
  });

  // The row already has a profile link; the point of the lane is the OTHER link.
  it('rejects a Yale profile page and a grant record', () => {
    expect(isWorthFetching('https://medicine.yale.edu/profile/lauren-cohn/')).toBe(false);
    expect(isWorthFetching('https://reporter.nih.gov/project-details/1')).toBe(false);
  });

  it('accepts a plausible independent lab domain', () => {
    expect(isWorthFetching('https://carrielucaslab.org/')).toBe(true);
    expect(isWorthFetching('https://holland.chem.yale.edu/')).toBe(true);
  });

  it('rejects a non-url', () => {
    expect(isWorthFetching(undefined)).toBe(false);
    expect(isWorthFetching('not a url')).toBe(false);
  });
});

describe('the adoption gate', () => {
  const judge = (title: string, body: string, pi: string) =>
    judgePage('https://example.org/', 200, title, body, pi);

  it('adopts a page naming the PI, Yale, and reading like a lab', () => {
    const v = judge(
      'Holland Group',
      'The Holland Group at Yale University. Principal Investigator Patrick Holland. Publications.',
      'Patrick Holland',
    );
    expect(isAdoptableLabSite(v, 'Patrick Holland')).toBe(true);
  });

  // The measured failure mode: a real Yale lab belonging to a DIFFERENT person who
  // shares the surname. Both name tokens are required for exactly this case.
  it('refuses a same-surname lab belonging to someone else', () => {
    const v = judge(
      'Bakhoum Lab at Yale',
      'The Mathieu Bakhoum Lab at Yale. Our research bridges ophthalmology and cancer. Lab members.',
      'Christine Bakhoum',
    );
    expect(v.mentionsYale).toBe(true);
    expect(v.looksLikeLabSite).toBe(true);
    expect(v.namesPi).toBe(false);
    expect(isAdoptableLabSite(v, 'Christine Bakhoum')).toBe(false);
  });

  it('refuses a commercial site that merely matches a surname', () => {
    const v = judge(
      'GentleLAB - Smart Science for Sustainable Skin',
      'Our lab formulates skincare.',
      'Samuel Gentle',
    );
    expect(isAdoptableLabSite(v, 'Samuel Gentle')).toBe(false);
  });

  it('refuses a lab site at another institution', () => {
    const v = judge(
      'Kwan Lab',
      'The Alex Kwan lab, a systems neuroscience lab in the Meinig School of Biomedical Engineering at Cornell University. Lab members.',
      'Alex Kwan',
    );
    expect(v.namesPi).toBe(true);
    expect(v.mentionsYale).toBe(false);
    expect(isAdoptableLabSite(v, 'Alex Kwan')).toBe(false);
  });

  it('refuses a page that names the PI at Yale but is not a lab site', () => {
    const v = judge(
      'Yale Directory',
      'Patrick Holland, Yale University. Contact information.',
      'Patrick Holland',
    );
    expect(v.looksLikeLabSite).toBe(false);
    expect(isAdoptableLabSite(v, 'Patrick Holland')).toBe(false);
  });

  it('refuses any non-2xx page and any one-token PI name', () => {
    const ok = judgePage(
      'https://e.org/',
      200,
      'Cohn Lab',
      'Lauren Cohn Yale our lab',
      'Lauren Cohn',
    );
    expect(isAdoptableLabSite({ ...ok, status: 404 }, 'Lauren Cohn')).toBe(false);
    expect(isAdoptableLabSite(ok, 'Cohn')).toBe(false);
  });
});

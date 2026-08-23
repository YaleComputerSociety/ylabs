import { describe, expect, it } from 'vitest';
import {
  isBareDomainRootUrl,
  isBoilerplatePlatformHostUrl,
  isDirectoryLoaderUrl,
  isDisallowedResearchEntitySourceUrl,
  isFacetedOrSectionIndexUrl,
  isFileShareOrDocumentUrl,
  isListingOrIndexUrl,
  isPersonProfileOrDirectoryUrl,
  isProfileOrPeopleDirectoryPath,
  isUnhelpfulProgramUrl,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../researchHomeWebsiteUrl';

describe('isProfileOrPeopleDirectoryPath', () => {
  it('matches profile, people, faculty, and faculty-directory paths', () => {
    expect(isProfileOrPeopleDirectoryPath('/profile/jordan-example/')).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/people/jordan-example/')).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/person/jordan-example/')).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/faculty/jordan-example/')).toBe(true);
    expect(
      isProfileOrPeopleDirectoryPath('/research-and-faculty/faculty-directory/jordan-example/'),
    ).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/directory/faculty/jordan-example/')).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/who-we-are/faculty/jordan-example/')).toBe(true);
  });

  it('does not match real lab or research home paths', () => {
    expect(isProfileOrPeopleDirectoryPath('/')).toBe(false);
    expect(isProfileOrPeopleDirectoryPath('/research/')).toBe(false);
    expect(isProfileOrPeopleDirectoryPath('/genomics/')).toBe(false);
    expect(isProfileOrPeopleDirectoryPath('/labs/molecular-biology/')).toBe(false);
  });
});

describe('isDirectoryLoaderUrl', () => {
  it('rejects directory AJAX/loader endpoints (#549)', () => {
    expect(
      isDirectoryLoaderUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/load_faculty/172',
      ),
    ).toBe(true);
    expect(isDirectoryLoaderUrl('https://example.edu/directory/load_person/9001')).toBe(true);
    expect(isDirectoryLoaderUrl('https://example.edu/people/load_more/40')).toBe(true);
    expect(isDirectoryLoaderUrl('https://engineering.example.edu/faculty-directory/172')).toBe(
      true,
    );
  });

  it('keeps a named person profile subpath (fail-safe, #549)', () => {
    expect(
      isDirectoryLoaderUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/shruti-puri',
      ),
    ).toBe(false);
    expect(isDirectoryLoaderUrl('https://physics.example.edu/people/jordan-example/')).toBe(false);
    expect(isDirectoryLoaderUrl('https://example-computing-lab.example.org/')).toBe(false);
    expect(isDirectoryLoaderUrl(undefined)).toBe(false);
  });
});

describe('isDisallowedResearchEntitySourceUrl', () => {
  it('rejects directory AJAX/loader endpoints as sources (#549)', () => {
    expect(
      isDisallowedResearchEntitySourceUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/load_faculty/172',
      ),
    ).toBe(true);
    expect(
      isDisallowedResearchEntitySourceUrl('https://example.edu/directory/load_person/9001'),
    ).toBe(true);
  });

  it('keeps a named faculty-directory profile as an allowed source (#549)', () => {
    expect(
      isDisallowedResearchEntitySourceUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/shruti-puri',
      ),
    ).toBe(false);
  });

  it('rejects our own site and A-Z/lab-website index pages as sources', () => {
    expect(isDisallowedResearchEntitySourceUrl('https://yalelabs.io/api/research')).toBe(true);
    expect(isDisallowedResearchEntitySourceUrl('https://www.yalelabs.io/research/qin-yan')).toBe(
      true,
    );
    expect(
      isDisallowedResearchEntitySourceUrl(
        'https://medicine.yale.edu/about/a-to-z-index/lab-websites/',
      ),
    ).toBe(true);
    expect(
      isDisallowedResearchEntitySourceUrl(
        'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
      ),
    ).toBe(true);
  });

  it('rejects generic CMS/platform boilerplate hosts as sources (#572)', () => {
    expect(isDisallowedResearchEntitySourceUrl('http://wordpress.org/')).toBe(true);
    expect(isDisallowedResearchEntitySourceUrl('https://www.wordpress.com')).toBe(true);
    expect(isDisallowedResearchEntitySourceUrl('https://squarespace.com/')).toBe(true);
  });

  it('keeps a real per-lab research home as an allowed source', () => {
    expect(isDisallowedResearchEntitySourceUrl('https://medicine.yale.edu/lab/yan/')).toBe(false);
    expect(isDisallowedResearchEntitySourceUrl('https://medicine.yale.edu/profile/qin-yan/')).toBe(
      false,
    );
  });

  it('keeps a named per-person WordPress site as an allowed source (#556)', () => {
    expect(isDisallowedResearchEntitySourceUrl('https://rjohnwilliams.wordpress.com/')).toBe(false);
  });
});

describe('isFacetedOrSectionIndexUrl', () => {
  it('flags faceted directory queries and section-index roots on multiple hosts (#560, #569)', () => {
    expect(
      isFacetedOrSectionIndexUrl('https://research.example.edu/cores?f%5B0%5D=result_type%3A1'),
    ).toBe(true);
    expect(isFacetedOrSectionIndexUrl('https://research.example.edu/cores')).toBe(true);
    expect(isFacetedOrSectionIndexUrl('https://research.example.edu/centers-institutes')).toBe(
      true,
    );
    expect(isFacetedOrSectionIndexUrl('https://research.example.edu/centers-institutes/')).toBe(
      true,
    );
    expect(isFacetedOrSectionIndexUrl('https://environment.example.edu/research/centers')).toBe(
      true,
    );
    expect(isFacetedOrSectionIndexUrl('https://jackson.example.edu/centers-initiatives')).toBe(
      true,
    );
  });

  it('does not flag specific center/core child pages', () => {
    expect(isFacetedOrSectionIndexUrl('https://research.example.edu/cores/keck-microarray')).toBe(
      false,
    );
    expect(
      isFacetedOrSectionIndexUrl(
        'https://jackson.example.edu/centers-initiatives/kerry-initiative',
      ),
    ).toBe(false);
    expect(isFacetedOrSectionIndexUrl('https://example-lab.example.org/')).toBe(false);
    expect(isFacetedOrSectionIndexUrl(undefined)).toBe(false);
  });
});

describe('isBoilerplatePlatformHostUrl', () => {
  it('flags generic CMS/platform vendor hosts (#572)', () => {
    expect(isBoilerplatePlatformHostUrl('http://wordpress.org/')).toBe(true);
    expect(isBoilerplatePlatformHostUrl('https://www.wordpress.org/support/')).toBe(true);
    expect(isBoilerplatePlatformHostUrl('https://wordpress.com')).toBe(true);
    expect(isBoilerplatePlatformHostUrl('https://drupal.org/')).toBe(true);
    expect(isBoilerplatePlatformHostUrl('https://www.squarespace.com/')).toBe(true);
    expect(isBoilerplatePlatformHostUrl('https://wix.com/')).toBe(true);
  });

  it('keeps named per-person subdomains and real research hosts (#556)', () => {
    expect(isBoilerplatePlatformHostUrl('https://rjohnwilliams.wordpress.com/')).toBe(false);
    expect(isBoilerplatePlatformHostUrl('https://campuspress.yale.edu/rjohnwilliams/')).toBe(false);
    expect(isBoilerplatePlatformHostUrl('https://example-lab.example.edu/')).toBe(false);
    expect(isBoilerplatePlatformHostUrl('mailto:someone@example.org')).toBe(false);
    expect(isBoilerplatePlatformHostUrl(undefined)).toBe(false);
  });
});

describe('isFileShareOrDocumentUrl', () => {
  it('flags file-share hosts (#730)', () => {
    expect(isFileShareOrDocumentUrl('https://drive.google.com/open/')).toBe(true);
    expect(
      isFileShareOrDocumentUrl(
        'https://drive.google.com/open?id=1QwRyarvB_ZeBtk_IvIA77E_eSvYFwmOp&usp=drive_copy',
      ),
    ).toBe(true);
    expect(isFileShareOrDocumentUrl('https://docs.google.com/document/d/abc123/edit')).toBe(true);
    expect(isFileShareOrDocumentUrl('https://www.dropbox.com/s/abc123/paper.pdf')).toBe(true);
    expect(isFileShareOrDocumentUrl('https://app.box.com/s/abc123')).toBe(true);
    expect(isFileShareOrDocumentUrl('https://1drv.ms/w/s!abc123')).toBe(true);
  });

  it('flags direct document links regardless of host (#730)', () => {
    expect(
      isFileShareOrDocumentUrl(
        'https://history.example.edu/sites/default/files/files/2010%20rankin%20-%20epistemology%20of%20the%20suburbs.pdf',
      ),
    ).toBe(true);
    expect(isFileShareOrDocumentUrl('https://lab.example.edu/papers/summary.docx')).toBe(true);
    expect(isFileShareOrDocumentUrl('https://lab.example.edu/slides/talk.pptx')).toBe(true);
    expect(isFileShareOrDocumentUrl('https://lab.example.edu/data/results.xlsx')).toBe(true);
  });

  it('does not flag a real lab site or malformed values', () => {
    expect(isFileShareOrDocumentUrl('https://example-computing-lab.example.org/')).toBe(false);
    expect(isFileShareOrDocumentUrl('https://lab.example.edu/publications/')).toBe(false);
    expect(isFileShareOrDocumentUrl('mailto:someone@example.org')).toBe(false);
    expect(isFileShareOrDocumentUrl(undefined)).toBe(false);
  });
});

describe('isListingOrIndexUrl', () => {
  it('flags A-Z / lab-website index pages', () => {
    expect(
      isListingOrIndexUrl('https://medicine.example.edu/about/a-to-z-index/lab-websites'),
    ).toBe(true);
    expect(isListingOrIndexUrl('https://medicine.example.edu/about/a-to-z-index/')).toBe(true);
  });

  it('flags paginated directory listings', () => {
    expect(isListingOrIndexUrl('https://physics.example.edu/people?page=8')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/faculty?page=2&sort=az')).toBe(true);
  });

  it('flags bare people, people/faculty, and faculty roster roots', () => {
    expect(isListingOrIndexUrl('https://physics.example.edu/people')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/people/')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/people/faculty')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/mcdb/faculty/')).toBe(true);
    expect(isListingOrIndexUrl('https://centers.example.edu/directory')).toBe(true);
  });

  it('flags people-roster and people-index subpages (#518)', () => {
    expect(isListingOrIndexUrl('https://quantuminstitute.example.edu/people/members')).toBe(true);
    expect(isListingOrIndexUrl('https://medicine.example.edu/lab/simons/people/index.aspx')).toBe(
      true,
    );
    expect(isListingOrIndexUrl('https://qbio.example.edu/people.html')).toBe(true);
    expect(isListingOrIndexUrl('https://centers.example.edu/members/')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/people/faculty-directory')).toBe(true);
  });

  it('flags directory AJAX/loader endpoints (#549)', () => {
    expect(
      isListingOrIndexUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/load_faculty/172',
      ),
    ).toBe(true);
    expect(isListingOrIndexUrl('https://example.edu/directory/load_person/9001')).toBe(true);
  });

  it('flags Drupal facet URLs and section-index roots (#560)', () => {
    expect(isListingOrIndexUrl('https://research.example.edu/cores?f%5B0%5D=result_type%3A1')).toBe(
      true,
    );
    expect(isListingOrIndexUrl('https://research.example.edu/cores?f[0]=result_type:1')).toBe(true);
    expect(isListingOrIndexUrl('https://research.example.edu/cores')).toBe(true);
    expect(isListingOrIndexUrl('https://research.example.edu/centers-institutes')).toBe(true);
  });

  it('flags section-index roots across multiple hosts (#569)', () => {
    expect(isListingOrIndexUrl('https://environment.example.edu/research/centers')).toBe(true);
    expect(isListingOrIndexUrl('https://jackson.example.edu/centers-initiatives/')).toBe(true);
    expect(isListingOrIndexUrl('https://centers.example.edu/centers')).toBe(true);
  });

  it('does not flag core or center detail child pages (#560, #569)', () => {
    expect(isListingOrIndexUrl('https://research.example.edu/cores/keck-microarray')).toBe(false);
    expect(isListingOrIndexUrl('https://research.example.edu/centers-institutes/wu-tsai')).toBe(
      false,
    );
    expect(
      isListingOrIndexUrl('https://environment.example.edu/research/centers/energy-center'),
    ).toBe(false);
    expect(
      isListingOrIndexUrl('https://jackson.example.edu/centers-initiatives/kerry-initiative'),
    ).toBe(false);
  });

  it('flags /directory faculty-roster roots across hosts (#569)', () => {
    expect(isListingOrIndexUrl('https://isps.example.edu/team/directory/faculty-fellows')).toBe(
      true,
    );
    expect(isListingOrIndexUrl('https://isps.example.edu/team/directory/faculty-fellows/')).toBe(
      true,
    );
    expect(isListingOrIndexUrl('https://environment.example.edu/directory/faculty')).toBe(true);
    expect(isListingOrIndexUrl('https://centers.example.edu/directory/staff/')).toBe(true);
  });

  it('keeps a named per-person /directory/faculty profile (#556)', () => {
    expect(
      isListingOrIndexUrl('https://environment.example.edu/directory/faculty/jordan-example'),
    ).toBe(false);
    expect(
      isListingOrIndexUrl('https://environment.example.edu/directory/faculty/jordan-example/'),
    ).toBe(false);
    expect(
      isListingOrIndexUrl('https://isps.example.edu/team/directory/faculty-fellows/jordan-example'),
    ).toBe(false);
  });

  it('does not flag real lab, center, or person pages', () => {
    expect(isListingOrIndexUrl('https://example-computing-lab.example.org/')).toBe(false);
    expect(
      isListingOrIndexUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/shruti-puri',
      ),
    ).toBe(false);
    expect(isListingOrIndexUrl('https://centers.example.edu/genomics/')).toBe(false);
    expect(isListingOrIndexUrl('https://physics.example.edu/people/jordan-example/')).toBe(false);
    expect(isListingOrIndexUrl('https://economics.example.edu/people/jordan-example')).toBe(false);
    expect(
      isListingOrIndexUrl('https://english.example.edu/people/professors-emeritus/j-doe'),
    ).toBe(false);
    expect(isListingOrIndexUrl('mailto:someone@example.org')).toBe(false);
    expect(isListingOrIndexUrl(undefined)).toBe(false);
  });
});

describe('isPersonProfileOrDirectoryUrl', () => {
  it('flags Yale-style profile and faculty-directory pages regardless of host', () => {
    expect(
      isPersonProfileOrDirectoryUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
      ),
    ).toBe(true);
    expect(
      isPersonProfileOrDirectoryUrl('https://medicine.example.edu/profile/jordan-example/'),
    ).toBe(true);
    expect(isPersonProfileOrDirectoryUrl('https://physics.example.edu/people/jordan-example')).toBe(
      true,
    );
  });

  it('does not flag real lab microsites or external personal sites', () => {
    expect(isPersonProfileOrDirectoryUrl('https://lab.example.org/')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('https://molecular-example-lab.example.edu/')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('https://example-scholar.example.com/')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('https://centers.example.edu/genomics/')).toBe(false);
  });

  it('ignores non-http and malformed values', () => {
    expect(isPersonProfileOrDirectoryUrl('mailto:someone@example.org')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('not a url')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl(undefined)).toBe(false);
    expect(isPersonProfileOrDirectoryUrl(42)).toBe(false);
  });
});

describe('sourceUrlToResearchHomeWebsiteUrl', () => {
  it('accepts external personal sites and specific lab microsites', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('https://example-computing-lab.example.org/')).toBe(
      'https://example-computing-lab.example.org/',
    );
    expect(sourceUrlToResearchHomeWebsiteUrl('https://examplelab.example.edu')).toBe(
      'https://examplelab.example.edu/',
    );
  });

  it('rejects profile, directory, opportunity, and content source URLs', () => {
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://medicine.example.edu/profile/jordan-example/'),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
      ),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://cancer.example.edu/research/membership/directory'),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://psychology.example.edu/diversity/research-opportunities-undergraduates',
      ),
    ).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://news.example.edu/story/2026/award/')).toBe(
      '',
    );
  });

  it('rejects grant and identifier hosts', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('https://reporter.nih.gov/project/1')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://api.nsf.gov/services/v1/awards.json')).toBe(
      '',
    );
  });

  it('accepts a named Google Sites lab site (#537)', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('https://sites.google.com/view/example-lab')).toBe(
      'https://sites.google.com/view/example-lab/',
    );
    expect(sourceUrlToResearchHomeWebsiteUrl('https://sites.google.com/site/examplelab/home')).toBe(
      'https://sites.google.com/site/examplelab/home/',
    );
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://sites.google.com/yale.edu/jordan-example/home'),
    ).toBe('https://sites.google.com/yale.edu/jordan-example/home/');
  });

  it('still rejects a bare Google Sites host with no named site (#537)', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('https://sites.google.com/')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://sites.google.com/view')).toBe('');
  });

  it('rejects directory, index, and paginated listing source URLs', () => {
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://medicine.example.edu/about/a-to-z-index/lab-websites',
      ),
    ).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://physics.example.edu/people?page=8')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://physics.example.edu/mcdb/faculty/')).toBe('');
  });

  it('rejects faceted and multi-host section-index-root source URLs (#569)', () => {
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://research.example.edu/cores?f%5B0%5D=result_type%3A1',
      ),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://research.example.edu/centers-institutes'),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://environment.example.edu/research/centers'),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://jackson.example.edu/centers-initiatives'),
    ).toBe('');
  });

  it('rejects generic CMS/platform boilerplate hosts (#572)', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('http://wordpress.org/')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://www.wordpress.com/')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://squarespace.com/')).toBe('');
  });

  it('rejects file-share and direct-document source URLs (#730)', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('https://drive.google.com/open/')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://www.dropbox.com/s/abc123/lab.pdf')).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://history.example.edu/sites/default/files/files/2010%20rankin%20-%20epistemology%20of%20the%20suburbs.pdf',
      ),
    ).toBe('');
  });
});

describe('isBareDomainRootUrl', () => {
  it('flags a bare domain root with no path or query (#692)', () => {
    expect(isBareDomainRootUrl('https://engineering.yale.edu/')).toBe(true);
    expect(isBareDomainRootUrl('https://engineering.yale.edu')).toBe(true);
    expect(isBareDomainRootUrl('http://example.org///')).toBe(true);
  });

  it('keeps a specific page path or a query-bearing root', () => {
    expect(
      isBareDomainRootUrl(
        'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
      ),
    ).toBe(false);
    expect(isBareDomainRootUrl('https://engineering.yale.edu/apply')).toBe(false);
    expect(isBareDomainRootUrl('https://apply.example.com/?fund=123')).toBe(false);
  });

  it('ignores non-http and malformed values', () => {
    expect(isBareDomainRootUrl('mailto:someone@example.edu')).toBe(false);
    expect(isBareDomainRootUrl('not a url')).toBe(false);
    expect(isBareDomainRootUrl(undefined)).toBe(false);
  });
});

describe('isUnhelpfulProgramUrl', () => {
  it('rejects bare roots, listing/index pages, and boilerplate hosts (#692)', () => {
    expect(isUnhelpfulProgramUrl('https://engineering.yale.edu/')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://physics.example.edu/people?page=2')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://squarespace.com/')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://www.yalelabs.io/')).toBe(true);
  });

  it('keeps a specific official/apply program page', () => {
    expect(
      isUnhelpfulProgramUrl(
        'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
      ),
    ).toBe(false);
    expect(isUnhelpfulProgramUrl('https://apply.communityforce.com/Funds/FundDetails.aspx?id=9')).toBe(
      false,
    );
  });

  it('exempts dedicated application-portal roots that are the real apply entry point', () => {
    expect(isUnhelpfulProgramUrl('http://studentgrants.yale.edu/')).toBe(false);
    expect(isUnhelpfulProgramUrl('https://yale.communityforce.com/')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isBareDomainRootUrl,
  isCustomYaleResearchHomeSubdomain,
  isBoilerplatePlatformHostUrl,
  isDepartmentAudiencePageUrl,
  isDepartmentProgrammePageUrl,
  isProgrammePageCitedByPerson,
  isDepartmentRosterProvenanceUrl,
  isDirectoryLoaderUrl,
  isDisallowedResearchEntitySourceUrl,
  isFacetedOrSectionIndexUrl,
  isFileShareOrDocumentUrl,
  isInstitutionalAdvancementUrl,
  isListingOrIndexUrl,
  isMultiTenantAcademicHostRootUrl,
  isMultiTenantAcademicHostTenantPageUrl,
  isPersonCmsProfileUrl,
  isPersonProfileOrDirectoryUrl,
  isPressOrNewsHostUrl,
  PRESS_AND_NEWS_HOST_URL_PATTERN,
  isProfileOrPeopleDirectoryPath,
  isRecordSpecificApplicationPortalUrl,
  isResearchGroupHostRootUrl,
  isOffsiteInstitutionPersonProfileUrl,
  isSameHostShallowChromeUrl,
  isSharedPeopleRosterUrl,
  isSiteNavigationOrFooterChromeUrl,
  isUmbrellaPageCitedByPerson,
  isUnhelpfulProgramUrl,
  organizationOwnedSiteUrlFromCitation,
  researchEntityOwnsMultiTenantAcademicHost,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../researchHomeWebsiteUrl';

describe('isRecordSpecificApplicationPortalUrl', () => {
  it('accepts a record-specific FundDetails URL with a query on a portal host', () => {
    expect(
      isRecordSpecificApplicationPortalUrl(
        'https://yale.communityforce.com/Funds/FundDetails.aspx?FundID=42',
      ),
    ).toBe(true);
  });

  it('rejects a bare portal root, a pathless host, and non-portal hosts', () => {
    expect(isRecordSpecificApplicationPortalUrl('https://yale.communityforce.com/')).toBe(false);
    expect(
      isRecordSpecificApplicationPortalUrl('https://yale.communityforce.com/Funds/Search.aspx'),
    ).toBe(false);
    expect(
      isRecordSpecificApplicationPortalUrl('https://example.com/Funds/FundDetails.aspx?FundID=42'),
    ).toBe(false);
    expect(isRecordSpecificApplicationPortalUrl('not a url')).toBe(false);
  });
});

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

  it('refuses to serve a citation on a platform-assigned deploy host (#2805)', () => {
    expect(
      isDisallowedResearchEntitySourceUrl(
        'https://ysoa-2025-nuxt-production-fqvp7.ondigitalocean.app/people/faculty-and-staff',
      ),
    ).toBe(true);
    expect(isDisallowedResearchEntitySourceUrl('https://example-lab.github.io/research')).toBe(
      false,
    );
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

describe('isOffsiteInstitutionPersonProfileUrl', () => {
  it("rejects another institution's faculty profile for the same person (#2512)", () => {
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://econ.example-university.edu/profile/sample-economist',
      ),
    ).toBe(true);
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://www.business.example-college.edu/academics-research/faculty/sample_economist/',
      ),
    ).toBe(true);
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://www.example-institute.eu/people/sample-economist',
      ),
    ).toBe(true);
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://business.example-university.edu/faculty/home.php?username=sample',
      ),
    ).toBe(true);
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://example-university.ca/social-sciences/economics/people/sample-w-economist/',
      ),
    ).toBe(true);
  });

  it('never rejects a Yale-hosted page, whatever its shape', () => {
    expect(
      isOffsiteInstitutionPersonProfileUrl('https://ling.yale.edu/profile/sample-person'),
    ).toBe(false);
    expect(isOffsiteInstitutionPersonProfileUrl('https://medicine.yale.edu/lab/sample/')).toBe(
      false,
    );
    expect(isOffsiteInstitutionPersonProfileUrl('https://samplelab.yale.edu/group-members/')).toBe(
      false,
    );
  });

  it('keeps a genuine personal or lab site on a non-Yale host', () => {
    expect(isOffsiteInstitutionPersonProfileUrl('https://sample-researcher.example.test/')).toBe(
      false,
    );
    expect(isOffsiteInstitutionPersonProfileUrl('http://sample-researcher.github.io/')).toBe(false);
    expect(
      isOffsiteInstitutionPersonProfileUrl('https://sample.wordpress.test/care-research-team/'),
    ).toBe(false);
  });

  it('rejects a person named under a nested institutional directory (#2512)', () => {
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://www.business.example-university.edu/faculty/directory/sample_economist.aspx',
      ),
    ).toBe(true);
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://psych.example-university.edu/people/faculty/sample-psychologist',
      ),
    ).toBe(true);
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://example-university.edu/directory/faculty/sample-economist/',
      ),
    ).toBe(true);
    expect(
      isOffsiteInstitutionPersonProfileUrl(
        'https://example-institute.eu/people/members/sample-researcher',
      ),
    ).toBe(true);
  });

  it('requires a person to be named after the directory segment, so a lab roster root is kept', () => {
    expect(isOffsiteInstitutionPersonProfileUrl('https://samplelab.example.test/people/')).toBe(
      false,
    );
    expect(isOffsiteInstitutionPersonProfileUrl('https://samplelab.example.test/faculty/')).toBe(
      false,
    );
    expect(
      isOffsiteInstitutionPersonProfileUrl('https://samplelab.example.test/people/faculty/'),
    ).toBe(false);
  });
});

describe('isSharedPeopleRosterUrl', () => {
  it('flags department-scoped roster slugs that the fixed /people/faculty shapes miss', () => {
    expect(isSharedPeopleRosterUrl('https://ling.example.edu/people/linguistics-faculty')).toBe(
      true,
    );
    expect(isSharedPeopleRosterUrl('https://religion.example.edu/people/core-faculty')).toBe(true);
    expect(isSharedPeopleRosterUrl('https://english.example.edu/people/ladder-faculty')).toBe(true);
    expect(isSharedPeopleRosterUrl('https://eall.example.edu/people/professors')).toBe(true);
    expect(isSharedPeopleRosterUrl('https://divinity.example.edu/about/faculty-directory')).toBe(
      true,
    );
    expect(isSharedPeopleRosterUrl('https://art.example.edu/about/people/faculty-and-staff')).toBe(
      true,
    );
    expect(isSharedPeopleRosterUrl('https://music.example.edu/meet-our-faculty')).toBe(true);
    expect(isSharedPeopleRosterUrl('https://whc.example.edu/people/our-people')).toBe(true);
    expect(isSharedPeopleRosterUrl('https://psychology.example.edu/people/faculty/primary')).toBe(
      true,
    );
  });

  it('never flags a person profile page as a shared roster', () => {
    expect(isSharedPeopleRosterUrl('https://ling.example.edu/profile/tom-example')).toBe(false);
    expect(isSharedPeopleRosterUrl('https://ling.example.edu/people/claire-example')).toBe(false);
    expect(isSharedPeopleRosterUrl('https://medicine.example.edu/profile/jordan-example/')).toBe(
      false,
    );
  });

  it('does not read a long article slug as a roster', () => {
    expect(
      isSharedPeopleRosterUrl(
        'https://law.example.edu/yls-today/news/professor-alex-example-aims-to-foster-connection-and-discourse',
      ),
    ).toBe(false);
  });

  it('still flags everything isListingOrIndexUrl flags', () => {
    expect(isSharedPeopleRosterUrl('https://physics.example.edu/people?page=8')).toBe(true);
    expect(isSharedPeopleRosterUrl('https://research.example.edu/cores')).toBe(true);
  });
});

describe('isListingOrIndexUrl', () => {
  it('leaves department-scoped roster slugs alone so websiteUrl promotion is unchanged', () => {
    expect(isListingOrIndexUrl('https://ling.example.edu/people/linguistics-faculty')).toBe(false);
    expect(isListingOrIndexUrl('https://theologyandpolicy.example.edu/team')).toBe(false);
  });

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

  it('flags membership-roster roots that graft shared areas onto every member', () => {
    expect(
      isListingOrIndexUrl('https://medicine.example.edu/cancer/research/membership/directory/'),
    ).toBe(true);
    expect(isListingOrIndexUrl('https://medicine.example.edu/cancer/research/membership/')).toBe(
      true,
    );
    expect(isListingOrIndexUrl('https://medicine.example.edu/cancer/research/membership')).toBe(
      true,
    );
    expect(isListingOrIndexUrl('https://medicine.example.edu/cancer/profile/jordan-example/')).toBe(
      false,
    );
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

describe('isMultiTenantAcademicHostRootUrl', () => {
  it('flags the root of a shared academic host that publishes ~user tenant pages (#2359)', () => {
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/')).toBe(true);
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu')).toBe(true);
    expect(isMultiTenantAcademicHostRootUrl('http://CSL.yale.edu/')).toBe(true);
    expect(isMultiTenantAcademicHostRootUrl('https://www.stat.yale.edu/')).toBe(true);
    expect(isMultiTenantAcademicHostRootUrl('https://ursula.chem.yale.edu/')).toBe(true);
  });

  it('flags an index-file root, because the host routes through index.php', () => {
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/index.php')).toBe(true);
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/index.html')).toBe(true);
  });

  it('flags the `www.` alias of every listed host, not just the one spelled with it', () => {
    expect(isMultiTenantAcademicHostRootUrl('https://www.csl.yale.edu/')).toBe(true);
    expect(isMultiTenantAcademicHostRootUrl('https://www.pantheon.yale.edu/')).toBe(true);
    expect(isMultiTenantAcademicHostRootUrl('https://www.gauss.math.yale.edu/index.php')).toBe(
      true,
    );
    expect(isMultiTenantAcademicHostRootUrl('https://www.math.mit.edu/')).toBe(true);
  });

  it('leaves a tenant page under the same host promotable', () => {
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/~arun/')).toBe(false);
    expect(isMultiTenantAcademicHostRootUrl('https://www.stat.yale.edu/~hz68/')).toBe(false);
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/index.php/people/')).toBe(false);
  });

  it('recognizes a tenant page on a multi-label host as the tenant’s own site', () => {
    expect(isMultiTenantAcademicHostTenantPageUrl('https://gauss.math.yale.edu/~an592/')).toBe(
      true,
    );
    expect(isMultiTenantAcademicHostTenantPageUrl('https://www.csl.yale.edu/~arun/')).toBe(true);
    expect(isMultiTenantAcademicHostTenantPageUrl('https://csl.yale.edu/')).toBe(false);
    expect(isMultiTenantAcademicHostTenantPageUrl('https://engineering.yale.edu/~arun/')).toBe(
      false,
    );
  });

  it('keeps the root for the host organization’s own entity', () => {
    expect(
      isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/', { name: 'Computer Systems Lab' }),
    ).toBe(false);
    expect(
      isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/', {
        name: 'Yale Computer Systems Laboratory',
      }),
    ).toBe(false);
    expect(
      isDisallowedResearchEntitySourceUrl('https://csl.yale.edu/', {
        name: 'Computer Systems Lab',
      }),
    ).toBe(false);
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://csl.yale.edu/', { name: 'Computer Systems Lab' }),
    ).toBe('https://csl.yale.edu/');
  });

  it('still rejects the root for a tenant whose name does not name the host', () => {
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/', { name: 'Manohar Lab' })).toBe(
      true,
    );
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/', { name: '' })).toBe(true);
  });

  it('refuses ownership to a person-scoped entity even when a grafted name names the host', () => {
    const graftedPersonRow = {
      name: 'Computer Systems Lab at Yale',
      displayName: 'Computer Systems Lab at Yale',
      entityType: 'LAB',
      kind: 'lab',
    };
    expect(
      researchEntityOwnsMultiTenantAcademicHost('https://csl.yale.edu/', graftedPersonRow),
    ).toBe(false);
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/', graftedPersonRow)).toBe(true);
    expect(isDisallowedResearchEntitySourceUrl('https://csl.yale.edu/', graftedPersonRow)).toBe(
      true,
    );
    expect(sourceUrlToResearchHomeWebsiteUrl('https://csl.yale.edu/', graftedPersonRow)).toBe('');
  });

  it('grants ownership to an organization-shaped entity that names the host', () => {
    const organizationRow = {
      name: 'Computer Systems Lab',
      entityType: 'CENTER',
      kind: 'center',
    };
    expect(
      researchEntityOwnsMultiTenantAcademicHost('https://csl.yale.edu/', organizationRow),
    ).toBe(true);
    expect(isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/', organizationRow)).toBe(false);
  });

  it('refuses ownership on entity shape alone for the other person-scoped types', () => {
    for (const entityType of ['FACULTY_RESEARCH_AREA', 'INDIVIDUAL_RESEARCH', 'FACULTY_PROJECT']) {
      expect(
        isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/', {
          name: 'Computer Systems Lab',
          entityType,
        }),
      ).toBe(true);
    }
    for (const kind of ['lab', 'individual', 'solo']) {
      expect(
        isMultiTenantAcademicHostRootUrl('https://csl.yale.edu/', {
          name: 'Computer Systems Lab',
          kind,
        }),
      ).toBe(true);
    }
  });

  it('ignores hosts that are not shared academic hosts, and malformed values', () => {
    expect(isMultiTenantAcademicHostRootUrl('https://engineering.yale.edu/')).toBe(false);
    expect(isMultiTenantAcademicHostRootUrl('https://belieflab.yale.edu/')).toBe(false);
    expect(isMultiTenantAcademicHostRootUrl('not a url')).toBe(false);
    expect(isMultiTenantAcademicHostRootUrl(undefined)).toBe(false);
  });

  it('is disallowed as a research-entity source URL and never becomes a website', () => {
    expect(isDisallowedResearchEntitySourceUrl('https://csl.yale.edu/')).toBe(true);
    expect(isDisallowedResearchEntitySourceUrl('https://www.csl.yale.edu/')).toBe(true);
    expect(sourceUrlToResearchHomeWebsiteUrl('https://csl.yale.edu/')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://www.csl.yale.edu/')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://csl.yale.edu/~arun/')).toBe(
      'https://csl.yale.edu/~arun/',
    );
  });

  it('keeps a tenant page on a multi-label host promotable as a research home', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('https://gauss.math.yale.edu/~an592/')).toBe(
      'https://gauss.math.yale.edu/~an592/',
    );
    expect(sourceUrlToResearchHomeWebsiteUrl('http://gauss.math.yale.edu/~jw378')).toBe(
      'http://gauss.math.yale.edu/~jw378/',
    );
    expect(sourceUrlToResearchHomeWebsiteUrl('https://gauss.math.yale.edu/')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://ursula.chem.yale.edu/~batista/')).toBe(
      'https://ursula.chem.yale.edu/~batista/',
    );
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
    expect(
      isUnhelpfulProgramUrl('https://apply.communityforce.com/Funds/FundDetails.aspx?id=9'),
    ).toBe(false);
  });

  it('exempts dedicated application-portal roots that are the real apply entry point', () => {
    expect(isUnhelpfulProgramUrl('http://studentgrants.yale.edu/')).toBe(false);
    expect(isUnhelpfulProgramUrl('https://yale.communityforce.com/')).toBe(false);
  });

  it('rejects same-host site nav/footer chrome shallower than the program source page (#633)', () => {
    const sourceUrl =
      'https://school.example.edu/academic-study/departments/example-dept/undergraduate-study/research-internship-program';
    expect(isUnhelpfulProgramUrl('https://school.example.edu/apply', sourceUrl)).toBe(true);
    expect(isUnhelpfulProgramUrl('https://school.example.edu/give', sourceUrl)).toBe(true);
    expect(isUnhelpfulProgramUrl('https://school.example.edu/contact-us', sourceUrl)).toBe(true);
    expect(isUnhelpfulProgramUrl('https://school.example.edu/campus-life', sourceUrl)).toBe(true);
    expect(
      isUnhelpfulProgramUrl('https://school.example.edu/academic-study/undergraduate', sourceUrl),
    ).toBe(true);
    expect(isUnhelpfulProgramUrl('https://school.example.edu/about/openings', sourceUrl)).toBe(
      true,
    );
  });

  it('keeps the same-host source page and off-host or program-specific links', () => {
    const sourceUrl = 'https://center.example.edu/education/summer-undergraduate-internships';
    expect(isUnhelpfulProgramUrl(sourceUrl, sourceUrl)).toBe(false);
    expect(
      isUnhelpfulProgramUrl(
        'https://apply.communityforce.com/Funds/FundDetails.aspx?id=9',
        sourceUrl,
      ),
    ).toBe(false);
    expect(
      isUnhelpfulProgramUrl(
        'https://center.example.edu/education/example-research-grant',
        sourceUrl,
      ),
    ).toBe(false);
  });

  it('does not reject a shallow link when no source page context is given', () => {
    expect(isUnhelpfulProgramUrl('https://school.example.edu/apply')).toBe(false);
  });

  it('rejects same-host site nav/footer chrome links (#633)', () => {
    expect(isUnhelpfulProgramUrl('https://engineering.yale.edu/campus-life')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://engineering.yale.edu/faculty-directory')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://engineering.yale.edu/faculty-openings')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://www.yale.edu/privacy-policy')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://www.yale.edu/accessibility')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://www.yale.edu/contact-us')).toBe(true);
    expect(isUnhelpfulProgramUrl('https://www.yale.edu/give-back')).toBe(true);
  });
});

describe('isSameHostShallowChromeUrl', () => {
  it('ignores cross-host links and missing source context', () => {
    const sourceUrl = 'https://school.example.edu/academic-study/example-program';
    expect(isSameHostShallowChromeUrl('https://other.example.edu/apply', sourceUrl)).toBe(false);
    expect(isSameHostShallowChromeUrl('https://school.example.edu/apply', undefined)).toBe(false);
  });

  it('ignores links matching program-detail keywords even when shallow', () => {
    const sourceUrl = 'https://school.example.edu/academic-study/example-program';
    expect(isSameHostShallowChromeUrl('https://school.example.edu/fellowships', sourceUrl)).toBe(
      false,
    );
  });
});

describe('isSiteNavigationOrFooterChromeUrl (#633)', () => {
  it('flags footer/utility and top-nav chrome paths', () => {
    expect(isSiteNavigationOrFooterChromeUrl('https://engineering.yale.edu/privacy')).toBe(true);
    expect(isSiteNavigationOrFooterChromeUrl('https://engineering.yale.edu/accessibility')).toBe(
      true,
    );
    expect(isSiteNavigationOrFooterChromeUrl('https://engineering.yale.edu/contact/')).toBe(true);
    expect(isSiteNavigationOrFooterChromeUrl('https://engineering.yale.edu/giving')).toBe(true);
    expect(isSiteNavigationOrFooterChromeUrl('https://engineering.yale.edu/campus-life')).toBe(
      true,
    );
    expect(isSiteNavigationOrFooterChromeUrl('https://engineering.yale.edu/sitemap')).toBe(true);
  });

  it('does not flag a genuine program page on the same host', () => {
    expect(
      isSiteNavigationOrFooterChromeUrl(
        'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
      ),
    ).toBe(false);
    expect(
      isSiteNavigationOrFooterChromeUrl('https://engineering.yale.edu/undergraduate-study'),
    ).toBe(false);
    expect(isSiteNavigationOrFooterChromeUrl('not a url')).toBe(false);
  });
});

describe('isPersonCmsProfileUrl', () => {
  it('flags only the narrow CMS profile shape, not the wider faculty-directory family', () => {
    expect(isPersonCmsProfileUrl('https://medicine.example.edu/profile/jordan-example/')).toBe(
      true,
    );
    expect(isPersonCmsProfileUrl('https://ysph.example.edu/profile/jordan-example')).toBe(true);
    expect(
      isPersonCmsProfileUrl(
        'https://som.example.edu/faculty-research/faculty-directory/jordan-example',
      ),
    ).toBe(false);
    expect(
      isPersonCmsProfileUrl('https://environment.example.edu/directory/faculty/jordan-example'),
    ).toBe(false);
    expect(
      isPersonCmsProfileUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
      ),
    ).toBe(false);
  });

  it('ignores malformed values', () => {
    expect(isPersonCmsProfileUrl('not-a-url')).toBe(false);
    expect(isPersonCmsProfileUrl(undefined)).toBe(false);
  });
});

describe('isDepartmentRosterProvenanceUrl', () => {
  it('flags the Yale roster provenance shapes the detail page refuses to render', () => {
    expect(isDepartmentRosterProvenanceUrl('https://economics.yale.edu/people/faculty')).toBe(true);
    expect(
      isDepartmentRosterProvenanceUrl('https://economics.yale.edu/people/faculty/jordan-example'),
    ).toBe(true);
    expect(
      isDepartmentRosterProvenanceUrl(
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/load_faculty/172',
      ),
    ).toBe(true);
    expect(
      isDepartmentRosterProvenanceUrl(
        'https://www.engineering.yale.edu/research-and-faculty/faculty-directory/',
      ),
    ).toBe(true);
  });

  it('flags the collective-leaf roster shapes the client predicate also rejects', () => {
    expect(isDepartmentRosterProvenanceUrl('https://whc.yale.edu/people/our-people')).toBe(true);
    expect(
      isDepartmentRosterProvenanceUrl('https://ling.yale.edu/people/linguistics-faculty'),
    ).toBe(true);
    expect(isDepartmentRosterProvenanceUrl('https://religion.yale.edu/people/core-faculty')).toBe(
      true,
    );
    expect(isDepartmentRosterProvenanceUrl('https://french.yale.edu/people/professors')).toBe(true);
  });

  it('leaves a renderable person profile and any non-Yale host alone', () => {
    expect(
      isDepartmentRosterProvenanceUrl('https://medicine.yale.edu/profile/jordan-example/'),
    ).toBe(false);
    expect(
      isDepartmentRosterProvenanceUrl(
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/jordan-example',
      ),
    ).toBe(false);
    expect(
      isDepartmentRosterProvenanceUrl(
        'https://economics.example.edu/people/faculty/jordan-example',
      ),
    ).toBe(false);
    expect(isDepartmentRosterProvenanceUrl('not-a-url')).toBe(false);
    expect(isDepartmentRosterProvenanceUrl(undefined)).toBe(false);
  });
});

describe('isInstitutionalAdvancementUrl', () => {
  it('refuses a donor-story page under a giving section', () => {
    for (const url of [
      'https://sph.yale.edu/about/charitable-opportunities/donors-make-a-difference/example-fund/',
      'https://example.yale.edu/giving/',
      'https://example.yale.edu/ways-to-give/endowed-professorships/',
      'https://example.yale.edu/about/make-a-gift/',
      'https://example.yale.edu/alumni-giving/annual-fund/',
      'https://example.yale.edu/philanthropy/impact/',
      'https://example.yale.edu/development-office/staff/',
      'https://example.yale.edu/about/donor-relations/',
    ]) {
      expect(isInstitutionalAdvancementUrl(url)).toBe(true);
    }
  });

  it('keeps a research home whose name merely contains a giving-like substring', () => {
    for (const url of [
      'https://givinglab.example.org/',
      'https://example.yale.edu/development-biology/',
      'https://marlowelab.example.org/',
      'https://medicine.yale.edu/lab/example/',
      'https://example.yale.edu/profile/avery-marlowe/',
      'https://example.yale.edu/research/donor-conception-studies-group/',
      'https://example.yale.edu/research/organ-donation-policy-lab/',
      'https://example.yale.edu/research/endowment-effect-group/',
      'https://example.yale.edu/research/campaign-finance-project/',
      'https://example.yale.edu/labs/blood-donor-health/',
    ]) {
      expect(isInstitutionalAdvancementUrl(url)).toBe(false);
    }
  });

  it('is false for a non-URL', () => {
    expect(isInstitutionalAdvancementUrl(undefined)).toBe(false);
    expect(isInstitutionalAdvancementUrl('not a url')).toBe(false);
  });
});

describe('a press or news host as a research home (#2532)', () => {
  it('refuses an article on a press host regardless of its path shape', () => {
    for (const url of [
      'https://www.wsj.com/personal-finance/divorce-unmarried-cohabitation-laws-24057ac4',
      'https://www.cnn.com/2026/07/31/tv/video/example-segment',
      'https://www.nytimes.com/2026/01/02/science/example-story.html',
      'https://www.forbes.com/sites/example/2026/01/02/example/',
      'https://news.yale.edu/2024/06/05/example-headline',
      'https://news.yale.edu/',
      'https://npr.org/2026/01/02/1234/example',
    ]) {
      expect(isPressOrNewsHostUrl(url)).toBe(true);
      expect(PRESS_AND_NEWS_HOST_URL_PATTERN.test(url)).toBe(true);
    }
  });

  it('refuses a press host reached through a non-Yale bypass that skips the path checks', () => {
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://www.wsj.com/personal-finance/divorce-unmarried-cohabitation-laws-24057ac4',
      ),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://www.cnn.com/2026/07/31/tv/video/example-segment'),
    ).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://news.yale.edu/2024/06/05/example')).toBe('');
  });

  it('keeps a research home whose registrable domain merely ends in a press domain', () => {
    for (const url of [
      'https://elotroalex.example.org/',
      'https://sometime.example.org/lab/',
      'https://notnpr.example.org/lab/',
      'https://pylelab.example.org/',
      'https://medicine.yale.edu/lab/example/',
      'https://timeperception.example.org/',
    ]) {
      expect(isPressOrNewsHostUrl(url)).toBe(false);
      expect(PRESS_AND_NEWS_HOST_URL_PATTERN.test(url)).toBe(false);
      expect(sourceUrlToResearchHomeWebsiteUrl(url)).not.toBe('');
    }
  });

  it('accepts a subdomain of a press host, because it is the same publisher', () => {
    expect(isPressOrNewsHostUrl('https://edition.cnn.com/2026/01/02/example')).toBe(true);
    expect(PRESS_AND_NEWS_HOST_URL_PATTERN.test('https://edition.cnn.com/2026/01/02/example')).toBe(
      true,
    );
  });

  it('is false for a non-URL', () => {
    expect(isPressOrNewsHostUrl(undefined)).toBe(false);
    expect(isPressOrNewsHostUrl('not a url')).toBe(false);
  });
});

describe('directory-loader and departmental programme pages as research homes (#2605)', () => {
  it('condemns a Drupal views/ajax endpoint everywhere, because it is never a readable page', () => {
    expect(isDirectoryLoaderUrl('https://law.yale.edu/views/ajax')).toBe(true);
    expect(isListingOrIndexUrl('https://law.yale.edu/views/ajax')).toBe(true);
    expect(sourceUrlToResearchHomeWebsiteUrl('https://law.yale.edu/views/ajax')).toBe('');
  });

  it('refuses the two shapes that were actually served, covering all 19 rows', () => {
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
      ),
    ).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://law.yale.edu/views/ajax')).toBe('');
  });

  it('refuses departmental programme pages as a research home', () => {
    for (const url of [
      'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
      'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
      'https://math.yale.edu/undergraduates/undergraduate-research',
      'https://cogsci.yale.edu/research/undergraduate-research-opportunities',
      'https://eeb.yale.edu/academics/undergraduate-program/undergraduate-research-opportunities',
      'https://engineering.yale.edu/academic-study/undergraduate/research',
    ]) {
      expect(isDepartmentProgrammePageUrl(url)).toBe(true);
      expect(sourceUrlToResearchHomeWebsiteUrl(url)).toBe('');
    }
  });

  it('keeps those same pages usable as a SOURCE, because department-undergrad-research reads them', () => {
    for (const url of [
      'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
      'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
      'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
    ]) {
      expect(isListingOrIndexUrl(url)).toBe(false);
      expect(isDirectoryLoaderUrl(url)).toBe(false);
    }
  });

  it('does not refuse a real research home', () => {
    for (const url of [
      'https://ohernlab.yale.edu/',
      'https://www.khokhalab.org/',
      'https://medicine.yale.edu/lab/iwasaki/',
      'https://rutledgelab.yale.edu/',
      'https://gersteinlab.org/',
      'https://medicine.yale.edu/lab/iwasaki/',
    ]) {
      expect(isDepartmentProgrammePageUrl(url)).toBe(false);
      expect(sourceUrlToResearchHomeWebsiteUrl(url)).not.toBe('');
    }
  });

  it('ignores non-Yale hosts and single-segment paths', () => {
    expect(isDepartmentProgrammePageUrl('https://example.com/undergraduate/research')).toBe(false);
    expect(isDepartmentProgrammePageUrl('https://physics.yale.edu/research')).toBe(false);
  });
});

describe('programme page cited by a person (#2609)', () => {
  const PROGRAMME =
    'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research';
  const CHEM =
    'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research';
  const LAB_SITE = 'https://ohernlab.yale.edu/';

  it('refuses a departmental programme page on person-scoped rows', () => {
    for (const entityType of ['LAB', 'FACULTY_RESEARCH_AREA', 'FACULTY_PROJECT']) {
      expect(isDisallowedResearchEntitySourceUrl(PROGRAMME, { entityType })).toBe(true);
      expect(isDisallowedResearchEntitySourceUrl(CHEM, { entityType })).toBe(true);
    }
  });

  it('accepts the same page on organizational rows, which the page can be about', () => {
    for (const entityType of ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY']) {
      expect(isDisallowedResearchEntitySourceUrl(PROGRAMME, { entityType })).toBe(false);
      expect(isDisallowedResearchEntitySourceUrl(CHEM, { entityType })).toBe(false);
    }
  });

  it('accepts it when no entity is supplied, so unscoped callers do not lose citations', () => {
    expect(isDisallowedResearchEntitySourceUrl(PROGRAMME)).toBe(false);
    expect(isProgrammePageCitedByPerson(PROGRAMME, undefined)).toBe(false);
  });

  it('never refuses a real research home, whoever cites it', () => {
    for (const entityType of ['LAB', 'FACULTY_RESEARCH_AREA', 'CENTER']) {
      expect(isDisallowedResearchEntitySourceUrl(LAB_SITE, { entityType })).toBe(false);
      expect(isProgrammePageCitedByPerson(LAB_SITE, { entityType })).toBe(false);
    }
  });

  it('still refuses the law views/ajax endpoint on every entity type, as #2606 established', () => {
    for (const entityType of ['LAB', 'CENTER', 'FACULTY_RESEARCH_AREA']) {
      expect(
        isDisallowedResearchEntitySourceUrl('https://law.yale.edu/views/ajax', { entityType }),
      ).toBe(true);
    }
  });
});

describe("a centre's team page entry is a person page (#2708)", () => {
  it('treats /team/<person> as a person profile or directory url', () => {
    expect(isPersonProfileOrDirectoryUrl('https://isps.yale.edu/team/example-person')).toBe(true);
    expect(isPersonProfileOrDirectoryUrl('https://example.yale.edu/our-team/example-person')).toBe(
      true,
    );
    expect(isPersonProfileOrDirectoryUrl('https://example.yale.edu/staff/example-person')).toBe(
      true,
    );
  });

  it('leaves the bare team roster to the roster predicates', () => {
    expect(isPersonProfileOrDirectoryUrl('https://isps.yale.edu/team')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('https://isps.yale.edu/team/')).toBe(false);
  });

  it('does not sweep in an unrelated path that merely contains the word', () => {
    expect(isPersonProfileOrDirectoryUrl('https://example.yale.edu/teamwork-in-science')).toBe(
      false,
    );
    expect(isPersonProfileOrDirectoryUrl('https://example.yale.edu/lab/team-science/')).toBe(false);
  });
});

describe('an unprefixed opportunities page is a programme page (#2708)', () => {
  const PERSON = { entityType: 'FACULTY_RESEARCH_AREA' as const };
  const CENTRE = { entityType: 'CENTER' as const };

  it('matches training-opportunities without an undergraduate or graduate prefix', () => {
    const url = 'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/';
    expect(isDepartmentProgrammePageUrl(url)).toBe(true);
    expect(isProgrammePageCitedByPerson(url, PERSON)).toBe(true);
  });

  it('matches a bare research-opportunities segment', () => {
    const url = 'https://example.yale.edu/department/research-opportunities/';
    expect(isProgrammePageCitedByPerson(url, PERSON)).toBe(true);
  });

  it('still leaves the page alone for the department that publishes it', () => {
    const url = 'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/';
    expect(isProgrammePageCitedByPerson(url, CENTRE)).toBe(false);
  });

  it('does not match a research home that merely mentions opportunity', () => {
    expect(
      isProgrammePageCitedByPerson('https://example.yale.edu/lab/opportunity-cost-lab/', PERSON),
    ).toBe(false);
  });
});

describe('an umbrella page cited by a person (#2579)', () => {
  const FACULTY = {
    entityType: 'FACULTY_RESEARCH_AREA' as const,
    name: 'Example theorist research',
  };
  const LAB = { entityType: 'LAB' as const, name: 'Example Lab' };
  const CENTRE = { entityType: 'CENTER' as const, name: 'Particle Theory Group' };

  it('refuses a research group host root to a person-scoped row', () => {
    expect(isResearchGroupHostRootUrl('https://het.yale.edu/')).toBe(true);
    expect(isResearchGroupHostRootUrl('http://HET.yale.edu')).toBe(true);
    expect(isResearchGroupHostRootUrl('https://www.het.yale.edu/index.php')).toBe(true);
    expect(isUmbrellaPageCitedByPerson('https://het.yale.edu/', FACULTY)).toBe(true);
    expect(isUmbrellaPageCitedByPerson('http://het.yale.edu/', LAB)).toBe(true);
    expect(sourceUrlToResearchHomeWebsiteUrl('https://het.yale.edu/', FACULTY)).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://het.yale.edu/', LAB)).toBe('');
  });

  it('leaves the group root to the group itself and its members’ own pages alone', () => {
    expect(isUmbrellaPageCitedByPerson('https://het.yale.edu/', CENTRE)).toBe(false);
    expect(sourceUrlToResearchHomeWebsiteUrl('https://het.yale.edu/', CENTRE)).toBe(
      'https://het.yale.edu/',
    );
    expect(isResearchGroupHostRootUrl('https://het.yale.edu/people')).toBe(false);
    expect(isUmbrellaPageCitedByPerson('https://het.yale.edu/example-member/', FACULTY)).toBe(
      false,
    );
  });

  it('refuses the group root on a row still carrying a retired person-scoped type', () => {
    const legacy = { entityType: 'FACULTY_RESEARCH' as const, kind: 'individual' as const };
    expect(isUmbrellaPageCitedByPerson('http://het.yale.edu/', legacy)).toBe(true);
    expect(sourceUrlToResearchHomeWebsiteUrl('http://het.yale.edu/', legacy)).toBe('');
  });

  it('keeps the citation available as evidence, since only the typed slot is wrong', () => {
    expect(isDisallowedResearchEntitySourceUrl('https://het.yale.edu/', FACULTY)).toBe(false);
  });

  it('refuses a department audience-recruitment page to a person-scoped row', () => {
    const jobs = 'http://economics.yale.edu/undergraduate/employment-opportunities';
    const outreach = 'http://psychology.yale.edu/diversity/research-opportunities-undergraduates';
    expect(isDepartmentAudiencePageUrl(jobs)).toBe(true);
    expect(isDepartmentAudiencePageUrl(outreach)).toBe(true);
    expect(isUmbrellaPageCitedByPerson(jobs, FACULTY)).toBe(true);
    expect(isUmbrellaPageCitedByPerson(outreach, LAB)).toBe(true);
    expect(sourceUrlToResearchHomeWebsiteUrl(jobs, FACULTY)).toBe('');
  });

  it('keeps a lab’s own opportunities page, which carries no audience scope', () => {
    expect(isDepartmentAudiencePageUrl('https://hazarigroup.yale.edu/opportunities/')).toBe(false);
    expect(isUmbrellaPageCitedByPerson('https://hazarigroup.yale.edu/opportunities/', LAB)).toBe(
      false,
    );
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://hazarigroup.yale.edu/opportunities/', LAB),
    ).toBe('https://hazarigroup.yale.edu/opportunities/');
  });

  it('keeps a lab’s own audience-organized page, which the lab host publishes', () => {
    const groupPage = 'https://hazarigroup.yale.edu/graduate/opportunities-for-students';
    const labPage = 'https://belieflab.yale.edu/undergraduate/job-openings';
    expect(isDepartmentAudiencePageUrl(groupPage)).toBe(false);
    expect(isDepartmentAudiencePageUrl(labPage)).toBe(false);
    expect(isUmbrellaPageCitedByPerson(groupPage, LAB)).toBe(false);
    expect(isUmbrellaPageCitedByPerson(labPage, FACULTY)).toBe(false);
  });

  it('needs the whole subject segment, not a word inside a longer one', () => {
    expect(
      isDepartmentAudiencePageUrl('https://economics.yale.edu/undergraduate/job-openings'),
    ).toBe(false);
    expect(
      isDepartmentAudiencePageUrl('https://economics.yale.edu/graduate/opportunities-for-students'),
    ).toBe(false);
    expect(isDepartmentAudiencePageUrl('https://economics.yale.edu/undergraduate/employment')).toBe(
      true,
    );
    expect(
      isDepartmentAudiencePageUrl('https://eeb.yale.edu/undergraduate/research-opportunities'),
    ).toBe(true);
  });

  it('refuses a programme page to every person-scoped shape, not just three types', () => {
    const programme = 'https://example.yale.edu/department/research-opportunities/';
    expect(isProgrammePageCitedByPerson(programme, { entityType: 'INDIVIDUAL_RESEARCH' })).toBe(
      true,
    );
    expect(isProgrammePageCitedByPerson(programme, { entityType: 'FACULTY_RESEARCH' })).toBe(true);
    expect(isProgrammePageCitedByPerson(programme, { kind: 'individual' })).toBe(true);
    expect(
      isDisallowedResearchEntitySourceUrl(programme, { entityType: 'INDIVIDUAL_RESEARCH' }),
    ).toBe(true);
    expect(isProgrammePageCitedByPerson(programme, { entityType: 'CENTER', kind: 'center' })).toBe(
      false,
    );
  });

  it('leaves a department audience page to the organizational row that publishes it', () => {
    const programme = 'https://eeb.yale.edu/academics/undergraduate-program/research-opportunities';
    expect(isUmbrellaPageCitedByPerson(programme, { entityType: 'INITIATIVE' })).toBe(false);
  });

  it('refuses ownership on entity shape, so a grafted umbrella name cannot buy it back', () => {
    expect(
      isUmbrellaPageCitedByPerson('https://het.yale.edu/', {
        entityType: 'LAB',
        kind: 'lab',
        name: 'Particle Theory Group',
        displayName: 'High Energy Theory',
      }),
    ).toBe(true);
  });
});

describe('a lab host is distinctive on a multi-label subdomain (#2581 residue)', () => {
  const distinctive = (host: string) =>
    isCustomYaleResearchHomeSubdomain(new URL(`https://${host}/`));

  it.each([
    ['a site-builder platform', 'examplelab.sites.yale.edu'],
    ['the commons platform', 'examplelab.commons.yale.edu'],
    ['a department subdomain', 'examplelab.physics.yale.edu'],
    ['the research platform', 'examplelab.research.yale.edu'],
    ['a school subdomain', 'examplelab.som.yale.edu'],
  ])('treats a lab under %s as naming one research home', (_label, host) => {
    expect(distinctive(host)).toBe(true);
  });

  it.each([
    ['a bare platform host, whose identity is in the path', 'campuspress.yale.edu'],
    ['a bare research platform host', 'research.yale.edu'],
    ['the university home host', 'www.yale.edu'],
    ['a single-label lab host', 'examplelab.yale.edu'],
  ])('keeps %s distinctive, because it was before this change', (_label, host) => {
    expect(distinctive(host)).toBe(true);
  });

  it.each([
    ['a department host', 'medicine.yale.edu'],
    ['a school host behind www', 'www.law.yale.edu'],
    ['a department host behind www', 'www.economics.yale.edu'],
    ['a shared faculty directory host', 'faculty.som.yale.edu'],
    ['a shared people host', 'people.physics.yale.edu'],
    ['a shared resources host', 'resources.environment.yale.edu'],
  ])('refuses %s, because many homes share it', (_label, host) => {
    expect(distinctive(host)).toBe(false);
  });

  it('refuses a non-Yale host outright', () => {
    expect(distinctive('examplelab.harvard.edu')).toBe(false);
  });

  // Known limitation, pinned rather than hidden: the trailing label must be a
  // RECOGNISED department, and `genericYaleWebsiteSubdomains` does not list every
  // one (`biology`, `mcdb`, `chemistry`, `psychology` are absent). A lab under an
  // unlisted department is therefore still not distinctive, which is why this
  // change merges one duplicate group rather than two. Widening that set is a
  // separate change, because those labels would also stop being distinctive as a
  // LEFTMOST label and that is not additive.
  it('does not yet recognise a lab under an unlisted department label', () => {
    expect(distinctive('examplelab.biology.yale.edu')).toBe(false);
  });
});

describe('organizationOwnedSiteUrlFromCitation', () => {
  const center = (name: string) => ({ name, entityType: 'CENTER' });
  const institute = (name: string) => ({ name, entityType: 'INSTITUTE' });

  it.each([
    [
      'a name word spelling the host label',
      'https://macmillan.yale.edu/people',
      center('MacMillan Center for International and Area Studies'),
      'https://macmillan.yale.edu/',
    ],
    [
      'an acronym spelling the host label',
      'https://whc.yale.edu/leadership-and-staff',
      center('Whitney Humanities Center'),
      'https://whc.yale.edu/',
    ],
    [
      'an acronym that keeps the institution word',
      'https://ycga.yale.edu/people/',
      center('Yale Center for Genome Analysis'),
      'https://ycga.yale.edu/',
    ],
    [
      'the distinctive words run together',
      'https://quantuminstitute.yale.edu/our-mission/our-members',
      institute('Yale Quantum Institute'),
      'https://quantuminstitute.yale.edu/',
    ],
    [
      'a name word spelling a path segment under a school host',
      'https://medicine.yale.edu/cancer/research/membership/directory',
      center('Yale Cancer Center'),
      'https://medicine.yale.edu/cancer/',
    ],
    [
      'the deepest owned path segment rather than the shallowest',
      'https://medicine.yale.edu/genetics/research/ycga/people/',
      center('Yale Center for Genome Analysis'),
      'https://medicine.yale.edu/genetics/research/ycga/',
    ],
  ])('derives the organization site from %s', (_label, citation, entity, expected) => {
    expect(organizationOwnedSiteUrlFromCitation(citation, entity)).toBe(expected);
  });

  it('refuses a host the organization name does not spell', () => {
    expect(
      organizationOwnedSiteUrlFromCitation(
        'https://egc.yale.edu/people/faculty',
        center('Cowles Foundation for Research in Economics'),
      ),
    ).toBe('');
  });

  // The whole point of the entity-shape allowlist: a person never designates the host
  // that publishes them, so this fallback must not re-open the hole #2943 closed by
  // refusing a collective's root as one individual's research website.
  it.each([['LAB'], ['FACULTY_RESEARCH_AREA'], ['FACULTY_PROJECT'], ['FACULTY_RESEARCH']])(
    'refuses a %s row citing a page on a host its own name spells',
    (entityType) => {
      expect(
        organizationOwnedSiteUrlFromCitation('https://examplegroup.yale.edu/people', {
          name: 'Examplegroup',
          entityType,
        }),
      ).toBe('');
    },
  );

  it.each([
    ['an absent entity', undefined],
    ['an entity with no shape at all', { name: 'Examplegroup' }],
    ['an entity whose shape is not organizational', { name: 'Examplegroup', entityType: 'GRANT' }],
  ])('refuses %s, because the shape check is an allowlist', (_label, entity) => {
    expect(
      organizationOwnedSiteUrlFromCitation('https://examplegroup.yale.edu/people', entity),
    ).toBe('');
  });

  it.each([
    ['a host label naming what kind of organization it is', 'https://center.yale.edu/people'],
    [
      'a path segment naming what kind of organization it is',
      'https://medicine.yale.edu/center/people',
    ],
    [
      'a path segment naming the work rather than the org',
      'https://medicine.yale.edu/research/people',
    ],
  ])('refuses %s', (_label, citation) => {
    expect(organizationOwnedSiteUrlFromCitation(citation, center('Center for Research'))).toBe('');
  });

  // A mission word is not a designation. Without this the School of Medicine's
  // homepage and the genetics department's subtree are handed to a centre whose name
  // happens to contain one incidental word that spells them.
  it.each([
    [
      "a school's host root to a centre whose name merely mentions it",
      'https://medicine.yale.edu/genetics/people/',
      center('Yale Center for Precision Medicine'),
    ],
    [
      "a department's subtree to a centre whose name merely mentions it",
      'https://medicine.yale.edu/genetics/people/',
      center('Yale Center for Genetics'),
    ],
    [
      "a school's host root to an institute whose acronym is not its designation",
      'https://law.yale.edu/people/',
      institute('Laboratory of Applied Waves'),
    ],
  ])('refuses %s', (_label, citation, entity) => {
    expect(organizationOwnedSiteUrlFromCitation(citation, entity)).toBe('');
  });

  // The derived string has to name a URL that exists, so the path is sliced from the
  // citation's real segments rather than from the normalized ones matched against.
  it.each([
    [
      'a segment carrying an extension anchors its parent',
      'https://ysph.yale.edu/examplecenter/examplecenter.aspx',
      center('Examplecenter'),
      'https://ysph.yale.edu/examplecenter/',
    ],
    [
      'a top-level file falls back to the host root',
      'https://tobin.yale.edu/tobin.html',
      center('Tobin Center for Economic Policy'),
      'https://tobin.yale.edu/',
    ],
    [
      'the path keeps the case the server published',
      'https://medicine.yale.edu/Cancer/research/people/',
      center('Yale Cancer Center'),
      'https://medicine.yale.edu/Cancer/',
    ],
  ])('derives a path that exists: %s', (_label, citation, entity, expected) => {
    expect(organizationOwnedSiteUrlFromCitation(citation, entity)).toBe(expected);
  });

  it('refuses a citation that could never be a research home whatever owns it', () => {
    expect(
      organizationOwnedSiteUrlFromCitation(
        'https://ysph.yale.edu/examplecenter/giving/charitable-funds/',
        center('Examplecenter'),
      ),
    ).toBe('');
  });

  it('refuses a scholarly platform profile on a path the name happens to spell', () => {
    expect(
      organizationOwnedSiteUrlFromCitation(
        'https://scholar.google.com/citations/examplecenter/people',
        center('Examplecenter'),
      ),
    ).toBe('');
  });
});

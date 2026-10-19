import { describe, expect, it } from 'vitest';

import { isLaneDiscoveryEndpointUrl, servedGrantPageUrl } from '../laneDiscoveryEndpointUrl';
import {
  CROSSREF_GRANT_WORKS_URL,
  crossrefGrantUrl,
} from '../../scrapers/sources/crossrefGrantScraper';
import { NSF_API_URL } from '../../scrapers/sources/nsfAwardScraper';
import { REPORTER_ENDPOINT } from '../../scrapers/sources/nihReporterScraper';
import { OSTI_ENDPOINT } from '../../scrapers/sources/doeOstiGrantScraper';
import { DOE_PAMS_AWARD_SEARCH_URL } from '../../scrapers/sources/doeScienceAwardScraper';
import { NEH_AWARD_SEARCH_BASE, nehGrantUrl } from '../../scrapers/sources/nehGrantScraper';

describe('isLaneDiscoveryEndpointUrl (#5261)', () => {
  it.each([
    ['Crossref grant works', CROSSREF_GRANT_WORKS_URL],
    ['NSF awards API', NSF_API_URL],
    ['NIH RePORTER API', REPORTER_ENDPOINT],
    ['OSTI records API', OSTI_ENDPOINT],
    ['DOE award search form', DOE_PAMS_AWARD_SEARCH_URL],
    ['NEH award search home', NEH_AWARD_SEARCH_BASE],
    ['NEH award search home with a slash', `${NEH_AWARD_SEARCH_BASE}/`],
    ['OpenAlex API', 'https://api.openalex.org/works?filter=institutions.id:I0'],
    ['Europe PMC web services', 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'],
    ['NCBI E-utilities', 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'],
  ])('matches the %s endpoint a lane queries', (_name, url) => {
    expect(isLaneDiscoveryEndpointUrl(url)).toBe(true);
  });

  it.each([
    ['a grant DOI page', crossrefGrantUrl('10.99999/fixture-grant-1')],
    ['an NIH project page', 'https://reporter.nih.gov/project-details/00000001'],
    ['an NSF award page', 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=0000001'],
    ['an NEH award page', nehGrantUrl('XX-000000-00')],
    ['an OSTI record page', 'https://www.osti.gov/biblio/0000001'],
    ['a lab website', 'https://example-research-lab.example.org/'],
    ['a profile page', 'https://medicine.example.edu/profile/fixture-example/'],
  ])('leaves %s alone', (_name, url) => {
    expect(isLaneDiscoveryEndpointUrl(url)).toBe(false);
  });
});

describe('servedGrantPageUrl (#5261)', () => {
  const doiPage = crossrefGrantUrl('10.99999/fixture-grant-1');

  it('cites the most recent grant the lead holds as principal investigator', () => {
    expect(
      servedGrantPageUrl([
        { role: 'copi', url: 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=0000002' },
        { role: 'pi', url: doiPage },
        { role: 'pi', url: 'https://reporter.nih.gov/project-details/00000001' },
      ]),
    ).toBe(doiPage);
  });

  it('skips a grant whose stored url is the lane search form', () => {
    expect(servedGrantPageUrl([{ role: 'pi', url: DOE_PAMS_AWARD_SEARCH_URL }])).toBeUndefined();
    expect(
      servedGrantPageUrl([
        { role: 'pi', url: DOE_PAMS_AWARD_SEARCH_URL },
        { role: 'pi', url: doiPage },
      ]),
    ).toBe(doiPage);
  });

  it('finds nothing on a row that serves no grant', () => {
    expect(servedGrantPageUrl([])).toBeUndefined();
    expect(servedGrantPageUrl(undefined)).toBeUndefined();
  });
});

describe('servedGrantPageUrl prefers the crediting lane (#5261)', () => {
  const nihPage = 'https://reporter.nih.gov/project-details/00000001';
  const doiPage = crossrefGrantUrl('10.99999/fixture-grant-2');
  const grants = [
    { role: 'pi', url: nihPage },
    { role: 'pi', url: doiPage },
  ];

  it('cites the grant the endpoint lane recorded over a more recent one from another lane', () => {
    expect(servedGrantPageUrl(grants, CROSSREF_GRANT_WORKS_URL)).toBe(doiPage);
    expect(servedGrantPageUrl(grants, REPORTER_ENDPOINT)).toBe(nihPage);
  });

  it('falls back to the most recent grant page when the lane recorded none', () => {
    expect(servedGrantPageUrl(grants, NSF_API_URL)).toBe(nihPage);
  });
});

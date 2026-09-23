import { describe, it, expect } from 'vitest';
import {
  normalizeRetiredSourceUrl,
  planStoredDescriptionClears,
  unassertableDescriptionReasons,
  sourceHostIsAnotherInstitution,
  SOURCE_DISQUALIFYING_REASONS,
} from '../retireUnassertableMicrositeDescriptionsCore';

const entity = {
  slug: 'dept-mgmt-rowan-ashgrove',
  name: 'Rowan Ashgrove - Research',
};

describe('unassertableDescriptionReasons', () => {
  it('names the paginated faculty index as a refused citation', () => {
    expect(
      unassertableDescriptionReasons(
        {
          field: 'fullDescription',
          value: 'Studies cost-effectiveness analysis of screening policy.',
          sourceUrl: 'https://som.yale.edu/faculty-research/faculty-directory?page=1',
        },
        entity,
      ),
    ).toContain('source_is_a_crawl_seed_listing');
  });

  it('names a person page belonging to somebody else', () => {
    expect(
      unassertableDescriptionReasons(
        {
          field: 'shortDescription',
          value: 'Studies industrial ecology and solid waste policy.',
          sourceUrl: 'https://medicine.yale.edu/profile/juniper-fallowfield/',
        },
        entity,
      ),
    ).toEqual(['source_page_names_another_person']);
  });

  it('names text that narrates its own source page', () => {
    expect(
      unassertableDescriptionReasons(
        {
          field: 'fullDescription',
          value: 'The faculty page lists interests in industrial environmental management.',
          sourceUrl: 'https://medicine.yale.edu/profile/rowan-ashgrove/',
        },
        entity,
      ),
    ).toEqual(['text_narrates_the_source_page']);
  });

  it('keeps a description the lane would still assert', () => {
    expect(
      unassertableDescriptionReasons(
        {
          field: 'fullDescription',
          value: 'Studies cost-effectiveness analysis of infectious-disease screening policy.',
          sourceUrl: 'https://medicine.yale.edu/profile/rowan-ashgrove/',
        },
        entity,
      ),
    ).toEqual([]);
  });

  it('ignores a field that is not a description', () => {
    expect(
      unassertableDescriptionReasons(
        {
          field: 'acceptingUndergrads',
          value: true,
          sourceUrl: 'https://som.yale.edu/faculty-research/faculty-directory?page=1',
        },
        entity,
      ),
    ).toEqual([]);
  });
});

describe('planStoredDescriptionClears', () => {
  it('clears a stored field whose text the serve gate already refuses', () => {
    expect(
      planStoredDescriptionClears(
        {
          fullDescription: 'The faculty page lists interests in industrial ecology.',
          shortDescription: 'Studies solid waste policy.',
        },
        new Set(),
      ),
    ).toEqual([{ field: 'fullDescription', reason: 'text_narrates_the_source_page' }]);
  });

  it('clears a stored field whose provenance cites a retired source', () => {
    expect(
      planStoredDescriptionClears(
        {
          fullDescription: 'Studies solid waste policy and industrial ecology.',
          fieldProvenance: {
            fullDescription: {
              sourceUrl: 'https://som.yale.edu/faculty-research/faculty-directory?page=1',
            },
          },
        },
        new Set([
          normalizeRetiredSourceUrl(
            'https://som.yale.edu/faculty-research/faculty-directory?page=1',
          ),
        ]),
      ),
    ).toEqual([{ field: 'fullDescription', reason: 'provenance_cites_a_disqualified_page' }]);
  });

  it('leaves a stored field whose provenance cites a source that survives', () => {
    expect(
      planStoredDescriptionClears(
        {
          fullDescription: 'Studies solid waste policy and industrial ecology.',
          fieldProvenance: {
            fullDescription: { sourceUrl: 'https://medicine.yale.edu/profile/rowan-ashgrove/' },
          },
        },
        new Set([
          normalizeRetiredSourceUrl(
            'https://som.yale.edu/faculty-research/faculty-directory?page=1',
          ),
        ]),
      ),
    ).toEqual([]);
  });
});

describe('sourceHostIsAnotherInstitution', () => {
  it('disqualifies another degree-granting institution own page', () => {
    expect(sourceHostIsAnotherInstitution('https://faculty.tuck.dartmouth.edu/teresa-fort')).toBe(
      true,
    );
    expect(sourceHostIsAnotherInstitution('https://research-information.bris.ac.uk/x')).toBe(true);
    expect(sourceHostIsAnotherInstitution('https://www.law.columbia.edu/faculty/x')).toBe(true);
  });

  it('disqualifies a ccTLD university the string cannot reveal', () => {
    expect(sourceHostIsAnotherInstitution('https://ostry.lab.mcgill.ca/')).toBe(true);
    expect(sourceHostIsAnotherInstitution('https://www.psych.mcgill.ca/labs/mcl/contact.htm')).toBe(
      true,
    );
  });

  it('never disqualifies a Yale host', () => {
    expect(sourceHostIsAnotherInstitution('https://medicine.yale.edu/profile/x/')).toBe(false);
    expect(sourceHostIsAnotherInstitution('https://yale.edu/')).toBe(false);
    expect(sourceHostIsAnotherInstitution('https://mcdb.yale.edu/people/faculty')).toBe(false);
  });

  it('never disqualifies a Yale researcher own vanity or lab site', () => {
    expect(sourceHostIsAnotherInstitution('http://www.barbarabiasi.com/')).toBe(false);
    expect(sourceHostIsAnotherInstitution('http://nearlab.org/')).toBe(false);
    expect(sourceHostIsAnotherInstitution('https://sites.google.com/site/x/')).toBe(false);
  });

  it('returns false rather than throwing on an absent or unparseable url', () => {
    expect(sourceHostIsAnotherInstitution(undefined)).toBe(false);
    expect(sourceHostIsAnotherInstitution('')).toBe(false);
    expect(sourceHostIsAnotherInstitution('not a url')).toBe(false);
  });
});

describe('unassertableDescriptionReasons with a foreign institutional citation', () => {
  it('names the host reason, and keeps it in the source-disqualifying set', () => {
    const reasons = unassertableDescriptionReasons(
      {
        field: 'fullDescription',
        value: 'Welcome to the Motor Neuroscience Lab of McGill University.',
        sourceUrl: 'https://ostry.lab.mcgill.ca/',
      },
      { slug: 'nih-pi-example', name: 'Example Lab' } as never,
    );
    expect(reasons).toContain('source_host_is_another_institution');
    expect(SOURCE_DISQUALIFYING_REASONS).toContain('source_host_is_another_institution');
  });

  it('says nothing about a description cited by the row own Yale profile', () => {
    expect(
      unassertableDescriptionReasons(
        {
          field: 'fullDescription',
          value: 'The group studies daily and seasonal timing mechanisms in plants.',
          sourceUrl: 'https://mcdb.yale.edu/profile/example',
        },
        { slug: 'dept-mcdb-example', name: 'Example Lab' } as never,
      ),
    ).not.toContain('source_host_is_another_institution');
  });
});

describe('sourceHostIsAnotherInstitution exclusions', () => {
  it('does not read a commercial platform that owns a .edu domain as a university', () => {
    expect(sourceHostIsAnotherInstitution('https://mimiyiengpruksawan.academia.edu/x')).toBe(false);
    expect(sourceHostIsAnotherInstitution('https://academia.edu/x')).toBe(false);
  });

  it('does not read a journal publishing platform as a university own page', () => {
    expect(sourceHostIsAnotherInstitution('https://muse.jhu.edu/article/12345')).toBe(false);
  });
});

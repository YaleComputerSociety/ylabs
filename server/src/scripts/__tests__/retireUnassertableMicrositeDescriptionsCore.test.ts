import { describe, it, expect } from 'vitest';
import {
  normalizeRetiredSourceUrl,
  planStoredDescriptionClears,
  unassertableDescriptionReasons,
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

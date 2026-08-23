import { describe, it, expect } from 'vitest';
import {
  collectDescriptionCandidates,
  selectResearchHomeDescription,
} from '../researchHomeDescriptionSelection';

const LAB_RESEARCH_BLOCK =
  'The Marlowe Lab studies how coastal wetlands store carbon and how tidal cycles reshape sediment chemistry. We combine field sampling, stable-isotope analysis, and numerical models to understand how these ecosystems respond to rising seas.';

const PI_BIO_RESEARCH_BLOCK =
  'Professor Ada Marlowe is a coastal ecologist at a New England university. Her research examines carbon storage in tidal wetlands and the chemistry of estuary sediments, combining fieldwork with numerical modeling.';

const ADMIN_CV_BLOCK =
  'Dr. Ada Marlowe earned her doctorate from a midwestern university and joined the faculty in 2009. She served as department chair from 2015 to 2020 and has received several awards for teaching and mentoring throughout her career.';

const BOILERPLATE_BLOCK =
  'Welcome to the homepage of the Marlowe Lab. Here you will find information about our team, recent news, publications, and opportunities to get involved. Please use the navigation menu to explore the site.';

describe('collectDescriptionCandidates', () => {
  it('drops blocks below the minimum length and deduplicates case-insensitively', () => {
    const candidates = collectDescriptionCandidates([
      'Too short.',
      LAB_RESEARCH_BLOCK,
      LAB_RESEARCH_BLOCK.toUpperCase(),
      '   ',
      42,
    ]);

    expect(candidates).toEqual([LAB_RESEARCH_BLOCK]);
  });
});

describe('selectResearchHomeDescription', () => {
  it('prefers the lab research block over a PI bio for an organization', () => {
    expect(
      selectResearchHomeDescription([PI_BIO_RESEARCH_BLOCK, LAB_RESEARCH_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_RESEARCH_BLOCK);
  });

  it('keeps preferring the lab research block even when the bio appears first', () => {
    expect(
      selectResearchHomeDescription([LAB_RESEARCH_BLOCK, PI_BIO_RESEARCH_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_RESEARCH_BLOCK);
  });

  it('drops administrative CV text and selects the research block', () => {
    expect(
      selectResearchHomeDescription([ADMIN_CV_BLOCK, LAB_RESEARCH_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_RESEARCH_BLOCK);
  });

  it('returns null when only boilerplate and administrative CV are available', () => {
    expect(
      selectResearchHomeDescription([BOILERPLATE_BLOCK, ADMIN_CV_BLOCK], { kind: 'organization' }),
    ).toBeNull();
  });

  it('keeps a research-focused bio and drops administrative CV for a person entity', () => {
    expect(
      selectResearchHomeDescription([ADMIN_CV_BLOCK, PI_BIO_RESEARCH_BLOCK], { kind: 'person' }),
    ).toBe(PI_BIO_RESEARCH_BLOCK);
  });

  it('does not penalize a person-centric bio when the entity is a person', () => {
    expect(selectResearchHomeDescription([PI_BIO_RESEARCH_BLOCK], { kind: 'person' })).toBe(
      PI_BIO_RESEARCH_BLOCK,
    );
  });

  it('defaults to organization handling when no kind is provided', () => {
    expect(selectResearchHomeDescription([PI_BIO_RESEARCH_BLOCK, LAB_RESEARCH_BLOCK])).toBe(
      LAB_RESEARCH_BLOCK,
    );
  });

  it('never selects a candidate carrying raw HTML citation markup (#909)', () => {
    const CITATION_MARKUP_BLOCK =
      'Doe A, Roe B, <span data-id="10001">Ng A</span>, ' +
      '<strong data-id="20002">Park M</strong>. ' +
      '<span data-type="title">Bridging the gap between structure and function in tidal systems.</span>';
    expect(
      selectResearchHomeDescription([CITATION_MARKUP_BLOCK], { kind: 'organization' }),
    ).toBeNull();
    expect(selectResearchHomeDescription([CITATION_MARKUP_BLOCK, LAB_RESEARCH_BLOCK])).toBe(
      LAB_RESEARCH_BLOCK,
    );
  });

  it('never selects A-Z directory-index boilerplate as a description (#517)', () => {
    const A_TO_Z_INDEX_BLOCK =
      'This A–Z index lists Yale School of Medicine lab websites in one place, making it easy to find a specific lab, research group, or program site. Browse alphabetically or use your browser search to quickly locate a lab by name.';
    expect(selectResearchHomeDescription([A_TO_Z_INDEX_BLOCK], { kind: 'organization' })).toBeNull();
    expect(selectResearchHomeDescription([A_TO_Z_INDEX_BLOCK, LAB_RESEARCH_BLOCK])).toBe(
      LAB_RESEARCH_BLOCK,
    );
  });
});

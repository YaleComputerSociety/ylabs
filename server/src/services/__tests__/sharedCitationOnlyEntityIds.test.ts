import { describe, expect, it } from 'vitest';

import {
  SHARED_CITATION_PERSON_ROW_THRESHOLD,
  selectSharedCitationOnlyEntityIds,
} from '../studentVisibilityGateService';

const personRow = (
  slug: string,
  sourceUrls: string[],
  overrides: Record<string, unknown> = {},
) => ({
  _id: slug,
  slug,
  name: `${slug} Faculty Research`,
  entityType: 'FACULTY_RESEARCH_AREA',
  sourceUrls,
  ...overrides,
});

const DIRECTORY = 'https://ysph.yale.edu/school-of-public-health-faculty/directory-name/';
const DONOR =
  'https://ysph.yale.edu/about-school-of-public-health/charitable-opportunities/donors-make-a-difference/cynthia-barnett-cancer-prevention-research-fund/';

/** A cohort large enough to pass the threshold, all citing the same two pages. */
const sharedCohort = (size: number) =>
  Array.from({ length: size }, (_, index) => personRow(`shared-${index}`, [DIRECTORY, DONOR]));

describe('selectSharedCitationOnlyEntityIds', () => {
  it('selects a person row whose every citation is shared across the threshold of person rows', () => {
    const ids = selectSharedCitationOnlyEntityIds(
      sharedCohort(SHARED_CITATION_PERSON_ROW_THRESHOLD),
    );
    expect(ids.size).toBe(SHARED_CITATION_PERSON_ROW_THRESHOLD);
    expect(ids.has('shared-0')).toBe(true);
  });

  it('spares a row that also cites a page no other person row cites', () => {
    const cohort = sharedCohort(SHARED_CITATION_PERSON_ROW_THRESHOLD);
    cohort[0].sourceUrls = [DIRECTORY, DONOR, 'https://ysph.yale.edu/profile/a-d-paltiel/'];

    const ids = selectSharedCitationOnlyEntityIds(cohort);

    expect(ids.has('shared-0')).toBe(false);
    expect(ids.has('shared-1')).toBe(true);
  });

  it('spares the same cohort when it is one row short of the threshold', () => {
    const ids = selectSharedCitationOnlyEntityIds(
      sharedCohort(SHARED_CITATION_PERSON_ROW_THRESHOLD - 1),
    );
    expect(ids.size).toBe(0);
  });

  it('never selects a row that cites nothing, which is a different defect', () => {
    const ids = selectSharedCitationOnlyEntityIds([
      ...sharedCohort(SHARED_CITATION_PERSON_ROW_THRESHOLD),
      personRow('no-citations', []),
    ]);
    expect(ids.has('no-citations')).toBe(false);
  });

  it('counts only person-scoped rows towards the shared total', () => {
    // The same two pages cited by a large cohort of CENTER rows must not make a
    // lone person row's citations look shared: the signal is about per-person
    // evidence, so an organisational row citing its own directory is irrelevant.
    const orgRows = Array.from({ length: SHARED_CITATION_PERSON_ROW_THRESHOLD * 2 }, (_, index) =>
      personRow(`center-${index}`, [DIRECTORY, DONOR], { entityType: 'CENTER' }),
    );

    const ids = selectSharedCitationOnlyEntityIds([
      personRow('lone-person', [DIRECTORY]),
      ...orgRows,
    ]);

    expect(ids.size).toBe(0);
  });

  it('does not compare a citation slug against the row name, so name formatting cannot refuse a row', () => {
    // Each of these cites its own person page under a slug that disagrees with the
    // display name in a way that broke every name-matching variant of this
    // criterion: concatenated compound surname, netid suffix, credentials, and a
    // bare netid slug. None of them is shared, so none is selected.
    const formattingCases = [
      personRow('eslampour', ['https://medicine.yale.edu/profile/aidin-eslampour/'], {
        displayName: 'Aidin Eslam Pour',
      }),
      personRow('andrew-yu', ['https://medicine.yale.edu/profile/andrew-yu-ay433/'], {
        displayName: 'Andrew Yu',
      }),
      personRow('ann-arthur', ['https://medicine.yale.edu/profile/ann-arthur/'], {
        displayName: "Ann V. Arthur, MD '90",
      }),
      personRow('em453', ['https://medicine.yale.edu/profile/em453/'], {
        displayName: 'Eamon McCrory',
      }),
    ];

    const ids = selectSharedCitationOnlyEntityIds([
      ...formattingCases,
      ...sharedCohort(SHARED_CITATION_PERSON_ROW_THRESHOLD),
    ]);

    for (const row of formattingCases) expect(ids.has(row.slug)).toBe(false);
    // And the cohort that genuinely has no per-person evidence is still selected,
    // so this test cannot pass by the selector returning nothing.
    expect(ids.has('shared-0')).toBe(true);
  });
});

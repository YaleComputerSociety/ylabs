import { describe, expect, it } from 'vitest';
import {
  centerProfileResearchRowObservations,
  planCenterProfileResearchRows,
  type CenterProfileRowCandidate,
  type CenterProfileRowCoverage,
} from '../utils/centerProfileResearchRows';

const RESEARCH =
  'Her research examines how synthetic institutions shape national identity, and her current project analyzes synthetic survey data across regions.';
const PROFILE = 'https://macmillan.yale.edu/people/fixture-member';

const candidate = (
  overrides: Partial<CenterProfileRowCandidate> = {},
): CenterProfileRowCandidate => ({
  personId: 'person-a',
  displayName: 'Robin Fixture',
  netid: 'zz0001',
  title: 'Lecturer in Synthetic Studies',
  profileUrl: PROFILE,
  profileText: RESEARCH,
  ...overrides,
});

const emptyCoverage: CenterProfileRowCoverage = {
  slugs: new Set(),
  citedUrls: new Set(),
  personalRowNames: new Set(),
  inferredLeadKeys: new Set(),
};

describe('planCenterProfileResearchRows', () => {
  it('plans a faculty-research row citing the member profile and naming the lead by netid', () => {
    const { planned } = planCenterProfileResearchRows([candidate()], emptyCoverage);
    expect(planned).toHaveLength(1);
    const observations = centerProfileResearchRowObservations(planned[0]);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'entityType', value: 'FACULTY_RESEARCH_AREA' }),
        expect.objectContaining({ field: 'sourceUrls', value: [PROFILE] }),
        expect.objectContaining({ field: 'inferredPiUserKey', value: 'netid:zz0001' }),
      ]),
    );
    expect(new Set(observations.map((obs) => obs.sourceUrl))).toEqual(new Set([PROFILE]));
  });

  it('refuses a lector, a student, and a member with no research statement', () => {
    const { planned, skipped } = planCenterProfileResearchRows(
      [
        candidate({
          personId: 'a',
          title: 'Lector, Synthetic Languages',
          profileUrl: `${PROFILE}-a`,
        }),
        candidate({ personId: 'b', title: 'PhD Student', profileUrl: `${PROFILE}-b` }),
        candidate({
          personId: 'c',
          profileText: 'Robin Fixture joined the faculty in 2019 after a decade in industry.',
          profileUrl: `${PROFILE}-c`,
        }),
      ],
      emptyCoverage,
    );
    expect(planned).toEqual([]);
    expect(skipped.non_hosting_title).toBe(2);
    expect(skipped.no_research_statement).toBe(1);
  });

  it('refuses a member with no netid, since the lead could not be resolved', () => {
    const { skipped } = planCenterProfileResearchRows(
      [candidate({ netid: undefined })],
      emptyCoverage,
    );
    expect(skipped.no_netid).toBe(1);
  });

  it('never mints over a taken slug, an already-cited profile, or an archived row in the name', () => {
    const slugTaken = planCenterProfileResearchRows([candidate()], {
      ...emptyCoverage,
      slugs: new Set(['faculty-research-area-robin-fixture']),
    });
    expect(slugTaken.skipped.slug_taken).toBe(1);
    const cited = planCenterProfileResearchRows([candidate()], {
      ...emptyCoverage,
      citedUrls: new Set(['macmillan.yale.edu/people/fixture-member']),
    });
    expect(cited.skipped.profile_already_cited).toBe(1);
    const namedRow = planCenterProfileResearchRows([candidate()], {
      ...emptyCoverage,
      personalRowNames: new Set(['robin fixture']),
    });
    expect(namedRow.skipped.personal_row_for_person).toBe(1);
  });

  it('never mints for a member another row already infers as its lead', () => {
    const { planned, skipped } = planCenterProfileResearchRows([candidate()], {
      ...emptyCoverage,
      inferredLeadKeys: new Set(['netid:zz0001']),
    });
    expect(planned).toEqual([]);
    expect(skipped.row_already_infers_lead).toBe(1);
  });

  it('refuses a teaching-only title whose profile affirms no research', () => {
    const { planned, skipped } = planCenterProfileResearchRows(
      [
        candidate({
          profileText:
            'Her current work focuses on new teaching materials for advanced learners of synthetic languages across regions.',
        }),
      ],
      emptyCoverage,
    );
    expect(planned).toEqual([]);
    expect(skipped.teaching_appointment).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { contradictedSourcelessLeadEdgeIds } from '../entityMaterializer';

const owner = {
  displayName: 'Ada Quill',
  profileLinks: [{ kind: 'YALE_OFFICIAL', url: 'https://medicine.yale.edu/profile/ada-quill/' }],
};
const listed = {
  displayName: 'Bo Nimbus',
  profileLinks: [{ kind: 'YALE_OFFICIAL', url: 'https://medicine.yale.edu/profile/bo-nimbus/' }],
};

const plan = (plannedLeadPersonIds: ReadonlySet<string>, listedMatchedBy = 'NAMED_ON_PAGE') =>
  contradictedSourcelessLeadEdgeIds({
    row: {
      slug: 'ysm-faculty-ada-quill',
      name: 'Synthetic Habits Lab',
      leadVerification: {
        leads: [
          { personId: 'owner', verdict: 'CONFIRMED', matchedBy: 'OFFICIAL_PROFILE_LINK' },
          { personId: 'listed', verdict: 'CONFIRMED', matchedBy: listedMatchedBy },
        ],
      },
    },
    edges: [
      { id: 'owner-edge', personId: 'owner', hasRecordedSource: true },
      { id: 'listed-edge', personId: 'listed', hasRecordedSource: false },
    ],
    people: new Map([
      ['owner', owner],
      ['listed', listed],
    ]),
    plannedLeadPersonIds,
  });

describe('contradictedSourcelessLeadEdgeIds (#5979 C4)', () => {
  it('ends the sourceless edge when nothing live names the person', () => {
    expect(plan(new Set())).toEqual(['listed-edge']);
  });

  it('keeps it while a live lead read names the person', () => {
    expect(plan(new Set(['listed']))).toEqual([]);
  });

  it("keeps it when the site confirms the person by the site's own address", () => {
    expect(plan(new Set(), 'SURNAME_IN_SITE_URL')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveResearchDetailActionLinks } from '../researchDetailActionLinks';

const PROFILE = 'https://medicine.yale.edu/profile/fixture-scholar/';
const WEBSITE = 'https://medicine.yale.edu/lab/fixture/';
const base = {
  hasLeadCard: true,
  profileNeedsOwnButton: false,
  preferOrgEngagementOutreach: false,
  officialSource: null as { url: string } | null,
};

describe('resolveResearchDetailActionLinks (#3288)', () => {
  it('offers both slots when they are different destinations', () => {
    const links = resolveResearchDetailActionLinks({
      ...base,
      profileUrl: PROFILE,
      websiteUrl: WEBSITE,
    });
    expect(links).toMatchObject({
      leadCardProfileUrl: PROFILE,
      websiteCtaUrl: WEBSITE,
      showsWebsiteCta: true,
      offersBothLinks: true,
      slotsShareOneDestination: false,
    });
  });

  it('reports the defect lane when both slots resolve to one destination', () => {
    const links = resolveResearchDetailActionLinks({
      ...base,
      profileUrl: PROFILE,
      websiteUrl: `${PROFILE}?utm_source=x`,
    });
    expect(links.slotsShareOneDestination).toBe(true);
    // The population is read BEFORE the suppression, so a row the guard already
    // collapsed is still countable. Measuring after it hides exactly the rows it
    // acted on.
    expect(links.offersBothLinks).toBe(true);
    expect(links.showsWebsiteCta).toBe(false);
    expect(links.websiteCtaUrl).toBeUndefined();
  });

  it('withholds the lead card profile link under org-engagement outreach', () => {
    const links = resolveResearchDetailActionLinks({
      ...base,
      preferOrgEngagementOutreach: true,
      profileUrl: PROFILE,
      websiteUrl: WEBSITE,
      officialSource: { url: 'https://example.yale.edu/get-involved' },
    });
    expect(links.leadCardProfileUrl).toBeUndefined();
    expect(links.leadCardLinksProfile).toBe(false);
    expect(links.showsWebsiteCta).toBe(false);
    expect(links.offersBothLinks).toBe(false);
  });

  it('suppresses the website slot for an email or an own-button profile', () => {
    expect(
      resolveResearchDetailActionLinks({
        ...base,
        profileUrl: PROFILE,
        websiteUrl: WEBSITE,
        piEmail: 'mailto:x@example.test',
      }).showsWebsiteCta,
    ).toBe(false);
    expect(
      resolveResearchDetailActionLinks({
        ...base,
        hasLeadCard: false,
        profileUrl: PROFILE,
        websiteUrl: WEBSITE,
        profileNeedsOwnButton: true,
      }).showsWebsiteCta,
    ).toBe(false);
  });

  it('offers nothing when there is no website at all', () => {
    const links = resolveResearchDetailActionLinks({ ...base, profileUrl: PROFILE });
    expect(links.showsWebsiteCta).toBe(false);
    expect(links.offersBothLinks).toBe(false);
    expect(links.slotsShareOneDestination).toBe(false);
  });
});

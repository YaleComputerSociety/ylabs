import { describe, expect, it } from 'vitest';
import { resolveResearchDetailActionLinks } from '../researchDetailActionLinks';

const PROFILE = 'https://medicine.yale.edu/profile/fixture-scholar/';
const WEBSITE = 'https://medicine.yale.edu/lab/fixture/';
const base = {
  hasLeadCard: true,
  profileNeedsOwnButton: false,
  preferOrgEngagementOutreach: false,
  officialSource: null as { url: string } | null,
  hasApplyPage: false,
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

  it('keeps the lead card profile link but not the website under org-engagement outreach', () => {
    const links = resolveResearchDetailActionLinks({
      ...base,
      preferOrgEngagementOutreach: true,
      profileUrl: PROFILE,
      websiteUrl: WEBSITE,
      officialSource: { url: 'https://example.yale.edu/get-involved' },
    });
    expect(links.leadCardProfileUrl).toBe(PROFILE);
    expect(links.leadCardLinksProfile).toBe(true);
    expect(links.showsWebsiteCta).toBe(false);
    expect(links.offersBothLinks).toBe(false);
  });

  it('gives the only action to a place to apply over the website and an own-button profile', () => {
    const beside = resolveResearchDetailActionLinks({
      ...base,
      hasApplyPage: true,
      profileUrl: PROFILE,
      websiteUrl: WEBSITE,
    });
    expect(beside.showsWebsiteCta).toBe(false);
    expect(beside.offersBothLinks).toBe(false);
    expect(beside.profileOpenedAbove).toBe(true);

    const withoutLeadCard = resolveResearchDetailActionLinks({
      ...base,
      hasLeadCard: false,
      hasApplyPage: true,
      profileUrl: PROFILE,
      websiteUrl: WEBSITE,
      profileNeedsOwnButton: true,
    });
    expect(withoutLeadCard.showsProfileButton).toBe(false);
    expect(withoutLeadCard.profileOpenedAbove).toBe(false);
  });

  it('suppresses the website slot for an own-button profile', () => {
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

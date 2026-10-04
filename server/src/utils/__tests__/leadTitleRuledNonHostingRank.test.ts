import { describe, expect, it } from 'vitest';
import { computeResearchEntityStudentVisibility } from '../../services/studentVisibilityTier';
import { leadWouldUnblock } from '../../scripts/attachFraNamedLeadsCore';
import { leadTitlesAreRuledNonHostingRanks } from '../leadTitleRuledNonHostingRank';

const lead = (title?: string) => ({
  userId: 'user-fixture-lead',
  role: 'pi',
  ...(title ? { title } : {}),
});

describe('leadTitlesAreRuledNonHostingRanks', () => {
  it('holds a row whose every lead states only a rank the owner ruled cannot host', () => {
    for (const title of [
      'Clinical Fellow',
      'Clinical Fellow in Pediatrics (Hematology / Oncology)',
      'Hospital Resident',
      'Postgraduate Associate',
      'Staff Affiliate - Hospital',
    ]) {
      expect(leadTitlesAreRuledNonHostingRanks([lead(title)])).toBe(true);
    }
  });

  it('reads the user record title when the membership title is blank, as the gate does', () => {
    expect(
      leadTitlesAreRuledNonHostingRanks([
        { ...lead(), title: '', user: { _id: 'user-fixture-lead', title: 'Clinical Fellow' } },
      ]),
    ).toBe(true);
  });

  it('never holds on a missing title, a hosting rank beside the ruled one, or a mixed roster', () => {
    expect(leadTitlesAreRuledNonHostingRanks([])).toBe(false);
    expect(leadTitlesAreRuledNonHostingRanks([lead()])).toBe(false);
    expect(
      leadTitlesAreRuledNonHostingRanks([lead('Clinical Fellow and Instructor of Medicine')]),
    ).toBe(false);
    expect(
      leadTitlesAreRuledNonHostingRanks([lead('Hospital Resident'), lead('Professor of Medicine')]),
    ).toBe(false);
    expect(leadTitlesAreRuledNonHostingRanks([lead('Associate Research Scholar')])).toBe(false);
    expect(leadTitlesAreRuledNonHostingRanks([lead('President of the Fixture Society')])).toBe(
      false,
    );
    expect(leadTitlesAreRuledNonHostingRanks([lead('Chief Resident')])).toBe(false);
  });
});

describe('the gate holds a ruled non-hosting lead at operator review', () => {
  const entity = {
    slug: 'fixture-ruled-non-hosting-lab',
    name: 'Example Lab',
    kind: 'lab',
    entityType: 'LAB',
    websiteUrl: 'https://example.yale.edu/labs/example/',
    sourceUrls: ['https://example.yale.edu/labs/example/'],
    researchAreas: ['Exoplanets'],
    shortDescription: 'Studies exoplanet detection and atmospheric characterization.',
    fullDescription:
      'The lab studies exoplanet detection and atmospheric characterization, combining radial-velocity surveys with high-resolution spectroscopy of transiting planets.',
    activeAtYaleCache: true,
  };
  const tierFor = (leadMembers: ReturnType<typeof lead>[]) =>
    computeResearchEntityStudentVisibility({
      entity,
      leadMembers,
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

  it('holds rather than serves or suppresses', () => {
    const held = tierFor([lead('Clinical Fellow')]);
    expect(held.tier).toBe('operator_review');
    expect(held.reasons).toContain('lead_title_ruled_non_hosting_rank');
    expect(tierFor([lead('Associate Professor of Astronomy')]).tier).toBe('student_ready');
  });

  it('leaves a lead that already reads as missing to the lead-attachment lanes', () => {
    const missing = tierFor([lead('Postgraduate Associate')]);
    expect(missing.tier).toBe('operator_review');
    expect(missing.reasons).toContain('missing_lead');
    expect(missing.reasons).not.toContain('lead_title_ruled_non_hosting_rank');
    expect(leadWouldUnblock({ studentVisibilityReasons: missing.reasons } as any)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { computeResearchEntityStudentVisibility } from '../../services/studentVisibilityTier';
import { leadWouldUnblock } from '../../scripts/attachFraNamedLeadsCore';
import { leadTitlesArePendingPolicy } from '../leadTitlePendingPolicy';

const lead = (title?: string) => ({
  userId: 'user-fixture-lead',
  role: 'pi',
  ...(title ? { title } : {}),
});

describe('leadTitlesArePendingPolicy', () => {
  it('holds a row whose every lead states only a rank awaiting a ruling', () => {
    for (const title of [
      'Clinical Fellow',
      'Clinical Fellow in Pediatrics (Hematology / Oncology)',
      'Hospital Resident',
      'Postgraduate Associate',
      'Staff Affiliate - Hospital',
    ]) {
      expect(leadTitlesArePendingPolicy([lead(title)])).toBe(true);
    }
  });

  it('never holds on a missing title, a hosting rank beside the pending one, or a mixed roster', () => {
    expect(leadTitlesArePendingPolicy([])).toBe(false);
    expect(leadTitlesArePendingPolicy([lead()])).toBe(false);
    expect(leadTitlesArePendingPolicy([lead('Clinical Fellow and Instructor of Medicine')])).toBe(
      false,
    );
    expect(
      leadTitlesArePendingPolicy([lead('Hospital Resident'), lead('Professor of Medicine')]),
    ).toBe(false);
    expect(leadTitlesArePendingPolicy([lead('Associate Research Scholar')])).toBe(false);
    expect(leadTitlesArePendingPolicy([lead('President of the Fixture Society')])).toBe(false);
    expect(leadTitlesArePendingPolicy([lead('Chief Resident')])).toBe(false);
  });
});

describe('the gate holds a pending-policy lead at operator review', () => {
  const entity = {
    slug: 'fixture-pending-policy-lab',
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
    expect(held.reasons).toContain('lead_title_pending_policy');
    expect(tierFor([lead('Associate Professor of Astronomy')]).tier).toBe('student_ready');
  });

  it('leaves a lead that already reads as missing to the lead-attachment lanes', () => {
    const missing = tierFor([lead('Postgraduate Associate')]);
    expect(missing.tier).toBe('operator_review');
    expect(missing.reasons).toContain('missing_lead');
    expect(missing.reasons).not.toContain('lead_title_pending_policy');
    expect(leadWouldUnblock({ studentVisibilityReasons: missing.reasons } as any)).toBe(true);
  });
});

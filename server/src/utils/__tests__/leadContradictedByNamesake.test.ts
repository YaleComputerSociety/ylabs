import { describe, expect, it } from 'vitest';
import { servedLeadIsContradictedByNamesake } from '../leadContradictedByNamesake';
import { computeResearchEntityStudentVisibility } from '../../services/studentVisibilityTier';

const SITE = 'https://example.yale.edu/labs/fixture/';
const judgement = (over: Record<string, unknown> = {}) => ({
  personId: 'lead-1',
  role: 'PI',
  verdict: 'CONTRADICTED',
  matchedBy: 'NONE',
  contradictedBy: 'NAMESAKE',
  ...over,
});
const entity = (over: Record<string, unknown> = {}, leads = [judgement()]) => ({
  websiteUrl: SITE,
  leadVerification: { checkedUrl: SITE, leads },
  ...over,
});
const attached = [{ userId: 'lead-1', role: 'pi' }];

describe('servedLeadIsContradictedByNamesake (#4916)', () => {
  it('holds a row whose served website names a namesake of an attached lead', () => {
    expect(servedLeadIsContradictedByNamesake(entity(), attached)).toBe(true);
    expect(
      servedLeadIsContradictedByNamesake(
        entity({ websiteUrl: 'http://www.example.yale.edu/labs/fixture' }),
        attached,
      ),
    ).toBe(true);
  });

  it('ignores a lead-role contradiction, an old verdict with no shape, and a confirmed lead', () => {
    for (const leads of [
      [judgement({ contradictedBy: 'NAMED_AS_LEAD' })],
      [judgement({ contradictedBy: undefined })],
      [judgement({ verdict: 'CONFIRMED', contradictedBy: undefined })],
    ]) {
      expect(servedLeadIsContradictedByNamesake(entity({}, leads), attached)).toBe(false);
    }
  });

  it('ignores a verdict about another website or a lead no longer attached', () => {
    expect(
      servedLeadIsContradictedByNamesake(
        entity({ websiteUrl: 'https://example.yale.edu/labs/other/' }),
        attached,
      ),
    ).toBe(false);
    expect(servedLeadIsContradictedByNamesake(entity(), [{ userId: 'lead-2', role: 'pi' }])).toBe(
      false,
    );
    expect(servedLeadIsContradictedByNamesake({ websiteUrl: SITE }, attached)).toBe(false);
  });

  it('routes such a row to operator review instead of serving it', () => {
    const lab = {
      slug: 'fixture-example-lab',
      name: 'Example Lab',
      kind: 'lab',
      entityType: 'LAB',
      sourceUrls: [SITE],
      researchAreas: ['Exoplanets'],
      shortDescription: 'Studies exoplanet detection and atmospheric characterization.',
      fullDescription:
        'The lab studies exoplanet detection and atmospheric characterization, combining radial-velocity surveys with high-resolution spectroscopy of transiting planets.',
      activeAtYaleCache: true,
    };
    const visibility = (verificationLeads: Array<Record<string, unknown>>) =>
      computeResearchEntityStudentVisibility({
        entity: entity(lab, verificationLeads as never),
        leadMembers: attached,
        accessSignalCount: 1,
        actionablePathwayCount: 1,
      });
    expect(visibility([judgement({ verdict: 'CONFIRMED', contradictedBy: undefined })]).tier).toBe(
      'student_ready',
    );
    const held = visibility([judgement()]);
    expect(held.tier).toBe('operator_review');
    expect(held.reasons).toContain('lead_contradicted_by_namesake');
  });
});

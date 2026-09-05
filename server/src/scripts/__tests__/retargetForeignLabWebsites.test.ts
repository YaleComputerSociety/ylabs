import { describe, it, expect, vi } from 'vitest';
import {
  buildRetargetRows,
  parseArgs,
  type ForeignLabWebsiteCandidate,
} from '../retargetForeignLabWebsites';

const khannaCandidate: ForeignLabWebsiteCandidate = {
  holderSlug: 'ysm-faculty-amit-khanna',
  holderId: '6a8284b159dc8a22e5c3888d',
  holderName: 'APOLLO LAB, Yale University',
  holderEntityType: 'LAB',
  holderKind: 'lab',
  holderLeadName: 'Amit Khanna',
  holderVisibilityTier: 'student_ready',
  websiteUrl: 'https://apollo-lab-yale.github.io',
  profileUrl: 'https://medicine.yale.edu/profile/amit-khanna/',
  slotNames: ['APOLLO LAB, Yale University'],
  observationIds: ['6a914dcb379c8d1685432d45'],
  manuallyLockedFields: [],
};

describe('parseArgs', () => {
  it('defaults to dry-run with no confirm', () => {
    expect(parseArgs([])).toMatchObject({ apply: false, confirm: false });
  });

  it('reads apply, confirm, limits, and a slug allowlist', () => {
    expect(
      parseArgs([
        '--apply',
        '--confirm-retarget-foreign-lab-websites',
        '--limit=5',
        '--max-apply=2',
        '--only=ysm-faculty-amit-khanna,ysm-faculty-simon-milette',
      ]),
    ).toMatchObject({
      apply: true,
      confirm: true,
      limit: 5,
      maxApply: 2,
      only: ['ysm-faculty-amit-khanna', 'ysm-faculty-simon-milette'],
    });
  });

  it('refuses a nonsense limit rather than silently widening the run', () => {
    expect(() => parseArgs(['--limit=0'])).toThrow();
    expect(() => parseArgs(['--max-apply=-3'])).toThrow();
  });

  it('lets a later --dry-run cancel an earlier --apply', () => {
    expect(parseArgs(['--apply', '--dry-run']).apply).toBe(false);
  });
});

describe('buildRetargetRows', () => {
  it('re-homes the Apollo Lab website to Daniel Rakita (#2385)', async () => {
    const rows = await buildRetargetRows([khannaCandidate], {
      readSite: async () => ({
        declaredLead: 'Daniel Rakita',
        labName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
        evidenceUrl: 'https://apollo-lab-yale.github.io/team/',
        pagesRead: [
          'https://apollo-lab-yale.github.io/',
          'https://apollo-lab-yale.github.io/team/',
        ],
      }),
      loadHomesForLead: async () => [
        {
          slug: 'rakita-lab-dr877',
          name: 'Rakita Lab',
          entityType: 'LAB',
          kind: 'lab',
          websiteUrl: '',
          leadName: 'Daniel Rakita',
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision: 'RETARGET',
      targetSlug: 'rakita-lab-dr877',
      declaredLead: 'Daniel Rakita',
      adoptedName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
      evidenceUrl: 'https://apollo-lab-yale.github.io/team/',
    });
  });

  it('records a site that states no lead as NO_SITE_EVIDENCE without asking for homes', async () => {
    const loadHomesForLead = vi.fn(async () => []);
    const rows = await buildRetargetRows([khannaCandidate], {
      readSite: async () => null,
      loadHomesForLead,
    });
    expect(rows[0]).toMatchObject({ decision: 'NO_SITE_EVIDENCE', declaredLead: '' });
    expect(rows[0].targetSlug).toBeUndefined();
    expect(loadHomesForLead).not.toHaveBeenCalled();
  });

  it('carries the refusal reason through so a dry run explains itself', async () => {
    const rows = await buildRetargetRows([khannaCandidate], {
      readSite: async () => ({
        declaredLead: 'Daniel Rakita',
        labName: 'APOLLO Lab',
        evidenceUrl: 'https://apollo-lab-yale.github.io/team/',
        pagesRead: [],
      }),
      loadHomesForLead: async () => [],
    });
    expect(rows[0]).toMatchObject({
      decision: 'REFUSE',
      refusalReason: 'DECLARED_LEAD_HAS_NO_RESEARCH_HOME',
    });
  });

  it('leaves a site that declares the holder as its own lead alone', async () => {
    const rows = await buildRetargetRows(
      [{ ...khannaCandidate, holderLeadName: 'Rohan Khera', holderName: 'CarDS Lab' }],
      {
        readSite: async () => ({
          declaredLead: 'Rohan Khera',
          labName: 'CarDS Lab',
          evidenceUrl: 'https://www.cards-lab.org/team',
          pagesRead: [],
        }),
        loadHomesForLead: async () => [],
      },
    );
    expect(rows[0].decision).toBe('KEEP_ON_HOLDER');
    expect(rows[0].targetSlug).toBeUndefined();
  });
});

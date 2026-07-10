import { describe, expect, it } from 'vitest';

import { buildScholarlyActivityAuditReportFromCounts } from '../scholarlyActivityAuditService';

describe('buildScholarlyActivityAuditReportFromCounts', () => {
  it('targets provenance repair commands at Beta when blockers remain', () => {
    const report = buildScholarlyActivityAuditReportFromCounts({
      activeScholarlyLinks: 10,
      entityLinkedScholarlyLinks: 4,
      userLinkedScholarlyLinks: 5,
      activeAttributions: 6,
      nullTargetAttributions: 1,
      orphanAttributions: 0,
      activeLinksWithoutOwner: 0,
    });

    expect(report.pass).toBe(false);
    expect(report.fixCommand).toBe(
      'SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --apply --max-apply=1 --confirm-scholarly-link-apply',
    );
  });
});

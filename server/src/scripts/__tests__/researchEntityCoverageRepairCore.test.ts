import { describe, expect, it } from 'vitest';
import type { CoverageAuditRow } from '../researchEntityCoverageAuditCore';
import {
  DEFAULT_REPAIR_ISSUES,
  parseIssueList,
  selectRepairRows,
  summarizeRepairRows,
} from '../researchEntityCoverageRepairCore';

function row(overrides: Partial<CoverageAuditRow> = {}): CoverageAuditRow {
  return {
    slug: 'dept-cs-example',
    name: 'Example Lab',
    kind: 'lab',
    school: 'Yale School of Engineering & Applied Science',
    websiteUrl: 'https://example.yale.edu/',
    descriptionChars: 0,
    shortDescriptionChars: 0,
    fullDescriptionChars: 0,
    counts: {
      departments: 0,
      researchAreas: 0,
      sourceUrls: 2,
      members: 0,
      pathways: 0,
      publicContactRoutes: 0,
      totalContactRoutes: 0,
      accessSignals: 0,
      postedOpportunities: 0,
      activeListings: 0,
    },
    issues: ['MISSING_DESCRIPTION'],
    issueScore: 2,
    ...overrides,
  };
}

describe('parseIssueList', () => {
  it('falls back to the default sparse-coverage repair issues', () => {
    expect(parseIssueList()).toEqual([...DEFAULT_REPAIR_ISSUES]);
  });

  it('dedupes and trims explicit issue lists', () => {
    expect(parseIssueList('NO_PATHWAYS, MISSING_DESCRIPTION, NO_PATHWAYS')).toEqual([
      'NO_PATHWAYS',
      'MISSING_DESCRIPTION',
    ]);
  });
});

describe('selectRepairRows', () => {
  it('keeps rows that match any requested issue bucket', () => {
    const rows = [
      row({ slug: 'a', issues: ['MISSING_DESCRIPTION'], issueScore: 2 }),
      row({ slug: 'b', issues: ['NO_PATHWAYS'], issueScore: 2 }),
      row({ slug: 'c', issues: ['BLANK_DETAIL_RISK'], issueScore: 5 }),
    ];

    expect(selectRepairRows(rows, ['NO_PATHWAYS', 'MISSING_DESCRIPTION']).map((item) => item.slug)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('summarizeRepairRows', () => {
  it('reports count, issue totals, and average score', () => {
    const summary = summarizeRepairRows([
      row({ issues: ['MISSING_DESCRIPTION'], issueScore: 2 }),
      row({ slug: 'b', issues: ['NO_PATHWAYS', 'NO_PUBLIC_CONTACT_ROUTE'], issueScore: 4 }),
    ]);

    expect(summary.selectedCount).toBe(2);
    expect(summary.issueCounts.MISSING_DESCRIPTION).toBe(1);
    expect(summary.issueCounts.NO_PATHWAYS).toBe(1);
    expect(summary.averageIssueScore).toBe(3);
  });
});

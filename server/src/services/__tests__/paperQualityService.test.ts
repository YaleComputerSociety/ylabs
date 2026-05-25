import { describe, expect, it } from 'vitest';
import { buildPaperQualityReportFromCounts } from '../paperQualityService';

const cleanCounts = {
  totalActivePapers: 12,
  missingTitle: 0,
  genericTitle: 0,
  htmlTitle: 0,
  missingInspectableLink: 0,
  missingYearOrDate: 0,
  invalidYear: 0,
  negativeCitationCount: 0,
  missingSourceLabel: 0,
  duplicateDoiGroups: 0,
  duplicateOpenAlexGroups: 0,
  duplicateArxivGroups: 0,
  duplicateSemanticScholarGroups: 0,
};

describe('paperQualityService', () => {
  it('flags zero active papers as a coverage warning instead of a launch-quality pass', () => {
    const report = buildPaperQualityReportFromCounts({
      totalActivePapers: 0,
      missingTitle: 0,
      genericTitle: 0,
      htmlTitle: 0,
      missingInspectableLink: 0,
      missingYearOrDate: 0,
      invalidYear: 0,
      negativeCitationCount: 0,
      missingSourceLabel: 0,
      duplicateDoiGroups: 0,
      duplicateOpenAlexGroups: 0,
      duplicateArxivGroups: 0,
      duplicateSemanticScholarGroups: 0,
    });

    expect(report.pass).toBe(false);
    expect(report.warning).toMatch(/zero active papers/i);
    expect(report.fixCommands).toContain(
      'Verify paper materialization target DB and active-paper filter before relying on research activity.',
    );
  });

  it('passes when active papers have no quality blockers', () => {
    const report = buildPaperQualityReportFromCounts(cleanCounts);

    expect(report.pass).toBe(true);
    expect(report.warning).toBe('');
    expect(report.fixCommands).toEqual([]);
  });

  it('fails when paper quality launch blockers remain', () => {
    const report = buildPaperQualityReportFromCounts({
      ...cleanCounts,
      missingTitle: 2,
      duplicateDoiGroups: 1,
    });

    expect(report.pass).toBe(false);
    expect(report.warning).toBe('Paper quality launch blockers remain.');
    expect(report.fixCommands).toContain('Repair papers missing titles before relying on research activity.');
    expect(report.fixCommands).toContain('Resolve duplicate DOI paper groups.');
  });
});

export interface PaperQualityCounts {
  totalActivePapers: number;
  totalActiveScholarlyLinks: number;
  totalScholarlyAttributions: number;
  missingTitle: number;
  genericTitle: number;
  htmlTitle: number;
  missingInspectableLink: number;
  missingYearOrDate: number;
  invalidYear: number;
  negativeCitationCount: number;
  missingSourceLabel: number;
  duplicateDoiGroups: number;
  duplicateOpenAlexGroups: number;
  duplicateArxivGroups: number;
  duplicateSemanticScholarGroups: number;
}

export interface PaperQualityReport {
  pass: boolean;
  warning: string;
  totalIssues: number;
  counts: PaperQualityCounts;
  fixCommands: string[];
}

export function buildPaperQualityReportFromCounts(counts: PaperQualityCounts): PaperQualityReport {
  const total =
    counts.missingTitle +
    counts.genericTitle +
    counts.htmlTitle +
    counts.missingInspectableLink +
    counts.missingYearOrDate +
    counts.invalidYear +
    counts.negativeCitationCount +
    counts.missingSourceLabel +
    counts.duplicateDoiGroups +
    counts.duplicateOpenAlexGroups +
    counts.duplicateArxivGroups +
    counts.duplicateSemanticScholarGroups;
  const hasCanonicalScholarlyCoverage =
    counts.totalActiveScholarlyLinks > 0 || counts.totalScholarlyAttributions > 0;
  const zeroActivePaperCoverageGap = counts.totalActivePapers === 0 && !hasCanonicalScholarlyCoverage;
  const fixCommands: string[] = [];

  if (zeroActivePaperCoverageGap) {
    fixCommands.push(
      'Verify paper materialization target DB and active-paper filter before relying on research activity.',
    );
  }
  if (counts.missingTitle > 0) {
    fixCommands.push('Repair papers missing titles before relying on research activity.');
  }
  if (counts.genericTitle > 0) {
    fixCommands.push('Replace generic paper titles with source-backed titles.');
  }
  if (counts.htmlTitle > 0) {
    fixCommands.push('Repair paper titles that contain raw HTML.');
  }
  if (counts.missingInspectableLink > 0) {
    fixCommands.push('Add DOI, source, landing-page, PDF, or open-access links to paper records.');
  }
  if (counts.missingYearOrDate > 0 || counts.invalidYear > 0) {
    fixCommands.push('Repair paper publication year/date metadata.');
  }
  if (counts.negativeCitationCount > 0) {
    fixCommands.push('Repair negative paper citation counts.');
  }
  if (counts.missingSourceLabel > 0) {
    fixCommands.push('Attach source labels to paper records.');
  }
  if (counts.duplicateDoiGroups > 0) {
    fixCommands.push('Resolve duplicate DOI paper groups.');
  }
  if (counts.duplicateOpenAlexGroups > 0) {
    fixCommands.push('Resolve duplicate OpenAlex paper groups.');
  }
  if (counts.duplicateArxivGroups > 0) {
    fixCommands.push('Resolve duplicate arXiv paper groups.');
  }
  if (counts.duplicateSemanticScholarGroups > 0) {
    fixCommands.push('Resolve duplicate Semantic Scholar paper groups.');
  }

  return {
    pass: total === 0 && !zeroActivePaperCoverageGap,
    warning: zeroActivePaperCoverageGap
      ? 'Zero active papers found; paper activity coverage may be missing or pointed at the wrong target.'
      : total > 0
        ? 'Paper quality launch blockers remain.'
        : '',
    totalIssues: total,
    counts,
    fixCommands,
  };
}

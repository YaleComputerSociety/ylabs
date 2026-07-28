export interface Phase0SummaryOnlyMetadata {
  environment?: string;
  db?: string;
}

export function assertPhase0SummaryOnlyDryRun(args: {
  summaryOnly: boolean;
  apply: boolean;
  scriptName: string;
}): void {
  if (args.summaryOnly && args.apply) {
    throw new Error(`${args.scriptName} --summary-only cannot be combined with --apply.`);
  }
}

export function buildPhase0SummaryOnlyOutput<T extends object>(
  summary: T,
  metadata: Phase0SummaryOnlyMetadata,
): T & {
  summaryOnly: true;
  environment?: string;
  db?: string;
} {
  return {
    ...summary,
    summaryOnly: true,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
  };
}

import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
  parseOperatorDatabaseEnvironment,
} from './operatorDatabaseEnvironment';

export type Phase0SummaryOnlyEnvironment = 'development' | 'beta' | 'production-copy';

export interface Phase0SummaryOnlyMetadata {
  environment?: string;
  db?: string;
}

export function parsePhase0SummaryOnlyEnvironment(
  value: string | undefined,
): Phase0SummaryOnlyEnvironment {
  const environment = parseOperatorDatabaseEnvironment(value);
  if (environment === 'production' || environment === 'test') {
    throw new Error('--environment requires development, beta, or production-copy');
  }
  return environment;
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

export function assertPhase0SummaryOnlyConfiguredTarget(args: {
  summaryOnly: boolean;
  environment?: Phase0SummaryOnlyEnvironment;
  mongoUrl?: string;
  scriptName: string;
}): void {
  assertPhase0SummaryOnlyEnvironmentOption(args);
  if (!args.summaryOnly || !args.environment) return;
  const databaseName = databaseNameFromMongoUrl(args.mongoUrl || '');
  assertOperatorEnvironmentMatchesDatabase(args.environment, databaseName);
}

export function assertPhase0SummaryOnlyConnectedTarget(args: {
  summaryOnly: boolean;
  environment?: Phase0SummaryOnlyEnvironment;
  databaseName?: string;
  scriptName: string;
}): void {
  assertPhase0SummaryOnlyEnvironmentOption(args);
  if (!args.summaryOnly || !args.environment) return;
  assertOperatorEnvironmentMatchesDatabase(args.environment, args.databaseName || '');
}

function assertPhase0SummaryOnlyEnvironmentOption(args: {
  summaryOnly: boolean;
  environment?: Phase0SummaryOnlyEnvironment;
  scriptName: string;
}): void {
  if (args.summaryOnly && !args.environment) {
    throw new Error(`${args.scriptName} --summary-only requires --environment.`);
  }
  if (!args.summaryOnly && args.environment) {
    throw new Error(`${args.scriptName} --environment is only valid with --summary-only.`);
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

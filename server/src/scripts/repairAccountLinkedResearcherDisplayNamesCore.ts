import { canonicalPersonName } from '../scrapers/utils/personNameCasing';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export const RESEARCHER_DISPLAY_NAME_MAX_LENGTH = 240;

export interface RepairAccountLinkedResearcherDisplayNamesArgs {
  apply: boolean;
  confirmDisplayNameRepair: boolean;
  output?: string;
}

export interface AccountLinkedResearcherInput {
  researcherId: string;
  netid?: string;
  legacyFirstName?: string;
  legacyLastName?: string;
}

export interface AccountLinkedResearcherDisplayNameRepair {
  researcherId: string;
  netid: string;
  displayName: string;
}

export interface AccountLinkedResearcherDisplayNameSkip {
  researcherId: string;
  reason: 'missing-account-netid' | 'no-legacy-name-source';
}

export interface AccountLinkedResearcherDisplayNamePlan {
  candidates: number;
  repairs: AccountLinkedResearcherDisplayNameRepair[];
  skipped: AccountLinkedResearcherDisplayNameSkip[];
}

export function parseRepairAccountLinkedResearcherDisplayNamesArgs(
  argv: string[],
): RepairAccountLinkedResearcherDisplayNamesArgs {
  const args: RepairAccountLinkedResearcherDisplayNamesArgs = {
    apply: false,
    confirmDisplayNameRepair: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-researcher-display-name-repair') {
      args.confirmDisplayNameRepair = true;
      continue;
    }
    if (arg.startsWith('--confirm-researcher-display-name-repair=')) {
      throw new Error('--confirm-researcher-display-name-repair does not accept a value');
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown repair:researcher-display-names argument: ${arg}`);
  }

  return args;
}

export function assertRepairAccountLinkedResearcherDisplayNamesApplyAllowed(
  args: Pick<
    RepairAccountLinkedResearcherDisplayNamesArgs,
    'apply' | 'confirmDisplayNameRepair'
  >,
): void {
  if (args.apply && !args.confirmDisplayNameRepair) {
    throw new Error(
      '--confirm-researcher-display-name-repair is required when --apply is set for repair:researcher-display-names',
    );
  }
}

export function composeResearcherDisplayName(
  input: Pick<AccountLinkedResearcherInput, 'legacyFirstName' | 'legacyLastName'>,
): string | undefined {
  const combined = [input.legacyFirstName, input.legacyLastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(' ');
  const canonical = canonicalPersonName(combined);
  if (!canonical) return undefined;
  return canonical.slice(0, RESEARCHER_DISPLAY_NAME_MAX_LENGTH);
}

export function buildAccountLinkedResearcherDisplayNamePlan(
  inputs: readonly AccountLinkedResearcherInput[],
): AccountLinkedResearcherDisplayNamePlan {
  const repairs: AccountLinkedResearcherDisplayNameRepair[] = [];
  const skipped: AccountLinkedResearcherDisplayNameSkip[] = [];

  for (const input of inputs) {
    const netid = typeof input.netid === 'string' ? input.netid.trim() : '';
    if (!netid) {
      skipped.push({ researcherId: input.researcherId, reason: 'missing-account-netid' });
      continue;
    }
    const displayName = composeResearcherDisplayName(input);
    if (!displayName) {
      skipped.push({ researcherId: input.researcherId, reason: 'no-legacy-name-source' });
      continue;
    }
    repairs.push({ researcherId: input.researcherId, netid, displayName });
  }

  return { candidates: inputs.length, repairs, skipped };
}

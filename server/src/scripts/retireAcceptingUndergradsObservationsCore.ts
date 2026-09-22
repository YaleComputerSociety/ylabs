export const RETIRE_ACCEPTING_UNDERGRADS_SCRIPT_NAME = 'observations:retire-accepting-undergrads';

export const RETIRE_ACCEPTING_UNDERGRADS_CONFIRM_FLAG = '--confirm-retire-accepting-undergrads';

export const RETIRED_ACCEPTING_UNDERGRADS_FIELD = 'acceptingUndergrads';

export const RETIRE_ACCEPTING_UNDERGRADS_ROLLBACK_REASON =
  'bare undergrad-access boolean retired in favour of undergradAccessEvidence, which carries the verdict, the quote and the page it came from (#2055)';

export interface RetireAcceptingUndergradsArgs {
  apply: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRetireAcceptingUndergradsArgs(
  argv: readonly string[],
): RetireAcceptingUndergradsArgs {
  const args: RetireAcceptingUndergradsArgs = { apply: false, confirmed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === RETIRE_ACCEPTING_UNDERGRADS_CONFIRM_FLAG) args.confirmed = true;
    else if (arg.startsWith(`${RETIRE_ACCEPTING_UNDERGRADS_CONFIRM_FLAG}=`)) {
      throw new Error(`${RETIRE_ACCEPTING_UNDERGRADS_CONFIRM_FLAG} does not accept a value`);
    } else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown ${RETIRE_ACCEPTING_UNDERGRADS_SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

export function assertRetireAcceptingUndergradsApplyAllowed(
  args: Pick<RetireAcceptingUndergradsArgs, 'apply' | 'confirmed'>,
): void {
  if (args.apply && !args.confirmed) {
    throw new Error(
      `${RETIRE_ACCEPTING_UNDERGRADS_SCRIPT_NAME} apply requires ${RETIRE_ACCEPTING_UNDERGRADS_CONFIRM_FLAG}`,
    );
  }
}

export interface RetireAcceptingUndergradsCounts {
  liveObservationsBefore: number;
  liveObservationsAfter: number;
  provenanceEntriesBefore: number;
  provenanceEntriesAfter: number;
  supersededObservations: number;
  clearedProvenanceEntries: number;
}

/**
 * Both residues have to reach zero, not just the one the run happened to touch:
 * a superseded observation with a surviving `fieldProvenance.acceptingUndergrads`
 * still credits a source for a field no reader can produce.
 */
export function assertAcceptingUndergradsFullyRetired(
  counts: Pick<RetireAcceptingUndergradsCounts, 'liveObservationsAfter' | 'provenanceEntriesAfter'>,
): void {
  if (counts.liveObservationsAfter !== 0 || counts.provenanceEntriesAfter !== 0) {
    throw new Error(
      `${RETIRE_ACCEPTING_UNDERGRADS_SCRIPT_NAME} invariant violated: ${counts.liveObservationsAfter} live observations and ${counts.provenanceEntriesAfter} field-provenance entries still carry ${RETIRED_ACCEPTING_UNDERGRADS_FIELD} after apply.`,
    );
  }
}

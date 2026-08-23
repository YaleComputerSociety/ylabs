export type GrantShellDisposition =
  | 'newly-linked'
  | 'already-linked'
  | 'personid-divergent'
  | 'still-ambiguous'
  | 'still-unmatched';

export type GrantShellMatchStatus = 'matched' | 'ambiguous' | 'unmatched';

export interface GrantShellClassifyInput {
  matchStatus: GrantShellMatchStatus;
  canonicalPersonId: string | null;
  activeLeadPersonIds: readonly string[];
}

export function classifyGrantShell(input: GrantShellClassifyInput): GrantShellDisposition {
  if (input.matchStatus === 'ambiguous') return 'still-ambiguous';
  if (input.matchStatus === 'unmatched') return 'still-unmatched';

  const activeLeads = input.activeLeadPersonIds;
  const canonical = input.canonicalPersonId;
  if (canonical && activeLeads.includes(canonical)) return 'already-linked';
  if (activeLeads.length > 0) return 'personid-divergent';
  return 'newly-linked';
}

export function tallyGrantShellDispositions(
  dispositions: readonly GrantShellDisposition[],
): Record<GrantShellDisposition, number> {
  const tally: Record<GrantShellDisposition, number> = {
    'newly-linked': 0,
    'already-linked': 0,
    'personid-divergent': 0,
    'still-ambiguous': 0,
    'still-unmatched': 0,
  };
  for (const disposition of dispositions) tally[disposition] += 1;
  return tally;
}

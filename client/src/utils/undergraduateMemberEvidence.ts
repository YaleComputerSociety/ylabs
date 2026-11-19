import { ROSTER_ALUMNI_PROGRAM_NAME } from './pastUndergradAdvisees';
import { sourceLedgerKey } from './researchDetailSources';

export type UndergraduateMemberStatus = 'current' | 'past';

export type UndergraduateMemberLine =
  { status: 'current'; count: number; sourceUrl: string } | { status: 'past'; sourceUrl: string };

interface MemberSignal {
  signalType?: string;
  sourceUrl?: string;
}

export interface UndergraduateMemberEvidenceInput {
  roster?: { undergraduates?: ReadonlyArray<{ status?: string }> } | null;
  accessSignals?: ReadonlyArray<MemberSignal>;
  currentUndergradCount?: number | null;
  pastUndergradAdvisees?: ReadonlyArray<{ programName?: string; count?: number }> | null;
  fellowshipRecipients?: ReadonlyArray<{ sourceUrl?: string }> | null;
}

export interface UndergraduateMemberEvidence {
  memberLines: UndergraduateMemberLine[];
  shownStatuses: ReadonlySet<UndergraduateMemberStatus>;
  citesFellowshipRecipients: (sourceUrl?: string) => boolean;
}

const SIGNAL_STATUS: Record<string, UndergraduateMemberStatus> = {
  CURRENT_UNDERGRADS: 'current',
  PAST_UNDERGRADS: 'past',
};

export const memberSignalStatus = (signalType?: string): UndergraduateMemberStatus | undefined =>
  SIGNAL_STATUS[(signalType || '').toUpperCase()];

const positive = (value: unknown): number => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

/**
 * The single reading of what a detail page shows about a lab's undergraduate members, so
 * the research team section and the Sources chips that cite it cannot disagree.
 *
 * A named roster shows its statuses. Where it does not, a member signal still backs a
 * line read off the lab's own page, so the section states it and links that page. Only
 * the current line carries a number: the roster-alumni count undercounts long alumni
 * lists (see `formatPastAdvisees`). A past-member signal citing a fellowship booklet is
 * the fellowship section's evidence, not a roster.
 */
export function undergraduateMemberEvidence(
  input: UndergraduateMemberEvidenceInput,
): UndergraduateMemberEvidence {
  const rosterStatuses = new Set(
    (input.roster?.undergraduates ?? [])
      .map((member) => member.status)
      .filter(
        (status): status is UndergraduateMemberStatus => status === 'current' || status === 'past',
      ),
  );
  const fellowshipUrls = new Set(
    (input.fellowshipRecipients ?? [])
      .map((recipient) => sourceLedgerKey(recipient.sourceUrl))
      .filter((key): key is string => Boolean(key)),
  );
  const citesFellowshipRecipients = (sourceUrl?: string): boolean => {
    const key = sourceLedgerKey(sourceUrl);
    return Boolean(key) && fellowshipUrls.has(key as string);
  };
  const pastAdvisees = input.pastUndergradAdvisees ?? [];
  const pastAdviseesAreRosterAlumni = pastAdvisees.every(
    (entry) => entry?.programName === ROSTER_ALUMNI_PROGRAM_NAME,
  );
  const listsRosterAlumni =
    pastAdviseesAreRosterAlumni &&
    positive(pastAdvisees.reduce((sum, entry) => sum + (entry.count ?? 1), 0)) > 0;
  const currentCount = positive(input.currentUndergradCount);
  const lineFor = (
    status: UndergraduateMemberStatus,
    sourceUrl: string,
  ): UndergraduateMemberLine | null => {
    if (status === 'past') return listsRosterAlumni ? { status, sourceUrl } : null;
    return currentCount > 0 ? { status, count: currentCount, sourceUrl } : null;
  };

  const memberLines: UndergraduateMemberLine[] = [];
  for (const signal of input.accessSignals ?? []) {
    const status = memberSignalStatus(signal.signalType);
    const sourceUrl = (signal.sourceUrl || '').trim();
    if (!status || !sourceUrl || rosterStatuses.has(status)) continue;
    if (citesFellowshipRecipients(sourceUrl)) continue;
    if (memberLines.some((line) => line.status === status)) continue;
    const line = lineFor(status, sourceUrl);
    if (line) memberLines.push(line);
  }
  memberLines.sort((left, right) =>
    left.status === right.status ? 0 : left.status === 'current' ? -1 : 1,
  );

  const shownStatuses = new Set<UndergraduateMemberStatus>(rosterStatuses);
  memberLines.forEach((line) => shownStatuses.add(line.status));
  return { memberLines, shownStatuses, citesFellowshipRecipients };
}

import {
  UNDERGRAD_EVIDENCE_SIGNAL,
  undergradListEntryKinds,
  undergradListSources,
  type UndergradEvidenceSignal,
  type UndergradListEntryKind,
  type UndergradListSource,
} from '../models/storedVocabularies';
import { publicHttpUrl } from '../utils/urlSafety';

// A source joins this set only after the owner has read a side-by-side sample of its
// identity matches; an agent check is not that review (#5551, owner decision 2026-10-04).
// The owner confirmed these on 2026-11-10, and the Tobin board on 2026-11-11 after its own
// ballot; EPS waits on a row defect (#4916).
export const OWNER_REVIEWED_UNDERGRAD_LIST_SOURCES: ReadonlySet<UndergradListSource> =
  new Set<UndergradListSource>([
    'cs-senior-projects',
    'cs-directed-research',
    'economics-senior-essay-advisers',
    'psychology-research-opportunities',
    'wu-tsai-undergraduate-fellows',
    'physics-open-research-opportunities',
    'english-senior-essays',
    'english-creative-writing-projects',
    'political-science-senior-essay-prizes',
    'german-senior-essays',
    'yibs-summer-research-fellows',
    'cognitive-science-senior-essays',
    'tobin-research-assistantships',
  ]);

export interface PublicUndergradListEntry {
  source: UndergradListSource;
  signal: UndergradEvidenceSignal;
  kind: UndergradListEntryKind;
  count?: number;
  latestYear?: number;
  sourceUrl: string;
}

export interface UndergradListServingOptions {
  wayInWithheld?: boolean;
  reviewedSources?: ReadonlySet<string>;
  signal?: UndergradEvidenceSignal;
}

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

/**
 * The entries of `undergradListEvidence` a student may see: owner-reviewed sources only,
 * each carrying the one undergraduate signal its list feeds (#5362, #5551), and no
 * current-openness entry on a row that withholds its way in.
 */
export function publicUndergradListEvidence(
  value: unknown,
  options: UndergradListServingOptions = {},
): PublicUndergradListEntry[] {
  if (!Array.isArray(value)) return [];
  const reviewed = options.reviewedSources ?? OWNER_REVIEWED_UNDERGRAD_LIST_SOURCES;
  const served: PublicUndergradListEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const source = entry.source as UndergradListSource;
    const kind = entry.kind as UndergradListEntryKind;
    if (!undergradListSources.includes(source) || !reviewed.has(source)) continue;
    const signal = UNDERGRAD_EVIDENCE_SIGNAL[source];
    if (options.signal && signal !== options.signal) continue;
    if (!undergradListEntryKinds.includes(kind)) continue;
    if (kind === 'open' && options.wayInWithheld) continue;
    const sourceUrl = publicHttpUrl(entry.sourceUrl);
    if (!sourceUrl) continue;
    const count = positiveInteger(entry.count);
    const latestYear = positiveInteger(entry.latestYear);
    served.push({
      source,
      signal,
      kind,
      ...(count ? { count } : {}),
      ...(latestYear ? { latestYear } : {}),
      sourceUrl,
    });
  }
  return served;
}

export const entityHasUndergradListSignal = (
  group: { undergradListEvidence?: unknown; wayInWithheld?: unknown },
  signal: UndergradEvidenceSignal,
  reviewedSources?: ReadonlySet<string>,
): boolean =>
  publicUndergradListEvidence(group.undergradListEvidence, {
    wayInWithheld: group.wayInWithheld === true,
    reviewedSources,
    signal,
  }).length > 0;

export const entityMentorsUndergraduates = (
  group: { undergradListEvidence?: unknown; wayInWithheld?: unknown },
  reviewedSources?: ReadonlySet<string>,
): boolean => entityHasUndergradListSignal(group, 'mentors', reviewedSources);

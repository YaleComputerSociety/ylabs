import {
  undergradMentoringKinds,
  undergradMentoringSources,
  type UndergradMentoringKind,
  type UndergradMentoringSource,
} from '../models/storedVocabularies';
import { publicHttpUrl } from '../utils/urlSafety';

// A source joins this set only after the owner has read a side-by-side sample of its
// identity matches; an agent check is not that review (#5551, owner decision 2026-10-04).
export const OWNER_REVIEWED_UNDERGRAD_MENTORING_SOURCES: ReadonlySet<UndergradMentoringSource> =
  new Set<UndergradMentoringSource>([]);

export interface PublicUndergradMentoringEntry {
  source: UndergradMentoringSource;
  kind: UndergradMentoringKind;
  count?: number;
  latestYear?: number;
  sourceUrl: string;
}

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

export function publicUndergradMentoring(
  value: unknown,
  options: { wayInWithheld?: boolean; reviewedSources?: ReadonlySet<string> } = {},
): PublicUndergradMentoringEntry[] {
  if (!Array.isArray(value)) return [];
  const reviewed = options.reviewedSources ?? OWNER_REVIEWED_UNDERGRAD_MENTORING_SOURCES;
  const served: PublicUndergradMentoringEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const source = entry.source as UndergradMentoringSource;
    const kind = entry.kind as UndergradMentoringKind;
    if (!undergradMentoringSources.includes(source) || !reviewed.has(source)) continue;
    if (!undergradMentoringKinds.includes(kind)) continue;
    if (kind === 'open' && options.wayInWithheld) continue;
    const sourceUrl = publicHttpUrl(entry.sourceUrl);
    if (!sourceUrl) continue;
    const count = positiveInteger(entry.count);
    const latestYear = positiveInteger(entry.latestYear);
    served.push({
      source,
      kind,
      ...(count ? { count } : {}),
      ...(latestYear ? { latestYear } : {}),
      sourceUrl,
    });
  }
  return served;
}

export const entityMentorsUndergraduates = (
  group: { undergradMentoring?: unknown; wayInWithheld?: unknown },
  reviewedSources?: ReadonlySet<string>,
): boolean =>
  publicUndergradMentoring(group.undergradMentoring, {
    wayInWithheld: group.wayInWithheld === true,
    reviewedSources,
  }).length > 0;

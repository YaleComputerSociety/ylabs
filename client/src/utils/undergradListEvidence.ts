import type { UndergradListEvidence } from '../types/researchGroup';
import { safeHttpUrl } from './url';

// Mirrors the hosted and welcomes keys of UNDERGRAD_EVIDENCE_SIGNAL in
// server/src/models/storedVocabularies.ts; a source missing here is not shown.
const HOSTED_LIST_PARTICIPANTS: Record<string, { one: string; many: string }> = {
  'tobin-research-assistantships': {
    one: 'Tobin RA program research assistant',
    many: 'Tobin RA program research assistants',
  },
  'wu-tsai-undergraduate-fellows': {
    one: 'Wu Tsai Institute undergraduate fellow',
    many: 'Wu Tsai Institute undergraduate fellows',
  },
  'yibs-summer-research-fellows': {
    one: 'YIBS summer research fellow',
    many: 'YIBS summer research fellows',
  },
};

const WELCOMES_LIST_NAMES: Record<string, string> = {
  'psychology-research-opportunities': "Psychology's research opportunities list",
  'physics-open-research-opportunities': "Physics' list of faculty with open research positions",
};

export interface UndergradListEvidenceLine {
  text: string;
  href: string;
}

const hostedLine = (entry: UndergradListEvidence): string | null => {
  const participants = HOSTED_LIST_PARTICIPANTS[entry.source];
  if (!participants) return null;
  const counted = entry.count && entry.count > 0 ? entry.count : undefined;
  const noun = counted === 1 ? participants.one : participants.many;
  const text = counted ? `Hosted ${counted} ${noun}` : `Hosted ${noun}`;
  return entry.latestYear ? `${text} (latest ${entry.latestYear})` : text;
};

const welcomesLine = (entry: UndergradListEvidence): string | null => {
  const listName = WELCOMES_LIST_NAMES[entry.source];
  return listName ? `Listed on ${listName} as taking undergraduates` : null;
};

/** Evidence lines for the hosted and welcomes lists a row is named on, each linked to its list. */
export const formatUndergradListEvidence = (
  entries: UndergradListEvidence[] | undefined,
): UndergradListEvidenceLine[] =>
  (entries || []).flatMap((entry) => {
    const href = safeHttpUrl(entry?.sourceUrl);
    if (!href) return [];
    const text =
      entry.signal === 'hosted'
        ? hostedLine(entry)
        : entry.signal === 'welcomes'
          ? welcomesLine(entry)
          : null;
    return text ? [{ text, href }] : [];
  });

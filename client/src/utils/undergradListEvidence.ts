import type { UndergradListEvidence } from '../types/researchGroup';
import { safeHttpUrl } from './url';

// Mirrors the keys of UNDERGRAD_EVIDENCE_SIGNAL in server/src/models/storedVocabularies.ts;
// a source missing here is not shown.
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

const MENTORED_WORK: Record<string, { one: string; many: string }> = {
  'cs-senior-projects': {
    one: 'CPSC 4900 senior project',
    many: 'CPSC 4900 senior projects',
  },
  'cs-directed-research': {
    one: 'CPSC 2900 directed research project',
    many: 'CPSC 2900 directed research projects',
  },
  'english-senior-essays': { one: 'English senior essay', many: 'English senior essays' },
  'english-creative-writing-projects': {
    one: 'Creative Writing senior project',
    many: 'Creative Writing senior projects',
  },
  'political-science-senior-essay-prizes': {
    one: 'prize-winning Political Science senior essay',
    many: 'prize-winning Political Science senior essays',
  },
  'german-senior-essays': { one: 'German senior essay', many: 'German senior essays' },
  'cognitive-science-senior-essays': {
    one: 'Cognitive Science senior essay',
    many: 'Cognitive Science senior essays',
  },
  'eps-senior-theses': {
    one: 'Earth and Planetary Sciences senior thesis',
    many: 'Earth and Planetary Sciences senior theses',
  },
  'theater-performance-studies-senior-projects': {
    one: 'Theater, Dance, and Performance Studies senior project',
    many: 'Theater, Dance, and Performance Studies senior projects',
  },
};

const MENTOR_ROSTER_ROLES: Record<string, string> = {
  'economics-senior-essay-advisers': 'Senior essay adviser, Economics',
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

const withLatestYear = (text: string, entry: UndergradListEvidence): string =>
  entry.latestYear ? `${text} (latest ${entry.latestYear})` : text;

const mentorsLine = (entry: UndergradListEvidence): string | null => {
  const role = MENTOR_ROSTER_ROLES[entry.source];
  if (role) return entry.latestYear ? `${role} (${entry.latestYear})` : role;
  const work = MENTORED_WORK[entry.source];
  if (!work) return null;
  const counted = entry.count && entry.count > 0 ? entry.count : undefined;
  const text = counted
    ? `Advised ${counted} ${counted === 1 ? work.one : work.many}`
    : `Advised ${work.many}`;
  return withLatestYear(text, entry);
};

/** Evidence lines for the hosted, welcomes and mentors lists a row is named on, each linked to its list. */
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
          : entry.signal === 'mentors'
            ? mentorsLine(entry)
            : null;
    return text ? [{ text, href }] : [];
  });

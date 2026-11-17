import type { ResearchPageTextEntry } from './utils/researchPageText';

export type StatedDepartureKind = 'announced' | 'completed';

export interface StatedLabDeparture {
  kind: StatedDepartureKind;
  quote: string;
  url: string;
  statedDate?: string;
}

const MAX_QUOTE_CHARS = 300;

const NAME_WORD = String.raw`\p{Lu}[\p{Ll}'.-]+`;

const LAB_NOUN = String.raw`(?:[Ll]ab|[Ll]aboratory|[Rr]esearch\s+[Gg]roup|[Gg]roup|[Tt]eam)`;

const COLLECTIVE_SUBJECT = String.raw`(?:(?:[Tt]he|[Oo]ur|[Tt]his|[Mm]y)\s+${LAB_NOUN}|[Ww]e)`;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Who the sentence must be about: the lab as a whole, or a person named by one of the row's
 * own lead surnames. A bare name or title is not enough, because pages name former students
 * and postdocs who have moved on far more often than they name their own lead's move.
 */
function labSubject(leadSurnames: readonly string[]): string {
  const surnames = leadSurnames.map((name) => name.trim()).filter((name) => name.length >= 2);
  if (surnames.length === 0) return COLLECTIVE_SUBJECT;
  const named = surnames.map(escapeRegExp).join('|');
  const lead = String.raw`(?:(?:[Pp]rofessor|[Pp]rof\.|[Dd]r\.)\s+)?(?:${NAME_WORD}\s+){0,2}(?:${named})(?:'s)?(?:\s+${LAB_NOUN})?`;
  return String.raw`(?:${COLLECTIVE_SUBJECT}|${lead})`;
}

const INSTITUTION_WORD =
  /\b(?:university|universit[äé]t?|universidad|université|institute|institut|college|school|hospital|medical\s+center|cancer\s+center|research\s+center|laboratories|ETH|MIT|Caltech|NIH|UCLA|UCSF)\b/iu;

function departurePatterns(subject: string): Array<[StatedDepartureKind, RegExp]> {
  const flags = 'u';
  return [
    [
      'completed',
      new RegExp(
        String.raw`\b${subject}\s+(?:has|have)\s+(?:now\s+)?(?:moved|relocated)\s+to\b`,
        flags,
      ),
    ],
    [
      'completed',
      new RegExp(String.raw`\b${subject}\s+(?:has\s+|have\s+)?(?:left|departed)\s+Yale\b`, flags),
    ],
    [
      'completed',
      new RegExp(
        String.raw`\b${subject}\s+(?:is|are)\s+now\s+(?:located\s+|based\s+|housed\s+)?at\b`,
        flags,
      ),
    ],
    [
      'announced',
      new RegExp(
        String.raw`\b${subject}\s+(?:is|are|will\s+be)\s+(?:moving|relocating)\s+to\b`,
        flags,
      ),
    ],
    [
      'announced',
      new RegExp(
        String.raw`\b${subject}\s+will\s+(?:be\s+)?(?:join(?:ing)?|mov(?:e|ing))\b`,
        flags,
      ),
    ],
  ];
}

const CAREER_HISTORY =
  /\b(?:before|prior\s+to|previously|after\s+(?:completing|earning|receiving|finishing))\b[^.]{0,60}\b(?:moving|moved|joining|joined|coming|came)\b/i;

const NON_LEAD_BEFORE_SUBJECT =
  /\b(?:former|alumn[ia]e?|graduate|students?|postdocs?|post-?doctoral|trainees?|members?|fellows?|staff|technicians?|mentees?|instruments?|microscopes?|equipment|core|facility|scanner|website|site|page)\b[^.]{0,60}$/i;

const FIGURE_OF_SPEECH =
  /\b(?:research|work|field|science|focus|interests?)\s+(?:is|are|has|have)\s+(?:moving|moved|shifting|shifted)\b/i;

const SITE_MOVED = /\b(?:this|our)\s+(?:site|website|web\s*site|page)\s+(?:has\s+)?moved\b/i;

/**
 * A Yale page names its own units without saying "Yale", so a move into one is a move within
 * Yale: a destination that is a bare unit ("the School of Public Health") or a Yale-only unit
 * name never reads as leaving.
 */
const NAMES_YALE_SIDE = /\b(?:yale|new\s+haven|wu\s+tsai|smilow|west\s+campus)\b/iu;
const BARE_UNIT_DESTINATION =
  /^\s*(?:the\s+)?(?:school|college|department|division|institute|center|centre|program|hospital)\s+(?:of|for)\b(?!.*\bat\b)/iu;

function namesExternalInstitution(destination: string): boolean {
  return (
    INSTITUTION_WORD.test(destination) &&
    !NAMES_YALE_SIDE.test(destination) &&
    !BARE_UNIT_DESTINATION.test(destination)
  );
}

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const STATED_DATE = new RegExp(
  String.raw`\b(?:${MONTH}\.?\s+(?:\d{1,2},?\s+)?(?:19|20)\d{2}|(?:spring|summer|fall|autumn|winter)\s+(?:of\s+)?(?:19|20)\d{2}|(?:this|next)\s+(?:spring|summer|fall|autumn|winter|year)|(?:19|20)\d{2})\b`,
  'i',
);

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(
      /(?<!\b(?:Dr|Prof|Mr|Mrs|Ms|St|Jr|Sr|vs|al|Inc|Dept|e\.g|i\.e)\.)(?<=[.!?])\s+(?=[A-Z"'(])/,
    )
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

const DESTINATION_CLAUSE_END =
  /\b(?:where|after|since|following|while|but|although|thanks|formerly|previously|from)\b|[;:]|\((?=\s*(?:formerly|previously|from|prior)\b)/iu;

/**
 * Only the clause naming where the lab went: a later clause can mention Yale collaborators, and
 * a "formerly at" or "from" phrase names the institution the lab came from, not where it went.
 * A plain parenthetical stays in, because it often spells out the destination.
 */
function destinationClause(rest: string): string {
  const end = rest.search(DESTINATION_CLAUSE_END);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function isExcludedShape(sentence: string): boolean {
  return (
    CAREER_HISTORY.test(sentence) || FIGURE_OF_SPEECH.test(sentence) || SITE_MOVED.test(sentence)
  );
}

function matchKind(
  sentence: string,
  patterns: ReadonlyArray<[StatedDepartureKind, RegExp]>,
): StatedDepartureKind | undefined {
  for (const [kind, pattern] of patterns) {
    const match = pattern.exec(sentence);
    if (!match) continue;
    if (NON_LEAD_BEFORE_SUBJECT.test(sentence.slice(0, match.index))) continue;
    if (/\b(?:left|departed)\s+yale\b/iu.test(match[0])) return kind;
    const destination = destinationClause(sentence.slice(match.index + match[0].length));
    if (namesExternalInstitution(destination)) return kind;
  }
  return undefined;
}

/**
 * The departures a research row's own page states about its lab or lead (#6324): a completed
 * move away from Yale in the past or present tense, or an announced one. A sentence about a
 * career before Yale, a move to Yale, a lab member, an instrument, the website, or the research
 * itself states nothing about the lab, and a page that says nothing yields nothing, so silence
 * is never read as evidence.
 */
export function statedLabDeparturesInPageText(
  pages: readonly ResearchPageTextEntry[] | null | undefined,
  options: { leadSurnames?: readonly string[] } = {},
): StatedLabDeparture[] {
  const patterns = departurePatterns(labSubject(options.leadSurnames ?? []));
  const found: StatedLabDeparture[] = [];
  for (const page of pages ?? []) {
    for (const sentence of sentencesOf(String(page?.text ?? ''))) {
      if (isExcludedShape(sentence)) continue;
      const kind = matchKind(sentence, patterns);
      if (!kind) continue;
      const statedDate = STATED_DATE.exec(sentence)?.[0];
      found.push({
        kind,
        quote: sentence.slice(0, MAX_QUOTE_CHARS),
        url: String(page?.url ?? ''),
        ...(statedDate ? { statedDate } : {}),
      });
    }
  }
  return found;
}

export interface StatedDepartureRead {
  runId: string;
  pages: readonly ResearchPageTextEntry[];
}

export interface StatedLabDepartureVerdict {
  departed: boolean;
  completedRuns: number;
  signal?: StatedLabDeparture;
}

export const STATED_DEPARTURE_MIN_COMPLETED_RUNS = 2;

/**
 * Whether a row's own page establishes that its lab has left Yale (#6324). Only a completed
 * statement read in two distinct runs counts, and any current Yale appointment on a lead,
 * emeritus included, keeps the row: a stale page that re-reads the same text is weak evidence,
 * and the Yale side outranks it. An announcement never hides a row; it is returned as the
 * dated signal an operator reviews.
 */
export function statedLabDepartureVerdict(input: {
  reads: readonly StatedDepartureRead[];
  leadSurnames: readonly string[];
  leadsHoldYaleAppointment: boolean;
}): StatedLabDepartureVerdict {
  const completedRunIds = new Set<string>();
  let signal: StatedLabDeparture | undefined;
  for (const read of input.reads) {
    const departures = statedLabDeparturesInPageText(read.pages, {
      leadSurnames: input.leadSurnames,
    });
    if (departures.some((departure) => departure.kind === 'completed')) {
      completedRunIds.add(read.runId);
    }
    signal ??= departures[0];
  }
  const completedRuns = completedRunIds.size;
  const departed =
    !input.leadsHoldYaleAppointment && completedRuns >= STATED_DEPARTURE_MIN_COMPLETED_RUNS;
  return { departed, completedRuns, ...(signal ? { signal } : {}) };
}

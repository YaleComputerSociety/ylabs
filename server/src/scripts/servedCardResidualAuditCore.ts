/**
 * Sizing instrument for the copy defects the 2026-08-31 hand-read of 100
 * `student_ready` cards left behind (#2299).
 *
 * The hand-read classified copy a human had read. Closing it needs the opposite:
 * four residual classes, each detectable without a model, counted over the whole
 * served corpus so a later reader can re-run the number instead of re-reading the
 * sample. Every class here was observed on the re-read of that sample.
 *
 * The rows must come from `getResearchGroupDetail`, never from stored fields. The
 * route resolves the roster and then builds the representation the DTO comes
 * from, and three sanitizer passes run only inside it, so a projection that skips
 * the route reports copy that hundreds of served rows do not have (#2591).
 */
export const SERVED_CARD_RESIDUAL_CLASSES = [
  'empty_card',
  'self_reference_phrase',
  'stale_chip_card',
  'glued_sentence_boundary',
] as const;

export type ServedCardResidualClass = (typeof SERVED_CARD_RESIDUAL_CLASSES)[number];

export interface ServedCardResidualRow {
  slug: string;
  shortDescription: string;
  fullDescription: string;
  researchAreas: string[];
}

/**
 * Deliberately widened variants of each class, reported alongside it. A zero here
 * is usually an instrument error rather than a clean corpus, so each detector
 * carries a control that must be larger: the self-reference phrase against any
 * mention of "research", the glued boundary against any sentence boundary, the
 * stale chip card against every card shaped like the chip template.
 */
export interface ServedCardResidualControls {
  anyResearchMention: number;
  anySentenceBoundary: number;
  chipTemplateShapedCards: number;
}

export interface ServedCardResidualAudit {
  servedRows: number;
  chipShapedCards: number;
  counts: Record<ServedCardResidualClass, number>;
  slugs: Record<ServedCardResidualClass, string[]>;
  controls: ServedCardResidualControls;
  examples: Record<ServedCardResidualClass, string[]>;
}

const CHIP_CARD_TEMPLATE_PATTERN = /^Studies\s+(.+)\.$/i;

/**
 * Tokens that legitimately end in a period mid-sentence, so `al.Smith` is a real
 * glue defect while `et al.Smith` is not worth distinguishing from `et al. Smith`.
 */
const SENTENCE_INTERNAL_ABBREVIATIONS = new Set([
  'al',
  'cf',
  'ed',
  'eds',
  'eg',
  'etc',
  'ie',
  'no',
  'pp',
  'vol',
  'vs',
]);

const GLUED_SENTENCE_BOUNDARY_PATTERN = /([A-Za-z]{2,})\.([A-Z][a-z])/g;

/**
 * A word that a chip name does not contain. Chip names are noun phrases, so a
 * function word means the text is prose rather than a chip list, and prose that
 * merely opens with the template verb is the false positive that matters here: a
 * first pass counted 201 rows of which every sampled one read like
 * "Studies DNA repair and BRCA-related gene function as it relates to gamete
 * aging", which is a sentence, not a chip list.
 */
const PROSE_FUNCTION_WORDS = new Set([
  'a',
  'an',
  'as',
  'at',
  'by',
  'for',
  'from',
  'how',
  'in',
  'including',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'that',
  'the',
  'their',
  'to',
  'using',
  'which',
  'with',
  'within',
]);

const CHIP_NAME_MAX_WORDS = 5;

/**
 * Whether a fragment of the card's list could be a chip name. Requires an
 * initial capital, a short noun phrase, and no function word.
 */
export function readsLikeAChipName(fragment: string): boolean {
  const trimmed = fragment.trim();
  if (!trimmed || !/^[A-Z0-9]/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > CHIP_NAME_MAX_WORDS) return false;
  return !words.some((word) =>
    PROSE_FUNCTION_WORDS.has(word.replace(/[^A-Za-z]/g, '').toLowerCase()),
  );
}

export interface ChipCardTemplateReading {
  servedChips: string[];
  unservedItems: string[];
}

/**
 * Split the card's list against the row's own served chips, longest served chip
 * first. A delimiter split alone cannot do this: chip names contain both commas
 * ("Genes, BRCA1") and conjunctions ("Neural dynamics and brain function"), so
 * splitting on punctuation shreds a chip that is in fact still served and reports
 * it missing.
 */
export function readChipCardTemplate(
  shortDescription: string,
  researchAreas: string[],
): ChipCardTemplateReading | null {
  const match = CHIP_CARD_TEMPLATE_PATTERN.exec(shortDescription.trim());
  if (!match) return null;
  const chipsByLengthDescending = [...researchAreas]
    .map((area) => area.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  const servedChips: string[] = [];
  const unservedItems: string[] = [];
  let rest = match[1].trim();
  while (rest) {
    const chip = chipsByLengthDescending.find((candidate) =>
      rest.toLowerCase().startsWith(candidate.toLowerCase()),
    );
    if (chip) {
      servedChips.push(chip);
      rest = rest.slice(chip.length);
    } else {
      const delimiter = /,\s*and\s+|,\s*|\s+and\s+/.exec(rest);
      const item = delimiter ? rest.slice(0, delimiter.index) : rest;
      if (item.trim()) unservedItems.push(item.trim());
      rest = delimiter ? rest.slice(delimiter.index) : '';
    }
    rest = rest.replace(/^(?:,\s*and\s+|,\s*|\s+and\s+)/, '');
  }
  return { servedChips, unservedItems };
}

export function chipCardTemplateItems(shortDescription: string): string[] {
  const match = CHIP_CARD_TEMPLATE_PATTERN.exec(shortDescription.trim());
  if (!match) return [];
  return match[1]
    .split(/,\s*and\s+|,\s*|\s+and\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * A card built from the chip template that names at least one chip the row still
 * carries and at least one it no longer does, where every named item reads like a
 * chip name rather than prose.
 *
 * Both halves are deliberately conservative, so the count is a floor. A card whose
 * every chip was dropped is missed, because nothing then distinguishes it from
 * prose. So is a card one of whose dropped chips happened to contain a function
 * word.
 */
export function servedCardNamesDroppedChip(row: ServedCardResidualRow): boolean {
  const reading = readChipCardTemplate(row.shortDescription, row.researchAreas);
  if (!reading) return false;
  if (!reading.servedChips.length || !reading.unservedItems.length) return false;
  return reading.unservedItems.every(readsLikeAChipName);
}

export function firstGluedSentenceBoundary(fullDescription: string): RegExpMatchArray | null {
  for (const match of fullDescription.matchAll(GLUED_SENTENCE_BOUNDARY_PATTERN)) {
    if (!SENTENCE_INTERNAL_ABBREVIATIONS.has(match[1].toLowerCase())) return match;
  }
  return null;
}

export function servedBodyGluesASentenceBoundary(fullDescription: string): boolean {
  return firstGluedSentenceBoundary(fullDescription) !== null;
}

export function servedCopyLeaksTheSelfReferenceNoun(row: ServedCardResidualRow): boolean {
  return /research profile/i.test(`${row.shortDescription} ${row.fullDescription}`);
}

export function servedCardResidualClasses(row: ServedCardResidualRow): ServedCardResidualClass[] {
  const found: ServedCardResidualClass[] = [];
  if (!row.shortDescription.trim()) found.push('empty_card');
  if (servedCopyLeaksTheSelfReferenceNoun(row)) found.push('self_reference_phrase');
  if (servedCardNamesDroppedChip(row)) found.push('stale_chip_card');
  if (servedBodyGluesASentenceBoundary(row.fullDescription)) found.push('glued_sentence_boundary');
  return found;
}

const EXAMPLES_PER_CLASS = 8;

/**
 * A window around the match, never the head of the field. The first version
 * printed the first 200 characters of the body, which for two of the four classes
 * showed text that does not contain the match at all, so an example could not be
 * used to check the detector.
 */
function windowAround(haystack: string, match: RegExpMatchArray | null, radius = 90): string {
  if (!match || match.index === undefined) return haystack.slice(0, radius * 2);
  const start = Math.max(0, match.index - radius);
  return `...${haystack.slice(start, match.index + match[0].length + radius)}...`;
}

const classExample = (
  residualClass: ServedCardResidualClass,
  row: ServedCardResidualRow,
): string => {
  if (residualClass === 'glued_sentence_boundary') {
    return windowAround(row.fullDescription, firstGluedSentenceBoundary(row.fullDescription));
  }
  if (residualClass === 'stale_chip_card') {
    const reading = readChipCardTemplate(row.shortDescription, row.researchAreas);
    return `${row.shortDescription} || still served: [${reading?.servedChips.join(' | ')}] || named but gone: [${reading?.unservedItems.join(' | ')}]`;
  }
  if (residualClass === 'empty_card') return `(empty card) ${row.fullDescription.slice(0, 180)}`;
  const copy = `${row.shortDescription} ${row.fullDescription}`;
  return windowAround(copy, /research profile/i.exec(copy));
};

export function buildServedCardResidualAudit(
  rows: ServedCardResidualRow[],
): ServedCardResidualAudit {
  const counts = Object.fromEntries(
    SERVED_CARD_RESIDUAL_CLASSES.map((entry) => [entry, 0]),
  ) as Record<ServedCardResidualClass, number>;
  const slugs = Object.fromEntries(
    SERVED_CARD_RESIDUAL_CLASSES.map((entry) => [entry, [] as string[]]),
  ) as Record<ServedCardResidualClass, string[]>;
  const examples = Object.fromEntries(
    SERVED_CARD_RESIDUAL_CLASSES.map((entry) => [entry, [] as string[]]),
  ) as Record<ServedCardResidualClass, string[]>;
  const controls: ServedCardResidualControls = {
    anyResearchMention: 0,
    anySentenceBoundary: 0,
    chipTemplateShapedCards: 0,
  };

  let chipShapedCards = 0;
  for (const row of rows) {
    const chipItems = chipCardTemplateItems(row.shortDescription);
    if (chipItems.length) {
      chipShapedCards += 1;
      controls.chipTemplateShapedCards += 1;
    }
    if (/research/i.test(`${row.shortDescription} ${row.fullDescription}`)) {
      controls.anyResearchMention += 1;
    }
    if (/[A-Za-z]{2,}\.\s*[A-Z][a-z]/.test(row.fullDescription)) controls.anySentenceBoundary += 1;
    for (const found of servedCardResidualClasses(row)) {
      counts[found] += 1;
      slugs[found].push(row.slug);
      if (examples[found].length < EXAMPLES_PER_CLASS) {
        examples[found].push(classExample(found, row));
      }
    }
  }

  return { servedRows: rows.length, chipShapedCards, counts, slugs, controls, examples };
}

export function assertServedCardResidualAuditConsistent(audit: ServedCardResidualAudit): void {
  if (audit.servedRows <= 0) {
    throw new Error(
      'no served row reached the audit. Treat this as a broken route or a broken audit, not as a clean corpus.',
    );
  }
  for (const entry of SERVED_CARD_RESIDUAL_CLASSES) {
    if (audit.counts[entry] !== audit.slugs[entry].length) {
      throw new Error(`${entry} count ${audit.counts[entry]} disagrees with its slug list`);
    }
    if (audit.counts[entry] > audit.servedRows) {
      throw new Error(`${entry} counts ${audit.counts[entry]} of ${audit.servedRows} served rows`);
    }
  }
  if (audit.chipShapedCards > audit.servedRows) {
    throw new Error('more chip-shaped cards than served rows');
  }
  if (audit.counts.stale_chip_card > audit.chipShapedCards) {
    throw new Error('a stale chip card was counted on a card that is not chip-shaped');
  }
  if (audit.counts.self_reference_phrase > audit.controls.anyResearchMention) {
    throw new Error(
      'more rows leak the self-reference noun than mention research at all, so the control is not wider than the detector',
    );
  }
  if (audit.counts.glued_sentence_boundary > audit.controls.anySentenceBoundary) {
    throw new Error(
      'more rows glue a sentence boundary than have one, so the control is not wider than the detector',
    );
  }
}

export function formatServedCardResidualAudit(audit: ServedCardResidualAudit): string {
  const lines = [
    `served rows                 | ${audit.servedRows}`,
    `chip-template cards         | ${audit.chipShapedCards}`,
  ];
  for (const entry of SERVED_CARD_RESIDUAL_CLASSES) {
    lines.push(`${entry.padEnd(27)} | ${audit.counts[entry]}`);
  }
  lines.push(
    '',
    'widened controls (each must exceed its class, or the detector is broken rather than the corpus clean)',
    `any mention of "research"   | ${audit.controls.anyResearchMention}`,
    `any sentence boundary       | ${audit.controls.anySentenceBoundary}`,
    `chip-template shaped cards  | ${audit.controls.chipTemplateShapedCards}`,
  );
  return lines.join('\n');
}

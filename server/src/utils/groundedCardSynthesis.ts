import axios from 'axios';
import { redactDirectContactInfo } from './contactRedaction';
import { openAiChatSampling } from './openAiChatSampling';
import {
  buildResearchAreasCardSummary,
  deriveProgramCardShortDescription,
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  isReplaceableResearchAreaChipEchoShort,
  isVacuousGenericFocusSummary,
  programCardShortDescriptionQuality,
  shortDescriptionQuality,
} from './researchEntityDescriptionQuality';
import {
  MAX_CARD_SHORT_DESCRIPTION_LENGTH,
  MAX_SHORT_DESCRIPTION_LENGTH,
  isStaleResearchAreaChipEnumeration,
  isStudiesResearchAreaEchoDescription,
  sanitizeResearchEntityShortDescription,
} from './descriptionHygiene';
import { isProgramLikeResearchEntity } from './researchEntityProgramLike';
import { CARD_SYNTHESIS_PROMPT, CARD_SYNTHESIS_PROMPT_HASH } from '../scrapers/prompts';

export const CARD_SYNTHESIS_MODEL = 'gpt-5-mini';
export const MIN_CARD_GROUNDING = 0.9;
export const MAX_CARD_SOURCE_CHARS = 6000;
export const MAX_CARD_NAME_CHARS = 240;

const CARD_SCAFFOLDING_WORDS = new Set([
  'studies',
  'study',
  'investigates',
  'investigate',
  'examines',
  'examine',
  'explores',
  'explore',
  'develops',
  'develop',
  'focuses',
  'focus',
  'focused',
  'advances',
  'advance',
  'uses',
  'employs',
  'employ',
  'analyzes',
  'analyze',
  'analyses',
  'analyse',
  'models',
  'measures',
  'measure',
  'researches',
  'research',
  'seeks',
  'seek',
  'works',
  'work',
  'combines',
  'combine',
  'conducts',
  'conduct',
  'builds',
  'build',
  'designs',
  'design',
  'creates',
  'create',
  'supports',
  'support',
  'fosters',
  'foster',
  'improves',
  'improve',
  'enhances',
  'enhance',
  'using',
  'through',
  'across',
  'between',
  'within',
  'their',
  'these',
  'those',
  'which',
  'that',
  'this',
  'with',
  'from',
  'into',
  'about',
  'understanding',
  'understand',
  'including',
  'include',
  'related',
  'various',
  'toward',
  'towards',
]);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const normalizeForGrounding = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const distinctiveCardTokens = (value: string): string[] =>
  Array.from(
    new Set(
      (value.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])
        .map((token) => token.replace(/-/g, ''))
        .filter((token) => token.length >= 4 && !CARD_SCAFFOLDING_WORDS.has(token)),
    ),
  );

/**
 * The inflected forms of one word collapsed onto the stems it could have come
 * from, so a chip reading "Hormones" can be grounded in a body that says
 * "hormone" (#3050).
 *
 * Inflectional only, and that boundary is the whole safety argument. Plural, third
 * person, past and present participle are the same word in a different grammatical
 * slot, so a match across them is a match on the same topic. A derivational
 * stemmer is a different proposition: mapping "biological" to "biology" or
 * "statistical" to "statistics" would start grounding a chip on a word that means
 * something else, and the hand-read that found 0 wrong pairings out of 128 was
 * carried out over inflectional variants only and does not transfer.
 *
 * Returns a set rather than one stem because restoring a dropped `e` is a guess:
 * "imaging" could come from "imag" or "image", so both are offered and a match on
 * either counts.
 *
 * The length floors exist to stop a short clinical acronym being stemmed into an
 * unrelated common word. `AIDS` would otherwise ground on "aid".
 */
export function inflectionalStems(word: string): Set<string> {
  const lower = word.toLowerCase();
  const stems = new Set<string>([lower]);
  const add = (stem: string): void => {
    if (stem.length >= 3) stems.add(stem);
  };

  if (lower.length >= 5 && lower.endsWith('ies')) add(`${lower.slice(0, -3)}y`);
  if (lower.length >= 6 && /(?:s|x|z|ch|sh)es$/.test(lower)) add(lower.slice(0, -2));
  if (
    lower.length >= 5 &&
    lower.endsWith('s') &&
    !/(?:ss|us|is|as)$/.test(lower) &&
    !lower.endsWith('ies')
  ) {
    add(lower.slice(0, -1));
  }
  if (lower.length >= 7 && lower.endsWith('ing')) {
    add(lower.slice(0, -3));
    add(`${lower.slice(0, -3)}e`);
  }
  if (lower.length >= 6 && lower.endsWith('ed')) {
    add(lower.slice(0, -2));
    add(`${lower.slice(0, -2)}e`);
  }
  return stems;
}

export function sharesAnInflectionalStem(left: string, right: string): boolean {
  const leftStems = inflectionalStems(left);
  for (const stem of inflectionalStems(right)) {
    if (leftStems.has(stem)) return true;
  }
  return false;
}

export function cardGroundingScore(card: unknown, fullDescription: unknown): number {
  const tokens = distinctiveCardTokens(textValue(card));
  if (tokens.length === 0) return 0;
  const source = normalizeForGrounding(textValue(fullDescription)).replace(/\s+/g, '');
  const hits = tokens.filter((token) => source.includes(token)).length;
  return hits / tokens.length;
}

export function isCardGroundedInFullDescription(card: unknown, fullDescription: unknown): boolean {
  const normalizedCard = normalizeForGrounding(textValue(card));
  const normalizedFull = normalizeForGrounding(textValue(fullDescription));
  if (!normalizedCard || !normalizedFull) return false;
  if (normalizedFull.includes(normalizedCard)) return true;
  return cardGroundingScore(card, fullDescription) >= MIN_CARD_GROUNDING;
}

/**
 * The chips a row's own served body supports, in stored order.
 *
 * Every distinctive token of a chip has to appear in the body, which is the same
 * bar `MIN_CARD_GROUNDING` sets for a whole card applied to a phrase short enough
 * that 0.9 and 1.0 are the same test. Strictness is the right direction here: the
 * output is an assertion about what somebody studies, rendered as pills beside the
 * card and indexed as browse facets, so a wrong chip makes the row findable under a
 * topic its own page contradicts.
 *
 * A row with no served body is returned unfiltered. There is nothing to ground
 * against, so filtering would strip the card off every chips-only row, which is a
 * far larger population than the ungrounded one and not what #2972 measured.
 *
 * A token the body does not contain verbatim gets a second chance against the
 * body's words through an inflectional stem, so "Hormones" is grounded by
 * "hormone" (#3050). That arm can only widen the result: it is reached only for a
 * token the verbatim test already rejected, so no chip that grounded before stops
 * grounding now. The verbatim test runs first and keeps its own reach, because it
 * compares against the body with its spaces removed and so grounds a compound chip
 * token like "cellbiology" against a body that says "cell biology", which a
 * word-by-word comparison cannot do.
 */
export function researchAreasGroundedInFullDescription(
  researchAreas: unknown,
  fullDescription: unknown,
): string[] {
  const chips = (Array.isArray(researchAreas) ? researchAreas : []).filter(
    (chip): chip is string => typeof chip === 'string',
  );
  const full = textValue(fullDescription);
  if (!full) return chips;
  const normalizedFull = normalizeForGrounding(full);
  const source = normalizedFull.replace(/\s+/g, '');
  const bodyStems = new Set<string>();
  for (const word of normalizedFull.split(' ')) {
    if (word) for (const stem of inflectionalStems(word)) bodyStems.add(stem);
  }
  const groundedByStem = (token: string): boolean => {
    for (const stem of inflectionalStems(token)) {
      if (bodyStems.has(stem)) return true;
    }
    return false;
  };
  return chips.filter((chip) => {
    const tokens = distinctiveCardTokens(chip);
    if (tokens.length === 0) return false;
    return tokens.every((token) => source.includes(token) || groundedByStem(token));
  });
}

const SYNTHESIS_CARD_LEAD_PATTERN =
  /^(?:Studies|Investigates|Examines|Explores|Develops|Advances|Uses|Employs|Analyzes|Analyses|Models|Measures|Researches|Creates|Builds|Designs|Combines|Conducts|Supports|Fosters|Improves|Enhances|Innovates|Seeks to|Works on|Focuses on|Focused on)\b/i;

/**
 * A stored, synthesized "Studies X." card blurb whose distinctive topic tokens
 * are not grounded in the entity's own fullDescription. Synthesis-time grounding
 * (isCardGroundedInFullDescription) already rejects these, but a card materialized
 * before that guard, or against a fullDescription that later changed, can still be
 * served with a topic that contradicts the description (#1212, e.g. "Studies Texas
 * from the first." on a researcher whose description is about Morocco). Gated on a
 * synthesis-verb lead so a source-derived blurb is never touched, and only fires
 * when the card carries at least one distinctive topic token to judge, so a topic
 * too short to verify is kept rather than dropped.
 *
 * Named arguments, because both roles are `unknown` and the two readings are not
 * symmetric: the `card` side gets a synthesis-verb gate and an all-distinctive-tokens
 * test at `MIN_CARD_GROUNDING`, both of which are sized for one sentence. Positional
 * arguments let `coverageSynthesis` pass a 2-to-4-sentence body as the card and a
 * snippet corpus as the body, which raised that lane's declared 0.45 overlap floor to
 * 0.9 for every body opening with one of those verbs (#3201). Keep this signature
 * named so a caller has to say which value is the card.
 */
export function isUngroundedSynthesizedCard({
  card: cardValue,
  body,
}: {
  card: unknown;
  body: unknown;
}): boolean {
  const card = textValue(cardValue);
  const full = textValue(body);
  if (!card || !full) return false;
  if (!SYNTHESIS_CARD_LEAD_PATTERN.test(card)) return false;
  if (distinctiveCardTokens(card).length === 0) return false;
  return !isCardGroundedInFullDescription(card, full);
}

export interface ResolveServedShortDescriptionInput {
  shortDescription: unknown;
  fullDescription: unknown;
  researchAreas?: unknown;
  entityType?: unknown;
  kind?: unknown;
}

/**
 * What the served-copy resolution produced, with "no card" separated from "no
 * card from here".
 *
 * An empty `card` alone cannot express withholding, because the DTO answers an
 * empty resolution by serving the row's whole body as the card
 * (`servedShortDescriptionFallback`). That is the right answer when the resolver
 * simply had nothing to derive, and the wrong answer when it derived something
 * and refused it: the refusal then becomes a 200-plus-character body in a card
 * slot. `topicCardWithheld` is the third state, and a caller that owns a
 * fallback chain must branch on it rather than on the empty string.
 */
export interface ServedShortDescriptionOutcome {
  card: string;
  topicCardWithheld: boolean;
}

/**
 * The resolved card, collapsing withholding onto the empty string. Callers that
 * own a fallback chain must read `resolveServedShortDescriptionOutcome` instead,
 * so a withheld assertion is not answered with the row's whole body.
 */
export function resolveServedShortDescription(input: ResolveServedShortDescriptionInput): string {
  return resolveServedShortDescriptionOutcome(input).card;
}

/**
 * The single served-copy resolution for shortDescription (#1506): sanitize
 * (dropping a dangling-pronoun opener or artwork-chrome prefix per the
 * hygiene checks above, alongside the existing echo/first-person/synthesis-
 * glue checks), and when nothing survives, derive a fresh short from the
 * entity's own (already-quality-gated, then re-sanitized so a derived
 * pronoun-subject opener is caught too) fullDescription rather than serving
 * an empty card, falling back to a researchAreas summary when no
 * fullDescription-derived short clears quality either. Deliberately does NOT
 * use `isUngroundedSynthesizedCard` or a general topic-grounding check here:
 * a >=0.9 full-text grounding bar is tuned for freshly LLM-synthesized cards
 * and produced dozens of false positives when applied to arbitrary
 * already-served shorts in a live-corpus dry run (e.g. blanking a perfectly
 * good "Studies econometrics, financial economics, ..." because a rambling
 * bio never repeats those exact words); a strict zero-overlap variant avoided
 * that false-positive class but, checked against the full live corpus,
 * caught nothing beyond what the other checks here already catch and still
 * missed the one confirmed wrong-entity graft (`cohen-lab-cohenls`, which
 * shares one incidental token - "physiology" - with its correct
 * cardiovascular full description). A wrong-entity topic graft needs either
 * a semantic check or a much larger tuning corpus than a single PR affords,
 * so `cohen-lab-cohenls` is fixed as a one-off data correction instead.
 * `entityType` is threaded into the derived-candidate quality check only, so
 * the `LAB`/`FACULTY_RESEARCH_AREA` bare topic-label-list guard (#1616) also
 * applies to a candidate synthesized here, not just to an already-stored one.
 * A non-blank `cleaned` short is also swapped for a fresh full-derived one
 * when it is nothing but the entity's own researchArea chips restated as a
 * sentence and a genuinely richer full exists to compress instead (#1680):
 * that short survives #1616's ungrounded-topic gate (it is faithful to the
 * full), but it still wastes the card headline on a redundant re-listing of
 * the chip row already shown beside it.
 *
 * The last resort is a topic-chip summary, and it is withheld rather than served
 * when the row's own body supports no chip (#2972). Withholding is reported on
 * the outcome rather than as an empty card, because the two mean different things
 * to a fallback chain.
 *
 * A stored short that is only the row's own chips restated is read as absent
 * rather than as a card, because that is what every serve surface does with it
 * (#3097). Without that the resolver was the only reader still holding such a
 * card, and since the visibility gate resolves its card verdict here, the gate
 * admitted rows on a headline no surface renders.
 */
export function resolveServedShortDescriptionOutcome(
  input: ResolveServedShortDescriptionInput,
): ServedShortDescriptionOutcome {
  const full = textValue(input.fullDescription);
  const researchAreas = Array.isArray(input.researchAreas) ? input.researchAreas : [];
  const sanitized = sanitizeResearchEntityShortDescription(textValue(input.shortDescription));
  // A stored card that is only the chip row restated is blanked by every serve surface
  // (`sanitizeServedResearchEntityCopyFields`, the search-index projection), so
  // keeping it here made this resolver the one reader that still saw a card. The
  // visibility gate reads this resolver, so 37 Development rows were admitted on a
  // headline no surface renders and reached students as a name with nothing under
  // it (#3097). Treat it as absent, which is what the gate's own hard floor
  // already does (`recordHasNoUsablePublicDescription`, #1547).
  //
  // Both readings of that shape count. A list the chip row still carries whole is the
  // echo; a list naming a chip the row has since lost is a card the chip set moved out
  // from under (#3095), and it is worse than the echo rather than better, because it
  // asserts a topic the pills beside it contradict.
  const cleaned =
    isStudiesResearchAreaEchoDescription(sanitized, researchAreas) ||
    isStaleResearchAreaChipEnumeration(sanitized, researchAreas)
      ? ''
      : sanitized;
  if (cleaned) {
    if (isReplaceableResearchAreaChipEchoShort(cleaned, full, researchAreas, input.entityType)) {
      const derivedFromChipEcho = sanitizeResearchEntityShortDescription(
        deriveShortDescriptionFromFullDescription(full),
      );
      if (
        derivedFromChipEcho &&
        shortDescriptionQuality(derivedFromChipEcho, full, researchAreas, {
          entityType: input.entityType,
        }).isUseful
      ) {
        return { card: derivedFromChipEcho, topicCardWithheld: false };
      }
    }
    // A truncation artifact must never be served: the card gate rejects a
    // trailing ellipsis as a fragment, so serving one blocks the entity on copy
    // it is simultaneously being shown. Fall through to the quality-checked
    // derivations instead. Scoped to this artifact deliberately - a broad
    // quality check here would also drop fluent stored card lines the card bar
    // intentionally keeps (#1680/#2184).
    if (
      !/(?:\.{3}|…)\s*$/.test(cleaned) &&
      storedShortPastRenderingPreferenceIsServable({
        shortDescription: cleaned,
        fullDescription: full,
        researchAreas,
        entityType: input.entityType,
        kind: input.kind,
      })
    ) {
      const substitute = gateAcceptedDerivedCardSubstitute({
        shortDescription: cleaned,
        fullDescription: full,
        researchAreas,
        entityType: input.entityType,
        kind: input.kind,
      });
      return { card: substitute || cleaned, topicCardWithheld: false };
    }
  }

  const derived = sanitizeResearchEntityShortDescription(
    deriveShortDescriptionFromFullDescription(full),
  );
  if (
    derived &&
    shortDescriptionQuality(derived, full, researchAreas, { entityType: input.entityType }).isUseful
  ) {
    return { card: derived, topicCardWithheld: false };
  }

  // The one card line this resolver manufactures itself, and until #2972 the one it
  // applied no grounding check to. The recorded reason for exempting a STORED short
  // from `isUngroundedSynthesizedCard` is a false-positive class on source-derived
  // prose, and that reason does not reach a bare chip list: there is no prose here to
  // misjudge. Chips are filtered to the ones the row's own body supports rather than
  // taking the first four in stored order, because a MeSH-sourced row stores them
  // alphabetically, which made the headline an alphabetical accident.
  // When the body supports no chip the assertion is withheld rather than taken in
  // stored order, and `topicCardWithheld` is what makes that reachable: an empty
  // `card` alone sends the DTO to the body, which is a worse card and contradicts
  // #2299's anchor. A row with no body to ground against keeps every chip
  // (`researchAreasGroundedInFullDescription` returns them unfiltered), so the two
  // summaries agree there and nothing is withheld.
  const groundedAreas = researchAreasGroundedInFullDescription(researchAreas, full);
  const groundedSummary = buildResearchAreasCardSummary(groundedAreas);
  if (groundedSummary) return { card: groundedSummary, topicCardWithheld: false };
  // Nothing was refused when the stored-order summary is empty too: the row has no
  // carding chips at all, and the caller's own fallback is still the right answer.
  const storedOrderSummary = buildResearchAreasCardSummary(researchAreas);
  return { card: '', topicCardWithheld: Boolean(storedOrderSummary) };
}

/**
 * Whether a stored card line that sits past the 200-character rendering
 * preference may be served as-is.
 *
 * It only reaches this question because keeping it whole beat dropping it
 * (#1878), and what it displaced is the quality-checked derivation and chip
 * summary above. So this one band is quality-checked where a line inside the
 * preference deliberately is not: without the check, four Development rows that
 * had been serving a passing chip summary were newly held on their own failing
 * sentence, which trades visibility for candour rather than gaining anything. A
 * line inside the preference is untouched, so this cannot drop copy the card bar
 * intentionally keeps (#1680/#2184).
 *
 * The bar must be the same one the visibility gate will judge the served card
 * with, which for a `kind: 'program'` row is `programCardShortDescriptionQuality`
 * - a different set of flags, not a subset. Asking the lab bar about a program
 * row both admitted lines the gate then held on and refused lines it would have
 * accepted. `kind` rather than `entityType` decides, because `INITIATIVE` covers
 * `program`, `initiative` and `group` alike and so cannot recover the marker
 * `isProgramLikeResearchEntity` reads.
 *
 * Exported because the DTO card field and the gate must agree on one value: the
 * card and blurb read `sanitizeResearchEntityShortDescription` directly and
 * never this resolver, so a guard applied only here would let the list serve a
 * failing line while the gate cleared the row on the chip summary it never sees.
 */
export function storedShortPastRenderingPreferenceIsServable(input: ServedCardBarInput): boolean {
  if (textValue(input.shortDescription).length <= MAX_SHORT_DESCRIPTION_LENGTH) return true;
  return servedCardClearsGateBar(input);
}

export interface ServedCardBarInput {
  shortDescription: unknown;
  fullDescription: unknown;
  researchAreas?: unknown;
  entityType?: unknown;
  kind?: unknown;
}

/**
 * Whether a candidate card line clears the same bar the visibility gate will
 * judge the served card with. `kind` decides which bar, for the reason recorded
 * on `storedShortPastRenderingPreferenceIsServable` above.
 */
export function servedCardClearsGateBar(input: ServedCardBarInput): boolean {
  const candidate = textValue(input.shortDescription);
  const full = textValue(input.fullDescription);
  if (isProgramLikeResearchEntity({ kind: input.kind })) {
    return programCardShortDescriptionQuality(candidate, full).isUseful;
  }
  const researchAreas = Array.isArray(input.researchAreas) ? input.researchAreas : [];
  return shortDescriptionQuality(candidate, full, researchAreas, {
    entityType: input.entityType,
  }).isUseful;
}

/**
 * A card line derived from the row's own body that the gate accepts, for a row
 * whose stored card line the gate refuses. Empty when the stored line already
 * clears the bar, or when the body yields nothing better.
 *
 * A stored line inside the 200-character rendering preference is served without
 * a quality check on purpose (#1680/#2184): checking it broadly would drop
 * fluent card lines to nothing, which is strictly worse than a line that merely
 * scores badly. That reason does not reach a substitution, because this never
 * returns empty-for-non-empty and never replaces a line the gate would have
 * accepted. Without it the gate holds a row on `missing_card_description` while
 * a passing sentence from the same body sits unused, which is the residue #1878
 * measured after the card-length fix (#2967) landed: 6 rows corpus-wide on
 * Development, none of them already `student_ready`.
 *
 * Both serving paths call this, for the same reason both call the servable check
 * above: the DTO card field resolves its own line, so substituting in only one
 * place would clear a row on copy the other never serves.
 */
export function gateAcceptedDerivedCardSubstitute(input: ServedCardBarInput): string {
  const cleaned = textValue(input.shortDescription);
  if (!cleaned) return '';
  if (servedCardClearsGateBar(input)) return '';
  const full = textValue(input.fullDescription);
  const derived = sanitizeResearchEntityShortDescription(
    deriveShortDescriptionFromFullDescription(full),
  );
  if (!derived || derived === cleaned) return '';
  return servedCardClearsGateBar({ ...input, shortDescription: derived }) ? derived : '';
}

function firstSentence(value: string): string {
  const match = value.match(/^[^.!?]+[.!?]/);
  return match ? match[0].trim() : value;
}

export function normalizeCardText(value: unknown): string {
  let text = textValue(value)
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();
  if (!text) return '';
  if (
    text.length > MAX_CARD_SHORT_DESCRIPTION_LENGTH ||
    (text.match(/[.!?](?:\s|$)/g) || []).length > 1
  ) {
    text = firstSentence(text);
  }
  text = text.replace(/[.;:,\s]+$/g, '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export interface CardSynthesisLLMInput {
  model: string;
  apiKey: string;
  fullDescription: string;
  entityName: string;
}

export type CardSynthesisLLMFn = (input: CardSynthesisLLMInput) => Promise<string>;

// The prompt text lives in server/src/scrapers/prompts/cardSynthesis.md and the
// content-hash gate keys on CARD_SYNTHESIS_PROMPT_HASH (sha256 of that file), so
// editing the .md re-synthesizes gated entities with no manual version bump.
export const CARD_SYNTHESIS_SYSTEM_PROMPT = CARD_SYNTHESIS_PROMPT;
export { CARD_SYNTHESIS_PROMPT_HASH };

export const defaultCardSynthesisLLM: CardSynthesisLLMFn = async (input) => {
  const safeName = redactDirectContactInfo(input.entityName).slice(0, MAX_CARD_NAME_CHARS);
  const safeSource = redactDirectContactInfo(input.fullDescription).slice(0, MAX_CARD_SOURCE_CHARS);
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: input.model,
      response_format: { type: 'json_object' },
      ...openAiChatSampling(input.model),
      messages: [
        { role: 'system', content: CARD_SYNTHESIS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Research entity: ${safeName}`,
            'Return JSON {"shortDescription": "..."} with a single card sentence, or {"shortDescription": ""} when the description has no clear research focus.',
            'DESCRIPTION:',
            safeSource,
          ].join('\n\n'),
        },
      ],
    },
    {
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') return '';
  const parsed = JSON.parse(content) as { shortDescription?: unknown };
  return textValue(parsed.shortDescription);
};

export interface SynthesizeGroundedCardInput {
  fullDescription: unknown;
  entityName?: string;
  researchAreas?: unknown;
  entityType?: unknown;
  callLLM: (input: { fullDescription: string; entityName: string }) => Promise<string>;
}

export async function synthesizeGroundedCardDescription(
  input: SynthesizeGroundedCardInput,
): Promise<string> {
  const full = textValue(input.fullDescription);
  if (!full) return '';
  const fullQuality = fullDescriptionQuality(full);
  const onlyFirstPersonFull =
    fullQuality.flags.length === 1 && fullQuality.flags.includes('first-person');
  if (!fullQuality.isUseful && !onlyFirstPersonFull) return '';

  let raw: string;
  try {
    raw = await input.callLLM({ fullDescription: full, entityName: input.entityName || '' });
  } catch {
    return '';
  }
  const card = normalizeCardText(raw);
  if (!card) return '';
  if (!isCardGroundedInFullDescription(card, full)) return '';
  return shortDescriptionQuality(card, full, input.researchAreas, { entityType: input.entityType })
    .isUseful
    ? card
    : '';
}

export interface ResolveGroundedCardInput {
  fullDescription: unknown;
  researchAreas?: unknown;
  entityType?: unknown;
  isProgramLike?: boolean;
  synthesize?: (fullDescription: string) => Promise<string>;
  /**
   * A caller's refusal on the OUTPUT, applied to every arm and terminal when every
   * arm is refused.
   *
   * It exists because a caller that is REPLACING a card has a bar the quality check
   * cannot express. A lane rewriting a career-biography card must not accept a line
   * that is itself a career biography, and the deterministic derivation clears the
   * quality bar routinely while being exactly that: the bar scores card shape and
   * grounding, not whether the sentence is about a career. Without a refusal here
   * the derivation is taken before the synthesizer is ever called, so the LLM arm
   * the caller wanted is unreachable (#3098).
   *
   * Refused arms fall through rather than ending the resolution, so a refusal costs
   * the caller nothing when a later arm is acceptable.
   */
  refuseCandidate?: (candidate: string) => boolean;
}

/**
 * A program (fellowship/RA program) is a funding vehicle, not a researcher, so
 * it cannot itself "Study" a topic - that framing only makes sense for a
 * person or lab. The lab-oriented fallbacks below (`deriveShortDescriptionFromFullDescription`,
 * LLM synthesis, `buildResearchAreasCardSummary`) all default to a "Studies X"
 * lead when they run out of more specific patterns, so on a program-like entity
 * that lead must be rejected rather than served (issue #1555).
 */
const RESEARCHER_VOICE_STUDIES_LEAD_PATTERN = /^Studies\b/i;

function rejectStudiesLeadOnProgramLike(
  candidate: string,
  isProgramLike: boolean | undefined,
): string {
  return isProgramLike && RESEARCHER_VOICE_STUDIES_LEAD_PATTERN.test(candidate) ? '' : candidate;
}

export async function resolveGroundedCardDescription(
  input: ResolveGroundedCardInput,
): Promise<string> {
  if (input.isProgramLike) {
    // A program/fellowship/RA-program offers or funds rather than researches, so
    // the lab-voice "Studies <topic>" fallbacks below - and the LLM synthesizer,
    // whose prompt hardcodes that same researcher-voice - do not apply: they
    // mis-frame the funding vehicle as the one doing the studying (issue #1555).
    // A program with no self-contained offer sentence in its own prose is left
    // with a blank short rather than a mis-framed one.
    return deriveProgramCardShortDescription(input.fullDescription);
  }
  const refused = (candidate: string): boolean =>
    Boolean(candidate) && Boolean(input.refuseCandidate?.(candidate));
  const derived = rejectStudiesLeadOnProgramLike(
    deriveShortDescriptionFromFullDescription(input.fullDescription),
    input.isProgramLike,
  );
  if (
    derived &&
    !refused(derived) &&
    shortDescriptionQuality(derived, input.fullDescription, input.researchAreas, {
      entityType: input.entityType,
    }).isUseful
  ) {
    return derived;
  }
  const full = textValue(input.fullDescription);
  if (input.synthesize && full) {
    const synthesized = rejectStudiesLeadOnProgramLike(
      await input.synthesize(full),
      input.isProgramLike,
    );
    if (
      synthesized &&
      !refused(synthesized) &&
      shortDescriptionQuality(synthesized, full, input.researchAreas, {
        entityType: input.entityType,
      }).isUseful
    ) {
      return synthesized;
    }
  }
  const researchAreasSummary = rejectStudiesLeadOnProgramLike(
    buildResearchAreasCardSummary(input.researchAreas),
    input.isProgramLike,
  );
  if (researchAreasSummary && !refused(researchAreasSummary)) return researchAreasSummary;
  if (derived && isVacuousGenericFocusSummary(derived)) return '';
  return refused(derived) ? '' : derived;
}

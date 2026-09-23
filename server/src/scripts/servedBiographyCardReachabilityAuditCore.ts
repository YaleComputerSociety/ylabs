/**
 * Which existing mechanism can reach a served card that reads as a biography
 * rather than as research (#3098).
 *
 * #2654 measured the population through the served surface: 256 cards on
 * Development are biography-shaped, 225 of them on `student_ready` rows. That
 * issue's conclusion was that ranking evidence cannot reach the class, because on
 * almost every row the biography is the only prose the row holds. Two mechanisms
 * already exist and neither had been pointed at the population, so this instrument
 * splits it by which of them reaches which row.
 *
 * Classification is the repo's own detectors, never a fresh heuristic:
 * `isCareerBiographyDescription` is the selector the synthesis lane keys on, and
 * `isHighConfidencePersonBio` is reported beside it as the widened control the
 * lane's own header warns over-reports about four to one.
 *
 * Reporting both is what settled the size of the class. Over Development's 3,358
 * `student_ready` rows the wide detector reads 218, which is the 225 the issue
 * carries, and the narrow one reads 34; 206 of the 218 are flagged by the bare
 * `Dr./Professor <Name>` arm alone, which is the arm
 * `researchHomeDescriptionSelection` records as firing on name-framed research
 * prose that is already what a student needs. So the wide count is a sizing of the
 * detector rather than of the defect, and the two are reported side by side here so
 * a later reader cannot take one for the other.
 *
 * Reachability is asked of the mechanisms themselves rather than of a transcription
 * of them. `gateAcceptedDerivedCardSubstitute` and `servedCardClearsGateBar` are
 * called here; the synthesis lane's selector is called by the runner, which has the
 * stored projection and resolved leads it needs.
 */
import {
  gateAcceptedDerivedCardSubstitute,
  servedCardClearsGateBar,
} from '../utils/groundedCardSynthesis';
import { deriveShortDescriptionFromFullDescription } from '../utils/researchEntityDescriptionQuality';
import { sanitizeResearchEntityShortDescription } from '../utils/descriptionHygiene';
import { isCareerBiographyDescription } from '../utils/careerBiographyDescription';
import { isHighConfidencePersonBio } from '../utils/researchHomeDescriptionSelection';

/**
 * One served row as `getResearchGroupDetail` rendered it. Every field is the served
 * value, never the stored one: three sanitizer passes and the card resolution run
 * only inside the route (#2591).
 */
export interface ServedBiographyCardRow {
  slug: string;
  shortDescription: string;
  fullDescription: string;
  researchAreas: string[];
  entityType: string;
  kind: string;
}

export const DERIVED_SUBSTITUTE_OUTCOMES = [
  'substitutable',
  'body_yields_nothing',
  'derived_equals_card',
  'derived_fails_gate_bar',
  'derived_still_biography',
] as const;

export type DerivedSubstituteOutcome = (typeof DERIVED_SUBSTITUTE_OUTCOMES)[number];

/**
 * Why the body's own derivation cannot replace a biography-shaped card, or that it
 * can.
 *
 * `substitutable` is deliberately stricter than the gate bar alone. A derived line
 * that is itself biography-shaped clears the bar routinely - the bar scores card
 * shape and grounding, not whether the sentence is about a career - and trading one
 * biography for another is the churn `fraProfileSynthesisLane` fails closed on for
 * the same reason.
 */
export function classifyDerivedCardSubstitute(row: ServedBiographyCardRow): {
  outcome: DerivedSubstituteOutcome;
  derived: string;
} {
  const barInput = {
    shortDescription: row.shortDescription,
    fullDescription: row.fullDescription,
    researchAreas: row.researchAreas,
    entityType: row.entityType || undefined,
    kind: row.kind || undefined,
  };
  const derived = sanitizeResearchEntityShortDescription(
    deriveShortDescriptionFromFullDescription(row.fullDescription),
  );
  if (!derived) return { outcome: 'body_yields_nothing', derived: '' };
  if (derived === row.shortDescription) return { outcome: 'derived_equals_card', derived };
  if (!servedCardClearsGateBar({ ...barInput, shortDescription: derived })) {
    return { outcome: 'derived_fails_gate_bar', derived };
  }
  if (isCareerBiographyDescription(derived) || isHighConfidencePersonBio(derived)) {
    return { outcome: 'derived_still_biography', derived };
  }
  return { outcome: 'substitutable', derived };
}

/**
 * Whether the mechanism as it stands today reaches this row.
 *
 * Expected to be zero over a population read off the served surface, and that is
 * the point rather than an instrument failure: `resolveServedShortDescriptionOutcome`
 * already calls this for every card it serves, so any substitute it would have
 * accepted is already the served card. A non-zero count here would mean the walk
 * and the resolver disagree, which is a finding about the instrument.
 */
export function unwidenedSubstituteReaches(row: ServedBiographyCardRow): boolean {
  return (
    gateAcceptedDerivedCardSubstitute({
      shortDescription: row.shortDescription,
      fullDescription: row.fullDescription,
      researchAreas: row.researchAreas,
      entityType: row.entityType || undefined,
      kind: row.kind || undefined,
    }).length > 0
  );
}

export interface BiographyCardPopulation {
  servedRows: number;
  careerBiographyCards: number;
  personBioCards: number;
  eitherDetector: number;
  bothDetectors: number;
  /**
   * The population by `entityType`, because only `FACULTY_RESEARCH_AREA` is in the
   * synthesis lane's declared cohort and a split that hides the shape of the
   * population lets the lane's reach be read as a ceiling on the whole class.
   */
  byEntityType: Record<string, number>;
  /** The `isCareerBiographyDescription` cohort, which every bucket below is over. */
  slugs: string[];
}

export function buildBiographyCardPopulation(
  rows: readonly ServedBiographyCardRow[],
): BiographyCardPopulation {
  const career = rows.filter((row) => isCareerBiographyDescription(row.shortDescription));
  const person = rows.filter((row) => isHighConfidencePersonBio(row.shortDescription));
  const careerSlugs = new Set(career.map((row) => row.slug));
  const personSlugs = new Set(person.map((row) => row.slug));
  const byEntityType: Record<string, number> = {};
  for (const row of career) {
    const key = row.entityType || 'UNTYPED';
    byEntityType[key] = (byEntityType[key] ?? 0) + 1;
  }
  return {
    servedRows: rows.length,
    careerBiographyCards: career.length,
    personBioCards: person.length,
    eitherDetector: new Set([...careerSlugs, ...personSlugs]).size,
    bothDetectors: [...careerSlugs].filter((slug) => personSlugs.has(slug)).length,
    byEntityType,
    slugs: career.map((row) => row.slug),
  };
}

export interface BiographyCardReachability {
  population: number;
  unwidenedSubstitute: number;
  widenedSubstitute: number;
  substituteOutcomes: Record<DerivedSubstituteOutcome, number>;
  /** Bodies that are themselves biography-shaped, which is the structural driver. */
  biographyShapedBodies: number;
  cardIsBodyDerived: number;
  substitutableSlugs: string[];
  examples: { slug: string; derived: string }[];
}

const MAX_EXAMPLES = 8;

export function buildBiographyCardReachability(
  rows: readonly ServedBiographyCardRow[],
): BiographyCardReachability {
  const population = rows.filter((row) => isCareerBiographyDescription(row.shortDescription));
  const substituteOutcomes = Object.fromEntries(
    DERIVED_SUBSTITUTE_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<DerivedSubstituteOutcome, number>;
  const substitutableSlugs: string[] = [];
  const examples: { slug: string; derived: string }[] = [];
  let unwidened = 0;
  let biographyShapedBodies = 0;
  let cardIsBodyDerived = 0;

  for (const row of population) {
    if (unwidenedSubstituteReaches(row)) unwidened += 1;
    if (isCareerBiographyDescription(row.fullDescription)) biographyShapedBodies += 1;
    const { outcome, derived } = classifyDerivedCardSubstitute(row);
    substituteOutcomes[outcome] += 1;
    if (outcome === 'derived_equals_card') cardIsBodyDerived += 1;
    if (outcome === 'substitutable') {
      substitutableSlugs.push(row.slug);
      if (examples.length < MAX_EXAMPLES) examples.push({ slug: row.slug, derived });
    }
  }

  return {
    population: population.length,
    unwidenedSubstitute: unwidened,
    widenedSubstitute: substituteOutcomes.substitutable,
    substituteOutcomes,
    biographyShapedBodies,
    cardIsBodyDerived,
    substitutableSlugs,
    examples,
  };
}

/**
 * The reported buckets have to sum to the population, because a split that does not
 * is how a residue gets reported as smaller than it is.
 */
export function assertBiographyCardReachabilityConsistent(audit: BiographyCardReachability): void {
  const summed = DERIVED_SUBSTITUTE_OUTCOMES.reduce(
    (total, outcome) => total + audit.substituteOutcomes[outcome],
    0,
  );
  if (summed !== audit.population) {
    throw new Error(
      `derived-substitute outcomes sum to ${summed} but the population is ${audit.population}`,
    );
  }
  if (audit.substitutableSlugs.length !== audit.widenedSubstitute) {
    throw new Error('substitutable slug list disagrees with the substitutable count');
  }
}

export function formatBiographyCardReachability(
  population: BiographyCardPopulation,
  audit: BiographyCardReachability,
  synthesisLaneInScope?: number,
): string {
  const lines = [
    `served student_ready rows            | ${population.servedRows}`,
    `career-biography cards (population)  | ${population.careerBiographyCards}`,
    `person-bio cards (widened control)   | ${population.personBioCards}`,
    `either detector                      | ${population.eitherDetector}`,
    `both detectors                       | ${population.bothDetectors}`,
    ...Object.entries(population.byEntityType)
      .sort((a, b) => b[1] - a[1])
      .map(([entityType, count]) => `  ${entityType.padEnd(36)}| ${count}`),
    '',
    `derived substitute, as it stands      | ${audit.unwidenedSubstitute}`,
    `derived substitute, widened to bios   | ${audit.widenedSubstitute}`,
    ...DERIVED_SUBSTITUTE_OUTCOMES.map(
      (outcome) => `  ${outcome.padEnd(36)}| ${audit.substituteOutcomes[outcome]}`,
    ),
    '',
    `bodies that are biography-shaped too  | ${audit.biographyShapedBodies}`,
  ];
  if (synthesisLaneInScope !== undefined) {
    lines.push(`fra-profile-synthesis lane in scope   | ${synthesisLaneInScope}`);
  }
  return lines.join('\n');
}

import { withoutMeshSourcedNonSubjectResearchAreas } from '../scrapers/utils/meshNonSubjectDescriptors';
import { filterProseResearchAreaChips } from './profileResearchTerms';
import {
  dropDomainIncoherentUnsourcedResearchAreas,
  type ResearchAreaCoherenceContext,
} from './researchAreaDomainCoherence';
import { normalizeResearchAreaList } from './researchAreaHygiene';
import { sanitizeResearchAreaLabel } from './researchAreaLabelHygiene';

export type ServedResearchAreaGuard =
  | 'servedCopyArrayBound'
  | 'servedResearchAreaChipHygiene'
  | 'filterProseResearchAreaChips'
  | 'withoutMeshSourcedNonSubjectResearchAreas'
  | 'dropDomainIncoherentUnsourcedResearchAreas'
  | 'normalizeResearchAreaList'
  | 'publicResearchAreaArray';

export interface WithheldResearchArea {
  area: string;
  guard: ServedResearchAreaGuard;
}

export interface ServedResearchAreaDecision {
  served: string[];
  withheld: WithheldResearchArea[];
}

// `searchIndex` deliberately skips the chip hygiene and the prose-chip filter, and its
// caller passes the indexed copy rather than withheld prose as coherence evidence: the
// index matches and facets on topics but never renders them, and changing its topics is a
// reindex rather than a deploy.
export type ServedResearchAreaSurface = 'servedCopy' | 'searchIndex';

export interface ServedResearchAreaDecisionInput {
  surface: ServedResearchAreaSurface;
  fieldProvenance: unknown;
  coherenceContext: ResearchAreaCoherenceContext;
}

type ResearchAreaStage = (areas: string[]) => string[];

const MAX_SERVED_RESEARCH_AREA_CHIPS = 200;

export function cleanServedResearchAreaChipLabels(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const boundedInput = values
    .slice(0, MAX_SERVED_RESEARCH_AREA_CHIPS)
    .filter((value): value is string => typeof value === 'string');
  for (const raw of normalizeResearchAreaList(boundedInput)) {
    const cleaned = sanitizeResearchAreaLabel(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(cleaned);
  }
  return labels;
}

const areaKey = (area: unknown): string =>
  typeof area === 'string' ? area.trim().toLowerCase() : String(area);

export function startServedResearchAreaDecision(
  areas: readonly unknown[],
): ServedResearchAreaDecision {
  return { served: areas as string[], withheld: [] };
}

// A rewritten topic (a split comma blob, a stripped role suffix) is charged to the stage
// that rewrote it on purpose: that stage is what explains the stored-to-served difference.
export function applyServedResearchAreaStage(
  decision: ServedResearchAreaDecision,
  guard: ServedResearchAreaGuard,
  stage: ResearchAreaStage,
): ServedResearchAreaDecision {
  const served = stage(decision.served);
  const unclaimed = new Map<string, number>();
  for (const area of served) unclaimed.set(areaKey(area), (unclaimed.get(areaKey(area)) ?? 0) + 1);
  const withheld: WithheldResearchArea[] = [];
  for (const area of decision.served) {
    const remaining = unclaimed.get(areaKey(area)) ?? 0;
    if (remaining > 0) unclaimed.set(areaKey(area), remaining - 1);
    else withheld.push({ area: String(area), guard });
  }
  return { served, withheld: [...decision.withheld, ...withheld] };
}

export function unattributedResearchAreaDrops(
  stored: readonly unknown[],
  decision: ServedResearchAreaDecision,
): string[] {
  const served = new Set(decision.served.map(areaKey));
  const withheld = new Set(decision.withheld.map((entry) => entry.area));
  return stored
    .filter((area) => !served.has(areaKey(area)) && !withheld.has(String(area)))
    .map(String);
}

function surfaceStages({
  surface,
  fieldProvenance,
  coherenceContext,
}: ServedResearchAreaDecisionInput): Array<[ServedResearchAreaGuard, ResearchAreaStage]> {
  const withholds: Array<[ServedResearchAreaGuard, ResearchAreaStage]> = [
    [
      'withoutMeshSourcedNonSubjectResearchAreas',
      (areas) => withoutMeshSourcedNonSubjectResearchAreas(areas, fieldProvenance),
    ],
    [
      'dropDomainIncoherentUnsourcedResearchAreas',
      (areas) =>
        dropDomainIncoherentUnsourcedResearchAreas(areas, fieldProvenance, coherenceContext),
    ],
  ];
  if (surface === 'searchIndex') {
    return [...withholds, ['normalizeResearchAreaList', normalizeResearchAreaList]];
  }
  return [
    ['servedResearchAreaChipHygiene', cleanServedResearchAreaChipLabels],
    ['filterProseResearchAreaChips', filterProseResearchAreaChips],
    ...withholds,
  ];
}

// The served copy sanitizer, the search index document, and the journey:eval topic
// attribution case all call this, so a new served topic guard belongs here as a stage
// rather than at one call site, where the harness would report its drops as unexplained.
export function decideServedResearchAreas(
  areas: readonly unknown[],
  input: ServedResearchAreaDecisionInput,
): ServedResearchAreaDecision {
  return surfaceStages(input).reduce(
    (decision, [guard, stage]) => applyServedResearchAreaStage(decision, guard, stage),
    startServedResearchAreaDecision(areas),
  );
}

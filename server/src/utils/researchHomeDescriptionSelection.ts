import {
  describesResearchFocus,
  fullDescriptionQuality,
  type DescriptionQualityFlag,
} from './researchEntityDescriptionQuality';

export type DescriptionEntityKind = 'organization' | 'person';

export interface SelectResearchHomeDescriptionOptions {
  kind?: DescriptionEntityKind;
  minLength?: number;
}

const DEFAULT_MIN_LENGTH = 120;

const TOLERATED_QUALITY_FLAGS = new Set<DescriptionQualityFlag>(['first-person']);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function isDownstreamUsefulDescription(text: string): boolean {
  return fullDescriptionQuality(text).flags.every((flag) => TOLERATED_QUALITY_FLAGS.has(flag));
}

function describesResearchHome(text: string): boolean {
  return isDownstreamUsefulDescription(text) && describesResearchFocus(text);
}

function isPersonCentricLead(text: string): boolean {
  const value = textValue(text);
  if (!value) return false;
  if (/^(?:the|our|this|a|an|in|within|at)\b/i.test(value)) return false;
  if (/^(?:he|she|they)\s/i.test(value)) return true;
  if (/^(?:dr|prof|professor)\.?\s+[A-Z]/.test(value)) return true;
  const lead = value.match(
    /^([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3})(?:['’]s)?\s+(?:is|was|received|earned|holds|joined|serves|completed|studies|investigates|examines|explores|focuses|researches|works|has)\b/u,
  );
  if (
    lead &&
    !/\b(?:Lab|Laboratory|Center|Centre|Institute|Program|Group|Initiative|Project|Department|School|University|College|Yale)\b/.test(
      lead[1],
    )
  ) {
    return true;
  }
  return false;
}

function scoreDescriptionCandidate(text: string, kind: DescriptionEntityKind): number {
  if (kind === 'organization' && isPersonCentricLead(text)) return -100;
  return 0;
}

export function collectDescriptionCandidates(
  values: unknown[],
  minLength = DEFAULT_MIN_LENGTH,
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const value of values) {
    const text = textValue(value);
    if (text.length < minLength) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(text);
  }
  return candidates;
}

export function selectResearchHomeDescription(
  values: unknown[],
  options: SelectResearchHomeDescriptionOptions = {},
): string | null {
  const kind = options.kind ?? 'organization';
  const candidates = collectDescriptionCandidates(values, options.minLength).filter(
    describesResearchHome,
  );
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestScore = scoreDescriptionCandidate(best, kind);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidateScore = scoreDescriptionCandidate(candidate, kind);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}

export interface RelevanceMatchers {
  anyTopicMatches?: string[];
  anyDepartmentMatches?: string[];
  anyTextMatches?: string[];
}

export interface TopicQueryJudgement {
  query: string;
  note?: string;
  topK?: number;
  minRelevant?: number;
  expectNoResults?: boolean;
  relevantWhen?: RelevanceMatchers;
}

export interface TopicQueryJudgementSet {
  queries: TopicQueryJudgement[];
}

export const DEFAULT_TOP_K = 10;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const parseMatchers = (value: unknown, query: string): RelevanceMatchers => {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null)
    throw new Error(`Judgement for "${query}" has a relevantWhen that is not an object`);
  const raw = value as Record<string, unknown>;
  const matchers: RelevanceMatchers = {};
  for (const key of ['anyTopicMatches', 'anyDepartmentMatches', 'anyTextMatches'] as const) {
    const entry = raw[key];
    if (entry === undefined) continue;
    if (!isStringArray(entry))
      throw new Error(`Judgement for "${query}" has a ${key} that is not an array of strings`);
    matchers[key] = entry;
  }
  return matchers;
};

export function parseTopicQueryJudgements(value: unknown): TopicQueryJudgementSet {
  if (typeof value !== 'object' || value === null)
    throw new Error('A judgements file must be a JSON object');
  const queries = (value as Record<string, unknown>).queries;
  if (!Array.isArray(queries)) throw new Error('A judgements file must carry a queries array');

  return {
    queries: queries.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null)
        throw new Error(`Judgement at index ${index} is not an object`);
      const raw = entry as Record<string, unknown>;
      if (typeof raw.query !== 'string' || raw.query.trim().length === 0)
        throw new Error(`Judgement at index ${index} has no query`);
      const query = raw.query;

      const expectNoResults = raw.expectNoResults === true;
      const matchers = parseMatchers(raw.relevantWhen, query);
      const hasMatcher = Object.values(matchers).some(
        (entry) => Array.isArray(entry) && entry.length > 0,
      );
      if (!expectNoResults && !hasMatcher)
        throw new Error(
          `Judgement for "${query}" must either expectNoResults or supply at least one relevantWhen matcher`,
        );

      const topK = raw.topK === undefined ? DEFAULT_TOP_K : Number(raw.topK);
      if (!Number.isInteger(topK) || topK <= 0)
        throw new Error(`Judgement for "${query}" has a topK that is not a positive integer`);

      const minRelevant = raw.minRelevant === undefined ? topK : Number(raw.minRelevant);
      if (!Number.isInteger(minRelevant) || minRelevant < 0 || minRelevant > topK)
        throw new Error(
          `Judgement for "${query}" has a minRelevant outside 0..topK, which can never be satisfied`,
        );

      return {
        query,
        ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
        topK,
        minRelevant,
        ...(expectNoResults ? { expectNoResults } : {}),
        ...(hasMatcher ? { relevantWhen: matchers } : {}),
      };
    }),
  };
}

export const UNDERGRAD_EVIDENCE_VERDICTS = [
  'correct',
  'not_grounded',
  'not_an_undergrad_access_claim',
  'about_another_entity',
  'stale_or_unreachable',
] as const;

export type UndergradEvidenceVerdict = (typeof UNDERGRAD_EVIDENCE_VERDICTS)[number];

export const DEFAULT_UNDERGRAD_EVIDENCE_LANE = 'lab-microsite-undergrad-llm';

export interface UndergradEvidenceJudgement {
  rowKey: string;
  quoteFingerprint: string;
  verdict?: UndergradEvidenceVerdict;
  backsHostedBadgeWording?: boolean;
  note?: string;
  quote?: string;
  sourceUrl?: string;
}

export interface UndergradEvidenceJudgementSet {
  lane: string;
  seed: string;
  sampleSize: number;
  judgements: UndergradEvidenceJudgement[];
}

const isUndergradEvidenceVerdict = (value: unknown): value is UndergradEvidenceVerdict =>
  typeof value === 'string' && (UNDERGRAD_EVIDENCE_VERDICTS as readonly string[]).includes(value);

const optionalString = (raw: Record<string, unknown>, key: string): Record<string, string> =>
  typeof raw[key] === 'string' ? { [key]: raw[key] as string } : {};

export function parseUndergradEvidenceJudgements(value: unknown): UndergradEvidenceJudgementSet {
  if (typeof value !== 'object' || value === null)
    throw new Error('An undergraduate evidence judgements file must be a JSON object');
  const raw = value as Record<string, unknown>;

  if (typeof raw.seed !== 'string' || raw.seed.trim().length === 0)
    throw new Error(
      'An undergraduate evidence judgements file must record the seed it was drawn with',
    );
  const sampleSize = Number(raw.sampleSize);
  if (!Number.isInteger(sampleSize) || sampleSize <= 0)
    throw new Error('An undergraduate evidence judgements file must record a positive sampleSize');
  if (!Array.isArray(raw.judgements))
    throw new Error('An undergraduate evidence judgements file must carry a judgements array');
  const lane =
    typeof raw.lane === 'string' && raw.lane.trim().length > 0
      ? raw.lane
      : DEFAULT_UNDERGRAD_EVIDENCE_LANE;

  const seenRowKeys = new Set<string>();
  const judgements = raw.judgements.map((entry, index): UndergradEvidenceJudgement => {
    if (typeof entry !== 'object' || entry === null)
      throw new Error(`Undergraduate evidence judgement at index ${index} is not an object`);
    const judgement = entry as Record<string, unknown>;
    if (typeof judgement.rowKey !== 'string' || judgement.rowKey.length === 0)
      throw new Error(`Undergraduate evidence judgement at index ${index} has no rowKey`);
    if (seenRowKeys.has(judgement.rowKey))
      throw new Error(`Undergraduate evidence judgement at index ${index} repeats a rowKey`);
    seenRowKeys.add(judgement.rowKey);
    if (typeof judgement.quoteFingerprint !== 'string' || judgement.quoteFingerprint.length === 0)
      throw new Error(
        `Undergraduate evidence judgement at index ${index} has no quoteFingerprint, so a changed quote would inherit a verdict about a different one`,
      );
    if (
      judgement.verdict !== undefined &&
      judgement.verdict !== null &&
      !isUndergradEvidenceVerdict(judgement.verdict)
    )
      throw new Error(
        `Undergraduate evidence judgement at index ${index} has a verdict outside ${UNDERGRAD_EVIDENCE_VERDICTS.join(', ')}`,
      );
    if (
      judgement.backsHostedBadgeWording !== undefined &&
      judgement.backsHostedBadgeWording !== null &&
      typeof judgement.backsHostedBadgeWording !== 'boolean'
    )
      throw new Error(
        `Undergraduate evidence judgement at index ${index} has a backsHostedBadgeWording that is not a boolean`,
      );

    return {
      rowKey: judgement.rowKey,
      quoteFingerprint: judgement.quoteFingerprint,
      ...(isUndergradEvidenceVerdict(judgement.verdict) ? { verdict: judgement.verdict } : {}),
      ...(typeof judgement.backsHostedBadgeWording === 'boolean'
        ? { backsHostedBadgeWording: judgement.backsHostedBadgeWording }
        : {}),
      ...optionalString(judgement, 'note'),
      ...optionalString(judgement, 'quote'),
      ...optionalString(judgement, 'sourceUrl'),
    };
  });

  return { lane, seed: raw.seed, sampleSize, judgements };
}

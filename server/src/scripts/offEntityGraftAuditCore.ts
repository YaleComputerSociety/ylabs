/**
 * Sizing instrument for off-entity graft: a served research entity whose prose
 * describes a different entity, person, or organization (#2272).
 *
 * The deterministic half of the judgement already exists as `judgeResearchSubject`
 * in utils/researchSubjectSpecificity.ts. It is a pure gate over `{subject, scope}`
 * that nothing in production produces, so this module supplies the missing
 * extraction: it asks a model to name the served description's subject and to say
 * whether that subject is this record or a parent organization.
 *
 * Two design points are load-bearing and were both defects in the #2183 harness
 * that wrongly concluded `subjectScope` was ungateable:
 *
 *   1. The record NAME and TYPE must be in the user message. Attribution is
 *      unanswerable from prose alone, because "The Center for Outcomes Research
 *      and Evaluation studies..." is a perfect description of CORE and a graft on
 *      a faculty member's record, and only the record name distinguishes them.
 *   2. `reasoning_effort` must be set explicitly to 'medium'. `openAiChatSampling`
 *      returns 'minimal' for every gpt-5 model because they reject `temperature`,
 *      and at minimal effort the scope judgement moves between runs.
 *
 * Unanimity across repeated runs is the stability contract: a scope verdict is
 * only recorded when every run agrees, so a model that is merely guessing lands
 * in `split` rather than inflating either arm.
 */
import {
  judgeResearchSubject,
  normalizeResearchSubjectScope,
  type ResearchSubjectScope,
} from '../utils/researchSubjectSpecificity';

export const OFF_ENTITY_GRAFT_AUDIT_VERSION = 'off-entity-graft-v1';

export const OFF_ENTITY_GRAFT_MODEL = 'gpt-5-mini';

/**
 * Explicitly not `openAiChatSampling(model)`. That helper maps every gpt-5 model
 * to 'minimal' because the family rejects `temperature`, and minimal effort is
 * what made the scope field look unstable in #2183.
 */
export const OFF_ENTITY_GRAFT_REASONING_EFFORT = 'medium';

export const OFF_ENTITY_GRAFT_RUNS_PER_RECORD = 3;

export const OFF_ENTITY_GRAFT_SYSTEM_PROMPT = [
  'You are judging attribution, not writing. You are shown one directory record and the description that record currently serves to students. Decide what research subject the description names, and whose research it is.',
  'researchSubject: name the subject in your own words, as specifically as the text supports. Use concrete subject matter: the system, organism, disease, material, phenomenon, method, or question. Return an empty string if the text names no subject. Prose that states only ambition, values, reputation, scale, career history, logistics, navigation, or a figure caption names no subject.',
  'subjectScope: use this_entity when the description describes the research of exactly the record named in the user message. Use parent_org when it describes a department, school, hospital, institute, or center that merely CONTAINS the record; a paragraph introducing "The Center for Outcomes Research and Evaluation (CORE)" is parent_org when the record is an individual faculty member who works there, and a paragraph describing a different core facility is parent_org when the record is this core facility. Use unclear when you cannot tell.',
  'A record named after a person is a person\'s record whatever type label it carries. A person\'s own biography or research statement on their own record is this_entity, not parent_org.',
  'Return JSON with exactly two fields: researchSubject and subjectScope.',
].join('\n\n');

export type OffEntityGraftRecordKind = 'person' | 'organization';

export interface OffEntityGraftPromptInput {
  name: string;
  entityType: string;
  recordKind: OffEntityGraftRecordKind;
  description: string;
}

const collapse = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export const MAX_DESCRIPTION_PROMPT_CHARS = 6_000;

export function buildOffEntityGraftUserMessage(input: OffEntityGraftPromptInput): string {
  const kindLine =
    input.recordKind === 'person'
      ? 'This record is an INDIVIDUAL PERSON, not an organization.'
      : 'This record is an ORGANIZATION (a lab, center, institute, core facility, or similar).';
  return [
    `Record name: ${collapse(input.name).slice(0, 240)}`,
    `Record type: ${collapse(input.entityType).slice(0, 60)}. ${kindLine}`,
    'Served description:',
    collapse(input.description).slice(0, MAX_DESCRIPTION_PROMPT_CHARS),
  ].join('\n\n');
}

export interface OffEntityGraftRunResult {
  subject: string;
  scope: ResearchSubjectScope;
}

/**
 * A response the model did not shape as asked must not silently read as
 * `this_entity`. `normalizeResearchSubjectScope` already maps anything
 * unrecognized to 'unclear', which is the conservative direction here.
 */
export function parseOffEntityGraftRun(content: unknown): OffEntityGraftRunResult {
  let parsed: unknown = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      return { subject: '', scope: 'unclear' };
    }
  }
  const record = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  return {
    subject: collapse(record.researchSubject),
    scope: normalizeResearchSubjectScope(record.subjectScope),
  };
}

export type OffEntityGraftVerdict = ResearchSubjectScope | 'split';

export interface OffEntityGraftJudgement {
  verdict: OffEntityGraftVerdict;
  unanimous: boolean;
  scopes: ResearchSubjectScope[];
  subjects: string[];
  /** The deterministic gate's verdict on the first run, for cross-checking. */
  servableWhenUnanimous: boolean | null;
}

/**
 * Unanimity, not majority. Two of three is exactly the regime that produced the
 * #2183 conclusion that this field could not be gated: a 2-1 split is a model
 * that does not know, and recording it as a verdict manufactures both false
 * accepts and false rejects out of noise.
 */
export function judgeOffEntityGraftRuns(runs: readonly OffEntityGraftRunResult[]): OffEntityGraftJudgement {
  const scopes = runs.map((run) => run.scope);
  const subjects = runs.map((run) => run.subject);
  const distinct = new Set(scopes);
  const unanimous = runs.length > 0 && distinct.size === 1;
  const verdict: OffEntityGraftVerdict = unanimous ? scopes[0] : 'split';
  return {
    verdict,
    unanimous,
    scopes,
    subjects,
    servableWhenUnanimous: unanimous
      ? judgeResearchSubject({ subject: runs[0].subject, scope: scopes[0] }).isServable
      : null,
  };
}

export interface ProportionInterval {
  count: number;
  total: number;
  rate: number;
  lower: number;
  upper: number;
}

/**
 * Wilson score interval. The normal approximation is wrong at the rates this
 * audit measures: at 9 hits in 300 it produces a lower bound the corpus cannot
 * have, and the whole point of reporting an interval is that the exemplar count
 * is not the population count.
 */
export function wilsonInterval(count: number, total: number, z = 1.96): ProportionInterval {
  if (total <= 0) return { count, total, rate: 0, lower: 0, upper: 0 };
  const rate = count / total;
  const denominator = 1 + (z * z) / total;
  const center = rate + (z * z) / (2 * total);
  const spread = z * Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
  return {
    count,
    total,
    rate,
    lower: Math.max(0, (center - spread) / denominator),
    upper: Math.min(1, (center + spread) / denominator),
  };
}

export const projectedPopulationCount = (interval: ProportionInterval, population: number): {
  point: number;
  lower: number;
  upper: number;
} => ({
  point: Math.round(interval.rate * population),
  lower: Math.round(interval.lower * population),
  upper: Math.round(interval.upper * population),
});

/**
 * Deterministic uniform sample. A stride over a sorted list is not a random
 * sample: slug order correlates with source scraper, so a stride draws a fixed
 * pattern of sources and its interval understates the true variance. A seeded
 * shuffle gives a genuine simple random sample that a re-run reproduces exactly.
 */
export function seededSample<T>(items: readonly T[], count: number, seed: number): T[] {
  const pool = [...items];
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

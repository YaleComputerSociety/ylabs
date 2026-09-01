/**
 * Prompt A/B for the microsite description extractor (#2183).
 *
 * Arm A is production: the live prompt file, unmodified. Arm B is a candidate
 * variant defined entirely inside this file. Candidates live here rather than in
 * `src/scrapers/prompts/` on purpose, so measuring one never changes what the
 * sweep actually runs, and so a rejected candidate stays on record as evidence
 * instead of being reverted out of existence.
 *
 * Both arms run against IDENTICAL cached page text. The page is fetched once per
 * entity and reused, so the prompt is the only variable. Fetching per arm would
 * let ordinary page churn, redirects, and rate limiting leak into the result.
 *
 * Metrics are split deliberately:
 *
 *   win metrics       grant corroboration, blind pairwise preference
 *   guardrail metrics non-empty rate, grounding rate
 *
 * Non-empty rate is a guardrail rather than a win because a stricter prompt can
 * always look better by blanking everything. A run that improves the win metrics
 * while collapsing coverage is a failed run, not a successful one.
 *
 * ## Result for the first candidate (subject gate), 2026-08-29
 *
 * Rejected. On a 42-entity stratified sample with gpt-5-mini the guardrails were
 * identical (non-empty 97.6% both, grounded 95.1% both) and corroboration moved
 * 0.357 to 0.405 at n=9, inside noise, while 25 of 42 outputs changed and none of
 * the target cases were fixed: Horsley still returned the mission block, mattera
 * still served another center's marketing copy, and loyal produced *cleaner*
 * parent-org boilerplate, which is worse because it reads more like a real
 * description.
 *
 * The `subjectScope` field is also not stable enough to gate on. Three runs
 * misfired on three different entities: it held `loyal` in one run and served it
 * in the next, and in a third it rejected `center-macmillan-reees`, a confirmed
 * good description, as `parent_org`. A gate that false-rejects good descriptions
 * nondeterministically is worse than no gate, because the corpus silently loses
 * coverage in a way no fixed test can reproduce.
 *
 * The finding worth keeping is why no prompt could win here. Horsley's real prose
 * is on a subpage this harness never fetches, and the parent-org cases turn on
 * knowing which record is being extracted for, which the page text does not say.
 * The binding constraint is acquisition and identity, not wording. Test those
 * with this harness before spending another cycle on prompt text.
 *
 * Read-only against Mongo. Writes nothing but its report.
 */
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import {
  DESCRIPTION_EXTRACTION_SYSTEM_PROMPT,
  DEFAULT_MODEL,
  candidateDescriptionLabsFromDocs,
  htmlToText,
  type CandidateDescriptionLab,
  type CandidateDescriptionLabDoc,
  type DescriptionExtraction,
} from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isDescriptionGroundedInSource } from '../utils/officialResearchDescription';
import { isFacultyResearchTextEntity } from '../utils/researchEntityDescriptionText';
import type { DescriptionEntityKind } from '../utils/researchHomeDescriptionSelection';
import {
  judgeResearchSubject,
  researchSubjectSpecificityScore,
  specificResearchSubjectTerms,
} from '../utils/researchSubjectSpecificity';
import { openAiChatSampling } from '../utils/openAiChatSampling';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

/**
 * Arm A mirrors production exactly: the live system prompt plus the live
 * per-field instructions from `defaultCallLLM`. If those instructions are edited
 * in the extractor, copy the edit here or Arm A stops being the baseline.
 */
const BASELINE_FIELD_INSTRUCTIONS = [
  'Return JSON with fullDescription, shortDescription, topics, methods, name.',
  "fullDescription: copy the page's own overview/about/mission prose describing what this research entity studies, verbatim (one or more consecutive sentences, exactly as written). shortDescription: copy a single verbatim sentence that best summarizes the work, or an empty string.",
  'topics and methods: only terms that appear verbatim on the page.',
  'For name, return the research entity\'s own proper or branded name exactly as it appears prominently on the page (for example "The Efficient Computing Lab (ECL)"). If the page only identifies it by the principal investigator\'s personal name, or no clear proper name is stated, return an empty string.',
];

/**
 * Candidate: gate on a named research subject rather than on the page section the
 * text came from, and ask for the subject and its attribution as separate
 * judgement fields. Rejected by the run recorded in the file header; retained so
 * the next candidate can be compared against it rather than rediscovering it.
 */
const CANDIDATE_SYSTEM_PROMPT = [
  "You are an extractor, not a writer. Copy the research entity's own description verbatim from the provided page text. Never paraphrase, summarize, translate, combine non-adjacent sentences, reword, fix grammar or punctuation, change capitalization, add or remove surrounding quotation marks or brackets, normalize spacing, or invent wording. Every returned description must be an exact, contiguous substring of the page text. If the page contains no such description, return an empty string for that field. Do not extract access, contact, openings, or application claims.",
  'What to look for: the sentences that state what is studied here. A student reading them should be able to tell what subject this group works on and decide whether they want to work on it.',
  'Where those sentences sit on the page does not matter. A research page, an overview, an about block, a mission statement, and a principal investigator\'s own biography are all equally valid sources. Grammatical voice does not matter either: first person ("We study...", "My research is focused on...") and third person are equally acceptable, and you must copy whichever the page uses.',
  'What matters is whether a subject is named. "Our Mission is to decipher immune dysregulation underlying early-life critical illness" names one. "Our mission stands at the nexus between hardware, computing, and data science" names none, and neither does "a world leader in transforming education, research, and clinical care". Prose that only states ambition, values, reputation, culture, or scale names no subject.',
  'If the page names no research subject anywhere, return an empty string for the description fields. That is the correct answer for a page carrying only mission, values, news, marketing, navigation, or a figure caption. Do not settle for the closest available text.',
  'researchSubject: name the subject the copied description claims, in your own words, as specifically as the text supports. Use concrete subject matter: the system, organism, disease, material, phenomenon, method, or question. Return an empty string if the copied text names no subject.',
  'subjectScope: whose research the copied description is about. Use this_entity when it describes the research of exactly the record named in the user message. Use parent_org when it describes a department, school, hospital, institute, or center that merely contains the record; a paragraph introducing "The Center for Outcomes Research and Evaluation (CORE)" is parent_org when the record is an individual faculty member who works there. Use unclear when you cannot tell. A record named after a person is a person\'s record whatever type label it carries.',
].join('\n\n');

const CANDIDATE_FIELD_INSTRUCTIONS = [
  'Return JSON with fullDescription, shortDescription, topics, methods, name, researchSubject, subjectScope.',
];

const MAX_PROMPT_CHARS = 40_000;
const MIN_PAGE_CHARS = 200;

type ArmName = 'A_baseline' | 'B_subject_gate';

interface Arm {
  name: ArmName;
  systemPrompt: string;
  fieldInstructions: string[];
  gatesOnSubject: boolean;
}

const ARMS: Arm[] = [
  {
    name: 'A_baseline',
    systemPrompt: DESCRIPTION_EXTRACTION_SYSTEM_PROMPT,
    fieldInstructions: BASELINE_FIELD_INSTRUCTIONS,
    gatesOnSubject: false,
  },
  {
    name: 'B_subject_gate',
    systemPrompt: CANDIDATE_SYSTEM_PROMPT,
    fieldInstructions: CANDIDATE_FIELD_INSTRUCTIONS,
    gatesOnSubject: true,
  },
];

/**
 * The judgement fields exist only in the candidate arm, so the harness parses
 * them locally rather than widening the production DescriptionExtraction type.
 */
type AbExtraction = DescriptionExtraction & {
  researchSubject?: unknown;
  subjectScope?: unknown;
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const DEFAULT_RANDOM_SAMPLE = 30;

/**
 * A malformed `--random` must fail the run rather than degrade it: an unchecked
 * NaN silently drops both random strata while the report still prints a sample
 * size and metrics, which reads as a valid result for the named cases alone.
 */
function randomSampleCount(value: string | undefined): number {
  if (value === undefined) return DEFAULT_RANDOM_SAMPLE;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`--random must be a non-negative integer, received "${value}".`);
  }
  return count;
}

/**
 * Side assignment from the slug, not from position: with index parity every
 * even case put arm A on the left, so a reviewer could infer the arm from the
 * ordering even with the labels removed.
 */
function placesBaselineOnLeft(slug: string): boolean {
  let hash = 5381;
  for (let index = 0; index < slug.length; index += 1) {
    hash = ((hash << 5) + hash + slug.charCodeAt(index)) >>> 0;
  }
  return hash % 2 === 0;
}

interface SampleEntity {
  slug: string;
  name: string;
  entityType: string;
  kind: string;
  pageUrl: string;
  storedFullDescription: string;
  stratum: string;
}

/**
 * The projection production uses to pick a description page, so the sample is
 * built by `candidateDescriptionLabsFromDocs` rather than by a local URL guess.
 * Measuring a page the sweep would never extract from makes the guardrail rates
 * statements about nothing.
 */
const CANDIDATE_PROJECTION = {
  slug: 1,
  name: 1,
  displayName: 1,
  entityType: 1,
  kind: 1,
  website: 1,
  websiteUrl: 1,
  sourceUrls: 1,
  sourceLinkHealth: 1,
  manuallyLockedFields: 1,
  school: 1,
  schools: 1,
  departments: 1,
  fullDescription: 1,
} as const;

const YALE_HOST = /(^|\.)yale\.edu$/;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Anchors from the two defects this change is meant to prevent. Horsley is the
 * #2176 mission-statement regression; Hatridge is the #2180 figure caption. A
 * run that does not include both is not evidence about this defect family.
 */
const REGRESSION_ANCHORS = ['dept-mcdb-valerie-horsley', 'dept-seas-michael-hatridge'];

/**
 * The parent-org and good-mission cases from the issue. These are the cases that
 * decide whether the gate is discriminating or merely strict: it must reject the
 * first group and keep the second.
 */
const PARENT_ORG_CASES = [
  'research-yale-advanced-instrumentation-development-center-aidc',
  'ysm-faculty-jaspreet-loyal',
  'ysm-faculty-jennifer-mattera',
];

const GOOD_MISSION_CASES = [
  'ysm-brodsky',
  'ysm-karam',
  'ysm-bordey',
  'nih-pi-aza-allsop',
  'center-macmillan-central-asia',
  'center-macmillan-reees',
  'ysm-faculty-shannon-zeilman',
];

async function buildSample(randomCount: number): Promise<SampleEntity[]> {
  const named = [...REGRESSION_ANCHORS, ...PARENT_ORG_CASES, ...GOOD_MISSION_CASES];
  const strata = new Map<string, string>();
  REGRESSION_ANCHORS.forEach((slug) => strata.set(slug, 'regression_anchor'));
  PARENT_ORG_CASES.forEach((slug) => strata.set(slug, 'parent_org_case'));
  GOOD_MISSION_CASES.forEach((slug) => strata.set(slug, 'good_mission_case'));

  const docs = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
  })
    .select(CANDIDATE_PROJECTION)
    .lean();

  const candidatesOf = (rows: unknown[]): CandidateDescriptionLab[] =>
    candidateDescriptionLabsFromDocs(rows as CandidateDescriptionLabDoc[]);

  const toSample = (candidate: CandidateDescriptionLab, stratum: string): SampleEntity | null => {
    const pageUrl = textValue(candidate.websiteUrl);
    if (!pageUrl) return null;
    return {
      slug: candidate.slug ?? '',
      name: candidate.name || 'Research entity',
      entityType: candidate.entityType ?? '',
      kind: candidate.kind ?? '',
      pageUrl,
      storedFullDescription: textValue(candidate.fullDescription),
      stratum,
    };
  };

  // Named cases are looked up by slug alone, with no tier or archived filter.
  // Both regression anchors would otherwise be silently dropped: Horsley is
  // archived and Hatridge sits at operator_review, so filtering the named set
  // the same way as the random set removes exactly the two entities the run
  // exists to check.
  const sample: SampleEntity[] = [];
  const namedDocs = await ResearchEntity.find({ slug: { $in: named } })
    .select(CANDIDATE_PROJECTION)
    .lean();
  const presentSlugs = new Set(
    namedDocs.map((doc) => String((doc as { slug?: unknown }).slug ?? '')),
  );
  const namedCandidates = new Map(
    candidatesOf(namedDocs).map((candidate) => [candidate.slug ?? '', candidate]),
  );
  for (const slug of named) {
    if (!presentSlugs.has(slug)) {
      console.log(`WARN: named sample entity is absent from the corpus: ${slug}`);
      continue;
    }
    const candidate = namedCandidates.get(slug);
    const entry = candidate ? toSample(candidate, strata.get(slug) ?? 'named') : null;
    if (entry) sample.push(entry);
    else console.log(`WARN: named sample entity has no usable description URL: ${slug}`);
  }

  // Two random strata, because the cohorts fail differently: an own-site lab has
  // real research prose somewhere to find, while a yale.edu profile often does
  // not, and a single pooled sample would hide a regression in either one.
  const remaining = candidatesOf(docs).filter((candidate) => !named.includes(candidate.slug ?? ''));
  const ownSite: CandidateDescriptionLab[] = [];
  const yaleOnly: CandidateDescriptionLab[] = [];
  for (const candidate of remaining) {
    const host = hostOf(candidate.websiteUrl);
    if (!host) continue;
    (YALE_HOST.test(host) ? yaleOnly : ownSite).push(candidate);
  }

  const half = Math.floor(randomCount / 2);
  const take = (pool: CandidateDescriptionLab[], count: number, stratum: string): void => {
    if (count <= 0 || pool.length === 0) return;
    // Deterministic stride rather than a random draw so a re-run compares the
    // same entities and the two arms can be re-scored later.
    const stride = Math.max(1, Math.floor(pool.length / count));
    for (let index = 0, taken = 0; index < pool.length && taken < count; index += stride) {
      const entry = toSample(pool[index], stratum);
      if (!entry) continue;
      sample.push(entry);
      taken += 1;
    }
  };
  take(ownSite, half, 'random_own_site');
  take(yaleOnly, randomCount - half, 'random_yale_profile');
  return sample;
}

/** Grant titles and abstracts for one entity, used as the independent check. */
async function grantCorpusFor(slug: string): Promise<string> {
  const rows = await Observation.find({
    entityKey: slug,
    field: 'recentGrants',
    superseded: { $ne: true },
  })
    .select({ value: 1 })
    .lean();
  const parts: string[] = [];
  for (const row of rows) {
    const value = (row as { value?: unknown }).value;
    const grants = Array.isArray(value) ? value : [value];
    for (const grant of grants) {
      if (!grant || typeof grant !== 'object') continue;
      const record = grant as Record<string, unknown>;
      parts.push(textValue(record.title), textValue(record.abstract));
    }
  }
  return parts.filter(Boolean).join(' ');
}

/**
 * Share of the extracted description's specific terms that also appear in the
 * entity's own funded grants. Scored on the description itself, not on the
 * candidate arm's subject phrase, because only the description exists in both
 * arms. Objective and model-free: a mission statement or a figure caption does
 * not share vocabulary with the PI's grants, and real research prose does.
 * Reported only for entities that have grant text at all.
 */
function corroborationRate(description: string, grantCorpus: string): number | null {
  if (!grantCorpus) return null;
  const terms = specificResearchSubjectTerms(description);
  if (!terms.length) return 0;
  const haystack = grantCorpus.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits / terms.length;
}

async function callArm(
  arm: Arm,
  input: {
    model: string;
    apiKey: string;
    labName: string;
    sourceUrl: string;
    pageText: string;
    entityKind: DescriptionEntityKind;
  },
): Promise<AbExtraction> {
  // Contact details are redacted exactly as `defaultCallLLM` does, so the arms
  // receive the input production would send and no email or phone number reaches
  // the API that the sweep deliberately withholds.
  const labName = redactDirectContactInfo(input.labName).slice(0, 240);
  const sourceUrl = redactDirectContactInfo(input.sourceUrl).slice(0, 2048);
  const pageText = redactDirectContactInfo(input.pageText).slice(0, MAX_PROMPT_CHARS);
  // Arm A never saw a record-type line, so it must not receive one here: adding
  // it would change two variables at once and the comparison would not isolate
  // the prompt reframe.
  const recordLine =
    arm.name === 'A_baseline'
      ? `Lab: ${labName}`
      : input.entityKind === 'person'
        ? `Record: ${labName}. This record is an INDIVIDUAL PERSON, not an organization.`
        : `Record: ${labName}. This record is an ORGANIZATION (a lab, center, institute, or similar).`;
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: input.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: arm.systemPrompt },
        {
          role: 'user',
          content: [
            recordLine,
            `Source URL: ${sourceUrl}`,
            ...arm.fieldInstructions,
            pageText,
          ].join('\n\n'),
        },
      ],
      ...openAiChatSampling(input.model),
    },
    {
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) throw new Error('LLM returned empty content');
  return JSON.parse(content) as AbExtraction;
}

interface ArmOutcome {
  arm: ArmName;
  fullDescription: string;
  shortDescription: string;
  researchSubject: string;
  subjectScope: string;
  grounded: boolean;
  servable: boolean;
  rejectionReason?: string;
  specificity: number;
  corroboration: number | null;
  error?: string;
}

interface ArmTally {
  attempted: number;
  errors: number;
  nonEmpty: number;
  grounded: number;
  groundedChecked: number;
  servable: number;
  specificitySum: number;
  corroborationSum: number;
  corroborationCount: number;
  rejections: Record<string, number>;
}

function emptyTally(): ArmTally {
  return {
    attempted: 0,
    errors: 0,
    nonEmpty: 0,
    grounded: 0,
    groundedChecked: 0,
    servable: 0,
    specificitySum: 0,
    corroborationSum: 0,
    corroborationCount: 0,
    rejections: {},
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const mongoUrl = process.env.MONGODBURL;
  if (!apiKey || !mongoUrl) throw new Error('OPENAI_API_KEY and MONGODBURL must be set.');
  const model = argValue('--model') ?? DEFAULT_MODEL;
  const randomCount = randomSampleCount(argValue('--random'));
  const reportPath = argValue('--output')
    ? resolveSafeJsonReportOutputPath(argValue('--output') as string)
    : '';

  await mongoose.connect(mongoUrl);
  const sample = await buildSample(randomCount);
  console.log(`sample size: ${sample.length} (model ${model})`);

  const tallies = new Map<ArmName, ArmTally>(ARMS.map((arm) => [arm.name, emptyTally()]));
  const pairs: Array<{ entity: SampleEntity; outcomes: ArmOutcome[] }> = [];

  for (const entity of sample) {
    let pageText = '';
    try {
      const response = await axios.get(entity.pageUrl, {
        timeout: 20_000,
        maxRedirects: 5,
        responseType: 'text',
        headers: { 'User-Agent': 'ylabs-description-ab/1.0' },
      });
      pageText = htmlToText(String(response.data ?? '')).slice(0, MAX_PROMPT_CHARS);
    } catch {
      console.log(`SKIP (fetch failed) ${entity.slug}`);
      continue;
    }
    if (pageText.length < MIN_PAGE_CHARS) {
      console.log(`SKIP (thin ${pageText.length} chars) ${entity.slug}`);
      continue;
    }
    const grantCorpus = await grantCorpusFor(entity.slug);

    const outcomes: ArmOutcome[] = [];
    for (const arm of ARMS) {
      const tally = tallies.get(arm.name)!;
      tally.attempted += 1;
      try {
        const extraction = await callArm(arm, {
          model,
          apiKey,
          labName: entity.name,
          sourceUrl: entity.pageUrl,
          pageText,
          entityKind: isFacultyResearchTextEntity({
            entityType: entity.entityType,
            kind: entity.kind,
          })
            ? 'person'
            : 'organization',
        });
        const full = textValue(extraction.fullDescription);
        const short = textValue(extraction.shortDescription);
        const subject = textValue(extraction.researchSubject);
        const scope = textValue(extraction.subjectScope);
        const grounded = full ? isDescriptionGroundedInSource(full, pageText) : true;
        // Keyed on the arm, never on field presence: a gated arm that omits both
        // judgement fields must be judged (and tallied as no_subject) rather than
        // waived, or its servable rate silently drifts back toward the baseline.
        // Arm A is ungated, so its servable rate is its non-empty-and-grounded
        // rate, which is exactly the behaviour in production today.
        const judged = arm.gatesOnSubject ? judgeResearchSubject({ subject, scope }) : null;
        const servable = Boolean(full) && grounded && (judged ? judged.isServable : true);
        if (full) tally.nonEmpty += 1;
        if (full) {
          tally.groundedChecked += 1;
          if (grounded) tally.grounded += 1;
        }
        if (servable) tally.servable += 1;
        // Scored on the description both arms actually produce, never on
        // `subject || full`. Arm A has no subject, so that fallback compared a
        // whole paragraph against Arm B's short subject phrase and made Arm B
        // look worse purely because a phrase has fewer terms than a paragraph.
        const specificity = researchSubjectSpecificityScore(full);
        tally.specificitySum += specificity;
        const corroboration = corroborationRate(full, grantCorpus);
        if (corroboration !== null) {
          tally.corroborationSum += corroboration;
          tally.corroborationCount += 1;
        }
        if (judged?.rejectionReason) {
          tally.rejections[judged.rejectionReason] =
            (tally.rejections[judged.rejectionReason] ?? 0) + 1;
        }
        outcomes.push({
          arm: arm.name,
          fullDescription: full,
          shortDescription: short,
          researchSubject: subject,
          subjectScope: scope,
          grounded,
          servable,
          rejectionReason: judged?.rejectionReason,
          specificity,
          corroboration,
        });
      } catch (error) {
        tally.errors += 1;
        outcomes.push({
          arm: arm.name,
          fullDescription: '',
          shortDescription: '',
          researchSubject: '',
          subjectScope: '',
          grounded: false,
          servable: false,
          specificity: 0,
          corroboration: null,
          error: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
    pairs.push({ entity, outcomes });
    const [a, b] = outcomes;
    const changed = a.fullDescription !== b.fullDescription ? 'CHANGED' : 'same';
    console.log(
      `${entity.stratum.padEnd(20)} ${entity.slug.slice(0, 40).padEnd(41)} ${changed.padEnd(8)} A:${a.servable ? 'serve' : 'hold '} B:${b.servable ? 'serve' : 'hold '}${b.rejectionReason ? ` (${b.rejectionReason})` : ''}`,
    );
  }

  console.log('\n===== pre-registered metrics =====');
  for (const arm of ARMS) {
    const tally = tallies.get(arm.name)!;
    const scored = tally.attempted - tally.errors;
    if (!scored) {
      console.log(`${arm.name}: no scored pages (errors=${tally.errors})`);
      continue;
    }
    const pct = (value: number, of: number): string =>
      of ? `${((100 * value) / of).toFixed(1)}%` : 'n/a';
    console.log(
      [
        arm.name.padEnd(16),
        `scored=${scored}`,
        `nonEmpty=${pct(tally.nonEmpty, scored)} (guardrail)`,
        `grounded=${pct(tally.grounded, tally.groundedChecked)} (guardrail)`,
        `servable=${pct(tally.servable, scored)}`,
        `avgSpecificity=${(tally.specificitySum / scored).toFixed(2)}`,
        `avgCorroboration=${tally.corroborationCount ? (tally.corroborationSum / tally.corroborationCount).toFixed(3) : 'n/a'} (n=${tally.corroborationCount})`,
        `errors=${tally.errors}`,
      ].join('  '),
    );
    if (Object.keys(tally.rejections).length) {
      console.log(`${''.padEnd(16)}  rejections=${JSON.stringify(tally.rejections)}`);
    }
  }

  const differing = pairs.filter(
    (pair) => pair.outcomes[0].fullDescription !== pair.outcomes[1].fullDescription,
  );
  console.log(`\ndiffering cases (for blind pairwise review): ${differing.length}/${pairs.length}`);

  if (reportPath) {
    const reviewCases = differing.map((pair, index) => {
      const [a, b] = pair.outcomes;
      const baselineLeft = placesBaselineOnLeft(pair.entity.slug);
      return {
        caseId: index,
        slug: pair.entity.slug,
        entityType: pair.entity.entityType,
        stratum: pair.entity.stratum,
        left: baselineLeft ? a.fullDescription : b.fullDescription,
        right: baselineLeft ? b.fullDescription : a.fullDescription,
        leftArm: baselineLeft ? a.arm : b.arm,
        rightArm: baselineLeft ? b.arm : a.arm,
      };
    });
    fs.writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          model,
          sampleSize: sample.length,
          scoredPairs: pairs.length,
          metrics: Object.fromEntries([...tallies.entries()]),
          // Arm labels live only in blindReviewKey, so the pairwise judgement is
          // genuinely blind: a reviewer scores blindReview and joins the key by
          // caseId afterwards.
          blindReview: reviewCases.map((entry) => ({
            caseId: entry.caseId,
            slug: entry.slug,
            entityType: entry.entityType,
            stratum: entry.stratum,
            left: entry.left,
            right: entry.right,
          })),
          blindReviewKey: reviewCases.map((entry) => ({
            caseId: entry.caseId,
            leftArm: entry.leftArm,
            rightArm: entry.rightArm,
          })),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`report written: ${reportPath}`);
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

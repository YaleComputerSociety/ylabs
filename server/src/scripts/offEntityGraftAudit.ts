/**
 * Read-only sizing run for off-entity graft over the served LAB and
 * FACULTY_RESEARCH_AREA corpus (#2272).
 *
 * The population is the corpus as students see it: unarchived, and passing the
 * live serve gate `researchEntityServesPublicDetail` rather than the stored
 * `studentVisibilityTier` alone, because the stored tier is a snapshot that goes
 * stale against that gate. The served text is likewise recomputed through
 * `buildResearchEntityPublicDescriptionRepresentation`, never read from the raw
 * document: card synthesis and the serve-time hygiene passes both rewrite what a
 * student actually reads, and judging stored fields measures a different corpus.
 *
 * Two strata are reported separately because they mean different things. The
 * `student_ready` stratum is live student-facing harm. The rest is latent: those
 * records pass the serve invariant and would surface on the next re-gate.
 *
 * Writes nothing but its report.
 *
 * Usage:
 *   yarn research-entity:audit-off-entity-graft --student-ready 300 --other 150 \
 *     --output tmp/off-entity-graft.json
 */
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { ResearchEntity } from '../models/researchEntity';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  researchEntityServesPublicDetail,
} from '../services/researchEntityPublicDescription';
import { isFacultyResearchTextEntity } from '../utils/researchEntityDescriptionText';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  OFF_ENTITY_GRAFT_AUDIT_VERSION,
  OFF_ENTITY_GRAFT_MODEL,
  OFF_ENTITY_GRAFT_REASONING_EFFORT,
  OFF_ENTITY_GRAFT_RUNS_PER_RECORD,
  OFF_ENTITY_GRAFT_SYSTEM_PROMPT,
  buildOffEntityGraftUserMessage,
  judgeOffEntityGraftRuns,
  parseOffEntityGraftRun,
  projectedPopulationCount,
  seededSample,
  wilsonInterval,
  type OffEntityGraftJudgement,
  type OffEntityGraftRunResult,
  type OffEntityGraftVerdict,
} from './offEntityGraftAuditCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

const AUDITED_ENTITY_TYPES = new Set(['LAB', 'FACULTY_RESEARCH_AREA']);

const SAMPLE_SEED = 20260829;

/** gpt-5-mini list price per million tokens, for the reported cost basis. */
const USD_PER_MILLION_INPUT_TOKENS = 0.25;
const USD_PER_MILLION_OUTPUT_TOKENS = 2.0;

interface AuditOptions {
  studentReady: number;
  other: number;
  concurrency: number;
  output?: string;
}

function parseCount(value: string | undefined, flag: string): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return Number(value);
}

export function parseOffEntityGraftAuditArgs(argv: string[]): AuditOptions {
  const options: AuditOptions = { studentReady: 300, other: 150, concurrency: 6 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--student-ready') {
      options.studentReady = parseCount(argv[(index += 1)], '--student-ready');
    } else if (arg === '--other') {
      options.other = parseCount(argv[(index += 1)], '--other');
    } else if (arg === '--concurrency') {
      options.concurrency = Math.max(1, parseCount(argv[(index += 1)], '--concurrency'));
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[(index += 1)]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

interface SampledRecord {
  slug: string;
  name: string;
  entityType: string;
  stratum: 'student_ready' | 'other';
  storedTier: string;
  cardDescription: string;
  fullDescription: string;
  websiteUrl: string;
  recordKind: 'person' | 'organization';
}

interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

async function callJudge(
  record: SampledRecord,
  apiKey: string,
  usage: Usage,
): Promise<OffEntityGraftRunResult> {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: OFF_ENTITY_GRAFT_MODEL,
      reasoning_effort: OFF_ENTITY_GRAFT_REASONING_EFFORT,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: OFF_ENTITY_GRAFT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildOffEntityGraftUserMessage({
            name: redactDirectContactInfo(record.name),
            entityType: record.entityType,
            recordKind: record.recordKind,
            // The judged text is the served description, redacted the same way
            // every other LLM path here redacts, so no contact detail the sweep
            // withholds reaches the API through the audit instead.
            description: redactDirectContactInfo(record.fullDescription),
          }),
        },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 90_000,
    },
  );
  usage.calls += 1;
  usage.inputTokens += Number(response.data?.usage?.prompt_tokens ?? 0);
  usage.outputTokens += Number(response.data?.usage?.completion_tokens ?? 0);
  return parseOffEntityGraftRun(response.data?.choices?.[0]?.message?.content);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function stratumReport(
  rows: Array<{ record: SampledRecord; judgement: OffEntityGraftJudgement }>,
  population: number,
): Record<string, unknown> {
  const total = rows.length;
  const of = (verdict: OffEntityGraftVerdict) =>
    rows.filter((row) => row.judgement.verdict === verdict).length;
  const parentOrg = wilsonInterval(of('parent_org'), total);
  const unclear = wilsonInterval(of('unclear'), total);
  const split = wilsonInterval(of('split'), total);
  const graft = wilsonInterval(of('parent_org') + of('unclear'), total);
  return {
    sampled: total,
    population,
    parent_org: { ...parentOrg, projected: projectedPopulationCount(parentOrg, population) },
    unclear: { ...unclear, projected: projectedPopulationCount(unclear, population) },
    parent_org_or_unclear: { ...graft, projected: projectedPopulationCount(graft, population) },
    split_non_unanimous: split,
    this_entity: of('this_entity'),
  };
}

async function main(): Promise<void> {
  const options = parseOffEntityGraftAuditArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY must be set.');
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'research-entity:audit-off-entity-graft',
    mongoUrl: process.env.MONGODBURL,
  });
  await mongoose.connect(String(process.env.MONGODBURL));

  // Deliberately unprojected, for the reason documented on
  // `auditStudentReadyPublicDescriptions`: the serve gate fails closed on any
  // field it cannot see, so a projection silently changes the population.
  const docs = (await ResearchEntity.find({ archived: { $ne: true } }).lean()) as Array<
    Record<string, any>
  >;
  const servedByStratum = { student_ready: [] as SampledRecord[], other: [] as SampledRecord[] };
  for (const doc of docs) {
    const entityType = String(doc.entityType ?? '');
    if (!AUDITED_ENTITY_TYPES.has(entityType)) continue;
    if (!researchEntityServesPublicDetail(doc)) continue;
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity: doc });
    const fullDescription = representation.fullDescription || representation.cardDescription;
    if (!fullDescription) continue;
    const storedTier = String(doc.studentVisibilityTier ?? '');
    const record: SampledRecord = {
      slug: String(doc.slug ?? ''),
      name: String(doc.displayName || doc.name || doc.slug || ''),
      entityType,
      stratum: storedTier === 'student_ready' ? 'student_ready' : 'other',
      storedTier,
      cardDescription: representation.cardDescription,
      fullDescription,
      websiteUrl: String(doc.websiteUrl || doc.website || ''),
      recordKind: isFacultyResearchTextEntity({ entityType, kind: doc.kind })
        ? 'person'
        : 'organization',
    };
    servedByStratum[record.stratum].push(record);
  }

  const populations = {
    student_ready: servedByStratum.student_ready.length,
    other: servedByStratum.other.length,
  };
  const sample = [
    ...seededSample(servedByStratum.student_ready, options.studentReady, SAMPLE_SEED),
    ...seededSample(servedByStratum.other, options.other, SAMPLE_SEED + 1),
  ];
  console.log(
    `db=${guard.dbLabel} population student_ready=${populations.student_ready} other=${populations.other} sampled=${sample.length} model=${OFF_ENTITY_GRAFT_MODEL} effort=${OFF_ENTITY_GRAFT_REASONING_EFFORT} runs=${OFF_ENTITY_GRAFT_RUNS_PER_RECORD}`,
  );

  const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  let completed = 0;
  const judged = await mapWithConcurrency(sample, options.concurrency, async (record) => {
    const runs: OffEntityGraftRunResult[] = [];
    for (let run = 0; run < OFF_ENTITY_GRAFT_RUNS_PER_RECORD; run += 1) {
      try {
        runs.push(await callJudge(record, apiKey, usage));
      } catch (error) {
        console.log(`ERROR ${record.slug}: ${sanitizeLogValue(error)}`);
        runs.push({ subject: '', scope: 'unclear' });
      }
    }
    completed += 1;
    if (completed % 25 === 0) console.log(`judged ${completed}/${sample.length}`);
    return { record, judgement: judgeOffEntityGraftRuns(runs) };
  });

  const byStratum = {
    student_ready: judged.filter((row) => row.record.stratum === 'student_ready'),
    other: judged.filter((row) => row.record.stratum === 'other'),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    contractVersion: OFF_ENTITY_GRAFT_AUDIT_VERSION,
    environment: guard.environment,
    db: guard.dbLabel,
    model: OFF_ENTITY_GRAFT_MODEL,
    reasoningEffort: OFF_ENTITY_GRAFT_REASONING_EFFORT,
    runsPerRecord: OFF_ENTITY_GRAFT_RUNS_PER_RECORD,
    sampleSeed: SAMPLE_SEED,
    cost: {
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usdPerMillionInputTokens: USD_PER_MILLION_INPUT_TOKENS,
      usdPerMillionOutputTokens: USD_PER_MILLION_OUTPUT_TOKENS,
      estimatedUsd:
        (usage.inputTokens / 1e6) * USD_PER_MILLION_INPUT_TOKENS +
        (usage.outputTokens / 1e6) * USD_PER_MILLION_OUTPUT_TOKENS,
    },
    strata: {
      student_ready: stratumReport(byStratum.student_ready, populations.student_ready),
      other: stratumReport(byStratum.other, populations.other),
    },
    // Every non-this_entity hit, in full, because a count nobody read is not
    // evidence: the flag families in this repo have repeatedly measured
    // something other than what they claimed.
    hits: judged
      .filter((row) => row.judgement.verdict !== 'this_entity')
      .map((row) => ({
        slug: row.record.slug,
        name: row.record.name,
        entityType: row.record.entityType,
        stratum: row.record.stratum,
        websiteUrl: row.record.websiteUrl,
        verdict: row.judgement.verdict,
        scopes: row.judgement.scopes,
        subjects: row.judgement.subjects,
        cardDescription: row.record.cardDescription,
        fullDescription: row.record.fullDescription,
      })),
  };

  console.log(JSON.stringify(report.strata, null, 2));
  console.log(
    `calls=${usage.calls} inputTokens=${usage.inputTokens} outputTokens=${usage.outputTokens} estimatedUsd=${report.cost.estimatedUsd.toFixed(4)}`,
  );
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written: ${options.output}`);
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('off-entity graft audit failed:', sanitizeLogValue(error));
  process.exitCode = 1;
});

import dotenv from 'dotenv';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import {
  planStudentVisibilityGate,
  type StudentVisibilityGatePlan,
} from '../services/studentVisibilityGateService';
import { DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES } from '../scrapers/sources/departmentUndergradResearchScraper';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export interface RepairTargetEntity {
  recordId: string;
  slug: string;
  label: string;
  entityType?: string;
  kind?: string;
  departments?: string[];
  sourceUrls?: string[];
  websiteUrl?: string;
  website?: string;
}

export interface RepairTargetSample {
  recordId: string;
  slug: string;
  label: string;
  entityType?: string;
  reasons: string[];
  sourceUrls?: string[];
  websiteUrl?: string;
}

export interface RepairTargetBucket {
  count: number;
  slugs: string[];
  samples: RepairTargetSample[];
}

export interface StudentVisibilityRepairTargetReport {
  generatedAt: string;
  scanned: number;
  held: number;
  buckets: {
    llmMicrositeCandidates: RepairTargetBucket;
    departmentPageCandidates: RepairTargetBucket;
    sourceUrlBackfillCandidates: RepairTargetBucket;
    leadRepairCandidates: RepairTargetBucket;
  };
  llmMicrositeCandidates: RepairTargetBucket;
  departmentPageCandidates: RepairTargetBucket;
  sourceUrlBackfillCandidates: RepairTargetBucket;
  leadRepairCandidates: RepairTargetBucket;
}

const PUBLIC_TIERS = new Set<string>(publicStudentVisibilityTiers);
const LLM_REPAIR_REASONS = new Set([
  'missing_action_evidence',
  'missing_description',
  'profile_fallback_only',
  'thin_description',
  'missing_exploratory_framing',
]);
const DEPARTMENT_REPAIR_REASONS = new Set([
  'missing_action_evidence',
  'missing_exploratory_framing',
]);

const hasHttpUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const isOfficialYaleUrl = (value: string): boolean => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'yale.edu' || hostname.endsWith('.yale.edu');
  } catch {
    return /\.yale\.edu\b|^https?:\/\/yale\.edu\b/i.test(value);
  }
};

const normalizeKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const DEPARTMENT_UNDERGRAD_RESEARCH_DEPARTMENTS = new Set(
  DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.map((page) => normalizeKey(page.department)),
);

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const reasonsInclude = (reasons: string[], reasonSet: Set<string>): boolean =>
  reasons.some((reason) => reasonSet.has(reason));

const entityHttpUrls = (entity: RepairTargetEntity): string[] =>
  uniqueStrings([...(entity.sourceUrls || []), entity.websiteUrl, entity.website]).filter(hasHttpUrl);

const entityOfficialUrls = (entity: RepairTargetEntity): string[] =>
  entityHttpUrls(entity).filter(isOfficialYaleUrl);

function compactSample(plan: StudentVisibilityGatePlan, entity: RepairTargetEntity): RepairTargetSample {
  const sample: RepairTargetSample = {
    recordId: plan.recordId,
    slug: entity.slug,
    label: entity.label || plan.label,
    entityType: entity.entityType,
    reasons: plan.reasons,
  };
  const sourceUrls = uniqueStrings(entity.sourceUrls || []);
  if (sourceUrls.length > 0) sample.sourceUrls = sourceUrls;
  const websiteUrl = entity.websiteUrl || entity.website;
  if (websiteUrl) sample.websiteUrl = websiteUrl;
  return sample;
}

function buildBucket(
  rows: Array<{ plan: StudentVisibilityGatePlan; entity: RepairTargetEntity }>,
): RepairTargetBucket {
  return {
    count: rows.length,
    slugs: rows.map((row) => row.entity.slug),
    samples: rows.slice(0, 20).map((row) => compactSample(row.plan, row.entity)),
  };
}

function isHeld(plan: StudentVisibilityGatePlan): boolean {
  return !PUBLIC_TIERS.has(plan.tier);
}

function isLab(entity: RepairTargetEntity): boolean {
  return normalizeKey(entity.entityType) === 'lab' || normalizeKey(entity.kind) === 'lab';
}

function isLlmEligibleEntityType(entity: RepairTargetEntity): boolean {
  const entityType = normalizeKey(entity.entityType);
  return !['program', 'core_facility'].includes(entityType);
}

function overlapsDepartmentConfig(entity: RepairTargetEntity): boolean {
  return (entity.departments || []).some((department) =>
    DEPARTMENT_UNDERGRAD_RESEARCH_DEPARTMENTS.has(normalizeKey(department)),
  );
}

function isProgramLike(entity: RepairTargetEntity): boolean {
  return ['program', 'group'].includes(normalizeKey(entity.entityType));
}

function compareByLabel(
  a: { plan: StudentVisibilityGatePlan; entity: RepairTargetEntity },
  b: { plan: StudentVisibilityGatePlan; entity: RepairTargetEntity },
): number {
  return (a.entity.label || a.plan.label).localeCompare(b.entity.label || b.plan.label);
}

function compareLlmCandidates(
  a: { plan: StudentVisibilityGatePlan; entity: RepairTargetEntity },
  b: { plan: StudentVisibilityGatePlan; entity: RepairTargetEntity },
): number {
  const aHeld = isHeld(a.plan) ? 0 : 1;
  const bHeld = isHeld(b.plan) ? 0 : 1;
  if (aHeld !== bHeld) return aHeld - bHeld;
  const aOfficial = entityHttpUrls(a.entity).length > 0 ? 0 : 1;
  const bOfficial = entityHttpUrls(b.entity).length > 0 ? 0 : 1;
  if (aOfficial !== bOfficial) return aOfficial - bOfficial;
  const aReason = reasonsInclude(a.plan.reasons, LLM_REPAIR_REASONS) ? 0 : 1;
  const bReason = reasonsInclude(b.plan.reasons, LLM_REPAIR_REASONS) ? 0 : 1;
  if (aReason !== bReason) return aReason - bReason;
  return compareByLabel(a, b);
}

function compareDepartmentCandidates(
  a: { plan: StudentVisibilityGatePlan; entity: RepairTargetEntity },
  b: { plan: StudentVisibilityGatePlan; entity: RepairTargetEntity },
): number {
  const aFraming = a.plan.reasons.includes('missing_exploratory_framing') ? 0 : 1;
  const bFraming = b.plan.reasons.includes('missing_exploratory_framing') ? 0 : 1;
  if (aFraming !== bFraming) return aFraming - bFraming;
  const aOverlap = overlapsDepartmentConfig(a.entity) ? 0 : 1;
  const bOverlap = overlapsDepartmentConfig(b.entity) ? 0 : 1;
  if (aOverlap !== bOverlap) return aOverlap - bOverlap;
  return compareByLabel(a, b);
}

export function buildStudentVisibilityRepairTargetReport(input: {
  plans: StudentVisibilityGatePlan[];
  entities: RepairTargetEntity[];
  generatedAt?: string;
}): StudentVisibilityRepairTargetReport {
  const entitiesById = new Map(input.entities.map((entity) => [entity.recordId, entity]));
  const heldRows = input.plans
    .filter(isHeld)
    .map((plan) => {
      const entity = entitiesById.get(plan.recordId);
      if (!entity?.slug) return null;
      return { plan, entity };
    })
    .filter((row): row is { plan: StudentVisibilityGatePlan; entity: RepairTargetEntity } =>
      Boolean(row),
    );

  const llmMicrositeCandidates = heldRows
    .filter(
      (row) =>
        isLlmEligibleEntityType(row.entity) &&
        entityOfficialUrls(row.entity).length > 0 &&
        reasonsInclude(row.plan.reasons, LLM_REPAIR_REASONS),
    )
    .sort(compareLlmCandidates);

  const departmentPageCandidates = heldRows
    .filter(
      (row) =>
        overlapsDepartmentConfig(row.entity) ||
        (isProgramLike(row.entity) && reasonsInclude(row.plan.reasons, DEPARTMENT_REPAIR_REASONS)),
    )
    .sort(compareDepartmentCandidates);

  const sourceUrlBackfillCandidates = heldRows
    .filter(
      (row) => row.plan.reasons.includes('missing_source_url') || entityHttpUrls(row.entity).length === 0,
    )
    .sort(compareByLabel);

  const leadRepairCandidates = heldRows
    .filter(
      (row) =>
        isLab(row.entity) &&
        (row.plan.reasons.includes('missing_lab_lead') || row.plan.reasons.includes('missing_lead')),
    )
    .sort(compareByLabel);

  const buckets = {
    llmMicrositeCandidates: buildBucket(llmMicrositeCandidates),
    departmentPageCandidates: buildBucket(departmentPageCandidates),
    sourceUrlBackfillCandidates: buildBucket(sourceUrlBackfillCandidates),
    leadRepairCandidates: buildBucket(leadRepairCandidates),
  };

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    scanned: input.plans.length,
    held: heldRows.length,
    buckets,
    ...buckets,
  };
}

async function loadRepairTargetEntities(plans: StudentVisibilityGatePlan[]): Promise<RepairTargetEntity[]> {
  const recordIds = uniqueStrings(plans.map((plan) => plan.recordId));
  if (recordIds.length === 0) return [];
  const docs = await ResearchEntity.find({ _id: { $in: recordIds } })
    .select('slug name displayName entityType kind departments sourceUrls websiteUrl website')
    .lean();

  return (docs as any[]).map((doc) => {
    const recordId = serializedDocumentId(doc._id) || '';
    return {
    recordId,
    slug: doc.slug || '',
    label: doc.displayName || doc.name || doc.slug || recordId,
    entityType: doc.entityType,
    kind: doc.kind,
    departments: Array.isArray(doc.departments) ? uniqueStrings(doc.departments) : [],
    sourceUrls: Array.isArray(doc.sourceUrls) ? uniqueStrings(doc.sourceUrls) : [],
    websiteUrl: doc.websiteUrl || '',
    website: doc.website || '',
  };
  });
}

export async function generateStudentVisibilityRepairTargetReport(): Promise<StudentVisibilityRepairTargetReport> {
  const plans = await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run' } as any);
  const entities = await loadRepairTargetEntities(plans);
  return buildStudentVisibilityRepairTargetReport({ plans, entities });
}

export function parseArgs(argv: string[]): { output?: string; collection: 'research' } {
  const options: { output?: string; collection: 'research' } = { collection: 'research' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--collection=research' || (arg === '--collection' && argv[index + 1] === 'research')) {
      if (arg === '--collection') index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length).trim());
    } else if (arg === '--output') {
      index += 1;
      options.output = resolveSafeJsonReportOutputPath(argv[index]?.trim());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export async function writeStudentVisibilityRepairTargetOutput(
  report: StudentVisibilityRepairTargetReport,
  output?: string,
): Promise<void> {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  await mkdir(path.dirname(safeOutput), { recursive: true });
  await writeFile(safeOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const report = await generateStudentVisibilityRepairTargetReport();
  const json = JSON.stringify(report, null, 2);
  await writeStudentVisibilityRepairTargetOutput(report, options.output);
  console.log(json);
}

if (process.argv[1] && pathMatchesScript(process.argv[1], 'studentVisibilityRepairTargets.ts')) {
  main()
    .catch((error) => {
      console.error('Failed to generate student visibility repair targets:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

function pathMatchesScript(value: string, scriptName: string): boolean {
  return value.replace(/\\/g, '/').endsWith(`/scripts/${scriptName}`);
}

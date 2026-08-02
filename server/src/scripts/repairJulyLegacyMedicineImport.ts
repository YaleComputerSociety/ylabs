import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Department } from '../models/department';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LEGACY_SOURCE = 'root-yale-medicine-labs-json';
const PRODUCTION_API_ORIGIN = 'https://yalelabs.io';
const IMPORT_WINDOW_START = new Date('2026-07-13T02:00:00.000Z');
const IMPORT_WINDOW_END = new Date('2026-07-13T03:00:00.000Z');
const GENERIC_YSM_DEPARTMENTS = ['Yale School of Medicine'];

const SCALAR_FIELDS = [
  'name',
  'displayName',
  'kind',
  'entityType',
  'shortDescription',
  'description',
  'fullDescription',
  'websiteUrl',
  'school',
  'openness',
] as const;
const ARRAY_FIELDS = ['schools', 'departments', 'sourceUrls'] as const;
const IMPORT_WRITTEN_FIELDS = [
  ...SCALAR_FIELDS,
  ...ARRAY_FIELDS,
  'website',
  'activeAtYaleCache',
  'yaleStatusCache',
  'opennessStatusCache',
  'lastObservedAt',
  'archived',
  'primaryDepartmentId',
  'departmentIds',
  'confidenceByField',
  'fieldProvenance',
] as const;

type PlainRecord = Record<string, any>;

export interface RepairArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  concurrency: number;
  output: string;
  backup: string;
}

export interface FieldRepair {
  field: string;
  betaValue: unknown;
  productionValue: unknown;
  reason: string;
}

export interface EntityRepairPlan {
  slug: string;
  name: string;
  productionStatus: number;
  repairs: FieldRepair[];
  auditedFields: string[];
  skippedFields: Array<{ field: string; reason: string }>;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter(Boolean) : [];

const normalizedArray = (value: unknown): string[] =>
  [...new Set(strings(value))].sort((left, right) => left.localeCompare(right));

const sameArray = (left: unknown, right: unknown): boolean =>
  JSON.stringify(normalizedArray(left)) === JSON.stringify(normalizedArray(right));

const isGenericYsmDepartments = (value: unknown): boolean =>
  sameArray(value, GENERIC_YSM_DEPARTMENTS);

const isDescriptionField = (field: string): boolean =>
  field === 'description' || field === 'fullDescription' || field === 'shortDescription';

export function buildEntityRepairPlan(
  beta: PlainRecord,
  production: PlainRecord | null,
  productionStatus = production ? 200 : 404,
): EntityRepairPlan {
  const plan: EntityRepairPlan = {
    slug: text(beta.slug),
    name: text(beta.name),
    productionStatus,
    repairs: [],
    auditedFields: [...IMPORT_WRITTEN_FIELDS],
    skippedFields: [],
  };

  if (!production) {
    plan.skippedFields.push({ field: '*', reason: 'No public production entity exists.' });
    return plan;
  }

  for (const field of SCALAR_FIELDS) {
    const betaValue = text(beta[field]);
    const productionValue = text(production[field]);
    if (!productionValue || betaValue === productionValue) continue;

    if (isDescriptionField(field)) {
      if (!betaValue) {
        plan.repairs.push({
          field,
          betaValue,
          productionValue,
          reason: 'July import erased a populated production description.',
        });
      } else {
        plan.skippedFields.push({
          field,
          reason:
            'Beta and production descriptions differ, but both are populated; preserve Beta because the difference is not demonstrably a regression.',
        });
      }
      continue;
    }

    const provenanceSource = text(beta.fieldProvenance?.[field]?.sourceName);
    if (!betaValue || provenanceSource === LEGACY_SOURCE) {
      plan.repairs.push({
        field,
        betaValue,
        productionValue,
        reason: betaValue
          ? 'July legacy import changed an identity or classification field from production.'
          : 'July legacy import left an identity or classification field empty.',
      });
    }
  }

  const productionDepartments = strings(production.departments);
  if (
    productionDepartments.length > 0 &&
    !sameArray(beta.departments, productionDepartments) &&
    isGenericYsmDepartments(beta.departments)
  ) {
    plan.repairs.push({
      field: 'departments',
      betaValue: beta.departments,
      productionValue: productionDepartments,
      reason: 'July import collapsed richer production departments to generic Yale School of Medicine.',
    });
  }

  const productionSchools = strings(production.schools);
  if (productionSchools.length > 0 && !sameArray(beta.schools, productionSchools)) {
    const provenanceSource = text(beta.fieldProvenance?.schools?.sourceName);
    if (strings(beta.schools).length === 0 || provenanceSource === LEGACY_SOURCE) {
      plan.repairs.push({
        field: 'schools',
        betaValue: beta.schools,
        productionValue: productionSchools,
        reason: 'July legacy import changed school membership from production.',
      });
    }
  }

  const betaSourceUrls = strings(beta.sourceUrls);
  const productionSourceUrls = strings(production.sourceUrls);
  const missingProductionUrls = productionSourceUrls.filter((url) => !betaSourceUrls.includes(url));
  if (missingProductionUrls.length > 0) {
    plan.repairs.push({
      field: 'sourceUrls',
      betaValue: betaSourceUrls,
      productionValue: [...new Set([...betaSourceUrls, ...productionSourceUrls])],
      reason: 'Beta lost production source URLs; preserve the union rather than deleting newer Beta URLs.',
    });
  }

  if (text(production.websiteUrl) && !text(beta.website)) {
    plan.repairs.push({
      field: 'website',
      betaValue: beta.website,
      productionValue: production.websiteUrl,
      reason: 'July import left the legacy website alias empty while production has an official URL.',
    });
  }

  for (const field of [
    'activeAtYaleCache',
    'yaleStatusCache',
    'opennessStatusCache',
    'lastObservedAt',
    'archived',
  ]) {
    plan.skippedFields.push({
      field,
      reason: 'Not exposed by the production public API; preserve Beta rather than infer a rollback value.',
    });
  }

  return plan;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new Error(`${flag} requires a positive integer`);
  return Number(value);
}

export function parseArgs(argv: string[]): RepairArgs {
  const args: RepairArgs = {
    apply: false,
    confirm: false,
    maxApply: 295,
    concurrency: 8,
    output: resolveSafeJsonReportOutputPath('tmp/july-legacy-medicine-repair-report.json'),
    backup: resolveSafeJsonReportOutputPath('tmp/july-legacy-medicine-beta-backup.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-july-legacy-medicine-repair') args.confirm = true;
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
    else if (arg.startsWith('--concurrency='))
      args.concurrency = parsePositiveInteger(arg.slice('--concurrency='.length), '--concurrency');
    else if (arg.startsWith('--output='))
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    else if (arg.startsWith('--backup='))
      args.backup = resolveSafeJsonReportOutputPath(arg.slice('--backup='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.apply && !args.confirm) {
    throw new Error('--confirm-july-legacy-medicine-repair is required with --apply');
  }
  return args;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function fetchProductionEntity(slug: string): Promise<{ status: number; entity: PlainRecord | null }> {
  const response = await fetch(`${PRODUCTION_API_ORIGIN}/api/research/${encodeURIComponent(slug)}`);
  if (response.status === 404) return { status: 404, entity: null };
  if (!response.ok) throw new Error(`Production request for ${slug} failed with ${response.status}`);
  const payload = (await response.json()) as PlainRecord;
  return { status: response.status, entity: payload.researchEntity || payload.group || null };
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function comparableObservationValue(value: unknown): unknown {
  if (Array.isArray(value)) return normalizedArray(value);
  return text(value);
}

function matchingObservation(
  observations: PlainRecord[],
  field: string,
  value: unknown,
): PlainRecord | undefined {
  const expected = JSON.stringify(comparableObservationValue(value));
  return observations
    .filter(
      (observation) =>
        observation.field === field &&
        JSON.stringify(comparableObservationValue(observation.value)) === expected,
    )
    .sort((left, right) => {
      const confidence = Number(right.confidence || 0) - Number(left.confidence || 0);
      if (confidence !== 0) return confidence;
      return new Date(right.observedAt || 0).getTime() - new Date(left.observedAt || 0).getTime();
    })[0];
}

function recoveryProvenance(field: string, productionValue: unknown): PlainRecord {
  return {
    sourceName: 'production-copy-recovery',
    sourceUrl: `${PRODUCTION_API_ORIGIN}/api/research`,
    observedAt: new Date(),
    confidence: 1,
    note: `Restored ${field} after audited July legacy import regression.`,
    productionValue,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'July legacy medicine import repair',
    mongoUrl: process.env.MONGODBURL,
  });
  await mongoose.connect(process.env.MONGODBURL || '');

  const cohort = await ResearchEntity.find({
    'fieldProvenance.name.sourceName': LEGACY_SOURCE,
    'fieldProvenance.name.observedAt': { $gte: IMPORT_WINDOW_START, $lt: IMPORT_WINDOW_END },
  })
    .sort({ slug: 1 })
    .lean();

  writeJson(args.backup, {
    generatedAt: new Date(),
    target,
    cohortQuery: { sourceName: LEGACY_SOURCE, start: IMPORT_WINDOW_START, end: IMPORT_WINDOW_END },
    count: cohort.length,
    entities: cohort,
  });

  const comparisons = await mapWithConcurrency(cohort, args.concurrency, async (entity: PlainRecord) => {
    const production = await fetchProductionEntity(text(entity.slug));
    return {
      entity,
      production: production.entity,
      plan: buildEntityRepairPlan(entity, production.entity, production.status),
    };
  });
  const changedPlans = comparisons.filter(({ plan }) => plan.repairs.length > 0);
  if (changedPlans.length > args.maxApply) {
    throw new Error(`Repair would update ${changedPlans.length} entities, above --max-apply=${args.maxApply}`);
  }

  const departmentRows = await Department.find({})
    .select('_id name displayName abbreviation aliases')
    .lean();
  const departmentByLabel = new Map<string, PlainRecord>();
  for (const department of departmentRows as PlainRecord[]) {
    for (const label of [
      department.name,
      department.displayName,
      department.abbreviation,
      ...(Array.isArray(department.aliases) ? department.aliases : []),
    ]) {
      if (text(label)) departmentByLabel.set(text(label).toLowerCase(), department);
    }
  }

  const applied: PlainRecord[] = [];
  if (args.apply) {
    for (const { entity, plan } of changedPlans) {
      const repairedFields = plan.repairs.map((repair) => repair.field);
      const observations = await Observation.find({
        entityType: { $in: ['researchEntity', 'researchGroup'] },
        $or: [{ entityId: entity._id }, { entityKey: entity.slug }],
        field: { $in: repairedFields },
        superseded: { $ne: true },
      }).lean();
      const set: PlainRecord = {};
      const unset: PlainRecord = {};
      for (const repair of plan.repairs) {
        set[repair.field] = repair.productionValue;
        const observation = matchingObservation(observations as PlainRecord[], repair.field, repair.productionValue);
        const provenance = observation
          ? {
              sourceId: observation.sourceId,
              sourceName: observation.sourceName,
              sourceUrl: observation.sourceUrl,
              observedAt: observation.observedAt,
              confidence: observation.confidence,
            }
          : recoveryProvenance(repair.field, repair.productionValue);
        set[`fieldProvenance.${repair.field}`] = provenance;
        set[`confidenceByField.${repair.field}`] = Number(provenance.confidence || 1);

        if (repair.field === 'websiteUrl') set.website = repair.productionValue;
        if (repair.field === 'departments') {
          const ids = strings(repair.productionValue)
            .map((label) => departmentByLabel.get(label.toLowerCase())?._id)
            .filter(Boolean);
          if (ids.length > 0) {
            set.departmentIds = ids;
            set.primaryDepartmentId = ids[0];
          } else {
            set.departmentIds = [];
            unset.primaryDepartmentId = '';
          }
        }
      }
      const precondition: PlainRecord = { _id: entity._id };
      for (const repair of plan.repairs) precondition[repair.field] = repair.betaValue;
      const update: PlainRecord = { $set: set };
      if (Object.keys(unset).length > 0) update.$unset = unset;
      const result = await ResearchEntity.updateOne(precondition, update);
      if (result.modifiedCount !== 1) {
        throw new Error(`Atomic repair precondition failed for ${plan.slug}`);
      }
      applied.push({ slug: plan.slug, name: plan.name, repairedFields, repairs: plan.repairs });
    }
  }

  const report = {
    generatedAt: new Date(),
    mode: args.apply ? 'apply' : 'dry-run',
    target,
    productionSource: PRODUCTION_API_ORIGIN,
    backup: args.backup,
    summary: {
      auditedEntities: cohort.length,
      productionMatches: comparisons.filter(({ production }) => production).length,
      productionMissing: comparisons.filter(({ production }) => !production).length,
      entitiesClassifiedAsRegression: changedPlans.length,
      entitiesChanged: applied.length,
      fieldChanges: (args.apply ? applied : changedPlans).reduce(
        (count, item: any) => count + (item.repairs?.length || item.plan?.repairs?.length || 0),
        0,
      ),
    },
    auditedImportFields: IMPORT_WRITTEN_FIELDS,
    changedLabs: args.apply
      ? applied
      : changedPlans.map(({ plan }) => ({
          slug: plan.slug,
          name: plan.name,
          repairedFields: plan.repairs.map((repair) => repair.field),
          repairs: plan.repairs,
        })),
    unchangedLabs: comparisons
      .filter(({ plan }) => plan.repairs.length === 0)
      .map(({ plan }) => ({
        slug: plan.slug,
        name: plan.name,
        productionStatus: plan.productionStatus,
        skippedFields: plan.skippedFields,
      })),
  };
  writeJson(args.output, report);
  console.log(JSON.stringify({ output: args.output, backup: args.backup, summary: report.summary }, null, 2));
  await mongoose.disconnect();
}

if (process.env.NODE_ENV !== 'test') {
  main().catch(async (error) => {
    console.error('July legacy medicine repair failed:', sanitizeLogValue(error));
    await mongoose.disconnect();
    process.exit(1);
  });
}

import fs from 'fs';
import path from 'path';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import type { CoverageObservationLike, CoverageSnippet } from '../scrapers/coverageSynthesis';
import { listResearchEntityMergedInRowsBySurvivor } from '../services/researchEntityCanonicalTombstone';
import { containsAsciiControl } from '../utils/asciiControl';
import { loadResearchEntityLeadPersonName } from '../utils/researchHomeNameIdentityRoster';
import { withPublicDescriptionGateFields } from '../services/researchEntityPublicDescription';
import type { ServingRowContext } from '../scrapers/utils/fullDescriptionServingBar';
import {
  INGEST_VERIFIED_EXTRACTION_SOURCE,
  PAGE_GROUNDING_VERIFIED_SINCE,
  WRITER_EVIDENCE_FIELDS,
  buildWriterEvidenceSnippets,
  ingestVerifiedRunIds,
  markIngestVerifiedObservations,
  writerObservationAnchors,
} from './coverageSynthesisCore';

export const WRITER_ENTITY_PROJECTION =
  'slug name entityType researchAreas recentGrants manuallyLockedFields shortDescription websiteUrl sourceUrls fieldValueRefusals';
/**
 * The writer's row read: its evidence fields, plus the serving bar's gate fields kept
 * apart under `servingEntity`, so the serving bar judges a draft in the row the
 * materializer judges it in while the evidence the writer reads stays exactly
 * `WRITER_ENTITY_PROJECTION`.
 */
export const WRITER_ENTITY_READ_PROJECTION =
  withPublicDescriptionGateFields(WRITER_ENTITY_PROJECTION);
const WRITER_ENTITY_FIELDS = ['_id', ...WRITER_ENTITY_PROJECTION.split(/\s+/)];

export function writerEntityRowOf(doc: Record<string, unknown>): WriterEntityRow {
  const row: WriterEntityRow = {};
  for (const field of WRITER_ENTITY_FIELDS) {
    if (Object.hasOwn(doc, field)) row[field] = doc[field];
  }
  row.servingEntity = doc;
  return row;
}
export const WRITER_OBSERVATION_PROJECTION =
  'field value sourceUrl sourceName confidence observedAt scrapeRunId superseded';

export type WriterObservation = CoverageObservationLike & { observedAt?: Date };
export type WriterEntityRow = Record<string, any>;

export interface WriterRowEvidence {
  slug: string;
  entity: WriterEntityRow;
  observations: WriterObservation[];
  mergedInObservations: WriterObservation[];
  leadNames?: string[];
}

export const WRITER_EVIDENCE_FILE_VERSION = 1;

export interface WriterEvidenceFile {
  version: typeof WRITER_EVIDENCE_FILE_VERSION;
  capturedAt: string;
  db: string;
  rows: WriterRowEvidence[];
}

export async function loadIngestVerifiedRunIds(): Promise<Set<string>> {
  return ingestVerifiedRunIds(
    (await ScrapeRun.find({
      sourceName: INGEST_VERIFIED_EXTRACTION_SOURCE,
      startedAt: { $gte: PAGE_GROUNDING_VERIFIED_SINCE },
      invalidated: { $ne: true },
    })
      .select('_id sourceName startedAt invalidated')
      .lean()) as Array<{ _id: unknown; sourceName?: unknown; startedAt?: unknown }>,
  );
}

export async function loadWriterObservations(
  anchors: Record<string, unknown>[],
  verifiedRunIds: ReadonlySet<string>,
): Promise<WriterObservation[]> {
  if (anchors.length === 0) return [];
  const observations = (await Observation.find({
    entityType: 'researchEntity',
    ...materializationReadScopeFilter(),
    field: { $in: WRITER_EVIDENCE_FIELDS },
    $or: anchors,
  })
    .select(WRITER_OBSERVATION_PROJECTION)
    .lean()) as unknown as WriterObservation[];
  return markIngestVerifiedObservations(
    observations.map(({ _id, ...rest }: WriterObservation & { _id?: unknown }) => rest),
    verifiedRunIds,
  );
}

export async function loadWriterEntitiesBySlug(
  slugs: readonly string[],
): Promise<WriterEntityRow[]> {
  const docs = (await ResearchEntity.find({ slug: { $in: [...slugs] }, archived: { $ne: true } })
    .select(WRITER_ENTITY_READ_PROJECTION)
    .lean()) as Record<string, unknown>[];
  return docs.map(writerEntityRowOf);
}

export function writerServingRow(row: {
  entity: WriterEntityRow;
  leadNames?: readonly string[];
}): ServingRowContext {
  const servingEntity = row.entity.servingEntity;
  return {
    entity:
      servingEntity && typeof servingEntity === 'object'
        ? (servingEntity as Record<string, unknown>)
        : row.entity,
    leadPersonName: row.leadNames?.[0] ?? '',
  };
}

export async function writerLeadNames(entityId: unknown): Promise<string[]> {
  const leadName = await loadResearchEntityLeadPersonName(entityId);
  return leadName ? [leadName] : [];
}

export async function loadWriterRowEvidence(
  entities: readonly WriterEntityRow[],
  verifiedRunIds: ReadonlySet<string>,
): Promise<WriterRowEvidence[]> {
  const mergedInBySurvivor = await listResearchEntityMergedInRowsBySurvivor(
    entities.map((entity) => entity._id),
  );
  const rows: WriterRowEvidence[] = [];
  for (const entity of entities) {
    const anchors = writerObservationAnchors({ entityKey: entity.slug, entityId: entity._id });
    const mergedInAnchors = (mergedInBySurvivor.get(String(entity._id)) ?? []).flatMap((row) =>
      writerObservationAnchors({ entityKey: row.slug, entityId: row._id }),
    );
    rows.push({
      slug: entity.slug,
      entity: { ...entity, _id: entity._id === undefined ? undefined : String(entity._id) },
      observations: await loadWriterObservations(anchors, verifiedRunIds),
      mergedInObservations: await loadWriterObservations(mergedInAnchors, verifiedRunIds),
      leadNames: await writerLeadNames(entity._id),
    });
  }
  return rows;
}

export function snippetsFromRowEvidence(row: WriterRowEvidence, now: Date): CoverageSnippet[] {
  const options = {
    websiteUrl: row.entity.websiteUrl,
    fieldValueRefusals: row.entity.fieldValueRefusals,
    entityType: row.entity.entityType,
    kind: row.entity.kind,
    identity: row.entity,
    leadNames: row.leadNames,
    now,
  };
  const own = buildWriterEvidenceSnippets(row.observations, row.entity.recentGrants, options);
  if (own.length > 0 || row.mergedInObservations.length === 0) return own;
  return buildWriterEvidenceSnippets(row.mergedInObservations, row.entity.recentGrants, options);
}

export function writerEvidenceFileOf(
  rows: readonly WriterRowEvidence[],
  capturedAt: Date,
  db: string,
): WriterEvidenceFile {
  return {
    version: WRITER_EVIDENCE_FILE_VERSION,
    capturedAt: capturedAt.toISOString(),
    db,
    rows: [...rows].sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

const revivedObservation = (obs: WriterObservation): WriterObservation => ({
  ...obs,
  ...(obs.observedAt ? { observedAt: new Date(obs.observedAt) } : {}),
});

export function parseWriterEvidenceFile(value: unknown): WriterEvidenceFile {
  const file = value as Partial<WriterEvidenceFile> | null;
  if (!file || file.version !== WRITER_EVIDENCE_FILE_VERSION || !Array.isArray(file.rows)) {
    throw new Error(
      `--evidence-file is not a version ${WRITER_EVIDENCE_FILE_VERSION} writer evidence file`,
    );
  }
  const capturedAt = new Date(String(file.capturedAt));
  if (!Number.isFinite(capturedAt.getTime())) throw new Error('--evidence-file has no capturedAt');
  return {
    version: WRITER_EVIDENCE_FILE_VERSION,
    capturedAt: capturedAt.toISOString(),
    db: String(file.db ?? ''),
    rows: file.rows.map((row) => ({
      slug: String(row.slug),
      entity: row.entity ?? { slug: row.slug },
      observations: (row.observations ?? []).map(revivedObservation),
      mergedInObservations: (row.mergedInObservations ?? []).map(revivedObservation),
      ...(Array.isArray(row.leadNames)
        ? { leadNames: row.leadNames.filter((name): name is string => typeof name === 'string') }
        : {}),
    })),
  };
}

export function readJsonInputFile(value: string, flag: string): unknown {
  const input = value.trim();
  if (!input || containsAsciiControl(input)) throw new Error(`${flag} requires a path`);
  const resolved = path.resolve(input);
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error(`${flag} must point to a .json file`);
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

export function readSlugsFile(value: string): string[] {
  const input = value.trim();
  if (!input || containsAsciiControl(input)) throw new Error('--slugs-file requires a path');
  const text = fs.readFileSync(path.resolve(input), 'utf8');
  const parsed: unknown = text.trimStart().startsWith('[') ? JSON.parse(text) : text.split('\n');
  if (!Array.isArray(parsed)) throw new Error('--slugs-file must list slugs');
  return [
    ...new Set(parsed.map((slug) => (typeof slug === 'string' ? slug.trim() : '')).filter(Boolean)),
  ];
}

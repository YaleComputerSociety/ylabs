import {
  EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY,
  LEGACY_EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEYS,
} from '../scrapers/accessMaterializer';

export interface DedupeExploratoryPathwaysArgs {
  apply: boolean;
  limit: number;
  entityId?: string;
}

export interface ExploratoryPathwayDedupeRow {
  _id: unknown;
  researchEntityId: unknown;
  derivationKey?: string;
}

export interface PlannedExploratoryPathwayDedupeGroup {
  researchEntityId: string;
  canonicalPathwayId: string;
  legacyPathwayIds: string[];
  legacyDerivationKeys: string[];
  promoteCanonical?: boolean;
}

export interface SkippedExploratoryPathwayDedupeGroup {
  researchEntityId: string;
  reason: 'missing-canonical-pathway';
  legacyPathwayIds: string[];
}

export interface ExploratoryPathwayDedupePlan {
  candidateGroups: number;
  plannedGroups: PlannedExploratoryPathwayDedupeGroup[];
  plannedLegacyPathways: number;
  skippedGroups: SkippedExploratoryPathwayDedupeGroup[];
}

const LEGACY_KEY_SET = new Set(LEGACY_EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEYS);

function valueAfterEquals(arg: string, flag: string): string | undefined {
  return arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
}

export function parseDedupeExploratoryPathwaysArgs(
  argv: string[],
): DedupeExploratoryPathwaysArgs {
  let apply = false;
  let limit = 100;
  let entityId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }

    const limitValue = valueAfterEquals(arg, '--limit') || (arg === '--limit' ? argv[++index] : '');
    if (limitValue) {
      const parsed = Number(limitValue);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      continue;
    }

    const entityValue =
      valueAfterEquals(arg, '--entity-id') || (arg === '--entity-id' ? argv[++index] : '');
    if (entityValue) {
      entityId = entityValue;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return entityId ? { apply, limit, entityId } : { apply, limit };
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function buildExploratoryPathwayDedupePlan(
  rows: ExploratoryPathwayDedupeRow[],
): ExploratoryPathwayDedupePlan {
  const byEntity = new Map<string, ExploratoryPathwayDedupeRow[]>();

  for (const row of rows) {
    const researchEntityId = stringId(row.researchEntityId);
    if (!researchEntityId || !row.derivationKey) continue;
    const existing = byEntity.get(researchEntityId) || [];
    existing.push(row);
    byEntity.set(researchEntityId, existing);
  }

  const plannedGroups: PlannedExploratoryPathwayDedupeGroup[] = [];
  const skippedGroups: SkippedExploratoryPathwayDedupeGroup[] = [];

  for (const [researchEntityId, entityRows] of byEntity) {
    const canonical = entityRows.find(
      (row) => row.derivationKey === EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY,
    );
    const legacyRows = entityRows.filter(
      (row) =>
        row.derivationKey !== EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY &&
        (LEGACY_KEY_SET.has(row.derivationKey || '') ||
          (row.derivationKey || '').startsWith('pathway:EXPLORATORY_CONTACT:')),
    );

    if (legacyRows.length === 0) continue;
    const legacyPathwayIds = legacyRows.map((row) => stringId(row._id)).filter(Boolean);
    const legacyDerivationKeys = Array.from(
      new Set(legacyRows.map((row) => row.derivationKey).filter(Boolean) as string[]),
    );

    if (!canonical && legacyRows.length > 1) {
      plannedGroups.push({
        researchEntityId,
        canonicalPathwayId: legacyPathwayIds[0],
        legacyPathwayIds: legacyPathwayIds.slice(1),
        legacyDerivationKeys,
        promoteCanonical: true,
      });
      continue;
    }

    if (!canonical) {
      skippedGroups.push({
        researchEntityId,
        reason: 'missing-canonical-pathway',
        legacyPathwayIds,
      });
      continue;
    }

    plannedGroups.push({
      researchEntityId,
      canonicalPathwayId: stringId(canonical._id),
      legacyPathwayIds,
      legacyDerivationKeys,
    });
  }

  return {
    candidateGroups: byEntity.size,
    plannedGroups,
    plannedLegacyPathways: plannedGroups.reduce(
      (count, group) => count + group.legacyPathwayIds.length,
      0,
    ),
    skippedGroups,
  };
}

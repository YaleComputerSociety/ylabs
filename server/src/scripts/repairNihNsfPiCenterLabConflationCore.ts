import { labDescriptionFromRecentGrants } from '../scrapers/sources/nihReporterScraper';

/**
 * A grant-derived PI shell (`nih-pi-*`/`nsf-pi-*`) carries only that PI's own
 * funded-research identity. When its `kind` still resolves to 'lab' (the PI's
 * own grant evidence) but `entityType` was independently pinned to an
 * institutional type by a stale `official-profile-pi-backfill` observation,
 * the two fields disagree and the entity serves as a "<PI> Lab" hybrid
 * carrying an unrelated center's description (issue #1484).
 */
export const GRANT_DERIVED_PI_SHELL_SLUG_RE = /^(?:nih-pi-|nsf-pi-)/;
const BARE_PERSON_LAB_NAME_RE = /\bLab$/i;

export const CONFLATION_SOURCE_NAME = 'official-profile-pi-backfill';
export const CONFLATED_DESCRIPTION_SOURCE_NAME = 'lab-microsite-description-llm';
export const REPAIR_SOURCE_NAME = 'nih-nsf-pi-center-lab-conflation-repair';
const CONFLATION_OBSERVED_FIELDS = ['entityType', 'kind', 'website', 'websiteUrl', 'displayName'];

export interface ConflationEntity {
  id: string;
  slug?: unknown;
  name?: unknown;
  kind?: unknown;
  entityType?: unknown;
  websiteUrl?: unknown;
  fullDescription?: unknown;
  shortDescription?: unknown;
  recentGrants?: Array<{ url?: unknown; abstract?: unknown }> | null;
  sourceUrls?: unknown;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function isNihNsfPiCenterLabConflation(entity: ConflationEntity): boolean {
  const slug = textValue(entity.slug);
  if (!GRANT_DERIVED_PI_SHELL_SLUG_RE.test(slug)) return false;
  if (entity.kind !== 'lab') return false;
  if (entity.entityType === 'LAB') return false;
  return BARE_PERSON_LAB_NAME_RE.test(textValue(entity.name));
}

export interface ConflationRepairPlan {
  id: string;
  slug?: string;
  name?: string;
  entityTypeBefore?: string;
  websiteUrlBefore?: string;
  fullDescriptionBefore?: string;
  fullDescriptionAfter: string;
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  supersedeObservationFilter: {
    entityId: string;
    sourceName: string;
    field: { $in: string[] };
  };
  supersedeDescriptionFilter?: {
    entityId: string;
    sourceName: string;
    field: { $in: string[] };
    sourceUrl: string;
  };
}

export function planNihNsfPiCenterLabConflationRepair(
  entity: ConflationEntity,
  now: Date,
): ConflationRepairPlan | null {
  if (!isNihNsfPiCenterLabConflation(entity)) return null;

  const grants = Array.isArray(entity.recentGrants) ? entity.recentGrants : [];
  const grantDescription = labDescriptionFromRecentGrants(
    grants.map((grant) => ({ ...grant, abstract: textValue(grant?.abstract) })) as any,
  );
  const evidenceUrl =
    textValue(grants[0]?.url) ||
    (Array.isArray(entity.sourceUrls) ? textValue(entity.sourceUrls[0]) : '') ||
    '';

  const provenance = (confidence: number) => ({
    sourceName: REPAIR_SOURCE_NAME,
    sourceUrl: evidenceUrl,
    observedAt: now,
    confidence,
  });

  const set: Record<string, unknown> = {
    entityType: 'LAB',
    'fieldProvenance.entityType': provenance(0.95),
    'confidenceByField.entityType': 0.95,
  };
  const unset: Record<string, ''> = {
    website: '',
    websiteUrl: '',
    displayName: '',
    'fieldProvenance.website': '',
    'fieldProvenance.websiteUrl': '',
    'fieldProvenance.displayName': '',
    'confidenceByField.website': '',
    'confidenceByField.websiteUrl': '',
    'confidenceByField.displayName': '',
  };

  if (grantDescription) {
    set.fullDescription = grantDescription;
    set.shortDescription = grantDescription;
    set['fieldProvenance.fullDescription'] = provenance(0.6);
    set['fieldProvenance.shortDescription'] = provenance(0.6);
    set['confidenceByField.fullDescription'] = 0.6;
    set['confidenceByField.shortDescription'] = 0.6;
  } else {
    unset.fullDescription = '';
    unset.shortDescription = '';
    unset['fieldProvenance.fullDescription'] = '';
    unset['fieldProvenance.shortDescription'] = '';
    unset['confidenceByField.fullDescription'] = '';
    unset['confidenceByField.shortDescription'] = '';
  }

  const websiteUrlBefore = textValue(entity.websiteUrl);

  return {
    id: entity.id,
    slug: textValue(entity.slug) || undefined,
    name: textValue(entity.name) || undefined,
    entityTypeBefore: textValue(entity.entityType) || undefined,
    websiteUrlBefore: websiteUrlBefore || undefined,
    fullDescriptionBefore: textValue(entity.fullDescription) || undefined,
    fullDescriptionAfter: grantDescription,
    set,
    unset,
    supersedeObservationFilter: {
      entityId: entity.id,
      sourceName: CONFLATION_SOURCE_NAME,
      field: { $in: CONFLATION_OBSERVED_FIELDS },
    },
    ...(websiteUrlBefore
      ? {
          supersedeDescriptionFilter: {
            entityId: entity.id,
            sourceName: CONFLATED_DESCRIPTION_SOURCE_NAME,
            field: { $in: ['fullDescription', 'shortDescription'] },
            sourceUrl: websiteUrlBefore,
          },
        }
      : {}),
  };
}

export interface ConflationRepairSummary {
  scanned: number;
  changed: number;
  descriptionRegrounded: number;
  descriptionCleared: number;
}

export function summarizeNihNsfPiCenterLabConflationRepair(
  plans: Array<ConflationRepairPlan | null>,
): ConflationRepairSummary {
  const changed = plans.filter((plan): plan is ConflationRepairPlan => plan !== null);
  return {
    scanned: plans.length,
    changed: changed.length,
    descriptionRegrounded: changed.filter((plan) => plan.fullDescriptionAfter).length,
    descriptionCleared: changed.filter((plan) => !plan.fullDescriptionAfter).length,
  };
}

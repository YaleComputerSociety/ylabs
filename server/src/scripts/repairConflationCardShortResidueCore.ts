import {
  GRANT_DERIVED_PI_SHELL_SLUG_RE,
  REPAIR_SOURCE_NAME,
  deriveConflationCardShortDescription,
} from './repairNihNsfPiCenterLabConflationCore';

export const CARD_RESIDUE_REPAIR_SOURCE_NAME = 'nih-nsf-pi-center-lab-conflation-card-repair';

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export interface CardResidueEntity {
  id: string;
  slug?: unknown;
  fullDescription?: unknown;
  shortDescription?: unknown;
  researchAreas?: unknown;
  shortDescriptionProvenanceSource?: unknown;
}

export interface CardResidueRepairPlan {
  id: string;
  slug?: string;
  shortBefore: string;
  shortAfter: string;
  set: Record<string, unknown>;
}

/**
 * The conflation repair (see repairNihNsfPiCenterLabConflationCore) historically
 * copied a PI's full grant abstract into shortDescription, leaving a regrounded
 * `nih-pi-*`/`nsf-pi-*` lab stalled at missing_card_description. Those entities
 * were already flipped to entityType 'LAB', so the conflation repair no longer
 * re-touches them; this residue repair re-derives a card-shaped short (grounded
 * in the entity's curated researchAreas) for exactly that provenance signature.
 * Returns null when the entity is not residue or no card can be grounded, so the
 * caller fails closed rather than overwriting a good short.
 */
export function planConflationCardShortResidueRepair(
  entity: CardResidueEntity,
  now: Date,
): CardResidueRepairPlan | null {
  const slug = textValue(entity.slug);
  if (!GRANT_DERIVED_PI_SHELL_SLUG_RE.test(slug)) return null;
  if (textValue(entity.shortDescriptionProvenanceSource) !== REPAIR_SOURCE_NAME) return null;

  const full = textValue(entity.fullDescription);
  const short = textValue(entity.shortDescription);
  const cardShort = deriveConflationCardShortDescription(full, entity.researchAreas);
  if (!cardShort || cardShort === short) return null;

  return {
    id: entity.id,
    slug: slug || undefined,
    shortBefore: short,
    shortAfter: cardShort,
    set: {
      shortDescription: cardShort,
      'fieldProvenance.shortDescription': {
        sourceName: CARD_RESIDUE_REPAIR_SOURCE_NAME,
        sourceUrl: '',
        observedAt: now,
        confidence: 0.6,
      },
      'confidenceByField.shortDescription': 0.6,
    },
  };
}

export interface CardResidueRepairSummary {
  scanned: number;
  changed: number;
}

export function summarizeConflationCardShortResidueRepair(
  plans: Array<CardResidueRepairPlan | null>,
): CardResidueRepairSummary {
  return {
    scanned: plans.length,
    changed: plans.filter((plan): plan is CardResidueRepairPlan => plan !== null).length,
  };
}

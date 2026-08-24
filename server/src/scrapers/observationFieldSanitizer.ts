/**
 * Shared ingest-time extraction sanitizer for scraped observation fields.
 *
 * Every scraper writes through `observationStore.appendObservations`, so this is
 * the single choke point where page furniture can be stripped and label/section
 * text rejected before it is ever stored - regardless of which source produced
 * it. It exists to end the per-source `fix(scrapers)` patch class (#1375): a new
 * or existing scraper cannot re-leak nav/menu chrome into a person title, a
 * section label into a research-area list, glued address/description residue into
 * an entity name, script/style furniture into a description, or a raw
 * email/phone into a stored description or quote, because the leak is caught here
 * for all sources at once rather than in each scraper.
 *
 * It composes the existing hygiene utilities rather than restating their rules,
 * so the ingest guard and the materialize/serve guards stay single-sourced.
 * Type-overloaded fields are scoped by `entityType` (person `title` is a role
 * string only on a `user`; a fellowship/paper `title` is a proper name), and
 * only the leak-prone text fields are sanitized; structured identifier fields
 * (URLs, ids, enums, emails kept for internal contact derivation) pass through
 * untouched so nothing this layer does can corrupt a field that legitimately
 * carries a value it would otherwise redact.
 */
import type { ObservedEntityType } from '../models/observation';
import {
  sanitizePersonTitle,
  isNavMenuChromeTitle,
  isSectionLabelTitle,
  hasRawEmailAddress,
  hasStreetAddressFragment,
  hasPhoneContactFragment,
} from '../utils/titleHygiene';
import {
  stripCatalogChrome,
  containsHtmlTagMarkup,
  normalizeHygieneWhitespace,
  isContentlessResearchProjectsBoilerplateText,
} from '../utils/descriptionHygiene';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeResearchAreaLabelList } from '../utils/researchAreaLabelHygiene';
import { isResearchAreaLabelLeakage } from './researchAreaCanonicalization';
import { isResearchSectionLabel } from './researchAreaLabels';
import {
  normalizeResearchEntityNameDashes,
  stripTrailingResearchHomeDescription,
  collapseDuplicateResearchHomeSuffix,
} from '../utils/researchEntityNameNormalization';

export interface SanitizedObservationField {
  value: unknown;
  rejected: boolean;
  reason?: string;
}

const ENTITY_NAME_FIELDS = new Set(['name', 'displayName']);
const RESEARCH_AREA_LIST_FIELDS = new Set(['researchAreas', 'topics', 'researchInterests']);
const PROSE_FIELDS = new Set(['fullDescription', 'shortDescription']);
const CONTACT_REDACTED_QUOTE_FIELDS = new Set([
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'undergradConstraintQuote',
  'contactInstructionsQuote',
]);

function isResearchEntityObservationType(entityType: ObservedEntityType): boolean {
  return entityType === 'researchEntity' || entityType === 'researchGroup';
}

function accepted(value: unknown): SanitizedObservationField {
  return { value, rejected: false };
}

function rejected(reason: string): SanitizedObservationField {
  return { value: undefined, rejected: true, reason };
}

function sanitizePersonTitleField(value: string): SanitizedObservationField {
  const clean = sanitizePersonTitle(value);
  return clean ? accepted(clean) : rejected('person-title-furniture');
}

function normalizeEntityName(value: string): string {
  return normalizeResearchEntityNameDashes(
    collapseDuplicateResearchHomeSuffix(stripTrailingResearchHomeDescription(value)),
  );
}

function isEntityNameFurniture(value: string): boolean {
  return (
    isNavMenuChromeTitle(value) ||
    isSectionLabelTitle(value) ||
    hasRawEmailAddress(value) ||
    hasStreetAddressFragment(value) ||
    hasPhoneContactFragment(value) ||
    containsHtmlTagMarkup(value)
  );
}

function sanitizeEntityNameField(value: string): SanitizedObservationField {
  const normalized = normalizeEntityName(value);
  if (!normalizeHygieneWhitespace(normalized)) return rejected('entity-name-empty');
  if (isEntityNameFurniture(normalized)) return rejected('entity-name-furniture');
  return accepted(normalized);
}

function sanitizeResearchAreaListField(value: unknown): SanitizedObservationField {
  if (!Array.isArray(value)) return accepted(value);
  const cleaned = sanitizeResearchAreaLabelList(value).filter(
    (label) => !isResearchAreaLabelLeakage(label) && !isResearchSectionLabel(label),
  );
  return cleaned.length > 0 ? accepted(cleaned) : rejected('research-area-label-leakage');
}

function sanitizeProseField(value: string): SanitizedObservationField {
  const cleaned = normalizeHygieneWhitespace(stripCatalogChrome(redactDirectContactInfo(value)));
  if (!cleaned) return rejected('prose-chrome-only');
  if (isContentlessResearchProjectsBoilerplateText(cleaned)) {
    return rejected('contentless-research-projects-boilerplate');
  }
  return accepted(cleaned);
}

/**
 * Sanitize a single observation field value against its leak class. Returns a
 * cleaned value to store, or `rejected` when the value is pure page furniture /
 * label-section text and no observation should be written for it. Any field not
 * in a leak-prone class for this entity type, and any non-string value where a
 * string is expected, passes through unchanged so this layer never corrupts
 * structured data.
 */
export function sanitizeObservationField(
  entityType: ObservedEntityType,
  field: string,
  value: unknown,
): SanitizedObservationField {
  const isResearchEntity = isResearchEntityObservationType(entityType);
  if (isResearchEntity && RESEARCH_AREA_LIST_FIELDS.has(field)) {
    return sanitizeResearchAreaListField(value);
  }
  if (typeof value !== 'string') return accepted(value);
  if (entityType === 'user' && field === 'title') return sanitizePersonTitleField(value);
  if (isResearchEntity && ENTITY_NAME_FIELDS.has(field)) return sanitizeEntityNameField(value);
  if (PROSE_FIELDS.has(field)) return sanitizeProseField(value);
  if (CONTACT_REDACTED_QUOTE_FIELDS.has(field)) {
    return accepted(normalizeHygieneWhitespace(redactDirectContactInfo(value)));
  }
  return accepted(value);
}

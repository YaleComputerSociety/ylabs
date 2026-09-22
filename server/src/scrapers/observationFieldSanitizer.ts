/**
 * Shared ingest-time extraction sanitizer for scraped observation fields.
 *
 * Every scraper writes through `observationStore.appendObservations`, so this is
 * the single choke point where page furniture can be stripped and label/section
 * text rejected before it is ever stored - regardless of which source produced
 * it. It exists to end the per-source `fix(scrapers)` patch class (#1375): a new
 * or existing scraper cannot re-leak nav/menu chrome into a person title, an
 * image caption or a post-nominal credential list into a person NAME, a
 * section label into a research-area list, glued address/description residue into
 * an entity name, script/style furniture into a description, or a raw
 * email/phone into a stored description or quote, because the leak is caught here
 * for all sources at once rather than in each scraper.
 *
 * It is also where invisible Unicode format characters are stripped from scraped
 * text, for every field and every source at once, so a soft hyphen cannot reach a
 * stored title and silently defeat the classifiers that read it (#2874).
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
import { sanitizePersonName } from '../utils/personNameHygiene';
import { stripInvisibleFormatCharacters } from '../utils/invisibleFormatCharacters';
import { sanitizeResearchAreaLabelList } from '../utils/researchAreaLabelHygiene';
import { isResearchAreaLabelLeakage } from './researchAreaCanonicalization';
import {
  isNonIdentifyingLinkLabelName,
  isPersonPageLinkLabelName,
  stripResearchHomeNameLinkChrome,
  isPlaceholderEntityName,
  stripResearchHomeNameLinkWrapper,
  isExternalScholarlyPlatformLinkLabelName,
} from '../utils/researchHomeNameIdentityAuthority';
import { isResearchSectionLabel } from './researchAreaLabels';
import {
  normalizeResearchEntityNameDashes,
  normalizeResearchEntityNameSmartQuotes,
  stripTrailingResearchHomeDescription,
  collapseDuplicateResearchHomeSuffix,
} from '../utils/researchEntityNameNormalization';

export interface SanitizedObservationField {
  value: unknown;
  rejected: boolean;
  reason?: string;
}

const ENTITY_NAME_FIELDS = new Set(['name', 'displayName']);
const PERSON_NAME_FIELDS = new Set(['displayName', 'fname', 'lname']);
const RESEARCH_AREA_LIST_FIELDS = new Set(['researchAreas', 'topics', 'researchInterests']);
const PROSE_FIELDS = new Set(['fullDescription', 'shortDescription']);

/**
 * The research-entity fields this sanitizer can REJECT outright, as opposed to
 * clean in place. Exported because a field's absence from a run is only evidence
 * about the page when the store could not have dropped the value itself: any
 * consumer inferring "the source stopped asserting this" (#2542) has to exclude
 * these, or an ingest rejection reads as a retraction and deletes the value the
 * rejection existed to protect.
 */
export const INGEST_REJECTABLE_RESEARCH_ENTITY_FIELDS: ReadonlySet<string> = new Set([
  ...ENTITY_NAME_FIELDS,
  ...RESEARCH_AREA_LIST_FIELDS,
  ...PROSE_FIELDS,
]);
/**
 * The `user` name fields this sanitizer can REJECT outright. Kept apart from the
 * research-entity set because the two are scoped by different entity types, and
 * exported for the same reason: a rejected name reads from the log exactly like a
 * name the source stopped asserting, so no retraction contract may declare one
 * (`isIngestDroppableObservationField`).
 */
export const INGEST_REJECTABLE_PERSON_NAME_FIELDS: ReadonlySet<string> = new Set([
  ...PERSON_NAME_FIELDS,
]);

const CONTACT_REDACTED_QUOTE_FIELDS = new Set([
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'undergradConstraintQuote',
  'contactInstructionsQuote',
]);

function isResearchEntityObservationType(entityType: ObservedEntityType): boolean {
  return entityType === 'researchEntity';
}

/**
 * Only a plain object is walked into. An observation value can hold a `Date` or an
 * `ObjectId`, and rebuilding either from its own entries would replace it with an
 * empty object, so anything carrying its own prototype is returned untouched.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Applied to every field before its leak class is consulted, because an invisible
 * format character is not a leak class: it can arrive in a title, a name, a
 * description, a research-area label, a grant abstract nested inside
 * `recentGrants`, or a URL, and no per-field rule would cover all of them.
 *
 * Key order is preserved, because the materializer's diff-skip compares projected
 * values by `JSON.stringify` and a reordered object would read as a change.
 */
export function withInvisibleFormatCharactersStripped(value: unknown): unknown {
  if (typeof value === 'string') return stripInvisibleFormatCharacters(value);
  if (Array.isArray(value)) return value.map(withInvisibleFormatCharactersStripped);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        withInvisibleFormatCharactersStripped(entry),
      ]),
    );
  }
  return value;
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

function sanitizePersonNameField(value: string): SanitizedObservationField {
  const clean = sanitizePersonName(value);
  return clean ? accepted(clean) : rejected('person-name-furniture');
}

function normalizeEntityName(value: string): string {
  return normalizeResearchEntityNameSmartQuotes(
    normalizeResearchEntityNameDashes(
      collapseDuplicateResearchHomeSuffix(
        stripTrailingResearchHomeDescription(
          stripResearchHomeNameLinkChrome(stripResearchHomeNameLinkWrapper(value)),
        ),
      ),
    ),
  );
}

function isEntityNameFurniture(value: string): boolean {
  return (
    isNavMenuChromeTitle(value) ||
    isSectionLabelTitle(value) ||
    isNonIdentifyingLinkLabelName(value) ||
    // The anchor text of a link to a person's own page. The word-level rule above
    // cannot catch it, because a surname is not a generic navigation word (#2752).
    isPersonPageLinkLabelName(value) ||
    // A profile's links section labels its outbound link with the platform's brand,
    // and the word-level link-label rule cannot catch it: "google" and "scholar"
    // are not generic navigation words (#2285).
    isExternalScholarlyPlatformLinkLabelName(value) ||
    isPlaceholderEntityName(value) ||
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
  rawValue: unknown,
): SanitizedObservationField {
  const value = withInvisibleFormatCharactersStripped(rawValue);
  const isResearchEntity = isResearchEntityObservationType(entityType);
  if (isResearchEntity && RESEARCH_AREA_LIST_FIELDS.has(field)) {
    return sanitizeResearchAreaListField(value);
  }
  if (typeof value !== 'string') return accepted(value);
  if (entityType === 'user' && field === 'title') return sanitizePersonTitleField(value);
  if (entityType === 'user' && PERSON_NAME_FIELDS.has(field)) return sanitizePersonNameField(value);
  if (isResearchEntity && ENTITY_NAME_FIELDS.has(field)) return sanitizeEntityNameField(value);
  if (PROSE_FIELDS.has(field)) return sanitizeProseField(value);
  if (CONTACT_REDACTED_QUOTE_FIELDS.has(field)) {
    return accepted(normalizeHygieneWhitespace(redactDirectContactInfo(value)));
  }
  return accepted(value);
}

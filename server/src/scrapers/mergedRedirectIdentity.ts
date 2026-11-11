import { personNameFromEntityName } from '../scripts/attachFraNamedLeadsCore';
import { leadIsTheRecordSubjectFor } from './utils/labSiteLeadVerification';
import { listedPersonIsTheNamedLead, personNamesShareASurname } from './utils/personNameAgreement';

export interface MergedRedirectRow {
  name?: unknown;
  entityType?: unknown;
  kind?: unknown;
}

export interface MergedRedirectLead {
  displayName?: unknown;
  netid?: unknown;
  profileDestinations: readonly string[];
}

export interface MergedRedirectListing extends MergedRedirectRow {
  slug: string;
  netids: readonly string[];
  pageDestinations: readonly string[];
}

export type MergedRedirectAdmission =
  'not-a-person-redirect' | 'name-agrees' | 'netid-witness' | 'page-witness' | 'refused';

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function isPersonRow(row: MergedRedirectRow): boolean {
  return leadIsTheRecordSubjectFor(row.entityType);
}

export function personNamedByRow(row: MergedRedirectRow): string {
  return personNameFromEntityName(row.name) || textOf(row.name);
}

/**
 * A row titled after a lab or a project names no lead, and then its one lead is the person
 * it is about. A row holding several leads and naming none has no lead to vouch for it, and
 * neither does a row whose one lead is a same-surname namesake of the person in its title,
 * because that lead is how a prefix-built merge would vouch for itself.
 */
export function leadsTheRowIsNamedAfter<Lead extends MergedRedirectLead>(
  survivor: MergedRedirectRow,
  leads: readonly Lead[],
): Lead[] {
  const rowPerson = personNamedByRow(survivor);
  if (!rowPerson) return [];
  const named = leads.filter((lead) => listedPersonIsTheNamedLead(lead.displayName, rowPerson));
  if (named.length > 0) return named;
  if (leads.length !== 1 || personNamesShareASurname(leads[0].displayName, rowPerson)) return [];
  return [...leads];
}

/**
 * Whether a merged-away row's listing may carry its evidence onto the survivor (#5771).
 *
 * A lane keys a person row by the listed name, so everything filed under a merged-away
 * person key lists that one person. Only the lead the survivor is named after can vouch
 * for it: an any-lead witness spared the rows whose survivor also holds the other person
 * as a lead, which is how most of the measured mixed rows arose.
 */
export function mergedRedirectAdmission(
  survivor: MergedRedirectRow,
  namedLeads: readonly MergedRedirectLead[],
  listing: MergedRedirectListing,
): MergedRedirectAdmission {
  if (!isPersonRow(survivor) || !isPersonRow(listing)) return 'not-a-person-redirect';
  const rowPerson = personNamedByRow(survivor);
  if (!rowPerson) return 'not-a-person-redirect';
  const listedPerson = personNamedByRow(listing);
  if (
    listedPersonIsTheNamedLead(listedPerson, rowPerson) ||
    namedLeads.some((lead) => listedPersonIsTheNamedLead(listedPerson, lead.displayName))
  ) {
    return 'name-agrees';
  }
  const leadNetids = new Set(
    namedLeads.map((lead) => textOf(lead.netid).toLowerCase()).filter(Boolean),
  );
  if (listing.netids.some((netid) => leadNetids.has(netid.toLowerCase()))) return 'netid-witness';
  const leadPages = new Set(namedLeads.flatMap((lead) => lead.profileDestinations).filter(Boolean));
  if (listing.pageDestinations.some((page) => leadPages.has(page))) return 'page-witness';
  return 'refused';
}

import { LEAD_ROLE_CANONICAL_VALUES } from '../../models/canonicalRoleMapping';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { mongooseConnectionWasOpened } from '../../utils/mongooseConnectionWasOpened';
import { normalizeWebsiteUrlIdentityKey } from '../../utils/websiteUrlIdentityKey';

export interface CoLedSiteLead {
  emails: string[];
  netids: string[];
  profileUrlKeys: string[];
}

export interface CoLedSiteRow {
  slug: string;
  leads: CoLedSiteLead[];
}

export type CoLedSiteIndex = ReadonlyMap<string, readonly CoLedSiteRow[]>;

export interface ProfilePersonIdentity {
  email?: string;
  netid?: string;
  profileUrl?: string;
}

export type LabUrlIsCoLedGroupSite = (url: string) => boolean;

export const NO_CO_LED_SITES: CoLedSiteIndex = new Map();

const lowerTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function leadIsThePerson(lead: CoLedSiteLead, person: ProfilePersonIdentity): boolean {
  const email = lowerTrimmed(person.email);
  const netid = lowerTrimmed(person.netid);
  const profileKey = normalizeWebsiteUrlIdentityKey(person.profileUrl);
  return (
    (Boolean(email) && lead.emails.includes(email)) ||
    (Boolean(netid) && lead.netids.includes(netid)) ||
    (Boolean(profileKey) && lead.profileUrlKeys.includes(profileKey))
  );
}

/**
 * The row the lane mints for the person is not evidence about itself, so `ownSlug` never
 * counts as the owner; without that, a co-led lab minted under one lead's key would demote
 * itself on that lead's next read (#5979).
 */
export function labUrlIsCoLedGroupSiteOf(
  index: CoLedSiteIndex,
  url: string,
  ownSlug: string,
  person: ProfilePersonIdentity,
): boolean {
  const key = normalizeWebsiteUrlIdentityKey(url);
  if (!key) return false;
  return (index.get(key) ?? []).some(
    (row) =>
      row.slug !== ownSlug &&
      row.leads.length >= 2 &&
      row.leads.some((lead) => leadIsThePerson(lead, person)),
  );
}

export function coLedGroupSiteFor(
  index: CoLedSiteIndex,
  ownSlug: string,
  person: ProfilePersonIdentity,
): LabUrlIsCoLedGroupSite {
  return (url: string) => labUrlIsCoLedGroupSiteOf(index, url, ownSlug, person);
}

const textValues = (...values: unknown[]): string[] => [
  ...new Set(values.map(lowerTrimmed).filter(Boolean)),
];

function leadFromResearcher(researcher: any): CoLedSiteLead {
  const links: unknown[] = Array.isArray(researcher?.profileLinks)
    ? researcher.profileLinks.map((link: any) => link?.url)
    : [];
  return {
    emails: textValues(researcher?.identifiers?.email),
    netids: textValues(researcher?.identifiers?.netid),
    profileUrlKeys: [
      ...new Set(
        links
          .map((link) => normalizeWebsiteUrlIdentityKey(typeof link === 'string' ? link : ''))
          .filter(Boolean),
      ),
    ],
  };
}

/**
 * Read once per run. No connection reads as no co-led sites, the same state as a corpus
 * with none, so a lane's identity decision does not depend on whether its caller opened a
 * database and its own `run()` unit tests need none.
 */
export async function loadCoLedSiteIndex(): Promise<CoLedSiteIndex> {
  if (!mongooseConnectionWasOpened()) return NO_CO_LED_SITES;
  const edges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: [...LEAD_ROLE_CANONICAL_VALUES] },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('personId target.id')
    .lean()) as Array<{ personId?: unknown; target?: { id?: unknown } }>;
  const peopleByRowId = new Map<string, Set<string>>();
  for (const edge of edges) {
    const rowId = String(edge.target?.id ?? '');
    const personId = String(edge.personId ?? '');
    if (!rowId || !personId) continue;
    peopleByRowId.set(rowId, (peopleByRowId.get(rowId) ?? new Set()).add(personId));
  }
  const coLedRowIds = [...peopleByRowId].filter(([, people]) => people.size >= 2).map(([id]) => id);
  if (coLedRowIds.length === 0) return NO_CO_LED_SITES;
  const rows = (await ResearchEntity.find({
    _id: { $in: coLedRowIds },
    archived: { $ne: true },
    websiteUrl: { $type: 'string', $ne: '' },
  })
    .select('_id slug websiteUrl')
    .lean()) as Array<{ _id: unknown; slug?: string; websiteUrl?: string }>;
  const personIds = [
    ...new Set(rows.flatMap((row) => [...(peopleByRowId.get(String(row._id)) ?? [])])),
  ];
  const researchers = (await Researcher.find({ _id: { $in: personIds }, archived: { $ne: true } })
    .select('_id identifiers.email identifiers.netid profileLinks.url')
    .lean()) as any[];
  const leadByPersonId = new Map(
    researchers.map((researcher) => [String(researcher._id), leadFromResearcher(researcher)]),
  );
  const index = new Map<string, CoLedSiteRow[]>();
  for (const row of rows) {
    const key = normalizeWebsiteUrlIdentityKey(row.websiteUrl);
    if (!key || !row.slug) continue;
    const leads = [...(peopleByRowId.get(String(row._id)) ?? [])]
      .map((personId) => leadByPersonId.get(personId))
      .filter((lead): lead is CoLedSiteLead => Boolean(lead));
    index.set(key, [...(index.get(key) ?? []), { slug: row.slug, leads }]);
  }
  return index;
}

export type CoLedSiteIndexLoader = typeof loadCoLedSiteIndex;

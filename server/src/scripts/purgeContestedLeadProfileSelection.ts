import {
  detectProfileIdentityRisk,
  entityOfficialPersonProfileDestinations,
  officialProfileUrlFromRosterEntry,
} from '../services/leadProfileIdentity';
import type { ResearchEntityRosterEntry } from '../services/researchEntityMembershipAccessor';
import { serializedDocumentId } from '../utils/idSerialization';

export const CONTESTED_LEAD_ENTITY_SELECT =
  '_id slug name kind entityType websiteUrl website sourceUrls researchAreas description shortDescription fullDescription studentVisibilityTier';

const LEAD_ROSTER_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

export interface ContestedLeadRow {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string;
  currentTier: unknown;
}

export const leadMembersFromRoster = (
  roster: ResearchEntityRosterEntry[],
): Array<Record<string, unknown>> =>
  roster
    .filter((entry) => LEAD_ROSTER_ROLES.has(entry.role) && entry.state !== 'HISTORICAL')
    .map((entry) => {
      const officialProfileUrl = officialProfileUrlFromRosterEntry(entry);
      return {
        name: entry.name,
        user: {
          netid: entry.netid,
          displayName: entry.name,
          ...(entry.websiteUrl ? { websiteUrl: entry.websiteUrl } : {}),
          ...(officialProfileUrl ? { profileUrls: { official: officialProfileUrl } } : {}),
        },
      };
    });

export const entityCarriesPersonProfileIdentity = (entity: Record<string, unknown>): boolean =>
  entityOfficialPersonProfileDestinations(entity).size > 0;

export const selectContestedLeadEntities = (
  entities: Array<Record<string, unknown>>,
  rosterByEntityId: Map<string, ResearchEntityRosterEntry[]>,
): ContestedLeadRow[] => {
  const idOf = (value: unknown): string => serializedDocumentId(value) || '';
  return entities
    .filter((entity) => {
      const roster = rosterByEntityId.get(idOf(entity._id)) || [];
      return detectProfileIdentityRisk({ entity, leadMembers: leadMembersFromRoster(roster) });
    })
    .map((entity) => ({
      id: idOf(entity._id),
      slug: String(entity.slug ?? ''),
      name: String(entity.name ?? ''),
      websiteUrl: String(entity.websiteUrl || entity.website || ''),
      currentTier: entity.studentVisibilityTier,
    }))
    .filter((row) => Boolean(row.id));
};

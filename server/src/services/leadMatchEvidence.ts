import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { plausiblePersonOrcid } from '../utils/orcid';
import {
  entityOfficialPersonProfileDestinations,
  entityOfficialPersonProfileUrls,
  isLikelyOfficialPersonProfileUrl,
  normalizeOfficialProfileDestination,
  officialProfileStoredUrlSpellings,
} from './leadProfileIdentity';

/**
 * Evidence that lets a served lead match a row's official person-profile destination when the
 * lead's own official link names a different school's page (#5970). A researcher holds one
 * verified link per kind, so a fold keeps the survivor's official link and leaves the shell's on
 * the archived shell; these two derivations recover the match without writing either record.
 */
export interface LeadMatchEvidence {
  foldedProfileDestinationsByLeadId: ReadonlyMap<string, ReadonlySet<string>>;
  pageOrcidByDestination: ReadonlyMap<string, string>;
}

export const EMPTY_LEAD_MATCH_EVIDENCE: LeadMatchEvidence = {
  foldedProfileDestinationsByLeadId: new Map(),
  pageOrcidByDestination: new Map(),
};

export interface LeadMatchCandidate {
  user?: { orcid?: unknown } | null;
  row?: { identityKey?: unknown } | null;
}

export function leadMatchesDestinationThroughEvidence(
  lead: LeadMatchCandidate,
  destinations: ReadonlySet<string>,
  evidence: LeadMatchEvidence,
): boolean {
  const leadId = String(lead.row?.identityKey || '');
  const foldedDestinations = leadId
    ? evidence.foldedProfileDestinationsByLeadId.get(leadId)
    : undefined;
  if (foldedDestinations && [...foldedDestinations].some((url) => destinations.has(url))) {
    return true;
  }
  const leadOrcid = plausiblePersonOrcid(lead.user?.orcid);
  if (!leadOrcid) return false;
  return [...destinations].some(
    (destination) => evidence.pageOrcidByDestination.get(destination) === leadOrcid,
  );
}

/** A destination vouches for an ORCID only when its page states exactly one distinct ORCID. */
export function pageOrcidByDestinationFromStatements(
  statements: ReadonlyArray<{ sourceUrl?: unknown; value?: unknown }>,
  destinations: ReadonlySet<string>,
): Map<string, string> {
  const orcidsByDestination = new Map<string, Set<string>>();
  for (const statement of statements) {
    const destination = normalizeOfficialProfileDestination(String(statement.sourceUrl || ''));
    const orcid = plausiblePersonOrcid(statement.value);
    if (!destination || !orcid || !destinations.has(destination)) continue;
    const orcids = orcidsByDestination.get(destination) ?? new Set<string>();
    orcids.add(orcid);
    orcidsByDestination.set(destination, orcids);
  }
  const single = new Map<string, string>();
  for (const [destination, orcids] of orcidsByDestination) {
    if (orcids.size === 1) single.set(destination, [...orcids][0]);
  }
  return single;
}

export function foldedProfileDestinationsFromRecords(
  records: ReadonlyArray<{ dedupedIntoResearcherId?: unknown; profileLinks?: unknown }>,
  leadIds: ReadonlySet<string>,
): Map<string, Set<string>> {
  const byLeadId = new Map<string, Set<string>>();
  for (const record of records) {
    const leadId = String(record.dedupedIntoResearcherId || '');
    if (!leadIds.has(leadId)) continue;
    const links = Array.isArray(record.profileLinks) ? record.profileLinks : [];
    for (const link of links) {
      const url = (link as { url?: unknown })?.url;
      if (!isLikelyOfficialPersonProfileUrl(url)) continue;
      const destination = normalizeOfficialProfileDestination(String(url));
      if (!destination) continue;
      const destinationsForLead = byLeadId.get(leadId) ?? new Set<string>();
      destinationsForLead.add(destination);
      byLeadId.set(leadId, destinationsForLead);
    }
  }
  return byLeadId;
}

export async function loadLeadMatchEvidence(
  entity: Record<string, any>,
  leads: ReadonlyArray<LeadMatchCandidate>,
): Promise<LeadMatchEvidence> {
  const destinations = entityOfficialPersonProfileDestinations(entity);
  if (destinations.size === 0 || leads.length === 0) return EMPTY_LEAD_MATCH_EVIDENCE;
  const storedUrlSpellings = [
    ...new Set(entityOfficialPersonProfileUrls(entity).flatMap(officialProfileStoredUrlSpellings)),
  ];
  const leadIds = new Set(
    leads
      .map((lead) => String(lead.row?.identityKey || ''))
      .filter((id) => mongoose.Types.ObjectId.isValid(id) && id.length === 24),
  );
  const hasLeadOrcid =
    storedUrlSpellings.length > 0 && leads.some((lead) => plausiblePersonOrcid(lead.user?.orcid));
  const [foldedRecords, statements] = await Promise.all([
    leadIds.size > 0
      ? Researcher.find({
          dedupedIntoResearcherId: {
            $in: [...leadIds].map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select('dedupedIntoResearcherId profileLinks')
          .lean()
      : Promise.resolve([]),
    hasLeadOrcid
      ? Observation.find({
          entityType: 'user',
          field: 'orcid',
          superseded: { $ne: true },
          sourceUrl: { $in: storedUrlSpellings },
        })
          .select('sourceUrl value')
          .lean()
      : Promise.resolve([]),
  ]);
  return {
    foldedProfileDestinationsByLeadId: foldedProfileDestinationsFromRecords(
      foldedRecords as Array<{ dedupedIntoResearcherId?: unknown; profileLinks?: unknown }>,
      leadIds,
    ),
    pageOrcidByDestination: pageOrcidByDestinationFromStatements(
      statements as Array<{ sourceUrl?: unknown; value?: unknown }>,
      destinations,
    ),
  };
}

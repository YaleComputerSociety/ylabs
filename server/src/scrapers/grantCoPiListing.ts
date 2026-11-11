import { GRANT_LANE_SOURCE_NAMES } from './grantLaneSourceNames';

const GRANT_LANE_SOURCE_NAME_SET: ReadonlySet<string> = new Set(GRANT_LANE_SOURCE_NAMES);

export interface LeadEvidenceFact {
  personId: string;
  sourceName?: string;
}

export interface GrantCoPiListingInput {
  leadFacts: readonly LeadEvidenceFact[];
  rowLeadPersonIds: Iterable<string>;
  edgeSourceNameByPerson?: ReadonlyMap<string, string | undefined>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The leads a row holds only because a grant record lists them beside someone else (#5776).
 *
 * A multi-PI award is a collaboration. It says the listed people share funding, never
 * that a research row is one of theirs, so a lead whose every lead assertion on the row
 * comes from a grant lane, on a row that also holds another person as a lead, is a
 * co-PI listing. Such a lead is not a same-person or same-row witness: the PI folds must
 * not cluster the row with that person's own rows, and a merge redirect must not let
 * that lead vouch for a listing. A grant-only lead who is the row's sole lead is the
 * funding shell the funding lane exists for, so it is not a listing.
 *
 * Lead facts come from the row's live lead observations. A lead edge with no such
 * observation falls back to the source name its edge records.
 */
export function grantCoPiListedPersonIds(input: GrantCoPiListingInput): Set<string> {
  const leads = new Set([...input.rowLeadPersonIds].map(text).filter(Boolean));
  const listed = new Set<string>();
  if (leads.size < 2) return listed;
  const sourcesByPerson = new Map<string, Set<string>>();
  for (const fact of input.leadFacts) {
    const personId = text(fact.personId);
    if (!leads.has(personId)) continue;
    const sources = sourcesByPerson.get(personId) ?? new Set<string>();
    sources.add(text(fact.sourceName));
    sourcesByPerson.set(personId, sources);
  }
  for (const personId of leads) {
    const edgeSource = text(input.edgeSourceNameByPerson?.get(personId));
    const sources = sourcesByPerson.get(personId) ?? new Set(edgeSource ? [edgeSource] : []);
    if (sources.size === 0) continue;
    if ([...sources].every((source) => GRANT_LANE_SOURCE_NAME_SET.has(source))) {
      listed.add(personId);
    }
  }
  return listed;
}

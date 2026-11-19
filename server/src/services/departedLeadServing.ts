import { LEAD_ROLE_LEGACY_LABELS } from '../models/canonicalRoleMapping';
import type { ResearchEntityRosterEntry } from './researchEntityMembershipAccessor';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';

const isCurrentLead = (entry: ResearchEntityRosterEntry): boolean =>
  entry.state !== 'HISTORICAL' && LEAD_ROLE_LEGACY_LABELS.has(entry.role);

/**
 * A lead whose own official page marks them deceased or departed no longer leads a row whose
 * research continues under another current lead (#5721). The entry is read as historical, so
 * every surface that selects a row's lead (detail, card, search document, gate) serves the
 * remaining lead through its existing selection. A row every lead has left is the Yale-status
 * derivation's to present, so it is passed through unchanged.
 */
export async function rostersWithDepartedLeadsRetired(
  rosterByEntityId: ReadonlyMap<string, ResearchEntityRosterEntry[]>,
  now = new Date(),
): Promise<Map<string, ResearchEntityRosterEntry[]>> {
  const result = new Map(rosterByEntityId);
  const sharedRows = [...rosterByEntityId].filter(
    ([, entries]) => new Set(entries.filter(isCurrentLead).map((e) => String(e.personId))).size > 1,
  );
  if (sharedRows.length === 0 || !mongooseConnectionWasOpened()) return result;
  // Loaded on use: the reader sits on the materializer's read scope, which the serving layer
  // must not pull in at module load.
  const { loadPersonPageDepartures, rowDepartureFromLeads } =
    await import('../scrapers/personPageDeparture');
  const leadIds = [
    ...new Set(
      sharedRows.flatMap(([, entries]) =>
        entries.filter(isCurrentLead).map((entry) => String(entry.personId)),
      ),
    ),
  ];
  const departures = await loadPersonPageDepartures(leadIds, now);
  if (departures.size === 0) return result;
  for (const [entityId, entries] of sharedRows) {
    const rowLeads = [...new Set(entries.filter(isCurrentLead).map((e) => String(e.personId)))];
    if (rowDepartureFromLeads(rowLeads, departures)) continue;
    result.set(
      entityId,
      entries.map((entry) =>
        isCurrentLead(entry) && departures.has(String(entry.personId))
          ? { ...entry, state: 'HISTORICAL', isCurrentMember: false }
          : entry,
      ),
    );
  }
  return result;
}

export async function withDepartedLeadsRetired(
  rosterEntries: ResearchEntityRosterEntry[],
  now = new Date(),
): Promise<ResearchEntityRosterEntry[]> {
  return (await rostersWithDepartedLeadsRetired(new Map([['row', rosterEntries]]), now)).get(
    'row',
  )!;
}

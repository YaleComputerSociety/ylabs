import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { loadResearchEntityLeadPersonIds } from '../utils/researchHomeNameIdentityRoster';
import { OFFICIAL_PROFILE_PI_BACKFILL_SOURCE } from './directoryContradictedProfileNetid';
import { materializationReadScopeFilter } from './entityMaterializer';
import {
  invalidatedScrapeRunIds,
  partitionObservationsByInvalidatedRun,
} from './invalidatedScrapeRuns';

export const PROFILE_IN_MEMORIAM_FIELD = 'profileInMemoriam';
export const PROFILE_APPOINTMENT_ENDED_FIELD = 'profileAppointmentEndedOn';
export const PERSON_PAGE_DEPARTURE_FIELDS = [
  PROFILE_IN_MEMORIAM_FIELD,
  PROFILE_APPOINTMENT_ENDED_FIELD,
] as const;

export type PersonPageDeparture = 'deceased' | 'departed';

type DepartureObservation = {
  entityKey?: unknown;
  field?: unknown;
  value?: unknown;
  sourceName?: unknown;
  scrapeRunId?: unknown;
};

const BARE_NETID = /^[a-z0-9]+$/;

const bareNetid = (value: unknown): string => {
  const netid = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return BARE_NETID.test(netid) ? netid : '';
};

const endedOn = (value: unknown): number => {
  const time = typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : NaN;
};

/**
 * What the person's own official page says about them, read from observations the
 * official-profile lane recorded on the person's own `netid:` key (#5721). An in-memoriam or
 * obituary marker means deceased. A sole appointment whose stated end date has passed means
 * departed, which is the existing departure semantics. Evidence from any other lane or key
 * decides nothing.
 */
export function personPageDepartureFrom(
  netid: string,
  observations: readonly DepartureObservation[],
  now: Date,
): PersonPageDeparture | undefined {
  const own = observations.filter(
    (observation) =>
      observation.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE &&
      String(observation.entityKey ?? '').toLowerCase() === `netid:${netid}`,
  );
  if (own.some((observation) => observation.field === PROFILE_IN_MEMORIAM_FIELD)) {
    return 'deceased';
  }
  const ended = own
    .filter((observation) => observation.field === PROFILE_APPOINTMENT_ENDED_FIELD)
    .map((observation) => endedOn(observation.value))
    .filter((time) => Number.isFinite(time));
  if (ended.length > 0 && ended.every((time) => time < now.getTime())) return 'departed';
  return undefined;
}

export async function loadPersonPageDepartures(
  researcherIds: readonly string[],
  now: Date,
): Promise<Map<string, PersonPageDeparture>> {
  const departures = new Map<string, PersonPageDeparture>();
  if (researcherIds.length === 0) return departures;
  const people = (await Researcher.find(
    { _id: { $in: [...researcherIds] }, archived: { $ne: true } },
    { 'identifiers.netid': 1 },
  ).lean()) as Array<{ _id: unknown; identifiers?: { netid?: unknown } }>;
  const netidById = new Map(
    people
      .map((person) => [String(person._id), bareNetid(person.identifiers?.netid)] as const)
      .filter(([, netid]) => Boolean(netid)),
  );
  if (netidById.size === 0) return departures;
  const read = (await Observation.find(
    {
      entityType: 'user',
      sourceName: OFFICIAL_PROFILE_PI_BACKFILL_SOURCE,
      field: { $in: [...PERSON_PAGE_DEPARTURE_FIELDS] },
      entityKey: { $in: [...netidById.values()].map((netid) => `netid:${netid}`) },
      ...materializationReadScopeFilter(),
    },
    { entityKey: 1, field: 1, value: 1, sourceName: 1, scrapeRunId: 1 },
  ).lean()) as DepartureObservation[];
  const kept = partitionObservationsByInvalidatedRun(read, await invalidatedScrapeRunIds()).kept;
  for (const [id, netid] of netidById) {
    const departure = personPageDepartureFrom(netid, kept, now);
    if (departure) departures.set(id, departure);
  }
  return departures;
}

/**
 * A row is gone only when every current lead's own page says so. A row whose research
 * continues under another current lead is not gone: that lead is served instead.
 */
export function rowDepartureFromLeads(
  leadPersonIds: readonly string[],
  departures: ReadonlyMap<string, PersonPageDeparture>,
): PersonPageDeparture | undefined {
  const leads = [...new Set(leadPersonIds)];
  if (leads.length === 0) return undefined;
  const reasons = leads.map((id) => departures.get(id));
  if (reasons.some((reason) => !reason)) return undefined;
  return reasons.every((reason) => reason === 'deceased') ? 'deceased' : 'departed';
}

export async function loadResearchEntityLeadPageDeparture(
  researchEntityId: string,
  now: Date,
): Promise<PersonPageDeparture | undefined> {
  if (!researchEntityId) return undefined;
  const leadIds = (await loadResearchEntityLeadPersonIds([researchEntityId])).get(researchEntityId);
  if (!leadIds?.length) return undefined;
  return rowDepartureFromLeads(leadIds, await loadPersonPageDepartures(leadIds, now));
}

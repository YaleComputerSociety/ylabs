import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { titleHoldsOnlyEmeritusAppointments } from '../services/emeritusLeadWayIn';
import {
  ENDED_APPOINTMENT_LEAD_MODE,
  type EndedAppointmentLeadMode,
} from '../utils/endedAppointmentLeadMode';
import { loadResearchEntityLeadPersonIds } from '../utils/researchHomeNameIdentityRoster';
import { OFFICIAL_PROFILE_PI_BACKFILL_SOURCE } from './directoryContradictedProfileNetid';
import { materializationReadScopeFilter } from './entityMaterializer';
import {
  invalidatedScrapeRunIds,
  partitionObservationsByInvalidatedRun,
} from './invalidatedScrapeRuns';

import {
  PERSON_PAGE_DEPARTURE_FIELDS,
  PROFILE_APPOINTMENT_ENDED_FIELD,
  PROFILE_IN_MEMORIAM_FIELD,
} from './personPageDepartureFields';

export { PERSON_PAGE_DEPARTURE_FIELDS, PROFILE_APPOINTMENT_ENDED_FIELD, PROFILE_IN_MEMORIAM_FIELD };

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
 * departed, but only when `ENDED_APPOINTMENT_LEAD_MODE` hides and never for an emeritus title.
 * Evidence from any other lane or key decides nothing.
 */
export function personPageDepartureFrom(
  netid: string,
  observations: readonly DepartureObservation[],
  now: Date,
  options: { title?: unknown; endedAppointmentMode?: EndedAppointmentLeadMode } = {},
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
  if (ended.length === 0 || !ended.every((time) => time < now.getTime())) return undefined;
  // Emeritus-led research is shown labelled by owner decision, so an emeritus appointment is
  // never read as a departure, however its earlier appointment ended.
  if (titleHoldsOnlyEmeritusAppointments(options.title)) return undefined;
  const mode = options.endedAppointmentMode ?? ENDED_APPOINTMENT_LEAD_MODE;
  return mode === 'hide' ? 'departed' : undefined;
}

export async function loadPersonPageDepartures(
  researcherIds: readonly string[],
  now: Date,
  endedAppointmentMode: EndedAppointmentLeadMode = ENDED_APPOINTMENT_LEAD_MODE,
): Promise<Map<string, PersonPageDeparture>> {
  const departures = new Map<string, PersonPageDeparture>();
  if (researcherIds.length === 0) return departures;
  const people = (await Researcher.find(
    { _id: { $in: [...researcherIds] }, archived: { $ne: true } },
    { 'identifiers.netid': 1, 'profile.title': 1 },
  ).lean()) as Array<{
    _id: unknown;
    identifiers?: { netid?: unknown };
    profile?: { title?: unknown };
  }>;
  const titleById = new Map(people.map((person) => [String(person._id), person.profile?.title]));
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
    const departure = personPageDepartureFrom(netid, kept, now, {
      title: titleById.get(id),
      endedAppointmentMode,
    });
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

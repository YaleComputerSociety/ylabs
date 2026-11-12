import { officialProfileUrlSpellings } from './officialProfileIdentityUrlKey';

export interface UserNameObservation {
  entityKey?: unknown;
  entityId?: unknown;
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
}

export interface ObservationCollectionLike {
  find(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): { toArray(): Promise<unknown[]> };
}

const PERSON_NAME_FIELDS = ['fname', 'lname', 'displayName'];

const LIVE_OBSERVATION_SCOPE = {
  superseded: { $ne: true },
  'rollback.rolledBackAt': { $exists: false },
};

const QUERY_BATCH = 500;

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const userKeyOf = (observation: UserNameObservation): string =>
  text(observation.entityKey) || String(observation.entityId ?? '');

export function statedPersonNamesFrom(observations: readonly UserNameObservation[]): string[] {
  const readings = new Map<string, { fname?: string; lname?: string; displayName?: string }>();
  for (const observation of observations) {
    const field = text(observation.field);
    const value = text(observation.value);
    if (!PERSON_NAME_FIELDS.includes(field) || !value) continue;
    const reading = `${userKeyOf(observation)}|${text(observation.sourceUrl)}`;
    const names = readings.get(reading) ?? {};
    names[field as 'fname' | 'lname' | 'displayName'] = value;
    readings.set(reading, names);
  }
  const stated = new Set<string>();
  for (const names of readings.values()) {
    if (names.displayName) stated.add(names.displayName);
    if (names.fname && names.lname) stated.add(`${names.fname} ${names.lname}`);
  }
  return [...stated];
}

function chunks<T>(values: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < values.length; start += QUERY_BATCH) {
    batches.push(values.slice(start, start + QUERY_BATCH));
  }
  return batches;
}

async function liveUserObservations(
  observations: ObservationCollectionLike,
  filter: Record<string, unknown>,
  projection: Record<string, 1>,
): Promise<UserNameObservation[]> {
  return (await observations
    .find({ entityType: 'user', ...LIVE_OBSERVATION_SCOPE, ...filter }, { projection })
    .toArray()) as UserNameObservation[];
}

export async function personPagesStatingOrcid(
  observations: ObservationCollectionLike,
  orcid: string,
): Promise<string[]> {
  if (!orcid) return [];
  const statements = await liveUserObservations(
    observations,
    { field: 'orcid', value: orcid },
    { sourceUrl: 1 },
  );
  return [...new Set(statements.map((statement) => text(statement.sourceUrl)).filter(Boolean))];
}

export async function namesStatedAtPersonPagesByPage(
  observations: ObservationCollectionLike,
  pageUrls: readonly string[],
): Promise<Map<string, string[]>> {
  const pageBySpelling = new Map<string, string>();
  for (const page of new Set(pageUrls.filter(Boolean))) {
    for (const spelling of officialProfileUrlSpellings(page)) pageBySpelling.set(spelling, page);
  }
  const keysByPage = new Map<string, Set<string>>();
  for (const batch of chunks([...pageBySpelling.keys()])) {
    const citing = await liveUserObservations(
      observations,
      { sourceUrl: { $in: batch }, entityKey: { $exists: true, $nin: [null, ''] } },
      { entityKey: 1, sourceUrl: 1 },
    );
    for (const observation of citing) {
      const page = pageBySpelling.get(text(observation.sourceUrl));
      const key = text(observation.entityKey);
      if (!page || !key) continue;
      keysByPage.set(page, (keysByPage.get(page) ?? new Set()).add(key));
    }
  }
  const allKeys = [...new Set([...keysByPage.values()].flatMap((keys) => [...keys]))];
  const nameObservationsByKey = new Map<string, UserNameObservation[]>();
  for (const batch of chunks(allKeys)) {
    const named = await liveUserObservations(
      observations,
      { entityKey: { $in: batch }, field: { $in: PERSON_NAME_FIELDS } },
      { entityKey: 1, field: 1, value: 1, sourceUrl: 1 },
    );
    for (const observation of named) {
      const key = text(observation.entityKey);
      nameObservationsByKey.set(key, [...(nameObservationsByKey.get(key) ?? []), observation]);
    }
  }
  const namesByPage = new Map<string, string[]>();
  for (const [page, keys] of keysByPage) {
    namesByPage.set(
      page,
      statedPersonNamesFrom([...keys].flatMap((key) => nameObservationsByKey.get(key) ?? [])),
    );
  }
  return namesByPage;
}

export async function namesStatedAtPersonPages(
  observations: ObservationCollectionLike,
  pageUrls: readonly string[],
): Promise<string[]> {
  const byPage = await namesStatedAtPersonPagesByPage(observations, pageUrls);
  return [...new Set([...byPage.values()].flat())];
}

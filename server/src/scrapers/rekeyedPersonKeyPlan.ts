/**
 * A re-key is supersession, not absence: the lane still states every value under the newer
 * key, so the two-read retraction rule does not apply (#5817). The lane recorder and the
 * backfill command both plan through `planRekeyedPersonKeyRetirements`.
 */
import { normalizeYsmProfileUrl } from './sources/ysmMeshKeywordScraper';
import { officialProfileIdentityUrlKey } from './utils/officialProfileIdentityUrlKey';
import { normalizeName, slugify } from './utils/scraperHelpers';

export const REKEYED_PERSON_KEY_RETIREMENT_REASON =
  'the same lane re-read this person on the same listing and now keys them under a newer key the page and name or the directory prove is the same person (#5817)';

export const REKEYING_PERSON_LANES = [
  'dept-faculty-roster',
  'ysm-faculty-directory',
  'yse-faculty-directory',
] as const;
export type RekeyingPersonLane = (typeof REKEYING_PERSON_LANES)[number];

export function isRekeyingPersonLane(value: string): value is RekeyingPersonLane {
  return (REKEYING_PERSON_LANES as readonly string[]).includes(value);
}

export const LISTING_FIELDS: ReadonlySet<string> = new Set([
  'netid',
  'fname',
  'lname',
  'primaryDepartment',
  'departments',
  'dataSources',
]);

export const PLANNED_VALUE_FIELDS: ReadonlySet<string> = new Set([
  'netid',
  'fname',
  'lname',
  'primaryDepartment',
  'departments',
  'profileUrls',
]);

export interface LanePersonObservation {
  id: string;
  entityKey: string;
  field: string;
  value?: unknown;
  sourceUrl?: string;
  scrapeRunId?: string;
  observedAt?: unknown;
}

export interface ListingPresence {
  runIds: Set<string>;
  latest: number;
}

export interface PersonKeyRecord {
  entityKey: string;
  nameKey: string;
  personPageKeys: string[];
  listingPages: Map<string, ListingPresence>;
  statedNetid?: string;
  departmentKeys: string[];
  observationIds: string[];
}

export function personPageIdentityKey(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) return '';
  return officialProfileIdentityUrlKey(normalizeYsmProfileUrl(url) || url.trim());
}

export function personNameKey(first: unknown, last: unknown): string {
  const text = [first, last]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return text ? slugify(normalizeName(text)) : '';
}

export function departmentKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(?:the )?(?:department|dept|section|program|programme) (?:of|in) /, '')
    .trim();
}

function observedTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const time = new Date(value as string | number).getTime();
  return Number.isFinite(time) ? time : 0;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function profileUrlValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).filter(
    (url): url is string => typeof url === 'string' && url.trim().length > 0,
  );
}

function departmentValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

function newestValue(rows: readonly LanePersonObservation[], field: string): string {
  const stated = rows
    .filter((row) => row.field === field && textOf(row.value))
    .sort((left, right) => observedTime(right.observedAt) - observedTime(left.observedAt));
  return stated.length > 0 ? textOf(stated[0].value) : '';
}

export function personKeyRecordFromObservations(
  entityKey: string,
  rows: readonly LanePersonObservation[],
): PersonKeyRecord {
  const listingPages = new Map<string, ListingPresence>();
  for (const row of rows) {
    if (!LISTING_FIELDS.has(row.field)) continue;
    const page = personPageIdentityKey(row.sourceUrl);
    if (!page) continue;
    const presence = listingPages.get(page) ?? { runIds: new Set<string>(), latest: 0 };
    if (row.scrapeRunId) presence.runIds.add(row.scrapeRunId);
    presence.latest = Math.max(presence.latest, observedTime(row.observedAt));
    listingPages.set(page, presence);
  }
  const personPages = new Set<string>();
  for (const row of rows) {
    if (row.field === 'profileUrls') {
      for (const url of profileUrlValues(row.value)) {
        const page = personPageIdentityKey(url);
        if (page) personPages.add(page);
      }
    }
  }
  for (const row of rows) {
    if (LISTING_FIELDS.has(row.field)) continue;
    const page = personPageIdentityKey(row.sourceUrl);
    if (page && (!listingPages.has(page) || personPages.has(page))) personPages.add(page);
  }
  const netid = newestValue(rows, 'netid').toLowerCase();
  const departments = new Set<string>();
  for (const row of rows) {
    if (row.field !== 'primaryDepartment' && row.field !== 'departments') continue;
    for (const department of departmentValues(row.value)) {
      const key = departmentKey(department);
      if (key) departments.add(key);
    }
  }
  return {
    entityKey,
    nameKey: personNameKey(newestValue(rows, 'fname'), newestValue(rows, 'lname')),
    personPageKeys: [...personPages].sort(),
    listingPages,
    ...(netid ? { statedNetid: netid } : {}),
    departmentKeys: [...departments].sort(),
    observationIds: [...new Set(rows.map((row) => row.id).filter(Boolean))],
  };
}

export function personKeyRecordsFromObservations(
  rows: readonly LanePersonObservation[],
): Map<string, PersonKeyRecord> {
  const byKey = new Map<string, LanePersonObservation[]>();
  for (const row of rows) {
    if (!row.entityKey) continue;
    const list = byKey.get(row.entityKey) ?? [];
    list.push(row);
    byKey.set(row.entityKey, list);
  }
  const records = new Map<string, PersonKeyRecord>();
  for (const [key, keyRows] of byKey) {
    records.set(key, personKeyRecordFromObservations(key, keyRows));
  }
  return records;
}

export interface GoverningListingRead {
  pageKey: string;
  runId: string;
  readAt: number;
  nameCensus?: ReadonlyMap<string, number>;
}

export interface DirectoryIdentityIndex {
  recordOf(
    netid: string,
  ): { nameKeys: ReadonlySet<string>; departmentKeys: ReadonlySet<string> } | undefined;
  netidsNamed(nameKey: string): ReadonlySet<string>;
}

export const EMPTY_DIRECTORY_IDENTITY_INDEX: DirectoryIdentityIndex = {
  recordOf: () => undefined,
  netidsNamed: () => new Set<string>(),
};

export type RekeyCategory = 'a' | 'b' | 'c' | 'e' | 'f';
export type RekeyRefusalReason =
  | 'several-old-keys-for-one-twin'
  | 'several-twins-for-one-old-key'
  | 'name-shared-on-listing'
  | 'directory-name-names-several-netids';

export interface RekeyPair {
  oldKey: string;
  newKey: string;
  pageKey: string;
  category: 'a' | 'b';
  pairKind: string;
  observationIds: string[];
}

export interface RekeyRefusal {
  oldKey: string;
  newKeys: string[];
  reasons: RekeyRefusalReason[];
  pairKind: string;
}

export interface RekeyLeftAlone {
  oldKey: string;
  newKey: string;
  category: 'c' | 'e' | 'f';
  pairKind: string;
  reread: boolean;
}

export interface RekeyPlan {
  admitted: RekeyPair[];
  refused: RekeyRefusal[];
  leftAlone: RekeyLeftAlone[];
  admissibleButNotReread: Array<{ oldKey: string; newKey: string; category: 'a' | 'b' }>;
}

export function personKeyForm(entityKey: string): string {
  const separator = entityKey.indexOf(':');
  return separator > 0 ? entityKey.slice(0, separator + 1) : 'bare';
}

export function rekeyPairKind(oldKey: string, newKey: string): string {
  return `${personKeyForm(oldKey)} -> ${personKeyForm(newKey)}`;
}

function sharesAny(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(left);
  return right.some((value) => set.has(value));
}

export function rekeyCategory(
  oldRecord: PersonKeyRecord,
  twin: PersonKeyRecord,
  directory: DirectoryIdentityIndex,
): RekeyCategory | undefined {
  const samePage = sharesAny(oldRecord.personPageKeys, twin.personPageKeys);
  const sameName = Boolean(oldRecord.nameKey) && oldRecord.nameKey === twin.nameKey;
  if (samePage && sameName) return 'a';
  if (twin.statedNetid && oldRecord.nameKey) {
    const record = directory.recordOf(twin.statedNetid);
    if (
      record?.nameKeys.has(oldRecord.nameKey) &&
      oldRecord.departmentKeys.some((department) => record.departmentKeys.has(department))
    ) {
      return 'b';
    }
  }
  if (samePage) return 'f';
  if (!sameName) return undefined;
  const bothNamePages = oldRecord.personPageKeys.length > 0 && twin.personPageKeys.length > 0;
  return bothNamePages ? 'e' : 'c';
}

function censusFor(
  read: GoverningListingRead,
  people: readonly PersonKeyRecord[],
  laneNameCensus: ReadonlyMap<string, number> | undefined,
): (nameKey: string) => number {
  const fromPeople = new Map<string, number>();
  for (const person of people) {
    if (person.nameKey) fromPeople.set(person.nameKey, (fromPeople.get(person.nameKey) ?? 0) + 1);
  }
  return (nameKey) =>
    Math.max(
      fromPeople.get(nameKey) ?? 0,
      read.nameCensus?.get(nameKey) ?? 0,
      laneNameCensus?.get(nameKey) ?? 0,
    );
}

export function planRekeyedPersonKeyRetirements(input: {
  records: Iterable<PersonKeyRecord>;
  reads: readonly GoverningListingRead[];
  directory?: DirectoryIdentityIndex;
  laneNameCensus?: ReadonlyMap<string, number>;
}): RekeyPlan {
  const directory = input.directory ?? EMPTY_DIRECTORY_IDENTITY_INDEX;
  const records = [...input.records];
  const readByPage = new Map(input.reads.map((read) => [read.pageKey, read]));
  const writtenBy = (record: PersonKeyRecord, read: GoverningListingRead) =>
    record.listingPages.get(read.pageKey)?.runIds.has(read.runId) ?? false;
  const staleOn = (record: PersonKeyRecord, read: GoverningListingRead) => {
    const presence = record.listingPages.get(read.pageKey);
    return Boolean(presence) && !presence!.runIds.has(read.runId) && presence!.latest < read.readAt;
  };
  const isReread = (record: PersonKeyRecord) =>
    record.listingPages.size > 0 &&
    [...record.listingPages.keys()].every((page) => {
      const read = readByPage.get(page);
      return Boolean(read) && staleOn(record, read!);
    });

  const admissible = new Map<
    string,
    Array<{ twin: PersonKeyRecord; category: 'a' | 'b'; pageKey: string; census: number }>
  >();
  const twinsAdmitting = new Map<string, Set<string>>();
  const leftAlone: RekeyLeftAlone[] = [];
  const admissibleButNotReread: RekeyPlan['admissibleButNotReread'] = [];
  const seenPairs = new Set<string>();

  const recordsByPage = new Map<string, PersonKeyRecord[]>();
  for (const record of records) {
    for (const page of record.listingPages.keys()) {
      const onPage = recordsByPage.get(page) ?? [];
      onPage.push(record);
      recordsByPage.set(page, onPage);
    }
  }

  for (const read of input.reads) {
    const onPage = recordsByPage.get(read.pageKey) ?? [];
    const people = onPage.filter((record) => writtenBy(record, read));
    if (people.length === 0) continue;
    const census = censusFor(read, people, input.laneNameCensus);
    const stale = onPage.filter((record) => staleOn(record, read));
    for (const oldRecord of stale) {
      const reread = isReread(oldRecord);
      for (const twin of people) {
        if (twin.entityKey === oldRecord.entityKey) continue;
        const pairId = `${oldRecord.entityKey}\u0000${twin.entityKey}`;
        if (seenPairs.has(pairId)) continue;
        const category = rekeyCategory(oldRecord, twin, directory);
        if (!category) continue;
        seenPairs.add(pairId);
        const pairKind = rekeyPairKind(oldRecord.entityKey, twin.entityKey);
        if (category === 'a' || category === 'b') {
          if (!reread) {
            admissibleButNotReread.push({
              oldKey: oldRecord.entityKey,
              newKey: twin.entityKey,
              category,
            });
            continue;
          }
          const list = admissible.get(oldRecord.entityKey) ?? [];
          list.push({ twin, category, pageKey: read.pageKey, census: census(oldRecord.nameKey) });
          admissible.set(oldRecord.entityKey, list);
          const admitting = twinsAdmitting.get(twin.entityKey) ?? new Set<string>();
          admitting.add(oldRecord.entityKey);
          twinsAdmitting.set(twin.entityKey, admitting);
        } else {
          leftAlone.push({
            oldKey: oldRecord.entityKey,
            newKey: twin.entityKey,
            category,
            pairKind,
            reread,
          });
        }
      }
    }
  }

  const recordByKey = new Map(records.map((record) => [record.entityKey, record]));
  const admitted: RekeyPair[] = [];
  const refused: RekeyRefusal[] = [];
  for (const [oldKey, candidates] of [...admissible.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const oldRecord = recordByKey.get(oldKey)!;
    const twinKeys = [...new Set(candidates.map((candidate) => candidate.twin.entityKey))].sort();
    const reasons = new Set<RekeyRefusalReason>();
    if (twinKeys.length > 1) reasons.add('several-twins-for-one-old-key');
    if (twinKeys.some((twinKey) => (twinsAdmitting.get(twinKey)?.size ?? 0) > 1)) {
      reasons.add('several-old-keys-for-one-twin');
    }
    if (candidates.some((candidate) => candidate.census > 1)) reasons.add('name-shared-on-listing');
    if (oldRecord.nameKey && directory.netidsNamed(oldRecord.nameKey).size > 1) {
      reasons.add('directory-name-names-several-netids');
    }
    const pairKind = rekeyPairKind(oldKey, twinKeys[0]);
    if (reasons.size > 0) {
      refused.push({ oldKey, newKeys: twinKeys, reasons: [...reasons].sort(), pairKind });
      continue;
    }
    const [only] = candidates;
    admitted.push({
      oldKey,
      newKey: only.twin.entityKey,
      pageKey: only.pageKey,
      category: candidates.some((candidate) => candidate.category === 'a') ? 'a' : 'b',
      pairKind,
      observationIds: [...oldRecord.observationIds].sort(),
    });
  }
  return { admitted, refused, leftAlone, admissibleButNotReread };
}

export interface RekeyPlanCounts {
  admitted: Record<string, number>;
  refused: Record<string, number>;
  refusalReasons: Record<string, number>;
  leftAlone: Record<string, number>;
  leftAloneReread: Record<string, number>;
  admissibleButNotReread: number;
  admittedObservations: number;
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of [...values].sort()) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

const LEFT_ALONE_PRECEDENCE: ReadonlyArray<'c' | 'e' | 'f'> = ['f', 'c', 'e'];

export function rekeyPlanCounts(plan: RekeyPlan): RekeyPlanCounts {
  const decided = new Set([
    ...plan.admitted.map((pair) => pair.oldKey),
    ...plan.refused.map((refusal) => refusal.oldKey),
  ]);
  const leftByOldKey = new Map<string, RekeyLeftAlone>();
  for (const category of LEFT_ALONE_PRECEDENCE) {
    for (const left of plan.leftAlone) {
      if (left.category !== category || decided.has(left.oldKey) || leftByOldKey.has(left.oldKey)) {
        continue;
      }
      leftByOldKey.set(left.oldKey, left);
    }
  }
  const left = [...leftByOldKey.values()];
  return {
    admitted: tally(plan.admitted.map((pair) => `(${pair.category}) ${pair.pairKind}`)),
    refused: tally(plan.refused.map((refusal) => `(d) ${refusal.pairKind}`)),
    refusalReasons: tally(plan.refused.flatMap((refusal) => refusal.reasons)),
    leftAlone: tally(left.map((entry) => `(${entry.category}) ${entry.pairKind}`)),
    leftAloneReread: tally(
      left.filter((entry) => entry.reread).map((entry) => `(${entry.category}) ${entry.pairKind}`),
    ),
    admissibleButNotReread: new Set(plan.admissibleButNotReread.map((entry) => entry.oldKey)).size,
    admittedObservations: plan.admitted.reduce((sum, pair) => sum + pair.observationIds.length, 0),
  };
}

import { Researcher } from '../models/researcher';
import { ResearchEntity } from '../models/researchEntity';
import { normalizedRosterLabel } from '../scrapers/rosterStrikeDigests';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  getResearchEntityRoster,
  getResearchEntityRosterByEntityId,
  type ResearchEntityRosterEntry,
  type ResearchEntityRosterScope,
} from './researchEntityMembershipAccessor';
import {
  keylessDirectoryRemovalState,
  loadDirectoryRemovalMatcher,
  type DirectoryRemovalMatcher,
  type DirectoryRemovalState,
} from './directoryRemovalMatcher';

export const WITHHELD_PERSON_PHRASE = 'a researcher';

export interface DirectoryRemovalServing {
  state: DirectoryRemovalState;
  withholdsEveryName: boolean;
  isWithheldPersonId(personId: unknown): boolean;
  isWithheldName(name: unknown): boolean;
  redactWithheldNames(text: string): string;
}

const NAME_WINDOW_SIZES = [4, 3, 2];
const NAME_TOKEN = /[\p{L}\p{M}]+(?:[-.][\p{L}\p{M}]+)*(?:['’][\p{L}\p{M}]{2,})*/gu;

interface TokenSpan {
  start: number;
  end: number;
}

function withheldNameSpans(text: string, isWithheld: (name: string) => boolean): TokenSpan[] {
  const tokens = [...text.matchAll(NAME_TOKEN)].map((match) => ({
    start: match.index!,
    end: match.index! + match[0].length,
  }));
  const spans: TokenSpan[] = [];
  let index = 0;
  while (index < tokens.length) {
    const size = NAME_WINDOW_SIZES.find(
      (windowSize) =>
        index + windowSize <= tokens.length &&
        isWithheld(text.slice(tokens[index].start, tokens[index + windowSize - 1].end)),
    );
    if (size) {
      spans.push({ start: tokens[index].start, end: tokens[index + size - 1].end });
      index += size;
    } else {
      index += 1;
    }
  }
  return spans;
}

function replacedSpans(text: string, spans: TokenSpan[]): string {
  let result = '';
  let cursor = 0;
  for (const span of spans) {
    result += text.slice(cursor, span.start) + WITHHELD_PERSON_PHRASE;
    cursor = span.end;
  }
  return result + text.slice(cursor);
}

const idKey = (value: unknown): string => (value == null ? '' : String(value));

const nameLabels = (names: ReadonlyArray<string | undefined>): Set<string> =>
  new Set(names.map((name) => normalizedRosterLabel(name)).filter((label) => label.includes(' ')));

export function buildDirectoryRemovalServing(
  matcher: DirectoryRemovalMatcher,
  people: {
    removed: ReadonlyArray<{ _id: unknown; displayName?: string }>;
    everyKnownName?: ReadonlyArray<string | undefined>;
  },
): DirectoryRemovalServing {
  if (matcher.state === 'inert' || matcher.state === 'unfiltered_local') {
    return {
      state: matcher.state,
      withholdsEveryName: false,
      isWithheldPersonId: () => false,
      isWithheldName: () => false,
      redactWithheldNames: (text) => text,
    };
  }
  if (matcher.state === 'withholding_every_name') {
    const everyLabel = nameLabels(people.everyKnownName ?? []);
    const isKnownName = (name: string) => everyLabel.has(normalizedRosterLabel(name));
    return {
      state: matcher.state,
      withholdsEveryName: true,
      isWithheldPersonId: () => true,
      isWithheldName: () => true,
      redactWithheldNames: (text) =>
        text ? replacedSpans(text, withheldNameSpans(text, isKnownName)) : text,
    };
  }
  const removedIds = new Set(people.removed.map((person) => idKey(person._id)));
  const removedLabels = nameLabels(people.removed.map((person) => person.displayName));
  const isWithheldName = (name: unknown) =>
    removedLabels.has(normalizedRosterLabel(name)) || matcher.isRemovedName(name);
  return {
    state: 'active',
    withholdsEveryName: false,
    isWithheldPersonId: (personId) => removedIds.has(idKey(personId)),
    isWithheldName,
    redactWithheldNames: (text) =>
      text ? replacedSpans(text, withheldNameSpans(text, isWithheldName)) : text,
  };
}

export function withoutWithheldPeople<T extends { personId?: unknown }>(
  entries: readonly T[],
  serving: DirectoryRemovalServing = currentDirectoryRemovalServing(),
): T[] {
  return entries.filter((entry) => !serving.isWithheldPersonId(entry.personId));
}

export function rosterWithoutWithheldPeople<T extends { personId?: unknown }>(
  rosterByEntityId: ReadonlyMap<string, T[]>,
  serving: DirectoryRemovalServing = currentDirectoryRemovalServing(),
): Map<string, T[]> {
  const served = new Map<string, T[]>();
  for (const [entityId, entries] of rosterByEntityId) {
    const kept = withoutWithheldPeople(entries, serving);
    if (kept.length > 0) served.set(entityId, kept);
  }
  return served;
}

const URL_LIKE = /^(https?:|mailto:|tel:)/i;
const UNREDACTED_KEYS = new Set(['_id', 'id', 'slug', 'publicKey', 'url', 'sourceUrl']);

export function redactWithheldNamesDeep<T>(
  value: T,
  serving: DirectoryRemovalServing = currentDirectoryRemovalServing(),
): T {
  if (serving.state !== 'active' && serving.state !== 'withholding_every_name') return value;
  const visit = (node: unknown, key?: string): unknown => {
    if (typeof node === 'string') {
      if ((key && UNREDACTED_KEYS.has(key)) || URL_LIKE.test(node)) return node;
      return serving.redactWithheldNames(node);
    }
    if (Array.isArray(node)) return node.map((item) => visit(item));
    if (node && typeof node === 'object' && typeof (node as any).toJSON === 'function') {
      return visit((node as any).toJSON(), key);
    }
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([childKey, child]) => [
          childKey,
          visit(child, childKey),
        ]),
      );
    }
    return node;
  };
  return visit(value) as T;
}

const INERT_SERVING = buildDirectoryRemovalServing(
  { state: 'inert', isRemovedPerson: () => false, isRemovedName: () => false },
  { removed: [] },
);

const SERVING_REFRESH_MS = 5 * 60_000;
let snapshot: { serving: DirectoryRemovalServing; loadedAt: number } | undefined;
let pendingLoad: Promise<DirectoryRemovalServing> | undefined;

async function everyKnownName(): Promise<string[]> {
  const [people, rosters] = await Promise.all([
    Researcher.find({ archived: { $ne: true } })
      .select('displayName -_id')
      .lean(),
    ResearchEntity.find({
      archived: { $ne: true },
      'rosterEnrichment.undergraduates.0': { $exists: true },
    })
      .select('rosterEnrichment.undergraduates.name -_id')
      .lean(),
  ]);
  return [
    ...people.map((person: any) => person.displayName),
    ...rosters.flatMap((row: any) =>
      (row.rosterEnrichment?.undergraduates ?? []).map((entry: any) => entry.name),
    ),
  ];
}

async function peopleFor(matcher: DirectoryRemovalMatcher) {
  if (matcher.state === 'withholding_every_name') {
    return { removed: [], everyKnownName: await everyKnownName().catch(() => []) };
  }
  if (matcher.state !== 'active') return { removed: [] };
  const people = await Researcher.find({ archived: { $ne: true } })
    .select('_id displayName identifiers profileLinks.url')
    .lean();
  return { removed: people.filter((person: any) => matcher.isRemovedPerson(person)) as any[] };
}

export async function loadDirectoryRemovalServing(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DirectoryRemovalServing> {
  try {
    const matcher = await loadDirectoryRemovalMatcher(env);
    return buildDirectoryRemovalServing(matcher, await peopleFor(matcher));
  } catch (error) {
    console.error('Directory removal list could not be read:', sanitizeLogValue(error));
    const state = keylessDirectoryRemovalState(env);
    const failsClosed = state === 'withholding_every_name';
    const matcher = { state, isRemovedPerson: () => failsClosed, isRemovedName: () => failsClosed };
    return buildDirectoryRemovalServing(
      matcher,
      await peopleFor(matcher).catch(() => ({ removed: [] })),
    );
  }
}

export function currentDirectoryRemovalServing(): DirectoryRemovalServing {
  return snapshot?.serving ?? INERT_SERVING;
}

export async function freshDirectoryRemovalServing(
  now: number = Date.now(),
): Promise<DirectoryRemovalServing> {
  if (snapshot && now - snapshot.loadedAt < SERVING_REFRESH_MS) return snapshot.serving;
  if (!pendingLoad) {
    pendingLoad = loadDirectoryRemovalServing()
      .then((serving) => {
        snapshot = { serving, loadedAt: now };
        return serving;
      })
      .finally(() => {
        pendingLoad = undefined;
      });
  }
  return pendingLoad;
}

export function setDirectoryRemovalServingForTest(serving: DirectoryRemovalServing | undefined) {
  snapshot = serving ? { serving, loadedAt: Number.POSITIVE_INFINITY } : undefined;
}

export async function servedRosterByEntityId(
  entityIds: unknown[],
  scope?: ResearchEntityRosterScope,
): Promise<Map<string, ResearchEntityRosterEntry[]>> {
  const [serving, roster] = await Promise.all([
    freshDirectoryRemovalServing(),
    getResearchEntityRosterByEntityId(entityIds, scope),
  ]);
  return rosterWithoutWithheldPeople(roster, serving);
}

export async function servedRoster(entityId: unknown): Promise<ResearchEntityRosterEntry[]> {
  const [serving, roster] = await Promise.all([
    freshDirectoryRemovalServing(),
    getResearchEntityRoster(entityId),
  ]);
  return withoutWithheldPeople(roster, serving);
}

export function directoryRemovalServingStateMessage(serving: DirectoryRemovalServing): string {
  switch (serving.state) {
    case 'inert':
      return '[directory-removal] no removal entries, so nothing is withheld.';
    case 'active':
      return '[directory-removal] removal entries active.';
    case 'withholding_every_name':
      return '[directory-removal] removal entries exist but no usable key is configured, so every person name is withheld.';
    case 'unfiltered_local':
      return '[directory-removal] removal entries exist but no key is configured, so this loopback development server serves names UNFILTERED.';
  }
}

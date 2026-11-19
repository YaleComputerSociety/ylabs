import { Researcher } from '../models/researcher';
import { rostersWithDepartedLeadsRetired, withDepartedLeadsRetired } from './departedLeadServing';
import { ResearchEntity } from '../models/researchEntity';
import { normalizedRosterLabel } from '../scrapers/rosterStrikeDigests';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { requiresDeployedRuntimeSecurity } from '../utils/environment';
import {
  getResearchEntityRoster,
  getResearchEntityRosterByEntityId,
  type ResearchEntityRosterEntry,
  type ResearchEntityRosterScope,
} from './researchEntityMembershipAccessor';
import {
  DirectoryRemovalUnavailableError,
  keylessDirectoryRemovalState,
  loadDirectoryRemovalMatcher,
  type DirectoryRemovalMatcher,
  type DirectoryRemovalState,
} from './directoryRemovalMatcher';

export const WITHHELD_PERSON_PHRASE = 'a researcher';

export type WithheldTextShape = 'prose' | 'title';

export interface DirectoryRemovalServing {
  state: DirectoryRemovalState;
  withholdsEveryName: boolean;
  isWithheldPersonId(personId: unknown): boolean;
  isWithheldName(name: unknown): boolean;
  redactWithheldNames(
    text: string,
    ownPeopleLabels?: ReadonlySet<string>,
    shape?: WithheldTextShape,
  ): string;
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

const SENTENCES = new Intl.Segmenter('en', { granularity: 'sentence' });
const ENDS_IN_NAME_ABBREVIATION = /(?:^|[^\p{L}])(?:Dr|Prof|Mr|Mrs|Ms|Mx|\p{Lu})\.\s*$/u;

interface Sentence {
  index: number;
  segment: string;
}

function sentencesOf(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let pending: Sentence | undefined;
  for (const { index, segment } of SENTENCES.segment(text)) {
    pending = pending
      ? { index: pending.index, segment: pending.segment + segment }
      : { index, segment };
    if (!ENDS_IN_NAME_ABBREVIATION.test(pending.segment)) {
      sentences.push(pending);
      pending = undefined;
    }
  }
  if (pending) sentences.push(pending);
  return sentences;
}

function withoutSentencesNaming(text: string, spans: TokenSpan[]): string {
  if (spans.length === 0) return text;
  const kept = sentencesOf(text).filter(({ index, segment }) => {
    const end = index + segment.length;
    return !spans.some((span) => span.start < end && span.end > index);
  });
  return kept
    .map(({ segment }) => segment)
    .join('')
    .trim();
}

function withheldText(text: string, spans: TokenSpan[], shape: WithheldTextShape): string {
  return shape === 'title' ? replacedSpans(text, spans) : withoutSentencesNaming(text, spans);
}

const idKey = (value: unknown): string => (value == null ? '' : String(value));

const nameLabels = (names: ReadonlyArray<string | undefined>): Set<string> =>
  new Set(names.map((name) => normalizedRosterLabel(name)).filter((label) => label.includes(' ')));

const NAME_VERDICT_CACHE_LIMIT = 50_000;

function memoizedByLabel(
  isWithheld: (name: unknown, label: string) => boolean,
): (name: unknown) => boolean {
  const verdicts = new Map<string, boolean>();
  return (name) => {
    const label = normalizedRosterLabel(name);
    const cached = verdicts.get(label);
    if (cached !== undefined) return cached;
    if (verdicts.size >= NAME_VERDICT_CACHE_LIMIT) verdicts.clear();
    const verdict = isWithheld(name, label);
    verdicts.set(label, verdict);
    return verdict;
  };
}

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
      redactWithheldNames: (text, _ownPeopleLabels, shape = 'prose') =>
        text ? withheldText(text, withheldNameSpans(text, isKnownName), shape) : text,
    };
  }
  const removedIds = new Set(people.removed.map((person) => idKey(person._id)));
  const removedLabels = nameLabels(people.removed.map((person) => person.displayName));
  const isRemovedByIdentityName = (label: string) => removedLabels.has(label);
  const isNameEntry = memoizedByLabel((name) => matcher.isRemovedName(name));
  const isWithheldName = (name: unknown) =>
    isRemovedByIdentityName(normalizedRosterLabel(name)) || isNameEntry(name);
  return {
    state: 'active',
    withholdsEveryName: false,
    isWithheldPersonId: (personId) => removedIds.has(idKey(personId)),
    isWithheldName,
    redactWithheldNames: (text, ownPeopleLabels, shape = 'prose') => {
      if (!text) return text;
      const isWithheldHere = (name: string) => {
        const label = normalizedRosterLabel(name);
        if (isRemovedByIdentityName(label)) return true;
        return !ownPeopleLabels?.has(label) && isNameEntry(name);
      };
      return withheldText(text, withheldNameSpans(text, isWithheldHere), shape);
    },
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

const SERVED_PERSON_NAME_FIELDS = ['leadName', 'matchedMemberName'];
const SERVED_PERSON_NAME_LIST_FIELDS = [
  'leadProfessorNames',
  'professorNames',
  'memberNames',
  'leadMemberNames',
];

function memberPersonNames(person: unknown): string[] {
  if (!person || typeof person !== 'object') return [];
  const fields = person as Record<string, unknown>;
  const names = ['displayName', 'name']
    .map((field) => fields[field])
    .filter((name): name is string => typeof name === 'string');
  if (typeof fields.fname === 'string' && typeof fields.lname === 'string') {
    names.push(`${fields.fname} ${fields.lname}`);
  }
  return names;
}

function servedPersonNames(record: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const field of SERVED_PERSON_NAME_FIELDS) {
    if (typeof record[field] === 'string') names.push(record[field] as string);
  }
  for (const field of SERVED_PERSON_NAME_LIST_FIELDS) {
    const list = record[field];
    if (Array.isArray(list)) names.push(...list.filter((name) => typeof name === 'string'));
  }
  if (Array.isArray(record.members)) {
    for (const member of record.members as Array<Record<string, unknown>>) {
      names.push(...memberPersonNames(member), ...memberPersonNames(member?.user));
    }
  }
  return names;
}

function withServedPeopleOf(
  record: Record<string, unknown>,
  inherited: ReadonlySet<string>,
): ReadonlySet<string> {
  const labels = servedPersonNames(record)
    .map((name) => normalizedRosterLabel(name))
    .filter((label) => label.includes(' '));
  if (labels.length === 0) return inherited;
  return new Set([...inherited, ...labels]);
}

const TITLE_KEYS = new Set([
  'name',
  'displayName',
  'title',
  'label',
  'leadName',
  'matchedMemberName',
  'programName',
  'projectTitle',
]);

const URL_LIKE = /^(https?:|mailto:|tel:)/i;
const UNREDACTED_KEYS = new Set(['_id', 'id', 'slug', 'publicKey', 'url', 'sourceUrl']);

export function redactWithheldNamesDeep<T>(
  value: T,
  serving: DirectoryRemovalServing = currentDirectoryRemovalServing(),
): T {
  if (serving.state !== 'active' && serving.state !== 'withholding_every_name') return value;
  const visit = (
    node: unknown,
    key: string | undefined,
    ownPeople: ReadonlySet<string>,
  ): unknown => {
    if (typeof node === 'string') {
      if ((key && UNREDACTED_KEYS.has(key)) || URL_LIKE.test(node)) return node;
      return serving.redactWithheldNames(
        node,
        ownPeople,
        key && TITLE_KEYS.has(key) ? 'title' : 'prose',
      );
    }
    if (Array.isArray(node)) return node.map((item) => visit(item, undefined, ownPeople));
    if (node && typeof node === 'object' && typeof (node as any).toJSON === 'function') {
      return visit((node as any).toJSON(), key, ownPeople);
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const scoped = withServedPeopleOf(record, ownPeople);
      return Object.fromEntries(
        Object.entries(record).map(([childKey, child]) => [
          childKey,
          visit(child, childKey, scoped),
        ]),
      );
    }
    return node;
  };
  return visit(value, undefined, new Set()) as T;
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

const NOT_YET_LOADED_SERVING = buildDirectoryRemovalServing(
  { state: 'withholding_every_name', isRemovedPerson: () => true, isRemovedName: () => true },
  { removed: [] },
);

export function currentDirectoryRemovalServing(
  env: NodeJS.ProcessEnv = process.env,
): DirectoryRemovalServing {
  if (snapshot) return snapshot.serving;
  return requiresDeployedRuntimeSecurity(env) ? NOT_YET_LOADED_SERVING : INERT_SERVING;
}

export async function freshDirectoryRemovalServing(
  now: number = Date.now(),
): Promise<DirectoryRemovalServing> {
  if (!snapshot) return reloadDirectoryRemovalServing(now);
  if (now - snapshot.loadedAt >= SERVING_REFRESH_MS) {
    reloadDirectoryRemovalServing(now).catch((error) =>
      console.error('Directory removal list could not be refreshed:', sanitizeLogValue(error)),
    );
  }
  return snapshot.serving;
}

function reloadDirectoryRemovalServing(now: number): Promise<DirectoryRemovalServing> {
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
  return rostersWithDepartedLeadsRetired(rosterWithoutWithheldPeople(roster, serving));
}

export async function servedRoster(entityId: unknown): Promise<ResearchEntityRosterEntry[]> {
  const [serving, roster] = await Promise.all([
    freshDirectoryRemovalServing(),
    getResearchEntityRoster(entityId),
  ]);
  return withDepartedLeadsRetired(withoutWithheldPeople(roster, serving));
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

export const DIRECTORY_REMOVAL_GATE_REFUSAL =
  'Directory removal entries exist, but this process has no usable key, so it cannot tell a removed person from anyone else and a gate pass would publish their rows again. Point DIRECTORY_REMOVAL_KEY_FILE at a file holding the shared key (or set DIRECTORY_REMOVAL_KEY on a Render service) and run again.';

export async function directoryRemovalServingForGate(): Promise<DirectoryRemovalServing> {
  const serving = await freshDirectoryRemovalServing();
  if (serving.state !== 'inert' && serving.state !== 'active') {
    throw new DirectoryRemovalUnavailableError(DIRECTORY_REMOVAL_GATE_REFUSAL);
  }
  return serving;
}

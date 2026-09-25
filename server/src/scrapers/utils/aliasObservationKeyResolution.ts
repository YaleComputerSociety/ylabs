/**
 * Plans the alias-to-netid resolutions that let an alias-keyed observation join to a person.
 *
 * A department roster publishes the friendly email alias (`first.last`) rather than the netid
 * (`fl123`), the alias passes the netid shape test, and the observation is stamped
 * `netid:<alias>`. 91% of the corpus's person observations are keyed that way, and the corpus
 * cannot repair it from itself: every one of the `netid` field values stored on an alias key
 * repeats the alias rather than carrying the real netid, measured 9,738 of 9,738.
 *
 * The resolution therefore has to come from the Yale directory. The plan emits one `email`
 * observation keyed by the REAL netid carrying the alias address, which is the shape
 * `resolveNetidForRosterEmailAlias` already looks for, so no resolver learns a new rule.
 */
export interface DirectoryIdentity {
  netid?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  schoolCode?: string | null;
}

export interface AliasObservationKey {
  entityKey: string;
  observationCount: number;
}

export type AliasResolutionRefusal =
  | 'key-is-not-an-alias'
  | 'already-resolvable-in-corpus'
  | 'directory-maps-alias-to-many-netids'
  | 'directory-netid-equals-alias'
  | 'directory-person-is-an-undergraduate'
  | 'absent-from-directory';

export interface AliasResolutionPlan {
  entityKey: string;
  alias: string;
  netid: string;
  observationCount: number;
  matchedBy: 'directory-email' | 'directory-name';
}

export interface AliasResolutionRefused {
  entityKey: string;
  alias: string;
  observationCount: number;
  refusal: AliasResolutionRefusal;
}

export interface AliasResolutionOutcome {
  planned: AliasResolutionPlan[];
  refused: AliasResolutionRefused[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const lower = (value: unknown): string => text(value).toLowerCase();

/** Only letters, so `O'Hern` and `Ismail-Beigi` compare against an alias that drops both. */
const nameKeyPart = (value: unknown): string => lower(value).replace(/[^a-z]/g, '');

export const aliasFromObservationKey = (entityKey: string): string => {
  const key = lower(entityKey);
  if (!key.startsWith('netid:')) return '';
  const value = key.slice('netid:'.length);
  return value.includes('.') && !value.includes('@') ? value : '';
};

export const emailLocalPart = (email: unknown): string => {
  const value = lower(email);
  const at = value.indexOf('@');
  return at > 0 ? value.slice(0, at) : '';
};

export const directoryNameKey = (first: unknown, last: unknown): string => {
  const key = `${nameKeyPart(first)}|${nameKeyPart(last)}`;
  return key === '|' ? '' : key;
};

export const aliasNameKey = (alias: string): string => {
  const dot = alias.indexOf('.');
  if (dot <= 0) return '';
  return directoryNameKey(alias.slice(0, dot), alias.slice(dot + 1));
};

/**
 * Yale College is excluded the way `isFacultyPerson` already excludes it. The aliases in the
 * corpus include undergraduates, because a lane pointed at a bare department `/people` root
 * ingested students (#2837), and resolving one of those keys would mint an undergraduate
 * identity rather than repair a research row.
 */
const UNDERGRADUATE_SCHOOL_CODE = 'yc';

export interface DirectoryIndex {
  netidByEmailLocalPart: Map<string, Set<string>>;
  netidByNameKey: Map<string, Set<string>>;
  undergraduateNetids: Set<string>;
}

export function indexDirectory(people: readonly DirectoryIdentity[]): DirectoryIndex {
  const netidByEmailLocalPart = new Map<string, Set<string>>();
  const netidByNameKey = new Map<string, Set<string>>();
  const undergraduateNetids = new Set<string>();

  const add = (index: Map<string, Set<string>>, key: string, netid: string) => {
    if (!key || !netid) return;
    const bucket = index.get(key);
    if (bucket) bucket.add(netid);
    else index.set(key, new Set([netid]));
  };

  for (const person of people) {
    const netid = lower(person.netid);
    if (!netid) continue;
    if (lower(person.schoolCode) === UNDERGRADUATE_SCHOOL_CODE) undergraduateNetids.add(netid);
    add(netidByEmailLocalPart, emailLocalPart(person.email), netid);
    add(netidByNameKey, directoryNameKey(person.firstName, person.lastName), netid);
  }

  return { netidByEmailLocalPart, netidByNameKey, undergraduateNetids };
}

const soleMember = (bucket: Set<string> | undefined): string | undefined =>
  bucket && bucket.size === 1 ? [...bucket][0] : undefined;

export function planAliasResolutions(
  keys: readonly AliasObservationKey[],
  directory: DirectoryIndex,
  corpusResolvableAliases: ReadonlySet<string>,
): AliasResolutionOutcome {
  const planned: AliasResolutionPlan[] = [];
  const refused: AliasResolutionRefused[] = [];

  for (const key of keys) {
    const alias = aliasFromObservationKey(key.entityKey);
    const observationCount = key.observationCount;
    const reject = (refusal: AliasResolutionRefusal) =>
      refused.push({ entityKey: key.entityKey, alias, observationCount, refusal });

    if (!alias) {
      refused.push({
        entityKey: key.entityKey,
        alias: '',
        observationCount,
        refusal: 'key-is-not-an-alias',
      });
      continue;
    }
    if (corpusResolvableAliases.has(alias)) {
      reject('already-resolvable-in-corpus');
      continue;
    }

    const emailBucket = directory.netidByEmailLocalPart.get(alias);
    if (emailBucket && emailBucket.size > 1) {
      reject('directory-maps-alias-to-many-netids');
      continue;
    }

    let netid = soleMember(emailBucket);
    let matchedBy: AliasResolutionPlan['matchedBy'] = 'directory-email';
    if (!netid) {
      const nameBucket = directory.netidByNameKey.get(aliasNameKey(alias));
      if (nameBucket && nameBucket.size > 1) {
        reject('directory-maps-alias-to-many-netids');
        continue;
      }
      netid = soleMember(nameBucket);
      matchedBy = 'directory-name';
    }

    if (!netid) {
      reject('absent-from-directory');
      continue;
    }
    // Resolving an alias to itself stamps the alias as a join key, which #2776 refused.
    if (netid === alias) {
      reject('directory-netid-equals-alias');
      continue;
    }
    if (directory.undergraduateNetids.has(netid)) {
      reject('directory-person-is-an-undergraduate');
      continue;
    }

    planned.push({ entityKey: key.entityKey, alias, netid, observationCount, matchedBy });
  }

  return { planned, refused };
}

export function summarizeAliasResolutions(outcome: AliasResolutionOutcome): {
  planned: number;
  plannedObservations: number;
  byMatch: Record<string, number>;
  byRefusal: Record<string, number>;
  refusedObservations: Record<string, number>;
} {
  const byMatch: Record<string, number> = {};
  const byRefusal: Record<string, number> = {};
  const refusedObservations: Record<string, number> = {};
  let plannedObservations = 0;

  for (const plan of outcome.planned) {
    byMatch[plan.matchedBy] = (byMatch[plan.matchedBy] ?? 0) + 1;
    plannedObservations += plan.observationCount;
  }
  for (const row of outcome.refused) {
    byRefusal[row.refusal] = (byRefusal[row.refusal] ?? 0) + 1;
    refusedObservations[row.refusal] =
      (refusedObservations[row.refusal] ?? 0) + row.observationCount;
  }

  return {
    planned: outcome.planned.length,
    plannedObservations,
    byMatch,
    byRefusal,
    refusedObservations,
  };
}

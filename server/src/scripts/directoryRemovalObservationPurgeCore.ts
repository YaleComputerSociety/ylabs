import {
  declaresAFacultyResearchProfile,
  groupPersonSubjects,
  isRowPointer,
  rowPointerClaims,
  rowPointerNamesARemovedUserKey,
  subjectNodes,
  userKeyOfNode,
  type IdentityClaim,
  type SubjectObservation,
} from '../scrapers/directoryRemovalObservationGuard';
import type { DirectoryRemovalMatcher } from '../services/directoryRemovalMatcher';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
} from './operatorDatabaseEnvironment';

export const SCRIPT_NAME = 'directory-removal:purge-observations';
export const PURGE_CONFIRM_FLAG = '--confirm-directory-removal-observation-purge';

export type PurgeEnvironment = 'development' | 'beta' | 'production';

const MONGO_URL_ENV_VARS: Record<PurgeEnvironment, string> = {
  development: 'MONGODBURL',
  beta: 'BETA_MONGODBURL',
  production: 'PRODUCTION_MONGODBURL',
};

export interface PurgeArgs {
  environment: PurgeEnvironment;
  apply: boolean;
  confirm: boolean;
}

function parseEnvironment(value: string | undefined): PurgeEnvironment {
  if (value === 'development' || value === 'beta' || value === 'production') return value;
  throw new Error(`--environment must be development, beta or production; received ${value}`);
}

export function parsePurgeArgs(argv: string[]): PurgeArgs {
  const args: PurgeArgs = { environment: 'development', apply: false, confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === PURGE_CONFIRM_FLAG) args.confirm = true;
    else if (arg.startsWith('--environment=')) {
      args.environment = parseEnvironment(arg.slice('--environment='.length));
    } else if (arg === '--environment') {
      args.environment = parseEnvironment(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(
        `Unknown ${SCRIPT_NAME} argument: ${arg}. It takes no identifier: it matches every active entry in the environment's directory_removals.`,
      );
    }
  }
  return args;
}

export function assertPurgeApplyConfirmed(args: PurgeArgs): void {
  if (args.apply && !args.confirm) {
    throw new Error(`${PURGE_CONFIRM_FLAG} is required when --apply is set.`);
  }
}

export function resolvePurgeMongoUrl(
  environment: PurgeEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const variable = MONGO_URL_ENV_VARS[environment];
  const value = env[variable]?.trim();
  if (!value) throw new Error(`${variable} is required to reach the ${environment} environment.`);
  return value;
}

export function assertPurgeTargetMatchesEnvironment(
  environment: PurgeEnvironment,
  mongoUrl: string,
): void {
  assertOperatorEnvironmentMatchesDatabase(environment, databaseNameFromMongoUrl(mongoUrl));
}

export function assertPurgeMatcherUsable(matcher: DirectoryRemovalMatcher): void {
  if (matcher.state === 'inert') {
    throw new Error(
      `${SCRIPT_NAME} found no active directory_removals entry in this environment, so there is no one to purge.`,
    );
  }
  if (matcher.state !== 'active') {
    throw new Error(
      `${SCRIPT_NAME} cannot match anyone without a directory removal key, so it refuses rather than guess.`,
    );
  }
}

export const PERSON_SUBJECT_TYPES = ['user', 'researchGroupMember'] as const;
export type PersonSubjectType = (typeof PERSON_SUBJECT_TYPES)[number];

export const PERSON_IDENTITY_FIELDS: Record<PersonSubjectType, readonly string[]> = {
  user: ['netid', 'email', 'orcid', 'profileUrl', 'profileUrls'],
  researchGroupMember: [
    'netid',
    'email',
    'orcid',
    'profileUrl',
    'identityKey',
    'membershipKey',
    'member',
    'profileIdentityEvidence',
  ],
};

export const ROW_SUBJECT_TYPES = ['researchEntity', 'researchGroup'] as const;
export const ROW_POINTER_FIELDS = [
  'inferredPiUserKey',
  'inferredPiUserId',
  'inferredDirectorProfileUrl',
  'contactEmail',
] as const;
export const ROSTER_ENRICHMENT_FIELD = 'rosterEnrichment';
const PROFILE_IDENTITY_EVIDENCE_FIELD = 'profileIdentityEvidence';

export interface ObservationRow {
  _id: string;
  entityType: string;
  entityKey?: string;
  entityId?: string;
  field: string;
  value?: unknown;
}

export interface ResearcherIdentityRow {
  _id: string;
  identifiers?: { netid?: string; email?: string; orcid?: string };
  profileLinks?: Array<{ url?: string }>;
}

type IdentityForm = 'entityKey' | 'entityId' | 'both';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const stringsIn = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).flatMap((entry) => asString(entry) ?? []);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asSubject = (row: ObservationRow): SubjectObservation => ({
  entityType: row.entityType as SubjectObservation['entityType'],
  entityKey: row.entityKey,
  entityId: row.entityId as SubjectObservation['entityId'],
  field: row.field,
  value: row.value,
});

export function removedResearcherIdsOf(
  matcher: DirectoryRemovalMatcher,
  researchers: readonly ResearcherIdentityRow[],
): Set<string> {
  return new Set(
    researchers
      .filter((researcher) =>
        matcher.isRemovedPerson({
          identifiers: researcher.identifiers,
          profileLinks: researcher.profileLinks,
        }),
      )
      .map((researcher) => String(researcher._id)),
  );
}

export interface ClaimContext {
  matcher: DirectoryRemovalMatcher;
  removedResearcherIds: ReadonlySet<string>;
}

function claimMatches(context: ClaimContext, claim: IdentityClaim): boolean {
  if (claim.kind === 'researcher_id') return context.removedResearcherIds.has(claim.value);
  if (claim.kind === 'profile_url') {
    return context.matcher.isRemovedPerson({ profileLinks: [{ url: claim.value }] });
  }
  return context.matcher.isRemovedPerson({ identifiers: { [claim.kind]: claim.value } });
}

function profileIdentityEvidenceClaims(value: unknown): IdentityClaim[] {
  if (!isPlainObject(value)) return [];
  return [
    ...stringsIn(value.emails).map((email): IdentityClaim => ({ kind: 'email', value: email })),
    ...stringsIn(value.netids).map((netid): IdentityClaim => ({ kind: 'netid', value: netid })),
    ...[...stringsIn(value.linkedProfileUrls), ...stringsIn(value.pageUrl)].map(
      (url): IdentityClaim => ({ kind: 'profile_url', value: url }),
    ),
  ];
}

type SubjectVerdict = 'removed' | 'identity_evidence_only';

export interface PersonSubjectPlan {
  verdictByNode: Map<string, SubjectVerdict>;
  judgedSubjects: Record<PersonSubjectType, { keys: Set<string>; ids: Set<string> }>;
  subjects: Record<PersonSubjectType, Record<SubjectVerdict, number>>;
  removedUserKeys: Set<string>;
}

/**
 * Judges stored person subjects with the ingest guard's own grouping and claims, so a
 * subject is purged exactly when a lane would refuse to observe it. Roster identity
 * evidence can list someone other than the subject, so a match there is only counted.
 */
export function planPersonSubjects(args: {
  userKeys: readonly string[];
  identityRows: readonly ObservationRow[];
  linkRows: readonly ObservationRow[];
  context: ClaimContext;
}): PersonSubjectPlan {
  const subjectRows = [...args.linkRows, ...args.identityRows].filter(
    (row) => row.field !== PROFILE_IDENTITY_EVIDENCE_FIELD,
  );
  const keyOnlyRows = args.userKeys.map((entityKey): SubjectObservation => ({
    entityType: 'user',
    entityKey,
    field: '',
    value: undefined,
  }));
  const evidenceRows = args.identityRows.filter(
    (row) => row.field === PROFILE_IDENTITY_EVIDENCE_FIELD,
  );
  const groups = groupPersonSubjects([
    ...keyOnlyRows,
    ...subjectRows.map(asSubject),
    ...evidenceRows.map((row) => ({ ...asSubject(row), field: '' })),
  ]);

  const verdictByRoot = new Map<string, SubjectVerdict>();
  for (const [root, claims] of groups.claimsByRoot) {
    if (claims.some((claim) => claimMatches(args.context, claim))) {
      verdictByRoot.set(root, 'removed');
    }
  }
  for (const row of evidenceRows) {
    const [node] = subjectNodes(asSubject(row));
    if (!node) continue;
    const root = groups.find(node);
    if (verdictByRoot.has(root)) continue;
    if (
      profileIdentityEvidenceClaims(row.value).some((claim) => claimMatches(args.context, claim))
    ) {
      verdictByRoot.set(root, 'identity_evidence_only');
    }
  }

  const plan: PersonSubjectPlan = {
    verdictByNode: new Map(),
    judgedSubjects: {
      user: { keys: new Set(), ids: new Set() },
      researchGroupMember: { keys: new Set(), ids: new Set() },
    },
    subjects: {
      user: { removed: 0, identity_evidence_only: 0 },
      researchGroupMember: { removed: 0, identity_evidence_only: 0 },
    },
    removedUserKeys: new Set(),
  };
  for (const [root, verdict] of verdictByRoot) {
    plan.subjects[root.split('|')[0] as PersonSubjectType][verdict] += 1;
  }
  for (const node of groups.nodes) {
    const verdict = verdictByRoot.get(groups.find(node));
    if (!verdict) continue;
    plan.verdictByNode.set(node, verdict);
    const [entityType, form, ...rest] = node.split('|');
    const bucket = plan.judgedSubjects[entityType as PersonSubjectType];
    (form === 'k' ? bucket.keys : bucket.ids).add(rest.join('|'));
    const userKey = userKeyOfNode(node);
    if (verdict === 'removed' && userKey !== undefined) plan.removedUserKeys.add(userKey);
  }
  return plan;
}

export function rowPointerNamesRemovedPerson(
  row: ObservationRow,
  context: ClaimContext,
  removedUserKeys: ReadonlySet<string>,
): boolean {
  const subject = asSubject(row);
  if (!isRowPointer(subject)) return false;
  return (
    rowPointerNamesARemovedUserKey(subject, removedUserKeys) ||
    rowPointerClaims(row.field, row.value).some((claim) => claimMatches(context, claim))
  );
}

export function rosterNamesRemovedPerson(row: ObservationRow, context: ClaimContext): boolean {
  const undergraduates = isPlainObject(row.value) ? row.value.undergraduates : undefined;
  return (Array.isArray(undergraduates) ? undergraduates : [])
    .filter(isPlainObject)
    .some((entry) =>
      stringsIn(entry.profileUrl).some((url) =>
        claimMatches(context, { kind: 'profile_url', value: url }),
      ),
    );
}

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const identityFormOf = (row: ObservationRow): IdentityForm =>
  row.entityKey && row.entityId ? 'both' : row.entityKey ? 'entityKey' : 'entityId';

export interface PurgeReport {
  removalEntriesActive: number;
  removedResearchersMatched: number;
  subjects: PersonSubjectPlan['subjects'];
  toDelete: {
    observations: number;
    byEntityType: Record<string, number>;
    byIdentityForm: Record<IdentityForm, number>;
    byField: Record<string, Record<string, number>>;
  };
  leftInPlace: {
    identityEvidenceOnlyObservations: Record<string, number>;
    rosterEnrichmentObservationsListingThePerson: number;
  };
}

export interface PurgePlan {
  observationIdsToDelete: string[];
  rowNodesWithDeletedPointers: Set<string>;
  report: PurgeReport;
}

export function planObservationPurge(args: {
  removalEntriesActive: number;
  personPlan: PersonSubjectPlan;
  subjectRows: readonly ObservationRow[];
  pointerRows: readonly ObservationRow[];
  rosterRows: readonly ObservationRow[];
  context: ClaimContext;
}): PurgePlan {
  const report: PurgeReport = {
    removalEntriesActive: args.removalEntriesActive,
    removedResearchersMatched: args.context.removedResearcherIds.size,
    subjects: args.personPlan.subjects,
    toDelete: {
      observations: 0,
      byEntityType: {},
      byIdentityForm: { entityKey: 0, entityId: 0, both: 0 },
      byField: {},
    },
    leftInPlace: {
      identityEvidenceOnlyObservations: {},
      rosterEnrichmentObservationsListingThePerson: 0,
    },
  };
  const ids = new Set<string>();
  const rowNodesWithDeletedPointers = new Set<string>();
  const markForDeletion = (row: ObservationRow) => {
    if (ids.has(row._id)) return;
    ids.add(row._id);
    report.toDelete.observations += 1;
    increment(report.toDelete.byEntityType, row.entityType);
    report.toDelete.byIdentityForm[identityFormOf(row)] += 1;
    report.toDelete.byField[row.entityType] ??= {};
    increment(report.toDelete.byField[row.entityType], row.field);
  };

  const seen = new Set<string>();
  for (const row of args.subjectRows) {
    if (seen.has(row._id)) continue;
    seen.add(row._id);
    const verdict = subjectNodes(asSubject(row))
      .map((node) => args.personPlan.verdictByNode.get(node))
      .find(Boolean);
    if (verdict === 'removed') markForDeletion(row);
    else if (verdict === 'identity_evidence_only') {
      increment(report.leftInPlace.identityEvidenceOnlyObservations, row.entityType);
    }
  }
  for (const row of args.pointerRows) {
    if (!rowPointerNamesRemovedPerson(row, args.context, args.personPlan.removedUserKeys)) continue;
    markForDeletion(row);
    for (const node of subjectNodes(asSubject(row))) rowNodesWithDeletedPointers.add(node);
  }
  for (const row of args.rosterRows) {
    if (rosterNamesRemovedPerson(row, args.context)) {
      report.leftInPlace.rosterEnrichmentObservationsListingThePerson += 1;
    }
  }
  return { observationIdsToDelete: [...ids], rowNodesWithDeletedPointers, report };
}

/**
 * A removed person's own faculty research profile row: a row subject that declares
 * `FACULTY_RESEARCH_AREA` and whose stored lead pointer names the person, the same rule
 * ingest uses to refuse the whole row. The row's identity forms are joined wherever one
 * stored observation carries both, so a declaration stored under the other form counts.
 */
export function planFacultyProfileRowDeletion(args: {
  pointerNodes: ReadonlySet<string>;
  rowObservations: readonly ObservationRow[];
}): { rowCount: number; observationIds: string[] } {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    if (!parent.has(node)) parent.set(node, node);
    let root = node;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(node, root);
    return root;
  };
  for (const node of args.pointerNodes) find(node);
  for (const row of args.rowObservations) {
    const [first, second] = subjectNodes(asSubject(row));
    if (first) find(first);
    if (first && second) parent.set(find(second), find(first));
  }
  const pointerRoots = new Set([...args.pointerNodes].map(find));
  const profileRoots = new Set(
    args.rowObservations
      .filter((row) => declaresAFacultyResearchProfile(asSubject(row)))
      .flatMap((row) => subjectNodes(asSubject(row)).map(find))
      .filter((root) => pointerRoots.has(root)),
  );
  const rowNodes = new Set([...parent.keys()].filter((node) => profileRoots.has(find(node))));
  const observationIds = args.rowObservations
    .filter((row) => subjectNodes(asSubject(row)).some((node) => rowNodes.has(node)))
    .map((row) => row._id);
  return { rowCount: profileRoots.size, observationIds: [...new Set(observationIds)] };
}

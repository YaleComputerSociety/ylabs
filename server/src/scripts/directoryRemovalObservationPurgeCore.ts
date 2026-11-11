import {
  PERSON_SUBJECT_TYPES,
  declaresAFacultyResearchProfile,
  groupPersonSubjects,
  isRowPointer,
  joinSubjectIdentityForms,
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

export interface PersonSubjectPlan {
  removedNodes: Set<string>;
  removedSubjects: Record<string, { keys: Set<string>; ids: Set<string> }>;
  subjectsToDelete: Record<string, number>;
  removedUserKeys: Set<string>;
}

/**
 * Judges stored person subjects with the ingest guard's own grouping and claims, so a
 * subject is purged exactly when a lane would refuse to observe it.
 */
export function planPersonSubjects(args: {
  userKeys: readonly string[];
  identityRows: readonly ObservationRow[];
  linkRows: readonly ObservationRow[];
  context: ClaimContext;
}): PersonSubjectPlan {
  const keyOnlyRows = args.userKeys.map((entityKey): SubjectObservation => ({
    entityType: 'user',
    entityKey,
    field: '',
    value: undefined,
  }));
  const groups = groupPersonSubjects([
    ...keyOnlyRows,
    ...[...args.linkRows, ...args.identityRows].map(asSubject),
  ]);

  const removedRoots = new Set<string>();
  for (const [root, claims] of groups.claimsByRoot) {
    if (claims.some((claim) => claimMatches(args.context, claim))) removedRoots.add(root);
  }

  const plan: PersonSubjectPlan = {
    removedNodes: new Set(),
    removedSubjects: Object.fromEntries(
      [...PERSON_SUBJECT_TYPES].map((type) => [
        type,
        { keys: new Set<string>(), ids: new Set<string>() },
      ]),
    ),
    subjectsToDelete: Object.fromEntries([...PERSON_SUBJECT_TYPES].map((type) => [type, 0])),
    removedUserKeys: new Set(),
  };
  for (const root of removedRoots) plan.subjectsToDelete[root.split('|')[0]] += 1;
  for (const node of groups.nodes) {
    if (!removedRoots.has(groups.find(node))) continue;
    plan.removedNodes.add(node);
    const [entityType, form, ...rest] = node.split('|');
    const bucket = plan.removedSubjects[entityType];
    (form === 'k' ? bucket.keys : bucket.ids).add(rest.join('|'));
    const userKey = userKeyOfNode(node);
    if (userKey !== undefined) plan.removedUserKeys.add(userKey);
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

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const identityFormOf = (row: ObservationRow): IdentityForm =>
  row.entityKey && row.entityId ? 'both' : row.entityKey ? 'entityKey' : 'entityId';

export interface PurgeReport {
  removalEntriesActive: number;
  removedResearchersMatched: number;
  subjectsToDelete: PersonSubjectPlan['subjectsToDelete'];
  toDelete: {
    observations: number;
    byEntityType: Record<string, number>;
    byIdentityForm: Record<IdentityForm, number>;
    byField: Record<string, Record<string, number>>;
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
  context: ClaimContext;
}): PurgePlan {
  const report: PurgeReport = {
    removalEntriesActive: args.removalEntriesActive,
    removedResearchersMatched: args.context.removedResearcherIds.size,
    subjectsToDelete: args.personPlan.subjectsToDelete,
    toDelete: {
      observations: 0,
      byEntityType: {},
      byIdentityForm: { entityKey: 0, entityId: 0, both: 0 },
      byField: {},
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

  for (const row of args.subjectRows) {
    if (subjectNodes(asSubject(row)).some((node) => args.personPlan.removedNodes.has(node))) {
      markForDeletion(row);
    }
  }
  for (const row of args.pointerRows) {
    if (!rowPointerNamesRemovedPerson(row, args.context, args.personPlan.removedUserKeys)) continue;
    markForDeletion(row);
    for (const node of subjectNodes(asSubject(row))) rowNodesWithDeletedPointers.add(node);
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
  const { find, nodes } = joinSubjectIdentityForms(
    args.rowObservations.map(asSubject),
    args.pointerNodes,
  );
  const pointerRoots = new Set([...args.pointerNodes].map(find));
  const profileRoots = new Set(
    args.rowObservations
      .filter((row) => declaresAFacultyResearchProfile(asSubject(row)))
      .flatMap((row) => subjectNodes(asSubject(row)).map(find))
      .filter((root) => pointerRoots.has(root)),
  );
  const rowNodes = new Set(nodes().filter((node) => profileRoots.has(find(node))));
  const observationIds = args.rowObservations
    .filter((row) => subjectNodes(asSubject(row)).some((node) => rowNodes.has(node)))
    .map((row) => row._id);
  return { rowCount: profileRoots.size, observationIds: [...new Set(observationIds)] };
}

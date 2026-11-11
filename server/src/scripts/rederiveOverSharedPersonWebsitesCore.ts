import { personWebsiteShareKey } from '../scrapers/overSharedPersonWebsite';

export const REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG =
  '--confirm-rederive-over-shared-person-websites';

export interface RederiveOverSharedPersonWebsitesArgs {
  apply: boolean;
  confirmed: boolean;
  limit?: number;
  output?: string;
}

export function parseRederiveOverSharedPersonWebsitesArgs(
  argv: readonly string[],
): RederiveOverSharedPersonWebsitesArgs {
  const args: RederiveOverSharedPersonWebsitesArgs = { apply: false, confirmed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG) args.confirmed = true;
    else if (arg.startsWith('--limit=')) args.limit = positiveInteger(arg.slice('--limit='.length));
    else if (arg === '--limit') args.limit = positiveInteger(argv[(index += 1)]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length).trim();
    else if (arg === '--output') args.output = String(argv[(index += 1)] ?? '').trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.apply && !args.confirmed) {
    throw new Error(
      `${REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG} is required when --apply is set.`,
    );
  }
  return args;
}

function positiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${String(value)}`);
  }
  return parsed;
}

export interface UserObservationIdentity {
  entityId?: unknown;
  entityKey?: unknown;
  value?: unknown;
}

export interface UserMaterializeIdentifier {
  entityId?: string;
  entityKey?: string;
}

export function uniqueIdentifiers(
  identifiers: readonly UserMaterializeIdentifier[],
): UserMaterializeIdentifier[] {
  const byIdentity = new Map<string, UserMaterializeIdentifier>();
  for (const identifier of identifiers) {
    if (identifier.entityId) byIdentity.set(`id:${identifier.entityId}`, identifier);
    else if (identifier.entityKey) byIdentity.set(`key:${identifier.entityKey}`, identifier);
  }
  return [...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, identifier]) => identifier);
}

export function withoutNetidKey(visit: RederiveVisit): RederiveVisit {
  return visit.identifier.entityKey?.startsWith('netid:')
    ? { ...visit, identifier: { entityKey: 'netid:<redacted>' } }
    : visit;
}

export function identifiersAssertingOverSharedWebsites(
  observations: readonly UserObservationIdentity[],
  overSharedKeys: ReadonlySet<string>,
): UserMaterializeIdentifier[] {
  const identifiers: UserMaterializeIdentifier[] = [];
  for (const observation of observations) {
    const key = personWebsiteShareKey(observation.value);
    if (!key || !overSharedKeys.has(key)) continue;
    const entityId = observation.entityId ? String(observation.entityId) : '';
    const entityKey = typeof observation.entityKey === 'string' ? observation.entityKey : '';
    if (entityId) identifiers.push({ entityId });
    else if (entityKey) identifiers.push({ entityKey });
  }
  return uniqueIdentifiers(identifiers);
}

export interface RederiveVisit {
  identifier: UserMaterializeIdentifier;
  researcherId?: string;
  fieldsWritten: number;
  plannedPaths?: string[];
  skipped?: string;
  error?: string;
}

function leafPaths(paths: readonly string[]): string[] {
  return paths.filter((candidate) => !paths.some((other) => other.startsWith(`${candidate}.`)));
}

export function summarizeRederiveVisits(visits: readonly RederiveVisit[]) {
  const researchers = new Set(visits.map((visit) => visit.researcherId).filter(Boolean));
  const skippedByReason: Record<string, number> = {};
  const plannedPathCounts: Record<string, number> = {};
  for (const visit of visits) {
    if (visit.skipped) skippedByReason[visit.skipped] = (skippedByReason[visit.skipped] ?? 0) + 1;
    for (const plannedPath of leafPaths(visit.plannedPaths ?? [])) {
      plannedPathCounts[plannedPath] = (plannedPathCounts[plannedPath] ?? 0) + 1;
    }
  }
  return {
    visited: visits.length,
    reachedResearchers: researchers.size,
    withFieldsWritten: visits.filter((visit) => visit.fieldsWritten > 0).length,
    fieldsWritten: visits.reduce((total, visit) => total + visit.fieldsWritten, 0),
    skippedByReason,
    plannedPathCounts,
    errors: visits.filter((visit) => visit.error).length,
  };
}

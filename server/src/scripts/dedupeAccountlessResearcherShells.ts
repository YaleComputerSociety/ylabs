import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import {
  DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS,
  roleAssignmentReattachWrite,
} from '../models/roleAssignment';
import { loadDirectoryNetidsByAddress } from '../scrapers/directoryContradictedProfileNetid';
import { resolveNetidForRosterEmailAlias } from '../scrapers/entityMaterializer';
import { loadDistinctPeopleVerdictIndex } from '../services/distinctPeopleVerdicts';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  applyUnionPlanToSnapshot,
  bareNetid,
  buildCanonicalNameIndex,
  buildCanonicalNetidIndex,
  buildVerifiedPrimaryProfileIndex,
  buildYaleOfficialProfileIndex,
  CITED_OFFICIAL_PAGE_REFUSALS,
  citedOfficialPageRefusal,
  type CitedOfficialPageRefusal,
  citedOfficialPageKey,
  routeCitedOfficialPagePairs,
  sharedOfficialProfileNamesAgree,
  yaleOfficialPageWitnessKeys,
  decideShellMerge,
  type DirectoryEmailCandidate,
  emaillessLocalPartTwinAliases,
  type FoldPlanEdge,
  foldsArchivingOnlyLiveLead,
  type OfficialPageCandidate,
  type OfficialPageHolders,
  type OfficialPageStatement,
  officialPageWitnessDestination,
  orcidOnlyHoldersByOrcid,
  planShellEdgeMoves,
  planFoldedShellEdgeHeals,
  type FoldedShellEdgeHeal,
  distinctPeoplePairKey,
  type NameVariantCandidate,
  withoutDistinctPeopleFolds,
  planAccountlessClusterFolds,
  type AccountlessClusterRefusal,
  planResearcherAttributeUnion,
  researcherAttributeUnionIsEmpty,
  researcherIdentityTier,
  resolveFinalMergeTargets,
  rosterMembershipEdgeKey,
  RESEARCHER_UNIQUE_IDENTIFIER_FIELDS,
  shellProfileLinkKindsReleasedWith,
  SHELL_FOLD_IDENTITIES,
  type ResearcherAttributeSnapshot,
  type RosterIdentityCandidate,
  type SharedRowCandidate,
  type ShellFoldIdentity,
  type ShellMergeReason,
  planAliasTwinFolds,
  researchEntityIdsToRegateAfterFold,
  type AliasTwinFoldRefusal,
  type FoldRegateEdge,
  withCopiedRefusals,
} from './dedupeAccountlessResearcherShellsCore';
import { isLocalPartNetid } from '../utils/localPartNetid';
import { planResearcherRefusedStoredValueClear } from '../utils/researcherFieldValueRefusals';
import { plausiblePersonOrcid } from '../utils/orcid';
import {
  isLikelyOfficialPersonProfileUrl,
  normalizeOfficialProfileDestination,
} from '../services/leadProfileIdentity';
import { parseRosterMemberIdentityEvidence } from '../scrapers/utils/rosterMemberIdentityEvidence';
import { namesStatedAtPersonPagesByPage } from '../scrapers/utils/personPageStatedNames';
import { officialProfileUrlSpellings } from '../scrapers/utils/officialProfileIdentityUrlKey';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);

export const SCRAPER_SWEEP_DEDUPE_RESEARCHERS_ENV = 'SCRAPER_SWEEP_DEDUPE_RESEARCHERS';

export interface ResearcherDedupeStageDelta {
  byReason: Record<ShellMergeReason, number>;
  shellsMerged: number;
  roleAssignmentsRepointed: number;
  roleAssignmentsArchivedRedundant: number;
  roleAssignmentsHealed: number;
  rosterChangedEntities: number;
  regatedEntities: number;
  profileLinksAppended: number;
}

export interface DedupeAccountlessResearcherShellsArgs {
  apply: boolean;
  confirmDedupeAccountlessResearcherShells: boolean;
  onlyShellIds?: string[];
  output?: string;
}

function parseOnlyShellId(value: string): string {
  const id = value.trim();
  if (!/^[0-9a-f]{24}$/i.test(id)) {
    throw new Error(`--only-shell expects a 24-character researcher id, got "${value}"`);
  }
  return id.toLowerCase();
}

export function parseDedupeAccountlessResearcherShellsArgs(
  argv: string[],
): DedupeAccountlessResearcherShellsArgs {
  const args: DedupeAccountlessResearcherShellsArgs = {
    apply: false,
    confirmDedupeAccountlessResearcherShells: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-dedupe-accountless-researcher-shells') {
      args.confirmDedupeAccountlessResearcherShells = true;
      continue;
    }
    if (arg.startsWith('--confirm-dedupe-accountless-researcher-shells=')) {
      throw new Error('--confirm-dedupe-accountless-researcher-shells does not accept a value');
    }
    if (arg.startsWith('--only-shell=')) {
      args.onlyShellIds = [
        ...(args.onlyShellIds ?? []),
        parseOnlyShellId(arg.slice('--only-shell='.length)),
      ];
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown dedupe:accountless-researcher-shells argument: ${arg}`);
  }

  return args;
}

export function assertDedupeAccountlessResearcherShellsApplyAllowed(
  args: Pick<
    DedupeAccountlessResearcherShellsArgs,
    'apply' | 'confirmDedupeAccountlessResearcherShells'
  >,
): void {
  if (args.apply && !args.confirmDedupeAccountlessResearcherShells) {
    throw new Error(
      '--confirm-dedupe-accountless-researcher-shells is required when --apply is set for dedupe:accountless-researcher-shells',
    );
  }
}

export interface AttributeUnionTotals {
  profileLinksAppended: number;
  identifiersFilled: Record<string, number>;
  profileFieldsFilled: Record<string, number>;
}

export interface DedupeAccountlessResearcherShellsResult {
  mode: 'apply' | 'dry-run';
  onlyShellsNotPlanned?: string[];
  /** Planned folds dropped because an operator recorded the pair as different people. */
  distinctPeopleRefusedFolds: number;
  /** Planned folds dropped because they would archive a research row's last live lead edge. */
  liveLeadRefusedFolds: Array<{ shellId: string; canonicalId: string }>;
  directoryIdentifiedResearchers: number;
  shellResearchers: number;
  netidBackedShellResearchers: number;
  byReason: Record<ShellMergeReason, number>;
  shellsMerged: number;
  aliasTwinFolds: { folded: number; refusals: Record<AliasTwinFoldRefusal, number> };
  /** Which identity decided each fold, so a netid fold cannot hide inside a name count. */
  foldsByMatchedIdentity: Record<ShellFoldIdentity, number>;
  /** Groups with no directory-backed member, folded into a survivor chosen among themselves. */
  accountlessClusters: {
    groups: number;
    foldedGroups: number;
    folds: number;
    refusedGroups: Record<AccountlessClusterRefusal, number>;
  };
  citedOfficialPage: {
    witnessedPairs: number;
    ambiguousShells: number;
    refusals: Record<CitedOfficialPageRefusal, number>;
  };
  roleAssignmentsRepointed: number;
  roleAssignmentsArchivedRedundant: number;
  /** Current edges an earlier fold archived beside an ended survivor edge, now on the survivor. */
  roleAssignmentsHealed: number;
  heals: FoldedShellEdgeHeal[];
  /** Entities whose roster the merges edited, and so the population the re-gate covers. */
  rosterChangedEntities: number;
  regatedEntities: number;
  attributeUnion: AttributeUnionTotals;
  merges: Array<{
    shellId: string;
    canonicalId: string;
    repointed: string[];
    archivedRedundant: string[];
    profileLinksAppended: number;
    identifiersFilled: string[];
    profileFieldsFilled: string[];
  }>;
}

const idKey = (value: unknown): string => (value == null ? '' : String(value));

const LIVE_ROSTER_EDGE_FILTER = {
  archived: { $ne: true },
  state: { $ne: 'HISTORICAL' },
  'target.kind': 'RESEARCH_ENTITY',
};

/**
 * Keeps only the planned merges whose shell was named, so one reviewed fold can be applied
 * while the rest of the plan waits for review. Returns the named shells the plan did not
 * merge, because a scoped run that silently applies nothing reads as done.
 */
export function scopeMergesToShells(
  mergeTargetByShellId: Map<string, string>,
  onlyShellIds: ReadonlyArray<string>,
): string[] {
  const wanted = new Set(onlyShellIds);
  for (const shellId of [...mergeTargetByShellId.keys()]) {
    if (!wanted.has(shellId)) mergeTargetByShellId.delete(shellId);
  }
  return [...wanted].filter((shellId) => !mergeTargetByShellId.has(shellId));
}

async function loadRosterIdentityCandidates(
  RoleAssignment: mongoose.mongo.Collection,
  shellIds: string[],
  researcherIdentities: ReadonlyArray<{
    id: string;
    displayName?: unknown;
    email?: unknown;
    orcid?: unknown;
    netid?: unknown;
  }>,
): Promise<Map<string, RosterIdentityCandidate[]>> {
  const candidatesByShellId = new Map<string, RosterIdentityCandidate[]>();
  if (shellIds.length === 0) return candidatesByShellId;
  const edgeProjection = {
    personId: 1,
    target: 1,
    'rosterProvenance.sourceName': 1,
    'rosterProvenance.membershipKey': 1,
  };
  const provenEdges = await RoleAssignment.find(
    { ...LIVE_ROSTER_EDGE_FILTER, 'rosterProvenance.identityBasis': { $exists: true } },
    { projection: edgeProjection },
  ).toArray();
  const provenPersonIdsByKey = new Map<string, Set<string>>();
  for (const edge of provenEdges as any[]) {
    const key = rosterMembershipEdgeKey({
      targetKind: edge.target?.kind,
      targetId: edge.target?.id,
      sourceName: edge.rosterProvenance?.sourceName,
      membershipKey: edge.rosterProvenance?.membershipKey,
    });
    if (!key) continue;
    const persons = provenPersonIdsByKey.get(key) ?? new Set<string>();
    persons.add(idKey(edge.personId));
    provenPersonIdsByKey.set(key, persons);
  }
  if (provenPersonIdsByKey.size === 0) return candidatesByShellId;

  const shellEdges = await RoleAssignment.find(
    {
      ...LIVE_ROSTER_EDGE_FILTER,
      personId: { $in: shellIds.map((id) => new mongoose.Types.ObjectId(id)) },
      'rosterProvenance.membershipKey': { $exists: true },
    },
    { projection: edgeProjection },
  ).toArray();
  const identityById = new Map(researcherIdentities.map((entry) => [entry.id, entry]));
  for (const edge of shellEdges as any[]) {
    const key = rosterMembershipEdgeKey({
      targetKind: edge.target?.kind,
      targetId: edge.target?.id,
      sourceName: edge.rosterProvenance?.sourceName,
      membershipKey: edge.rosterProvenance?.membershipKey,
    });
    const shellId = idKey(edge.personId);
    for (const personId of (key && provenPersonIdsByKey.get(key)) || []) {
      const identity = identityById.get(personId);
      if (!identity || personId === shellId) continue;
      const netid = identity.netid;
      const list = candidatesByShellId.get(shellId) ?? [];
      list.push({
        id: personId,
        displayName: identity.displayName,
        orcid: typeof identity.orcid === 'string' ? identity.orcid.trim() || undefined : undefined,
        netid: bareNetid(netid),
        tier: researcherIdentityTier({ email: identity.email, netid }),
      });
      candidatesByShellId.set(shellId, list);
    }
  }
  return candidatesByShellId;
}

interface SharedRowCandidateLoad {
  candidatesByShellId: Map<string, SharedRowCandidate[]>;
  statedNamesByShellId: Map<string, string[]>;
}

const officialPersonPagesOf = (profileLinks: unknown): string[] =>
  (Array.isArray(profileLinks) ? profileLinks : [])
    .filter((link: any) => link?.kind === 'YALE_OFFICIAL' && isPersonProfileDestination(link?.url))
    .map((link: any) => String(link.url));

const namesStatedAtPages = (
  pages: readonly string[],
  namesByPage: ReadonlyMap<string, string[]>,
): string[] => [...new Set(pages.flatMap((page) => namesByPage.get(page) ?? []))];

async function loadSharedRowCandidates(
  RoleAssignment: mongoose.mongo.Collection,
  ResearchEntities: mongoose.mongo.Collection,
  Observations: mongoose.mongo.Collection,
  shellIds: string[],
  researcherIdentities: ReadonlyArray<{
    id: string;
    displayName?: unknown;
    email?: unknown;
    orcid?: unknown;
    netid?: unknown;
    title?: unknown;
    profileLinks?: unknown;
  }>,
): Promise<SharedRowCandidateLoad> {
  const candidatesByShellId = new Map<string, SharedRowCandidate[]>();
  const statedNamesByShellId = new Map<string, string[]>();
  const empty = { candidatesByShellId, statedNamesByShellId };
  if (shellIds.length === 0) return empty;
  const projection = { projection: { personId: 1, target: 1 } };
  const shellEdges = (await RoleAssignment.find(
    {
      ...LIVE_ROSTER_EDGE_FILTER,
      personId: { $in: shellIds.map((id) => new mongoose.Types.ObjectId(id)) },
    },
    { projection: { personId: 1, target: 1, 'rosterProvenance.profileUrl': 1 } },
  ).toArray()) as any[];
  const targetIds = [...new Set(shellEdges.map((edge) => idKey(edge.target?.id)).filter(Boolean))];
  if (targetIds.length === 0) return empty;
  const liveTargets = new Set(
    (
      await ResearchEntities.find(
        {
          _id: { $in: targetIds.map((id) => new mongoose.Types.ObjectId(id)) },
          archived: { $ne: true },
        },
        { projection: { _id: 1 } },
      ).toArray()
    ).map((row: any) => idKey(row._id)),
  );
  const holderEdges = (await RoleAssignment.find(
    {
      ...LIVE_ROSTER_EDGE_FILTER,
      'target.id': { $in: [...liveTargets].map((id) => new mongoose.Types.ObjectId(id)) },
    },
    projection,
  ).toArray()) as any[];
  const holdersByTarget = new Map<string, Set<string>>();
  for (const edge of holderEdges) {
    const target = idKey(edge.target?.id);
    const holders = holdersByTarget.get(target) ?? new Set<string>();
    holders.add(idKey(edge.personId));
    holdersByTarget.set(target, holders);
  }
  const identityById = new Map(researcherIdentities.map((entry) => [entry.id, entry]));
  for (const edge of shellEdges) {
    const shellId = idKey(edge.personId);
    const target = idKey(edge.target?.id);
    if (!liveTargets.has(target)) continue;
    const list = candidatesByShellId.get(shellId) ?? [];
    for (const personId of holdersByTarget.get(target) ?? []) {
      const identity = identityById.get(personId);
      if (!identity || personId === shellId || list.some((entry) => entry.id === personId))
        continue;
      const netid = identity.netid;
      list.push({
        id: personId,
        displayName: identity.displayName,
        title: identity.title,
        orcid: typeof identity.orcid === 'string' ? identity.orcid.trim() || undefined : undefined,
        netid: bareNetid(netid),
        tier: researcherIdentityTier({ email: identity.email, netid }),
      });
    }
    candidatesByShellId.set(shellId, list);
  }
  const shellPagesById = new Map<string, Set<string>>();
  for (const shellId of candidatesByShellId.keys()) {
    shellPagesById.set(
      shellId,
      new Set(officialPersonPagesOf(identityById.get(shellId)?.profileLinks)),
    );
  }
  for (const edge of shellEdges) {
    const pages = shellPagesById.get(idKey(edge.personId));
    const profileUrl = edge.rosterProvenance?.profileUrl;
    if (pages && isPersonProfileDestination(profileUrl)) pages.add(String(profileUrl));
  }
  const candidateIds = new Set(
    [...candidatesByShellId.values()].flatMap((list) => list.map((candidate) => candidate.id)),
  );
  const candidatePagesById = new Map(
    [...candidateIds].map((id) => [id, officialPersonPagesOf(identityById.get(id)?.profileLinks)]),
  );
  const namesByPage = await namesStatedAtPersonPagesByPage(Observations, [
    ...[...shellPagesById.values()].flatMap((pages) => [...pages]),
    ...[...candidatePagesById.values()].flat(),
  ]);
  for (const [shellId, pages] of shellPagesById) {
    statedNamesByShellId.set(shellId, namesStatedAtPages([...pages], namesByPage));
  }
  for (const list of candidatesByShellId.values()) {
    for (const candidate of list) {
      candidate.statedNames = namesStatedAtPages(
        candidatePagesById.get(candidate.id) ?? [],
        namesByPage,
      );
    }
  }
  return { candidatesByShellId, statedNamesByShellId };
}

const observationReadScope = { superseded: { $ne: true } };

/**
 * Whether a URL is a person's official profile page once its known path aliases are folded,
 * so a divinity legacy faculty path counts and a lab or center site never does (#5592).
 */
function isPersonProfileDestination(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  const destination = normalizeOfficialProfileDestination(url);
  return Boolean(destination) && isLikelyOfficialPersonProfileUrl(`https://${destination}`);
}

/**
 * Stronger records sharing a live research row with each `NAME_ONLY` shell through any
 * unarchived edge, including a historical one, each marked with whether the shell's own
 * listing on that row is an identity witness: the listing (the roster entry its edge cites,
 * on that row) links an official profile whose destination the holder holds (#5592).
 */
async function loadNameVariantCandidates(
  RoleAssignment: mongoose.mongo.Collection,
  ResearchEntities: mongoose.mongo.Collection,
  Observations: mongoose.mongo.Collection,
  shellIds: string[],
  researcherIdentities: ReadonlyArray<{
    id: string;
    displayName?: unknown;
    email?: unknown;
    orcid?: unknown;
    netid?: unknown;
    title?: unknown;
    profileLinks?: unknown;
    websiteUrl?: unknown;
  }>,
): Promise<Map<string, NameVariantCandidate[]>> {
  const candidatesByShellId = new Map<string, NameVariantCandidate[]>();
  if (shellIds.length === 0) return candidatesByShellId;
  const unarchived = { archived: { $ne: true } };
  const shellEdges = (await RoleAssignment.find(
    { ...unarchived, personId: { $in: shellIds.map((id) => new mongoose.Types.ObjectId(id)) } },
    { projection: { personId: 1, target: 1, 'rosterProvenance.profileUrl': 1 } },
  ).toArray()) as any[];
  const targetIds = [...new Set(shellEdges.map((edge) => idKey(edge.target?.id)).filter(Boolean))];
  if (targetIds.length === 0) return candidatesByShellId;
  const slugByLiveTarget = new Map<string, string>(
    (
      await ResearchEntities.find(
        { _id: { $in: targetIds.map((id) => new mongoose.Types.ObjectId(id)) }, ...unarchived },
        { projection: { _id: 1, slug: 1 } },
      ).toArray()
    ).map((row: any) => [idKey(row._id), typeof row.slug === 'string' ? row.slug : '']),
  );
  const holderEdges = (await RoleAssignment.find(
    {
      ...unarchived,
      'target.id': {
        $in: [...slugByLiveTarget.keys()].map((id) => new mongoose.Types.ObjectId(id)),
      },
    },
    { projection: { personId: 1, target: 1 } },
  ).toArray()) as any[];
  const holdersByTarget = new Map<string, Set<string>>();
  for (const edge of holderEdges) {
    const target = idKey(edge.target?.id);
    holdersByTarget.set(
      target,
      (holdersByTarget.get(target) ?? new Set()).add(idKey(edge.personId)),
    );
  }

  const citedProfileUrls = [
    ...new Set(
      shellEdges
        .map((edge) => edge.rosterProvenance?.profileUrl)
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    ),
  ];
  const listingKeysByProfileUrl = new Map<string, Set<string>>();
  for (const observation of (await Observations.find(
    {
      entityType: 'researchGroupMember',
      field: 'profileUrl',
      value: { $in: citedProfileUrls },
      ...observationReadScope,
    },
    { projection: { entityKey: 1, value: 1 } },
  ).toArray()) as any[]) {
    const url = String(observation.value);
    listingKeysByProfileUrl.set(
      url,
      (listingKeysByProfileUrl.get(url) ?? new Set()).add(String(observation.entityKey)),
    );
  }
  const listingKeys = [
    ...new Set([...listingKeysByProfileUrl.values()].flatMap((keys) => [...keys])),
  ];
  const rowSlugsByListingKey = new Map<string, Set<string>>();
  const linkedUrlsByListingKey = new Map<string, string[]>();
  if (listingKeys.length > 0) {
    for (const observation of (await Observations.find(
      {
        entityType: 'researchGroupMember',
        entityKey: { $in: listingKeys },
        field: { $in: ['researchGroupKey', 'profileIdentityEvidence'] },
        ...observationReadScope,
      },
      { projection: { entityKey: 1, field: 1, value: 1 } },
    ).toArray()) as any[]) {
      const key = String(observation.entityKey);
      if (observation.field === 'researchGroupKey') {
        rowSlugsByListingKey.set(
          key,
          (rowSlugsByListingKey.get(key) ?? new Set()).add(String(observation.value)),
        );
      } else {
        const evidence = parseRosterMemberIdentityEvidence(observation.value);
        if (evidence) {
          const ownPage = normalizeOfficialProfileDestination(evidence.pageUrl);
          const outbound = evidence.linkedProfileUrls.filter(
            (url) =>
              isPersonProfileDestination(url) &&
              normalizeOfficialProfileDestination(url) !== ownPage,
          );
          linkedUrlsByListingKey.set(key, [
            ...(linkedUrlsByListingKey.get(key) ?? []),
            ...outbound,
          ]);
        }
      }
    }
  }

  const identityById = new Map(researcherIdentities.map((entry) => [entry.id, entry]));
  const destinationsOf = (identity: (typeof researcherIdentities)[number]): Set<string> =>
    new Set(
      [
        ...(Array.isArray(identity.profileLinks) ? identity.profileLinks : [])
          .filter((link: any) => link?.kind === 'YALE_OFFICIAL')
          .map((link: any) => link?.url),
        isPersonProfileDestination(identity.websiteUrl) ? identity.websiteUrl : undefined,
      ]
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
        .map((url) => normalizeOfficialProfileDestination(url))
        .filter(Boolean),
    );

  for (const edge of shellEdges) {
    const shellId = idKey(edge.personId);
    const target = idKey(edge.target?.id);
    const slug = slugByLiveTarget.get(target);
    if (slug === undefined) continue;
    const holders = holdersByTarget.get(target) ?? new Set<string>();
    const citedUrl =
      typeof edge.rosterProvenance?.profileUrl === 'string' ? edge.rosterProvenance.profileUrl : '';
    const listingLinkedDestinations = new Set(
      [...(listingKeysByProfileUrl.get(citedUrl) ?? [])]
        .filter((key) => rowSlugsByListingKey.get(key)?.has(slug))
        .flatMap((key) => linkedUrlsByListingKey.get(key) ?? [])
        .map((url) => normalizeOfficialProfileDestination(url))
        .filter(Boolean),
    );
    const list = candidatesByShellId.get(shellId) ?? [];
    for (const personId of holders) {
      if (personId === shellId) continue;
      const identity = identityById.get(personId);
      if (!identity) continue;
      const witnessed = [...destinationsOf(identity)].some((destination) =>
        listingLinkedDestinations.has(destination),
      );
      const existing = list.find((entry) => entry.id === personId);
      if (existing) {
        existing.witnessed = existing.witnessed || witnessed;
        continue;
      }
      list.push({
        id: personId,
        displayName: identity.displayName,
        title: identity.title,
        orcid: typeof identity.orcid === 'string' ? identity.orcid.trim() || undefined : undefined,
        netid: bareNetid(identity.netid),
        tier: researcherIdentityTier({ email: identity.email, netid: identity.netid }),
        witnessed,
      });
    }
    candidatesByShellId.set(shellId, list);
  }
  return candidatesByShellId;
}

const LISTING_NAME_FIELDS = ['inferredUserName', 'name'];

function listingStatedName(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const { fname, lname } = value as Record<string, unknown>;
  return [fname, lname]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
}

const PAIR_BLOCKING_REFUSALS: ReadonlySet<CitedOfficialPageRefusal> = new Set([
  'listing-name-not-page-subject',
  'third-page-holder',
  'identifier-conflict',
]);

interface CitedOfficialPageLoad {
  pairs: Array<[string, string]>;
  refusals: Record<CitedOfficialPageRefusal, number>;
}

async function loadCitedOfficialPagePairs(
  RoleAssignment: mongoose.mongo.Collection,
  ResearchEntities: mongoose.mongo.Collection,
  Observations: mongoose.mongo.Collection,
  researcherIdentities: ReadonlyArray<{
    id: string;
    displayName?: unknown;
    email?: unknown;
    orcid?: unknown;
    netid?: unknown;
    profileLinks?: unknown;
  }>,
): Promise<CitedOfficialPageLoad> {
  const refusals = Object.fromEntries(
    CITED_OFFICIAL_PAGE_REFUSALS.map((refusal) => [refusal, 0]),
  ) as Record<CitedOfficialPageRefusal, number>;
  const holderIdsByPage = new Map<string, string[]>();
  const holderUrlsByPage = new Map<string, Set<string>>();
  for (const identity of researcherIdentities) {
    for (const link of Array.isArray(identity.profileLinks) ? identity.profileLinks : []) {
      if (link?.kind !== 'YALE_OFFICIAL') continue;
      const page = citedOfficialPageKey(link.url);
      if (!page) continue;
      const holders = holderIdsByPage.get(page) ?? [];
      if (!holders.includes(identity.id)) holderIdsByPage.set(page, [...holders, identity.id]);
      holderUrlsByPage.set(page, (holderUrlsByPage.get(page) ?? new Set()).add(String(link.url)));
    }
  }
  const identityById = new Map(researcherIdentities.map((entry) => [entry.id, entry]));
  const citingEdges = (await RoleAssignment.find(
    {
      'target.kind': 'RESEARCH_ENTITY',
      'rosterProvenance.profileUrl': { $nin: [null, ''] },
      personId: {
        $in: researcherIdentities.map((entry) => new mongoose.Types.ObjectId(entry.id)),
      },
    },
    { projection: { personId: 1, target: 1, state: 1, archived: 1, rosterProvenance: 1 } },
  ).toArray()) as any[];
  const candidates: Array<{ edge: any; citerId: string; holderId: string; page: string }> = [];
  for (const edge of citingEdges) {
    const citerId = idKey(edge.personId);
    const citer = identityById.get(citerId);
    const page = citedOfficialPageKey(edge.rosterProvenance?.profileUrl);
    if (!citer || !page) continue;
    if (yaleOfficialPageWitnessKeys(citer.profileLinks).includes(page)) continue;
    for (const holderId of holderIdsByPage.get(page) ?? []) {
      if (holderId === citerId) continue;
      const holder = identityById.get(holderId);
      if (!holder || !sharedOfficialProfileNamesAgree(holder.displayName, citer.displayName)) {
        continue;
      }
      candidates.push({ edge, citerId, holderId, page });
    }
  }
  if (candidates.length === 0) return { pairs: [], refusals };

  const targetIds = [...new Set(candidates.map(({ edge }) => idKey(edge.target?.id)))];
  const liveTargets = new Set(
    (
      await ResearchEntities.find(
        {
          _id: { $in: targetIds.map((id) => new mongoose.Types.ObjectId(id)) },
          archived: { $ne: true },
        },
        { projection: { _id: 1 } },
      ).toArray()
    ).map((row: any) => idKey(row._id)),
  );
  const citedUrls = [
    ...new Set(candidates.map(({ edge }) => String(edge.rosterProvenance.profileUrl))),
  ];
  const citedUrlsBySpelling = new Map<string, Set<string>>();
  for (const url of citedUrls) {
    for (const spelling of officialProfileUrlSpellings(url)) {
      citedUrlsBySpelling.set(spelling, (citedUrlsBySpelling.get(spelling) ?? new Set()).add(url));
    }
  }
  const listingKeysByUrl = new Map<string, Set<string>>();
  for (const observation of (await Observations.find(
    {
      entityType: 'researchGroupMember',
      field: 'profileUrl',
      value: { $in: [...citedUrlsBySpelling.keys()] },
      ...observationReadScope,
    },
    { projection: { entityKey: 1, value: 1 } },
  ).toArray()) as any[]) {
    for (const url of citedUrlsBySpelling.get(String(observation.value)) ?? []) {
      listingKeysByUrl.set(
        url,
        (listingKeysByUrl.get(url) ?? new Set()).add(String(observation.entityKey)),
      );
    }
  }
  const listingKeys = [...new Set([...listingKeysByUrl.values()].flatMap((keys) => [...keys]))];
  const namesByListingKey = new Map<string, string[]>();
  if (listingKeys.length > 0) {
    for (const observation of (await Observations.find(
      {
        entityType: 'researchGroupMember',
        entityKey: { $in: listingKeys },
        field: { $in: LISTING_NAME_FIELDS },
        ...observationReadScope,
      },
      { projection: { entityKey: 1, value: 1 } },
    ).toArray()) as any[]) {
      const name = listingStatedName(observation.value);
      if (!name) continue;
      const key = String(observation.entityKey);
      namesByListingKey.set(key, [...(namesByListingKey.get(key) ?? []), name]);
    }
  }
  const pages = [...new Set(candidates.map(({ page }) => page))];
  const namesByPageUrl = await namesStatedAtPersonPagesByPage(
    Observations,
    pages.flatMap((page) => [...(holderUrlsByPage.get(page) ?? [])]),
  );

  const now = new Date();
  const accepted = new Map<string, [string, string]>();
  const blocked = new Set<string>();
  for (const { edge, citerId, holderId, page } of candidates) {
    const provenance = edge.rosterProvenance ?? {};
    const liveListingNames = [
      ...new Set(
        [...(listingKeysByUrl.get(String(provenance.profileUrl)) ?? [])].flatMap(
          (key) => namesByListingKey.get(key) ?? [],
        ),
      ),
    ];
    const refusal = citedOfficialPageRefusal({
      holder: identityById.get(holderId)!,
      citer: identityById.get(citerId)!,
      listing: {
        archived: edge.archived,
        state: edge.state,
        targetIsLive: liveTargets.has(idKey(edge.target?.id)),
        sourceName: provenance.sourceName,
        sourceUrl: provenance.sourceUrl,
        profileUrl: provenance.profileUrl,
        membershipKey: provenance.membershipKey,
        freshnessExpiresAt: provenance.freshnessExpiresAt,
        liveListingNames,
      },
      pageStatedNames: [
        ...new Set(
          [...(holderUrlsByPage.get(page) ?? [])].flatMap((url) => namesByPageUrl.get(url) ?? []),
        ),
      ],
      pageHolderIds: holderIdsByPage.get(page) ?? [],
      now,
    });
    const pairKey = distinctPeoplePairKey(citerId, holderId);
    if (refusal) {
      refusals[refusal] += 1;
      if (PAIR_BLOCKING_REFUSALS.has(refusal)) blocked.add(pairKey);
      continue;
    }
    accepted.set(pairKey, [citerId, holderId]);
  }
  return {
    pairs: [...accepted].filter(([key]) => !blocked.has(key)).map(([, pair]) => pair),
    refusals,
  };
}

interface ListingSubjectStatements {
  netidsByShellId: Map<string, Array<ReadonlySet<string>>>;
  subjectOrcidsByShellId: Map<string, string[]>;
}

/**
 * For each `NAME_ONLY` shell, what its own listings state about their subject: the listings its
 * edges cite, on the rows those edges hold. The netids are those the Yale directory pairs with
 * each stated address, and only the stated `emails` count for them, never a linked profile URL
 * (#5811). The ORCIDs are the subject-scoped `orcid` each listing's identity evidence states,
 * which the extractor writes only when the subject node states exactly one (#5932).
 */
async function loadListingSubjectStatements(
  RoleAssignment: mongoose.mongo.Collection,
  ResearchEntities: mongoose.mongo.Collection,
  Observations: mongoose.mongo.Collection,
  shellIds: string[],
): Promise<ListingSubjectStatements> {
  const netidsByShellId = new Map<string, Array<ReadonlySet<string>>>();
  const subjectOrcidsByShellId = new Map<string, string[]>();
  const statements = { netidsByShellId, subjectOrcidsByShellId };
  if (shellIds.length === 0) return statements;
  const shellEdges = (await RoleAssignment.find(
    {
      archived: { $ne: true },
      personId: { $in: shellIds.map((id) => new mongoose.Types.ObjectId(id)) },
      'rosterProvenance.profileUrl': { $type: 'string' },
    },
    { projection: { personId: 1, target: 1, 'rosterProvenance.profileUrl': 1 } },
  ).toArray()) as any[];
  if (shellEdges.length === 0) return statements;
  const targetIds = [...new Set(shellEdges.map((edge) => idKey(edge.target?.id)).filter(Boolean))];
  const slugByLiveTarget = new Map<string, string>(
    (
      await ResearchEntities.find(
        {
          _id: { $in: targetIds.map((id) => new mongoose.Types.ObjectId(id)) },
          archived: { $ne: true },
        },
        { projection: { _id: 1, slug: 1 } },
      ).toArray()
    ).map((row: any) => [idKey(row._id), typeof row.slug === 'string' ? row.slug : '']),
  );
  const citedProfileUrls = [
    ...new Set(shellEdges.map((edge) => String(edge.rosterProvenance.profileUrl))),
  ];
  const listingKeysByProfileUrl = new Map<string, Set<string>>();
  for (const observation of (await Observations.find(
    {
      entityType: 'researchGroupMember',
      field: 'profileUrl',
      value: { $in: citedProfileUrls },
      ...observationReadScope,
    },
    { projection: { entityKey: 1, value: 1 } },
  ).toArray()) as any[]) {
    const url = String(observation.value);
    listingKeysByProfileUrl.set(
      url,
      (listingKeysByProfileUrl.get(url) ?? new Set()).add(String(observation.entityKey)),
    );
  }
  const listingKeys = [
    ...new Set([...listingKeysByProfileUrl.values()].flatMap((keys) => [...keys])),
  ];
  if (listingKeys.length === 0) return statements;
  const rowSlugsByListingKey = new Map<string, Set<string>>();
  const addressesByListingKey = new Map<string, string[]>();
  const orcidsByListingKey = new Map<string, string[]>();
  for (const observation of (await Observations.find(
    {
      entityType: 'researchGroupMember',
      entityKey: { $in: listingKeys },
      field: { $in: ['researchGroupKey', 'profileIdentityEvidence'] },
      ...observationReadScope,
    },
    { projection: { entityKey: 1, field: 1, value: 1 } },
  ).toArray()) as any[]) {
    const key = String(observation.entityKey);
    if (observation.field === 'researchGroupKey') {
      rowSlugsByListingKey.set(
        key,
        (rowSlugsByListingKey.get(key) ?? new Set()).add(String(observation.value)),
      );
      continue;
    }
    const evidence = parseRosterMemberIdentityEvidence(observation.value);
    if (evidence) {
      addressesByListingKey.set(key, [
        ...(addressesByListingKey.get(key) ?? []),
        ...evidence.emails.map((email) => email.trim().toLowerCase()),
      ]);
      if (evidence.orcid) {
        orcidsByListingKey.set(key, [...(orcidsByListingKey.get(key) ?? []), evidence.orcid]);
      }
    }
  }
  const directory = await loadDirectoryNetidsByAddress();
  const seenAddressesByShellId = new Map<string, Set<string>>();
  for (const edge of shellEdges) {
    const shellId = idKey(edge.personId);
    const slug = slugByLiveTarget.get(idKey(edge.target?.id));
    if (!slug) continue;
    const seen = seenAddressesByShellId.get(shellId) ?? new Set<string>();
    seenAddressesByShellId.set(shellId, seen);
    for (const key of listingKeysByProfileUrl.get(String(edge.rosterProvenance.profileUrl)) ?? []) {
      if (!rowSlugsByListingKey.get(key)?.has(slug)) continue;
      for (const orcid of orcidsByListingKey.get(key) ?? []) {
        const orcids = subjectOrcidsByShellId.get(shellId) ?? [];
        if (!orcids.includes(orcid)) subjectOrcidsByShellId.set(shellId, [...orcids, orcid]);
      }
      for (const address of addressesByListingKey.get(key) ?? []) {
        const netids = directory.get(address);
        if (!netids || netids.size === 0 || seen.has(address)) continue;
        seen.add(address);
        netidsByShellId.set(shellId, [...(netidsByShellId.get(shellId) ?? []), netids]);
      }
    }
  }
  return statements;
}

const ORCID_PATTERN = /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i;

const bareOrcid = (value: unknown): string | undefined => {
  const stated = typeof value === 'string' ? ORCID_PATTERN.exec(value)?.[0] : undefined;
  return plausiblePersonOrcid(stated) || undefined;
};

const officialPageWitnessKey = (url: unknown): string =>
  typeof url === 'string' && url
    ? officialPageWitnessDestination(normalizeOfficialProfileDestination(url))
    : '';

const destinationUrlVariants = (destination: string): string[] =>
  ['https://', 'http://', 'https://www.', 'http://www.'].flatMap((prefix) => [
    `${prefix}${destination}`,
    `${prefix}${destination}/`,
  ]);

const CITABLE_PROFILE_HEALTH = new Set(['HEALTHY', 'UNKNOWN']);

/**
 * For each `NAME_ONLY` shell, what each official profile page it cites states: the shell's own
 * official primary links that are not probed dead, and the profile URLs its live edges cite. The
 * statements are the `email` and `orcid` values page lanes observed with that page as their source,
 * read as values the page states and never through the key they were written under (#5606).
 */
async function loadOfficialPageStatements(
  RoleAssignment: mongoose.mongo.Collection,
  Observations: mongoose.mongo.Collection,
  shells: ReadonlyArray<{ id: string; profileLinks?: unknown }>,
): Promise<Map<string, OfficialPageStatement[]>> {
  const statementsByShellId = new Map<string, OfficialPageStatement[]>();
  if (shells.length === 0) return statementsByShellId;
  const citedUrlsByShellId = new Map<string, Set<string>>();
  const cite = (shellId: string, url: unknown) => {
    if (typeof url !== 'string' || !isPersonProfileDestination(url)) return;
    citedUrlsByShellId.set(shellId, (citedUrlsByShellId.get(shellId) ?? new Set()).add(url));
  };
  for (const shell of shells) {
    for (const link of Array.isArray(shell.profileLinks) ? shell.profileLinks : []) {
      if (link?.kind !== 'YALE_OFFICIAL' || link?.purpose !== 'PRIMARY_IDENTITY') continue;
      if (link?.healthStatus && !CITABLE_PROFILE_HEALTH.has(String(link.healthStatus))) continue;
      cite(shell.id, link.url);
    }
  }
  for (const edge of (await RoleAssignment.find(
    {
      archived: { $ne: true },
      personId: { $in: shells.map((shell) => new mongoose.Types.ObjectId(shell.id)) },
      'rosterProvenance.profileUrl': { $type: 'string' },
    },
    { projection: { personId: 1, 'rosterProvenance.profileUrl': 1 } },
  ).toArray()) as any[]) {
    cite(idKey(edge.personId), edge.rosterProvenance?.profileUrl);
  }
  const destinations = new Set<string>();
  for (const urls of citedUrlsByShellId.values()) {
    for (const url of urls) {
      destinations.add(normalizeOfficialProfileDestination(url));
      destinations.add(officialPageWitnessKey(url));
    }
  }
  if (destinations.size === 0) return statementsByShellId;
  const statementByPage = new Map<string, { emails: Set<string>; orcids: Set<string> }>();
  for (const observation of (await Observations.find(
    {
      entityType: 'user',
      field: { $in: ['email', 'orcid'] },
      sourceUrl: { $in: [...destinations].flatMap(destinationUrlVariants) },
      ...observationReadScope,
    },
    { projection: { field: 1, value: 1, sourceUrl: 1 } },
  ).toArray()) as any[]) {
    const page = officialPageWitnessKey(observation.sourceUrl);
    if (!page) continue;
    const statement = statementByPage.get(page) ?? { emails: new Set(), orcids: new Set() };
    if (observation.field === 'email' && typeof observation.value === 'string') {
      statement.emails.add(observation.value.trim().toLowerCase());
    } else {
      const orcid = bareOrcid(observation.value);
      if (orcid) statement.orcids.add(orcid);
    }
    statementByPage.set(page, statement);
  }
  const directory = await loadDirectoryNetidsByAddress();
  for (const [shellId, urls] of citedUrlsByShellId) {
    const pages = new Set([...urls].map(officialPageWitnessKey).filter(Boolean));
    const statements = [...pages].flatMap((page) => {
      const statement = statementByPage.get(page);
      if (!statement) return [];
      const emails = [...statement.emails];
      const directoryNetids = [
        ...new Set(emails.flatMap((email) => [...(directory.get(email) ?? [])])),
      ];
      return [{ emails, orcids: [...statement.orcids], directoryNetids }];
    });
    if (statements.length) statementsByShellId.set(shellId, statements);
  }
  return statementsByShellId;
}

function officialPageHoldersOf(
  researcherIdentities: ReadonlyArray<{
    id: string;
    displayName?: unknown;
    email?: unknown;
    orcid?: unknown;
    netid?: unknown;
    title?: unknown;
  }>,
): OfficialPageHolders {
  const byEmail = new Map<string, OfficialPageCandidate[]>();
  const byOrcid = new Map<string, OfficialPageCandidate[]>();
  for (const identity of researcherIdentities) {
    const tier = researcherIdentityTier({ email: identity.email, netid: identity.netid });
    if (tier !== 'DIRECTORY') continue;
    const orcid = bareOrcid(identity.orcid);
    const email = String(identity.email).trim().toLowerCase();
    const candidate: OfficialPageCandidate = {
      id: identity.id,
      email,
      displayName: identity.displayName,
      title: identity.title,
      orcid,
      netid: bareNetid(identity.netid),
      tier,
    };
    byEmail.set(email, [...(byEmail.get(email) ?? []), candidate]);
    if (orcid) byOrcid.set(orcid, [...(byOrcid.get(orcid) ?? []), candidate]);
  }
  return { byEmail, byOrcid };
}

function directoryEmailHoldersByNetid(
  researcherIdentities: ReadonlyArray<{
    id: string;
    displayName?: unknown;
    email?: unknown;
    orcid?: unknown;
    netid?: unknown;
    title?: unknown;
  }>,
): Map<string, DirectoryEmailCandidate[]> {
  const holders = new Map<string, DirectoryEmailCandidate[]>();
  for (const identity of researcherIdentities) {
    const netid = bareNetid(identity.netid);
    if (!netid) continue;
    holders.set(netid, [
      ...(holders.get(netid) ?? []),
      {
        id: identity.id,
        displayName: identity.displayName,
        title: identity.title,
        orcid: typeof identity.orcid === 'string' ? identity.orcid.trim() || undefined : undefined,
        netid,
        tier: researcherIdentityTier({ email: identity.email, netid: identity.netid }),
      },
    ]);
  }
  return holders;
}

/** An alias twin's `identifiers.netid` is the email local part, never a netid to hand on. */
function withoutNetidIdentifier(
  snapshot: ResearcherAttributeSnapshot,
): ResearcherAttributeSnapshot {
  const { netid: _localPart, ...identifiers } = (snapshot.identifiers ?? {}) as Record<
    string,
    unknown
  >;
  return { ...snapshot, identifiers } as ResearcherAttributeSnapshot;
}

async function planAliasTwinFoldsFor(
  researchers: ReadonlyArray<{
    id: string;
    displayName?: unknown;
    netid?: unknown;
    email?: unknown;
    orcid?: unknown;
  }>,
  loginNetids: ReadonlySet<string>,
) {
  const emaillessAliases = emaillessLocalPartTwinAliases(researchers);
  const emaillessTwinNetid = (entry: { netid?: unknown }) =>
    typeof entry.netid === 'string' ? entry.netid.trim().toLowerCase() : '';
  const twinResearchers = [
    ...researchers
      .filter((entry) => isLocalPartNetid(entry))
      .map((entry) => ({
        id: entry.id,
        netid: String(entry.netid),
        displayName: entry.displayName,
        orcid: entry.orcid,
      })),
    ...researchers
      .filter((entry) => emaillessAliases.has(emaillessTwinNetid(entry)))
      .map((entry) => ({
        id: entry.id,
        netid: emaillessTwinNetid(entry),
        displayName: entry.displayName,
        orcid: entry.orcid,
      })),
  ];
  const aliasNetidByTwinNetid = new Map<string, string>(emaillessAliases);
  for (const twin of twinResearchers) {
    if (aliasNetidByTwinNetid.has(twin.netid)) continue;
    const resolution = await resolveNetidForRosterEmailAlias(twin.netid);
    if (resolution.status === 'resolved') aliasNetidByTwinNetid.set(twin.netid, resolution.netid);
  }
  return planAliasTwinFolds({
    twinResearchers,
    researcherByNetid: new Map(
      researchers
        .filter((entry) => typeof entry.netid === 'string' && entry.netid)
        .map((entry) => [
          String(entry.netid),
          { id: entry.id, displayName: entry.displayName, orcid: entry.orcid },
        ]),
    ),
    aliasNetidByTwinNetid,
    loginNetids,
  });
}

export async function planHealsForFoldedShells(input: {
  Researcher: mongoose.mongo.Collection;
  RoleAssignment: mongoose.mongo.Collection;
  liveResearcherIds: ReadonlySet<string>;
  foldingResearcherIds: ReadonlySet<string>;
  onlyShellIds?: ReadonlyArray<string>;
}): Promise<FoldedShellEdgeHeal[]> {
  const scope = input.onlyShellIds
    ? { _id: { $in: input.onlyShellIds.map((id) => new mongoose.Types.ObjectId(id)) } }
    : {};
  const foldedShells = (
    (await input.Researcher.find(
      { ...scope, archived: true, dedupedIntoResearcherId: { $ne: null } },
      { projection: { dedupedIntoResearcherId: 1, dedupedAt: 1 } },
    ).toArray()) as any[]
  )
    .map((doc) => ({
      id: idKey(doc._id),
      survivorId: idKey(doc.dedupedIntoResearcherId),
      dedupedAt: doc.dedupedAt,
    }))
    .filter(
      (shell) =>
        input.liveResearcherIds.has(shell.survivorId) &&
        !input.foldingResearcherIds.has(shell.survivorId),
    );
  if (foldedShells.length === 0) return [];
  const archivedShellEdges = (
    (await input.RoleAssignment.find({
      personId: { $in: foldedShells.map((shell) => new mongoose.Types.ObjectId(shell.id)) },
      archived: true,
      state: { $ne: 'HISTORICAL' },
      'target.kind': 'RESEARCH_ENTITY',
    }).toArray()) as any[]
  ).map((ra) => ({
    id: idKey(ra._id),
    personId: idKey(ra.personId),
    targetKind: ra.target?.kind,
    targetId: idKey(ra.target?.id),
    role: ra.role,
    state: ra.state,
    archived: ra.archived,
    endedAt: ra.endedAt,
    reviewStatus: ra.reviewStatus,
    reviewNotes: ra.reviewNotes,
    reviewedBy: ra.reviewedBy,
    reviewedAt: ra.reviewedAt,
  }));
  if (archivedShellEdges.length === 0) return [];
  const targetObjectIds = [...new Set(archivedShellEdges.map((edge) => edge.targetId))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const survivorObjectIds = [...new Set(foldedShells.map((shell) => shell.survivorId))].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const survivorEdges = (
    (await input.RoleAssignment.find({
      personId: { $in: survivorObjectIds },
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': { $in: targetObjectIds },
    }).toArray()) as any[]
  ).map((ra) => ({
    id: idKey(ra._id),
    personId: idKey(ra.personId),
    targetKind: ra.target?.kind,
    targetId: idKey(ra.target?.id),
    role: ra.role,
    state: ra.state,
    archived: ra.archived,
    reviewStatus: ra.reviewStatus,
    endedAt: ra.endedAt,
  }));
  const liveTargetIds = new Set(
    (
      (await mongoose.connection
        .collection('research_entities')
        .find(
          { _id: { $in: targetObjectIds }, archived: { $ne: true } },
          { projection: { _id: 1 } },
        )
        .toArray()) as any[]
    ).map((doc) => idKey(doc._id)),
  );
  const auditedEdgeIds = new Set(
    (
      (await mongoose.connection
        .collection('admin_audit_events')
        .find(
          { targetId: { $in: archivedShellEdges.map((edge) => edge.id) } },
          { projection: { targetId: 1 } },
        )
        .toArray()) as any[]
    ).map((doc) => idKey(doc.targetId)),
  );
  return planFoldedShellEdgeHeals({
    foldedShells,
    archivedShellEdges,
    survivorEdges,
    liveSurvivorIds: input.liveResearcherIds,
    liveTargetIds,
    auditedEdgeIds,
  });
}

export async function dedupeAccountlessResearcherShells(options: {
  apply: boolean;
  onlyShellIds?: ReadonlyArray<string>;
}): Promise<DedupeAccountlessResearcherShellsResult> {
  const Researcher = mongoose.connection.collection('researchers');
  const RoleAssignment = mongoose.connection.collection('role_assignments');

  const liveResearchers = await Researcher.find(
    { archived: { $ne: true } },
    {
      projection: {
        displayName: 1,
        'identifiers.orcid': 1,
        'identifiers.netid': 1,
        'identifiers.email': 1,
        profileLinks: 1,
        'profile.title': 1,
        'profile.primaryDepartment': 1,
        'profile.websiteUrl': 1,
        distinctFromResearcherIds: 1,
      },
    },
  ).toArray();

  const researcherIdentities = (liveResearchers as any[]).map((doc) => ({
    id: idKey(doc._id),
    displayName: doc.displayName,
    email: doc.identifiers?.email,
    orcid: doc.identifiers?.orcid,
    netid: doc.identifiers?.netid,
    profileLinks: doc.profileLinks,
    title: doc.profile?.title,
    primaryDepartment: doc.profile?.primaryDepartment,
    websiteUrl: doc.profile?.websiteUrl,
  }));
  const distinctPeoplePairs = new Set<string>([
    ...(liveResearchers as any[]).flatMap((doc) =>
      (Array.isArray(doc.distinctFromResearcherIds) ? doc.distinctFromResearcherIds : []).map(
        (otherId: unknown) => distinctPeoplePairKey(idKey(doc._id), idKey(otherId)),
      ),
    ),
    ...(await loadDistinctPeopleVerdictIndex())
      .verdictPairs()
      .map(([left, right]) => distinctPeoplePairKey(left, right)),
  ]);

  const canonicalIndex = buildCanonicalNameIndex(researcherIdentities);

  const loginNetids = new Set(
    (
      await mongoose.connection
        .collection('accounts')
        .find({ lastLoginAt: { $ne: null } }, { projection: { netid: 1 } })
        .toArray()
    )
      .map((doc: any) => (typeof doc.netid === 'string' ? doc.netid : ''))
      .filter(Boolean),
  );
  const canonicalNetidIndex = buildCanonicalNetidIndex(researcherIdentities);

  const verifiedProfileIndex = buildVerifiedPrimaryProfileIndex(researcherIdentities);
  const sharedOfficialProfileIndex = buildYaleOfficialProfileIndex(researcherIdentities);

  const foldableShells = researcherIdentities.filter(
    (entry) => researcherIdentityTier(entry) !== 'DIRECTORY',
  );
  const netidBackedShellResearchers = foldableShells.filter(
    (entry) => researcherIdentityTier(entry) === 'NETID',
  ).length;

  const byReason: Record<ShellMergeReason, number> = {
    MERGEABLE: 0,
    NO_NAME: 0,
    NO_CANONICAL: 0,
    AMBIGUOUS_MULTIPLE_CANONICAL: 0,
    ORCID_CONFLICT: 0,
    NETID_CONFLICT: 0,
    EMAIL_CONFLICT: 0,
    NO_IDENTITY_WITNESS: 0,
    VARIANT_SHAPE_NOT_ALLOWED: 0,
    STATED_MIDDLE_INITIAL_CONFLICT: 0,
  };

  const rosterIdentityCandidatesByShellId = await loadRosterIdentityCandidates(
    RoleAssignment,
    foldableShells.map((entry) => entry.id),
    researcherIdentities,
  );

  const sharedRowLoad = await loadSharedRowCandidates(
    RoleAssignment,
    mongoose.connection.collection('research_entities'),
    mongoose.connection.collection('observations'),
    foldableShells.map((entry) => entry.id),
    researcherIdentities,
  );

  const nameOnlyShellIds = foldableShells
    .filter((entry) => researcherIdentityTier(entry) === 'NAME_ONLY')
    .map((entry) => entry.id);
  const nameVariantCandidatesByShellId = await loadNameVariantCandidates(
    RoleAssignment,
    mongoose.connection.collection('research_entities'),
    mongoose.connection.collection('observations'),
    nameOnlyShellIds,
    researcherIdentities,
  );

  const listingSubjectStatements = await loadListingSubjectStatements(
    RoleAssignment,
    mongoose.connection.collection('research_entities'),
    mongoose.connection.collection('observations'),
    nameOnlyShellIds,
  );
  const directoryEmailHolders = directoryEmailHoldersByNetid(researcherIdentities);
  const officialPageStatementsByShellId = await loadOfficialPageStatements(
    RoleAssignment,
    mongoose.connection.collection('observations'),
    foldableShells.filter((entry) => researcherIdentityTier(entry) === 'NAME_ONLY'),
  );
  const officialPageHolders = officialPageHoldersOf(researcherIdentities);
  const orcidOnlyHolders = orcidOnlyHoldersByOrcid(researcherIdentities);

  const decidedTargetByShellId = new Map<string, string>();
  const matchedIdentityByShellId = new Map<string, ShellFoldIdentity>();
  for (const shell of foldableShells) {
    const decision = decideShellMerge(
      { ...shell, statedNames: sharedRowLoad.statedNamesByShellId.get(shell.id) },
      canonicalIndex,
      canonicalNetidIndex,
      rosterIdentityCandidatesByShellId.get(shell.id),
      verifiedProfileIndex,
      sharedRowLoad.candidatesByShellId.get(shell.id),
      nameVariantCandidatesByShellId.get(shell.id),
      listingSubjectStatements.netidsByShellId.get(shell.id),
      directoryEmailHolders,
      officialPageStatementsByShellId.get(shell.id),
      officialPageHolders,
      listingSubjectStatements.subjectOrcidsByShellId.get(shell.id),
      orcidOnlyHolders,
      sharedOfficialProfileIndex,
    );
    byReason[decision.reason] += 1;
    if (decision.merge && decision.canonicalId && decision.canonicalId !== shell.id) {
      decidedTargetByShellId.set(shell.id, decision.canonicalId);
      if (decision.matchedOn) matchedIdentityByShellId.set(shell.id, decision.matchedOn);
    }
  }
  const citedOfficialPageLoad = await loadCitedOfficialPagePairs(
    RoleAssignment,
    mongoose.connection.collection('research_entities'),
    mongoose.connection.collection('observations'),
    researcherIdentities,
  );
  const citedOfficialPageRouting = routeCitedOfficialPagePairs(
    citedOfficialPageLoad.pairs,
    new Map(researcherIdentities.map((entry) => [entry.id, researcherIdentityTier(entry)])),
  );
  for (const [shellId, targetId] of citedOfficialPageRouting.targetByShellId) {
    if (decidedTargetByShellId.has(shellId)) continue;
    decidedTargetByShellId.set(shellId, targetId);
    matchedIdentityByShellId.set(shellId, 'cited-official-page');
  }
  const aliasTwinPlan = await planAliasTwinFoldsFor(researcherIdentities, loginNetids);
  for (const [twinId, realId] of aliasTwinPlan.targetByTwinResearcherId) {
    decidedTargetByShellId.set(twinId, realId);
    matchedIdentityByShellId.delete(twinId);
  }
  const directRefusal = withoutDistinctPeopleFolds(decidedTargetByShellId, distinctPeoplePairs);
  const mergeTargetByShellId = resolveFinalMergeTargets(directRefusal.kept);

  const outrankingCanonicalIds = new Set(mergeTargetByShellId.values());
  const clusterCandidates = foldableShells.filter(
    (entry) => !mergeTargetByShellId.has(entry.id) && !outrankingCanonicalIds.has(entry.id),
  );
  const clusterCandidateIds = new Set(clusterCandidates.map((entry) => entry.id));
  const liveEdgeCounts = new Map<string, number>(
    (
      (await RoleAssignment.aggregate([
        {
          $match: {
            personId: {
              $in: clusterCandidates.map((entry) => new mongoose.Types.ObjectId(entry.id)),
            },
            archived: { $ne: true },
          },
        },
        { $group: { _id: '$personId', count: { $sum: 1 } } },
      ]).toArray()) as any[]
    ).map((row) => [idKey(row._id), Number(row.count) || 0]),
  );
  const clusterRowEdges = (await RoleAssignment.find(
    {
      ...LIVE_ROSTER_EDGE_FILTER,
      personId: { $in: clusterCandidates.map((entry) => new mongoose.Types.ObjectId(entry.id)) },
    },
    { projection: { personId: 1, 'target.id': 1 } },
  ).toArray()) as any[];
  const clusterRowIds = [...new Set(clusterRowEdges.map((edge) => idKey(edge.target?.id)))];
  const liveClusterRows = new Set(
    (
      await mongoose.connection
        .collection('research_entities')
        .find(
          {
            _id: { $in: clusterRowIds.map((id) => new mongoose.Types.ObjectId(id)) },
            archived: { $ne: true },
          },
          { projection: { _id: 1 } },
        )
        .toArray()
    ).map((row: any) => idKey(row._id)),
  );
  const liveRowIdsByMember = new Map<string, string[]>();
  for (const edge of clusterRowEdges) {
    const rowId = idKey(edge.target?.id);
    if (!liveClusterRows.has(rowId)) continue;
    const memberId = idKey(edge.personId);
    liveRowIdsByMember.set(memberId, [...(liveRowIdsByMember.get(memberId) ?? []), rowId]);
  }
  const clusterPlan = planAccountlessClusterFolds(
    clusterCandidates.map((entry) => ({
      ...entry,
      liveRoleEdges: liveEdgeCounts.get(entry.id) ?? 0,
      liveRowIds: liveRowIdsByMember.get(entry.id) ?? [],
    })),
    researcherIdentities.filter((entry) => !clusterCandidateIds.has(entry.id)),
    citedOfficialPageRouting.equalTierJoins,
  );
  for (const [shellId, survivorId] of clusterPlan.foldTargetById) {
    mergeTargetByShellId.set(shellId, survivorId);
    if (clusterPlan.sharedOfficialProfileFoldIds.has(shellId)) {
      matchedIdentityByShellId.set(shellId, 'shared-official-profile');
    } else if (clusterPlan.citedOfficialPageFoldIds.has(shellId)) {
      matchedIdentityByShellId.set(shellId, 'cited-official-page');
    } else {
      matchedIdentityByShellId.delete(shellId);
    }
  }
  const finalRefusal = withoutDistinctPeopleFolds(mergeTargetByShellId, distinctPeoplePairs);
  for (const shellId of [...mergeTargetByShellId.keys()]) {
    if (!finalRefusal.kept.has(shellId)) mergeTargetByShellId.delete(shellId);
  }
  const distinctPeopleRefusedFolds = directRefusal.refused + finalRefusal.refused;
  const onlyShellsNotPlanned = options.onlyShellIds
    ? scopeMergesToShells(mergeTargetByShellId, options.onlyShellIds)
    : undefined;

  const shellObjectIds = Array.from(mergeTargetByShellId.keys()).map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const canonicalObjectIds = Array.from(new Set(mergeTargetByShellId.values())).map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const attributeProjection = {
    profileLinks: 1,
    identifiers: 1,
    profile: 1,
    fieldValueRefusals: 1,
  } as const;
  const snapshotOf = (doc: any): ResearcherAttributeSnapshot => ({
    profileLinks: Array.isArray(doc?.profileLinks) ? doc.profileLinks : [],
    identifiers: doc?.identifiers ?? {},
    profile: doc?.profile ?? {},
    fieldValueRefusals: doc?.fieldValueRefusals,
  });

  const shellDocs = shellObjectIds.length
    ? await Researcher.find(
        { _id: { $in: shellObjectIds } },
        { projection: attributeProjection },
      ).toArray()
    : [];
  const canonicalDocs = canonicalObjectIds.length
    ? await Researcher.find(
        { _id: { $in: canonicalObjectIds } },
        { projection: attributeProjection },
      ).toArray()
    : [];

  const shellSnapshotById = new Map<string, ResearcherAttributeSnapshot>();
  for (const doc of shellDocs as any[]) shellSnapshotById.set(idKey(doc._id), snapshotOf(doc));
  const canonicalSnapshotById = new Map<string, ResearcherAttributeSnapshot>();
  for (const doc of canonicalDocs as any[]) {
    canonicalSnapshotById.set(idKey(doc._id), snapshotOf(doc));
  }

  const shellRoleAssignments = shellObjectIds.length
    ? await RoleAssignment.find({
        personId: { $in: shellObjectIds },
        archived: { $ne: true },
      }).toArray()
    : [];
  // A canonical edge an operator detached still claims its key: repointing the shell's
  // edge onto it would hand the canonical person a live copy of the edge the detachment
  // took away, the twin bypass #3152 records, so the shell's edge is archived instead.
  const canonicalRoleAssignments = canonicalObjectIds.length
    ? await RoleAssignment.find({
        personId: { $in: canonicalObjectIds },
        $or: [
          { archived: { $ne: true } },
          { reviewStatus: DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS },
        ],
      }).toArray()
    : [];

  const asFoldPlanEdge = (ra: any): FoldPlanEdge => ({
    id: idKey(ra._id),
    personId: idKey(ra.personId),
    targetKind: ra.target?.kind,
    targetId: ra.target?.id,
    role: ra.role,
    state: ra.state,
    archived: ra.archived,
    reviewStatus: ra.reviewStatus,
  });
  const shellFoldEdges = (shellRoleAssignments as any[]).map(asFoldPlanEdge);
  const survivorClaimEdges = (canonicalRoleAssignments as any[]).map(asFoldPlanEdge);
  const leadRoles = new Set<string>(LEAD_ROLE_CANONICAL_VALUES);
  const shellLeadTargetIds = [
    ...new Set(
      shellFoldEdges
        .filter((edge) => typeof edge.role === 'string' && leadRoles.has(edge.role))
        .map((edge) => idKey(edge.targetId))
        .filter(Boolean),
    ),
  ];
  const liveLeadEdges = shellLeadTargetIds.length
    ? (
        (await RoleAssignment.find(
          {
            archived: { $ne: true },
            role: { $in: [...leadRoles] },
            'target.id': { $in: shellLeadTargetIds.map((id) => new mongoose.Types.ObjectId(id)) },
          },
          { projection: { personId: 1, target: 1, role: 1, state: 1 } },
        ).toArray()) as any[]
      ).map(asFoldPlanEdge)
    : [];
  const liveLeadRefusedFolds: Array<{ shellId: string; canonicalId: string }> = [];
  let mergesByShell = planShellEdgeMoves(shellFoldEdges, survivorClaimEdges, mergeTargetByShellId);
  for (;;) {
    const refused = foldsArchivingOnlyLiveLead({
      movesByShell: mergesByShell,
      shellEdges: shellFoldEdges,
      liveLeadEdges,
      leadRoles,
    });
    if (refused.size === 0) break;
    for (const shellId of refused) {
      liveLeadRefusedFolds.push({ shellId, canonicalId: mergeTargetByShellId.get(shellId)! });
      mergeTargetByShellId.delete(shellId);
    }
    mergesByShell = planShellEdgeMoves(shellFoldEdges, survivorClaimEdges, mergeTargetByShellId);
  }
  if (onlyShellsNotPlanned) {
    onlyShellsNotPlanned.push(...liveLeadRefusedFolds.map((refusal) => refusal.shellId));
  }
  const foldsByMatchedIdentity = Object.fromEntries(
    SHELL_FOLD_IDENTITIES.map((identity) => [identity, 0]),
  ) as Record<ShellFoldIdentity, number>;
  for (const shellId of mergeTargetByShellId.keys()) {
    const matchedOn = matchedIdentityByShellId.get(shellId);
    if (matchedOn) foldsByMatchedIdentity[matchedOn] += 1;
  }

  const rosterChangedEntityIds = new Set<string>();
  for (const edge of shellFoldEdges) {
    if (!mergeTargetByShellId.has(edge.personId)) continue;
    if (edge.targetKind === 'RESEARCH_ENTITY' && idKey(edge.targetId)) {
      rosterChangedEntityIds.add(idKey(edge.targetId));
    }
  }

  const merges: DedupeAccountlessResearcherShellsResult['merges'] = [];
  let roleAssignmentsRepointed = 0;
  let roleAssignmentsArchivedRedundant = 0;

  const attributeUnion: AttributeUnionTotals = {
    profileLinksAppended: 0,
    identifiersFilled: {},
    profileFieldsFilled: {},
  };

  const roleAssignmentOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
  const researcherOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
  const dedupedAt = new Date();

  const canonicalMergeState = new Map<string, ResearcherAttributeSnapshot>();
  const canonicalAppendedLinks = new Map<string, ResearcherAttributeSnapshot['profileLinks']>();
  const canonicalSetFills = new Map<string, Record<string, unknown>>();

  for (const [shellId, canonicalId] of mergeTargetByShellId.entries()) {
    const edges = mergesByShell.get(shellId) ?? { repointed: [], archivedRedundant: [] };
    roleAssignmentsRepointed += edges.repointed.length;
    roleAssignmentsArchivedRedundant += edges.archivedRedundant.length;

    for (const raId of edges.repointed) {
      roleAssignmentOps.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(raId) },
          update: { $set: { personId: new mongoose.Types.ObjectId(canonicalId) } },
        },
      });
    }
    for (const raId of edges.archivedRedundant) {
      roleAssignmentOps.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(raId) },
          update: { $set: { archived: true } },
        },
      });
    }

    const canonicalState = canonicalMergeState.get(canonicalId) ??
      canonicalSnapshotById.get(canonicalId) ?? { profileLinks: [], identifiers: {}, profile: {} };
    const storedShellSnapshot = shellSnapshotById.get(shellId) ?? {
      profileLinks: [],
      identifiers: {},
      profile: {},
    };
    const shellSnapshot = aliasTwinPlan.targetByTwinResearcherId.has(shellId)
      ? withoutNetidIdentifier(storedShellSnapshot)
      : storedShellSnapshot;
    const plan = planResearcherAttributeUnion(canonicalState, shellSnapshot);

    if (!researcherAttributeUnionIsEmpty(plan)) {
      canonicalMergeState.set(canonicalId, applyUnionPlanToSnapshot(canonicalState, plan));

      const appendedForCanonical = canonicalAppendedLinks.get(canonicalId) ?? [];
      appendedForCanonical.push(...plan.profileLinksToAppend);
      canonicalAppendedLinks.set(canonicalId, appendedForCanonical);

      const setForCanonical = canonicalSetFills.get(canonicalId) ?? {};
      for (const [field, value] of Object.entries(plan.identifierGapFills)) {
        setForCanonical[`identifiers.${field}`] = value;
      }
      for (const [field, value] of Object.entries(plan.profileGapFills)) {
        setForCanonical[`profile.${field}`] = value;
      }
      for (const [field, list] of Object.entries(
        withCopiedRefusals(canonicalState.fieldValueRefusals, plan.refusalsToCopy),
      )) {
        if (plan.refusalsToCopy[field]) setForCanonical[`fieldValueRefusals.${field}`] = list;
      }
      canonicalSetFills.set(canonicalId, setForCanonical);
    }

    attributeUnion.profileLinksAppended += plan.profileLinksToAppend.length;
    for (const field of Object.keys(plan.identifierGapFills)) {
      attributeUnion.identifiersFilled[field] = (attributeUnion.identifiersFilled[field] ?? 0) + 1;
    }
    for (const field of Object.keys(plan.profileGapFills)) {
      attributeUnion.profileFieldsFilled[field] =
        (attributeUnion.profileFieldsFilled[field] ?? 0) + 1;
    }

    merges.push({
      shellId,
      canonicalId,
      repointed: edges.repointed,
      archivedRedundant: edges.archivedRedundant,
      profileLinksAppended: plan.profileLinksToAppend.length,
      identifiersFilled: Object.keys(plan.identifierGapFills),
      profileFieldsFilled: Object.keys(plan.profileGapFills),
    });

    const shellArchiveUpdate: Record<string, unknown> = {
      $set: {
        archived: true,
        dedupedIntoResearcherId: new mongoose.Types.ObjectId(canonicalId),
        dedupedAt,
      },
    };
    const transferredUniqueIdentifierUnsets: Record<string, ''> = {};
    for (const field of Object.keys(plan.identifierGapFills)) {
      if (RESEARCHER_UNIQUE_IDENTIFIER_FIELDS.has(field)) {
        transferredUniqueIdentifierUnsets[`identifiers.${field}`] = '';
      }
    }
    // The archived twin lets go of its local-part `identifiers.netid`: the netid resolver does
    // not skip an archived researcher, so a twin still holding the alias would keep answering
    // for it (#4988).
    if (aliasTwinPlan.targetByTwinResearcherId.has(shellId)) {
      transferredUniqueIdentifierUnsets['identifiers.netid'] = '';
    }
    if (Object.keys(transferredUniqueIdentifierUnsets).length) {
      shellArchiveUpdate.$unset = transferredUniqueIdentifierUnsets;
    }
    const releasedLinkKinds = shellProfileLinkKindsReleasedWith(plan);
    if (releasedLinkKinds.length) {
      shellArchiveUpdate.$pull = { profileLinks: { kind: { $in: releasedLinkKinds } } };
    }

    researcherOps.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(shellId) },
        update: shellArchiveUpdate,
      },
    });
  }

  const repointedTargetsBySurvivor = new Set<string>();
  const shellEdgeById = new Map(shellFoldEdges.map((edge) => [edge.id, edge]));
  for (const merge of merges) {
    for (const edgeId of merge.repointed) {
      const edge = shellEdgeById.get(edgeId);
      if (edge) repointedTargetsBySurvivor.add(`${merge.canonicalId}|${idKey(edge.targetId)}`);
    }
  }
  const heals = (
    await planHealsForFoldedShells({
      Researcher,
      RoleAssignment,
      liveResearcherIds: new Set(researcherIdentities.map((identity) => identity.id)),
      foldingResearcherIds: new Set(mergeTargetByShellId.keys()),
      ...(options.onlyShellIds ? { onlyShellIds: options.onlyShellIds } : {}),
    })
  ).filter((heal) => !repointedTargetsBySurvivor.has(`${heal.survivorId}|${heal.targetId}`));
  for (const heal of heals) {
    const reattach = roleAssignmentReattachWrite(
      {
        _id: new mongoose.Types.ObjectId(heal.edgeId),
        personId: new mongoose.Types.ObjectId(heal.shellId),
        archived: true,
        state: { $ne: 'HISTORICAL' },
      },
      'UNREVIEWED',
    );
    roleAssignmentOps.push({
      updateOne: {
        filter: reattach.filter,
        update: {
          $set: {
            ...(reattach.update.$set as Record<string, unknown>),
            personId: new mongoose.Types.ObjectId(heal.survivorId),
          },
        },
      },
    });
    rosterChangedEntityIds.add(heal.targetId);
  }
  if (onlyShellsNotPlanned) {
    const healedShellIds = new Set(heals.map((heal) => heal.shellId));
    const stillNotPlanned = onlyShellsNotPlanned.filter((id) => !healedShellIds.has(id));
    onlyShellsNotPlanned.splice(0, onlyShellsNotPlanned.length, ...stillNotPlanned);
  }

  const canonicalIds = new Set<string>([
    ...canonicalAppendedLinks.keys(),
    ...canonicalSetFills.keys(),
  ]);
  const canonicalUnionOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
  for (const canonicalId of canonicalIds) {
    const setFields = canonicalSetFills.get(canonicalId) ?? {};
    const appendedLinks = canonicalAppendedLinks.get(canonicalId) ?? [];
    const mergedState = canonicalMergeState.get(canonicalId);
    const refusedStoredValues = mergedState
      ? planResearcherRefusedStoredValueClear(mergedState)
      : { unset: [], profileLinkUrlsToPull: [] };
    const refusedLinkUrls = new Set(refusedStoredValues.profileLinkUrlsToPull);
    const update: Record<string, unknown> = {};
    if (refusedLinkUrls.size) {
      setFields.profileLinks = (mergedState?.profileLinks ?? []).filter(
        (link) => !refusedLinkUrls.has(String(link.url)),
      );
    } else if (appendedLinks.length) {
      update.$push = { profileLinks: { $each: appendedLinks } };
    }
    if (Object.keys(setFields).length) update.$set = setFields;
    if (refusedStoredValues.unset.length) {
      update.$unset = Object.fromEntries(refusedStoredValues.unset.map((path) => [path, '']));
    }
    if (!Object.keys(update).length) continue;
    canonicalUnionOps.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(canonicalId) },
        update,
      },
    });
  }

  let regatedEntities = 0;
  if (options.apply) {
    if (researcherOps.length) await Researcher.bulkWrite(researcherOps, { ordered: false });
    if (canonicalUnionOps.length) await Researcher.bulkWrite(canonicalUnionOps, { ordered: false });
    if (roleAssignmentOps.length)
      await RoleAssignment.bulkWrite(roleAssignmentOps, { ordered: false });

    // Folding a shell changes the roster of every entity it held an edge on, and the
    // gate reads that roster: a merge can turn a name-only lead into a netid-backed
    // one, or remove a duplicate the row was held on. It can also make the survivor
    // lead a second row for the same research, which changes the verdict of the
    // survivor's own rows (#5687). Without this the row keeps a
    // tier and a search document describing a roster that no longer exists (#2952),
    // the same self-resync obligation `docs/research-data-pipeline.md` records for the
    // other roster-editing lanes. Re-gate through the ordinary gate rather than
    // writing tiers here, so every other blocker still applies; its apply path also
    // resyncs the affected search documents.
    const regateEntityIds = researchEntityIdsToRegateAfterFold({
      shellEdges: shellRoleAssignments as FoldRegateEdge[],
      survivorEdges: canonicalRoleAssignments as FoldRegateEdge[],
      mergeTargetByShellId,
    });
    for (const heal of heals) regateEntityIds.add(heal.targetId);
    if (regateEntityIds.size > 0) {
      await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: [...regateEntityIds],
      });
      regatedEntities = regateEntityIds.size;
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    distinctPeopleRefusedFolds,
    liveLeadRefusedFolds,
    ...(onlyShellsNotPlanned ? { onlyShellsNotPlanned } : {}),
    directoryIdentifiedResearchers: researcherIdentities.length - foldableShells.length,
    shellResearchers: foldableShells.length,
    netidBackedShellResearchers,
    byReason,
    shellsMerged: mergeTargetByShellId.size,
    aliasTwinFolds: {
      folded: [...aliasTwinPlan.targetByTwinResearcherId.keys()].filter((id) =>
        mergeTargetByShellId.has(id),
      ).length,
      refusals: aliasTwinPlan.refusals,
    },
    foldsByMatchedIdentity,
    accountlessClusters: {
      groups: clusterPlan.groups,
      foldedGroups: clusterPlan.foldedGroups,
      folds: clusterPlan.foldTargetById.size,
      refusedGroups: clusterPlan.refusedGroups,
    },
    citedOfficialPage: {
      witnessedPairs: citedOfficialPageLoad.pairs.length,
      ambiguousShells: citedOfficialPageRouting.ambiguousShellIds.size,
      refusals: citedOfficialPageLoad.refusals,
    },
    roleAssignmentsRepointed,
    roleAssignmentsArchivedRedundant,
    roleAssignmentsHealed: heals.length,
    heals,
    rosterChangedEntities: rosterChangedEntityIds.size,
    regatedEntities,
    attributeUnion,
    merges,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseDedupeAccountlessResearcherShellsArgs(process.argv.slice(2));
  assertDedupeAccountlessResearcherShellsApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'dedupe:accountless-researcher-shells',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const result = await dedupeAccountlessResearcherShells({
    apply: args.apply,
    ...(args.onlyShellIds ? { onlyShellIds: args.onlyShellIds } : {}),
  });

  const { merges, ...summary } = result;
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    options: args,
    ...summary,
    mergeCount: merges.length,
  };
  console.log(JSON.stringify(report, null, 2));
  writeOutput({ ...report, merges }, args.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to dedupe accountless researcher shells:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

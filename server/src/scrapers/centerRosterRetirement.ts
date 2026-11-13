/**
 * How `centers-institutes-index` stops asserting a center member it no longer lists
 * (#3781).
 *
 * Every roster member is its own observation key (`<center>:<member>`), so a member the
 * roster stops listing is never re-asserted and never superseded: its observations stay
 * live, the materializer keeps its role edge, and a stale lead edge is never demoted.
 * A fresh run cannot fix that by writing, because it says nothing about a key it did not
 * read.
 *
 * The evidence is a positive absence, stated by the lane itself: each successful read
 * emits a `centerRosterHealth` snapshot naming every member key, role claim, membership
 * key and relationship key it listed. Only a snapshot that read the whole roster, listed
 * at least one member, and came off the wire rather than the snapshot cache is admitted.
 * A refused, failed, partial, paged-out or empty read emits no admissible snapshot, so it
 * retires nothing.
 *
 * The guards, mirroring `facultyRosterDepartureReconciler`, `ysmLabDelistingReconciler`
 * and `fieldRetraction`, all fail closed:
 *
 *   1. Two admitted reads (`CENTER_ROSTER_MIN_ABSENT_READS`) in distinct runs, both after
 *      the claim was last observed and after the last read that listed it.
 *   2. A per-center absence ceiling (`CENTER_ROSTER_MAX_ABSENT_FRACTION`) over each
 *      population it governs: member keys, role edges and relationship keys. A broken
 *      selector or a key-shape change stops listing everybody at once and persists
 *      across runs, which defeats guard 1, so above the ceiling the center is frozen for
 *      the pass and reported, never applied partially.
 *   3. A discovery-retention floor (`CENTER_ROSTER_DISCOVERY_RETENTION_MIN_FRACTION`):
 *      a read that lists far fewer people than the largest admitted read on record is a
 *      read to distrust, whatever the absence fraction says.
 *
 * A `sectionsRecorded` snapshot (#6084) also says which section each listing sat under. For a
 * lane that adopts that contract, a person listed under a past or emeritus section in two such
 * reads is departed and their edge ends, while a person in no section is only omitted, which
 * retires nothing without a witness from the person's own page.
 *
 * Scope is what this lane itself listed for this center: observations carrying this
 * source's name under this center's key prefix, and role edges whose
 * `rosterProvenance.sourceName` is this source. An edge whose membership key or
 * person-and-role another source still asserts is left alone, and so is a relationship
 * whose target another source, or a relationship key this read still lists, names.
 *
 * Retirement writes no field and no lock. Observations are retired through the
 * `superseded` plus `rollback` shape both read scopes honour, an edge is ended
 * (`state: HISTORICAL`) exactly as an official-roster departure ends one, and a
 * relationship is archived. Nothing is deleted, and because no live observation backs a
 * retired claim any more, the next materialization has nothing to resurrect it from.
 */
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { RoleAssignment } from '../models/roleAssignment';
import { syncResearchEntitiesWithOutcome } from '../services/researchEntityIndexSyncOutcome';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { escapeRegex } from '../utils/regex';
import { retireObservations } from './observationStore';
import {
  RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
  relationshipTargetIdentities,
  type RelationshipTargetIdentity,
} from './centerRelationshipTarget';
import {
  comparableRosterMembershipKey,
  officialProfileIdentityKey,
} from './utils/rosterMembershipKey';
import { attributedArchiveSet } from '../models/entityArchival';
import { liveResearchEntityNamedByKeyObservations } from './renamedResearchEntityAdoption';

export const CENTERS_INSTITUTES_SOURCE_NAME = 'centers-institutes-index';
export const CENTER_ROSTER_HEALTH_ENTITY_TYPE = 'centerRosterHealth' as const;
export const CENTER_ROSTER_HEALTH_FIELD = 'centerRosterHealth';
export const CENTER_ROSTER_MIN_ABSENT_READS = 2;
export const CENTER_ROSTER_MAX_ABSENT_FRACTION = 0.5;
export const CENTER_ROSTER_DISCOVERY_RETENTION_MIN_FRACTION = 0.75;
export const CENTER_ROSTER_RETIREMENT_REASON =
  'center roster retirement: two complete reads of the center roster no longer list this claim (#3781)';
export const CENTER_AFFILIATION_LLM_SOURCE_NAME = 'center-affiliation-llm';
export const CENTER_AFFILIATION_RETIREMENT_REASON =
  'center affiliation retirement: two complete reads of the center page no longer name this claim (#4022)';

export const CENTER_AFFILIATION_ROSTER_SOURCE_NAME = 'center-affiliation-roster';
export const CENTER_AFFILIATION_ROSTER_RETIREMENT_REASON =
  'center affiliation roster retirement: two complete reads of the center page no longer list this affiliation (#5296)';

export interface CenterRosterLane {
  sourceName: string;
  retirementReason: string;
  /**
   * The lane records the section each listing sits under (#6084). Only such a lane reads a
   * `sectionsRecorded` snapshot under the departed-versus-omitted rule; every other lane's
   * snapshots are read under the plain absence rule even if one carried sections.
   */
  adoptsSectionContract?: boolean;
}

export const CENTERS_INSTITUTES_ROSTER_LANE: CenterRosterLane = {
  sourceName: CENTERS_INSTITUTES_SOURCE_NAME,
  retirementReason: CENTER_ROSTER_RETIREMENT_REASON,
  adoptsSectionContract: true,
};

export const CENTER_ROSTER_SECTION_CLASSIFIER_VERSION = 1;

/**
 * What a roster section says about the people it lists. `past` covers Alumni, Former, Past,
 * Previous, Retired and In Memoriam sections; `unclassified` is a listing with no section
 * label, read as current exactly as before the contract.
 */
export type CenterRosterSectionKind = 'current' | 'past' | 'emeritus' | 'unclassified';

export const centerRosterSectionEndsMembership = (kind: CenterRosterSectionKind): boolean =>
  kind === 'past' || kind === 'emeritus';

export const CENTER_AFFILIATION_ROSTER_LANE: CenterRosterLane = {
  sourceName: CENTER_AFFILIATION_LLM_SOURCE_NAME,
  retirementReason: CENTER_AFFILIATION_RETIREMENT_REASON,
};

export const CENTER_AFFILIATION_CODE_ROSTER_LANE: CenterRosterLane = {
  sourceName: CENTER_AFFILIATION_ROSTER_SOURCE_NAME,
  retirementReason: CENTER_AFFILIATION_ROSTER_RETIREMENT_REASON,
};

export type CenterRosterStopReason =
  | 'not-paginated'
  | 'empty-page'
  | 'repeated-page'
  | 'rendered-page'
  | 'page-cap'
  | 'fetch-failed'
  | 'extractor-error';

const STOP_REASONS_AT_THE_ROSTER_END: ReadonlySet<CenterRosterStopReason> = new Set([
  'not-paginated',
  'empty-page',
  'repeated-page',
  'rendered-page',
]);

export function centerRosterStopReadWholeRoster(stopReason: CenterRosterStopReason): boolean {
  return STOP_REASONS_AT_THE_ROSTER_END.has(stopReason);
}

export interface CenterRosterReadMember {
  memberKey: string;
  role: string;
  /**
   * Centre concepts, so optional: a lane whose listing carries no membership or relationship
   * identity omits them rather than inventing one. Admissibility and absence only ever read
   * `memberKey` and `role`.
   */
  membershipKey?: string;
  relationshipKey?: string;
  /**
   * The row this listed member's claim sits on, for a lane whose claim is a field on another
   * record rather than a membership of the listing itself. Absent means the lane could not say
   * which row this member's claim belongs to on this read, which is unknown rather than absent
   * and must never retire anything (#3852).
   */
  claimEntityKey?: string;
  sectionKind?: CenterRosterSectionKind;
  sectionLabel?: string;
  sectionFingerprint?: string;
  /**
   * The member's own page, read in the same run, states a current appointment, which wins
   * over an emeritus section listing as the #5835 rule has a fresh own-page read win.
   */
  ownPageCurrentAppointment?: boolean;
  /**
   * The member's own page was not read in this run, so the #5835 own-page check could not
   * run and an emeritus listing is only omitted, never departed.
   */
  ownPageUnread?: boolean;
}

export interface CenterRosterSectionRecord {
  label: string;
  kind: CenterRosterSectionKind;
  listedCount: number;
  fingerprint: string;
  complete: boolean;
  stopReason: CenterRosterStopReason;
  pagesRead: number;
  personTypeFilter?: boolean;
}

export type CenterRosterReadStatus = 'ok' | 'empty' | 'partial-read';

export interface CenterRosterHealthSnapshot {
  centerKey?: unknown;
  entityKey?: unknown;
  status?: unknown;
  complete?: unknown;
  discoveredCount?: unknown;
  members?: unknown;
  /**
   * Official-profile identity keys of the single-person pages this read confirmed were about
   * their own subject and parsed. Only a single-subject lane records them, because on such a
   * page a statement that is missing is evidence once the subject itself was read (#5091).
   */
  subjectKeys?: unknown;
  sectionsRecorded?: unknown;
  sectionClassifierVersion?: unknown;
  sections?: unknown;
  read?: {
    pagesRead?: unknown;
    readMode?: unknown;
    cacheAllowed?: unknown;
    stopReason?: unknown;
    readAt?: unknown;
  };
}

export function buildCenterRosterHealthSnapshot(input: {
  centerKey: string;
  entityKey: string;
  members: readonly CenterRosterReadMember[];
  pagesRead: number;
  readMode: 'html' | 'rendered';
  stopReason: CenterRosterStopReason;
  cacheAllowed: boolean;
  readAt: Date;
  subjectKeys?: readonly string[];
  sections?: readonly CenterRosterSectionRecord[];
}): CenterRosterHealthSnapshot {
  const members = [...input.members].sort((left, right) =>
    left.memberKey.localeCompare(right.memberKey),
  );
  const readWholeRoster = centerRosterStopReadWholeRoster(input.stopReason);
  const status: CenterRosterReadStatus = !readWholeRoster
    ? 'partial-read'
    : members.length > 0
      ? 'ok'
      : 'empty';
  return {
    centerKey: input.centerKey,
    entityKey: input.entityKey,
    status,
    complete: status === 'ok',
    discoveredCount: members.length,
    members,
    ...(input.subjectKeys ? { subjectKeys: [...new Set(input.subjectKeys)].sort() } : {}),
    ...(input.sections
      ? {
          sectionsRecorded: true,
          sectionClassifierVersion: CENTER_ROSTER_SECTION_CLASSIFIER_VERSION,
          sections: input.sections.map((section) => ({ ...section })),
        }
      : {}),
    read: {
      pagesRead: input.pagesRead,
      readMode: input.readMode,
      cacheAllowed: input.cacheAllowed,
      stopReason: input.stopReason,
      readAt: input.readAt.toISOString(),
    },
  };
}

/**
 * Only `read-listed-members` is evidence for a roster. A cache-permitted read is excluded
 * because two runs inside the snapshot cache's lifetime replay one fetch, which would let a
 * single parse satisfy the two-read rule; the exhaustive sweep modes never pass `--use-cache`.
 *
 * `read-subject-stated-nothing` is a single-subject read that confirmed its subject and found
 * no claim. A roster read that lists nobody cannot be told apart from a broken selector, so it
 * stays inadmissible; a person's own profile whose subject was parsed can, so a single-subject
 * lane may weigh that read as an absence (#5091). The roster planner never admits it.
 */
export type CenterRosterReadAdmissibility =
  | 'read-listed-members'
  | 'read-subject-stated-nothing'
  | 'read-listed-nobody'
  | 'incomplete'
  | 'cache-permitted'
  | 'not-read'
  | 'unrecorded';

export function snapshotMembers(snapshot: CenterRosterHealthSnapshot): CenterRosterReadMember[] {
  if (!Array.isArray(snapshot.members)) return [];
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return snapshot.members
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry) => ({
      memberKey: text(entry.memberKey),
      role: text(entry.role),
      membershipKey: text(entry.membershipKey),
      relationshipKey: text(entry.relationshipKey),
      claimEntityKey: text(entry.claimEntityKey),
      ...(SECTION_KINDS.has(text(entry.sectionKind) as CenterRosterSectionKind)
        ? { sectionKind: text(entry.sectionKind) as CenterRosterSectionKind }
        : {}),
      ...(text(entry.sectionLabel) ? { sectionLabel: text(entry.sectionLabel) } : {}),
      ...(text(entry.sectionFingerprint)
        ? { sectionFingerprint: text(entry.sectionFingerprint) }
        : {}),
      ...(entry.ownPageCurrentAppointment === true ? { ownPageCurrentAppointment: true } : {}),
      ...(entry.ownPageUnread === true ? { ownPageUnread: true } : {}),
    }))
    .filter((entry) => entry.memberKey && entry.role);
}

const SECTION_KINDS: ReadonlySet<CenterRosterSectionKind> = new Set([
  'current',
  'past',
  'emeritus',
  'unclassified',
]);

export function snapshotRecordsSections(snapshot: CenterRosterHealthSnapshot): boolean {
  return snapshot.sectionsRecorded === true && Array.isArray(snapshot.sections);
}

export function snapshotSections(
  snapshot: CenterRosterHealthSnapshot,
): CenterRosterSectionRecord[] {
  if (!snapshotRecordsSections(snapshot)) return [];
  return (snapshot.sections as unknown[])
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry) => ({
      label: typeof entry.label === 'string' ? entry.label : '',
      kind: (SECTION_KINDS.has(entry.kind as CenterRosterSectionKind)
        ? entry.kind
        : 'unclassified') as CenterRosterSectionKind,
      listedCount: typeof entry.listedCount === 'number' ? entry.listedCount : 0,
      fingerprint: typeof entry.fingerprint === 'string' ? entry.fingerprint : '',
      complete: entry.complete === true,
      stopReason: entry.stopReason as CenterRosterStopReason,
      pagesRead: typeof entry.pagesRead === 'number' ? entry.pagesRead : 0,
      ...(entry.personTypeFilter === true ? { personTypeFilter: true } : {}),
    }))
    .filter((section) => section.fingerprint);
}

export interface CenterRosterSectionListing {
  memberKey: string;
  label: string;
  kind: CenterRosterSectionKind;
  stageKey: string;
  pageIndex: number;
}

export interface CenterRosterSectionStage {
  key: string;
  personTypeFilter: boolean;
  stopReason: CenterRosterStopReason;
}

export interface CenterRosterMemberSection {
  kind: CenterRosterSectionKind;
  label: string;
  fingerprint: string;
}

export interface ResolvedCenterRosterSections {
  sections: CenterRosterSectionRecord[];
  memberSections: Map<string, CenterRosterMemberSection>;
}

const SECTION_KIND_RANK: Record<CenterRosterSectionKind, number> = {
  current: 0,
  unclassified: 1,
  emeritus: 2,
  past: 3,
};

export function centerRosterSectionFingerprint(memberKeys: Iterable<string>): string {
  const sorted = [...new Set(memberKeys)].sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Groups a read's listings into sections and resolves the one section each member is read
 * under, failing closed toward current at every step:
 *
 * - A section whose fingerprint (its sorted member keys) another section of the same pass
 *   shares is not a section of its own, so a repeated sidebar block never reads as a second
 *   section. Of the sections that share a fingerprint, the most current one stands. A filter
 *   pass's fingerprint carries its stage, because a filter that lists exactly the unfiltered
 *   roster is a second listing rather than a sidebar, and dropping either would leave its
 *   members with no section.
 * - A member listed under a current or unlabelled section and under a past one is current.
 * - A person-type filter outranks the unfiltered listing, which mixes every type, but only
 *   when every filter pass reached its end: a filter left unfinished could hold the current
 *   listing that would have outranked a past one. A member only a filter pass listed then
 *   gets no section at all, so it is omitted rather than read under that filter.
 */
export function resolveCenterRosterSections(
  listings: readonly CenterRosterSectionListing[],
  stages: readonly CenterRosterSectionStage[],
): ResolvedCenterRosterSections {
  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  interface RawSection {
    stageKey: string;
    label: string;
    kind: CenterRosterSectionKind;
    memberKeys: Set<string>;
    pages: Set<number>;
    order: number;
  }
  const raw = new Map<string, RawSection>();
  for (const listing of listings) {
    if (!listing.memberKey || !stageByKey.has(listing.stageKey)) continue;
    const key = [listing.stageKey, listing.label, listing.kind].join('\u0000');
    let section = raw.get(key);
    if (!section) {
      section = {
        stageKey: listing.stageKey,
        label: listing.label,
        kind: listing.kind,
        memberKeys: new Set(),
        pages: new Set(),
        order: raw.size,
      };
      raw.set(key, section);
    }
    section.memberKeys.add(listing.memberKey);
    section.pages.add(listing.pageIndex);
  }

  const byFingerprint = new Map<string, RawSection[]>();
  for (const section of raw.values()) {
    const fingerprint = centerRosterSectionFingerprint(
      section.stageKey ? [`stage:${section.stageKey}`, ...section.memberKeys] : section.memberKeys,
    );
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), section]);
  }
  const standing: Array<RawSection & { fingerprint: string }> = [];
  for (const [fingerprint, group] of byFingerprint) {
    const winner = [...group].sort(
      (left, right) =>
        SECTION_KIND_RANK[left.kind] - SECTION_KIND_RANK[right.kind] || left.order - right.order,
    )[0];
    standing.push({ ...winner, fingerprint });
  }
  standing.sort((left, right) => left.order - right.order);

  const filterStages = stages.filter((stage) => stage.personTypeFilter);
  const filtersUsable =
    filterStages.length > 0 &&
    filterStages.every((stage) => centerRosterStopReadWholeRoster(stage.stopReason));
  const isFilterSection = (section: RawSection) =>
    stageByKey.get(section.stageKey)?.personTypeFilter === true;

  const memberSections = new Map<string, CenterRosterMemberSection>();
  const memberKeys = new Set(listings.map((listing) => listing.memberKey).filter(Boolean));
  for (const memberKey of memberKeys) {
    const containing = standing.filter((section) => section.memberKeys.has(memberKey));
    const filtered = containing.filter(isFilterSection);
    const unfiltered = containing.filter((section) => !isFilterSection(section));
    const candidates = filtersUsable && filtered.length > 0 ? filtered : unfiltered;
    const chosen = [...candidates].sort(
      (left, right) =>
        SECTION_KIND_RANK[left.kind] - SECTION_KIND_RANK[right.kind] || left.order - right.order,
    )[0];
    if (!chosen) continue;
    memberSections.set(memberKey, {
      kind: chosen.kind,
      label: chosen.label,
      fingerprint: chosen.fingerprint,
    });
  }

  const sections: CenterRosterSectionRecord[] = standing.map((section) => {
    const stage = stageByKey.get(section.stageKey) as CenterRosterSectionStage;
    return {
      label: section.label,
      kind: section.kind,
      listedCount: section.memberKeys.size,
      fingerprint: section.fingerprint,
      complete: centerRosterStopReadWholeRoster(stage.stopReason),
      stopReason: stage.stopReason,
      pagesRead: section.pages.size,
      ...(stage.personTypeFilter ? { personTypeFilter: true } : {}),
    };
  });
  return { sections, memberSections };
}

export function snapshotSubjectKeys(snapshot: CenterRosterHealthSnapshot): string[] {
  if (!Array.isArray(snapshot.subjectKeys)) return [];
  return snapshot.subjectKeys.filter(
    (key): key is string => typeof key === 'string' && key.trim().length > 0,
  );
}

export function centerRosterReadAdmissibility(
  snapshot: CenterRosterHealthSnapshot,
): CenterRosterReadAdmissibility {
  if (!Array.isArray(snapshot.members)) return 'unrecorded';
  const read = snapshot.read;
  if (!read || typeof read !== 'object') return 'unrecorded';
  const pagesRead = typeof read.pagesRead === 'number' ? read.pagesRead : 0;
  if (pagesRead <= 0 || (read.readMode !== 'html' && read.readMode !== 'rendered')) {
    return 'not-read';
  }
  if (snapshot.status === 'empty') {
    if (snapshotSubjectKeys(snapshot).length === 0) return 'read-listed-nobody';
    return read.cacheAllowed !== false ? 'cache-permitted' : 'read-subject-stated-nothing';
  }
  if (snapshot.complete !== true) return 'incomplete';
  if (snapshotMembers(snapshot).length === 0) return 'read-listed-nobody';
  if (read.cacheAllowed !== false) return 'cache-permitted';
  return 'read-listed-members';
}

export interface CenterRosterRead {
  scrapeRunId: string;
  observedAt: Date;
  discoveredCount: number;
  memberKeys: ReadonlySet<string>;
  memberClaims: ReadonlySet<string>;
  memberProfileClaims: ReadonlySet<string>;
  membershipKeys: ReadonlySet<string>;
  relationshipKeys: ReadonlySet<string>;
  members: readonly CenterRosterReadMember[];
  memberIdentities?: ReadonlySet<string>;
  sections?: CenterRosterReadSections;
}

/**
 * Identities are `comparableRosterMembershipKey` forms of a membership key's identity part,
 * so a person listed under a different role or a moved profile path is the same person.
 */
export interface CenterRosterReadSections {
  currentIdentities: ReadonlySet<string>;
  departedIdentities: ReadonlyMap<string, string>;
  listedIdentities: ReadonlySet<string>;
  departedMemberKeys: ReadonlySet<string>;
  omittedMemberKeys: ReadonlySet<string>;
  listingCountsByKind: Readonly<Record<CenterRosterSectionKind, number>>;
}

export const memberClaimKey = (memberKey: string, role: string): string => `${memberKey}|${role}`;

const identityPart = (membershipKey: string): string => {
  const separator = membershipKey.lastIndexOf('|');
  return separator > 0 ? membershipKey.slice(0, separator) : membershipKey;
};

const comparableIdentity = (membershipKey: string): string =>
  membershipKey ? comparableRosterMembershipKey(identityPart(membershipKey)) : '';

type MemberSectionVerdict = 'listed' | 'departed' | 'omitted';

/**
 * Departed means listed under a past or emeritus section that was itself read to its end.
 * Listed under such a section that was not read to its end is omitted, never departed, and
 * an emeritus listing loses to a current appointment the member's own page states.
 */
function memberSectionVerdict(
  member: CenterRosterReadMember,
  sectionsByFingerprint: ReadonlyMap<string, CenterRosterSectionRecord>,
): MemberSectionVerdict {
  const kind = member.sectionKind ?? 'unclassified';
  if (!centerRosterSectionEndsMembership(kind)) return 'listed';
  if (kind === 'emeritus' && member.ownPageCurrentAppointment) return 'listed';
  if (kind === 'emeritus' && member.ownPageUnread) return 'omitted';
  const section = sectionsByFingerprint.get(member.sectionFingerprint ?? '');
  return section && section.kind === kind && section.complete ? 'departed' : 'omitted';
}

function readSectionsFromSnapshot(
  snapshot: CenterRosterHealthSnapshot,
  members: readonly CenterRosterReadMember[],
): { sections: CenterRosterReadSections; listedMembers: CenterRosterReadMember[] } {
  const sectionsByFingerprint = new Map(
    snapshotSections(snapshot).map((section) => [section.fingerprint, section]),
  );
  const currentIdentities = new Set<string>();
  const departedIdentities = new Map<string, string>();
  const listedIdentities = new Set<string>();
  const departedMemberKeys = new Set<string>();
  const omittedMemberKeys = new Set<string>();
  const listingCountsByKind: Record<CenterRosterSectionKind, number> = {
    current: 0,
    past: 0,
    emeritus: 0,
    unclassified: 0,
  };
  const listedMembers: CenterRosterReadMember[] = [];
  for (const member of members) {
    listingCountsByKind[member.sectionKind ?? 'unclassified'] += 1;
    const verdict = memberSectionVerdict(member, sectionsByFingerprint);
    const identity = comparableIdentity(member.membershipKey ?? '');
    if (verdict === 'omitted') {
      omittedMemberKeys.add(member.memberKey);
      continue;
    }
    listedMembers.push(member);
    if (identity) listedIdentities.add(identity);
    if (verdict === 'departed') {
      departedMemberKeys.add(member.memberKey);
      if (identity) departedIdentities.set(identity, member.sectionLabel ?? '');
    } else if (identity) {
      currentIdentities.add(identity);
    }
  }
  for (const identity of currentIdentities) departedIdentities.delete(identity);
  return {
    sections: {
      currentIdentities,
      departedIdentities,
      listedIdentities,
      departedMemberKeys,
      omittedMemberKeys,
      listingCountsByKind,
    },
    listedMembers,
  };
}

export function centerRosterReadFromSnapshot(
  snapshot: CenterRosterHealthSnapshot,
  scrapeRunId: string,
  observedAt: Date,
  options: { adoptsSectionContract?: boolean } = {},
): CenterRosterRead | null {
  if (centerRosterReadAdmissibility(snapshot) !== 'read-listed-members') return null;
  const allMembers = snapshotMembers(snapshot);
  const sectioned =
    options.adoptsSectionContract === true && snapshotRecordsSections(snapshot)
      ? readSectionsFromSnapshot(snapshot, allMembers)
      : null;
  const members = sectioned ? sectioned.listedMembers : allMembers;
  return {
    ...(sectioned ? { sections: sectioned.sections } : {}),
    scrapeRunId,
    observedAt,
    discoveredCount: new Set(allMembers.map((member) => member.memberKey)).size,
    memberKeys: new Set(members.map((member) => member.memberKey)),
    memberClaims: new Set(members.map((member) => memberClaimKey(member.memberKey, member.role))),
    memberProfileClaims: new Set(
      members
        .filter((member) => member.membershipKey)
        .map((member) =>
          memberClaimKey(
            member.memberKey,
            comparableRosterMembershipKey(identityPart(member.membershipKey ?? '')),
          ),
        ),
    ),
    membershipKeys: new Set(
      members
        .map((member) => comparableRosterMembershipKey(member.membershipKey ?? ''))
        .filter(Boolean),
    ),
    relationshipKeys: new Set(
      members.map((member) => member.relationshipKey ?? '').filter(Boolean),
    ),
    members,
    memberIdentities: new Set(
      members.map((member) => comparableIdentity(member.membershipKey ?? '')).filter(Boolean),
    ),
  };
}

/**
 * Admitted reads after the claim was last observed AND after the last read that listed
 * it, in runs other than the one that last observed it. Anchoring on the last listing as
 * well as on the observation keeps an intermittent absence from accumulating: a claim
 * listed between two absences starts counting again.
 */
export function absentReadRunIds<Read extends { scrapeRunId: string; observedAt: Date }>(
  claim: { observedAt: Date; scrapeRunId?: string },
  reads: readonly Read[],
  isListed: (read: Read) => boolean,
): string[] {
  let anchor = claim.observedAt.getTime();
  for (const read of reads) {
    if (isListed(read)) anchor = Math.max(anchor, read.observedAt.getTime());
  }
  const runIds = new Set<string>();
  for (const read of reads) {
    if (claim.scrapeRunId && read.scrapeRunId === claim.scrapeRunId) continue;
    if (!(read.observedAt.getTime() > anchor)) continue;
    if (isListed(read)) continue;
    runIds.add(read.scrapeRunId);
  }
  return Array.from(runIds);
}

/**
 * Admitted `sectionsRecorded` reads in distinct runs that list the claim's person under a
 * past or emeritus section read to its end, after the claim was last observed and after the
 * last read that listed the person as current (#6084). A read cached or in the claim's own
 * run never counts, exactly as for absence.
 */
export function departedReadRunIds<Read extends CenterRosterRead>(
  claim: { observedAt: Date; scrapeRunId?: string },
  reads: readonly Read[],
  identity: string,
): string[] {
  if (!identity) return [];
  let anchor = claim.observedAt.getTime();
  for (const read of reads) {
    const listedCurrent = read.sections
      ? read.sections.currentIdentities.has(identity)
      : (read.memberIdentities?.has(identity) ??
        read.members.some((member) => comparableIdentity(member.membershipKey ?? '') === identity));
    if (listedCurrent) anchor = Math.max(anchor, read.observedAt.getTime());
  }
  const runIds = new Set<string>();
  for (const read of reads) {
    if (!read.sections) continue;
    if (claim.scrapeRunId && read.scrapeRunId === claim.scrapeRunId) continue;
    if (!(read.observedAt.getTime() > anchor)) continue;
    if (!read.sections.departedIdentities.has(identity)) continue;
    runIds.add(read.scrapeRunId);
  }
  return Array.from(runIds);
}

const latestDepartedSectionLabel = (reads: readonly CenterRosterRead[], identity: string) =>
  [...reads]
    .filter((read) => read.sections?.departedIdentities.has(identity))
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0]
    ?.sections?.departedIdentities.get(identity) ?? '';

/**
 * Under the section contract an absence is only an omission, which is never evidence about
 * the person (#2647): it retires a claim only beside a positive witness, the person's own
 * page saying they left or died. A claim whose absent reads are all pre-contract reads keeps
 * the plain absence rule.
 */
const absentReadsRecordSections = (
  absentRunIds: readonly string[],
  reads: readonly CenterRosterRead[],
): boolean => {
  const absent = new Set(absentRunIds);
  return reads.some((read) => absent.has(read.scrapeRunId) && read.sections !== undefined);
};

export function passesCenterRosterAbsenceCeiling(
  absentCount: number,
  governedCount: number,
  maxFraction: number = CENTER_ROSTER_MAX_ABSENT_FRACTION,
): boolean {
  if (absentCount <= 0) return true;
  if (governedCount <= 0) return false;
  return absentCount <= maxFraction * governedCount;
}

export function centerRosterDiscoveryRegressed(
  reads: readonly CenterRosterRead[],
  minRetainedFraction: number = CENTER_ROSTER_DISCOVERY_RETENTION_MIN_FRACTION,
): boolean {
  if (reads.length < 2) return false;
  const latest = reads.reduce((newest, read) =>
    read.observedAt.getTime() > newest.observedAt.getTime() ? read : newest,
  );
  const largest = Math.max(...reads.map((read) => read.discoveredCount));
  return latest.discoveredCount < minRetainedFraction * largest;
}

export interface CenterRosterGovernedObservation {
  observationId: string;
  entityKey: string;
  field: string;
  value: unknown;
  scrapeRunId: string;
  observedAt: Date;
  superseded: boolean;
}

export interface CenterRosterGovernedEdge {
  edgeId: string;
  personId: string;
  role: string;
  membershipKey: string;
  observedAt: Date | null;
}

export type CenterRosterFreezeReason =
  | 'member-absence-above-ceiling'
  | 'edge-absence-above-ceiling'
  | 'relationship-absence-above-ceiling'
  | 'discovery-regressed';

export interface CenterRosterRetirementCounts {
  admittedReads: number;
  governedMemberKeys: number;
  governedEdges: number;
  governedRelationshipKeys: number;
  memberKeysAwaitingSecondRead: number;
  edgesAwaitingSecondRead: number;
  protectedEdges: number;
  unkeyedEdges: number;
  unorderedEdges: number;
  retiredMemberKeys: number;
  retiredRoleClaims: number;
  retiredProfileClaims: number;
  retiredRelationshipKeys: number;
  retiredEdges: number;
  retiredLeadEdges: number;
  retiredObservations: number;
  sectionReads: number;
  departedEdges: number;
  departedRelationshipKeys: number;
  departedEdgesAwaitingSecondRead: number;
  witnessedOmittedEdges: number;
  witnessedOmittedMemberKeys: number;
  omittedUnwitnessedEdges: number;
  omittedUnwitnessedMemberKeys: number;
  omittedUnwitnessedRelationshipKeys: number;
  latestReadListings: Record<CenterRosterSectionKind, number>;
}

export type CenterRosterEdgeRetirementVerdict =
  'departed' | 'witnessed-omitted' | 'role-or-profile-changed' | 'absent';

export interface PlannedEdgeRetirement {
  edgeId: string;
  role: string;
  membershipKey: string;
  verdict?: CenterRosterEdgeRetirementVerdict;
  sectionLabel?: string;
}

export interface CenterRosterRetirementPlan {
  entityKey: string;
  verdict: 'retire' | 'frozen' | 'nothing-to-retire';
  freezeReason?: CenterRosterFreezeReason;
  retiredMemberKeys: string[];
  retiredRoleClaims: string[];
  retiredProfileClaims: string[];
  retiredRelationshipKeys: string[];
  retiredEdges: PlannedEdgeRetirement[];
  observationIds: string[];
  counts: CenterRosterRetirementCounts;
}

const LEAD_CANONICAL_ROLES = new Set(['PI', 'DIRECTOR', 'CO_DIRECTOR']);

const emptyCounts = (): CenterRosterRetirementCounts => ({
  admittedReads: 0,
  governedMemberKeys: 0,
  governedEdges: 0,
  governedRelationshipKeys: 0,
  memberKeysAwaitingSecondRead: 0,
  edgesAwaitingSecondRead: 0,
  protectedEdges: 0,
  unkeyedEdges: 0,
  unorderedEdges: 0,
  retiredMemberKeys: 0,
  retiredRoleClaims: 0,
  retiredProfileClaims: 0,
  retiredRelationshipKeys: 0,
  retiredEdges: 0,
  retiredLeadEdges: 0,
  retiredObservations: 0,
  sectionReads: 0,
  departedEdges: 0,
  departedRelationshipKeys: 0,
  departedEdgesAwaitingSecondRead: 0,
  witnessedOmittedEdges: 0,
  witnessedOmittedMemberKeys: 0,
  omittedUnwitnessedEdges: 0,
  omittedUnwitnessedMemberKeys: 0,
  omittedUnwitnessedRelationshipKeys: 0,
  latestReadListings: { current: 0, past: 0, emeritus: 0, unclassified: 0 },
});

interface ObservationGroup {
  key: string;
  rows: CenterRosterGovernedObservation[];
  latest: CenterRosterGovernedObservation;
}

function groupObservations(
  rows: readonly CenterRosterGovernedObservation[],
  keyOf: (row: CenterRosterGovernedObservation) => string,
): Map<string, ObservationGroup> {
  const groups = new Map<string, ObservationGroup>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { key, rows: [row], latest: row });
      continue;
    }
    group.rows.push(row);
    if (row.observedAt.getTime() > group.latest.observedAt.getTime()) group.latest = row;
  }
  return groups;
}

const liveGroups = (groups: Map<string, ObservationGroup>): ObservationGroup[] =>
  Array.from(groups.values()).filter((group) => group.rows.some((row) => !row.superseded));

export function planCenterRosterRetirement(input: {
  entityKey: string;
  reads: readonly CenterRosterRead[];
  memberObservations: readonly CenterRosterGovernedObservation[];
  relationshipObservations: readonly CenterRosterGovernedObservation[];
  edges: readonly CenterRosterGovernedEdge[];
  protectedMembershipKeys?: ReadonlySet<string>;
  protectedPersonRoles?: ReadonlySet<string>;
  witnessedPersonIds?: ReadonlySet<string>;
  minAbsentReads?: number;
  maxAbsentFraction?: number;
  minRetainedFraction?: number;
}): CenterRosterRetirementPlan {
  const minReads = input.minAbsentReads ?? CENTER_ROSTER_MIN_ABSENT_READS;
  const counts = emptyCounts();
  counts.admittedReads = input.reads.length;
  counts.sectionReads = input.reads.filter((read) => read.sections).length;
  const latestRead = input.reads.reduce<CenterRosterRead | null>(
    (newest, read) =>
      !newest || read.observedAt.getTime() > newest.observedAt.getTime() ? read : newest,
    null,
  );
  if (latestRead?.sections) {
    counts.latestReadListings = { ...latestRead.sections.listingCountsByKind };
  }
  const witnessedIdentities = new Set(
    input.edges
      .filter((edge) => edge.membershipKey && input.witnessedPersonIds?.has(edge.personId))
      .map((edge) => comparableIdentity(edge.membershipKey)),
  );
  const memberIdentity = (rows: readonly CenterRosterGovernedObservation[]): string => {
    const profile = [...rows]
      .filter(
        (row) => row.field === 'profileUrl' && typeof row.value === 'string' && !row.superseded,
      )
      .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0];
    if (!profile) return '';
    return comparableRosterMembershipKey(officialProfileIdentityKey(String(profile.value)));
  };
  const relationshipTargetIdentity = (rows: readonly CenterRosterGovernedObservation[]): string => {
    const site = [...rows]
      .filter(
        (row) =>
          row.field === RELATIONSHIP_TARGET_WEBSITE_URL_FIELD &&
          typeof row.value === 'string' &&
          !row.superseded,
      )
      .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0];
    if (!site) return '';
    return comparableRosterMembershipKey(officialProfileIdentityKey(String(site.value)));
  };
  const memberKeysByIdentity = new Map<string, Set<string>>();
  for (const row of input.memberObservations) {
    if (row.field !== 'profileUrl' || typeof row.value !== 'string' || !row.value.trim()) continue;
    const identity = comparableRosterMembershipKey(officialProfileIdentityKey(row.value));
    memberKeysByIdentity.set(
      identity,
      new Set([...(memberKeysByIdentity.get(identity) ?? []), row.entityKey]),
    );
  }
  const personListedIn = (read: CenterRosterRead, identity: string): boolean =>
    Boolean(read.sections?.listedIdentities.has(identity)) ||
    [...(memberKeysByIdentity.get(identity) ?? [])].some((memberKey) =>
      read.memberKeys.has(memberKey),
    );
  const plan: CenterRosterRetirementPlan = {
    entityKey: input.entityKey,
    verdict: 'nothing-to-retire',
    retiredMemberKeys: [],
    retiredRoleClaims: [],
    retiredProfileClaims: [],
    retiredRelationshipKeys: [],
    retiredEdges: [],
    observationIds: [],
    counts,
  };
  const retiredObservationIds = new Set<string>();

  const memberGroups = liveGroups(
    groupObservations(input.memberObservations, (row) => row.entityKey),
  );
  counts.governedMemberKeys = memberGroups.length;
  const retiredMemberKeys = new Set<string>();
  for (const group of memberGroups) {
    const absent = absentReadRunIds(
      { observedAt: group.latest.observedAt, scrapeRunId: group.latest.scrapeRunId },
      input.reads,
      (read) => read.memberKeys.has(group.key),
    );
    if (absent.length >= minReads) {
      if (absentReadsRecordSections(absent, input.reads)) {
        if (!witnessedIdentities.has(memberIdentity(group.rows))) {
          counts.omittedUnwitnessedMemberKeys += 1;
          continue;
        }
        counts.witnessedOmittedMemberKeys += 1;
      }
      retiredMemberKeys.add(group.key);
      for (const row of group.rows) retiredObservationIds.add(row.observationId);
    } else if (absent.length > 0) {
      counts.memberKeysAwaitingSecondRead += 1;
    }
  }

  const retireStaleMemberClaims = (
    field: string,
    claimOf: (value: string) => string,
    listedClaims: (read: CenterRosterRead) => ReadonlySet<string>,
    comparableClaim: (claim: string) => string = (claim) => claim,
  ): string[] => {
    const claimGroups = groupObservations(
      input.memberObservations.filter(
        (row) => row.field === field && typeof row.value === 'string' && row.value.trim(),
      ),
      (row) => memberClaimKey(row.entityKey, claimOf(String(row.value).trim())),
    );
    const retiredClaims: string[] = [];
    for (const group of claimGroups.values()) {
      if (retiredMemberKeys.has(group.latest.entityKey)) continue;
      const listedKey = memberClaimKey(
        group.latest.entityKey,
        comparableClaim(claimOf(String(group.latest.value).trim())),
      );
      const absent = absentReadRunIds(
        { observedAt: group.latest.observedAt, scrapeRunId: group.latest.scrapeRunId },
        input.reads,
        (read) =>
          listedClaims(read).has(listedKey) ||
          (read.sections !== undefined && !read.memberKeys.has(group.latest.entityKey)),
      );
      if (absent.length < minReads) continue;
      retiredClaims.push(group.key);
      for (const row of group.rows) retiredObservationIds.add(row.observationId);
    }
    return retiredClaims;
  };
  const retiredRoleClaims = retireStaleMemberClaims(
    'role',
    (role) => role,
    (read) => read.memberClaims,
  );
  const retiredProfileClaims = retireStaleMemberClaims(
    'profileUrl',
    officialProfileIdentityKey,
    (read) => read.memberProfileClaims,
    comparableRosterMembershipKey,
  );

  const relationshipGroups = liveGroups(
    groupObservations(input.relationshipObservations, (row) => row.entityKey),
  );
  counts.governedRelationshipKeys = relationshipGroups.length;
  const retiredRelationshipKeys: string[] = [];
  const retiredRelationshipObservationIds: string[] = [];
  for (const group of relationshipGroups) {
    const absent = absentReadRunIds(
      { observedAt: group.latest.observedAt, scrapeRunId: group.latest.scrapeRunId },
      input.reads,
      (read) => read.relationshipKeys.has(group.key),
    );
    if (absent.length < minReads) continue;
    if (absentReadsRecordSections(absent, input.reads)) {
      const identity = relationshipTargetIdentity(group.rows);
      const departed =
        departedReadRunIds(
          { observedAt: group.latest.observedAt, scrapeRunId: group.latest.scrapeRunId },
          input.reads,
          identity,
        ).length >= minReads;
      const rekeyed = Boolean(identity && latestRead?.sections?.currentIdentities.has(identity));
      if (departed) {
        counts.departedRelationshipKeys += 1;
      } else if (!rekeyed && !witnessedIdentities.has(identity)) {
        counts.omittedUnwitnessedRelationshipKeys += 1;
        continue;
      }
    }
    retiredRelationshipKeys.push(group.key);
    for (const row of group.rows) retiredRelationshipObservationIds.push(row.observationId);
  }

  counts.governedEdges = input.edges.length;
  const retiredEdges: PlannedEdgeRetirement[] = [];
  for (const edge of input.edges) {
    if (!edge.membershipKey) {
      counts.unkeyedEdges += 1;
      continue;
    }
    if (!edge.observedAt) {
      counts.unorderedEdges += 1;
      continue;
    }
    if (
      input.protectedMembershipKeys?.has(edge.membershipKey) ||
      input.protectedPersonRoles?.has(`${edge.personId}|${edge.role}`)
    ) {
      counts.protectedEdges += 1;
      continue;
    }
    const identity = comparableIdentity(edge.membershipKey);
    const departed = departedReadRunIds({ observedAt: edge.observedAt }, input.reads, identity);
    if (departed.length >= minReads) {
      counts.departedEdges += 1;
      retiredEdges.push({
        edgeId: edge.edgeId,
        role: edge.role,
        membershipKey: edge.membershipKey,
        verdict: 'departed',
        sectionLabel: latestDepartedSectionLabel(input.reads, identity),
      });
      continue;
    }
    const absent = absentReadRunIds({ observedAt: edge.observedAt }, input.reads, (read) =>
      read.membershipKeys.has(comparableRosterMembershipKey(edge.membershipKey)),
    );
    if (absent.length >= minReads) {
      let verdict: CenterRosterEdgeRetirementVerdict = 'absent';
      if (absentReadsRecordSections(absent, input.reads)) {
        const absentRuns = new Set(absent);
        const stillListedInEveryAbsentRead = input.reads
          .filter((read) => absentRuns.has(read.scrapeRunId) && read.sections)
          .every((read) => personListedIn(read, identity));
        if (stillListedInEveryAbsentRead) {
          verdict = 'role-or-profile-changed';
        } else if (input.witnessedPersonIds?.has(edge.personId)) {
          verdict = 'witnessed-omitted';
          counts.witnessedOmittedEdges += 1;
        } else {
          counts.omittedUnwitnessedEdges += 1;
          continue;
        }
      }
      retiredEdges.push({
        edgeId: edge.edgeId,
        role: edge.role,
        membershipKey: edge.membershipKey,
        verdict,
      });
    } else if (departed.length > 0) {
      counts.departedEdgesAwaitingSecondRead += 1;
      counts.edgesAwaitingSecondRead += 1;
    } else if (absent.length > 0) {
      counts.edgesAwaitingSecondRead += 1;
    }
  }

  const maxFraction = input.maxAbsentFraction ?? CENTER_ROSTER_MAX_ABSENT_FRACTION;
  const freeze = (reason: CenterRosterFreezeReason): CenterRosterRetirementPlan => ({
    ...plan,
    verdict: 'frozen',
    freezeReason: reason,
  });
  if (
    !passesCenterRosterAbsenceCeiling(
      retiredMemberKeys.size,
      counts.governedMemberKeys,
      maxFraction,
    )
  ) {
    return freeze('member-absence-above-ceiling');
  }
  if (!passesCenterRosterAbsenceCeiling(retiredEdges.length, counts.governedEdges, maxFraction)) {
    return freeze('edge-absence-above-ceiling');
  }
  if (
    !passesCenterRosterAbsenceCeiling(
      retiredRelationshipKeys.length,
      counts.governedRelationshipKeys,
      maxFraction,
    )
  ) {
    return freeze('relationship-absence-above-ceiling');
  }
  if (centerRosterDiscoveryRegressed(input.reads, input.minRetainedFraction)) {
    return freeze('discovery-regressed');
  }

  for (const id of retiredRelationshipObservationIds) retiredObservationIds.add(id);
  plan.retiredMemberKeys = Array.from(retiredMemberKeys).sort();
  plan.retiredRoleClaims = retiredRoleClaims.sort();
  plan.retiredProfileClaims = retiredProfileClaims.sort();
  plan.retiredRelationshipKeys = retiredRelationshipKeys.sort();
  plan.retiredEdges = retiredEdges;
  plan.observationIds = Array.from(retiredObservationIds);
  counts.retiredMemberKeys = plan.retiredMemberKeys.length;
  counts.retiredRoleClaims = plan.retiredRoleClaims.length;
  counts.retiredProfileClaims = plan.retiredProfileClaims.length;
  counts.retiredRelationshipKeys = plan.retiredRelationshipKeys.length;
  counts.retiredEdges = retiredEdges.length;
  counts.retiredLeadEdges = retiredEdges.filter((edge) =>
    LEAD_CANONICAL_ROLES.has(edge.role),
  ).length;
  counts.retiredObservations = plan.observationIds.length;
  if (plan.observationIds.length > 0 || retiredEdges.length > 0) plan.verdict = 'retire';
  return plan;
}

/**
 * Lookups that belong to the materializer, injected so this module does not import it
 * back: the materializer runs this lane, and each of these must answer exactly as the
 * materializer's own write path would.
 */
export interface CenterRosterRetirementDeps {
  membershipKeysAssertedByOtherSources(centerEntityKey: string): Promise<Set<string>>;
  personRolesAssertedByOtherSources(centerEntityKey: string): Promise<Set<string>>;
  relationshipTargetIdsAssertedByOtherSources(centerEntityKey: string): Promise<Set<string>>;
  resolveRelationshipTargetId(target: RelationshipTargetIdentity): Promise<string | null>;
  rematerializeMemberKey(memberKey: string): Promise<void>;
}

const observationEntityKey = (row: { entityKey?: unknown }): string =>
  typeof row.entityKey === 'string' ? row.entityKey.trim() : '';

export async function loadCenterRosterReads(
  entityKey: string,
  lane: CenterRosterLane = CENTERS_INSTITUTES_ROSTER_LANE,
): Promise<CenterRosterRead[]> {
  const rows = (await Observation.find({
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: lane.sourceName,
    entityKey,
    scrapeRunId: { $exists: true, $ne: null },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('value scrapeRunId observedAt')
    .lean()) as Array<{ value?: unknown; scrapeRunId?: unknown; observedAt?: unknown }>;
  const reads: CenterRosterRead[] = [];
  for (const row of rows) {
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    if (!scrapeRunId || !(row.observedAt instanceof Date)) continue;
    const read = centerRosterReadFromSnapshot(
      (row.value ?? {}) as CenterRosterHealthSnapshot,
      scrapeRunId,
      row.observedAt,
      { adoptsSectionContract: lane.adoptsSectionContract === true },
    );
    if (read) reads.push(read);
  }
  return reads;
}

async function loadGovernedObservations(
  entityType: 'researchGroupMember' | 'researchEntityRelationship',
  centerEntityKey: string,
  lane: CenterRosterLane,
): Promise<CenterRosterGovernedObservation[]> {
  const rows = (await Observation.find({
    entityType,
    sourceName: lane.sourceName,
    entityKey: { $regex: `^${escapeRegex(centerEntityKey)}:` },
    scrapeRunId: { $exists: true, $ne: null },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id entityKey field value scrapeRunId observedAt superseded')
    .lean()) as any[];
  const observations: CenterRosterGovernedObservation[] = [];
  for (const row of rows) {
    const observationId = serializedDocumentId(row._id) || '';
    const entityKey = observationEntityKey(row);
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    if (!observationId || !entityKey || !scrapeRunId || !(row.observedAt instanceof Date)) continue;
    observations.push({
      observationId,
      entityKey,
      field: String(row.field || ''),
      value: row.value,
      scrapeRunId,
      observedAt: row.observedAt,
      superseded: row.superseded === true,
    });
  }
  return observations;
}

async function loadGovernedEdges(
  centerEntityId: string,
  lane: CenterRosterLane,
): Promise<CenterRosterGovernedEdge[]> {
  const rows = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': new mongoose.Types.ObjectId(centerEntityId),
    'rosterProvenance.sourceName': lane.sourceName,
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('_id personId role rosterProvenance')
    .lean()) as any[];
  return rows.map((row) => ({
    edgeId: serializedDocumentId(row._id) || '',
    personId: serializedDocumentId(row.personId) || '',
    role: String(row.role || ''),
    membershipKey:
      typeof row.rosterProvenance?.membershipKey === 'string'
        ? row.rosterProvenance.membershipKey
        : '',
    observedAt:
      row.rosterProvenance?.observedAt instanceof Date ? row.rosterProvenance.observedAt : null,
  }));
}

export interface CenterRosterRetirementInputs {
  centerEntityId: string;
  reads: CenterRosterRead[];
  memberObservations: CenterRosterGovernedObservation[];
  relationshipObservations: CenterRosterGovernedObservation[];
  edges: CenterRosterGovernedEdge[];
  protectedMembershipKeys: Set<string>;
  protectedPersonRoles: Set<string>;
  witnessedPersonIds?: Set<string>;
}

export type CenterRosterDepartureWitnessLoader = (
  personIds: readonly string[],
  now: Date,
) => Promise<Set<string>>;

/**
 * The person's own page saying they left or died, read through `personPageDeparture.ts`
 * unchanged. Imported on call, because that module reads the materializer's read scope and
 * the materializer imports this one.
 */
export const loadCenterRosterDepartureWitnesses: CenterRosterDepartureWitnessLoader = async (
  personIds,
  now,
) => {
  if (personIds.length === 0) return new Set();
  const { loadPersonPageDepartures } = await import('./personPageDeparture');
  return new Set((await loadPersonPageDepartures(personIds, now)).keys());
};

export async function loadCenterRosterRetirementInputs(
  centerEntityKey: string,
  deps: Pick<
    CenterRosterRetirementDeps,
    'membershipKeysAssertedByOtherSources' | 'personRolesAssertedByOtherSources'
  >,
  reads?: CenterRosterRead[],
  lane: CenterRosterLane = CENTERS_INSTITUTES_ROSTER_LANE,
  loadWitnesses: CenterRosterDepartureWitnessLoader = loadCenterRosterDepartureWitnesses,
): Promise<CenterRosterRetirementInputs | null> {
  const entity = ((await ResearchEntity.findOne({ slug: centerEntityKey, archived: { $ne: true } })
    .select('_id')
    .lean()) ?? (await liveResearchEntityNamedByKeyObservations(centerEntityKey))) as {
    _id?: unknown;
  } | null;
  const centerEntityId = serializedDocumentId(entity?._id) || '';
  if (!centerEntityId) return null;
  const edges = await loadGovernedEdges(centerEntityId, lane);
  return {
    centerEntityId,
    reads: reads ?? (await loadCenterRosterReads(centerEntityKey, lane)),
    memberObservations: await loadGovernedObservations(
      'researchGroupMember',
      centerEntityKey,
      lane,
    ),
    relationshipObservations: await loadGovernedObservations(
      'researchEntityRelationship',
      centerEntityKey,
      lane,
    ),
    edges,
    protectedMembershipKeys: await deps.membershipKeysAssertedByOtherSources(centerEntityKey),
    protectedPersonRoles: await deps.personRolesAssertedByOtherSources(centerEntityKey),
    ...(lane.adoptsSectionContract
      ? {
          witnessedPersonIds: await loadWitnesses(
            [...new Set(edges.map((edge) => edge.personId).filter(Boolean))],
            new Date(),
          ),
        }
      : {}),
  };
}

export async function retireObservationRows(
  observationIds: readonly string[],
  reason: string,
): Promise<void> {
  if (observationIds.length === 0) return;
  const ids = observationIds.map((id) => new mongoose.Types.ObjectId(id));
  await retireObservations({ _id: { $in: ids } }, reason);
  await Observation.updateMany(
    { _id: { $in: ids }, superseded: true, 'rollback.rolledBackAt': { $exists: false } },
    { $set: { rollback: { rolledBackAt: new Date(), reason } } },
  );
}

export interface AppliedCenterRosterRetirement {
  archivedRelationships: number;
  rematerializedMemberKeys: number;
  regated: boolean;
  indexSyncFailures: number;
}

export async function applyCenterRosterRetirementPlan(
  plan: CenterRosterRetirementPlan,
  inputs: CenterRosterRetirementInputs,
  deps: CenterRosterRetirementDeps,
  endedAt: Date,
  lane: CenterRosterLane = CENTERS_INSTITUTES_ROSTER_LANE,
): Promise<AppliedCenterRosterRetirement> {
  const applied: AppliedCenterRosterRetirement = {
    archivedRelationships: 0,
    rematerializedMemberKeys: 0,
    regated: false,
    indexSyncFailures: 0,
  };
  if (plan.verdict !== 'retire') return applied;

  const retiredRelationshipKeys = new Set(plan.retiredRelationshipKeys);
  const retiredTargets = relationshipTargetIdentities(
    inputs.relationshipObservations.filter((row) => retiredRelationshipKeys.has(row.entityKey)),
  );

  await retireObservationRows(plan.observationIds, lane.retirementReason);

  const edgesBySectionLabel = new Map<string, PlannedEdgeRetirement[]>();
  for (const edge of plan.retiredEdges) {
    const label = edge.verdict === 'departed' ? (edge.sectionLabel ?? '') : '';
    edgesBySectionLabel.set(label, [...(edgesBySectionLabel.get(label) ?? []), edge]);
  }
  for (const [sectionLabel, edges] of edgesBySectionLabel) {
    await RoleAssignment.updateMany(
      {
        _id: { $in: edges.map((edge) => new mongoose.Types.ObjectId(edge.edgeId)) },
        'rosterProvenance.sourceName': lane.sourceName,
        state: { $ne: 'HISTORICAL' },
      },
      {
        $set: {
          state: 'HISTORICAL',
          endedAt,
          ...(sectionLabel ? { 'rosterProvenance.sectionLabel': sectionLabel } : {}),
        },
      },
    );
  }

  if (retiredTargets.length > 0) {
    const protectedTargets = await deps.relationshipTargetIdsAssertedByOtherSources(plan.entityKey);
    const targetsThisSourceStillAsserts = relationshipTargetIdentities(
      inputs.relationshipObservations.filter(
        (row) => !retiredRelationshipKeys.has(row.entityKey) && !row.superseded,
      ),
    );
    for (const target of targetsThisSourceStillAsserts) {
      const targetId = await deps.resolveRelationshipTargetId(target);
      if (targetId) protectedTargets.add(targetId);
    }
    const centerObjectId = new mongoose.Types.ObjectId(inputs.centerEntityId);
    for (const target of retiredTargets) {
      const targetId = await deps.resolveRelationshipTargetId(target);
      if (!targetId || protectedTargets.has(targetId)) continue;
      const result = await ResearchEntityRelationship.updateMany(
        {
          sourceResearchEntityId: centerObjectId,
          targetResearchEntityId: new mongoose.Types.ObjectId(targetId),
          archived: { $ne: true },
        },
        { $set: attributedArchiveSet(lane.retirementReason) },
      );
      applied.archivedRelationships += (result as { modifiedCount?: number }).modifiedCount ?? 0;
    }
  }

  const retiredIdentities = new Set(
    plan.retiredEdges.map((edge) =>
      comparableRosterMembershipKey(identityPart(edge.membershipKey)),
    ),
  );
  const retiredClaimMemberKeys = new Set(
    [...plan.retiredRoleClaims, ...plan.retiredProfileClaims].map((claim) => claim.split('|')[0]),
  );
  const latestRead = inputs.reads.reduce<CenterRosterRead | null>(
    (newest, read) =>
      !newest || read.observedAt.getTime() > newest.observedAt.getTime() ? read : newest,
    null,
  );
  const stillListed = (latestRead?.members ?? []).filter(
    (member) =>
      retiredClaimMemberKeys.has(member.memberKey) ||
      (member.membershipKey &&
        retiredIdentities.has(comparableRosterMembershipKey(identityPart(member.membershipKey)))),
  );
  for (const memberKey of new Set(stillListed.map((member) => member.memberKey))) {
    await deps.rematerializeMemberKey(memberKey);
    applied.rematerializedMemberKeys += 1;
  }

  if (
    plan.retiredEdges.length > 0 ||
    applied.archivedRelationships > 0 ||
    applied.rematerializedMemberKeys > 0
  ) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: [inputs.centerEntityId],
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    applied.regated = true;
    const center = await ResearchEntity.findOne({
      _id: new mongoose.Types.ObjectId(inputs.centerEntityId),
      archived: { $ne: true },
    }).lean();
    const indexSync = await syncResearchEntitiesWithOutcome(center ? [center] : []);
    applied.indexSyncFailures = indexSync.indexSyncFailures;
  }
  return applied;
}

export type CenterRosterRetirementOutcome =
  'invalid-run-id' | 'no-center-roster-read' | 'planned' | 'reconciled';

export interface CenterRosterRetirementCenterResult {
  entityKey: string;
  admissibility: CenterRosterReadAdmissibility;
  verdict?: CenterRosterRetirementPlan['verdict'] | 'entity-missing';
  freezeReason?: CenterRosterFreezeReason;
  counts?: CenterRosterRetirementCounts;
  applied?: AppliedCenterRosterRetirement;
}

export interface CenterRosterRetirementResult {
  outcome: CenterRosterRetirementOutcome;
  dryRun: boolean;
  centers: CenterRosterRetirementCenterResult[];
}

/**
 * Runs after every entity of the run has been projected, so a retirement reads the edges
 * the projection just wrote. A dry run plans and reports without writing, for the same
 * reason field retraction does: the freeze verdict has to be readable before a pass that
 * retires evidence is authorized.
 */
export async function reconcileCenterRosterRetirementsFromRun(
  scrapeRunId: string,
  deps: CenterRosterRetirementDeps,
  options: { dryRun?: boolean; lane?: CenterRosterLane } = {},
): Promise<CenterRosterRetirementResult> {
  const dryRun = options.dryRun === true;
  const lane = options.lane ?? CENTERS_INSTITUTES_ROSTER_LANE;
  let runObjectId: mongoose.Types.ObjectId;
  try {
    runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
  } catch {
    return { outcome: 'invalid-run-id', dryRun, centers: [] };
  }
  const snapshots = (await Observation.find({
    scrapeRunId: runObjectId,
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: lane.sourceName,
  })
    .select('entityKey value observedAt')
    .lean()) as Array<{ entityKey?: unknown; value?: unknown }>;
  if (snapshots.length === 0) return { outcome: 'no-center-roster-read', dryRun, centers: [] };

  const centers: CenterRosterRetirementCenterResult[] = [];
  for (const snapshot of snapshots) {
    const entityKey = observationEntityKey(snapshot);
    if (!entityKey) continue;
    const admissibility = centerRosterReadAdmissibility(
      (snapshot.value ?? {}) as CenterRosterHealthSnapshot,
    );
    if (admissibility !== 'read-listed-members') {
      centers.push({ entityKey, admissibility });
      continue;
    }
    const inputs = await loadCenterRosterRetirementInputs(entityKey, deps, undefined, lane);
    if (!inputs) {
      centers.push({ entityKey, admissibility, verdict: 'entity-missing' });
      continue;
    }
    const plan = planCenterRosterRetirement({ entityKey, ...inputs });
    if (lane.adoptsSectionContract && plan.counts.sectionReads > 0) {
      const { counts } = plan;
      console.info(
        `[center-roster-retirement] ${lane.sourceName} ${sanitizeLogValue(entityKey)} sections: latest read lists ${counts.latestReadListings.current} current, ${counts.latestReadListings.unclassified} unlabelled, ${counts.latestReadListings.past} past, ${counts.latestReadListings.emeritus} emeritus; ${counts.departedEdges} departed edge(s), ${counts.departedEdgesAwaitingSecondRead} awaiting a second read, ${counts.witnessedOmittedEdges} witnessed-omitted, ${counts.omittedUnwitnessedEdges} omitted-unwitnessed edge(s), ${counts.omittedUnwitnessedMemberKeys} omitted-unwitnessed member key(s)`,
      );
    }
    const result: CenterRosterRetirementCenterResult = {
      entityKey,
      admissibility,
      verdict: plan.verdict,
      counts: plan.counts,
      ...(plan.freezeReason ? { freezeReason: plan.freezeReason } : {}),
    };
    if (plan.verdict === 'frozen') {
      console.warn(
        `[center-roster-retirement] ${lane.sourceName} frozen ${sanitizeLogValue(entityKey)} (${plan.freezeReason}): ${plan.counts.governedMemberKeys} member keys, ${plan.counts.governedEdges} edges governed`,
      );
    }
    if (!dryRun && plan.verdict === 'retire') {
      result.applied = await applyCenterRosterRetirementPlan(plan, inputs, deps, new Date(), lane);
    }
    centers.push(result);
  }
  return { outcome: dryRun ? 'planned' : 'reconciled', dryRun, centers };
}

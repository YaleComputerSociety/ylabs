/**
 * The classification behind `research-entity:audit-kind-typing` (#2884).
 *
 * The `LAB` versus `FACULTY_RESEARCH_AREA` rule was emergent rather than expressed,
 * so a mis-typed row was invisible. This reports the three contradiction sets the
 * 2026-09-21 decision in `docs/decisions.md` names, and reports only: nothing here
 * demotes, merges or suppresses a row, because a contradicting row may be mis-typed
 * or mis-named and the name is the field already in doubt.
 */
import {
  researchEntityTypeNameContradiction,
  type ResearchEntityTypeNameContradiction,
} from '../utils/researchHomeNameIdentityAuthority';

export const KIND_TYPING_CONTRADICTION_EXIT_CODE = 2;

/** The roles that make a person the research home's owner rather than a member. */
export const RESEARCH_HOME_LEAD_ROLES: ReadonlySet<string> = new Set([
  'PI',
  'CO_PI',
  'DIRECTOR',
  'CO_DIRECTOR',
  'LEAD',
]);

export interface KindTypingEntityInput {
  id: string;
  slug?: unknown;
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
  studentVisibilityTier?: unknown;
  websiteUrl?: unknown;
}

/**
 * A lab assertion stored about a row, with the lane that wrote it.
 *
 * The contradiction sets above are keyed on a row agreeing with itself, which measures
 * coherence rather than correctness: a single lane that writes the name and the type
 * together produces a row that is wrong and passes every agreement check. So the
 * writer-keyed set below is keyed on the lane instead (#3252).
 */
export interface KindTypingLabAssertionInput {
  entityKey?: unknown;
  field?: unknown;
  value?: unknown;
  sourceName?: unknown;
}

/**
 * Lanes that can fund a person but cannot assert that an organization exists, so a lab
 * claim resting only on one of them rests on nothing (#3145).
 */
export const NON_ORGANIZATION_ASSERTING_LANES: readonly string[] = [
  'nih-reporter',
  'nsf-award-search',
  'doe-osti',
  'federal-award-search',
  'neh-grants',
];

export interface KindTypingWriterKeyedReport {
  /**
   * Rows whose name and type both assert a lab. This is the denominator the count
   * below is drawn from, so a zero is readable: a zero with a zero denominator means
   * the query found no lab-claiming row at all and is an instrument failure, while a
   * zero against a non-zero denominator means the cohort is genuinely empty.
   */
  rowsAssertingALab: number;
  /** Of those, rows no lane outside the funding lanes asserts a lab about. */
  labClaimWrittenOnlyByANonOrganizationAssertingLane: number;
  /** Of those, the ones a student can reach. */
  servedWithAWriterOnlyLabClaim: number;
  /**
   * Of those, the ones no contradiction set reports, because the lane wrote the name
   * and the type together and they therefore agree.
   */
  invisibleToEveryContradictionSet: number;
}

export interface KindTypingLeadEdgeInput {
  personId: string;
  role?: unknown;
  entityId: string;
}

export interface KindTypingContradictionRow {
  slug: string;
  entityType: string;
  contradiction: ResearchEntityTypeNameContradiction;
  served: boolean;
  hasOwnWebsiteUrl: boolean;
}

export interface KindTypingDualLeadGroup {
  labEntitySlugs: string[];
  facultyResearchAreaEntitySlugs: string[];
  servedLabs: number;
  servedFacultyResearchAreas: number;
}

export interface KindTypingAuditReport {
  labRows: number;
  facultyResearchAreaRows: number;
  servedLabRows: number;
  servedFacultyResearchAreaRows: number;
  servedLabNamesOrganizational: number;
  servedFacultyResearchAreaNamesOrganizational: number;
  contradictions: KindTypingContradictionRow[];
  contradictionCounts: Record<Exclude<ResearchEntityTypeNameContradiction, ''>, number>;
  dualLeadGroups: KindTypingDualLeadGroup[];
  dualLeadPeople: number;
  dualLeadPeopleWithBothServed: number;
  writerKeyed?: KindTypingWriterKeyedReport;
  status: 'clean' | 'contradictions';
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isServed = (value: unknown): boolean => textValue(value) === 'student_ready';

const LAB_NAME_SUFFIX_RE = /\s(?:Lab|Laboratory)$/i;

const assertionNamesALab = (assertion: KindTypingLabAssertionInput): boolean => {
  const value = textValue(assertion.value);
  const field = textValue(assertion.field);
  if (field === 'kind' || field === 'entityType') return value.toLowerCase() === 'lab';
  return LAB_NAME_SUFFIX_RE.test(value);
};

/**
 * The cohort no agreement check can find: a row whose name and type both assert a lab
 * and whose lab claim no lane outside the funding lanes asserts.
 *
 * Keyed on the writer rather than on agreement, which is the whole point. An operator
 * edit and the row's own naming lane both count as an outside assertion here: the
 * question is who wrote the claim, not whether the claim corroborates itself.
 */
export function summarizeWriterKeyedLabClaims(args: {
  entities: readonly KindTypingEntityInput[];
  labAssertions: readonly KindTypingLabAssertionInput[];
}): KindTypingWriterKeyedReport {
  const fundingLanes = new Set(NON_ORGANIZATION_ASSERTING_LANES);
  const keysWithAnOutsideLabAssertion = new Set<string>();
  const keysAFundingLaneAssertsALabAbout = new Set<string>();
  for (const assertion of args.labAssertions) {
    if (!assertionNamesALab(assertion)) continue;
    const key = textValue(assertion.entityKey);
    if (fundingLanes.has(textValue(assertion.sourceName)))
      keysAFundingLaneAssertsALabAbout.add(key);
    else keysWithAnOutsideLabAssertion.add(key);
  }

  let rowsAssertingALab = 0;
  let writerOnly = 0;
  let servedWriterOnly = 0;
  let invisible = 0;
  for (const row of args.entities) {
    const nameAssertsALab = LAB_NAME_SUFFIX_RE.test(textValue(row.name));
    const typeAssertsALab =
      textValue(row.entityType).toUpperCase() === 'LAB' ||
      textValue(row.kind).toLowerCase() === 'lab';
    if (!nameAssertsALab || !typeAssertsALab) continue;
    rowsAssertingALab += 1;
    // A funding lane must actually have written the claim. Without this the count
    // absorbs every row that no lane asserts a lab about at all, which is stored
    // residue with no writer and a different defect: the set would read 129 where the
    // writer-keyed cohort is 14.
    if (!keysAFundingLaneAssertsALabAbout.has(textValue(row.slug))) continue;
    if (keysWithAnOutsideLabAssertion.has(textValue(row.slug))) continue;
    writerOnly += 1;
    if (isServed(row.studentVisibilityTier)) servedWriterOnly += 1;
    if (!researchEntityTypeNameContradiction(row)) invisible += 1;
  }

  return {
    rowsAssertingALab,
    labClaimWrittenOnlyByANonOrganizationAssertingLane: writerOnly,
    servedWithAWriterOnlyLabClaim: servedWriterOnly,
    invisibleToEveryContradictionSet: invisible,
  };
}

export function summarizeResearchEntityKindTyping(args: {
  entities: readonly KindTypingEntityInput[];
  leadEdges: readonly KindTypingLeadEdgeInput[];
  labAssertions?: readonly KindTypingLabAssertionInput[];
}): KindTypingAuditReport {
  const labs = args.entities.filter((row) => textValue(row.entityType).toUpperCase() === 'LAB');
  const areas = args.entities.filter(
    (row) => textValue(row.entityType).toUpperCase() === 'FACULTY_RESEARCH_AREA',
  );

  const contradictions: KindTypingContradictionRow[] = [];
  const contradictionCounts = {
    lab_named_as_a_topic: 0,
    faculty_research_area_named_as_an_organization: 0,
  };
  for (const row of [...labs, ...areas]) {
    const contradiction = researchEntityTypeNameContradiction(row);
    if (!contradiction) continue;
    contradictionCounts[contradiction] += 1;
    contradictions.push({
      slug: textValue(row.slug),
      entityType: textValue(row.entityType).toUpperCase(),
      contradiction,
      served: isServed(row.studentVisibilityTier),
      hasOwnWebsiteUrl: Boolean(textValue(row.websiteUrl)),
    });
  }

  const byId = new Map(args.entities.map((row) => [row.id, row]));
  const byPerson = new Map<string, KindTypingDualLeadGroup>();
  for (const edge of args.leadEdges) {
    if (!RESEARCH_HOME_LEAD_ROLES.has(textValue(edge.role).toUpperCase())) continue;
    const row = byId.get(edge.entityId);
    if (!row) continue;
    const entityType = textValue(row.entityType).toUpperCase();
    if (entityType !== 'LAB' && entityType !== 'FACULTY_RESEARCH_AREA') continue;
    const group =
      byPerson.get(edge.personId) ||
      ({
        labEntitySlugs: [],
        facultyResearchAreaEntitySlugs: [],
        servedLabs: 0,
        servedFacultyResearchAreas: 0,
      } satisfies KindTypingDualLeadGroup);
    const slug = textValue(row.slug);
    if (entityType === 'LAB') {
      if (!group.labEntitySlugs.includes(slug)) group.labEntitySlugs.push(slug);
      if (isServed(row.studentVisibilityTier)) group.servedLabs += 1;
    } else {
      if (!group.facultyResearchAreaEntitySlugs.includes(slug)) {
        group.facultyResearchAreaEntitySlugs.push(slug);
      }
      if (isServed(row.studentVisibilityTier)) group.servedFacultyResearchAreas += 1;
    }
    byPerson.set(edge.personId, group);
  }

  const dualLeadGroups = [...byPerson.values()].filter(
    (group) => group.labEntitySlugs.length > 0 && group.facultyResearchAreaEntitySlugs.length > 0,
  );

  const contradictionRows = contradictions.length;
  return {
    labRows: labs.length,
    facultyResearchAreaRows: areas.length,
    servedLabRows: labs.filter((row) => isServed(row.studentVisibilityTier)).length,
    servedFacultyResearchAreaRows: areas.filter((row) => isServed(row.studentVisibilityTier))
      .length,
    servedLabNamesOrganizational: labs.filter(
      (row) => isServed(row.studentVisibilityTier) && !researchEntityTypeNameContradiction(row),
    ).length,
    servedFacultyResearchAreaNamesOrganizational: areas.filter(
      (row) => isServed(row.studentVisibilityTier) && researchEntityTypeNameContradiction(row),
    ).length,
    contradictions,
    contradictionCounts,
    dualLeadGroups,
    dualLeadPeople: dualLeadGroups.length,
    dualLeadPeopleWithBothServed: dualLeadGroups.filter(
      (group) => group.servedLabs > 0 && group.servedFacultyResearchAreas > 0,
    ).length,
    ...(args.labAssertions
      ? {
          writerKeyed: summarizeWriterKeyedLabClaims({
            entities: args.entities,
            labAssertions: args.labAssertions,
          }),
        }
      : {}),
    status: contradictionRows > 0 || dualLeadGroups.length > 0 ? 'contradictions' : 'clean',
  };
}

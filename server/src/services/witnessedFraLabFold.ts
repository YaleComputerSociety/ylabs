import mongoose from 'mongoose';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';
import { isOrganizationalHomeEntity } from '../utils/profileAreaDuplicateRisk';

/**
 * A faculty research row folds into its lead's own lab only on a witness that the row
 * restates that lab (#5969). Name shape alone cannot say it: the eponymous lane folds a
 * person-named shell, and planned none of the faculty research rows a blind ballot found
 * restating their lead's lab, because those rows carry their own names and sites.
 *
 * Two witnesses count. A ballot-confirmed pair whose rows share one lead's edge, which is
 * the operator's verdict on that pair; and the lab's own page naming the person, where the
 * person holds the lab's PI edge, which is a class rule that re-derives on every run. A
 * co-director is not the lab's PI, so a co-director's separate lab never folds a row on
 * the page witness.
 */

const FACULTY_ROW_TYPES: ReadonlySet<string> = new Set([
  'FACULTY_RESEARCH_AREA',
  'INDIVIDUAL_RESEARCH',
]);
const LEAD_ROLES: ReadonlySet<string> = new Set(LEAD_ROLE_CANONICAL_VALUES);

export interface WitnessedFoldEntity {
  id: string;
  mergeFields?: Record<string, unknown>;
  slug?: string;
  name?: string;
  kind?: string;
  entityType?: string;
  archived?: boolean;
  leadVerification?: {
    state?: string;
    leads?: Array<{ personId?: unknown; role?: string; verdict?: string; matchedBy?: string }>;
  } | null;
}

export interface WitnessedFoldEdge {
  personId: string;
  entityId: string;
  role: string;
  evidenced?: boolean;
}

export interface BallotFoldPair {
  label: string;
  facultyRowId: string;
  labId: string;
}

export type FoldWitness = 'ballot' | 'lab-page-names-pi';

export interface WitnessedFold {
  personId: string;
  facultyRowId: string;
  labId: string;
  witness: FoldWitness;
  label?: string;
}

export type FoldRefusalReason =
  | 'not-a-faculty-row-and-a-lab'
  | 'row-not-live'
  | 'no-shared-lead-edge'
  | 'several-own-labs'
  | 'witnesses-disagree';

export interface FoldRefusal {
  facultyRowId: string;
  labId?: string;
  label?: string;
  reason: FoldRefusalReason;
}

const typeOf = (entity: WitnessedFoldEntity | undefined) =>
  (entity?.entityType || '').toUpperCase();
const isFacultyRow = (entity: WitnessedFoldEntity | undefined) =>
  FACULTY_ROW_TYPES.has(typeOf(entity));
const isLab = (entity: WitnessedFoldEntity | undefined) => typeOf(entity) === 'LAB';

/**
 * A profile link on the lab page confirms only that the page links the person, which a
 * page naming a different overseer also does, so it is not a witness that the person runs
 * the lab. On Development the one fold it produced was a pair a blind ballot refused.
 */
const PAGE_MATCHES_THAT_NAME_THE_LEAD: ReadonlySet<string> = new Set([
  'NAMED_ON_PAGE',
  'SURNAME_IN_SITE_URL',
]);

function labPageNamesPersonAsPi(lab: WitnessedFoldEntity, personId: string): boolean {
  const verification = lab.leadVerification;
  if (!verification || verification.state === 'contradicted') return false;
  return (verification.leads || []).some(
    (lead) =>
      String(lead.personId) === personId &&
      lead.role === 'PI' &&
      lead.verdict === 'CONFIRMED' &&
      PAGE_MATCHES_THAT_NAME_THE_LEAD.has(String(lead.matchedBy || '')),
  );
}

export function selectWitnessedFraLabFolds(input: {
  entities: ReadonlyMap<string, WitnessedFoldEntity>;
  edges: readonly WitnessedFoldEdge[];
  ballotPairs?: readonly BallotFoldPair[];
}): { folds: WitnessedFold[]; refusals: FoldRefusal[] } {
  const leadEdges = input.edges.filter((edge) => LEAD_ROLES.has(edge.role));
  const rolesOf = new Map<string, Map<string, Set<string>>>();
  const evidencedPiEdges = new Set(
    leadEdges
      .filter((edge) => edge.role === 'PI' && edge.evidenced === true)
      .map((edge) => `${edge.personId}:${edge.entityId}`),
  );
  for (const edge of leadEdges) {
    const byEntity = rolesOf.get(edge.personId) ?? new Map<string, Set<string>>();
    byEntity.set(edge.entityId, (byEntity.get(edge.entityId) ?? new Set()).add(edge.role));
    rolesOf.set(edge.personId, byEntity);
  }
  const live = (entity: WitnessedFoldEntity | undefined) =>
    Boolean(entity) && entity?.archived !== true;
  const candidates = new Map<string, WitnessedFold[]>();
  const refusals: FoldRefusal[] = [];
  const propose = (fold: WitnessedFold) =>
    candidates.set(fold.facultyRowId, [...(candidates.get(fold.facultyRowId) ?? []), fold]);

  for (const pair of input.ballotPairs ?? []) {
    const row = input.entities.get(pair.facultyRowId);
    const lab = input.entities.get(pair.labId);
    const refuse = (reason: FoldRefusalReason) =>
      refusals.push({
        facultyRowId: pair.facultyRowId,
        labId: pair.labId,
        label: pair.label,
        reason,
      });
    if (!isFacultyRow(row) || !isLab(lab)) {
      refuse('not-a-faculty-row-and-a-lab');
      continue;
    }
    if (!live(row) || !live(lab)) {
      refuse('row-not-live');
      continue;
    }
    const sharedLead = [...rolesOf.entries()]
      .filter(([, byEntity]) => byEntity.has(pair.facultyRowId) && byEntity.has(pair.labId))
      .map(([personId]) => personId)
      .sort()[0];
    if (!sharedLead) {
      refuse('no-shared-lead-edge');
      continue;
    }
    propose({
      personId: sharedLead,
      facultyRowId: pair.facultyRowId,
      labId: pair.labId,
      witness: 'ballot',
      label: pair.label,
    });
  }

  for (const [personId, byEntity] of rolesOf) {
    const ownRows = [...byEntity.keys()].filter((id) => {
      const entity = input.entities.get(id);
      return isFacultyRow(entity) && live(entity) && byEntity.get(id)?.has('PI');
    });
    if (ownRows.length === 0) continue;
    const ownLabs = [...byEntity.keys()].filter((id) => {
      const lab = input.entities.get(id);
      return (
        isLab(lab) &&
        live(lab) &&
        byEntity.get(id)?.has('PI') &&
        evidencedPiEdges.has(`${personId}:${id}`) &&
        !isOrganizationalHomeEntity(lab as WitnessedFoldEntity) &&
        labPageNamesPersonAsPi(lab as WitnessedFoldEntity, personId)
      );
    });
    if (ownLabs.length === 0) continue;
    for (const facultyRowId of ownRows) {
      if (ownLabs.length > 1) {
        refusals.push({ facultyRowId, reason: 'several-own-labs' });
        continue;
      }
      propose({ personId, facultyRowId, labId: ownLabs[0], witness: 'lab-page-names-pi' });
    }
  }

  const folds: WitnessedFold[] = [];
  for (const [facultyRowId, proposed] of candidates) {
    const labs = new Set(proposed.map((fold) => fold.labId));
    if (labs.size > 1) {
      refusals.push({ facultyRowId, reason: 'witnesses-disagree' });
      continue;
    }
    folds.push(proposed.find((fold) => fold.witness === 'ballot') ?? proposed[0]);
  }
  return {
    folds: folds.sort((a, b) => a.facultyRowId.localeCompare(b.facultyRowId)),
    refusals,
  };
}

/**
 * A lead edge the engine wrote from a lane read carries its source or a confidence. A
 * legacy edge with neither is not evidence that the person leads the row, and on
 * Development the page witness's one wrong fold rested on such an edge.
 */
export function edgeCarriesEvidence(edge: {
  confidence?: unknown;
  sourceName?: unknown;
  rosterProvenance?: { sourceName?: unknown };
}): boolean {
  const named = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  return (
    (typeof edge.confidence === 'number' && edge.confidence > 0) ||
    named(edge.sourceName) ||
    named(edge.rosterProvenance?.sourceName)
  );
}

export interface WitnessedFoldContext {
  entities: Map<string, WitnessedFoldEntity>;
  edges: WitnessedFoldEdge[];
}

/**
 * The lead edges of the given people and of every ballot pair's rows, and the rows they
 * point at with the lab-page verdicts the page witness reads.
 */
export async function loadWitnessedFoldContext(input: {
  personIds: readonly string[];
  ballotPairs?: readonly BallotFoldPair[];
}): Promise<WitnessedFoldContext> {
  if (!mongooseConnectionWasOpened()) return { entities: new Map(), edges: [] };
  const objectIds = (ids: readonly string[]) =>
    ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
  const pairRowIds = (input.ballotPairs ?? []).flatMap((pair) => [pair.facultyRowId, pair.labId]);
  const liveLead = {
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: [...LEAD_ROLES] },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
    personId: { $exists: true, $ne: null },
  };
  const pairLeads = pairRowIds.length
    ? ((await RoleAssignment.find({ ...liveLead, 'target.id': { $in: objectIds(pairRowIds) } })
        .select('personId')
        .lean()) as Array<{ personId?: unknown }>)
    : [];
  const personIds = [
    ...new Set([...input.personIds, ...pairLeads.map((edge) => String(edge.personId))]),
  ];
  const edgeDocs = (await RoleAssignment.find({
    ...liveLead,
    personId: { $in: objectIds(personIds) },
  })
    .select('personId target.id role confidence sourceName rosterProvenance.sourceName')
    .lean()) as Array<{
    personId?: unknown;
    target?: { id?: unknown };
    role?: string;
    confidence?: unknown;
    sourceName?: unknown;
    rosterProvenance?: { sourceName?: unknown };
  }>;
  const edges = edgeDocs.map((edge) => ({
    personId: String(edge.personId),
    entityId: String(edge.target?.id),
    role: String(edge.role || ''),
    evidenced: edgeCarriesEvidence(edge),
  }));
  const entityIds = [...new Set([...edges.map((edge) => edge.entityId), ...pairRowIds])];
  const docs = (await ResearchEntity.find({ _id: { $in: objectIds(entityIds) } })
    .select(
      '_id slug name kind entityType archived leadVerification websiteUrl fullDescription shortDescription sourceUrls departments researchAreas recentGrants recentGrantCount fundingAgencies fieldProvenance.slug.sourceUrl',
    )
    .lean()) as Array<Record<string, any>>;
  return {
    entities: new Map(
      docs.map((doc) => [
        String(doc._id),
        {
          id: String(doc._id),
          slug: doc.slug,
          name: doc.name,
          kind: doc.kind,
          entityType: doc.entityType,
          archived: doc.archived === true,
          leadVerification: doc.leadVerification ?? null,
          mergeFields: {
            websiteUrl: doc.websiteUrl,
            fullDescription: doc.fullDescription,
            shortDescription: doc.shortDescription,
            sourceUrls: doc.sourceUrls,
            departments: doc.departments,
            researchAreas: doc.researchAreas,
            recentGrants: doc.recentGrants,
            recentGrantCount: doc.recentGrantCount,
            fundingAgencies: doc.fundingAgencies,
            identitySourceUrl: doc.fieldProvenance?.slug?.sourceUrl,
          },
        },
      ]),
    ),
    edges,
  };
}

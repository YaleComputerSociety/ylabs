import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { planInferredPiMembership } from '../scrapers/entityMaterializer';
import { grantCoPiListedPersonIds } from '../scrapers/grantCoPiListing';
import {
  invalidatedScrapeRunIds,
  partitionObservationsByInvalidatedRun,
} from '../scrapers/invalidatedScrapeRuns';

const LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'];
const LEAD_OBSERVATION_FIELDS = ['inferredPiUserId', 'inferredPiUserKey'];

/**
 * For each research row, the leads it holds only through a grant co-PI listing (#5776),
 * read from the same lead observations the materializer turns into lead edges.
 */
export async function loadGrantCoPiListedLeadsByEntity(
  entityIds: ReadonlyArray<string | mongoose.Types.ObjectId>,
): Promise<Map<string, Set<string>>> {
  const listedByEntity = new Map<string, Set<string>>();
  const ids = [...new Set(entityIds.map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length === 0) return listedByEntity;

  const edges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: ids },
    role: { $in: LEAD_ROLES },
    archived: { $ne: true },
  })
    .select('personId target.id rosterProvenance.sourceName')
    .lean()) as Array<{
    personId?: unknown;
    target?: { id?: unknown };
    rosterProvenance?: { sourceName?: string };
  }>;
  const edgeSourcesByEntity = new Map<string, Map<string, string | undefined>>();
  for (const edge of edges) {
    const entityId = String(edge.target?.id ?? '');
    const personId = edge.personId ? String(edge.personId) : '';
    if (!entityId || !personId) continue;
    const byPerson = edgeSourcesByEntity.get(entityId) ?? new Map<string, string | undefined>();
    if (!byPerson.has(personId)) byPerson.set(personId, edge.rosterProvenance?.sourceName);
    edgeSourcesByEntity.set(entityId, byPerson);
  }
  const multiLeadIds = [...edgeSourcesByEntity.entries()]
    .filter(([, byPerson]) => byPerson.size > 1)
    .map(([entityId]) => new mongoose.Types.ObjectId(entityId));
  if (multiLeadIds.length === 0) return listedByEntity;

  const rows = (await ResearchEntity.find({ _id: { $in: multiLeadIds } })
    .select('_id slug')
    .lean()) as Array<{ _id: mongoose.Types.ObjectId; slug?: string }>;
  const slugs = rows.map((row) => row.slug).filter((slug): slug is string => Boolean(slug));
  const observations = (await Observation.find({
    entityType: 'researchEntity',
    field: { $in: LEAD_OBSERVATION_FIELDS },
    superseded: { $ne: true },
    $or: [{ entityId: { $in: multiLeadIds } }, { entityKey: { $in: slugs } }],
  }).lean()) as any[];
  const { kept } = partitionObservationsByInvalidatedRun(
    observations,
    await invalidatedScrapeRunIds(),
  );

  for (const row of rows) {
    const entityId = String(row._id);
    const own = kept.filter(
      (observation) =>
        String(observation.entityId ?? '') === entityId ||
        (Boolean(row.slug) && observation.entityKey === row.slug),
    );
    const byPerson = edgeSourcesByEntity.get(entityId)!;
    const listed = grantCoPiListedPersonIds({
      leadFacts: await planInferredPiMembership(entityId, own),
      rowLeadPersonIds: byPerson.keys(),
      edgeSourceNameByPerson: byPerson,
    });
    if (listed.size > 0) listedByEntity.set(entityId, listed);
  }
  return listedByEntity;
}

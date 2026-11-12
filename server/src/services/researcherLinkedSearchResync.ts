import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { servablePersonTitle } from '../utils/titleHygiene';
import { titleHoldsOnlyEmeritusAppointments } from './emeritusLeadWayIn';
import { syncEntities } from './meiliSyncService';

interface ResearcherSearchDocumentInputSource {
  displayName?: unknown;
  archived?: unknown;
  profile?: { title?: unknown } | null;
  identifiers?: { netid?: unknown } | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// The search document reads a lead's title only through the emeritus test (the way-in
// withhold and the departure exemption), so a retitle that keeps that verdict re-syncs nothing.
export function researcherSearchDocumentInputs(
  researcher: ResearcherSearchDocumentInputSource | null | undefined,
): string {
  const title = text(researcher?.profile?.title);
  return JSON.stringify([
    text(researcher?.displayName),
    researcher?.archived === true,
    text(researcher?.identifiers?.netid).trim().toLowerCase(),
    titleHoldsOnlyEmeritusAppointments(title),
    titleHoldsOnlyEmeritusAppointments(servablePersonTitle(title)),
  ]);
}

export const researcherSearchDocumentInputsChanged = (
  before: ResearcherSearchDocumentInputSource | null | undefined,
  after: ResearcherSearchDocumentInputSource | null | undefined,
): boolean => researcherSearchDocumentInputs(before) !== researcherSearchDocumentInputs(after);

const RESYNC_PAGE_SIZE = 250;

async function researchEntityIdsWithLiveEdgeTo(
  researcherIds: readonly string[],
): Promise<unknown[]> {
  const personIds = researcherIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (personIds.length === 0) return [];
  return RoleAssignment.distinct('target.id', {
    personId: { $in: personIds },
    'target.kind': 'RESEARCH_ENTITY',
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  });
}

export async function resyncResearchRowsLinkedToResearchers(
  researcherIds: Iterable<string>,
): Promise<string[]> {
  const entityIds = await researchEntityIdsWithLiveEdgeTo([...new Set(researcherIds)]);
  const failedEntityIds: string[] = [];
  for (let start = 0; start < entityIds.length; start += RESYNC_PAGE_SIZE) {
    const rows = await ResearchEntity.find({
      _id: { $in: entityIds.slice(start, start + RESYNC_PAGE_SIZE) },
    }).lean();
    if (rows.length === 0) continue;
    if ((await syncEntities('researchEntity', rows)) === 0) {
      failedEntityIds.push(...rows.map((row) => String(row._id)));
    }
  }
  return failedEntityIds;
}

const pendingResearcherIds = new AsyncLocalStorage<Set<string>>();

async function resyncLinkedRowsAndWarn(researcherIds: Iterable<string>): Promise<void> {
  const failedEntityIds = await resyncResearchRowsLinkedToResearchers(researcherIds);
  if (failedEntityIds.length > 0) {
    console.warn(
      'Search documents of rows linked to a changed researcher failed to re-sync:',
      sanitizeLogValue({ failedEntityIds }),
    );
  }
}

export async function noteResearcherSearchInputChange(researcherId: unknown): Promise<void> {
  const id = researcherId == null ? '' : String(researcherId);
  if (!id) return;
  const pending = pendingResearcherIds.getStore();
  if (pending) pending.add(id);
  else await resyncLinkedRowsAndWarn([id]);
}

export interface ResearcherSearchInputResync<T> {
  value: T;
  failedEntityIds: string[];
}

// A nested scope defers to the enclosing one, so a run's chunk owns one batched re-sync of
// every researcher changed inside it and the failures reach the run's stale-index set.
export async function withResearcherSearchInputResync<T>(
  work: () => Promise<T>,
): Promise<ResearcherSearchInputResync<T>> {
  if (pendingResearcherIds.getStore()) return { value: await work(), failedEntityIds: [] };
  const pending = new Set<string>();
  let value: T;
  try {
    value = await pendingResearcherIds.run(pending, work);
  } catch (error) {
    await resyncLinkedRowsAndWarn(pending);
    throw error;
  }
  return {
    value,
    failedEntityIds: pending.size > 0 ? await resyncResearchRowsLinkedToResearchers(pending) : [],
  };
}

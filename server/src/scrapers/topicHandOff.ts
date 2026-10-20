/**
 * Topic hand-off from the model description lane to the code lane (#5296).
 *
 * Owner decision on 2026-10-19: on a row `lab-site-research-read` has read and found topics
 * for, the `researchAreas` `lab-microsite-description-llm` stored retire and the code topics
 * serve; on a row the code lane found no topics for, the model list keeps serving for now.
 *
 * Two halves, as the centre hand-offs have. The materializer screen drops a handed-off model
 * list on every resolve, so no pass can project it, and the run reconcile retires the model
 * observations themselves, so a later pass over a row the code lane has not re-read, a
 * rematerialize, or a merge cannot find a live model list to write back.
 */
import mongoose from 'mongoose';
import { Observation, researchEntityObservationSubjects } from '../models/observation';
import { serializedDocumentId } from '../utils/idSerialization';
import { retireObservationRows } from './centerRosterRetirement';

export const MODEL_TOPIC_SOURCE_NAME = 'lab-microsite-description-llm';
export const CODE_TOPIC_SOURCE_NAME = 'lab-site-research-read';
export const TOPIC_FIELD = 'researchAreas';
export const TOPIC_HAND_OFF_REASON =
  'topic hand-off: lab-site-research-read read this row and states its topics, so the lab-microsite-description-llm researchAreas retire (#5296)';

interface TopicObservationLike {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
}

const statesTopics = (value: unknown): boolean =>
  Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim().length > 0);

export function codeLaneStatesTopics(observations: readonly TopicObservationLike[]): boolean {
  return observations.some(
    (observation) =>
      observation.sourceName === CODE_TOPIC_SOURCE_NAME &&
      observation.field === TOPIC_FIELD &&
      statesTopics(observation.value),
  );
}

const isModelTopicObservation = (observation: TopicObservationLike): boolean =>
  observation.sourceName === MODEL_TOPIC_SOURCE_NAME && observation.field === TOPIC_FIELD;

export function withoutHandedOffModelTopics<T extends TopicObservationLike>(
  observations: readonly T[],
): T[] {
  if (!codeLaneStatesTopics(observations)) return [...observations];
  return observations.filter((observation) => !isModelTopicObservation(observation));
}

export function planTopicHandOff(
  observations: readonly (TopicObservationLike & { _id?: unknown })[],
): string[] {
  if (!codeLaneStatesTopics(observations)) return [];
  return observations
    .filter(isModelTopicObservation)
    .map((observation) => serializedDocumentId(observation._id))
    .filter((id): id is string => Boolean(id));
}

export interface TopicHandOffResult {
  dryRun: boolean;
  rowsRead: number;
  rowsHandedOff: number;
  retiredObservations: number;
}

interface CodeTopicRow {
  entityId?: unknown;
  entityKey?: unknown;
}

async function liveTopicObservationsForRow(row: CodeTopicRow) {
  const identity: Record<string, unknown>[] = [];
  const entityId = serializedDocumentId(row.entityId);
  if (entityId && mongoose.Types.ObjectId.isValid(entityId)) {
    identity.push({ entityId: new mongoose.Types.ObjectId(entityId) });
  }
  if (typeof row.entityKey === 'string' && row.entityKey)
    identity.push({ entityKey: row.entityKey });
  if (identity.length === 0) return [];
  return Observation.find({
    entityType: { $in: researchEntityObservationSubjects },
    field: TOPIC_FIELD,
    sourceName: { $in: [MODEL_TOPIC_SOURCE_NAME, CODE_TOPIC_SOURCE_NAME] },
    superseded: false,
    $or: identity,
  })
    .select('_id sourceName field value')
    .lean();
}

export async function reconcileTopicHandOffFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
): Promise<TopicHandOffResult | null> {
  if (!mongoose.Types.ObjectId.isValid(scrapeRunId)) return null;
  const rows = (await Observation.aggregate([
    {
      $match: {
        scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
        sourceName: CODE_TOPIC_SOURCE_NAME,
        field: TOPIC_FIELD,
        superseded: false,
      },
    },
    { $group: { _id: { entityId: '$entityId', entityKey: '$entityKey' } } },
  ])) as Array<{ _id: CodeTopicRow }>;
  if (rows.length === 0) return null;
  const result: TopicHandOffResult = {
    dryRun: options.dryRun === true,
    rowsRead: rows.length,
    rowsHandedOff: 0,
    retiredObservations: 0,
  };
  for (const { _id: row } of rows) {
    const retire = planTopicHandOff(await liveTopicObservationsForRow(row));
    if (retire.length === 0) continue;
    result.rowsHandedOff += 1;
    result.retiredObservations += retire.length;
    if (!result.dryRun) await retireObservationRows(retire, TOPIC_HAND_OFF_REASON);
  }
  return result;
}

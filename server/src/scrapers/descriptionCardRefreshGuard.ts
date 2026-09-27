import mongoose from 'mongoose';
import type { ObservationInput } from './types';

export interface DescriptionPair {
  fullDescription?: unknown;
  shortDescription?: unknown;
}

/**
 * Whether a description pair would give this row a complete card, judged the way the
 * student visibility gate judges it rather than by the raw text alone.
 */
export type DescriptionCardJudge = (
  subject: Pick<ObservationInput, 'entityType' | 'entityId' | 'entityKey'>,
  pair: DescriptionPair,
  context: { researchAreas?: unknown },
) => Promise<boolean | undefined>;

/**
 * The gate's own builder, loaded lazily because it sits in the services layer and pulls in
 * the whole serve chain. Undefined means "cannot judge", which the caller treats as no
 * objection, so a missing row or a test with no database never blocks a write.
 */
export function createDescriptionCardJudge(): DescriptionCardJudge {
  const rows = new Map<string, Promise<Record<string, unknown> | null>>();
  const loadRow = (subject: Pick<ObservationInput, 'entityId' | 'entityKey'>) => {
    const cacheKey = String(subject.entityId || subject.entityKey || '');
    if (!rows.has(cacheKey)) {
      rows.set(
        cacheKey,
        (async () => {
          const { ResearchEntity } = await import('../models/researchEntity');
          const or: Record<string, unknown>[] = [];
          if (subject.entityKey) or.push({ slug: subject.entityKey });
          if (subject.entityId && mongoose.isValidObjectId(subject.entityId)) {
            or.push({ _id: new mongoose.Types.ObjectId(String(subject.entityId)) });
          }
          if (or.length === 0) return null;
          return (await ResearchEntity.findOne({ $or: or }).select('-embedding').lean()) as Record<
            string,
            unknown
          > | null;
        })(),
      );
    }
    return rows.get(cacheKey)!;
  };
  return async (subject, pair, context) => {
    if (mongoose.connection.readyState !== 1) return undefined;
    const row = await loadRow(subject);
    if (!row) return undefined;
    const { buildResearchEntityPublicDescriptionRepresentation } =
      await import('../services/researchEntityPublicDescription');
    const entity = {
      ...row,
      fullDescription: pair.fullDescription,
      shortDescription: pair.shortDescription,
      ...(context.researchAreas !== undefined ? { researchAreas: context.researchAreas } : {}),
    };
    return (
      buildResearchEntityPublicDescriptionRepresentation({ entity, leadMembers: [] }).quality
        .cardState === 'complete'
    );
  };
}

/**
 * A same-source refresh that would take a row's card away. The raw prose guards judge the
 * text before serving, and a keyword list, a citation or a recruiting line can pass them
 * and still leave nothing the serve chain will put on a card. Measured on a Development
 * re-extraction of 976 person rows, 16 lost a card this way and 14 gained one, so the rule
 * refuses only the loss: an incoming pair replaces a card-complete one only if it is
 * card-complete too.
 */
export async function isCardLosingDescriptionRefresh(input: {
  subject: Pick<ObservationInput, 'entityType' | 'entityId' | 'entityKey'>;
  existing: DescriptionPair;
  incoming: DescriptionPair;
  researchAreas?: unknown;
  judge: DescriptionCardJudge;
}): Promise<boolean> {
  if (typeof input.existing.fullDescription !== 'string' || !input.existing.fullDescription) {
    return false;
  }
  const existingHasCard = await input.judge(input.subject, input.existing, {
    researchAreas: input.researchAreas,
  });
  if (existingHasCard !== true) return false;
  const incomingHasCard = await input.judge(input.subject, input.incoming, {
    researchAreas: input.researchAreas,
  });
  return incomingHasCard === false;
}

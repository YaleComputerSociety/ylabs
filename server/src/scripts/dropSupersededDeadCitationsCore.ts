import { isKnownDeadSourceUrl } from '../services/sourceLinkHealth';

export interface DeadCitationCandidateEntity {
  slug?: unknown;
  name?: unknown;
  studentVisibilityTier?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  sourceLinkHealth?: unknown;
}

export interface DeadCitationDropPlan {
  entitySlug: string;
  entityName?: string;
  studentVisibilityTier?: string;
  droppedUrls: string[];
  keptUrls: string[];
  clearsWebsiteUrl: boolean;
}

const stringEntries = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * Drop a citation whose stored verdict says the resource is gone, but only while
 * the entity keeps at least one citation that is not known dead.
 *
 * The surviving-citation requirement is the safety property, not a nicety. #2638
 * holds a card out of `student_ready` when every citation it has is dead, so a
 * repair that emptied the list would demote the row it was trying to improve. On
 * Development all 32 affected rows retain a live citation, so none is at risk.
 *
 * An unprobed citation is silence and is never dropped, matching
 * `isKnownDeadSourceUrl`.
 */
export function planDeadCitationDrop(
  entity: DeadCitationCandidateEntity,
): DeadCitationDropPlan | null {
  const slug = typeof entity.slug === 'string' ? entity.slug : '';
  if (!slug) return null;

  const citations = stringEntries(entity.sourceUrls);
  const dead = citations.filter((url) => isKnownDeadSourceUrl(entity.sourceLinkHealth, url));
  if (dead.length === 0) return null;

  const kept = citations.filter((url) => !dead.includes(url));
  const keptLive = kept.filter((url) => !isKnownDeadSourceUrl(entity.sourceLinkHealth, url));
  if (keptLive.length === 0) return null;

  const websiteUrl = typeof entity.websiteUrl === 'string' ? entity.websiteUrl : '';
  const clearsWebsiteUrl = websiteUrl !== '' && dead.includes(websiteUrl);

  return {
    entitySlug: slug,
    entityName: typeof entity.name === 'string' ? entity.name : undefined,
    studentVisibilityTier:
      typeof entity.studentVisibilityTier === 'string' ? entity.studentVisibilityTier : undefined,
    droppedUrls: dead,
    keptUrls: kept,
    clearsWebsiteUrl,
  };
}

/**
 * A dead `/lab/<name>/` microsite on a row that already cites the PI's live
 * `/profile/`. Reported separately because it is the dominant shape and it is the
 * one that must NOT be read as a departure: Yale School of Medicine retired the
 * lab-microsite namespace while the people stayed.
 */
export function isRetiredLabMicrositeDrop(plan: DeadCitationDropPlan): boolean {
  const droppedLab = plan.droppedUrls.some((url) => /\/lab\//i.test(url));
  const keptProfile = plan.keptUrls.some((url) => /\/profile\//i.test(url));
  return droppedLab && keptProfile;
}

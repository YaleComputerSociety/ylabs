import {
  filterFabricatedWhyBullets,
  type WhyBulletIssue,
} from '../utils/studentDecisionExplanationWhyQuality';

export interface Why1634SourceDoc {
  _id: unknown;
  slug?: string;
  studentDecisionExplanation?: {
    why?: unknown;
  } | null;
  researchAreas?: readonly string[] | null;
  fullDescription?: string | null;
}

export interface Why1634Plan {
  id: string;
  slug: string;
  originalWhy: string[];
  keptWhy: string[];
  removedBullets: Array<{ bullet: string; issues: WhyBulletIssue[] }>;
  unsetWholeField: boolean;
}

export function buildWhy1634Plans(docs: readonly Why1634SourceDoc[]): Why1634Plan[] {
  const plans: Why1634Plan[] = [];
  for (const doc of docs) {
    const why = doc.studentDecisionExplanation?.why;
    if (!Array.isArray(why) || why.length === 0) continue;

    const { keep, removed } = filterFabricatedWhyBullets(why, {
      researchAreas: doc.researchAreas,
      fullDescription: doc.fullDescription,
    });
    if (removed.length === 0) continue;

    plans.push({
      id: String(doc._id),
      slug: doc.slug || '',
      originalWhy: why.map(String),
      keptWhy: keep,
      removedBullets: removed,
      unsetWholeField: keep.length === 0,
    });
  }
  return plans;
}

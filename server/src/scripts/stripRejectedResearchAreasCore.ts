import { isResearchAreaLabelLeakage } from '../scrapers/researchAreaCanonicalization';

export interface RejectedResearchAreaPlan {
  kept: string[];
  removed: string[];
  changed: boolean;
}

export function planRejectedResearchAreaStrip(researchAreas: unknown): RejectedResearchAreaPlan {
  if (!Array.isArray(researchAreas)) {
    return { kept: [], removed: [], changed: false };
  }
  const kept: string[] = [];
  const removed: string[] = [];
  for (const value of researchAreas) {
    if (typeof value === 'string' && isResearchAreaLabelLeakage(value)) {
      removed.push(value);
    } else if (typeof value === 'string') {
      kept.push(value);
    }
  }
  return { kept, removed, changed: removed.length > 0 };
}

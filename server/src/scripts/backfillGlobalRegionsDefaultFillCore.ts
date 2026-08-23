import { distinctGlobalRegions, isFullRegionEnumeration } from '../services/globalRegions';

export interface GlobalRegionsDoc {
  id: string;
  title: string;
  globalRegions: string[];
}

export interface GlobalRegionsCollapseRow {
  id: string;
  title: string;
  regionCount: number;
}

export interface GlobalRegionsDefaultFillPlan {
  scanned: number;
  histogramBefore: Record<string, number>;
  histogramAfter: Record<string, number>;
  toCollapse: GlobalRegionsCollapseRow[];
}

function bump(histogram: Record<string, number>, bucket: number): void {
  const key = String(bucket);
  histogram[key] = (histogram[key] || 0) + 1;
}

export function planGlobalRegionsDefaultFillCollapse(
  docs: GlobalRegionsDoc[],
): GlobalRegionsDefaultFillPlan {
  const histogramBefore: Record<string, number> = {};
  const histogramAfter: Record<string, number> = {};
  const toCollapse: GlobalRegionsCollapseRow[] = [];

  for (const doc of docs) {
    const distinct = distinctGlobalRegions(doc.globalRegions);
    bump(histogramBefore, distinct.length);
    if (isFullRegionEnumeration(distinct)) {
      toCollapse.push({ id: doc.id, title: doc.title, regionCount: distinct.length });
      bump(histogramAfter, 0);
    } else {
      bump(histogramAfter, distinct.length);
    }
  }

  return { scanned: docs.length, histogramBefore, histogramAfter, toCollapse };
}

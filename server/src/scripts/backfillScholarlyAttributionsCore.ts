import mongoose from 'mongoose';
import { buildScholarlyAttributionWriteModels } from '../scrapers/entityMaterializer';

export interface BackfillScholarlyAttributionsOptions {
  apply: boolean;
  limit: number;
  offset: number;
}

export interface ScholarlyAttributionBackfillSummary {
  scanned: number;
  writeOps: number;
  skippedMissingLinkId: number;
  skippedMissingTarget: number;
  samples: ScholarlyAttributionBackfillSample[];
}

export interface ScholarlyAttributionBackfillSample {
  scholarlyLinkId: string;
  title: string;
  userId: string;
  researchEntityId: string;
  plannedAttributions: string[];
}

export function parseBackfillScholarlyAttributionsArgs(
  argv: string[],
): BackfillScholarlyAttributionsOptions {
  const options: BackfillScholarlyAttributionsOptions = {
    apply: argv.includes('--apply'),
    limit: 1000,
    offset: 0,
  };

  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) {
        options.limit = Math.floor(value);
      }
    }
    if (arg.startsWith('--offset=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value >= 0) {
        options.offset = Math.floor(value);
      }
    }
  }

  return options;
}

function objectIdValue(value: unknown): mongoose.Types.ObjectId | null {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
}

export function buildScholarlyAttributionBackfillOps(links: Record<string, any>[]): {
  ops: any[];
  summary: ScholarlyAttributionBackfillSummary;
} {
  const summary: ScholarlyAttributionBackfillSummary = {
    scanned: links.length,
    writeOps: 0,
    skippedMissingLinkId: 0,
    skippedMissingTarget: 0,
    samples: [],
  };
  const ops: any[] = [];

  for (const link of links) {
    const scholarlyLinkId = objectIdValue(link._id);
    if (!scholarlyLinkId) {
      summary.skippedMissingLinkId++;
      continue;
    }

    const userId = objectIdValue(link.userId);
    const researchEntityId = objectIdValue(link.researchEntityId);
    if (!userId && !researchEntityId) {
      summary.skippedMissingTarget++;
      continue;
    }

    const linkOps = buildScholarlyAttributionWriteModels({
      scholarlyLinkId,
      userId,
      researchEntityId,
      sourceName: String(link.discoveredVia || '').trim().toLowerCase(),
      sourceUrl: String(link.sourceUrl || link.url || '').trim(),
      confidence: link.confidence,
      observedAt: link.observedAt,
    });
    ops.push(...linkOps);
    if (summary.samples.length < 5 && linkOps.length > 0) {
      summary.samples.push({
        scholarlyLinkId: String(scholarlyLinkId),
        title: String(link.title || '').trim(),
        userId: userId ? String(userId) : '',
        researchEntityId: researchEntityId ? String(researchEntityId) : '',
        plannedAttributions: linkOps.map((op) =>
          String(op.updateOne?.filter?.relationshipBasis || ''),
        ).filter(Boolean),
      });
    }
  }

  summary.writeOps = ops.length;
  return { ops, summary };
}

export function summarizeScholarlyAttributionBackfill(
  input: ScholarlyAttributionBackfillSummary & {
    apply: boolean;
    totalEligible?: number;
    offset?: number;
  },
) {
  return {
    mode: input.apply ? 'apply' : 'dry-run',
    totalEligible: input.totalEligible,
    offset: input.offset,
    scanned: input.scanned,
    planned: input.writeOps,
    written: input.apply ? input.writeOps : 0,
    skippedMissingLinkId: input.skippedMissingLinkId,
    skippedMissingTarget: input.skippedMissingTarget,
    samples: input.samples,
  };
}

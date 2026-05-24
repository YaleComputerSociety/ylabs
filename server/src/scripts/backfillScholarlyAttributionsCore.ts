import mongoose from 'mongoose';
import { buildScholarlyAttributionWriteModels } from '../scrapers/entityMaterializer';

export interface BackfillScholarlyAttributionsOptions {
  apply: boolean;
  limit: number;
}

export interface ScholarlyAttributionBackfillSummary {
  scanned: number;
  writeOps: number;
  skippedMissingLinkId: number;
  skippedMissingTarget: number;
}

export function parseBackfillScholarlyAttributionsArgs(
  argv: string[],
): BackfillScholarlyAttributionsOptions {
  const options: BackfillScholarlyAttributionsOptions = {
    apply: argv.includes('--apply'),
    limit: 1000,
  };

  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) {
        options.limit = Math.floor(value);
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
  }

  summary.writeOps = ops.length;
  return { ops, summary };
}

export function summarizeScholarlyAttributionBackfill(
  input: ScholarlyAttributionBackfillSummary & { apply: boolean },
) {
  return {
    mode: input.apply ? 'apply' : 'dry-run',
    scanned: input.scanned,
    planned: input.writeOps,
    written: input.apply ? input.writeOps : 0,
    skippedMissingLinkId: input.skippedMissingLinkId,
    skippedMissingTarget: input.skippedMissingTarget,
  };
}

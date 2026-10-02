import { Source } from '../models/source';

export type ReturnedScrapeRunStatus = 'success' | 'partial' | 'failure' | 'interrupted';

export interface ScrapeRunCrawlOutcome {
  dryRun: boolean;
  runStatus: ReturnedScrapeRunStatus;
  materializationErrors?: number;
}

export function runEarnsCrawlStamp(outcome: ScrapeRunCrawlOutcome): boolean {
  if (outcome.dryRun) return false;
  if (outcome.runStatus !== 'success' && outcome.runStatus !== 'partial') return false;
  return (outcome.materializationErrors ?? 0) === 0;
}

export async function markSourceCrawled(sourceName: string, at: Date): Promise<void> {
  await Source.updateOne({ name: sourceName }, { $set: { lastCrawledAt: at } });
}

export async function stampSourceCrawlIfEarned(
  sourceName: string,
  outcome: ScrapeRunCrawlOutcome,
  at: Date = new Date(),
): Promise<boolean> {
  if (!runEarnsCrawlStamp(outcome)) return false;
  await markSourceCrawled(sourceName, at);
  return true;
}

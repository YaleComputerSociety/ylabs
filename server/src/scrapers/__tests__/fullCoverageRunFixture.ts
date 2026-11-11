import mongoose from 'mongoose';
import { ScrapeRun } from '../../models/scrapeRun';

export const FULL_COVERAGE_RUN_OPTIONS = {
  dryRun: false,
  useCache: false,
  release: false,
  ignoreWorkPlanner: true,
  exhaustive: true,
};

export async function recordFullCoverageRun(
  sourceName: string,
  scrapeRunId: mongoose.Types.ObjectId,
  startedAt: Date,
  options: Record<string, unknown> = FULL_COVERAGE_RUN_OPTIONS,
): Promise<void> {
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    startedAt,
    finishedAt: startedAt,
    status: 'success',
    options,
  });
}

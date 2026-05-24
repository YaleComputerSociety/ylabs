import mongoose from 'mongoose';
import type { IScraper, ObservationInput, ScraperOptions, ScraperResult } from './types';

export interface PreviewSource {
  id: string;
  name: string;
  defaultWeight: number;
}

export interface CapturedPreviewObservation extends ObservationInput {
  sourceName: string;
  confidence: number;
}

export interface RunScraperPreviewInput {
  scraper: IScraper;
  source: PreviewSource;
  options: ScraperOptions;
}

export interface RunScraperPreviewResult {
  observations: CapturedPreviewObservation[];
  scraperResult: ScraperResult;
}

export async function runScraperPreview(
  input: RunScraperPreviewInput,
): Promise<RunScraperPreviewResult> {
  const observations: CapturedPreviewObservation[] = [];
  const scrapeRunId = new mongoose.Types.ObjectId().toString();
  const scraperResult = await input.scraper.run({
    scrapeRunId,
    sourceId: input.source.id,
    sourceName: input.source.name,
    sourceWeight: input.source.defaultWeight,
    options: {
      ...input.options,
      dryRun: true,
    },
    emit: async (next: ObservationInput | ObservationInput[]) => {
      const batch = Array.isArray(next) ? next : [next];
      for (const observation of batch) {
        observations.push({
          ...observation,
          sourceName: input.source.name,
          confidence: observation.confidenceOverride ?? input.source.defaultWeight,
        });
      }
    },
    log: () => undefined,
  });

  return { observations, scraperResult };
}

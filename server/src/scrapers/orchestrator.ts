/**
 * ScraperOrchestrator: resolves a source name to a registered IScraper, opens a ScrapeRun,
 * runs the scraper, persists Observations as they're emitted, and finalizes the run record.
 *
 * Materialization is a separate step (--materialize flag on the CLI) so a buggy scraper
 * never directly affects entity collections.
 */
import { ScrapeRun } from '../models/scrapeRun';
import { appendObservations, getSourceByName } from './observationStore';
import type {
  IScraper,
  ScraperContext,
  ScraperOptions,
  ObservationInput,
  ScraperResult,
} from './types';

export class ScraperOrchestrator {
  private scrapers: Map<string, IScraper> = new Map();

  register(scraper: IScraper): void {
    this.scrapers.set(scraper.name, scraper);
  }

  list(): { name: string; displayName: string }[] {
    return Array.from(this.scrapers.values()).map((s) => ({
      name: s.name,
      displayName: s.displayName,
    }));
  }

  get(name: string): IScraper | undefined {
    return this.scrapers.get(name);
  }

  async run(name: string, options: ScraperOptions): Promise<{ runId: string; result: unknown }> {
    const scraper = this.scrapers.get(name);
    if (!scraper) {
      throw new Error(
        `No scraper registered with name "${name}". Registered: ${Array.from(this.scrapers.keys()).join(', ')}`,
      );
    }

    const source = await getSourceByName(name);
    if (!source) {
      throw new Error(
        `No Source row found with name "${name}". Run "yarn seed:sources" first.`,
      );
    }

    const run = await ScrapeRun.create({
      sourceId: source._id,
      sourceName: source.name,
      triggeredBy: options.release ? 'cron' : 'cli',
      startedAt: new Date(),
      status: 'running',
      options: options as any,
    });

    let observationCount = 0;
    let entitiesObserved = 0;
    const observedEntityKeys = new Set<string>();
    const errors: any[] = [];

    const ctx: ScraperContext = {
      scrapeRunId: String(run._id),
      sourceId: source._id,
      sourceName: source.name,
      sourceWeight: source.defaultWeight,
      options,
      emit: async (input: ObservationInput | ObservationInput[]) => {
        const inputs = Array.isArray(input) ? input : [input];
        if (inputs.length === 0) return;
        const res = await appendObservations(inputs, {
          scrapeRunId: String(run._id),
          sourceId: source._id,
          sourceName: source.name,
          sourceWeight: source.defaultWeight,
          dryRun: options.dryRun,
        });
        observationCount += res.inserted;
        for (const o of inputs) {
          const key = `${o.entityType}:${o.entityId || o.entityKey || ''}`;
          observedEntityKeys.add(key);
        }
        entitiesObserved = observedEntityKeys.size;
      },
      log: (msg, meta) => {
        const prefix = `[${name}]`;
        if (meta) console.log(prefix, msg, JSON.stringify(meta));
        else console.log(prefix, msg);
      },
    };

    try {
      const result = await scraper.run(ctx) as ScraperResult;
      await ScrapeRun.updateOne(
        { _id: run._id },
        {
          $set: {
            finishedAt: new Date(),
            status: errors.length === 0 ? 'success' : 'partial',
            observationCount,
            entitiesObserved,
            fetchMetrics: result.fetchMetrics,
            errors,
          },
        },
      );
      return { runId: String(run._id), result };
    } catch (err: any) {
      await ScrapeRun.updateOne(
        { _id: run._id },
        {
          $set: {
            finishedAt: new Date(),
            status: 'failure',
            observationCount,
            entitiesObserved,
            errors: [
              ...errors,
              { message: err?.message, stack: err?.stack, at: new Date() },
            ],
          },
        },
      );
      throw err;
    }
  }
}

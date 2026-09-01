import { Source } from '../models/source';

export async function markSourceCrawled(sourceName: string, at: Date): Promise<void> {
  await Source.updateOne({ name: sourceName }, { $set: { lastCrawledAt: at } });
}

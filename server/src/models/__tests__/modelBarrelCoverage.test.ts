import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import '../index';

const modelsDir = path.resolve(__dirname, '..');

const modelFiles = fs
  .readdirSync(modelsDir)
  .filter((entry) => entry.endsWith('.ts') && entry !== 'index.ts')
  .map((entry) => entry.replace(/\.ts$/, ''))
  .filter((name) => {
    const source = fs.readFileSync(path.join(modelsDir, `${name}.ts`), 'utf8');
    return /mongoose\.model(?:s)?[.<(]/.test(source);
  })
  .sort();

describe('model barrel coverage', () => {
  it('finds at least one model file to check', () => {
    expect(modelFiles.length).toBeGreaterThan(10);
  });

  // Importing the barrel is how every consumer, and every guard that reads
  // `mongoose.modelNames()` to decide whether a collection is safe to drop,
  // learns that a model exists. A model file the barrel does not re-export is
  // invisible to those guards, so `observations` at 598,790 rows once read as
  // unmodelled.
  it.each(modelFiles)('re-exports the model declared in %s', (name) => {
    const barrel = fs.readFileSync(path.join(modelsDir, 'index.ts'), 'utf8');
    expect(barrel).toContain(`'./${name}'`);
  });

  it('registers every barrel-exported model on the shared mongoose instance', () => {
    expect(mongoose.modelNames().length).toBeGreaterThanOrEqual(modelFiles.length);
  });

  it('registers the collections a drop guard must never treat as unmodelled', () => {
    const collections = new Set(
      mongoose.modelNames().map((name) => mongoose.model(name).collection.collectionName),
    );
    for (const guarded of [
      'observations',
      'scrape_runs',
      'research_entities',
      'researchers',
      'role_assignments',
      'signals',
      'corpus_quality_snapshots',
    ]) {
      expect(collections).toContain(guarded);
    }
  });
});

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import allowlist from './searchDocumentInputResyncAllowlist.json';

const SCRIPTS_DIR = path.resolve(__dirname, '..');

const WRITE_METHODS =
  'updateOne|updateMany|bulkWrite|findOneAndUpdate|findByIdAndUpdate|replaceOne';
const MODEL_WRITE = new RegExp(
  `\\b(?:ResearchEntity|Researcher|RoleAssignment)\\s*\\.\\s*(?:${WRITE_METHODS})\\s*\\(`,
);
const RAW_COLLECTION_WRITE = new RegExp(
  `collection\\(\\s*(?:'research_entities'|"research_entities"|'researchers'|"researchers"|'role_assignments'|"role_assignments"|RESEARCH_ENTITIES)\\s*\\)\\s*\\.\\s*(?:${WRITE_METHODS})\\s*\\(`,
);
const SHARED_RESYNC = new RegExp(
  [
    'syncEntity',
    'syncEntities',
    'syncResearchEntitiesWithOutcome',
    'resyncResearchRowsLinkedToResearchers',
    'regateRematerializedEntities',
  ]
    .map((name) => `\\b${name}\\b`)
    .join('|'),
);

export interface ScannedSource {
  file: string;
  source: string;
}

// File-level text scan, like the #6375 guard: a write through a helper module or a re-sync run
// by a caller is invisible to it, so those go on the allowlist with the reason. The
// student-visibility gate and the materializer do not count as a re-sync, because both
// re-index only rows whose own fields they changed (#6538).
export function unsyncedSearchInputWriters(sources: readonly ScannedSource[]): string[] {
  return sources
    .filter(
      ({ source }) =>
        (MODEL_WRITE.test(source) || RAW_COLLECTION_WRITE.test(source)) &&
        !SHARED_RESYNC.test(source),
    )
    .map(({ file }) => file)
    .sort();
}

function scriptSources(): ScannedSource[] {
  const sources: ScannedSource[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'tmp' || entry.name === 'node_modules') {
          continue;
        }
        walk(full);
      } else if (/\.(ts|mts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        sources.push({
          file: path.relative(SCRIPTS_DIR, full).split(path.sep).join('/'),
          source: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(SCRIPTS_DIR);
  return sources;
}

const allowlisted = allowlist as Record<string, string>;

describe('scripts that write a search-document input re-sync search (#6538)', () => {
  it('finds exactly the allowlisted writers, so a new one fails and a fixed one must leave the list', () => {
    expect(unsyncedSearchInputWriters(scriptSources())).toEqual(Object.keys(allowlisted).sort());
  });

  it('gives every allowlisted writer a reason', () => {
    const missing = Object.entries(allowlisted)
      .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 20)
      .map(([file]) => file);
    expect(missing).toEqual([]);
  });

  it('flags raw writes without a re-sync and passes writes that re-sync', () => {
    const raw = {
      file: 'raw.ts',
      source: "await ResearchEntity.updateOne({ _id }, { $set: { shortDescription: 'x' } });",
    };
    const aliasedCollection = {
      file: 'aliased.ts',
      source:
        "const Researcher = mongoose.connection.collection('researchers');\nawait Researcher.bulkWrite(ops);",
    };
    const rawCollection = {
      file: 'collection.ts',
      source: "await db.collection('research_entities')\n  .updateMany({}, { $set: { a: 1 } });",
    };
    const resynced = {
      file: 'resynced.ts',
      source:
        'await Researcher.updateOne({ _id }, update);\nawait resyncResearchRowsLinkedToResearchers([id]);',
    };
    const readOnly = {
      file: 'read.ts',
      source: "await db.collection('research_entities').find({}).toArray();",
    };
    expect(
      unsyncedSearchInputWriters([raw, aliasedCollection, rawCollection, resynced, readOnly]),
    ).toEqual(['aliased.ts', 'collection.ts', 'raw.ts']);
  });
});

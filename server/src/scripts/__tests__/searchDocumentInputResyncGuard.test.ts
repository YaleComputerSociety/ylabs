import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import allowlist from './searchDocumentInputResyncAllowlist.json';

const SCRIPTS_DIR = path.resolve(__dirname, '..');

const WRITE_METHODS = [
  'updateOne',
  'updateMany',
  'bulkWrite',
  'replaceOne',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'findOneAndReplace',
  'create',
  'insertOne',
  'insertMany',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findByIdAndDelete',
].join('|');
const MODELS = 'ResearchEntity|Researcher|RoleAssignment';
const COLLECTION_NAMES = ['research_entities', 'researchers', 'role_assignments']
  .flatMap((name) => [`'${name}'`, `"${name}"`])
  .concat(['RESEARCH_ENTITIES', 'RESEARCHERS', 'ROLE_ASSIGNMENTS'])
  .join('|');
const WRITE_CALL = `\\s*\\.\\s*(?:${WRITE_METHODS})\\s*\\(`;

const MODEL_WRITE = new RegExp(`\\b(?:${MODELS})(?:\\s*\\.\\s*collection)?${WRITE_CALL}`);
const RAW_COLLECTION_WRITE = new RegExp(
  `collection\\(\\s*(?:${COLLECTION_NAMES})\\s*\\)${WRITE_CALL}`,
);
const RAW_COLLECTION_ALIAS = new RegExp(
  `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^;]*?collection\\(\\s*(?:${COLLECTION_NAMES})\\s*\\)\\s*;`,
  'g',
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
const IMPORT_STATEMENT = /^\s*import\b[\s\S]*?\bfrom\s*['"][^'"]+['"];?/gm;
const COMMENT = /\/\*[\s\S]*?\*\/|(^|[^:'"`])\/\/.*$/gm;

const callsSharedResync = (source: string): boolean =>
  SHARED_RESYNC.test(source.replace(IMPORT_STATEMENT, '').replace(COMMENT, '$1'));

export interface ScannedSource {
  file: string;
  source: string;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const writesThroughCollectionAlias = (source: string): boolean =>
  [...source.matchAll(RAW_COLLECTION_ALIAS)].some(([, alias]) =>
    new RegExp(`\\b${escapeRegExp(alias)}${WRITE_CALL}`).test(source),
  );

// File-level text scan, like the #6375 guard: a write through a helper module, `new Model().save()`,
// or a re-sync run by a caller is invisible to it, so those go on the allowlist with the reason.
// The student-visibility gate and the materializer do not count as a re-sync, because both
// re-index only rows whose own fields they changed (#6538).
export function unsyncedSearchInputWriters(sources: readonly ScannedSource[]): string[] {
  return sources
    .filter(
      ({ source }) =>
        (MODEL_WRITE.test(source) ||
          RAW_COLLECTION_WRITE.test(source) ||
          writesThroughCollectionAlias(source)) &&
        !callsSharedResync(source),
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
    const created = {
      file: 'created.ts',
      source: "await RoleAssignment.create({ role: 'lead' });",
    };
    const deleted = {
      file: 'deleted.ts',
      source: 'await ResearchEntity.deleteMany({ archived: true });',
    };
    const modelCollection = {
      file: 'model-collection.ts',
      source: 'await Researcher.collection.insertMany(rows);',
    };
    const renamedAlias = {
      file: 'renamed-alias.ts',
      source:
        "const edges = mongoose.connection.collection('role_assignments');\nawait edges.updateMany({}, update);",
    };
    const constantName = {
      file: 'constant.ts',
      source: 'await db.collection(RESEARCHERS).findOneAndReplace(filter, doc);',
    };
    const importOnly = {
      file: 'import-only.ts',
      source:
        "import { syncEntity } from '../services/meiliSyncService';\nawait ResearchEntity.updateOne({ _id }, update);",
    };
    const commentOnly = {
      file: 'comment-only.ts',
      source: 'await ResearchEntity.updateOne({ _id }, update); // syncEntity runs later',
    };
    const passedAsCallback = {
      file: 'callback.ts',
      source:
        'await ResearchEntity.updateOne({ _id }, update);\nconst regater = createChunkedRegater(regateRematerializedEntities, 1);',
    };
    expect(
      unsyncedSearchInputWriters([
        raw,
        aliasedCollection,
        rawCollection,
        resynced,
        readOnly,
        created,
        deleted,
        modelCollection,
        renamedAlias,
        constantName,
        importOnly,
        commentOnly,
        passedAsCallback,
      ]),
    ).toEqual([
      'aliased.ts',
      'collection.ts',
      'comment-only.ts',
      'constant.ts',
      'created.ts',
      'deleted.ts',
      'import-only.ts',
      'model-collection.ts',
      'raw.ts',
      'renamed-alias.ts',
    ]);
  });
});

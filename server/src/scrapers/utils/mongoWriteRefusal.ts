import mongoose from 'mongoose';

export class MongoWriteRefusedError extends Error {
  constructor(readonly operation: string) {
    super(`Refused a MongoDB write (${operation}): this process is write-free by construction`);
    this.name = 'MongoWriteRefusedError';
  }
}

const REFUSED_COLLECTION_METHODS = [
  'insertOne',
  'insertMany',
  'bulkWrite',
  'updateOne',
  'replaceOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'rename',
  'drop',
  'createIndex',
  'createIndexes',
  'dropIndex',
  'dropIndexes',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'createSearchIndex',
  'createSearchIndexes',
  'dropSearchIndex',
  'updateSearchIndex',
] as const;

const SYNCHRONOUS_REFUSED_COLLECTION_METHODS = [
  'initializeUnorderedBulkOp',
  'initializeOrderedBulkOp',
] as const;

const REFUSED_DB_METHODS = [
  'createCollection',
  'renameCollection',
  'dropCollection',
  'dropDatabase',
  'createIndex',
  'removeUser',
  'setProfilingLevel',
] as const;

const WRITE_COMMAND_NAMES = new Set([
  'insert',
  'update',
  'delete',
  'findandmodify',
  'create',
  'createindexes',
  'drop',
  'dropdatabase',
  'dropindexes',
  'renamecollection',
  'collmod',
  'bulkwrite',
  'createsearchindexes',
  'dropsearchindex',
  'updatesearchindex',
]);

const WRITING_PIPELINE_STAGES = ['$out', '$merge'];

function pipelineWrites(pipeline: unknown): boolean {
  if (!Array.isArray(pipeline)) return false;
  return pipeline.some(
    (stage) =>
      stage !== null &&
      typeof stage === 'object' &&
      WRITING_PIPELINE_STAGES.some((name) => Object.hasOwn(stage as object, name)),
  );
}

function commandWrites(command: unknown): string | undefined {
  if (!command || typeof command !== 'object') return undefined;
  const [name] = Object.keys(command as object);
  if (!name) return undefined;
  if (WRITE_COMMAND_NAMES.has(name.toLowerCase())) return name;
  if (name === 'aggregate' && pipelineWrites((command as { pipeline?: unknown }).pipeline)) {
    return 'aggregate with $out or $merge';
  }
  return undefined;
}

export interface MongoWriteRefusal {
  refusedOperations(): string[];
  restore(): void;
}

type AnyMethod = (...args: unknown[]) => unknown;

export function installMongoWriteRefusal(instance: typeof mongoose = mongoose): MongoWriteRefusal {
  const refused: string[] = [];
  const restorers: Array<() => void> = [];
  const refuse = (operation: string): never => {
    refused.push(operation);
    throw new MongoWriteRefusedError(operation);
  };
  const refuseAsync = (operation: string): Promise<never> => {
    try {
      return refuse(operation);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const replace = (target: Record<string, unknown>, method: string, wrapped: AnyMethod): void => {
    if (typeof target[method] !== 'function') return;
    const original = target[method];
    target[method] = wrapped;
    restorers.push(() => {
      target[method] = original;
    });
  };

  const collectionPrototype = instance.mongo.Collection.prototype as unknown as Record<
    string,
    unknown
  >;
  for (const method of REFUSED_COLLECTION_METHODS) {
    replace(collectionPrototype, method, () => refuseAsync(`collection.${method}`));
  }
  for (const method of SYNCHRONOUS_REFUSED_COLLECTION_METHODS) {
    replace(collectionPrototype, method, () => refuse(`collection.${method}`));
  }
  const originalCollectionAggregate = collectionPrototype.aggregate as AnyMethod;
  replace(collectionPrototype, 'aggregate', function (this: unknown, ...args: unknown[]) {
    if (pipelineWrites(args[0])) refuse('collection.aggregate with $out or $merge');
    return originalCollectionAggregate.apply(this, args);
  });

  const dbPrototype = instance.mongo.Db.prototype as unknown as Record<string, unknown>;
  for (const method of REFUSED_DB_METHODS) {
    replace(dbPrototype, method, () => refuseAsync(`db.${method}`));
  }
  const originalDbAggregate = dbPrototype.aggregate as AnyMethod;
  replace(dbPrototype, 'aggregate', function (this: unknown, ...args: unknown[]) {
    if (pipelineWrites(args[0])) refuse('db.aggregate with $out or $merge');
    return originalDbAggregate.apply(this, args);
  });
  const originalCommand = dbPrototype.command as AnyMethod;
  replace(dbPrototype, 'command', function (this: unknown, ...args: unknown[]) {
    const writing = commandWrites(args[0]);
    if (writing) return refuseAsync(`db.command(${writing})`);
    return originalCommand.apply(this, args);
  });

  const clientPrototype = instance.mongo.MongoClient.prototype as unknown as Record<
    string,
    unknown
  >;
  replace(clientPrototype, 'bulkWrite', () => refuseAsync('client.bulkWrite'));

  const previousAutoIndex = instance.get('autoIndex');
  const previousAutoCreate = instance.get('autoCreate');
  instance.set('autoIndex', false);
  instance.set('autoCreate', false);
  restorers.push(() => {
    instance.set('autoIndex', previousAutoIndex);
    instance.set('autoCreate', previousAutoCreate);
  });

  return {
    refusedOperations: () => [...refused],
    restore: () => {
      while (restorers.length > 0) restorers.pop()!();
    },
  };
}

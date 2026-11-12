import mongoose from 'mongoose';

import {
  DEV_WRITE_LEASE_SWITCH_ENV,
  acquireIntendedDevApplyLeaseAtFirstWrite,
  devHostLeasesArmed,
  devWriteLeaseSwitchedOff,
  hasDevApplyIntent,
  holdsDevApplyLease,
  releaseHeldDevWriteLeases,
  resolveDevWriteLeaseTarget,
} from './devWriteLease';

/**
 * Refuses a Mongoose model write to Development from a script process that holds no Development
 * write lease (#5871). A process that recorded an apply intent after it connected takes the lease
 * at its first write instead (#5971). Every model file imports this module before it compiles its
 * model, so the global plugin is part of every model. Raw driver handles skip Mongoose middleware;
 * rawResearchEntityWriteGuard.test.ts keeps those to a reviewed list.
 */

/** Changing what a `scrape run --apply` writes without the apply lease also requires updating this set. */
export const DEV_LANE_RUN_COLLECTIONS: ReadonlySet<string> = new Set([
  'observations',
  'scrape_runs',
  'scrape_job_locks',
  'sources',
  'scrape_snapshots',
  'model_call_usages',
]);

/**
 * A dry `scrape run` takes no lease by design (#5756) yet still records its run and fills the
 * fetch cache, so it may insert here and update only the `scrape_runs` rows it inserted itself.
 */
export const DEV_DRY_LANE_RUN_COLLECTIONS: ReadonlySet<string> = new Set([
  'scrape_runs',
  'scrape_snapshots',
]);

/** Append-only without the apply lease, in every allowance that admits them. */
export const DEV_INSERT_ONLY_COLLECTIONS: ReadonlySet<string> = new Set([
  'model_call_usages',
  'scrape_snapshots',
]);

const OWN_ROW_COLLECTION = 'scrape_runs';

/** Kept in step with DEV_APPLY_LEASE_EXEMPT_SCRIPTS, whose scripts append here during long applies by design. */
export const DEV_WRITE_GUARD_EXEMPT_COLLECTIONS: ReadonlySet<string> = new Set([
  'corpus_quality_snapshots',
  'engine_benchmarks',
  'engine_benchmark_rows',
  'engine_benchmark_snapshots',
  'gate_scorecard_snapshots',
  'lane_benchmarks',
  'lane_benchmark_pages',
  'lane_scorecard_snapshots',
  'model_call_usages',
]);

export const DEV_WRITE_GUARD_CONNECT_WAIT_MS = 30_000;

const PROCESS_ROLE = Symbol.for('ylabs.devWriteGuard.processRole');
const GUARD_IMPLEMENTATION = Symbol.for('ylabs.devWriteGuard.implementation');
const GUARD_PLUGIN = Symbol.for('ylabs.devWriteGuard.plugin');

type ProcessRole = 'request-serving' | 'dry-lane-run';
type ProcessRoleHolder = { [PROCESS_ROLE]?: ProcessRole };
const processRoleHolder = globalThis as ProcessRoleHolder;

export function declareRequestServingProcess(): void {
  processRoleHolder[PROCESS_ROLE] = 'request-serving';
}

export function isRequestServingProcess(): boolean {
  return processRoleHolder[PROCESS_ROLE] === 'request-serving';
}

export function declareDevDryLaneRun(): void {
  if (!isRequestServingProcess()) processRoleHolder[PROCESS_ROLE] = 'dry-lane-run';
}

const isDryLaneRun = () => processRoleHolder[PROCESS_ROLE] === 'dry-lane-run';

const QUERY_WRITE_OPERATIONS: mongoose.MongooseQueryMiddleware[] = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];

const WRITING_AGGREGATE_STAGES = ['$out', '$merge'];

export class DevWriteRefusedError extends Error {
  constructor(
    readonly modelName: string,
    readonly collectionName: string,
    readonly operation: string,
    reason: string,
  ) {
    super(
      `Refused ${operation} on model ${modelName} (collection "${collectionName}") in Development: ${reason}. Nothing was written.` +
        ' Run the write through a committed script with --apply, whose apply guard takes the Development write lease,' +
        ' or take the lease before writing (assertScriptApplyAllowed with apply: true, then connect through db/connections.ts;' +
        ' or holdDevApplyLeaseForRun). `yarn --cwd server dev:locks` shows who holds it.',
    );
    this.name = 'DevWriteRefusedError';
  }
}

export interface DevWriteGuardLeaseState {
  holdsApplyLease(): boolean;
  hostLeasesArmed(): boolean;
}

const defaultLeaseState: DevWriteGuardLeaseState = {
  holdsApplyLease: holdsDevApplyLease,
  hostLeasesArmed: devHostLeasesArmed,
};

let leaseState: DevWriteGuardLeaseState = defaultLeaseState;

export function setDevWriteGuardLeaseStateForTests(overrides: Partial<DevWriteGuardLeaseState>) {
  leaseState = { ...defaultLeaseState, ...overrides };
}

const OWNED_ROWS = Symbol.for('ylabs.devWriteGuard.ownedDryRunRows');
type OwnedRowsHolder = { [OWNED_ROWS]?: Set<string> };
const ownedDryRunRows = (): Set<string> =>
  ((globalThis as OwnedRowsHolder)[OWNED_ROWS] ??= new Set<string>());

export function resetDevWriteGuardStateForTests() {
  leaseState = defaultLeaseState;
  delete processRoleHolder[PROCESS_ROLE];
  ownedDryRunRows().clear();
}

export type DevModelWrite =
  | { operation: string; kind: 'insert'; insertedId?: unknown }
  | { operation: string; kind: 'update'; filter: unknown }
  | { operation: string; kind: 'delete' | 'other' };

interface GuardedModel {
  modelName: string;
  collection: { collectionName: string };
  db: mongoose.Connection;
}

function waitForOpen(connection: mongoose.Connection, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      connection.off('open', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    connection.once('open', done);
  });
}

async function connectedDatabaseName(connection: mongoose.Connection): Promise<string | undefined> {
  const known = connection.db?.databaseName || connection.name;
  if (known) return known;
  await waitForOpen(connection, DEV_WRITE_GUARD_CONNECT_WAIT_MS);
  return connection.db?.databaseName || connection.name || undefined;
}

function refusal(model: GuardedModel, operation: string, reason: string) {
  return new DevWriteRefusedError(
    model.modelName,
    model.collection.collectionName,
    operation,
    reason,
  );
}

const RELEASES_LEASES_ON_CLOSE = Symbol.for('ylabs.devWriteGuard.releasesLeasesOnClose');
type LeaseReleasingConnection = mongoose.Connection & { [RELEASES_LEASES_ON_CLOSE]?: true };

/** Releases this process's Development write leases before the connection that took them closes. */
export function releaseDevWriteLeasesWhenClosed(connection: mongoose.Connection): void {
  const marked = connection as LeaseReleasingConnection;
  if (marked[RELEASES_LEASES_ON_CLOSE]) return;
  marked[RELEASES_LEASES_ON_CLOSE] = true;
  const close = connection.close.bind(connection);
  connection.close = (async (...args: Parameters<typeof close>) => {
    await releaseHeldDevWriteLeases();
    return close(...args);
  }) as typeof connection.close;
}

async function tookApplyLeaseAtFirstWrite(
  model: GuardedModel,
  databaseName: string,
): Promise<boolean> {
  const connection = model.db;
  if (!connection.db) return false;
  const took = await acquireIntendedDevApplyLeaseAtFirstWrite({
    db: connection.db,
    databaseName,
    host: connection.host,
  });
  if (took) releaseDevWriteLeasesWhenClosed(connection);
  return took;
}

const listed = (collections: ReadonlySet<string>) => [...collections].join(', ');

const idKey = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : String(value);

function filteredIds(filter: unknown): string[] | undefined {
  if (!filter || typeof filter !== 'object') return undefined;
  const id = (filter as Record<string, unknown>)._id;
  if (id && typeof id === 'object' && !mongoose.isValidObjectId(id)) {
    const operators = id as Record<string, unknown>;
    if ('$eq' in operators) return [idKey(operators.$eq)].filter(Boolean) as string[];
    if (Array.isArray(operators.$in)) return operators.$in.map((value) => String(value));
    return undefined;
  }
  const key = idKey(id);
  return key ? [key] : undefined;
}

function updatesOnlyOwnRows(write: DevModelWrite): boolean {
  if (write.kind !== 'update') return false;
  const ids = filteredIds(write.filter);
  const owned = ownedDryRunRows();
  return Boolean(ids && ids.length > 0 && ids.every((id) => owned.has(id)));
}

function insertOnlyRefusal(model: GuardedModel, write: DevModelWrite): Error | undefined {
  if (write.kind === 'insert') return undefined;
  if (!DEV_INSERT_ONLY_COLLECTIONS.has(model.collection.collectionName)) return undefined;
  return refusal(
    model,
    write.operation,
    `${listed(DEV_INSERT_ONLY_COLLECTIONS)} are insert-only without the apply lease`,
  );
}

function dryLaneRunRefusal(model: GuardedModel, write: DevModelWrite): Error | undefined {
  const collectionName = model.collection.collectionName;
  if (!DEV_DRY_LANE_RUN_COLLECTIONS.has(collectionName)) {
    return refusal(
      model,
      write.operation,
      `a dry lane run may write only ${listed(DEV_DRY_LANE_RUN_COLLECTIONS)}`,
    );
  }
  if (write.kind === 'insert') {
    if (collectionName === OWN_ROW_COLLECTION) {
      const key = idKey(write.insertedId);
      if (key) ownedDryRunRows().add(key);
    }
    return undefined;
  }
  if (collectionName === OWN_ROW_COLLECTION && updatesOnlyOwnRows(write)) return undefined;
  return refusal(
    model,
    write.operation,
    collectionName === OWN_ROW_COLLECTION
      ? 'a dry lane run may update only the scrape_runs rows it inserted, matched by _id, and may delete none'
      : `a dry lane run may only insert into ${collectionName}`,
  );
}

// Ordered so a request-serving process, a switched-off lease and any database other than
// Development all return before lease state is read.
export async function assertDevModelWriteAllowed(
  model: GuardedModel,
  write: DevModelWrite,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isRequestServingProcess()) return;
  if (devWriteLeaseSwitchedOff(env)) return;
  const databaseName = await connectedDatabaseName(model.db);
  if (!databaseName) {
    throw refusal(
      model,
      write.operation,
      'the connection never opened, so this script could not tell whether it targets Development',
    );
  }
  const target = resolveDevWriteLeaseTarget({ databaseName, host: model.db.host });
  if (target.kind !== 'development') return;
  if (leaseState.holdsApplyLease()) return;
  const collectionName = model.collection.collectionName;
  if (DEV_WRITE_GUARD_EXEMPT_COLLECTIONS.has(collectionName)) {
    const insertOnly = insertOnlyRefusal(model, write);
    if (insertOnly) throw insertOnly;
    return;
  }
  if (leaseState.hostLeasesArmed()) {
    if (!DEV_LANE_RUN_COLLECTIONS.has(collectionName)) {
      throw refusal(
        model,
        write.operation,
        `a writing lane run may write only ${listed(DEV_LANE_RUN_COLLECTIONS)} without the apply lease`,
      );
    }
    const insertOnly = insertOnlyRefusal(model, write);
    if (insertOnly) throw insertOnly;
    return;
  }
  if (isDryLaneRun() && !hasDevApplyIntent()) {
    const dryRefusal = dryLaneRunRefusal(model, write);
    if (dryRefusal) throw dryRefusal;
    return;
  }
  if (hasDevApplyIntent() && (await tookApplyLeaseAtFirstWrite(model, databaseName))) return;
  throw refusal(
    model,
    write.operation,
    `this script process holds no Development write lease (${DEV_WRITE_LEASE_SWITCH_ENV}=off is for the test harness only)`,
  );
}

type GuardImplementation = typeof assertDevModelWriteAllowed;
type GuardImplementationHolder = { [GUARD_IMPLEMENTATION]?: GuardImplementation };

// The plugin registered first stays on mongoose for the life of the process, while a suite that
// resets its module registry evaluates this module again. Dispatching through the newest
// evaluation keeps the guard reading the lease module the rest of the process now uses.
(globalThis as GuardImplementationHolder)[GUARD_IMPLEMENTATION] = assertDevModelWriteAllowed;

const guard: GuardImplementation = (model, write, env) =>
  (globalThis as GuardImplementationHolder)[GUARD_IMPLEMENTATION]!(model, write, env);

const isInsertOnlyBulkWrite = (operations: unknown): boolean =>
  Array.isArray(operations) &&
  operations.every(
    (operation) =>
      typeof operation === 'object' &&
      operation !== null &&
      Object.keys(operation).length === 1 &&
      'insertOne' in operation,
  );

const DELETE_OPERATIONS = new Set(['deleteOne', 'deleteMany', 'findOneAndDelete']);

const writesThroughPipeline = (pipeline: unknown[]): boolean =>
  pipeline.some(
    (stage) =>
      typeof stage === 'object' &&
      stage !== null &&
      WRITING_AGGREGATE_STAGES.some((name) => name in stage),
  );

type GuardedDocument = mongoose.Document & { $isSubdocument?: boolean };
type GuardedQuery = mongoose.Query<unknown, unknown> & { op?: string };

export function devWriteGuardPlugin(schema: mongoose.Schema): void {
  schema.pre('save', async function guardDevSave(this: GuardedDocument) {
    if (this.$isSubdocument) return;
    const model = this.constructor as unknown as GuardedModel;
    await guard(
      model,
      this.isNew
        ? { operation: 'save', kind: 'insert', insertedId: this._id }
        : { operation: 'save', kind: 'update', filter: { _id: this._id } },
    );
  });
  schema.pre('insertMany', async function guardDevInsertMany(this: GuardedModel) {
    await guard(this, { operation: 'insertMany', kind: 'insert' });
  });
  schema.pre(
    'bulkWrite',
    async function guardDevBulkWrite(this: GuardedModel, operations: unknown) {
      await guard(
        this,
        isInsertOnlyBulkWrite(operations)
          ? { operation: 'bulkWrite', kind: 'insert' }
          : { operation: 'bulkWrite', kind: 'other' },
      );
    },
  );
  schema.pre(
    QUERY_WRITE_OPERATIONS,
    { document: false, query: true },
    async function guardDevQueryWrite(this: GuardedQuery) {
      const operation = this.op ?? 'write';
      await guard(
        this.model as unknown as GuardedModel,
        DELETE_OPERATIONS.has(operation)
          ? { operation, kind: 'delete' }
          : { operation, kind: 'update', filter: this.getFilter() },
      );
    },
  );
  schema.pre('aggregate', async function guardDevAggregateWrite(this: mongoose.Aggregate<unknown>) {
    if (!writesThroughPipeline(this.pipeline())) return;
    await guard(this.model() as unknown as GuardedModel, { operation: 'aggregate', kind: 'other' });
  });
}

type MarkedPlugin = { [GUARD_PLUGIN]?: true };
(devWriteGuardPlugin as MarkedPlugin)[GUARD_PLUGIN] = true;

const isGuardPlugin = (fn: unknown): boolean =>
  typeof fn === 'function' && (fn as MarkedPlugin)[GUARD_PLUGIN] === true;

type RegisteredPlugins = { plugins?: Array<[unknown, unknown]> };
type AppliedPlugins = { plugins?: Array<{ fn: unknown }> };

export function devWriteGuardRegistered(): boolean {
  const registered = (mongoose as unknown as RegisteredPlugins).plugins ?? [];
  return registered.some(([fn]) => isGuardPlugin(fn));
}

export function schemaHasDevWriteGuard(schema: unknown): boolean {
  return ((schema as AppliedPlugins).plugins ?? []).some(({ fn }) => isGuardPlugin(fn));
}

// A suite that mocks mongoose hands this module an object without the plugin registry.
if (typeof mongoose.plugin === 'function' && !devWriteGuardRegistered()) {
  mongoose.plugin(devWriteGuardPlugin);
}

export class UnguardedModelError extends Error {
  constructor(modelNames: string[]) {
    super(
      `Refused to connect a script to Development: model(s) ${modelNames.join(', ')} were compiled without the Development write guard, so their writes could not be checked against the write lease. Import the model from its module, which imports db/devWriteGuard before it compiles. Nothing was written.`,
    );
    this.name = 'UnguardedModelError';
  }
}

// A model compiled before this module loaded has no guard and never will, so a script's
// Development connection that carries one is refused rather than left writing unchecked.
export function assertDevelopmentWritesGuarded(
  connection: mongoose.Connection,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isRequestServingProcess() || devWriteLeaseSwitchedOff(env)) return;
  const databaseName = connection.db?.databaseName || connection.name;
  if (!databaseName) return;
  if (resolveDevWriteLeaseTarget({ databaseName, host: connection.host }).kind !== 'development') {
    return;
  }
  const unguarded = connection
    .modelNames()
    .filter((name) => !schemaHasDevWriteGuard(connection.model(name).schema));
  if (unguarded.length > 0) throw new UnguardedModelError(unguarded);
}

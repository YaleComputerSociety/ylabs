import mongoose from 'mongoose';

import {
  DEV_WRITE_LEASE_SWITCH_ENV,
  devHostLeasesArmed,
  devWriteLeaseSwitchedOff,
  holdsDevApplyLease,
  resolveDevWriteLeaseTarget,
} from './devWriteLease';

/**
 * Refuses a Mongoose model write to Development from a script process that holds no Development
 * write lease (#5871). Every model file imports this module before it compiles its model, so the
 * global plugin is part of every model. Raw driver handles skip Mongoose middleware;
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

/** A dry `scrape run` takes no lease by design (#5756) yet still records its run and fills the fetch cache. */
export const DEV_DRY_LANE_RUN_COLLECTIONS: ReadonlySet<string> = new Set([
  'scrape_runs',
  'scrape_snapshots',
]);

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

export function resetDevWriteGuardStateForTests() {
  leaseState = defaultLeaseState;
  delete processRoleHolder[PROCESS_ROLE];
}

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

const listed = (collections: ReadonlySet<string>) => [...collections].join(', ');

// Ordered so a request-serving process, a switched-off lease and any database other than
// Development all return before lease state is read.
export async function assertDevModelWriteAllowed(
  model: GuardedModel,
  operation: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isRequestServingProcess()) return;
  if (devWriteLeaseSwitchedOff(env)) return;
  const databaseName = await connectedDatabaseName(model.db);
  if (!databaseName) {
    throw refusal(
      model,
      operation,
      'the connection never opened, so this script could not tell whether it targets Development',
    );
  }
  const target = resolveDevWriteLeaseTarget({ databaseName, host: model.db.host });
  if (target.kind !== 'development') return;
  if (leaseState.holdsApplyLease()) return;
  const collectionName = model.collection.collectionName;
  if (DEV_WRITE_GUARD_EXEMPT_COLLECTIONS.has(collectionName)) return;
  if (leaseState.hostLeasesArmed()) {
    if (DEV_LANE_RUN_COLLECTIONS.has(collectionName)) return;
    throw refusal(
      model,
      operation,
      `a writing lane run may write only ${listed(DEV_LANE_RUN_COLLECTIONS)} without the apply lease`,
    );
  }
  if (isDryLaneRun()) {
    if (DEV_DRY_LANE_RUN_COLLECTIONS.has(collectionName)) return;
    throw refusal(
      model,
      operation,
      `a dry lane run may write only ${listed(DEV_DRY_LANE_RUN_COLLECTIONS)}`,
    );
  }
  throw refusal(
    model,
    operation,
    `this script process holds no Development write lease (${DEV_WRITE_LEASE_SWITCH_ENV}=off is for the test harness only)`,
  );
}

type GuardImplementation = typeof assertDevModelWriteAllowed;
type GuardImplementationHolder = { [GUARD_IMPLEMENTATION]?: GuardImplementation };

// The plugin registered first stays on mongoose for the life of the process, while a suite that
// resets its module registry evaluates this module again. Dispatching through the newest
// evaluation keeps the guard reading the lease module the rest of the process now uses.
(globalThis as GuardImplementationHolder)[GUARD_IMPLEMENTATION] = assertDevModelWriteAllowed;

const guard: GuardImplementation = (model, operation, env) =>
  (globalThis as GuardImplementationHolder)[GUARD_IMPLEMENTATION]!(model, operation, env);

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
    await guard(this.constructor as unknown as GuardedModel, 'save');
  });
  schema.pre('insertMany', async function guardDevInsertMany(this: GuardedModel) {
    await guard(this, 'insertMany');
  });
  schema.pre('bulkWrite', async function guardDevBulkWrite(this: GuardedModel) {
    await guard(this, 'bulkWrite');
  });
  schema.pre(
    QUERY_WRITE_OPERATIONS,
    { document: false, query: true },
    async function guardDevQueryWrite(this: GuardedQuery) {
      await guard(this.model as unknown as GuardedModel, this.op ?? 'write');
    },
  );
  schema.pre('aggregate', async function guardDevAggregateWrite(this: mongoose.Aggregate<unknown>) {
    if (!writesThroughPipeline(this.pipeline())) return;
    await guard(this.model() as unknown as GuardedModel, 'aggregate');
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

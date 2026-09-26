/**
 * MongoDB connection management and model initialization.
 */
import mongoose from 'mongoose';

// Shared across initializeConnections and triggerReconnect so both use identical options.
export const mongoOptions = {
  // Connecting must not be a schema-mutating act. `autoIndex` builds a model's
  // declared indexes on connect and `autoCreate` creates its collection, so with
  // both defaulted on a process that merely imports a model recreates the
  // collection it was deliberately dropped from, with no read, no write and no
  // materialize (#2233). Measured on a real server: `autoIndex: false` alone is
  // NOT enough, because the collection still reappears carrying its `_id_` index
  // - `autoCreate` is a separate default - and `autoIndex` on with `autoCreate`
  // off recreates it too, because building an index creates the namespace. Both
  // have to be off.
  //
  // This removes the self-healing where shipping a new `schema.index(...)` built
  // itself on the next connect, so two things replace it and neither is optional:
  // `yarn --cwd server db:build-indexes --apply` builds indexes deliberately and
  // additively, and `reportMissingMongoIndexes` below logs drift at boot so a
  // forgotten build is loud rather than a silent performance cliff.
  autoIndex: false,
  autoCreate: false,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 60000,
  // Close idle connections after 3.5 min so we beat the ~4-min AWS NAT TCP
  // idle timeout before the NAT silently kills them under us. startMongoKeepAlive
  // pings well inside this window so the live connection never hits the cap.
  maxIdleTimeMS: 210000,
  // minPoolSize keeps a warm connection while the process is running, but it
  // cannot survive the host pausing an idle instance (Render): a frozen process
  // runs no heartbeats, so the socket dies and the first request after wake sees
  // a lost topology. withMongoReconnect heals that path; keepAlive prevents the
  // idle-teardown path.
  minPoolSize: 1,
};

// Serialise reconnect attempts: if one is already in flight, later callers
// await the same promise rather than launching a second parallel reconnect.
let reconnectInFlight: Promise<void> | null = null;

/**
 * True when an error (or any error in its VError cause chain) indicates the
 * MongoDB topology was lost. Once client.topology goes null the driver cannot
 * self-recover; we must disconnect and reconnect explicitly.
 */
export function isTopologyLostError(error: unknown): boolean {
  const e = error as { name?: string; message?: string; cause?: unknown } | null | undefined;
  if (!e) return false;
  if (e.name === 'MongoNotConnectedError') return true;
  if (
    typeof e.message === 'string' &&
    e.message.includes('Client must be connected before running operations')
  ) {
    return true;
  }
  const cause = typeof (e as any).cause === 'function' ? (e as any).cause() : (e as any).cause;
  return isTopologyLostError(cause);
}

/**
 * Forces an explicit disconnect + reconnect when the topology is lost. Returns
 * the in-flight promise so callers can await recovery and retry their operation
 * (see withMongoReconnect) instead of surfacing the failure to the user.
 */
export function triggerReconnect(): Promise<void> {
  if (reconnectInFlight) return reconnectInFlight;
  reconnectInFlight = (async () => {
    try {
      const primaryUrl = process.env.MONGODBURL;
      if (!primaryUrl) return;

      console.error('MongoDB: topology lost — forcing reconnect');

      await mongoose.disconnect();
      await mongoose.connect(primaryUrl, mongoOptions);
      console.log('MongoDB: reconnected');
    } catch (err) {
      console.error('MongoDB: reconnect failed:', (err as Error)?.message ?? err);
    } finally {
      reconnectInFlight = null;
    }
  })();
  return reconnectInFlight;
}

/**
 * Runs a MongoDB operation and, if the topology was lost, awaits a reconnect
 * and retries once so a cold connection becomes a brief latency blip instead of
 * a user-visible failure. Only use for operations that are safe to retry.
 */
export async function withMongoReconnect<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTopologyLostError(error)) throw error;
    await triggerReconnect();
    return operation();
  }
}

let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Pings the primary connection on an interval inside maxIdleTimeMS so a
 * low-traffic instance never lets its live connection go idle-closed, and so a
 * silently dead socket is detected and healed before the next real request.
 */
export function startMongoKeepAlive(intervalMs = 120000): void {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    void (async () => {
      try {
        await mongoose.connection.db?.admin().ping();
      } catch (error) {
        if (isTopologyLostError(error)) {
          await triggerReconnect();
        } else {
          console.error('MongoDB: keepAlive ping failed:', (error as Error)?.message ?? error);
        }
      }
    })();
  }, intervalMs);
  keepAliveTimer.unref?.();
}

export interface MongoIndexDrift {
  model: string;
  collection: string;
  missingIndexNames: string[];
}

export interface UnbuildableIndexSpec {
  model: string;
  collection: string;
  indexName: string;
  reason: string;
}

/**
 * Why MongoDB will refuse a declared index spec outright, or null when it will
 * not. An unbuildable spec is a different class from a spec the corpus blocks: no
 * environment and no data repair can ever make it build, so it reads as permanent
 * index drift instead of as an error (#3081). Only rejections this repository has
 * actually hit are listed, because guessing at the server's validation rules would
 * refuse specs MongoDB accepts.
 */
export function unbuildableIndexSpecReason(options?: Record<string, unknown>): string | null {
  if (options?.sparse !== undefined && options?.partialFilterExpression !== undefined) {
    return 'cannot mix "partialFilterExpression" and "sparse" options';
  }
  return null;
}

export function reportUnbuildableDeclaredIndexSpecs(
  connection: mongoose.Connection = mongoose.connection,
): UnbuildableIndexSpec[] {
  const unbuildable: UnbuildableIndexSpec[] = [];
  for (const modelName of connection.modelNames()) {
    const model = connection.model(modelName);
    for (const [key, options] of model.schema.indexes()) {
      const reason = unbuildableIndexSpecReason(options as Record<string, unknown>);
      if (!reason) continue;
      unbuildable.push({
        model: modelName,
        collection: model.collection.name,
        indexName: declaredIndexName(
          key as Record<string, unknown>,
          options as Record<string, unknown>,
        ),
        reason,
      });
    }
  }
  return unbuildable;
}

/**
 * The name the MongoDB driver gives a declared index, so a declared spec can be
 * matched against a live one. Mongoose delegates naming to the driver unless the
 * spec sets `name`, and the driver joins each key and its direction, which is
 * also what makes a text index comparable (`{ title: 'text' }` becomes
 * `title_text` live, while its key document is rewritten to `_fts`/`_ftsx`).
 */
export function declaredIndexName(
  key: Record<string, unknown>,
  options?: Record<string, unknown>,
): string {
  const explicit = options?.name;
  if (typeof explicit === 'string' && explicit) return explicit;
  return Object.entries(key)
    .map(([path, direction]) => `${path}_${String(direction)}`)
    .join('_');
}

/**
 * Which declared indexes a live collection is missing, for every registered model
 * whose collection already exists. Reads only: a model whose collection is absent
 * is skipped rather than probed, because creating it is the behaviour
 * `autoCreate: false` exists to stop, and a report that recreated the namespace
 * would be the defect wearing a different hat.
 */
export async function reportMissingMongoIndexes(
  connection: mongoose.Connection = mongoose.connection,
): Promise<MongoIndexDrift[]> {
  const db = connection.db;
  if (!db) return [];
  const live = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
  );
  const drift: MongoIndexDrift[] = [];
  for (const modelName of connection.modelNames()) {
    const model = connection.model(modelName);
    const collection = model.collection.name;
    if (!live.has(collection)) continue;
    const declared = model.schema
      .indexes()
      .map(([key, options]) =>
        declaredIndexName(key as Record<string, unknown>, options as Record<string, unknown>),
      )
      .filter(Boolean);
    if (declared.length === 0) continue;
    const present = new Set((await db.collection(collection).indexes()).map((entry) => entry.name));
    const missingIndexNames = declared.filter((name) => !present.has(name));
    if (missingIndexNames.length > 0)
      drift.push({ model: modelName, collection, missingIndexNames });
  }
  return drift;
}

export async function logMissingMongoIndexes(
  connection: mongoose.Connection = mongoose.connection,
): Promise<MongoIndexDrift[]> {
  let drift: MongoIndexDrift[] = [];
  try {
    drift = await reportMissingMongoIndexes(connection);
  } catch (error) {
    console.error('MongoDB: index drift check failed:', (error as Error)?.message ?? error);
    return [];
  }
  if (drift.length === 0) return drift;
  const total = drift.reduce((sum, entry) => sum + entry.missingIndexNames.length, 0);
  console.error(
    `MongoDB: ${total} declared index(es) are missing across ${drift.length} collection(s). ` +
      'Indexes are no longer built on connect; run `yarn --cwd server db:build-indexes --apply`.',
  );
  for (const entry of drift) {
    console.error(`MongoDB: ${entry.collection} missing ${entry.missingIndexNames.join(', ')}`);
  }
  return drift;
}

export async function initializeConnections(): Promise<void> {
  // Surface connection lifecycle so Render logs show exactly when the driver
  // loses or regains the server — makes the next incident much easier to trace.
  mongoose.connection.on('disconnected', () => console.error('MongoDB: disconnected'));
  mongoose.connection.on('reconnected', () => console.log('MongoDB: reconnected'));
  mongoose.connection.on('error', (err: Error) =>
    console.error('MongoDB: error', err?.message ?? err),
  );

  const url = process.env.MONGODBURL;
  if (!url) {
    throw new Error('MONGODBURL is required');
  }
  await mongoose.connect(url, mongoOptions);
  console.log(`Connected to database 🚀`);
  // Deliberately non-fatal. An unbuilt index is a performance problem, and
  // refusing to boot on one would turn a slow query into an outage on the very
  // deploy that is meant to surface it.
  await logMissingMongoIndexes();
}

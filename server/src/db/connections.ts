/**
 * MongoDB connection management and model initialization.
 */
import mongoose from 'mongoose';

// `bufferTimeoutMS` is a Mongoose connection option the driver's own type does not
// declare, so the shape is spelled out here rather than inferred.
export type MongoConnectOptions = mongoose.ConnectOptions & { bufferTimeoutMS: number };

export const mongoOptions: MongoConnectOptions = {
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
  // Bounded on purpose, because the request path is the only consumer of these
  // and a student waiting on a database that is not answering is waiting for
  // nothing. Measured against a local server: a reachable database answers a
  // detail request in under 10 ms, while the driver's own 30 s selection default
  // turned an unreachable one into a 30 s wait and a 60 s socket default turned a
  // hung one into a 63 s wait, both ending in a generic error (#4188). 5 s is
  // generous for selecting a reachable replica set and short enough that a
  // retrying client learns the answer quickly; the 20 s socket ceiling is well
  // above the slowest request this server makes, a database-fallback search over
  // the whole corpus, and well under the hosting platform's own request timeout.
  // Scripts need the opposite trade-off and get it from scriptMongoConnectOptions.
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 20000,
  // Mongoose queues an operation issued while the connection is down and throws
  // after this long. The default is 10 s, which outlives the whole point of the
  // bound above. Kept non-zero rather than disabled so a reconnect in flight is
  // still waited out instead of failing every request during it.
  bufferTimeoutMS: 5000,
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

export type ScriptMongoConnectOptions = Omit<
  Partial<MongoConnectOptions>,
  'autoIndex' | 'autoCreate'
>;

export function scriptMongoConnectOptions(
  extra: ScriptMongoConnectOptions = {},
): MongoConnectOptions {
  return {
    ...mongoOptions,
    // A request-sized socket timeout suits the API, but an operator scan or a
    // materialize can wait longer than a minute for one batch, so entry points
    // keep the driver's no-timeout default. The serving process's fail-fast
    // selection and buffer bounds are wrong here for the same reason: a sweep that
    // starts while a replica set is electing should wait for it, not abort.
    socketTimeoutMS: 0,
    serverSelectionTimeoutMS: 30000,
    bufferTimeoutMS: 30000,
    ...extra,
    autoIndex: false,
    autoCreate: false,
  };
}

export function connectScriptMongo(
  url: string,
  extra?: ScriptMongoConnectOptions,
): Promise<typeof mongoose> {
  return mongoose.connect(url, scriptMongoConnectOptions(extra));
}

export function createScriptMongoConnection(
  url: string,
  extra?: ScriptMongoConnectOptions,
): Promise<mongoose.Connection> {
  return mongoose.createConnection(url, scriptMongoConnectOptions(extra)).asPromise();
}

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

const UNAVAILABLE_ERROR_NAMES = new Set([
  'MongooseServerSelectionError',
  'MongoServerSelectionError',
  'MongoNetworkTimeoutError',
  'MongoTimeoutError',
  'MongoClientClosedError',
]);

const BUFFERING_TIMEOUT_MESSAGE = 'buffering timed out';

/**
 * True when an error says the database could not be reached, rather than that the
 * request itself was wrong. Every arm is the same condition reported under a
 * different name: selection gave up, a socket timed out, the client was closed, or
 * the operation waited out Mongoose's buffer while the connection was down. The
 * caller owes such a request a 503 and a retry, never a 500 (#4188).
 */
export function isMongoUnavailableError(error: unknown): boolean {
  const e = error as { name?: string; message?: string; cause?: unknown } | null | undefined;
  if (!e) return false;
  if (isTopologyLostError(e)) return true;
  if (typeof e.name === 'string' && UNAVAILABLE_ERROR_NAMES.has(e.name)) return true;
  if (typeof e.message === 'string' && e.message.includes(BUFFERING_TIMEOUT_MESSAGE)) return true;
  const cause = typeof (e as any).cause === 'function' ? (e as any).cause() : (e as any).cause;
  return isMongoUnavailableError(cause);
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
      await mongoose.connect(primaryUrl, activeConnectOptions);
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

const MONGO_READY_STATE_DISCONNECTED = 0;
const MONGO_READY_STATE_UNINITIALIZED = 99;

function sharedConnectionNeedsReconnect(): boolean {
  const readyState = mongoose.connection.readyState as number;
  return (
    readyState === MONGO_READY_STATE_DISCONNECTED || readyState === MONGO_READY_STATE_UNINITIALIZED
  );
}

/**
 * One keep-alive pass over the primary connection: reconnects a connection that
 * is no longer established, and otherwise pings it so a silently dead socket is
 * detected and healed before the next real request.
 *
 * The reconnect arm is what makes the pass able to heal at all. A ping reaches
 * `connection.db`, which is undefined on a connection that was dropped or never
 * established, so optional chaining made the pass a silent no-op in exactly the
 * state that needs it and the process served errors until someone restarted it
 * (#4186).
 */
export async function mongoKeepAliveTick(): Promise<void> {
  try {
    if (sharedConnectionNeedsReconnect()) {
      await triggerReconnect();
      return;
    }
    await mongoose.connection.db?.admin().ping();
  } catch (error) {
    if (isTopologyLostError(error)) {
      await triggerReconnect();
    } else {
      console.error('MongoDB: keepAlive ping failed:', (error as Error)?.message ?? error);
    }
  }
}

/**
 * Runs mongoKeepAliveTick on an interval inside maxIdleTimeMS so a low-traffic
 * instance never lets its live connection go idle-closed.
 */
export function startMongoKeepAlive(intervalMs = 120000): void {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    void mongoKeepAliveTick();
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

let activeConnectOptions: MongoConnectOptions = mongoOptions;

// Defaults to the script budget because nearly every caller is an operator entry
// point; the serving process opts into mongoOptions explicitly. triggerReconnect
// reuses whatever budget connected, so a reconnect never swaps one for the other.
export async function initializeConnections(
  connectOptions: MongoConnectOptions = scriptMongoConnectOptions(),
): Promise<void> {
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
  activeConnectOptions = connectOptions;
  await mongoose.connect(url, connectOptions);
  console.log(`Connected to database 🚀`);
  // Deliberately non-fatal. An unbuilt index is a performance problem, and
  // refusing to boot on one would turn a slow query into an outage on the very
  // deploy that is meant to surface it.
  await logMissingMongoIndexes();
}

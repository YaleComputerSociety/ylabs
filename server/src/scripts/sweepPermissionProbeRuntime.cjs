// Shipped verbatim as a Render one-off job's start command by `yarn ops:sweep probe-permissions`,
// so it may only use Node builtins and the image's own mongodb driver. Every probe is a no-match
// read or write, or an insert or index build inside a transaction that is always aborted.

const PROBE_DENIAL_PATTERN = /not allowed|not authorized|unauthorized/i;
const PROBE_UNAUTHORIZED_CODE = 13;
const PROBE_AUTHORIZED_ERROR_CODES = new Set([26, 121]);
const PROBE_EXIT_UNEXPECTED = 3;
const PROBE_EXIT_WRONG_USER = 4;

function classifyProbeError(error) {
  const message = String((error && error.message) || error);
  if ((error && error.code === PROBE_UNAUTHORIZED_CODE) || PROBE_DENIAL_PATTERN.test(message)) {
    return { outcome: 'denied', detail: message };
  }
  if (error && PROBE_AUTHORIZED_ERROR_CODES.has(error.code)) {
    return { outcome: 'allowed', detail: message };
  }
  return { outcome: 'error', detail: message };
}

async function inAbortedTransaction(client, work) {
  const session = client.startSession();
  try {
    session.startTransaction();
    try {
      await work(session);
    } finally {
      await session.abortTransaction().catch(() => undefined);
    }
  } finally {
    await session.endSession();
  }
}

async function runProbeCheck(client, ObjectId, check) {
  const db = client.db(check.db);
  const collection = check.collection ? db.collection(check.collection) : null;
  const noMatch = { _id: new ObjectId() };
  switch (check.action) {
    case 'find':
      await collection.findOne(noMatch);
      return;
    case 'insert':
      await inAbortedTransaction(client, (session) =>
        collection.insertOne({ _id: new ObjectId(), opsSweepPermissionProbe: true }, { session }),
      );
      return;
    case 'update':
      await collection.updateOne(noMatch, { $set: { opsSweepPermissionProbe: true } }, { upsert: false });
      return;
    case 'remove':
      await collection.deleteOne(noMatch);
      return;
    case 'listCollections':
      await db.listCollections({ name: '__ops_sweep_no_such_collection' }).toArray();
      return;
    case 'listIndexes':
      await collection.indexes();
      return;
    case 'dbStats':
      await db.command({ dbStats: 1 });
      return;
    case 'listDatabases':
      await client.db('admin').command({ listDatabases: 1, nameOnly: true });
      return;
    case 'createIndex':
      await inAbortedTransaction(client, (session) =>
        collection.createIndex({ opsSweepPermissionProbe: 1 }, { session }),
      );
      return;
    case 'drop':
      await collection.drop();
      return;
    default:
      throw new Error(`unknown probe action ${check.action}`);
  }
}

async function runPermissionProbe(client, ObjectId, plan) {
  const status = await client.db('admin').command({ connectionStatus: 1 });
  const users = ((status.authInfo && status.authInfo.authenticatedUsers) || []).map((u) => u.user);
  if (!users.includes(plan.expectedUser)) {
    return { exitCode: PROBE_EXIT_WRONG_USER, users, results: [], unexpected: [] };
  }
  const results = [];
  for (const check of plan.checks) {
    let classified;
    try {
      await runProbeCheck(client, ObjectId, check);
      classified = { outcome: 'allowed', detail: '' };
    } catch (error) {
      classified = classifyProbeError(error);
    }
    results.push({ ...check, outcome: classified.outcome, detail: classified.detail, ok: classified.outcome === check.expect });
  }
  const unexpected = results.filter((result) => !result.ok);
  return { exitCode: unexpected.length > 0 ? PROBE_EXIT_UNEXPECTED : 0, users, results, unexpected };
}

function runPermissionProbeJob(plan) {
  const { MongoClient, ObjectId } = require('/app/server/node_modules/mongodb');
  const client = new MongoClient(process.env.MONGODBURL);
  return client
    .connect()
    .then(() => runPermissionProbe(client, ObjectId, plan))
    .then((report) => {
      for (const result of report.results) {
        console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.action} ${result.db}.${result.collection || ''} expected ${result.expect}, got ${result.outcome}${result.ok ? '' : `: ${result.detail}`}`);
      }
      console.log(`PERMISSION_PROBE_RESULT ${JSON.stringify({ exitCode: report.exitCode, users: report.users, checks: report.results.length, unexpected: report.unexpected.length })}`);
      process.exitCode = report.exitCode;
    })
    .catch((error) => {
      console.error(`PERMISSION_PROBE_ERROR ${String((error && error.message) || error)}`);
      process.exitCode = 1;
    })
    .finally(() => client.close());
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyProbeError, runPermissionProbe, runProbeCheck, PROBE_EXIT_UNEXPECTED, PROBE_EXIT_WRONG_USER };
}

import { createHash } from 'node:crypto';

export const MODEL_INVENTORY_RECOVERY_MANIFEST_VERSION = 1;

const PLACEHOLDER_PATTERN =
  /[<>]|\b(?:change[-_ ]?me|placeholder|replace[-_ ]?me|todo|tbd)\b|your[-_]/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

function objectValue(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(value, required, optional, label) {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${label}.${key} is required.`);
    }
  }
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new Error(`${label}.${key} is not allowed.`);
    }
  }
}

function stringValue(value, label, { pattern, minimumLength = 1 } = {}) {
  if (typeof value !== 'string' || value.trim().length < minimumLength) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (PLACEHOLDER_PATTERN.test(normalized)) {
    throw new Error(`${label} contains a placeholder.`);
  }
  if (pattern && !pattern.test(normalized)) {
    throw new Error(`${label} has an invalid format.`);
  }
  return normalized;
}

function timestampValue(value, label) {
  const normalized = stringValue(value, label);
  const milliseconds = Date.parse(normalized);
  if (
    !Number.isFinite(milliseconds) ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
  ) {
    throw new Error(`${label} must be an ISO-8601 timestamp.`);
  }
  return { normalized, milliseconds };
}

function privateReference(value, label) {
  const normalized = stringValue(value, label, { minimumLength: 8 });
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} must be an opaque protected-storage URI.`);
  }
  if (['http:', 'https:', 'file:'].includes(parsed.protocol)) {
    throw new Error(`${label} must not be a public web URL or local file URI.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not contain credentials, query parameters, or fragments.`);
  }
  return normalized;
}

function storageContract(value, label) {
  const object = objectValue(value, label);
  assertExactKeys(object, ['artifactReference', 'objectVersion', 'storageClass'], [], label);
  const storageClass = stringValue(object.storageClass, `${label}.storageClass`);
  if (storageClass !== 'versioned' && storageClass !== 'write-once') {
    throw new Error(`${label}.storageClass must be versioned or write-once.`);
  }
  return {
    artifactReference: privateReference(object.artifactReference, `${label}.artifactReference`),
    objectVersion: stringValue(object.objectVersion, `${label}.objectVersion`, {
      minimumLength: 4,
    }),
    storageClass,
  };
}

function inventoryHasIdentifierSamples(value) {
  if (Array.isArray(value)) {
    return value.some(inventoryHasIdentifierSamples);
  }
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'sampleOrphanIds' && Array.isArray(nested) && nested.length > 0) {
      return true;
    }
    if (inventoryHasIdentifierSamples(nested)) return true;
  }
  return false;
}

export function sha256AndBytes(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.byteLength,
  };
}

export function validateModelInventoryRecoveryManifest(manifestValue, inventoryBuffer) {
  const manifest = objectValue(manifestValue, 'manifest');
  assertExactKeys(
    manifest,
    [
      'schemaVersion',
      'issue',
      'environment',
      'databaseName',
      'credentialFreeTarget',
      'sourceCommit',
      'captureWindow',
      'recoveryArtifact',
      'inventory',
      'rollback',
      'review',
    ],
    ['restoreVerification'],
    'manifest',
  );
  if (manifest.schemaVersion !== MODEL_INVENTORY_RECOVERY_MANIFEST_VERSION) {
    throw new Error(`manifest.schemaVersion must be ${MODEL_INVENTORY_RECOVERY_MANIFEST_VERSION}.`);
  }
  if (manifest.issue !== 204) {
    throw new Error('manifest.issue must be 204.');
  }

  const environment = stringValue(manifest.environment, 'manifest.environment');
  if (environment !== 'beta' && environment !== 'production-copy') {
    throw new Error('manifest.environment must be beta or production-copy.');
  }
  const expectedDatabase = environment === 'beta' ? 'Beta' : 'ProductionCopy';
  if (manifest.databaseName !== expectedDatabase) {
    throw new Error(`manifest.databaseName must be ${expectedDatabase}.`);
  }
  const credentialFreeTarget = stringValue(
    manifest.credentialFreeTarget,
    'manifest.credentialFreeTarget',
  );
  if (
    credentialFreeTarget.includes('@') ||
    credentialFreeTarget.includes('?') ||
    credentialFreeTarget.includes('#') ||
    !credentialFreeTarget.endsWith(`/${expectedDatabase}`)
  ) {
    throw new Error('manifest.credentialFreeTarget must be a credential-free host/database label.');
  }
  const sourceCommit = stringValue(manifest.sourceCommit, 'manifest.sourceCommit', {
    pattern: COMMIT_PATTERN,
  });

  const captureWindow = objectValue(manifest.captureWindow, 'manifest.captureWindow');
  assertExactKeys(
    captureWindow,
    ['startedAt', 'completedAt', 'writePosture'],
    [],
    'manifest.captureWindow',
  );
  const captureStarted = timestampValue(
    captureWindow.startedAt,
    'manifest.captureWindow.startedAt',
  );
  const captureCompleted = timestampValue(
    captureWindow.completedAt,
    'manifest.captureWindow.completedAt',
  );
  if (captureCompleted.milliseconds < captureStarted.milliseconds) {
    throw new Error('manifest.captureWindow.completedAt must not precede startedAt.');
  }
  const writePosture = stringValue(
    captureWindow.writePosture,
    'manifest.captureWindow.writePosture',
  );
  const allowedPostures =
    environment === 'production-copy'
      ? ['immutable-restored-copy']
      : ['immutable-restored-copy', 'quiescent'];
  if (!allowedPostures.includes(writePosture)) {
    throw new Error(`manifest.captureWindow.writePosture must be ${allowedPostures.join(' or ')}.`);
  }

  const recovery = objectValue(manifest.recoveryArtifact, 'manifest.recoveryArtifact');
  assertExactKeys(
    recovery,
    [
      'provider',
      'artifactId',
      'createdAt',
      'verifiedAt',
      'retentionExpiresAt',
      'owner',
      'procedureReference',
      'storage',
    ],
    [],
    'manifest.recoveryArtifact',
  );
  if (stringValue(recovery.provider, 'manifest.recoveryArtifact.provider') !== 'mongodb-atlas') {
    throw new Error('manifest.recoveryArtifact.provider must be mongodb-atlas.');
  }
  stringValue(recovery.artifactId, 'manifest.recoveryArtifact.artifactId', {
    minimumLength: 8,
  });
  const recoveryCreated = timestampValue(recovery.createdAt, 'manifest.recoveryArtifact.createdAt');
  const recoveryVerified = timestampValue(
    recovery.verifiedAt,
    'manifest.recoveryArtifact.verifiedAt',
  );
  const retentionExpires = timestampValue(
    recovery.retentionExpiresAt,
    'manifest.recoveryArtifact.retentionExpiresAt',
  );
  if (recoveryVerified.milliseconds < recoveryCreated.milliseconds) {
    throw new Error('Recovery verification must not precede recovery artifact creation.');
  }
  if (
    recoveryCreated.milliseconds > captureStarted.milliseconds ||
    recoveryVerified.milliseconds > captureStarted.milliseconds
  ) {
    throw new Error(
      'Recovery artifact creation and verification must complete before the capture window starts.',
    );
  }
  if (retentionExpires.milliseconds <= recoveryVerified.milliseconds) {
    throw new Error('Recovery retention must extend beyond verification.');
  }
  const recoveryOwner = stringValue(recovery.owner, 'manifest.recoveryArtifact.owner', {
    minimumLength: 3,
  });
  privateReference(recovery.procedureReference, 'manifest.recoveryArtifact.procedureReference');
  storageContract(recovery.storage, 'manifest.recoveryArtifact.storage');

  if (environment === 'production-copy') {
    const restore = objectValue(manifest.restoreVerification, 'manifest.restoreVerification');
    assertExactKeys(
      restore,
      [
        'sourceEnvironment',
        'sourceDatabaseName',
        'targetDatabaseName',
        'completedAt',
        'verifiedBy',
      ],
      [],
      'manifest.restoreVerification',
    );
    if (
      restore.sourceEnvironment !== 'production' ||
      restore.sourceDatabaseName !== 'Production' ||
      restore.targetDatabaseName !== 'ProductionCopy'
    ) {
      throw new Error(
        'ProductionCopy restore verification must bind Production to ProductionCopy.',
      );
    }
    const restoreCompleted = timestampValue(
      restore.completedAt,
      'manifest.restoreVerification.completedAt',
    );
    if (restoreCompleted.milliseconds > captureStarted.milliseconds) {
      throw new Error('ProductionCopy restore must complete before the capture window starts.');
    }
    stringValue(restore.verifiedBy, 'manifest.restoreVerification.verifiedBy', {
      minimumLength: 3,
    });
  } else if (manifest.restoreVerification !== undefined) {
    throw new Error('manifest.restoreVerification is only valid for production-copy evidence.');
  }

  const inventory = objectValue(manifest.inventory, 'manifest.inventory');
  assertExactKeys(
    inventory,
    ['generatedAt', 'sha256', 'bytes', 'sampleLimit', 'storage'],
    [],
    'manifest.inventory',
  );
  const inventoryGenerated = timestampValue(
    inventory.generatedAt,
    'manifest.inventory.generatedAt',
  );
  if (
    inventoryGenerated.milliseconds < captureStarted.milliseconds ||
    inventoryGenerated.milliseconds > captureCompleted.milliseconds
  ) {
    throw new Error('Inventory generation must fall inside the capture window.');
  }
  const inventorySha256 = stringValue(inventory.sha256, 'manifest.inventory.sha256', {
    pattern: SHA256_PATTERN,
  });
  if (!Number.isSafeInteger(inventory.bytes) || inventory.bytes <= 0) {
    throw new Error('manifest.inventory.bytes must be a positive safe integer.');
  }
  if (inventory.sampleLimit !== 0) {
    throw new Error('manifest.inventory.sampleLimit must be 0.');
  }
  storageContract(inventory.storage, 'manifest.inventory.storage');

  const rollback = objectValue(manifest.rollback, 'manifest.rollback');
  assertExactKeys(
    rollback,
    ['owner', 'trigger', 'procedureReference', 'drillVerifiedAt'],
    [],
    'manifest.rollback',
  );
  const rollbackOwner = stringValue(rollback.owner, 'manifest.rollback.owner', {
    minimumLength: 3,
  });
  stringValue(rollback.trigger, 'manifest.rollback.trigger', { minimumLength: 8 });
  privateReference(rollback.procedureReference, 'manifest.rollback.procedureReference');
  const rollbackDrillVerified = timestampValue(
    rollback.drillVerifiedAt,
    'manifest.rollback.drillVerifiedAt',
  );

  const review = objectValue(manifest.review, 'manifest.review');
  assertExactKeys(review, ['acceptedBy', 'acceptedAt'], [], 'manifest.review');
  const acceptedBy = stringValue(review.acceptedBy, 'manifest.review.acceptedBy', {
    minimumLength: 3,
  });
  const acceptedAt = timestampValue(review.acceptedAt, 'manifest.review.acceptedAt');
  if (acceptedAt.milliseconds < captureCompleted.milliseconds) {
    throw new Error('Independent review must follow inventory capture completion.');
  }
  if (rollbackDrillVerified.milliseconds > acceptedAt.milliseconds) {
    throw new Error('Rollback drill verification must not follow independent review.');
  }
  if (
    acceptedBy.toLowerCase() === recoveryOwner.toLowerCase() ||
    acceptedBy.toLowerCase() === rollbackOwner.toLowerCase()
  ) {
    throw new Error(
      'Independent review must be accepted by someone other than the recovery and rollback owners.',
    );
  }
  if (retentionExpires.milliseconds <= acceptedAt.milliseconds) {
    throw new Error('Recovery retention must extend beyond independent review.');
  }

  const inventoryDigest = sha256AndBytes(inventoryBuffer);
  if (inventoryDigest.sha256 !== inventorySha256 || inventoryDigest.bytes !== inventory.bytes) {
    throw new Error('The inventory file does not match its manifest SHA-256 and byte count.');
  }

  let inventoryReport;
  try {
    inventoryReport = JSON.parse(inventoryBuffer.toString('utf8'));
  } catch {
    throw new Error('The inventory artifact must contain valid JSON.');
  }
  const report = objectValue(inventoryReport, 'inventory report');
  if (
    report.environment !== environment ||
    report.db !== expectedDatabase ||
    report.target !== credentialFreeTarget ||
    report.sourceCommit !== sourceCommit ||
    report.generatedAt !== inventoryGenerated.normalized
  ) {
    throw new Error(
      'The inventory report environment, database, target, source commit, or generation time does not match the manifest.',
    );
  }
  if (
    !report.options ||
    report.options.environment !== environment ||
    report.options.sampleLimit !== 0
  ) {
    throw new Error(
      'The inventory report must preserve the matching environment and sampleLimit 0.',
    );
  }
  if (inventoryHasIdentifierSamples(report)) {
    throw new Error(
      'The inventory report contains identifier samples and cannot be exit evidence.',
    );
  }

  return {
    schemaVersion: MODEL_INVENTORY_RECOVERY_MANIFEST_VERSION,
    status: 'valid',
    issue: 204,
    environment,
    databaseName: expectedDatabase,
    sourceCommit,
    inventory: inventoryDigest,
  };
}

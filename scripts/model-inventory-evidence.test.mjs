import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  sha256AndBytes,
  validateModelInventoryRecoveryManifest,
} from './model-inventory-evidence-core.mjs';
import { validateEvidenceFiles } from './validate-model-inventory-evidence.mjs';

const GENERATED_AT = '2026-07-28T02:05:00.000Z';
const SOURCE_COMMIT = 'b'.repeat(40);

function inventoryReport(environment = 'beta') {
  const databaseName = environment === 'beta' ? 'Beta' : 'ProductionCopy';
  return {
    generatedAt: GENERATED_AT,
    environment,
    db: databaseName,
    target: `cluster.mongodb.net/${databaseName}`,
    sourceCommit: SOURCE_COMMIT,
    summary: { totalDocuments: 2 },
    collections: [],
    retirementFields: [],
    referenceIntegrity: [{ sampleOrphanIds: [] }],
    options: {
      environment,
      sampleLimit: 0,
      output: `/tmp/${environment}-inventory.json`,
    },
  };
}

function manifestFor(inventoryBuffer, environment = 'beta') {
  const databaseName = environment === 'beta' ? 'Beta' : 'ProductionCopy';
  const digest = sha256AndBytes(inventoryBuffer);
  const manifest = {
    schemaVersion: 1,
    issue: 204,
    environment,
    databaseName,
    credentialFreeTarget: `cluster.mongodb.net/${databaseName}`,
    sourceCommit: SOURCE_COMMIT,
    captureWindow: {
      startedAt: '2026-07-28T02:00:00.000Z',
      completedAt: '2026-07-28T02:10:00.000Z',
      writePosture: environment === 'production-copy' ? 'immutable-restored-copy' : 'quiescent',
    },
    recoveryArtifact: {
      provider: 'mongodb-atlas',
      artifactId: 'atlas-snapshot-1234',
      createdAt: '2026-07-28T01:00:00.000Z',
      verifiedAt: '2026-07-28T01:30:00.000Z',
      retentionExpiresAt: '2026-12-31T00:00:00.000Z',
      owner: 'data operations',
      procedureReference: 'private-runbook://mongo/restore-v1',
      storage: {
        artifactReference: 'private-store://phase0/recovery',
        objectVersion: 'version-0001',
        storageClass: 'write-once',
      },
    },
    inventory: {
      generatedAt: GENERATED_AT,
      sha256: digest.sha256,
      bytes: digest.bytes,
      sampleLimit: 0,
      storage: {
        artifactReference: `private-store://phase0/${environment}-inventory`,
        objectVersion: 'version-0001',
        storageClass: 'versioned',
      },
    },
    rollback: {
      owner: 'data operations',
      trigger: 'Any parity or integrity regression after a model migration.',
      procedureReference: 'private-runbook://mongo/rollback-v1',
      drillVerifiedAt: '2026-07-27T20:00:00.000Z',
    },
    review: {
      acceptedBy: 'independent reviewer',
      acceptedAt: '2026-07-28T03:00:00.000Z',
    },
  };
  if (environment === 'production-copy') {
    manifest.restoreVerification = {
      sourceEnvironment: 'production',
      sourceDatabaseName: 'Production',
      targetDatabaseName: 'ProductionCopy',
      completedAt: '2026-07-28T01:45:00.000Z',
      verifiedBy: 'restore reviewer',
    };
  }
  return manifest;
}

test('validates Beta evidence bound to the exact aggregate-only inventory bytes', () => {
  const inventoryBuffer = Buffer.from(`${JSON.stringify(inventoryReport(), null, 2)}\n`);
  assert.deepEqual(
    validateModelInventoryRecoveryManifest(manifestFor(inventoryBuffer), inventoryBuffer),
    {
      schemaVersion: 1,
      status: 'valid',
      issue: 204,
      environment: 'beta',
      databaseName: 'Beta',
      sourceCommit: SOURCE_COMMIT,
      inventory: sha256AndBytes(inventoryBuffer),
    },
  );
});

test('requires Production-to-ProductionCopy restore completion before capture', () => {
  const inventoryBuffer = Buffer.from(
    `${JSON.stringify(inventoryReport('production-copy'), null, 2)}\n`,
  );
  const valid = manifestFor(inventoryBuffer, 'production-copy');
  assert.equal(
    validateModelInventoryRecoveryManifest(valid, inventoryBuffer).environment,
    'production-copy',
  );
  const missing = structuredClone(valid);
  delete missing.restoreVerification;
  assert.throws(
    () => validateModelInventoryRecoveryManifest(missing, inventoryBuffer),
    /restoreVerification/,
  );
  const late = structuredClone(valid);
  late.restoreVerification.completedAt = '2026-07-28T02:01:00.000Z';
  assert.throws(
    () => validateModelInventoryRecoveryManifest(late, inventoryBuffer),
    /before the capture window/,
  );
});

test('rejects digest drift, nonzero sample limits, and identifier samples', () => {
  const inventoryBuffer = Buffer.from(`${JSON.stringify(inventoryReport(), null, 2)}\n`);
  const wrongDigest = manifestFor(inventoryBuffer);
  wrongDigest.inventory.sha256 = 'c'.repeat(64);
  assert.throws(
    () => validateModelInventoryRecoveryManifest(wrongDigest, inventoryBuffer),
    /SHA-256 and byte count/,
  );

  const nonzero = manifestFor(inventoryBuffer);
  nonzero.inventory.sampleLimit = 20;
  assert.throws(
    () => validateModelInventoryRecoveryManifest(nonzero, inventoryBuffer),
    /sampleLimit must be 0/,
  );

  const reportWithSample = inventoryReport();
  reportWithSample.referenceIntegrity[0].sampleOrphanIds = ['private-id'];
  const sampledBuffer = Buffer.from(`${JSON.stringify(reportWithSample, null, 2)}\n`);
  assert.throws(
    () => validateModelInventoryRecoveryManifest(manifestFor(sampledBuffer), sampledBuffer),
    /identifier samples/,
  );
});

test('binds recovery and rollback verification to the capture and review timeline', () => {
  const inventoryBuffer = Buffer.from(`${JSON.stringify(inventoryReport(), null, 2)}\n`);
  const lateRecovery = manifestFor(inventoryBuffer);
  lateRecovery.recoveryArtifact.verifiedAt = '2026-07-28T02:01:00.000Z';
  assert.throws(
    () => validateModelInventoryRecoveryManifest(lateRecovery, inventoryBuffer),
    /before the capture window starts/,
  );

  const lateRollbackDrill = manifestFor(inventoryBuffer);
  lateRollbackDrill.rollback.drillVerifiedAt = '2026-07-28T03:01:00.000Z';
  assert.throws(
    () => validateModelInventoryRecoveryManifest(lateRollbackDrill, inventoryBuffer),
    /must not follow independent review/,
  );

  const selfReviewed = manifestFor(inventoryBuffer);
  selfReviewed.review.acceptedBy = selfReviewed.recoveryArtifact.owner;
  assert.throws(
    () => validateModelInventoryRecoveryManifest(selfReviewed, inventoryBuffer),
    /someone other than the recovery and rollback owners/,
  );
});

test('writes a mode-0600 validation receipt once and refuses overwrite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-inventory-evidence-'));
  const inventoryPath = path.join(directory, 'inventory.json');
  const manifestPath = path.join(directory, 'manifest.json');
  const receiptPath = path.join(directory, 'receipt.json');
  const inventoryBuffer = Buffer.from(`${JSON.stringify(inventoryReport(), null, 2)}\n`);
  fs.writeFileSync(inventoryPath, inventoryBuffer, { mode: 0o600 });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifestFor(inventoryBuffer), null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(inventoryPath, 0o600);
  fs.chmodSync(manifestPath, 0o600);
  try {
    const receipt = validateEvidenceFiles({
      manifest: manifestPath,
      inventory: inventoryPath,
      receiptOutput: receiptPath,
    });
    assert.equal(receipt.status, 'valid');
    assert.equal(fs.statSync(receiptPath).mode & 0o777, 0o600);
    assert.throws(
      () =>
        validateEvidenceFiles({
          manifest: manifestPath,
          inventory: inventoryPath,
          receiptOutput: receiptPath,
        }),
      /will not be overwritten/,
    );
    fs.chmodSync(manifestPath, 0o644);
    assert.throws(
      () =>
        validateEvidenceFiles({
          manifest: manifestPath,
          inventory: inventoryPath,
        }),
      /mode 0600/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

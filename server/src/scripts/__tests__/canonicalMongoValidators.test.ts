import { describe, expect, it, vi } from 'vitest';
import {
  assertCanonicalMongoValidatorApplyAllowed,
  CanonicalMongoValidatorApplyError,
  CanonicalMongoValidatorVerificationError,
  parseCanonicalMongoValidatorArgs,
  runCanonicalMongoValidators,
  type CanonicalMongoValidatorArgs,
  type CanonicalMongoValidatorReport,
  type ValidatorMongoClient,
} from '../canonicalMongoValidators';
import {
  CANONICAL_MONGO_VALIDATORS,
  CANONICAL_MONGO_VALIDATOR_COLLECTIONS,
} from '../canonicalMongoValidatorRegistry';

interface FakeCollectionInfo {
  name: string;
  type?: string;
  options?: {
    validator?: unknown;
    validationLevel?: unknown;
    validationAction?: unknown;
    timeseries?: unknown;
  };
}

interface FakeMongoHarness {
  client: ValidatorMongoClient;
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  listCollections: ReturnType<typeof vi.fn>;
  collectionInfos: FakeCollectionInfo[];
}

const developmentArgs: CanonicalMongoValidatorArgs = {
  environment: 'development',
  apply: false,
};

function cloneInfo(info: FakeCollectionInfo): FakeCollectionInfo {
  return structuredClone(info);
}

function desiredCollectionInfo(collectionName: string): FakeCollectionInfo {
  const desired = CANONICAL_MONGO_VALIDATORS.find(
    (candidate) => candidate.collectionName === collectionName,
  );
  if (!desired) {
    throw new Error(`Missing desired validator fixture for ${collectionName}`);
  }

  return {
    name: collectionName,
    type: 'collection',
    options: {
      validator: structuredClone(desired.validator),
      validationLevel: desired.validationLevel,
      validationAction: desired.validationAction,
    },
  };
}

function fakeMongoHarness(
  args: {
    databaseName?: string;
    collectionInfos?: FakeCollectionInfo[];
    listError?: Error;
    listFailureCall?: number;
    commandFailure?: (command: Record<string, unknown>, callIndex: number) => boolean;
    closeError?: Error;
  } = {},
): FakeMongoHarness {
  const collectionInfos = (args.collectionInfos ?? []).map(cloneInfo);
  const connect = vi.fn(async () => undefined);
  const close = vi.fn(async () => {
    if (args.closeError) throw args.closeError;
  });
  let listReadCall = 0;
  const listCollections = vi.fn(() => ({
    toArray: vi.fn(async () => {
      const callIndex = listReadCall;
      listReadCall += 1;
      if (
        args.listError &&
        (args.listFailureCall === undefined || args.listFailureCall === callIndex)
      ) {
        throw args.listError;
      }
      return collectionInfos.map(cloneInfo);
    }),
  }));
  let commandCallIndex = 0;
  const command = vi.fn(async (mongoCommand: Record<string, unknown>) => {
    const callIndex = commandCallIndex;
    commandCallIndex += 1;
    if (args.commandFailure?.(mongoCommand, callIndex)) {
      throw new Error('injected MongoDB command failure');
    }

    const create = typeof mongoCommand.create === 'string' ? mongoCommand.create : undefined;
    const collMod = typeof mongoCommand.collMod === 'string' ? mongoCommand.collMod : undefined;
    const collectionName = create ?? collMod;
    if (!collectionName) {
      throw new Error(`Unexpected MongoDB command: ${JSON.stringify(mongoCommand)}`);
    }

    const replacement: FakeCollectionInfo = {
      name: collectionName,
      type: 'collection',
      options: {
        validator: structuredClone(mongoCommand.validator),
        validationLevel: mongoCommand.validationLevel,
        validationAction: mongoCommand.validationAction,
      },
    };
    const existingIndex = collectionInfos.findIndex((info) => info.name === collectionName);
    if (existingIndex === -1) {
      collectionInfos.push(replacement);
    } else {
      collectionInfos[existingIndex] = replacement;
    }
    return { ok: 1 };
  });
  const client: ValidatorMongoClient = {
    connect,
    db: () => ({
      databaseName: args.databaseName ?? 'development',
      listCollections,
      command,
    }),
    close,
  };

  return {
    client,
    connect,
    close,
    command,
    listCollections,
    collectionInfos,
  };
}

function applyArgs(
  environment: CanonicalMongoValidatorArgs['environment'] = 'development',
): CanonicalMongoValidatorArgs {
  return {
    environment,
    apply: true,
    confirmEnvironment: environment,
    applyFrom: '/tmp/canonical-validator-dry-run.json',
  };
}

async function reviewedDryRun(
  harness: FakeMongoHarness,
  mongoUrl = 'mongodb://localhost/development',
): Promise<CanonicalMongoValidatorReport> {
  return runCanonicalMongoValidators(developmentArgs, mongoUrl, {
    client: harness.client,
  });
}

describe('canonical MongoDB validator CLI arguments', () => {
  it('requires an explicit supported environment', () => {
    expect(() => parseCanonicalMongoValidatorArgs([])).toThrow('--environment is required');
    expect(() => parseCanonicalMongoValidatorArgs(['--environment', 'staging'])).toThrow(
      'requires development, beta, production-copy, production, or test',
    );
    expect(parseCanonicalMongoValidatorArgs(['--environment=beta'])).toEqual({
      environment: 'beta',
      apply: false,
    });
  });

  it('parses apply review and confirmation flags in both accepted forms', () => {
    expect(
      parseCanonicalMongoValidatorArgs([
        '--environment',
        'beta',
        '--apply',
        '--confirm-canonical-validator-apply=beta',
        '--apply-from',
        '/tmp/reviewed.json',
        '--output=/tmp/applied.json',
      ]),
    ).toEqual({
      environment: 'beta',
      apply: true,
      confirmEnvironment: 'beta',
      applyFrom: '/tmp/reviewed.json',
      output: '/tmp/applied.json',
    });
  });

  it('binds apply confirmation to the selected environment and reviewed artifact', () => {
    expect(() =>
      assertCanonicalMongoValidatorApplyAllowed({
        environment: 'beta',
        apply: true,
        confirmEnvironment: 'development',
        applyFrom: '/tmp/reviewed.json',
      }),
    ).toThrow('must match --environment beta');

    expect(() =>
      assertCanonicalMongoValidatorApplyAllowed({
        environment: 'beta',
        apply: true,
        confirmEnvironment: 'beta',
      }),
    ).toThrow('--apply-from is required');

    expect(() =>
      assertCanonicalMongoValidatorApplyAllowed({
        environment: 'beta',
        apply: false,
        confirmEnvironment: 'beta',
      }),
    ).toThrow('require --apply');
  });

  it('requires an additional production-only environment confirmation', () => {
    const args = applyArgs('production');
    expect(() => assertCanonicalMongoValidatorApplyAllowed(args, {})).toThrow(
      'CONFIRM_PROD_MONGO_VALIDATORS=true',
    );
    expect(() =>
      assertCanonicalMongoValidatorApplyAllowed(args, {
        CONFIRM_PROD_MONGO_VALIDATORS: 'true',
      }),
    ).not.toThrow();
  });
});

describe('runCanonicalMongoValidators', () => {
  it('rejects a missing or mismatched configured database before connecting', async () => {
    const missingDatabase = fakeMongoHarness();
    await expect(
      runCanonicalMongoValidators(developmentArgs, 'mongodb://localhost', {
        client: missingDatabase.client,
      }),
    ).rejects.toThrow('MONGODBURL must include an explicit database name');
    expect(missingDatabase.connect).not.toHaveBeenCalled();
    expect(missingDatabase.close).not.toHaveBeenCalled();

    const invalidProtocol = fakeMongoHarness();
    await expect(
      runCanonicalMongoValidators(developmentArgs, 'https://localhost/development', {
        client: invalidProtocol.client,
      }),
    ).rejects.toThrow('must use the mongodb or mongodb+srv protocol');
    expect(invalidProtocol.connect).not.toHaveBeenCalled();
    expect(invalidProtocol.close).not.toHaveBeenCalled();

    const mismatchedDatabase = fakeMongoHarness();
    await expect(
      runCanonicalMongoValidators(developmentArgs, 'mongodb://localhost/beta', {
        client: mismatchedDatabase.client,
      }),
    ).rejects.toThrow('environment development does not match MongoDB database beta');
    expect(mismatchedDatabase.connect).not.toHaveBeenCalled();
    expect(mismatchedDatabase.close).not.toHaveBeenCalled();
  });

  it('rejects a mismatched connected database and closes the client', async () => {
    const harness = fakeMongoHarness({ databaseName: 'beta' });

    await expect(
      runCanonicalMongoValidators(developmentArgs, 'mongodb://localhost/development', {
        client: harness.client,
      }),
    ).rejects.toThrow('environment development does not match MongoDB database beta');
    expect(harness.connect).toHaveBeenCalledOnce();
    expect(harness.listCollections).not.toHaveBeenCalled();
    expect(harness.command).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('keeps dry-run read-only and ignores unrelated collections', async () => {
    const harness = fakeMongoHarness({
      collectionInfos: [
        { name: 'legacy_rows', type: 'collection', options: { validator: { ignored: true } } },
        { name: 'system.views', type: 'collection' },
      ],
    });

    const report = await reviewedDryRun(harness);

    expect(report.mode).toBe('dry-run');
    expect(report.desiredCollections).toEqual(CANONICAL_MONGO_VALIDATOR_COLLECTIONS);
    expect(report.currentCollections).toHaveLength(CANONICAL_MONGO_VALIDATORS.length);
    expect(report.currentCollections).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collectionName: 'legacy_rows' }),
        expect.objectContaining({ collectionName: 'system.views' }),
      ]),
    );
    expect(report.plan.every(({ action }) => action === 'createCollection')).toBe(true);
    expect(report.summary).toEqual({
      desiredCollections: CANONICAL_MONGO_VALIDATORS.length,
      createCollection: CANONICAL_MONGO_VALIDATORS.length,
      collMod: 0,
      noop: 0,
      writesPlanned: CANONICAL_MONGO_VALIDATORS.length,
    });
    expect(harness.command).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('produces a stable sorted plan and fingerprint across metadata and key ordering', async () => {
    const orderedInfos = CANONICAL_MONGO_VALIDATOR_COLLECTIONS.map(desiredCollectionInfo);
    const reverseObjectKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseObjectKeys);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
      );
    };
    const reversedInfos = orderedInfos
      .map((info) => reverseObjectKeys(info) as FakeCollectionInfo)
      .reverse();
    const firstHarness = fakeMongoHarness({ collectionInfos: orderedInfos });
    const secondHarness = fakeMongoHarness({ collectionInfos: reversedInfos });

    const first = await reviewedDryRun(firstHarness);
    const second = await reviewedDryRun(secondHarness);

    expect(first.plan.map(({ collectionName }) => collectionName)).toEqual(
      [...CANONICAL_MONGO_VALIDATOR_COLLECTIONS].sort(),
    );
    expect(first.plan.every(({ action }) => action === 'noop')).toBe(true);
    expect(second.plan).toEqual(first.plan);
    expect(second.planFingerprint).toBe(first.planFingerprint);
  });

  it('rejects reviewed artifact drift before executing any command', async () => {
    const harness = fakeMongoHarness();
    const dryRun = await reviewedDryRun(harness);
    harness.collectionInfos.push(desiredCollectionInfo(CANONICAL_MONGO_VALIDATOR_COLLECTIONS[0]));
    harness.close.mockClear();

    await expect(
      runCanonicalMongoValidators(applyArgs(), 'mongodb://localhost/development', {
        client: harness.client,
        reviewedArtifact: dryRun,
      }),
    ).rejects.toThrow('validator state drifted after the reviewed dry-run');
    expect(harness.command).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('rejects a tampered reviewed artifact before executing any command', async () => {
    const harness = fakeMongoHarness();
    const dryRun = await reviewedDryRun(harness);
    harness.close.mockClear();
    const tampered = structuredClone(dryRun);
    tampered.plan[0].reasons = ['already-current'];

    await expect(
      runCanonicalMongoValidators(applyArgs(), 'mongodb://localhost/development', {
        client: harness.client,
        reviewedArtifact: tampered,
      }),
    ).rejects.toThrow('artifact fingerprint is invalid');
    expect(harness.command).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('fingerprint-binds the human-reviewed plan summary', async () => {
    const harness = fakeMongoHarness();
    const dryRun = await reviewedDryRun(harness);
    harness.close.mockClear();
    const tampered = structuredClone(dryRun);
    tampered.summary.writesPlanned = 0;

    await expect(
      runCanonicalMongoValidators(applyArgs(), 'mongodb://localhost/development', {
        client: harness.client,
        reviewedArtifact: tampered,
      }),
    ).rejects.toThrow('artifact fingerprint is invalid');
    expect(harness.command).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('applies only sorted write plans and verifies every validator is current', async () => {
    const existingNoop = CANONICAL_MONGO_VALIDATOR_COLLECTIONS[2];
    const harness = fakeMongoHarness({
      collectionInfos: [desiredCollectionInfo(existingNoop)],
    });
    const dryRun = await reviewedDryRun(harness);
    harness.close.mockClear();
    harness.listCollections.mockClear();

    const report = await runCanonicalMongoValidators(
      applyArgs(),
      'mongodb://localhost/development',
      {
        client: harness.client,
        reviewedArtifact: dryRun,
      },
    );

    const expectedWrites = CANONICAL_MONGO_VALIDATOR_COLLECTIONS.filter(
      (collectionName) => collectionName !== existingNoop,
    );
    expect(
      harness.command.mock.calls.map(([command]) => command.create ?? command.collMod),
    ).toEqual(expectedWrites);
    expect(harness.command.mock.calls).not.toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ create: existingNoop })],
        [expect.objectContaining({ collMod: existingNoop })],
      ]),
    );
    expect(report.applied?.map(({ collectionName }) => collectionName)).toEqual(expectedWrites);
    expect(report.postApplyPlan).toHaveLength(CANONICAL_MONGO_VALIDATORS.length);
    expect(report.postApplyPlan?.every(({ action }) => action === 'noop')).toBe(true);
    expect(harness.listCollections).toHaveBeenCalledTimes(2);
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('reports partial progress, stops at the first failure, closes, and supports a fresh rerun', async () => {
    const failingCollection = CANONICAL_MONGO_VALIDATOR_COLLECTIONS[1];
    let failOnce = true;
    const harness = fakeMongoHarness({
      commandFailure: (command) => {
        const collectionName = command.create ?? command.collMod;
        if (collectionName === failingCollection && failOnce) {
          failOnce = false;
          return true;
        }
        return false;
      },
    });
    const firstDryRun = await reviewedDryRun(harness);
    harness.close.mockClear();

    let applyError: unknown;
    try {
      await runCanonicalMongoValidators(applyArgs(), 'mongodb://localhost/development', {
        client: harness.client,
        reviewedArtifact: firstDryRun,
      });
    } catch (error) {
      applyError = error;
    }

    expect(applyError).toBeInstanceOf(CanonicalMongoValidatorApplyError);
    expect(applyError).toMatchObject({
      appliedCollections: [CANONICAL_MONGO_VALIDATOR_COLLECTIONS[0]],
      failedCollection: failingCollection,
      unattemptedCollections: CANONICAL_MONGO_VALIDATOR_COLLECTIONS.slice(2),
    });
    expect(harness.command).toHaveBeenCalledTimes(2);
    expect(harness.close).toHaveBeenCalledOnce();

    harness.command.mockClear();
    harness.close.mockClear();
    const freshDryRun = await reviewedDryRun(harness);
    harness.close.mockClear();
    const rerun = await runCanonicalMongoValidators(
      applyArgs(),
      'mongodb://localhost/development',
      {
        client: harness.client,
        reviewedArtifact: freshDryRun,
      },
    );

    expect(rerun.applied?.map(({ collectionName }) => collectionName)).toEqual(
      CANONICAL_MONGO_VALIDATOR_COLLECTIONS.slice(1),
    );
    expect(rerun.postApplyPlan?.every(({ action }) => action === 'noop')).toBe(true);
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('preserves partial progress when closing also fails', async () => {
    const failingCollection = CANONICAL_MONGO_VALIDATOR_COLLECTIONS[1];
    const harness = fakeMongoHarness({
      commandFailure: (_command, callIndex) => callIndex === 1,
    });
    const dryRun = await reviewedDryRun(harness);
    harness.close.mockRejectedValue(new Error('injected MongoDB close failure'));

    let applyError: unknown;
    try {
      await runCanonicalMongoValidators(applyArgs(), 'mongodb://localhost/development', {
        client: harness.client,
        reviewedArtifact: dryRun,
      });
    } catch (error) {
      applyError = error;
    }

    expect(applyError).toBeInstanceOf(CanonicalMongoValidatorApplyError);
    expect(applyError).toMatchObject({
      appliedCollections: [CANONICAL_MONGO_VALIDATOR_COLLECTIONS[0]],
      failedCollection: failingCollection,
      unattemptedCollections: CANONICAL_MONGO_VALIDATOR_COLLECTIONS.slice(2),
    });
    expect(applyError).toHaveProperty(
      'message',
      expect.stringContaining('MongoDB client cleanup also failed: injected MongoDB close failure'),
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('propagates collection metadata failures without writes and closes the client', async () => {
    const harness = fakeMongoHarness({
      listError: new Error('listCollections unavailable'),
    });

    await expect(reviewedDryRun(harness)).rejects.toThrow('listCollections unavailable');
    expect(harness.command).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('reports applied collections when post-apply verification cannot read metadata', async () => {
    const harness = fakeMongoHarness({
      listError: new Error('post-apply listCollections unavailable'),
      listFailureCall: 2,
    });
    const dryRun = await reviewedDryRun(harness);
    harness.close.mockClear();

    let verificationError: unknown;
    try {
      await runCanonicalMongoValidators(applyArgs(), 'mongodb://localhost/development', {
        client: harness.client,
        reviewedArtifact: dryRun,
      });
    } catch (error) {
      verificationError = error;
    }

    expect(verificationError).toBeInstanceOf(CanonicalMongoValidatorVerificationError);
    expect(verificationError).toMatchObject({
      appliedCollections: CANONICAL_MONGO_VALIDATOR_COLLECTIONS,
      remainingCollections: [],
    });
    expect(verificationError).toHaveProperty(
      'message',
      expect.stringContaining('post-apply listCollections unavailable'),
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it.each(['view', 'timeseries'])(
    'rejects canonical targets reported as MongoDB type %s',
    async (type) => {
      const harness = fakeMongoHarness({
        collectionInfos: [
          {
            name: CANONICAL_MONGO_VALIDATOR_COLLECTIONS[0],
            type,
          },
        ],
      });

      await expect(reviewedDryRun(harness)).rejects.toThrow(
        `is a ${type}, not a standard collection`,
      );
      expect(harness.command).not.toHaveBeenCalled();
      expect(harness.close).toHaveBeenCalledOnce();
    },
  );

  it('rejects a time-series target even when MongoDB reports its base type as collection', async () => {
    const harness = fakeMongoHarness({
      collectionInfos: [
        {
          name: CANONICAL_MONGO_VALIDATOR_COLLECTIONS[0],
          type: 'collection',
          options: { timeseries: { timeField: 'observedAt' } },
        },
      ],
    });

    await expect(reviewedDryRun(harness)).rejects.toThrow(
      'is a time-series collection, not a standard collection',
    );
    expect(harness.command).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledOnce();
  });
});

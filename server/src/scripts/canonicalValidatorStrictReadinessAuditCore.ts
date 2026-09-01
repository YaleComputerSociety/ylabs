/**
 * Pure logic for the canonical validator strict-readiness audit.
 *
 * `canonicalMongoValidatorsCore.ts` enforces MongoDB `moderate` validation for
 * every registered canonical collection: new and modified documents must
 * conform, but an existing document that already violates the desired
 * `$jsonSchema` is left alone until it is next written. Flipping a collection
 * to `strict` removes that grandfathering: every future update to *any*
 * document, including ones nobody has touched since before the schema
 * existed, must conform immediately.
 *
 * This audit answers the one question that actually gates a safe strict
 * flip: does every document currently stored in a collection already match
 * its own desired `$jsonSchema`? It is deliberately separate from reference/
 * orphan audits (`canonicalReferenceIntegrityAuditCore.ts`), because a
 * dangling ObjectId reference does not violate `$jsonSchema` bson-shape
 * constraints; the two audits gate different risks and both need to be clean
 * before a collection is a safe strict candidate.
 */

export interface StrictReadinessCollectionFact {
  collectionName: string;
  exists: boolean;
  documentCount: number;
  nonConformingCount: number;
  sampleNonConformingIds: string[];
}

export interface StrictReadinessCollectionRow extends StrictReadinessCollectionFact {
  currentValidationLevel: string;
  currentValidationAction: string;
  clean: boolean;
  strictReady: boolean;
}

export interface StrictReadinessSummary {
  collectionsChecked: number;
  collectionsClean: number;
  collectionsAlreadyStrict: number;
  collectionsReadyToFlip: number;
  readyToFlipCollectionNames: string[];
  notCleanCollectionNames: string[];
}

export interface StrictReadinessReport {
  generatedAt: string;
  environment: string;
  databaseName: string;
  mode: 'read-only';
  summary: StrictReadinessSummary;
  collections: StrictReadinessCollectionRow[];
}

export interface DesiredValidatorForReadiness {
  collectionName: string;
}

export interface CurrentValidatorLevelForReadiness {
  collectionName: string;
  validationLevel?: string;
  validationAction?: string;
}

/**
 * `clean` means every existing document already conforms to the desired
 * `$jsonSchema`, so a strict flip would not immediately break the next
 * update to any pre-existing document. A collection with zero documents is
 * vacuously clean. `strictReady` additionally excludes collections that are
 * already strict (nothing to flip) so the caller can build a plan that only
 * touches collections that actually need the change.
 */
export function buildStrictReadinessReport(input: {
  environment: string;
  databaseName: string;
  desiredValidators: readonly DesiredValidatorForReadiness[];
  currentValidators: readonly CurrentValidatorLevelForReadiness[];
  facts: readonly StrictReadinessCollectionFact[];
  generatedAt?: string;
}): StrictReadinessReport {
  const currentByName = new Map(
    input.currentValidators.map((current) => [current.collectionName, current] as const),
  );
  const factByName = new Map(input.facts.map((fact) => [fact.collectionName, fact] as const));

  const collections: StrictReadinessCollectionRow[] = [...input.desiredValidators]
    .map((desired) => desired.collectionName)
    .sort((left, right) => left.localeCompare(right))
    .map((collectionName) => {
      const fact = factByName.get(collectionName);
      const current = currentByName.get(collectionName);
      const currentValidationLevel = current?.validationLevel ?? 'unknown';
      const currentValidationAction = current?.validationAction ?? 'unknown';
      const resolvedFact: StrictReadinessCollectionFact = fact ?? {
        collectionName,
        exists: false,
        documentCount: 0,
        nonConformingCount: 0,
        sampleNonConformingIds: [],
      };
      const clean = resolvedFact.nonConformingCount === 0;
      return {
        ...resolvedFact,
        currentValidationLevel,
        currentValidationAction,
        clean,
        strictReady: clean && currentValidationLevel !== 'strict',
      };
    });

  const notCleanCollectionNames = collections
    .filter((row) => !row.clean)
    .map((row) => row.collectionName);

  const summary: StrictReadinessSummary = {
    collectionsChecked: collections.length,
    collectionsClean: collections.filter((row) => row.clean).length,
    collectionsAlreadyStrict: collections.filter((row) => row.currentValidationLevel === 'strict')
      .length,
    collectionsReadyToFlip: collections.filter((row) => row.strictReady).length,
    readyToFlipCollectionNames: collections
      .filter((row) => row.strictReady)
      .map((row) => row.collectionName),
    notCleanCollectionNames,
  };

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    environment: input.environment,
    databaseName: input.databaseName,
    mode: 'read-only',
    summary,
    collections,
  };
}

export interface StrictReadinessArgs {
  environment: 'development' | 'beta' | 'production-copy' | 'production' | 'test';
  sampleLimit: number;
  output?: string;
}

export function parseStrictReadinessArgs(argv: string[]): StrictReadinessArgs {
  let environment: StrictReadinessArgs['environment'] | undefined;
  let sampleLimit = 10;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--environment') {
      const raw = argv[index + 1];
      if (
        raw !== 'development' &&
        raw !== 'beta' &&
        raw !== 'production-copy' &&
        raw !== 'production' &&
        raw !== 'test'
      ) {
        throw new Error(
          '--environment requires development, beta, production-copy, production, or test',
        );
      }
      environment = raw;
      index += 1;
    } else if (arg === '--sample-limit') {
      const raw = argv[index + 1];
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('--sample-limit requires a non-negative number');
      }
      sampleLimit = Math.floor(parsed);
      index += 1;
    } else if (arg === '--output') {
      const raw = argv[index + 1];
      if (!raw) throw new Error('--output requires a path');
      output = raw;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!environment) {
    throw new Error('--environment is required');
  }

  return { environment, sampleLimit, output };
}

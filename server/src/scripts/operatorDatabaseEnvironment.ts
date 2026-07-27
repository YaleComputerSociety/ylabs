export type OperatorDatabaseEnvironment =
  | 'development'
  | 'beta'
  | 'production-copy'
  | 'production'
  | 'test';

const OPERATOR_DATABASE_NAMES: Record<
  Exclude<OperatorDatabaseEnvironment, 'test'>,
  ReadonlySet<string>
> = {
  development: new Set(['development']),
  beta: new Set(['beta']),
  'production-copy': new Set(['productioncopy']),
  production: new Set(['production']),
};

export function parseOperatorDatabaseEnvironment(
  value: string | undefined,
  flag = '--environment',
): OperatorDatabaseEnvironment {
  if (
    value === 'development' ||
    value === 'beta' ||
    value === 'production-copy' ||
    value === 'production' ||
    value === 'test'
  ) {
    return value;
  }

  throw new Error(`${flag} requires development, beta, production-copy, production, or test`);
}

export function databaseNameFromMongoUrl(mongoUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(mongoUrl);
  } catch {
    throw new Error('MONGODBURL must be a valid MongoDB URL with an explicit database name.');
  }

  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new Error('MONGODBURL must use the mongodb or mongodb+srv protocol.');
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1).split('/')[0] ?? '').trim();
  } catch {
    throw new Error('MONGODBURL contains an invalid encoded database name.');
  }
  if (!databaseName) {
    throw new Error('MONGODBURL must include an explicit database name.');
  }
  return databaseName;
}

export function assertOperatorEnvironmentMatchesDatabase(
  environment: OperatorDatabaseEnvironment,
  databaseName: string,
): void {
  const lowerDatabaseName = databaseName.trim().toLowerCase();
  const normalizedDatabaseName = lowerDatabaseName.replace(/[-_]/g, '');
  const matches =
    environment === 'test'
      ? lowerDatabaseName === 'test' || /[-_]test$/.test(lowerDatabaseName)
      : OPERATOR_DATABASE_NAMES[environment].has(normalizedDatabaseName);

  if (!matches) {
    throw new Error(
      `Operator environment ${environment} does not match MongoDB database ${databaseName || '(missing)'}`,
    );
  }
}

export const SERVING_DATABASE_NAMES = Object.freeze({
  development: 'Development',
  beta: 'Beta',
  production: 'Prod',
});

const PRIMARY_PRODUCTION_DATABASE_NAMES = new Set(
  [SERVING_DATABASE_NAMES.production, 'Production'].map((name) => name.toLowerCase()),
);

export function isPrimaryProductionDatabaseName(databaseName) {
  return PRIMARY_PRODUCTION_DATABASE_NAMES.has(String(databaseName).trim().toLowerCase());
}

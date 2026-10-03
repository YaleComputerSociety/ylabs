export declare const SERVING_DATABASE_NAMES: Readonly<{
  development: 'Development';
  beta: 'Beta';
  production: 'Prod';
}>;

export declare function isPrimaryProductionDatabaseName(databaseName: string): boolean;

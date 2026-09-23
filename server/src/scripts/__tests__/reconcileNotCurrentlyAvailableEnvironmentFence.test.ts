import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { assertConnectedToDevelopment } from '../reconcileNotCurrentlyAvailableAccessSignals';

const SCRIPT_SOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../reconcileNotCurrentlyAvailableAccessSignals.ts',
);

const mongoUrlFor = (databaseName: string) =>
  `mongodb+srv://user:pass@cluster.example.net/${databaseName}?retryWrites=true`;

describe('the NOT_CURRENTLY_AVAILABLE reconcile refuses every database but Development', () => {
  /**
   * `Prod` is the real production database name, not `Production`, and a guard
   * written against the wrong spelling has shipped here before (#2575).
   */
  it.each(['Prod', 'Production', 'Beta', 'ProductionCopy', 'production-copy'])(
    'refuses %s',
    (databaseName) => {
      expect(() => assertConnectedToDevelopment(mongoUrlFor(databaseName))).toThrow(
        /Operator environment development does not match MongoDB database/,
      );
    },
  );

  it('allows Development, so the refusal above is a decision and not a blanket throw', () => {
    expect(() => assertConnectedToDevelopment(mongoUrlFor('Development'))).not.toThrow();
  });

  it('refuses a missing connection string rather than defaulting to one', () => {
    expect(() => assertConnectedToDevelopment(undefined)).toThrow(/MONGODBURL is required/);
    expect(() => assertConnectedToDevelopment('')).toThrow(/MONGODBURL is required/);
  });

  /**
   * The ordering is what makes the Production exposure zero rather than small: a
   * refusal taken from the connection string means a non-Development target is
   * never connected to, so no read and no write is reachable. A refactor that
   * connects first would leave the refusal correct and the claim false.
   */
  it('refuses from the connection string before it opens a connection', () => {
    const source = fs.readFileSync(SCRIPT_SOURCE_PATH, 'utf8');
    const refusalIndex = source.indexOf('assertConnectedToDevelopment(mongoUrl)');
    const connectIndex = source.indexOf('await initializeConnections()');

    expect(refusalIndex).toBeGreaterThan(-1);
    expect(connectIndex).toBeGreaterThan(-1);
    expect(refusalIndex).toBeLessThan(connectIndex);
  });
});

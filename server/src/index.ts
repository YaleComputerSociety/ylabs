/**
 * Server entry point — connects to MongoDB and starts the Express server.
 */
import app from './app';
import dotenv from 'dotenv';
import { initializeConnections, getApiMode } from './db/connections';
import { startGateRefreshScheduler } from './scripts/gateRefreshScheduler';
import { sanitizeLogValue } from './utils/logSanitizer';
import { captureStartupError, initializeErrorTracking } from './utils/errorTracking';

dotenv.config();
initializeErrorTracking();

const port = process.env.PORT || 4000;

const startApp = async () => {
  try {
    await initializeConnections();

    const mode = getApiMode();

    app.listen(port, () => {
      console.log(`Server is ready at: ${port} 🐶`);

      // Optional: keep the operator-board gate scorecards fresh in-process (off unless
      // GATE_REFRESH_INTERVAL_MINUTES is set). See gateRefreshScheduler.ts.
      startGateRefreshScheduler();

      if (mode === 'productionMigration') {
        console.log(
          'Mode: ProductionMigration - Listings from migration DB, everything else from primary',
        );
      }
    });
  } catch (error) {
    await captureStartupError(error);
    console.error('Failed to start app:', sanitizeLogValue(error));
    process.exit(1);
  }
};

void startApp();

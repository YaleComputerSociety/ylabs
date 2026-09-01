/**
 * Server entry point — connects to MongoDB and starts the Express server.
 */
import app from './app';
import dotenv from 'dotenv';
import { initializeConnections, startMongoKeepAlive } from './db/connections';
import { startGateRefreshScheduler } from './scripts/gateRefreshScheduler';
import { sanitizeLogValue } from './utils/logSanitizer';
import { captureStartupError, initializeErrorTracking } from './utils/errorTracking';
import { describeFirstContactCeiling } from './middleware/rateLimiters';

dotenv.config();
initializeErrorTracking();

const port = process.env.PORT || 4000;

const startApp = async () => {
  try {
    await initializeConnections();

    app.listen(port, () => {
      console.log(`Server is ready at: ${port} 🐶`);
      // Log the effective value so an unset or fat-fingered env var is visible
      // rather than inferred from behaviour (#2319).
      console.log(`[rate-limit] ${describeFirstContactCeiling()}`);

      startMongoKeepAlive();

      // Optional: keep the operator-board gate scorecards fresh in-process (off unless
      // GATE_REFRESH_INTERVAL_MINUTES is set). See gateRefreshScheduler.ts.
      startGateRefreshScheduler();
    });
  } catch (error) {
    await captureStartupError(error);
    console.error('Failed to start app:', sanitizeLogValue(error));
    process.exit(1);
  }
};

void startApp();

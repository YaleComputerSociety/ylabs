/**
 * Server entry point — connects to MongoDB and starts the Express server.
 */
import app from './app';
import dotenv from 'dotenv';
import { initializeConnections, mongoOptions, startMongoKeepAlive } from './db/connections';
import { warmControlledVocabularyHeadings } from './utils/controlledVocabularyHeadings';
import { startGateRefreshScheduler } from './scripts/gateRefreshScheduler';
import { startCorpusQualitySnapshotScheduler } from './services/corpusQualitySnapshotScheduler';
import { sanitizeLogValue } from './utils/logSanitizer';
import { captureStartupError, initializeErrorTracking } from './utils/errorTracking';
import { describeFirstContactCeiling } from './middleware/rateLimiters';
import { serverListenHost } from './utils/environment';

dotenv.config();
initializeErrorTracking();

const port = Number(process.env.PORT || 4000);
const listenHost = serverListenHost();

const startApp = async () => {
  try {
    await initializeConnections(mongoOptions);

    // Before the first request, because the research-area splitter reads this set
    // synchronously and an unloaded set means a published controlled-vocabulary heading is
    // served as fragments (#3807). Warmed here rather than in the connection layer, which
    // must not import a model: doing so pulled the observation schema into every consumer of
    // `initializeConnections` and broke its own suite. Non-fatal, like the missing-index log:
    // a failed vocabulary read is a degraded chip, never a reason to refuse to boot.
    await warmControlledVocabularyHeadings().catch((error: unknown) =>
      console.error(
        '[research-area] controlled vocabulary warm failed, so multi-part headings will be split:',
        sanitizeLogValue(error),
      ),
    );

    app.listen(port, listenHost, () => {
      console.log(`Server is ready at: ${listenHost}:${port} 🐶`);
      // Log the effective value so an unset or fat-fingered env var is visible
      // rather than inferred from behaviour (#2319).
      console.log(`[rate-limit] ${describeFirstContactCeiling()}`);

      startMongoKeepAlive();

      // Optional: keep the operator-board gate scorecards fresh in-process (off unless
      // GATE_REFRESH_INTERVAL_MINUTES is set). See gateRefreshScheduler.ts.
      startGateRefreshScheduler();

      // Record a dated coverage-and-quality measurement using the connection this
      // process already holds, so the Corpus Quality panel has a trend without a
      // secret, a runner, or anyone remembering. See
      // corpusQualitySnapshotScheduler.ts.
      startCorpusQualitySnapshotScheduler();
    });
  } catch (error) {
    await captureStartupError(error);
    console.error('Failed to start app:', sanitizeLogValue(error));
    process.exit(1);
  }
};

void startApp();

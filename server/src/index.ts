/**
 * Server entry point — connects to MongoDB and starts the Express server.
 */
import app from "./app";
import dotenv from "dotenv";
import { initializeConnections, getApiMode } from "./db/connections";

dotenv.config();

const port = process.env.PORT || 4000;

const startApp = async () => {
  try {
    await initializeConnections();

    const mode = getApiMode();

    app.listen(port, () => {
      console.log(`Server is ready at: ${port} 🐶`);

      if (mode === 'productionMigration') {
        console.log('Mode: ProductionMigration - Listings from migration DB, everything else from primary');
      }
    });
  } catch (e) {
    console.error(`Failed to start app with error 💣: ${e}`);
  }
};

startApp();
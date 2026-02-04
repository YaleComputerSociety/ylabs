import app from "./app";
import dotenv from "dotenv";
import { initializeConnections, getApiMode } from "./db/connections";

dotenv.config();

const port = process.env.PORT || 4000;

const startApp = async () => {
  try {
    // Initialize database connections based on API_MODE
    await initializeConnections();

    const mode = getApiMode();

    app.listen(port, () => {
      console.log(`Server is ready at: ${port} 🐶`);
      console.log(`API_MODE: ${mode}`);

      if (mode === 'productionMigration') {
        console.log('Mode: ProductionMigration - Listings from ProductionMigration, everything else from Production');
      }
    });
  } catch (e) {
    console.error(`Failed to start app with error 💣: ${e}`);
  }
};

startApp();
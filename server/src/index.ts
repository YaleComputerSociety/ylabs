/**
 * Server entry point — connects to MongoDB and starts the Express server.
 */
import app from './app';
import dotenv from 'dotenv';
import { initializeConnections } from './db/connections';

dotenv.config();

const port = process.env.PORT || 4000;

const startApp = async () => {
  try {
    await initializeConnections();

    app.listen(port, () => {
      console.log(`Server is ready at: ${port} 🐶`);
    });
  } catch (e) {
    console.error(`Failed to start app with error 💣: ${e}`);
  }
};

void startApp();

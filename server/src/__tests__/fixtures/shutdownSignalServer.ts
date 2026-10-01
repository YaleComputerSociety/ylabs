import express from 'express';

import { registerGracefulShutdown } from '../../serverShutdown';

const SLOW_RESPONSE_MS = 2000;

const app = express();
app.get('/slow', (_request, response) => {
  setTimeout(() => response.status(200).json({ finished: true }), SLOW_RESPONSE_MS);
});

const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  console.log(`READY ${port}`);
});

if (process.argv.includes('--graceful')) registerGracefulShutdown(server);

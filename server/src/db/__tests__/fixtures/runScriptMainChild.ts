import net from 'node:net';

import mongoose from 'mongoose';

import { createScriptMongoConnection, runScriptMain } from '../../connections';

const [scenario, watchdogMs, mongoUri] = process.argv.slice(2);

const scenarios: Record<string, () => Promise<unknown>> = {
  clean: async () => console.log('work done'),
  'unref-free-interval': async () => {
    setInterval(() => undefined, 1_000);
    console.log('work done');
  },
  'open-server-socket': async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    console.log('work done');
  },
  throws: async () => {
    throw new Error('scenario failed on purpose');
  },
  'second-connection': async () => {
    const connection = await createScriptMongoConnection(mongoUri);
    await connection.db?.admin().ping();
    console.log(`work done on ${mongoose.connections.length} connections`);
  },
};

void runScriptMain(scenarios[scenario], { exitWatchdogMs: Number(watchdogMs) });

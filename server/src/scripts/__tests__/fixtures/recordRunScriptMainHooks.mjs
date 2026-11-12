import { registerHooks } from 'node:module';
import { URL } from 'node:url';

const REAL_CONNECTIONS = new URL('../../../db/connections.ts', import.meta.url).href;
const RECORDING_CONNECTIONS = new URL('./recordingConnections.ts', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url !== REAL_CONNECTIONS || context.parentURL === RECORDING_CONNECTIONS) {
      return resolved;
    }
    return { ...resolved, url: RECORDING_CONNECTIONS };
  },
});

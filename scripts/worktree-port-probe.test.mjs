import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  API_PORT_BASE,
  CLIENT_PORT_BASE,
  findFreePortOffset,
  portHasLiveListener,
} from './worktree-port-probe.mjs';

async function holdEphemeralPort(host) {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ port: 0, host }, resolve));
  return { server, port: server.address().port };
}

const release = (server) => new Promise((resolve) => server.close(resolve));

for (const host of ['127.0.0.1', '::1']) {
  test(`a port held by a live listener on ${host} reads as in use`, async (t) => {
    let held;
    try {
      held = await holdEphemeralPort(host);
    } catch {
      t.skip(`${host} is not available on this host`);
      return;
    }
    try {
      assert.equal(await portHasLiveListener(held.port, { consultLsof: false }), true);
    } finally {
      await release(held.server);
    }
  });
}

test('a released port reads as free', async () => {
  const held = await holdEphemeralPort('127.0.0.1');
  await release(held.server);
  assert.equal(await portHasLiveListener(held.port), false);
});

test('a live listener is detected by the socket probes alone, without lsof', async () => {
  const held = await holdEphemeralPort('127.0.0.1');
  try {
    assert.equal(await portHasLiveListener(held.port, { consultLsof: false }), true);
  } finally {
    await release(held.server);
  }
});

test('the offset search skips an offset whose client port has a live listener', async () => {
  const live = new Set([CLIENT_PORT_BASE + 5]);
  const offset = await findFreePortOffset({
    startOffset: 5,
    hasLiveListener: async (port) => live.has(port),
  });
  assert.equal(offset, 6);
});

test('the offset search skips a live API port and a claimed API port', async () => {
  const live = new Set([API_PORT_BASE + 5]);
  const offset = await findFreePortOffset({
    startOffset: 5,
    claimedApiPorts: [API_PORT_BASE + 6],
    hasLiveListener: async (port) => live.has(port),
  });
  assert.equal(offset, 7);
});

test('the offset search skips a port this test actually holds', async () => {
  const held = await holdEphemeralPort('127.0.0.1');
  try {
    const startOffset = held.port - CLIENT_PORT_BASE;
    const offset = await findFreePortOffset({
      startOffset,
      hasLiveListener: async (port) =>
        port === held.port && portHasLiveListener(port, { consultLsof: false }),
    });
    assert.notEqual(CLIENT_PORT_BASE + offset, held.port);
  } finally {
    await release(held.server);
  }
});

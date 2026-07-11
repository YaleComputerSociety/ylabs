import assert from 'node:assert/strict';
import test from 'node:test';

import {
  rotationIsVerified,
  verifyYaliesCredential,
  YALIES_VERIFICATION_URL,
} from './verify-yalies-rotation-core.mjs';

test('probes only the fixed Yalies endpoint and does not place credentials in the body', async () => {
  const credential = ['synthetic', 'Rotation', 'Credential', '123456'].join('');
  let captured;
  const request = async (url, options) => {
    captured = { url, options };
    return { status: 200 };
  };

  assert.deepEqual(await verifyYaliesCredential(credential, request), { status: 200, ok: true });
  assert.equal(captured.url, YALIES_VERIFICATION_URL);
  assert.equal(captured.options.redirect, 'error');
  assert.ok(!captured.options.body.includes(credential));
  assert.equal(captured.options.headers.Authorization, `Bearer ${credential}`);
});

test('requires rejection of the old credential and success of the new credential', () => {
  assert.equal(rotationIsVerified({ status: 401 }, { status: 200, ok: true }), true);
  assert.equal(rotationIsVerified({ status: 403 }, { status: 204, ok: true }), true);
  assert.equal(rotationIsVerified({ status: 200 }, { status: 200, ok: true }), false);
  assert.equal(rotationIsVerified({ status: 401 }, { status: 500, ok: false }), false);
});

#!/usr/bin/env node
import {
  rotationIsVerified,
  verifyYaliesCredential,
} from './verify-yalies-rotation-core.mjs';

const oldCredential = process.env.YALIES_OLD_API_KEY;
const newCredential = process.env.YALIES_NEW_API_KEY;

if (!oldCredential || !newCredential) {
  console.error('Set YALIES_OLD_API_KEY and YALIES_NEW_API_KEY in the process environment.');
  process.exit(2);
}

try {
  const oldResult = await verifyYaliesCredential(oldCredential);
  const newResult = await verifyYaliesCredential(newCredential);

  console.log(`Old credential HTTP status: ${oldResult.status}`);
  console.log(`New credential HTTP status: ${newResult.status}`);

  if (!rotationIsVerified(oldResult, newResult)) {
    console.error('Rotation is not verified: old must be rejected and new must succeed.');
    process.exit(1);
  }

  console.log('Rotation verified: old credential rejected and new credential accepted.');
} catch {
  console.error('Rotation verification request failed; no credential values were logged.');
  process.exit(1);
}

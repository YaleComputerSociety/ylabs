/**
 * Test environment setup for Vitest.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library defaults `waitFor` and `findBy*` to 1000ms. Page-level renders here mount a
// whole page plus its charts, and on a loaded machine that work has been measured past 1000ms,
// so the default made a passing suite report red for load rather than for behaviour. This budget
// is a ceiling, not a delay: it only costs wall clock when an assertion is genuinely not met.
const ASYNC_UTIL_TIMEOUT_MS = 5000;

configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });

afterEach(() => {
  cleanup();
});

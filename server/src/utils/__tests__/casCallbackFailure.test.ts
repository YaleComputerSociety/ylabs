import { describe, expect, it } from 'vitest';
import {
  UnusableCasIdentityError,
  casCallbackFailureStatus,
  classifyCasCallbackError,
  reportableCasLoginError,
} from '../casCallbackFailure';

const wrapped = (message: string, cause: unknown): Error => new Error(message, { cause });

const unreachableCas = (): Error => {
  const error = Object.assign(new Error('connect ECONNREFUSED'), {
    name: 'AxiosError',
    code: 'ECONNREFUSED',
    isAxiosError: true,
    config: { url: 'https://cas.invalid/cas/validate?ticket=ST-unit-ticket' },
  });
  return wrapped('Error in validation', error);
};

describe('classifyCasCallbackError', () => {
  it('reads a CAS refusal anywhere in the cause chain as a rejection', () => {
    expect(
      classifyCasCallbackError(
        wrapped('Error in validation', new Error('Authentication rejected')),
      ),
    ).toBe('rejected');
    expect(
      classifyCasCallbackError(
        wrapped('user-provided verify function failed', new UnusableCasIdentityError()),
      ),
    ).toBe('rejected');
  });

  it('reads a CAS transport failure and an unreachable database as unavailable', () => {
    expect(classifyCasCallbackError(unreachableCas())).toBe('unavailable');
    expect(
      classifyCasCallbackError(
        wrapped(
          'user-provided verify function failed',
          Object.assign(new Error('x'), { name: 'MongoServerSelectionError' }),
        ),
      ),
    ).toBe('unavailable');
  });

  it('reads a malformed CAS answer as unavailable and anything else as our server error', () => {
    expect(
      classifyCasCallbackError(
        wrapped('Error in validation', new Error('The response from the server was bad')),
      ),
    ).toBe('unavailable');
    expect(classifyCasCallbackError(new TypeError('boom'))).toBe('server_error');
  });

  it('follows a VError-style cause method as well as a cause property', () => {
    const outer = Object.assign(new Error('Error in validation'), {
      cause: () => new Error('Authentication rejected'),
    });
    expect(classifyCasCallbackError(outer)).toBe('rejected');
  });
});

describe('casCallbackFailureStatus', () => {
  it('keeps 401 for a rejection and answers 5xx for every server-side failure', () => {
    expect(casCallbackFailureStatus('rejected')).toBe(401);
    expect(casCallbackFailureStatus('unavailable')).toBe(503);
    expect(casCallbackFailureStatus('server_error')).toBe(500);
  });
});

describe('reportableCasLoginError', () => {
  it('reports only error names and codes, never the original messages or request URL', () => {
    const reported = reportableCasLoginError('unavailable', unreachableCas());

    expect(reported.message).toBe(
      'CAS login callback failed (unavailable): Error > AxiosError > ECONNREFUSED',
    );
    expect(`${reported.message}${reported.stack}`).not.toContain('ST-unit-ticket');
  });

  it('drops a label that is not shaped like an identifier', () => {
    const reported = reportableCasLoginError(
      'server_error',
      Object.assign(new Error('write failed'), { name: 'Error', code: 'dup key: { netid }' }),
    );

    expect(reported.message).toBe('CAS login callback failed (server_error): Error');
  });
});

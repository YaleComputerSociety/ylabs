import { describe, expect, it } from 'vitest';
import {
  CasMalformedResponseError,
  CasTicketRejectedError,
  CasUnreachableError,
  UnusableCasIdentityError,
  casCallbackFailureStatus,
  classifyCasCallbackError,
  reportableCasLoginError,
} from '../casCallbackFailure';

const wrapped = (message: string, cause: unknown): Error => new Error(message, { cause });

const unreachableCas = (): Error =>
  new CasUnreachableError('request failed', {
    cause: Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      url: 'https://cas.invalid/cas/validate?ticket=ST-unit-ticket',
    }),
  });

describe('classifyCasCallbackError', () => {
  it('reads a CAS refusal anywhere in the cause chain as a rejection', () => {
    expect(classifyCasCallbackError(new CasTicketRejectedError())).toBe('rejected');
    expect(classifyCasCallbackError(wrapped('outer', new CasTicketRejectedError()))).toBe(
      'rejected',
    );
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
    expect(classifyCasCallbackError(new CasMalformedResponseError())).toBe('unavailable');
    expect(classifyCasCallbackError(new TypeError('boom'))).toBe('server_error');
  });

  it('follows a VError-style cause method as well as a cause property', () => {
    const outer = Object.assign(new Error('Error in validation'), {
      cause: () => new CasTicketRejectedError(),
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
      'CAS login callback failed (unavailable): CasUnreachableError > TypeError > Error > ECONNREFUSED',
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

describe('classifyCasCallbackError message independence', () => {
  it('no longer reads an untyped error as a CAS verdict because of its message text', () => {
    expect(classifyCasCallbackError(new Error('Authentication rejected'))).toBe('server_error');
    expect(classifyCasCallbackError(new Error('The response from the server was bad'))).toBe(
      'server_error',
    );
    expect(classifyCasCallbackError(Object.assign(new Error('x'), { isAxiosError: true }))).toBe(
      'server_error',
    );
  });
});

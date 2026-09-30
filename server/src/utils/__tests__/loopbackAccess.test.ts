import { describe, expect, it } from 'vitest';
import {
  isLoopbackAddress,
  isLoopbackHostHeader,
  isLoopbackHostname,
  isLoopbackHttpOrigin,
  isLoopbackRequest,
} from '../loopbackAccess';

const requestFrom = (remoteAddress: string | undefined, host: string | undefined) =>
  ({ headers: { host }, socket: { remoteAddress } }) as any;

describe('loopback access predicates', () => {
  it('accepts every loopback peer address form', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.1.2.3')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('[::1]')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress(' 127.0.0.1 ')).toBe(true);
  });

  it('refuses a non-loopback peer address', () => {
    expect(isLoopbackAddress('203.0.113.5')).toBe(false);
    expect(isLoopbackAddress('10.0.0.4')).toBe(false);
    expect(isLoopbackAddress('192.168.1.20')).toBe(false);
    expect(isLoopbackAddress('::ffff:203.0.113.5')).toBe(false);
    expect(isLoopbackAddress('2001:db8::1')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
    expect(isLoopbackAddress('127.0.0.1.evil.example')).toBe(false);
  });

  it('accepts localhost hostnames and refuses hostnames that merely contain one', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('LOCALHOST.')).toBe(true);
    expect(isLoopbackHostname('client.localhost')).toBe(true);
    expect(isLoopbackHostname('localhost.evil.example')).toBe(false);
    expect(isLoopbackHostname('notlocalhost')).toBe(false);
    expect(isLoopbackHostname('yalelabs.io')).toBe(false);
    expect(isLoopbackHostname(undefined)).toBe(false);
  });

  it('accepts a localhost Host header with or without a port', () => {
    expect(isLoopbackHostHeader('localhost')).toBe(true);
    expect(isLoopbackHostHeader('localhost:4000')).toBe(true);
    expect(isLoopbackHostHeader('127.0.0.1:4000')).toBe(true);
    expect(isLoopbackHostHeader('[::1]:4000')).toBe(true);
    expect(isLoopbackHostHeader(['localhost:4000'])).toBe(true);
  });

  it('refuses a non-localhost or malformed Host header', () => {
    expect(isLoopbackHostHeader('yalelabs.io')).toBe(false);
    expect(isLoopbackHostHeader('server.example:4000')).toBe(false);
    expect(isLoopbackHostHeader('localhost:4000/path')).toBe(false);
    expect(isLoopbackHostHeader('user@localhost')).toBe(false);
    expect(isLoopbackHostHeader('local host')).toBe(false);
    expect(isLoopbackHostHeader('localhost:not-a-port')).toBe(false);
    expect(isLoopbackHostHeader(`${'a'.repeat(300)}.localhost`)).toBe(false);
    expect(isLoopbackHostHeader(undefined)).toBe(false);
  });

  it('accepts only http loopback origins', () => {
    expect(isLoopbackHttpOrigin('http://localhost:3000')).toBe(true);
    expect(isLoopbackHttpOrigin('http://localhost:3010')).toBe(true);
    expect(isLoopbackHttpOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isLoopbackHttpOrigin('https://localhost:3000')).toBe(false);
    expect(isLoopbackHttpOrigin('http://yalelabs.io')).toBe(false);
    expect(isLoopbackHttpOrigin('not-a-url')).toBe(false);
    expect(isLoopbackHttpOrigin(undefined)).toBe(false);
  });

  it('requires both a loopback peer and a localhost Host header', () => {
    expect(isLoopbackRequest(requestFrom('127.0.0.1', 'localhost:4000'))).toBe(true);
    expect(isLoopbackRequest(requestFrom('::1', '[::1]:4000'))).toBe(true);
    expect(isLoopbackRequest(requestFrom('203.0.113.5', 'localhost:4000'))).toBe(false);
    expect(isLoopbackRequest(requestFrom('127.0.0.1', 'yalelabs.io'))).toBe(false);
    expect(isLoopbackRequest(requestFrom(undefined, 'localhost:4000'))).toBe(false);
    expect(isLoopbackRequest(requestFrom('127.0.0.1', undefined))).toBe(false);
    expect(isLoopbackRequest({ headers: {}, socket: {} } as any)).toBe(false);
  });
});

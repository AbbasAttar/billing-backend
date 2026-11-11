import { afterEach, describe, expect, it } from 'vitest';
import { isDevBypassRequest } from '../src/lib/devAuthBypass';

const req = (remoteAddress: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress }, headers }) as any;
const KEYS = ['DEV_AUTH_BYPASS', 'K_SERVICE', 'FUNCTION_TARGET', 'FUNCTION_NAME'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('dev auth bypass', () => {
  it('is off unless DEV_AUTH_BYPASS=1', () => {
    delete process.env.DEV_AUTH_BYPASS;
    expect(isDevBypassRequest(req('127.0.0.1'))).toBe(false);
  });

  it('lets loopback requests through when on', () => {
    process.env.DEV_AUTH_BYPASS = '1';
    for (const k of ['K_SERVICE', 'FUNCTION_TARGET', 'FUNCTION_NAME']) delete process.env[k];
    expect(isDevBypassRequest(req('127.0.0.1'))).toBe(true);
    expect(isDevBypassRequest(req('::1'))).toBe(true);
  });

  it('never applies on Firebase / Cloud Run, to other machines, or through a proxy', () => {
    process.env.DEV_AUTH_BYPASS = '1';
    expect(isDevBypassRequest(req('192.168.1.5'))).toBe(false);
    expect(isDevBypassRequest(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' }))).toBe(false);
    process.env.K_SERVICE = 'api';
    expect(isDevBypassRequest(req('127.0.0.1'))).toBe(false);
    delete process.env.K_SERVICE;
    process.env.FUNCTION_TARGET = 'api';
    expect(isDevBypassRequest(req('127.0.0.1'))).toBe(false);
  });
});

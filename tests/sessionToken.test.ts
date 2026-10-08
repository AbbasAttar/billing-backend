import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from '../src/config/env';
import { issueCustomerToken, verifyCustomerToken, safeEqual } from '../src/lib/sessionToken';

describe('customer session token', () => {
  beforeEach(() => { env.CUSTOMER_TOKEN_SECRET = 'test-secret'; });
  afterEach(() => { vi.useRealTimers(); });

  it('round-trips and normalizes the phone to digits', () => {
    const token = issueCustomerToken('+91 98765-43210')!;
    expect(verifyCustomerToken(token)).toBe('919876543210');
  });

  it('rejects a tampered payload', () => {
    const token = issueCustomerToken('9876543210')!;
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: '1111111111', typ: 'customer', exp: 9e9 })).toString('base64url');
    expect(verifyCustomerToken(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = issueCustomerToken('9876543210')!;
    expect(verifyCustomerToken(token.slice(0, -2) + 'xx')).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const token = issueCustomerToken('9876543210')!;
    env.CUSTOMER_TOKEN_SECRET = 'rotated';
    expect(verifyCustomerToken(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    const token = issueCustomerToken('9876543210')!;
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
    expect(verifyCustomerToken(token)).toBeNull();
  });

  it('rejects garbage', () => {
    for (const t of ['', 'abc', 'a.b', '.', 'x.y.z']) expect(verifyCustomerToken(t)).toBeNull();
  });

  it('issues nothing and verifies nothing without a secret', () => {
    env.CUSTOMER_TOKEN_SECRET = '';
    expect(issueCustomerToken('9876543210')).toBeUndefined();
    expect(verifyCustomerToken('anything.here')).toBeNull();
  });
});

describe('safeEqual', () => {
  it('compares strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('is false for missing values', () => {
    expect(safeEqual(undefined, undefined)).toBe(false);
    expect(safeEqual(null, '')).toBe(false);
    expect(safeEqual('', undefined)).toBe(false);
  });
});

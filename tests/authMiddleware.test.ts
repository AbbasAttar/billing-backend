import { describe, it, expect, beforeEach, vi } from 'vitest';

const verifyIdToken = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/firebaseAdmin', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
  getAdminFirestore: () => null,
  getAdminMessaging: () => null,
}));

import { env } from '../src/config/env';
import { issueCustomerToken } from '../src/lib/sessionToken';
import { requireAdmin, attachCustomer, customerPhoneFrom, customerOwns } from '../src/middleware/auth';

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}
const mockReq = (headers: Record<string, string> = {}): any => ({
  headers, method: 'GET', originalUrl: '/x', path: '/x',
});

beforeEach(() => {
  env.AUTH_ENFORCE = true;
  env.ADMIN_EMAILS = ['owner@shop.com'];
  env.CUSTOMER_TOKEN_SECRET = 'test-secret';
  verifyIdToken.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('requireAdmin', () => {
  async function run(headers: Record<string, string>) {
    const req = mockReq(headers), res = mockRes(), next = vi.fn();
    await requireAdmin(req, res, next);
    return { req, res, next };
  }

  it('401 without a bearer token', async () => {
    const { res, next } = await run({});
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('401 when the ID token does not verify', async () => {
    verifyIdToken.mockRejectedValue(new Error('expired'));
    const { res, next } = await run({ authorization: 'Bearer bad' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('allows the admin custom claim', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', admin: true });
    const { req, next } = await run({ authorization: 'Bearer ok' });
    expect(next).toHaveBeenCalled();
    expect(req.admin).toEqual({ uid: 'u1', email: undefined });
  });

  it('allows a verified email from ADMIN_EMAILS (case-insensitive)', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u2', email: 'Owner@Shop.com', email_verified: true });
    const { req, next } = await run({ authorization: 'Bearer ok' });
    expect(next).toHaveBeenCalled();
    expect(req.admin.email).toBe('owner@shop.com');
  });

  it('403 for a listed email that is not verified', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u3', email: 'owner@shop.com', email_verified: false });
    const { res, next } = await run({ authorization: 'Bearer ok' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('403 for a signed-in non-admin', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u4', email: 'someone@gmail.com', email_verified: true });
    const { res, next } = await run({ authorization: 'Bearer ok' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('logs but allows when AUTH_ENFORCE is off', async () => {
    env.AUTH_ENFORCE = false;
    const { res, next } = await run({});
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[AUTH]'));
  });
});

describe('attachCustomer + customerPhoneFrom', () => {
  const withToken = (phone: string) => {
    const req = mockReq({ authorization: `Bearer ${issueCustomerToken(phone)}` });
    attachCustomer(req, mockRes(), vi.fn());
    return req;
  };

  it('attaches the phone from a valid token', () => {
    expect(withToken('9876543210').customerPhone).toBe('9876543210');
  });

  it('ignores an invalid token', () => {
    const req = mockReq({ authorization: 'Bearer nope.nope' });
    attachCustomer(req, mockRes(), vi.fn());
    expect(req.customerPhone).toBeUndefined();
  });

  it('token phone wins and a matching request phone is accepted', () => {
    const res = mockRes();
    expect(customerPhoneFrom(withToken('9876543210'), res, '+91 98765 43210')).toBe('9876543210');
  });

  it('403 when the request names another customer', () => {
    const res = mockRes();
    expect(customerPhoneFrom(withToken('9876543210'), res, '1111111111')).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('401 without a token when enforcing', () => {
    const res = mockRes();
    expect(customerPhoneFrom(mockReq(), res, '9876543210')).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('falls back to the request phone when not enforcing', () => {
    env.AUTH_ENFORCE = false;
    expect(customerPhoneFrom(mockReq(), mockRes(), '98765 43210')).toBe('9876543210');
  });

  it('401 with neither token nor phone, even when not enforcing', () => {
    env.AUTH_ENFORCE = false;
    const res = mockRes();
    expect(customerPhoneFrom(mockReq(), res, undefined)).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});

describe('customerOwns', () => {
  const req = (phone?: string): any => ({ ...mockReq(), customerPhone: phone });

  it('allows the owner, matching on the last 10 digits', () => {
    expect(customerOwns(req('9876543210'), mockRes(), '+91 98765 43210')).toBe(true);
  });

  it('403 for someone else', () => {
    const res = mockRes();
    expect(customerOwns(req('9876543210'), res, '1111111111')).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('403 when the document has no owner phone', () => {
    const res = mockRes();
    expect(customerOwns(req('9876543210'), res, undefined)).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('401 without a token when enforcing; allowed when not', () => {
    const res = mockRes();
    expect(customerOwns(req(), res, '9876543210')).toBe(false);
    expect(res.statusCode).toBe(401);
    env.AUTH_ENFORCE = false;
    expect(customerOwns(req(), mockRes(), '9876543210')).toBe(true);
  });
});

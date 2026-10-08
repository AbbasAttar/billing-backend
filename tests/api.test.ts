import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { chain, hmacHex } from './helpers';

// ── Mocks: no Firebase, no Firestore, no notifications ────────────────────────
const verifyIdToken = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/firebaseAdmin', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
  getAdminFirestore: () => null,
  getAdminMessaging: () => null,
}));
vi.mock('../src/config/database', () => ({ connectDB: vi.fn(async () => ({})) }));
vi.mock('../src/services/fcm', () => ({ sendNewOrderNotification: vi.fn(async () => {}) }));
vi.mock('../src/utils/invoiceNumber', () => ({ generateInvoiceNumber: vi.fn(async () => 'INV-1') }));

const User = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
  comparePassword: vi.fn(),
}));
vi.mock('../src/models/User.model', () => ({ User }));

const Order = vi.hoisted(() => ({
  find: vi.fn(),
  findById: vi.fn(),
  findOneAndUpdate: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  updateOne: vi.fn(),
}));
vi.mock('../src/models/Order.model', () => ({ Order }));

const Invoice = vi.hoisted(() => ({ find: vi.fn(), findById: vi.fn() }));
vi.mock('../src/models/Invoice.model', () => ({ Invoice }));

const Customer = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock('../src/models/Customer.model', () => ({ Customer }));

import app from '../src/app';
import { env } from '../src/config/env';
import { issueCustomerToken, verifyCustomerToken } from '../src/lib/sessionToken';

const PHONE = '9876543210';
const OTHER = '1111111111';
const bearer = (phone = PHONE) => ({ Authorization: `Bearer ${issueCustomerToken(phone)}` });

/** A User document as firestoreModel returns it: plain data plus save()/deleteOne(). */
function userDoc(over: Record<string, unknown> = {}) {
  const doc: any = { _id: 'u1', name: 'Asha', phone: PHONE, passwordHash: 'hash', phoneVerified: true, ...over };
  doc.save = vi.fn(async () => doc);
  doc.deleteOne = vi.fn(async () => ({}));
  return doc;
}

beforeEach(() => {
  vi.clearAllMocks();
  env.AUTH_ENFORCE = true;
  env.NODE_ENV = 'test';
  env.CUSTOMER_TOKEN_SECRET = 'test-secret';
  env.INTERNAL_API_SECRET = 'internal-secret';
  env.RAZORPAY_KEY_SECRET = 'rzp-key-secret';
  env.RAZORPAY_WEBHOOK_SECRET = 'rzp-webhook-secret';
  env.ADMIN_EMAILS = ['owner@shop.com'];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ── Admin guard ───────────────────────────────────────────────────────────────
describe('admin routes', () => {
  it.each(['/api/invoices', '/api/customers', '/api/analytics/sales', '/invoices'])('%s needs a token', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it('AI chat needs a token', async () => {
    expect((await request(app).post('/api/ai/data-chat').send({})).status).toBe(401);
  });

  it('a customer session token is not an admin token', async () => {
    verifyIdToken.mockRejectedValue(new Error('not a Firebase token'));
    expect((await request(app).get('/api/invoices').set(bearer())).status).toBe(401);
  });

  it('a non-admin Firebase user gets 403', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'x', email: 'random@gmail.com', email_verified: true });
    expect((await request(app).get('/api/invoices').set('Authorization', 'Bearer t')).status).toBe(403);
  });

  it('admin Razorpay endpoints need a token', async () => {
    expect((await request(app).get('/api/razorpay/orders')).status).toBe(401);
    expect((await request(app).delete('/api/razorpay/orders/o1')).status).toBe(401);
    expect((await request(app).patch('/api/razorpay/orders/o1/set-lens-price').send({ adminLensPrice: 1 })).status).toBe(401);
    expect((await request(app).patch('/api/razorpay/orders/o1/status').send({ status: 'paid' })).status).toBe(401);
  });

  it('with AUTH_ENFORCE off the request reaches the handler', async () => {
    env.AUTH_ENFORCE = false;
    Order.find.mockReturnValue(chain([]));
    const res = await request(app).get('/api/razorpay/orders');
    expect([401, 403]).not.toContain(res.status);
  });

  it('health stays public', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

// ── CORS ──────────────────────────────────────────────────────────────────────
describe('CORS', () => {
  const acao = async (origin: string) =>
    (await request(app).get('/api/health').set('Origin', origin)).headers['access-control-allow-origin'];

  it.each([
    'https://attarwalaopticalhouse.com',
    'https://www.attarwalaopticalhouse.com',
    'https://attarwala-admin.web.app',
    'https://attarwala-46200.firebaseapp.com',
    'https://attarwala-46200--preview-abc123.web.app',
    'https://aoh-admin--attarwala-46200.asia-east1.hosted.app',
  ])('allows %s', async (origin) => {
    expect(await acao(origin)).toBe(origin);
  });

  it.each([
    'https://evil.web.app',
    'https://attarwala-fake.web.app',
    'https://evil-attarwala.firebaseapp.com',
    'https://x.hosted.app',
    'https://attarwalaopticalhouse.com.evil.com',
  ])('blocks %s', async (origin) => {
    expect(await acao(origin)).toBeUndefined();
  });

  it('allows localhost outside production only', async () => {
    expect(await acao('http://localhost:3000')).toBe('http://localhost:3000');
    env.NODE_ENV = 'production';
    expect(await acao('http://localhost:3000')).toBeUndefined();
  });
});

// ── Customer auth ─────────────────────────────────────────────────────────────
describe('/auth', () => {
  it('password login returns a session token for that phone', async () => {
    User.findOne.mockResolvedValue(userDoc({ passwordHash: await bcrypt.hash('secret1', 4) }));
    // Use the real comparison: the controller used to call a method documents don't have.
    const real = await vi.importActual<typeof import('../src/models/User.model')>('../src/models/User.model');
    User.comparePassword.mockImplementation(real.User.comparePassword);

    const res = await request(app).post('/api/auth/login').send({ phone: PHONE, password: 'secret1' });
    expect(res.status).toBe(200);
    expect(verifyCustomerToken(res.body.token)).toBe(PHONE);
  });

  it('wrong password is 401 and returns no token', async () => {
    User.findOne.mockResolvedValue(userDoc());
    User.comparePassword.mockResolvedValue(false);
    const res = await request(app).post('/api/auth/login').send({ phone: PHONE, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('reauth-token is refused for a bare phone number (account takeover)', async () => {
    User.findOne.mockResolvedValue(userDoc());
    const res = await request(app).post('/api/auth/reauth-token').send({ phone: PHONE });
    expect(res.status).toBe(401);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('reauth-token is refused for a bare phone even with AUTH_ENFORCE off', async () => {
    env.AUTH_ENFORCE = false;
    const res = await request(app).post('/api/auth/reauth-token').send({ phone: PHONE });
    expect(res.status).toBe(401);
  });

  it('reauth-token works for the signed-in customer and logs in only once', async () => {
    const doc = userDoc();
    User.findOne.mockResolvedValue(doc);
    const issued = await request(app).post('/api/auth/reauth-token').set(bearer()).send({});
    expect(issued.status).toBe(200);
    expect(User.findOne).toHaveBeenCalledWith({ phone: PHONE });

    const login = await request(app).post('/api/auth/login').send({ phone: PHONE, reauthToken: issued.body.token });
    expect(login.status).toBe(200);
    expect(doc.reauthToken).toBeUndefined();

    const replay = await request(app).post('/api/auth/login').send({ phone: PHONE, reauthToken: issued.body.token });
    expect(replay.status).toBe(401);
  });

  it('profile is read for the token phone', async () => {
    User.findOne.mockResolvedValue(userDoc());
    const res = await request(app).get('/api/auth/profile').set(bearer());
    expect(res.status).toBe(200);
    expect(User.findOne.mock.calls[0][0]).toEqual({ phone: PHONE });
  });

  it("cannot read someone else's profile", async () => {
    const res = await request(app).get(`/api/auth/profile?phone=${OTHER}`).set(bearer());
    expect(res.status).toBe(403);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('profile without a token is 401', async () => {
    expect((await request(app).get(`/api/auth/profile?phone=${PHONE}`)).status).toBe(401);
  });

  it("cannot update someone else's profile", async () => {
    const res = await request(app).put('/api/auth/profile').set(bearer()).send({ phone: OTHER, name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('delete account checks the password with the model helper', async () => {
    const doc = userDoc();
    User.findOne.mockResolvedValue(doc);
    User.comparePassword.mockResolvedValue(true);
    const res = await request(app).delete('/api/auth/account').set(bearer()).send({ password: 'pw' });
    expect(res.status).toBe(200);
    expect(User.comparePassword).toHaveBeenCalledWith(doc, 'pw');
    expect(doc.deleteOne).toHaveBeenCalled();
  });

  it('mark-email-verified needs the internal secret', async () => {
    const bad = await request(app).post('/api/auth/mark-email-verified').send({ phone: PHONE, email: 'a@b.com', secret: 'wrong' });
    expect(bad.status).toBe(403);
    env.INTERNAL_API_SECRET = '';
    const unset = await request(app).post('/api/auth/mark-email-verified').send({ phone: PHONE, email: 'a@b.com', secret: 'x' });
    expect(unset.status).toBe(403);
  });
});

// ── Storefront per-user data ──────────────────────────────────────────────────
describe('/public per-user endpoints', () => {
  it("my-invoices refuses another customer's phone", async () => {
    const res = await request(app).get(`/api/public/my-invoices?phone=${OTHER}`).set(bearer());
    expect(res.status).toBe(403);
    expect(Customer.findOne).not.toHaveBeenCalled();
  });

  it('my-orders ignores a query email and uses the session', async () => {
    User.findOne.mockReturnValue(chain({ email: 'asha@mail.com', emailVerified: true }));
    Order.find.mockReturnValue(chain([]));
    const res = await request(app).get('/api/public/my-orders?email=victim@mail.com').set(bearer());
    expect(res.status).toBe(200);
    const filter = Order.find.mock.calls[0][0];
    expect(JSON.stringify(filter)).toContain(PHONE);
    expect(JSON.stringify(filter)).not.toContain('victim');
    const emailClause = filter.$or.find((c: any) => c.customerEmail).customerEmail.$regex as RegExp;
    expect(emailClause.test('asha@mail.com')).toBe(true);
  });

  it('my-orders escapes regex characters in a legacy email', async () => {
    env.AUTH_ENFORCE = false;
    Order.find.mockReturnValue(chain([]));
    await request(app).get('/api/public/my-orders?email=.*');
    const re = Order.find.mock.calls[0][0].customerEmail.$regex as RegExp;
    expect(re.test('anyone@mail.com')).toBe(false);
  });

  it('order detail: owner ok, someone else 403, anonymous 401', async () => {
    Order.findById.mockReturnValue(chain({ _id: 'o1', customerPhone: PHONE }));
    expect((await request(app).get('/api/public/orders/o1').set(bearer())).status).toBe(200);
    expect((await request(app).get('/api/public/orders/o1').set(bearer(OTHER))).status).toBe(403);
    expect((await request(app).get('/api/public/orders/o1')).status).toBe(401);
  });

  it('invoice detail is never readable by id alone', async () => {
    env.AUTH_ENFORCE = false;
    const res = await request(app).get('/api/public/invoices/inv1');
    expect(res.status).toBe(400);
    expect(Invoice.findById).not.toHaveBeenCalled();
  });

  it("invoice detail refuses another customer's invoice", async () => {
    Invoice.findById.mockReturnValue(chain({ _id: 'inv1', customer: { mobileNumber: OTHER }, items: [], payments: [], total: 100 }));
    expect((await request(app).get('/api/public/invoices/inv1').set(bearer())).status).toBe(403);
  });
});

// ── Razorpay ──────────────────────────────────────────────────────────────────
describe('Razorpay', () => {
  const sign = (orderId: string, paymentId: string) => hmacHex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  const capturedEvent = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } });
  const webhook = (sig?: string) => {
    const r = request(app).post('/api/razorpay/webhook').set('Content-Type', 'application/json');
    return (sig ? r.set('x-razorpay-signature', sig) : r).send(capturedEvent);
  };

  it('webhook rejected when the secret is not configured', async () => {
    env.RAZORPAY_WEBHOOK_SECRET = '';
    expect((await webhook('anything')).status).toBe(503);
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('webhook rejected with a bad or missing signature', async () => {
    expect((await webhook('deadbeef')).status).toBe(400);
    expect((await webhook()).status).toBe(400);
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('webhook with a valid signature marks the order paid', async () => {
    Order.findOneAndUpdate.mockReturnValue(chain({ _id: 'o1', invoiceNumber: 'X', customerName: 'A', total: 1, items: [] }));
    const res = await webhook(hmacHex(env.RAZORPAY_WEBHOOK_SECRET, capturedEvent));
    expect(res.status).toBe(200);
    expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
      { razorpayOrderId: 'order_1' }, expect.objectContaining({ status: 'paid' }), expect.anything(),
    );
  });

  it('verify-payment rejects a bad signature', async () => {
    const res = await request(app).post('/api/razorpay/verify-payment')
      .send({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'bad' });
    expect(res.status).toBe(400);
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('verify-payment accepts a valid signature', async () => {
    Order.findOneAndUpdate.mockReturnValue(chain(null));
    const res = await request(app).post('/api/razorpay/verify-payment')
      .send({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_1', 'pay_1') });
    expect(res.status).toBe(200);
  });

  it("balance payment: a valid signature from another order can't settle this one", async () => {
    Order.findById.mockReturnValue(chain({ _id: 'victim', balanceRazorpayOrderId: 'order_victim' }));
    const res = await request(app).post('/api/razorpay/verify-balance-payment').send({
      orderId: 'victim', razorpay_order_id: 'order_cheap', razorpay_payment_id: 'pay_cheap',
      razorpay_signature: sign('order_cheap', 'pay_cheap'),
    });
    expect(res.status).toBe(400);
    expect(Order.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('balance payment for the matching Razorpay order is accepted', async () => {
    Order.findById.mockReturnValue(chain({ _id: 'o1', balanceRazorpayOrderId: 'order_bal' }));
    Order.findByIdAndUpdate.mockReturnValue(chain({ _id: 'o1', balancePaid: true }));
    const res = await request(app).post('/api/razorpay/verify-balance-payment').send({
      orderId: 'o1', razorpay_order_id: 'order_bal', razorpay_payment_id: 'pay_bal',
      razorpay_signature: sign('order_bal', 'pay_bal'),
    });
    expect(res.status).toBe(200);
    expect(Order.findByIdAndUpdate).toHaveBeenCalledWith('o1', { balancePaid: true, status: 'paid' }, expect.anything());
  });

  it("can't create a balance order for someone else's order", async () => {
    Order.findById.mockReturnValue(chain({ _id: 'o1', customerPhone: OTHER, lensQuotePending: true, adminLensPrice: 500 }));
    const res = await request(app).post('/api/razorpay/orders/o1/create-balance-order').set(bearer());
    expect(res.status).toBe(403);
  });
});

describe('production detection', () => {
  it('Cloud Functions counts as production even with NODE_ENV=development', async () => {
    process.env.K_SERVICE = 'api';
    env.NODE_ENV = 'development';
    try {
      const res = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      delete process.env.K_SERVICE;
    }
  });

  it('error responses carry no stack trace in production', async () => {
    process.env.K_SERVICE = 'api';
    env.AUTH_ENFORCE = false;
    Order.find.mockImplementation(() => { throw new Error('boom'); });
    try {
      const res = await request(app).get('/api/razorpay/orders');
      expect(res.status).toBe(500);
      expect(res.body.stack).toBeUndefined();
    } finally {
      delete process.env.K_SERVICE;
    }
  });
});

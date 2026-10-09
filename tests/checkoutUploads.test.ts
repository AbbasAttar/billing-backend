import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── Mocks: fake Storage bucket, no Firestore ──────────────────────────────────
const save = vi.hoisted(() => vi.fn(async () => {}));
const file = vi.hoisted(() => vi.fn(() => ({ save })));
vi.mock('../src/lib/firebaseAdmin', () => ({
  getAdminAuth: () => null,
  getAdminFirestore: () => null,
  getAdminMessaging: () => null,
  getAdminBucket: () => ({ name: 'test-bucket', file }),
}));
vi.mock('../src/config/database', () => ({ connectDB: vi.fn(async () => ({})) }));

import app from '../src/app';
import { parseDataUrl, MAX_UPLOAD_BYTES } from '../src/controllers/upload.controller';
import { sanitizeRecipients } from '../src/controllers/razorpay.controller';

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

describe('parseDataUrl', () => {
  it('accepts images and PDFs', () => {
    const parsed = parseDataUrl(dataUrl('image/webp', Buffer.from('abc')));
    expect(parsed?.ext).toBe('webp');
    expect(parsed?.bytes.toString()).toBe('abc');
    expect(parseDataUrl(dataUrl('application/pdf', Buffer.from('x')))?.ext).toBe('pdf');
  });

  it('refuses other types and junk', () => {
    expect(parseDataUrl(dataUrl('text/html', Buffer.from('<script>')))).toBeNull();
    expect(parseDataUrl(dataUrl('image/svg+xml', Buffer.from('<svg/>')))).toBeNull();
    expect(parseDataUrl('not a data url')).toBeNull();
    expect(parseDataUrl(42)).toBeNull();
  });
});

describe('POST /api/public/upload', () => {
  beforeEach(() => { save.mockClear(); file.mockClear(); });

  it('stores the file under rx-uploads/ and returns a tokenised download URL', async () => {
    const res = await request(app).post('/api/public/upload')
      .send({ dataUrl: dataUrl('image/jpeg', Buffer.from('jpegdata')), type: 'prescription' });
    expect(res.status).toBe(200);
    expect(file.mock.calls[0][0]).toMatch(/^rx-uploads\/\d{4}-\d{2}-\d{2}\/[\w-]+\.jpg$/);
    expect(save).toHaveBeenCalledOnce();
    expect(res.body.data.url).toMatch(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/test-bucket\/o\/rx-uploads%2F.+\?alt=media&token=[\w-]+$/);
  });

  it('rejects disallowed types and files over the limit', async () => {
    expect((await request(app).post('/api/public/upload').send({ dataUrl: dataUrl('text/html', Buffer.from('x')) })).status).toBe(400);
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    expect((await request(app).post('/api/public/upload').send({ dataUrl: dataUrl('image/png', big) })).status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('sanitizeRecipients', () => {
  it('keeps known fields, drops empty eyes and foreign URLs', () => {
    const out = sanitizeRecipients([
      {
        name: ' Asha ', phone: '9876543210', rxMethod: 'manual',
        prescription: { rightEye: { sph: '-1.25', cyl: '', evil: 'x' }, leftEye: { sph: '' }, notes: '' },
        prescriptionUrl: 'https://evil.example/x.png',
        extra: 'ignored',
      },
      'junk',
    ]);
    expect(out).toEqual([
      { name: 'Asha', phone: '9876543210', rxMethod: 'manual', prescription: { rightEye: { sph: '-1.25' } } },
    ]);
  });

  it('keeps an uploaded prescription link from our bucket', () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/b/o/rx-uploads%2Fa.jpg?alt=media&token=t';
    expect(sanitizeRecipients([{ rxMethod: 'upload', prescriptionUrl: url, prescriptionFileName: 'rx.jpg' }]))
      .toEqual([{ rxMethod: 'upload', prescriptionUrl: url, prescriptionFileName: 'rx.jpg' }]);
  });

  it('returns undefined for nothing useful', () => {
    expect(sanitizeRecipients(undefined)).toBeUndefined();
    expect(sanitizeRecipients([])).toBeUndefined();
  });
});

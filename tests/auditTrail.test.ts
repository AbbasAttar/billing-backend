import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  categoryOf,
  describe as describeEntry,
  diffFields,
  rebuildDisplay,
  invoiceIdOf,
  pickResponse,
  redactBody,
  shouldAudit,
  targetIdOf,
} from '../src/services/auditTrail';
import { requiredRole } from '../src/middleware/accessPolicy';
import { auditTrail } from '../src/middleware/auditTrail';

const created: any[] = [];
vi.mock('../src/models/AuditLog.model', () => ({ AuditLog: { create: vi.fn(async (d: any) => { created.push(d); return d; }) } }));
vi.mock('../src/models/Invoice.model', () => ({
  Invoice: {
    findById: vi.fn(() => ({
      lean: async () => ({ _id: 'inv1', invoiceNumber: 'INV0901', discount: 0, subtotal: 1000, total: 1000, customer: 'c1', billDate: new Date('2026-11-05'), payments: [{ amount: 500, method: 'cash' }], items: ['a'] }),
    })),
  },
}));
vi.mock('../src/models/Frame.model', () => ({
  Frame: { findById: vi.fn(() => ({ lean: async () => ({ _id: 'abcdefabcdef12', name: 'JJ-1', sellPrice: 1200, stock: 4 }) })) },
}));

describe('what gets audited', () => {
  it('logs writes only, minus lookups and receipts', () => {
    expect(shouldAudit('GET', '/invoices')).toBe(false);
    expect(shouldAudit('POST', '/invoices')).toBe(true);
    expect(shouldAudit('DELETE', '/frames/abc')).toBe(true);
    expect(shouldAudit('POST', '/lens-pricing/match')).toBe(false);
    expect(shouldAudit('POST', '/lens-pricing/rules')).toBe(true);
    expect(shouldAudit('POST', '/ai/chat')).toBe(false);
    expect(shouldAudit('POST', '/invoices/abc/whatsapp-sent')).toBe(false);
  });
  it('finds the bill id for invoice routes', () => {
    expect(invoiceIdOf('/invoices/abc/payment/0')).toBe('abc');
    expect(invoiceIdOf('/invoices')).toBeNull();
    expect(invoiceIdOf('/invoices/demand')).toBeNull();
    expect(invoiceIdOf('/frames/abc')).toBeNull();
  });
  it('audit log is admin-only', () => {
    expect(requiredRole('GET', '/audit-log')).toBe('admin');
  });
});

describe('redaction', () => {
  it('hides secrets, cuts long strings and caps size', () => {
    expect(redactBody({ name: 'A', password: 'x', apiKey: 'k', img: 'x'.repeat(500) })).toEqual({ name: 'A', password: '[hidden]', apiKey: '[hidden]', img: '[500 chars]' });
    expect(redactBody({})).toBeUndefined();
    expect(redactBody(undefined)).toBeUndefined();
    const big = redactBody({ list: Array.from({ length: 30 }, (_, i) => ({ i, note: 'y'.repeat(250) })) }, 1000) as any;
    expect(typeof big.truncated).toBe('string');
  });
});

describe('events', () => {
  const before = { invoiceNumber: 'INV0901', discount: 0, subtotal: 1000, total: 1000, customer: 'c1', billDate: '2026-11-05T00:00:00.000Z', payments: [{ amount: 500, method: 'cash' }] };

  it('payment added: amount first, method, invoice reference, write-off chip', () => {
    const r = describeEntry({ method: 'PATCH', path: '/invoices/inv1/payment', status: 200, body: { amount: 1500, method: 'online', writeoff: 100 }, before });
    expect(r).toMatchObject({
      kind: 'payment', category: 'payments', action: 'Added payment', badge: 'Payment',
      primary: { label: 'Payment', value: '₹1,500' }, secondary: 'Online payment',
      reference: { type: 'invoice', label: 'Invoice', value: 'INV0901', id: 'inv1' },
      flags: ['writeoff'],
    });
    // Bill was ₹1,000 with ₹500 paid: ₹1,500 + ₹100 write-off settles it.
    expect(r.figures).toEqual([
      { label: 'Method', value: 'Online' },
      { label: 'Write-off', value: '₹100', tone: 'warn' },
      { label: 'Bill total', value: '₹1,000' },
      { label: 'Bill', value: 'Settled', tone: 'good' },
    ]);
    const part = describeEntry({ method: 'PATCH', path: '/invoices/inv1/payment', status: 200, body: { amount: 200, method: 'cash' }, before });
    expect(part.figures).toContainEqual({ label: 'Still due', value: '₹300', tone: 'bad' });
    expect(r.facts).toEqual([
      { label: 'Payment amount', value: '₹1,500' }, { label: 'Payment method', value: 'Online' },
      { label: 'Invoice number', value: 'INV0901' }, { label: 'Write-off', value: '₹100' },
    ]);
  });

  it('bill created: bill number first, customer and total, high discount flagged', () => {
    const r = describeEntry({ method: 'POST', path: '/invoices', status: 201, body: { items: [{}, {}], payments: [{ amount: 500, method: 'cash' }] }, response: { _id: 'n1', invoiceNumber: 'INV0902', total: 850, subtotal: 1000, discount: 150, customerName: 'Ramesh' } });
    expect(r).toMatchObject({
      kind: 'create', category: 'bills', action: 'Created bill', primary: { label: 'Bill', value: 'INV0902' },
      secondary: 'Ramesh · total ₹850', reference: { value: 'INV0902', id: 'n1' }, flags: ['high_discount'],
    });
    expect(r.figures).toEqual([
      { label: 'Total', value: '₹850' },
      { label: 'Discount', value: '₹150 · 15.0%', tone: 'warn' },
      { label: 'Paid · cash', value: '₹500', tone: 'good' },
      { label: 'Due', value: '₹350', tone: 'bad' },
    ]);
  });

  it('small discount is not flagged; free bill is', () => {
    expect(describeEntry({ method: 'POST', path: '/invoices', status: 201, response: { total: 960, subtotal: 1000, discount: 40 } }).flags).toEqual([]);
    // Bill form shape: initialPayments, subtotal from the lines.
    const form = describeEntry({ method: 'POST', path: '/invoices', status: 201, body: { discount: 10, items: [{ price: 310, quantity: 1 }], initialPayments: [{ amount: 300, method: 'online' }] }, response: { invoiceNumber: 'INV0904', total: 300 } });
    expect(form.figures).toEqual([
      { label: 'Total', value: '₹300' },
      { label: 'Discount', value: '₹10 · 3.2%', tone: 'warn' },
      { label: 'Paid · online', value: '₹300', tone: 'good' },
    ]);
    expect(describeEntry({ method: 'POST', path: '/invoices', status: 201, response: { total: 0, subtotal: 1000, discount: 1000 } }).flags).toEqual(['free_bill']);
  });

  it('discount-only edit leads with the discount', () => {
    const r = describeEntry({ method: 'PUT', path: '/invoices/inv1', status: 200, body: { discount: 200 }, before });
    expect(r).toMatchObject({ action: 'Changed discount', primary: { label: 'Discount', value: '₹200' }, secondary: 'was ₹0 · 20.0% of ₹1,000', flags: ['high_discount'] });
    expect(r.changes).toEqual([{ field: 'discount', label: 'Discount', from: 0, to: 200, money: true }]);
    expect(r.figures).toEqual([
      { label: 'Before', value: '₹0' },
      { label: 'After', value: '₹200 · 20.0%', tone: 'warn' },
      { label: 'Bill subtotal', value: '₹1,000' },
      { label: 'New total', value: '₹800' },
    ]);
  });

  it('bill edit lists every changed field with before → after', () => {
    const r = describeEntry({ method: 'PUT', path: '/invoices/inv1', status: 200, body: { discount: 50, payments: [{ amount: 300, method: 'cash' }] }, before });
    expect(r).toMatchObject({ action: 'Edited bill', primary: { value: 'INV0901' }, secondary: 'Changed discount, payments paid' });
    expect(r.changes.map((c) => [c.field, c.from, c.to])).toEqual([['discount', 0, 50], ['payments', 500, 300]]);
    expect(r.flags).toEqual(['payment_edited']);
  });

  it('deletes keep what was removed', () => {
    expect(describeEntry({ method: 'DELETE', path: '/invoices/inv1/payment/0', status: 200, before }))
      .toMatchObject({ kind: 'delete', action: 'Deleted payment', primary: { value: '₹500' }, secondary: 'Cash payment', flags: ['payment_edited'] });
    expect(describeEntry({ method: 'DELETE', path: '/invoices/inv1', status: 200, before }))
      .toMatchObject({ kind: 'delete', action: 'Deleted bill', primary: { value: 'INV0901' }, secondary: 'Total ₹1,000 · paid ₹500', flags: ['deleted'] });
    const frame = describeEntry({ method: 'DELETE', path: '/frames/abcdefabcdef12', status: 200, beforeDoc: { name: 'JJ-1', companyName: 'Tulsi', sellPrice: 900 } });
    expect(frame).toMatchObject({ action: 'Deleted frame', primary: { label: 'Frame', value: 'JJ-1' }, secondary: 'ID abcdefabcdef12' });
    expect(frame.facts).toEqual([{ label: 'Brand', value: 'Tulsi' }, { label: 'Sell price', value: '₹900' }]);
  });

  it('record updates show before → after from the stored record', () => {
    const r = describeEntry({
      method: 'PUT', path: '/frames/abcdefabcdef12', status: 200,
      body: { name: 'JJ-1', sellPrice: 1500, stock: '4', companyName: 'Tulsi' },
      beforeDoc: { name: 'JJ-1', sellPrice: 1200, stock: 4, companyName: 'Tulsi', updatedAt: 'x' },
    });
    expect(r).toMatchObject({ category: 'inventory', action: 'Updated frame', primary: { label: 'Frame', value: 'JJ-1' }, secondary: 'Changed sell price' });
    expect(r.changes).toEqual([{ field: 'sellPrice', label: 'Sell price', from: 1200, to: 1500, money: true }]);
  });

  it('customer update references the customer', () => {
    const r = describeEntry({ method: 'PUT', path: '/customers/abcdefabcdef12', status: 200, body: { mobileNumber: '9825012345' }, beforeDoc: { name: 'Kalu Bhai', mobileNumber: '' } });
    expect(r).toMatchObject({ category: 'customers', action: 'Updated customer', reference: { type: 'customer', value: 'Kalu Bhai', id: 'abcdefabcdef12' } });
    expect(r.changes).toEqual([{ field: 'mobileNumber', label: 'Mobile', from: '', to: '9825012345' }]);
  });

  it('new records list what was entered; failures are marked', () => {
    const r = describeEntry({ method: 'POST', path: '/frames', status: 201, body: { name: 'JJ-1', companyName: 'Tulsi', sellPrice: 900 } });
    expect(r).toMatchObject({ kind: 'create', action: 'Added frame', primary: { value: 'JJ-1' }, secondary: 'Tulsi · ₹900' });
    const failed = describeEntry({ method: 'DELETE', path: '/customers/abcdefabcdef12', status: 404 });
    expect(failed).toMatchObject({ kind: 'failed', action: 'Deleted customer', chips: ['Failed (404)'] });
    expect(failed.flags).toEqual(['failed', 'deleted']);
  });

  it('rebuilds older entries from what they stored', () => {
    const r = rebuildDisplay({
      method: 'PATCH', path: '/invoices/inv1/payment', status: 200, flags: ['writeoff'],
      body: JSON.stringify({ amount: 1500, method: 'online', writeoff: 100 }),
      before: { invoiceNumber: 'INV0634/26-27', total: 1600, payments: [] },
    });
    expect(r).toMatchObject({ action: 'Added payment', primary: { value: '₹1,500' }, reference: { value: 'INV0634/26-27' } });
    expect(r!.figures.map((f) => f.label)).toEqual(['Method', 'Write-off', 'Bill total', 'Bill']);
    expect(rebuildDisplay({ path: '/x' })).toBeNull();
  });

  it('categories', () => {
    expect(categoryOf('/invoices/x/payment')).toBe('payments');
    expect(categoryOf('/invoices')).toBe('bills');
    expect(categoryOf('/lens-stock/adjust')).toBe('inventory');
    expect(categoryOf('/expenses/x')).toBe('finance');
    expect(categoryOf('/coatings')).toBe('settings');
    expect(categoryOf('/whatever')).toBe('other');
  });

  it('diffFields ignores unchanged, blank-equal and bookkeeping fields', () => {
    expect(diffFields({ a: 1, b: '', c: null, updatedAt: 1 }, { a: '1', b: null, c: undefined, updatedAt: 2, d: [1, 2] }))
      .toEqual([{ field: 'd', label: 'D', from: '(none)', to: '1, 2' }]);
    expect(diffFields(null, { a: 1 })).toEqual([]);
  });

  it('diffFields looks inside variants and nested fields', () => {
    const before = {
      name: 'AOH Khus',
      variants: [{ label: '6ml', sellPrice: 200, stock: 4 }, { label: '12ml', sellPrice: 380, stock: 2 }],
      web: { isPublished: true, title: 'Khus' },
      tags: ['attar'],
    };
    const body = {
      name: 'AOH Khus',
      variants: [{ label: '6ml', sellPrice: 220, stock: 4 }, { label: '12ml', sellPrice: 380, stock: 1 }],
      web: { isPublished: false, title: 'Khus' },
      tags: ['attar', 'summer'],
    };
    expect(diffFields(before, body)).toEqual([
      { field: 'variants.0.sellPrice', label: 'Variant 6ml · Sell price', from: 200, to: 220, money: true },
      { field: 'variants.1.stock', label: 'Variant 12ml · Stock', from: 2, to: 1 },
      { field: 'web.isPublished', label: 'Web · Is published', from: true, to: false },
      { field: 'tags', label: 'Tags', from: 'attar', to: 'attar, summer' },
    ]);
  });

  it('archive toggles read as Archived / Restored', () => {
    const archived = describeEntry({ method: 'PATCH', path: '/fragrances/abcdefabcdef12/archive', status: 200, beforeDoc: { name: 'Khus 240', isArchived: false } });
    expect(archived).toMatchObject({ kind: 'update', action: 'Archived fragrance', primary: { label: 'Fragrance', value: 'Khus 240' } });
    expect(archived.changes).toEqual([{ field: 'isArchived', label: 'Archived', from: false, to: true }]);
    const restored = describeEntry({ method: 'PATCH', path: '/fragrances/abcdefabcdef12/archive', status: 200, beforeDoc: { name: 'Khus 240', isArchived: true } });
    expect(restored).toMatchObject({ action: 'Restored fragrance', changes: [{ from: true, to: false }] });
  });

  it('picks only small response fields, customer name, and the target id', () => {
    expect(pickResponse({ data: { _id: 'x', name: 'A', huge: [1, 2] } })).toEqual({ _id: 'x', name: 'A' });
    expect(pickResponse({ _id: 'i', invoiceNumber: 'INV1', customer: { name: 'Ramesh' } })).toEqual({ _id: 'i', invoiceNumber: 'INV1', customerName: 'Ramesh' });
    expect(pickResponse([1])).toBeNull();
    expect(targetIdOf('/frames/abcdefabcdef12/tags')).toBe('abcdefabcdef12');
    expect(targetIdOf('/frames', { _id: 'new1' })).toBe('new1');
  });
});

describe('middleware', () => {
  beforeEach(() => { created.length = 0; });

  const run = async (method: string, path: string, body: unknown, status: number, payload: unknown) => {
    const res: any = Object.assign(new EventEmitter(), { statusCode: status, json: vi.fn() });
    const req: any = { method, path, body, user: { uid: 'u1', email: 'staff@shop.in', role: 'staff', name: 'Asif Staff' } };
    const next = vi.fn();
    await auditTrail(req, res, next);
    expect(next).toHaveBeenCalled();
    res.json(payload);
    res.emit('finish');
    await new Promise((r) => setTimeout(r, 0));
  };

  it('writes one entry with user snapshot, structured event, before-state and cleaned body', async () => {
    await run('PUT', '/invoices/inv1', { discount: 150, token: 'secret' }, 200, { invoiceNumber: 'INV0901', total: 850 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      email: 'staff@shop.in', name: 'Asif Staff', role: 'staff', method: 'PUT', area: 'invoices', targetId: 'inv1', status: 200,
      category: 'bills', action: 'Changed discount', primary: { label: 'Discount', value: '₹150' }, reference: { value: 'INV0901' },
      flags: ['high_discount'], before: { invoiceNumber: 'INV0901', discount: 0, subtotal: 1000 },
    });
    expect(created[0].at).toBeInstanceOf(Date);
    expect(JSON.parse(created[0].body)).toEqual({ discount: 150, token: '[hidden]' });
  });

  it('reads the stored record before an update for before → after', async () => {
    await run('PUT', '/frames/abcdefabcdef12', { sellPrice: 1500 }, 200, { _id: 'abcdefabcdef12', name: 'JJ-1' });
    expect(created[0]).toMatchObject({ action: 'Updated frame', changes: [{ field: 'sellPrice', from: 1200, to: 1500, money: true }] });
  });

  it('skips reads', async () => {
    const next = vi.fn();
    await auditTrail({ method: 'GET', path: '/invoices' } as any, {} as any, next);
    expect(next).toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});

describe('staff names', () => {
  it('STAFF_NAMES maps a full email or the part before @ to a display name', async () => {
    const { env } = await import('../src/config/env');
    const { staffNameFor } = await import('../src/middleware/auth');
    env.STAFF_NAMES.set('abbasmattarwala', 'Abbas Attar');
    env.STAFF_NAMES.set('counter@shop.in', 'Mustafa Bandibar');
    expect(staffNameFor('AbbasMattarwala@gmail.com')).toBe('Abbas Attar');
    expect(staffNameFor('counter@shop.in')).toBe('Mustafa Bandibar');
    expect(staffNameFor('someone@x.com')).toBeUndefined();
    expect(staffNameFor(undefined)).toBeUndefined();
    env.STAFF_NAMES.clear();
  });
});

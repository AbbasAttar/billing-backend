import { describe, expect, it } from 'vitest';
import { billLineToBookRow, cleanLensBookRow, cleanPhone, hasPower } from '../src/services/lensBook';
import { lensTypeOf } from '../src/services/opticsInsights';
import { requiredRole } from '../src/middleware/accessPolicy';

const ok = (raw: Record<string, unknown>) => {
  const r = cleanLensBookRow(raw);
  if ('error' in r) throw new Error(r.error);
  return r.row;
};
const err = (raw: Record<string, unknown>) => {
  const r = cleanLensBookRow(raw);
  return 'error' in r ? r.error : null;
};

describe('cleanLensBookRow', () => {
  it('keeps both eyes, lens spec and prices, and defaults to one pair', () => {
    const row = ok({
      date: '2023-04-12', customer: ' Sakina ', phone: '+91 97370 76376', lensType: 'SV',
      material: 'Fiber', coating: 'Hard Coat', color: 'White', details: 'CR HC',
      rSph: '-1.25', rCyl: '-0.5', rAxis: '90', lSph: '-1', buyPrice: '180', sellPrice: '450',
    });
    expect(row).toMatchObject({
      customer: 'Sakina', phone: '9737076376', lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat',
      rSph: -1.25, rCyl: -0.5, rAxis: 90, rAdd: null, lSph: -1, lCyl: null, qty: 1, buyPrice: 180, sellPrice: 450,
    });
  });

  it('names KT / Kryptok as Bifocal and PAL as Progressive', () => {
    expect(ok({ date: '2023-01-01', lensType: 'KT', sellPrice: 600 }).lensType).toBe('Bifocal');
    expect(ok({ date: '2023-01-01', lensType: 'pal', sellPrice: 2000 }).lensType).toBe('Progressive');
    expect(ok({ date: '2023-01-01', lensType: 'D-Bifocal', sellPrice: 300 }).lensType).toBe('D-Bifocal');
  });

  it('leaves power, mobile and buy price empty when the book has none', () => {
    const row = ok({ date: '2022-11-03', lensType: 'Bifocal', sellPrice: 500, buyPrice: '', phone: '' });
    expect(row).toMatchObject({ rSph: null, lSph: null, phone: null, buyPrice: null });
    expect(hasPower(row)).toBe(false);
    expect(hasPower(ok({ date: '2022-11-03', lensType: 'Bifocal', sellPrice: 500, lAdd: 2 }))).toBe(true);
  });

  it('allows half pairs only', () => {
    expect(ok({ date: '2023-01-01', lensType: 'SV', sellPrice: 200, qty: 0.5 }).qty).toBe(0.5);
    expect(err({ date: '2023-01-01', lensType: 'SV', sellPrice: 200, qty: 0.3 })).toMatch(/half pairs/);
  });

  it('refuses missing date, type or price, bad mobile, axis and powers', () => {
    expect(err({ lensType: 'SV', sellPrice: 200 })).toMatch(/date/);
    expect(err({ date: '2023-01-01', sellPrice: 200 })).toMatch(/lens type/);
    expect(err({ date: '2023-01-01', lensType: 'SV' })).toMatch(/sell price/);
    expect(err({ date: '2023-01-01', lensType: 'SV', sellPrice: 200, phone: '12345' })).toMatch(/10 digits/);
    expect(err({ date: '2023-01-01', lensType: 'SV', sellPrice: 200, rAxis: 200 })).toMatch(/axis/);
    expect(err({ date: '2023-01-01', lensType: 'SV', sellPrice: 200, lSph: 'abc' })).toMatch(/LE SPH/);
    expect(err({ date: '2099-01-01', lensType: 'SV', sellPrice: 200 })).toMatch(/future/);
  });
});

describe('cleanPhone', () => {
  it('takes the last 10 digits of an Indian mobile', () => {
    expect(cleanPhone('+91-97370 76376')).toBe('9737076376');
    expect(cleanPhone('')).toBe('');
    expect(cleanPhone('0123456789')).toBeNull();
  });
});

describe('lens book access', () => {
  it('is admin-only', () => {
    expect(requiredRole('GET', '/lens-book')).toBe('admin');
    expect(requiredRole('POST', '/lens-book')).toBe('admin');
  });
});

describe('billLineToBookRow', () => {
  it('turns a bill lens line into a read-only book row with per-pair prices', () => {
    const row = billLineToBookRow(
      { _id: 'i1', lensType: 'Bifocal', lensMaterial: 'Fiber', quantity: 1, price: 800, costPrice: 300, rightSpherical: 1, rightAddition: 2, leftSpherical: 1.25, leftAddition: 2 },
      { billDate: '2026-10-02', invoiceNumber: 'INV0952/26-27' },
      { _id: 'c1', name: 'Sakina', mobileNumber: '+91 97370 76376' },
      lensTypeOf,
    );
    expect(row).toMatchObject({
      _id: 'bill:i1', source: 'bill', customer: 'Sakina', phone: '9737076376', customerId: 'c1', invoiceNumber: 'INV0952/26-27',
      lensType: 'Bifocal', rSph: 1, rAdd: 2, lSph: 1.25, qty: 1, sellPrice: 800, buyPrice: 300,
    });
  });

  it('shows only the eye a single-eye line covers, as half a pair', () => {
    const row = billLineToBookRow({ _id: 'i2', lensType: 'Single Vision', eye: 'left', quantity: 1, price: 400, rightSpherical: -3, leftSpherical: -1 }, undefined, undefined, lensTypeOf);
    expect(row).toMatchObject({ rSph: null, lSph: -1, qty: 0.5, sellPrice: 800, customer: null });
  });
});

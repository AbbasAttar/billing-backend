import { describe, it, expect } from 'vitest';
import { buildOpticsInsights, coatingOf, lensPairs, lensTypeOf } from '../src/services/opticsInsights';

const now = new Date('2026-10-14T10:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe('lens helpers', () => {
  it('type comes from the category; product names in the type field are Other', () => {
    expect(lensTypeOf({ lensType: 'Progressive', lensCategory: 'Progressive' })).toBe('Progressive');
    expect(lensTypeOf({ lensType: 'CR Drivemax Coat AMS25', lensCategory: 'Single Vision' })).toBe('Single Vision');
    expect(lensTypeOf({ lensType: 'CR Tinted' })).toBe('Other');
  });
  it('coatings and pairs', () => {
    expect(coatingOf({ lensCoating: 'Hard Coat' })).toBe('Hard Coat');
    expect(coatingOf({ lensCoating: 'Blue Cut Blue' })).toBe('Blue Cut');
    expect(coatingOf({ lensCoating: 'Anti-Reflective' })).toBe('Anti-Reflective');
    expect(coatingOf({ lensCoating: 'Night Drive' })).toBe('Other');
    expect(lensPairs({ quantity: 1, eye: 'both' })).toBe(1);
    expect(lensPairs({ quantity: 1, eye: 'right' })).toBe(0.5);
  });
});

describe('buildOpticsInsights', () => {
  const frames = [
    { _id: 'a', name: 'Aviator', companyName: 'Tulsi', costPrice: 400, stock: 1, createdAt: ago(30) },
    { _id: 'b', name: 'Dust Proof', companyName: 'TULSI', costPrice: 100, stock: 9, createdAt: ago(30) },
    { _id: 'c', name: 'Kids', companyName: 'Tusli', stock: 2, createdAt: ago(30) },
    { _id: 'u', name: 'Unknown', companyName: 'First Time', stock: 50 },
    { _id: 'q', name: 'Quick Add', companyName: '', stock: 0 },
    { _id: 's', name: 'Shades', companyName: 'Ray', type: 'Sunglass', costPrice: 500, stock: 3, createdAt: ago(30) },
  ];
  const invoices = [
    { billDate: ago(1), items: [{ frame: 'a', quantity: 1, price: 5040, costPrice: 400 }, { lensCategory: 'Single Vision', lensCoating: 'Blue Cut', eye: 'both', rightSpherical: -1, leftSpherical: -1, quantity: 1, price: 1500 }] },
    { billDate: ago(2), items: [{ frame: 'b', quantity: 1, price: 300, costPrice: 100 }] },
    { billDate: ago(3), items: [{ frame: 'b', quantity: 2, price: 300, costPrice: 100 }, { lensCategory: 'Bifocal', lensCoating: 'Hard Coat', eye: 'both', rightSpherical: 0, leftSpherical: 0, rightAddition: 2.5, leftAddition: 2.5, quantity: 1, price: 700 }] },
    { billDate: ago(4), items: [{ frame: 'u', quantity: 1, price: 900 }, { frame: 'q', quantity: 1, price: 600 }] },
    { billDate: ago(5), items: [{ frame: 's', quantity: 1, price: 1200, costPrice: 500 }] },
  ];
  const lensStock = [
    { lensType: 'Single Vision', material: 'Fiber', coating: 'Blue Cut', color: 'White', sph: -1, cyl: 0, quantity: 0 },
    { lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat', color: 'Photo Chromatic', sph: -3, cyl: 0, quantity: 0 },
    { lensType: 'Bifocal', material: 'Fiber', coating: 'Hard Coat', color: 'White', sph: 0, cyl: 0, add: 2.5, quantity: 0 },
    { lensType: 'Progressive', material: 'Fiber', coating: 'Hard Coat', color: 'White', sph: 0, cyl: 0, add: 1, quantity: 0 },
  ];
  const out = buildOpticsInsights({ invoices, previousInvoices: [{ billDate: ago(40), items: [{ frame: 'b', quantity: 1, price: 4000 }] }], frames, lensStock, days: 30, now });

  it('ranks models by units and leaves catch-alls out of rankings, price bands and stock', () => {
    expect(out.topModels.map((m) => m.name)).toEqual(['Dust Proof', 'Aviator', 'Shades']);
    expect(out.topModels[0]).toMatchObject({ units: 3, avgPrice: 300 });
    expect(out.priceBands.map((b) => b.units)).toEqual([3, 0, 1, 1]);
    expect(out.frames.mixedRevenue).toBe(1500);
    expect(out.frames.units).toBe(5);
  });

  it('groups brand spellings and computes sell-through with stock', () => {
    const tulsi = out.brands.find((b) => b.brand.toLowerCase() === 'tulsi')!;
    expect(tulsi).toMatchObject({ units: 4, inStock: 10 });
    expect(tulsi.sellThroughPct).toBe(Number(((4 / 14) * 100).toFixed(1)));
    expect(out.fixData.brandSpellings.some((g) => g.includes('Tusli') && g.includes('Tulsi'))).toBe(true);
  });

  it('attach rate uses retail spectacle bills only (no sunglasses, no catch-all only bills)', () => {
    expect(out.attach).toEqual({ pct: 66.7, bills: 3, withLens: 2 });
  });

  it('lens grid by type and coating, with upgrade rate and price per pair', () => {
    const sv = out.lensGrid.find((r) => r.type === 'Single Vision')!;
    expect(sv.cells.find((c) => c.coating === 'Blue Cut')).toMatchObject({ pairs: 1, avgPerPair: 1500 });
    expect(out.lenses.upgradePct).toBe(50);
    expect(out.lenses.avgPerPair).toBe(1100);
  });

  it('restock: sold powers first, progressives left out', () => {
    expect(out.restock.outOfStock).toBe(3);
    expect(out.restock.sellingOut).toBe(2);
    expect(out.restock.rows.slice(0, 2).map((r) => [r.lensType, r.sph, r.sold])).toEqual([['Bifocal', 0, 2], ['Single Vision', -1, 2]]);
    expect(out.restock.rows[2]).toMatchObject({ sph: -3, sold: 0, color: 'Photo Chromatic' });
    expect(out.restock.rows.every((r) => r.lensType !== 'Progressive')).toBe(true);
    expect(out.guidance[0].title).toMatch(/Re-order 2 lens powers/);
  });

  it('compares revenue with the previous period and hides ageing without history', () => {
    expect(out.frames.previousRevenue).toBe(4000);
    expect(out.frameStock.historyDays).toBe(30);
    expect(out.frameStock.aged).toEqual([]);
  });
});

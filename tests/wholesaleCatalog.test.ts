import { describe, it, expect } from 'vitest';
import {
  entryKey, fragranceUpdateFor, parseEntryKey, stockPerWholesaleUnit, wholesaleEntries,
} from '../src/services/wholesaleCatalog';
import { applyWsStock, resolveWsTarget, wholesaleReadIds } from '../src/services/wholesaleStock';

const bulk: any = {
  _id: 'oil', name: 'Majmua', companyName: 'Hindustan', type: 'attar', unit: 'bottle', costPrice: 29, sellPrice: 0, stock: 10,
  wholesale: { price: 35, unit: 'per bottle' }, ws: { reorderLevel: 4, isOrdered: true, orderedQty: 6 }, variants: [],
};
const graded: any = {
  _id: 'chandan', name: 'Chandan', companyName: 'AOH', type: 'attar', costPrice: 0, sellPrice: 240, stock: 0,
  variants: [
    { label: 'Regular', sellPrice: 240, stock: 24, costPrice: 60 },
    { label: 'Premium', sellPrice: 400, stock: 12, costPrice: 120, wholesale: { price: 2800, unit: 'per 100ml' } },
  ],
};
const retailOnly: any = { _id: 'rose', name: 'Rose', companyName: 'AOH', type: 'attar', sellPrice: 300, stock: 3, variants: [] };

describe('wholesale catalogue view', () => {
  it('keys', () => {
    expect(entryKey('a')).toBe('a');
    expect(entryKey('a', 'Premium')).toBe('a~Premium');
    expect(parseEntryKey('a~Premium 6ml')).toEqual({ fragranceId: 'a', optionLabel: 'Premium 6ml' });
  });

  it('unit conversion: 100ml of attar counted in tolas', () => {
    expect(stockPerWholesaleUnit('per bottle', 'bottle')).toBe(1);
    expect(stockPerWholesaleUnit('per 100ml', 'tola')).toBeCloseTo(100 / 12);
    expect(stockPerWholesaleUnit('per kg', 'tola')).toBe(1);
    expect(stockPerWholesaleUnit('per 25g', 'tola')).toBeCloseTo(2.5);
    expect(stockPerWholesaleUnit('per 25 gm', 'tola')).toBeCloseTo(2.5);
  });

  it('lists plain products and options with a wholesale price only', () => {
    const e = wholesaleEntries([bulk, graded, retailOnly]);
    expect(e.map((x) => x._id)).toEqual(['chandan~Premium', 'oil']);
    expect(e.find((x) => x._id === 'oil')).toMatchObject({
      name: 'Majmua', unit: 'bottle', sellPrice: 35, costPrice: 29, stock: 10, reorderLevel: 4, isOrdered: true, orderedQty: 6,
    });
    // 12 tolas of Premium = 1.44 × 100 ml; cost per 100 ml = 120 × 100/12
    expect(e.find((x) => x._id === 'chandan~Premium')).toMatchObject({ unit: '100ml', stock: 1.44, costPrice: 1000 });
  });

  it('writes changes back in stock units', () => {
    expect(fragranceUpdateFor(bulk, null, { stockDelta: 5, sellPrice: 40, ws: { isOrdered: false } })).toEqual({
      stock: 15, wholesale: { price: 40, unit: 'per bottle' }, ws: { reorderLevel: 4, isOrdered: false, orderedQty: 6 },
    });
    const u: any = fragranceUpdateFor(graded, 'Premium', { stockDelta: 1 });
    expect(u.variants[1].stock).toBeCloseTo(12 + 100 / 12, 1);
    expect(u.stock).toBeCloseTo(24 + 12 + 100 / 12, 1);
    expect(fragranceUpdateFor(graded, 'Super', { stock: 1 })).toEqual({ error: 'Grade / size not found' });
  });
});

describe('wholesale lines on bills', () => {
  it('reads old items and fragrances, follows moved items', () => {
    const ids = wholesaleReadIds(['oldWs', 'chandan~Premium']);
    expect(ids.legacyIds).toEqual(['oldWs']);
    expect([...ids.fragranceIds].sort()).toEqual(['chandan', 'oldWs']);
    const frs = new Map([['oil', bulk], ['chandan', graded]]);
    const legacy = new Map([['oldWs', { migratedTo: 'oil' }], ['unmoved', { stock: 3 }]]);
    expect(resolveWsTarget('oldWs', frs, legacy)).toEqual({ fragranceId: 'oil', optionLabel: null });
    expect(resolveWsTarget('chandan~Premium', frs, legacy)).toEqual({ fragranceId: 'chandan', optionLabel: 'Premium' });
    expect(resolveWsTarget('unmoved', frs, legacy)).toBeNull();
  });

  it('sells and puts back stock without touching the retail price', () => {
    const update: Record<string, any> = {};
    const out = applyWsStock({ fragranceId: 'oil', optionLabel: null }, -3, bulk, update);
    expect(update).toEqual({ stock: 7 });
    expect(out).toEqual({ unitCost: 29, name: 'Majmua (Hindustan)', unit: 'bottle' });
    const u2: Record<string, any> = {};
    const o2 = applyWsStock({ fragranceId: 'chandan', optionLabel: 'Premium' }, -1, graded, u2);
    expect(u2.variants[1].stock).toBeCloseTo(12 - 100 / 12, 1);
    expect(u2.sellPrice).toBeUndefined();
    expect(o2.unit).toBe('100ml');
  });
});

describe('moving wholesale items into the catalogue', () => {
  it('maps fields, keeps order state and the link back', async () => {
    const { fragranceFromWholesale } = await import('../src/scripts/migrateWholesaleToFragrances');
    const f = fragranceFromWholesale({
      _id: 'w1', name: 'Mix Fruit', companyName: 'Hindustan', companyId: 'c1', unit: 'bottle', costPrice: 29, sellPrice: 35, stock: 3,
      reorderLevel: 2, isOrdered: true, orderedQty: 10, orderedAt: new Date('2026-10-10'),
    });
    expect(f).toMatchObject({
      name: 'Mix Fruit', companyName: 'Hindustan', companyId: 'c1', type: 'attar', unit: 'bottle',
      channels: { retail: false, wholesale: true, rawMaterial: true }, costPrice: 29, sellPrice: 0, stock: 3,
      wholesale: { price: 35, unit: 'per bottle' }, ws: { reorderLevel: 2, isOrdered: true, orderedQty: 10 }, legacyWholesaleId: 'w1',
    });
    expect(fragranceFromWholesale({ _id: 'w2', name: '3 ML Gold Cap', companyName: 'Bottle', unit: 'bottle', sellPrice: 4 }).type).toBe('packaging');
    expect(fragranceFromWholesale({ _id: 'w3', name: 'Spray Water', companyName: 'Bottle', unit: 'litre', sellPrice: 215 }).type).toBe('essence');
    // The view built from the moved record looks like the old item.
    const [entry] = wholesaleEntries([{ ...f, _id: 'new1' } as any]);
    expect(entry).toMatchObject({ _id: 'new1', name: 'Mix Fruit', unit: 'bottle', sellPrice: 35, costPrice: 29, stock: 3, isOrdered: true, orderedQty: 10 });
  });
});

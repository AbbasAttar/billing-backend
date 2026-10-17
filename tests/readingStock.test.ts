import { describe, it, expect } from 'vitest';
import { buildReadingStock, SHELF_POWERS } from '../src/services/readingStock';

const readers = {
  _id: 'rd', name: 'Reading Glasses', companyName: 'Local', category: 'reading', readingType: 'Single Vision',
  costPrice: 60, storePrice: 199, stock: 6,
  web: { frameVariants: [
    { colors: [{ name: 'Black', hex: '#000' }], power: 1, stock: 2 },
    { colors: [{ name: 'Transparent', hex: '#eee' }], power: 1, stock: 1 },
    { colors: [{ name: 'Black', hex: '#000' }], power: 2.75, stock: 1 },
    { colors: [{ name: 'Black', hex: '#000' }], power: 2, stock: 0 },
  ] },
};
const optical = { _id: 'op', name: 'JJ-1', companyName: 'Tulsi', category: 'optical', costPrice: 400, stock: 5 };

describe('buildReadingStock', () => {
  const invoices = [{ items: [
    { frame: 'rd', type: 'frame', quantity: 1, price: 199, frameVariantLabel: 'Black · +2.00' },
    { frame: 'rd', type: 'frame', quantity: 1, price: 199, frameVariantLabel: 'Black · +1.00' },
    { frame: 'rd', type: 'frame', quantity: 1, price: 199 },
    { frame: 'op', type: 'frame', quantity: 1, price: 1200 },
  ] }];
  const r = buildReadingStock({ invoices, frames: [readers, optical], days: 90 });
  const row = (label: string) => r.powers.find((p) => p.label === label)!;

  it('lists every shelf power with stock by colour', () => {
    expect(r.powers).toHaveLength(SHELF_POWERS.length);
    expect(row('+1.00')).toMatchObject({ stock: 3, sold: 1, colors: { Black: { stock: 2, sold: 1 }, Transparent: { stock: 1, sold: 0 } }, types: { 'Single Vision': 3 } });
    expect(row('+2.75')).toMatchObject({ stock: 1, status: 'low' });
    expect(row('+2.50')).toMatchObject({ stock: 0, status: 'out' });
  });

  it('flags sold-out powers that sell, and pieces without a power', () => {
    expect(row('+2.00')).toMatchObject({ stock: 0, sold: 1, status: 'out-selling' });
    expect(r.reorder).toEqual([{ power: '+2.00', sold: 1 }]);
    // 6 in stock, 4 in variants: 2 have no power.
    expect(r.unassigned).toEqual([{ id: 'rd', name: 'Reading Glasses', brand: 'Local', pieces: 2 }]);
    expect(r.totals).toMatchObject({ pieces: 6, cost: 360, sellValue: 1194, models: 1, soldUnits: 3, soldNoPower: 1 });
  });
});

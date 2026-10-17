import { describe, it, expect } from 'vitest';
import { buildReadingStock, frameTypeLabel, SHELF_POWERS } from '../src/services/readingStock';

const full = {
  _id: 'rd', name: 'Reading Glasses', companyName: 'Local', category: 'reading', type: 'Full Rim',
  costPrice: 60, storePrice: 199, stock: 6,
  web: { frameVariants: [
    { colors: [{ name: 'Black', hex: '#000' }], power: 1, stock: 2 },
    { colors: [{ name: 'Transparent', hex: '#eee' }], power: 1, stock: 1 },
    { colors: [{ name: 'Black', hex: '#000' }], power: 2.75, stock: 1 },
    { colors: [{ name: 'Black', hex: '#000' }], power: 2, stock: 0 },
  ] },
};
const supra = {
  _id: 'sp', name: 'Supra Reader', companyName: 'Local', category: 'reading', type: 'Half Rim',
  costPrice: 80, storePrice: 249, stock: 5,
  web: { frameVariants: [{ colors: [], power: 1.5, stock: 5 }] },
};
const optical = { _id: 'op', name: 'JJ-1', companyName: 'Tulsi', category: 'optical', costPrice: 400, stock: 5 };

describe('buildReadingStock', () => {
  const sale = (frame: string, label?: string) => ({ frame, type: 'frame', quantity: 1, price: 199, frameVariantLabel: label });
  const invoices = [{ items: [
    sale('rd', 'Black · +2.00'), sale('rd', 'Black · +2.00'), sale('rd', 'Black · +2.00'),
    sale('rd', 'Black · +1.00'), sale('rd'), sale('op'),
  ] }];
  const r = buildReadingStock({ invoices, frames: [full, supra, optical], days: 60 });
  const row = (label: string) => r.powers.find((p) => p.label === label)!;

  it('names frame types the way the counter does', () => {
    expect(frameTypeLabel('Full Rim')).toBe('Full');
    expect(frameTypeLabel('Half Rim')).toBe('Supra');
    expect(frameTypeLabel('Rimless')).toBe('3-piece');
    expect(frameTypeLabel(undefined)).toBe('Type not set');
  });

  it('lists every plus power with pieces by frame type', () => {
    expect(r.powers).toHaveLength(SHELF_POWERS.length);
    expect(r.types).toEqual(['Full', 'Supra']);
    expect(row('+1.00')).toMatchObject({ stock: 3, sold: 1, types: { Full: { stock: 3, sold: 1 } } });
    expect(row('+1.50')).toMatchObject({ stock: 5, types: { Supra: { stock: 5, sold: 0 } } });
  });

  it('says which power each type holds most of and sells most', () => {
    expect(r.byType.find((t) => t.type === 'Full')).toMatchObject({ models: 1, pieces: 4, sold: 4, mostStocked: { power: '+1.00', pieces: 3 }, topSeller: { power: '+2.00', sold: 3 } });
    expect(r.byType.find((t) => t.type === 'Supra')).toMatchObject({ pieces: 5, mostStocked: { power: '+1.50', pieces: 5 }, topSeller: null });
  });

  it('orders enough for 60 days of sales, at least 2 per power', () => {
    // +2.00: 3 sold in 60 days, none left → keep 3, order 3 (Full sold them).
    expect(r.order[0]).toEqual({ power: '+2.00', stock: 0, sold: 3, order: 3, reason: 'sold out', type: 'Full' });
    // +1.50: 5 on the shelf, no sales → nothing to order.
    expect(r.order.find((o) => o.power === '+1.50')).toBeUndefined();
    // +2.75: 1 left, no sales → top up to the minimum of 2.
    expect(r.order.find((o) => o.power === '+2.75')).toMatchObject({ order: 1, reason: 'below minimum', type: 'Full' });
    // Full: 6 in stock, 4 in variants, so 2 pieces have no power.
    expect(r.unassigned).toEqual([{ id: 'rd', name: 'Reading Glasses', brand: 'Local', pieces: 2 }]);
    expect(r.totals).toMatchObject({ pieces: 11, models: 2, soldUnits: 5, soldNoPower: 1 });
  });
});

describe('reading frames x power table', () => {
  const r = buildReadingStock({
    invoices: [{ items: [{ frame: 'rd', type: 'frame', quantity: 1, price: 199, frameVariantLabel: 'Black · +1.00' }] }],
    frames: [
      { _id: 'rd', name: 'Metal Reading', companyName: 'Local', category: 'reading', type: 'Full Rim', stock: 4,
        web: { frameVariants: [{ colors: [{ name: 'Black' }], power: 1, stock: 2 }, { colors: [{ name: 'Gold' }], power: 1, stock: 1 }, { colors: [], power: 2.5, stock: 1 }] } },
      { _id: 'sp', name: 'Supra Reader', companyName: 'Local', category: 'reading', type: 'Half Rim', stock: 0, web: { frameVariants: [] } },
    ],
    days: 30,
  });

  it('has one row per reading frame with pieces at each power', () => {
    expect(r.powerLabels[0]).toBe('+1.00');
    expect(r.powerLabels.at(-1)).toBe('+3.00');
    expect(r.frames.map((f) => [f.name, f.type])).toEqual([['Metal Reading', 'Full'], ['Supra Reader', 'Supra']]);
    expect(r.frames[0]).toMatchObject({ stock: 4, sold: 1, noPower: 0 });
    expect(r.frames[0].powers['+1.00']).toEqual({ stock: 3, sold: 1 });
    expect(r.frames[0].powers['+2.50']).toEqual({ stock: 1, sold: 0 });
    expect(r.frames[1].stock).toBe(0);
  });
});

describe('powers outside the shelf', () => {
  const r = buildReadingStock({
    invoices: [],
    frames: [{ _id: 'od', name: 'Old Reader', companyName: 'Local', category: 'reading', type: 'Full Rim', stock: 3,
      web: { frameVariants: [{ colors: [], power: 3.5, stock: 2 }, { colors: [], power: 4, stock: 1 }] } }],
    days: 30,
  });

  it('shows +3.50 / +4.00 as clearance columns and never orders them', () => {
    expect(r.powerLabels.slice(-2)).toEqual(['+3.50', '+4.00']);
    expect(r.clearanceLabels).toEqual(['+3.50', '+4.00']);
    expect(r.powers.find((p) => p.label === '+3.50')).toMatchObject({ stock: 2, stocked: false, status: 'clearance', order: 0 });
    expect(r.order.map((o) => o.power)).not.toContain('+4.00');
    expect(r.frames[0].powers['+4.00']).toEqual({ stock: 1, sold: 0 });
  });
});

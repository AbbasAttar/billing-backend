import { describe, it, expect } from 'vitest';
import { cleanFrameAttrs, frameDocAttrs, learnFromSale, lineFrameAttrs, missingModelAttrs, saleSnapshot, tagFrameSet } from '../src/services/frameAttributes';
import { buildFrameMix } from '../src/services/frameMix';
import { frameVariantName } from '../src/services/invoiceLineProduct';

const square = {
  _id: 'sq', name: 'JJ-1', companyName: 'Tulsi', type: 'Full Rim', category: 'optical', costPrice: 400, sellPrice: 1200, storePrice: 999, stock: 3,
  web: { shape: 'Square', material: 'Metal', frameVariants: [
    { colors: [{ name: 'Black', hex: '#000' }], size: 52, stock: 1 },
    { colors: [{ name: 'Gold', hex: '#d4af37' }], size: 54, stock: 1 },
  ] },
};
const reader = { _id: 'rd', name: 'Reading Glasses', companyName: 'Local', costPrice: 60, sellPrice: 200, stock: 10, web: { frameVariants: [{ colors: [], power: 1.5, stock: 4 }] } };
const quickAdd = { _id: 'qa', name: 'Quick Add', companyName: 'Quick Add', stock: 0 };
const bare = { _id: 'br', name: 'XY-9', companyName: 'Tulsi', type: 'Half Rim', costPrice: 300, sellPrice: 900, stock: 2 };

describe('frame attributes', () => {
  it('variant names include eye size and power; old colour-only names unchanged', () => {
    expect(frameVariantName({ colors: [{ name: 'Black' }] })).toBe('Black');
    expect(frameVariantName({ colors: [{ name: 'Black' }], size: 52 })).toBe('Black · 52mm');
    expect(frameVariantName({ colors: [], power: 1.5 })).toBe('+1.50');
    expect(frameVariantName({ label: 'Custom', colors: [], power: 2 })).toBe('Custom');
  });

  it('reads model + variant attributes and guesses reading category from the name', () => {
    expect(frameDocAttrs(square, 'Gold · 54mm')).toEqual({ category: 'optical', rim: 'Full Rim', shape: 'Square', material: 'Metal', color: 'Gold', size: 54 });
    expect(frameDocAttrs(reader, '+1.50')).toMatchObject({ category: 'reading', power: 1.5 });
  });

  it('cleans counter input and lets the line override the record', () => {
    expect(cleanFrameAttrs({ category: 'SUNGLASS', shape: ' ', size: '52', bogus: 1 })).toEqual({ category: 'sunglass', size: 52 });
    expect(lineFrameAttrs({ frameAttrs: { color: 'Red' }, frameVariantLabel: 'Black · 52mm' }, square)).toMatchObject({ color: 'Red', size: 52, shape: 'Square' });
    expect(saleSnapshot(bare, null, { shape: 'Round' })).toEqual({ rim: 'Half Rim', shape: 'Round' });
  });

  it('learns only missing model details, never on catch-all frames', () => {
    expect(learnFromSale(bare, { category: 'optical', shape: 'Round', rim: 'Full Rim', size: 50, color: 'Black' }))
      .toEqual({ category: 'optical', 'web.shape': 'Round', 'web.frameSize.lensWidth': 50 });
    expect(learnFromSale(square, { shape: 'Round', size: 50 })).toEqual({});
    expect(learnFromSale(quickAdd, { shape: 'Round' })).toEqual({});
    // A guessed category can still be recorded.
    expect(learnFromSale(reader, { category: 'reading' })).toEqual({ category: 'reading' });
  });

  it('lists what the tag queue should ask for', () => {
    expect(missingModelAttrs(bare)).toEqual(['category', 'shape', 'material', 'size', 'color']);
    expect(missingModelAttrs(square)).toEqual([]);
    expect(tagFrameSet({ category: 'kids', rim: 'Rimless', color: 'Blue', size: 46 }))
      .toEqual({ category: 'kids', type: 'Rimless', 'web.color': 'Blue', 'web.frameSize.lensWidth': 46 });
  });
});

describe('buildFrameMix', () => {
  const invoices = [
    { items: [
      { frame: 'sq', type: 'frame', quantity: 1, price: 1000, costPrice: 400, frameVariantLabel: 'Black · 52mm', frameAttrs: { category: 'optical', color: 'Black', size: 52 } },
      { frame: 'rd', type: 'frame', quantity: 2, price: 200, costPrice: 60, frameVariantLabel: '+1.50' },
    ] },
    { items: [
      { frame: 'qa', type: 'frame', quantity: 1, price: 500, frameAttrs: { category: 'sunglass', shape: 'Aviator' } },
      { frame: 'qa', type: 'frame', quantity: 1, price: 300 },
      'unpopulated-id',
    ] },
  ];
  const mix = buildFrameMix({ invoices, frames: [square, reader, quickAdd, bare] });
  const view = (k: string) => mix.views.find((v) => v.key === k)!;

  it('counts sales by attribute with coverage', () => {
    expect(mix.soldUnits).toBe(5);
    const cat = view('category');
    expect(cat.taggedUnits).toBe(4);
    expect(cat.coveragePct).toBe(80);
    expect(cat.rows.find((r) => r.value === 'Reading')).toMatchObject({ units: 2, revenue: 400 });
    expect(cat.rows.find((r) => r.value === 'Sunglass')).toMatchObject({ units: 1, marginPct: null });
    expect(view('shape').rows.map((r) => r.value)).toEqual(['Square', 'Aviator']); // tie on units: more stock first
    expect(view('power')).toMatchObject({ soldUnits: 2, taggedUnits: 2 });
  });

  it('puts shelf stock on variants first, rest on the model', () => {
    // square: 1 Black 52, 1 Gold 54, 1 untyped piece; reader: 4 at +1.50, 6 unsplit; bare: 2.
    expect(mix.stock).toMatchObject({ units: 15, cost: 3 * 400 + 10 * 60 + 2 * 300, sellValue: 3 * 999 + 10 * 200 + 2 * 900 });
    const size = view('size');
    expect(size.rows.find((r) => r.value === '52 mm')).toMatchObject({ units: 1, inStock: 1, sellThroughPct: 50 });
    expect(size.rows.find((r) => r.value === '54 mm')).toMatchObject({ units: 0, inStock: 1 });
    expect(view('power').rows.find((r) => r.value === '+1.50')).toMatchObject({ units: 2, inStock: 4 });
    expect(view('rim').rows.find((r) => r.value === 'Half rim')).toMatchObject({ inStock: 2, stockCost: 600 });
  });
});

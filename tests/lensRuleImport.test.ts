import { describe, it, expect } from 'vitest';
import { planFromRules, indexFor, featuresFromCoatingName, pairPrice, type OldRule } from '../src/services/lensRuleImport';
import { quoteLens, type Catalog } from '../src/services/lensCatalogCompare';
import type { IBrandCoating, ILensProduct } from '../src/models/LensCatalog.model';

const rule = (o: Partial<OldRule>): OldRule => ({
  lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat', color: 'White',
  minSph: -6, maxSph: 0, minCyl: -2, maxCyl: 0, minAdd: null, maxAdd: null, price: 150, costPrice: 40, ...o,
});

describe('planFromRules', () => {
  it('doubles hand rules entered per lens, keeps imported and per-pair ones', () => {
    expect(pairPrice(rule({}))).toEqual({ srp: 300, cost: 80 });
    expect(pairPrice(rule({ priceUnit: 'pair' }))).toEqual({ srp: 150, cost: 40 });
    expect(pairPrice(rule({ wholesaler: 'Enterprise' }))).toEqual({ srp: 150, cost: 40 });
  });

  it('groups hand rules by type and material, photochromic as a variant', () => {
    const { coatings, products } = planFromRules([
      rule({}),
      rule({ coating: 'Anti-Reflective', price: 225 }),
      rule({ coating: 'Blue Cut', color: 'Photo Chromatic', price: 400 }),
      rule({ material: 'Polycarbonate', coating: 'Blue Cut', price: 400 }),
    ]);
    expect(coatings.map((c) => c.name)).toEqual(['Hard Coat', 'Anti-Reflective', 'Blue Cut']);
    const names = products.map((p) => p.name);
    expect(names).toEqual(['Local SV Fiber', 'Local SV Fiber Photo', 'Local SV Polycarbonate']);
    expect(products[0].rows.map((r) => [r.coating, r.index, r.maxCyl, r.srp])).toEqual([['Hard Coat', 1.56, 2, 300], ['Anti-Reflective', 1.56, 2, 450]]);
    expect(products[1]).toMatchObject({ features: ['photochromic'], variantOfKey: products[0].key });
    expect(products[2].rows[0].index).toBe(1.59);
  });

  it('keeps imported brands as products, joining High Cyl and Plus ranges to their base', () => {
    const w = { wholesaler: 'Enterprise', coating: 'Hard Coat (HC)', minSph: 0, maxSph: 8, minCyl: 0, maxCyl: 2 };
    const { products } = planFromRules([
      rule({ ...w, brand: 'Scratch Guard 56', price: 450 }),
      rule({ ...w, brand: 'Scratch Guard 56 High Cyl', minCyl: 2.25, maxCyl: 4, price: 650 }),
      rule({ ...w, brand: 'Egalite 67 MR7 Ultra-Thin', coating: 'Blue Block 1.67 SHMC', price: 2800 }),
    ]);
    expect(products.map((p) => [p.name, p.rows.length])).toEqual([['Scratch Guard 56', 2], ['Egalite 67 MR7 Ultra-Thin', 1]]);
    expect(products[0].rows[1]).toMatchObject({ maxCyl: 4, srp: 650 });
    expect(products[1].rows[0].index).toBe(1.67);
  });

  it('reads index and coating features from names', () => {
    expect(indexFor('Fiber', 'Freeform Digital 1.60')).toBe(1.6);
    expect(indexFor('Glass', 'Hard Coat')).toBe(1.52);
    expect(featuresFromCoatingName('Blue Block SHMC')).toEqual(expect.arrayContaining(['hardCoat', 'antiReflection', 'waterRepel', 'blueFilter']));
    expect(featuresFromCoatingName('Hard Coat')).toEqual(['hardCoat']);
  });
});

describe('quoteLens (bill pickers)', () => {
  const coatings = [
    { _id: 'hc', company: 'Local', name: 'Hard Coat', features: ['hardCoat'] },
    { _id: 'bc', company: 'Local', name: 'Blue Cut', features: ['blueFilter'] },
  ] as unknown as IBrandCoating[];
  const sv = { minAdd: null, maxAdd: null };
  const products = [
    { _id: 'f', company: 'Local', name: 'Local SV Fiber', lensType: 'Single Vision', tier: 'Entry', features: [], active: true, rows: [
      { index: 1.56, minSph: -6, maxSph: 0, maxCyl: 2, ...sv, prices: { hc: { srp: 300, cost: 80 }, bc: { srp: 500, cost: 110 } } },
      { index: 1.56, minSph: -8, maxSph: -6.25, maxCyl: 2, ...sv, prices: { hc: { srp: 500, cost: 110 } } },
    ] },
    { _id: 'fp', company: 'Local', name: 'Local SV Fiber Photo', lensType: 'Single Vision', tier: 'Entry', features: ['photochromic'], active: true, rows: [
      { index: 1.56, minSph: -6, maxSph: 0, maxCyl: 2, ...sv, prices: { bc: { srp: 800, cost: 350 } } },
    ] },
    { _id: 'p', company: 'Local', name: 'Local SV Polycarbonate', lensType: 'Single Vision', tier: 'Entry', features: [], active: true, rows: [
      { index: 1.59, minSph: -6, maxSph: 0, maxCyl: 2, ...sv, prices: { bc: { srp: 800, cost: 400 } } },
    ] },
  ] as unknown as ILensProduct[];
  const catalog: Catalog = { coatings, products, addons: [] };
  const q = (o: Record<string, unknown>) => quoteLens(catalog, { lensType: 'Single Vision', coating: 'Hard Coat', material: 'Fiber', photochromic: false, rx: { right: { sph: -2 }, left: { sph: -3 } }, ...o });

  it('prices from the line that fits every eye', () => {
    expect(q({})).toMatchObject({ srp: 300, cost: 80, product: 'Local SV Fiber', index: 1.56 });
    // The bill asks once per eye (each eye half its pair price), as the old rules did.
    expect(q({ rx: { right: { sph: -7 } } })?.srp).toBe(500);
    expect(q({ rx: { right: { sph: -7 }, left: { sph: -3 } } })).toBeNull();
  });

  it('respects material, colour and coating', () => {
    expect(q({ coating: 'Blue Cut', material: 'Polycarbonate' })?.srp).toBe(800);
    expect(q({ coating: 'Blue Cut', photochromic: true })?.product).toBe('Local SV Fiber Photo');
    expect(q({ coating: 'Anti-Reflective' })).toBeNull();
    expect(q({ rx: { right: { sph: -9 } } })).toBeNull();
  });
});

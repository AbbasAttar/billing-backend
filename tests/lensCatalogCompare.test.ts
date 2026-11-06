import { describe, it, expect } from 'vitest';
import { coatingClass, rxNeeds, rowCovers, compareLenses, priceWith, type Catalog } from '../src/services/lensCatalogCompare';
import type { ILensProduct, IBrandCoating, ILensAddon } from '../src/models/LensCatalog.model';

const coat = (o: Partial<IBrandCoating> & { _id: string }): IBrandCoating =>
  ({ company: 'Prime', name: o._id, features: ['hardCoat', 'antiReflection'], ...o }) as IBrandCoating;

const row = (index: number, prices: Record<string, [number, number]>, o: Record<string, unknown> = {}) => ({
  index, minSph: -8, maxSph: 6, maxCyl: 4, minAdd: 0.75, maxAdd: 3.5,
  prices: Object.fromEntries(Object.entries(prices).map(([k, [srp, cost]]) => [k, { srp, cost }])),
  ...o,
});

const product = (o: Partial<ILensProduct> & { _id: string }): ILensProduct =>
  ({ company: 'Prime', name: o._id, lensType: 'Progressive', tier: 'Mid', features: [], rows: [], active: true, ...o }) as ILensProduct;

const progressiveRx = {
  right: { sph: -3.5, cyl: -1.25, axis: 180, add: 2 },
  left: { sph: -4.25, cyl: -0.75, axis: 170, add: 2 },
};

const catalog = (): Catalog => ({
  coatings: [
    coat({ _id: 'duron' }),
    coat({ _id: 'vmax', features: ['hardCoat', 'antiReflection', 'waterRepel', 'uv'] }),
    coat({ _id: 'rock', company: 'Essilor', features: ['hardCoat', 'antiReflection', 'waterRepel', 'uv', 'blueFilter'] }),
    coat({ _id: 'easy', company: 'Essilor', features: ['hardCoat', 'antiReflection', 'waterRepel', 'uv'] }),
  ],
  products: [
    product({ _id: 'proton', rows: [row(1.56, { duron: [5300, 2900], vmax: [6000, 3300] }), row(1.6, { duron: [6400, 3500] })] }),
    product({ _id: 'blublock', variantOf: 'proton', features: ['blueFilter'], rows: [row(1.56, { vmax: [6700, 3700] })] }),
    product({ _id: 'liberty', company: 'Essilor', tier: 'Premium', rows: [row(1.56, { easy: [12100, 7200], rock: [13800, 8200] })] }),
    product({ _id: 'sv', lensType: 'Single Vision', rows: [row(1.56, { duron: [1200, 500] })] }),
    product({ _id: 'narrow', rows: [row(1.56, { duron: [2000, 1000] }, { minSph: -3, maxSph: 3 })] }),
  ],
  addons: [
    { _id: 'bluv', company: 'Essilor', name: 'Blue UV Capture', kind: 'fixed', srp: 500, cost: 300, feature: 'blueFilter', productIds: [], coatingIds: [], excludeCoatingIds: [] } as unknown as ILensAddon,
    { _id: 'fog', company: 'Essilor', name: 'Fog-free', kind: 'fixed', srp: 2000, cost: 1200, feature: 'antiFog', productIds: [], coatingIds: ['rock'], excludeCoatingIds: [] } as unknown as ILensAddon,
  ],
});

describe('coatingClass', () => {
  it('climbs HC → AR → AR+ → Blue → Drive', () => {
    expect(coatingClass(['hardCoat'])).toBe('HC');
    expect(coatingClass(['hardCoat', 'antiReflection'])).toBe('AR');
    expect(coatingClass(['antiReflection', 'waterRepel'])).toBe('AR+');
    expect(coatingClass(['antiReflection', 'blueFilter'])).toBe('Blue');
    expect(coatingClass(['antiReflection', 'blueFilter', 'nightDrive'])).toBe('Drive');
  });
});

describe('rxNeeds', () => {
  it('never offers single vision when there is an ADD', () => {
    expect(rxNeeds(progressiveRx).types).not.toContain('Single Vision');
    expect(rxNeeds({ right: { sph: -2 } }).types).toEqual(['Single Vision']);
  });

  it('picks the minimum index from the strongest meridian of either eye', () => {
    const n = rxNeeds(progressiveRx);
    expect(n.maxPower).toBe(5);
    expect(n.minIndex).toBe(1.6);
    expect(rxNeeds({ right: { sph: -9 } })).toMatchObject({ minIndex: 1.74, lenticular: true });
  });
});

describe('rowCovers', () => {
  it('checks SPH range, CYL size and ADD range for every eye', () => {
    expect(rowCovers(row(1.6, {}), progressiveRx)).toBe(true);
    expect(rowCovers(row(1.6, {}, { minSph: -4, maxSph: 4 }), progressiveRx)).toBe(false);
    expect(rowCovers(row(1.6, {}, { maxCyl: 1 }), progressiveRx)).toBe(false);
    expect(rowCovers(row(1.6, {}, { maxAdd: 1.5 }), progressiveRx)).toBe(false);
  });
});

describe('priceWith', () => {
  it('adds fixed add-ons, then scales by percent ones', () => {
    expect(priceWith(10000, 6000, [
      { id: 'a', name: 'Fog', kind: 'fixed', srp: 2000, cost: 1000, feature: null },
      { id: 'b', name: '65 dia', kind: 'percent', srp: -5, cost: 0, feature: null },
    ])).toEqual({ srp: 11400, cost: 6650 });
  });
});

describe('compareLenses', () => {
  it('lists fitting products of the picked type only, cheapest index + coating each', () => {
    const { offers, needs, hidden } = compareLenses(catalog(), progressiveRx, { type: 'Progressive' });
    expect(needs.minIndex).toBe(1.6);
    // Proton at the advised 1.60 (its 1.56 offered as a cheaper thicker choice); Liberty only comes in 1.56, so it shows flagged.
    expect(offers.map((o) => [o.productId, o.index, o.coatingId, o.belowAdvisedIndex])).toEqual([
      ['proton', 1.6, 'duron', false],
      ['liberty', 1.56, 'easy', true],
    ]);
    expect(offers[0].thickerOption).toEqual({ index: 1.56, coating: 'duron', srp: 5300 });
    expect(offers[0].variants.map((v) => v.productId)).toEqual(['blublock']);
    expect(hidden).toBe(1); // narrow doesn't cover −4.25
  });

  it('returns nothing for single vision when the Rx has an ADD', () => {
    expect(compareLenses(catalog(), progressiveRx, { type: 'Single Vision' }).offers).toEqual([]);
  });

  it('adds a company add-on when the wanted feature is not built in', () => {
    const rx = { right: { sph: -1, add: 2 }, left: { sph: -1.5, add: 2 } };
    const { offers } = compareLenses(catalog(), rx, { type: 'Progressive', features: ['blueFilter'] });
    const byId = Object.fromEntries(offers.map((o) => [o.productId, o]));
    expect(byId.blublock).toMatchObject({ srp: 6700, addons: [] });
    expect(byId.liberty).toMatchObject({ coatingId: 'easy', srp: 12600, cost: 7500 });
    expect(byId.liberty.addons.map((a) => a.name)).toEqual(['Blue UV Capture']);
    expect(byId.proton).toBeUndefined();
  });

  it('folds variants under their base product when no feature is asked for', () => {
    const rx = { right: { sph: -1, add: 2 } };
    const { offers } = compareLenses(catalog(), rx, { type: 'Progressive' });
    const proton = offers.find((o) => o.productId === 'proton')!;
    expect(proton.variants.map((v) => v.product)).toEqual(['blublock']);
    expect(offers.some((o) => o.productId === 'blublock')).toBe(false);
  });

  it('respects the minimum coating class and add-on coating limits', () => {
    const rx = { right: { sph: -1, add: 2 } };
    const { offers } = compareLenses(catalog(), rx, { type: 'Progressive', minCoatingClass: 'AR+' });
    expect(offers.find((o) => o.productId === 'proton')?.coatingId).toBe('vmax');
    const liberty = offers.find((o) => o.productId === 'liberty')!;
    expect(liberty.coatingId).toBe('easy');
    expect(liberty.optionalAddons.map((a) => a.name)).toEqual(['Blue UV Capture']);
  });
});

describe('one index split into power ranges', () => {
  it('prices each prescription from the row whose SPH range fits', () => {
    const c = catalog();
    c.products = [product({
      _id: 'variation', lensType: 'Single Vision', rows: [
        row(1.56, { duron: [1360, 700] }, { minSph: -6, maxSph: 0, maxCyl: 2, minAdd: null, maxAdd: null }),
        row(1.56, { duron: [1480, 820] }, { minSph: -8, maxSph: -6, maxCyl: 2, minAdd: null, maxAdd: null }),
      ],
    })];
    const low = compareLenses(c, { right: { sph: -2 }, left: { sph: -2.5 } }, { type: 'Single Vision' }).offers[0];
    const high = compareLenses(c, { right: { sph: -7 }, left: { sph: -7.5 } }, { type: 'Single Vision' }).offers;
    expect(low.srp).toBe(1360);
    expect(low.belowAdvisedIndex).toBe(false);
    // −7 is advised 1.67 by default; the 1.56 row still sells, flagged as thicker than advised.
    expect(high[0]).toMatchObject({ srp: 1480, index: 1.56, belowAdvisedIndex: true });
  });

  it('keeps the advised index first and offers a cheaper thicker one as a choice', () => {
    const c = catalog();
    c.products = [product({
      _id: 'sigma', lensType: 'Single Vision', rows: [
        row(1.56, { duron: [1500, 800] }, { minAdd: null, maxAdd: null }),
        row(1.67, { duron: [3200, 1700] }, { minAdd: null, maxAdd: null }),
      ],
    })];
    const [o] = compareLenses(c, { right: { sph: -7 } }, { type: 'Single Vision' }).offers;
    expect(o).toMatchObject({ index: 1.67, srp: 3200, belowAdvisedIndex: false, thickerOption: { index: 1.56, srp: 1500 } });
  });
});

describe('cylinder sign', () => {
  const r = row(1.56, { duron: [1000, 500] }, { minSph: -4, maxSph: 2, maxCyl: 2, minAdd: null, maxAdd: null });
  it('matches minus and plus cyl by size', () => {
    expect(rowCovers(r, { right: { sph: -1, cyl: -2 } })).toBe(true);
    expect(rowCovers(r, { right: { sph: -3, cyl: 2 } })).toBe(true); // = −1.00 / −2.00
  });
  it('transposes a plus-cyl Rx before checking the SPH range', () => {
    expect(rowCovers(r, { right: { sph: 1, cyl: 2 } })).toBe(false); // = +3.00 / −2.00, beyond +2
  });
});

describe('overlapping ranges of one coating', () => {
  it('quotes the cheaper narrow range when it fits, the wider dearer one only beyond it', () => {
    const c = catalog();
    const sv = { minAdd: null, maxAdd: null, maxCyl: -4, dia: '65' };
    c.products = [product({
      _id: 'sigma', lensType: 'Single Vision', rows: [
        row(1.56, { duron: [1472, 368] }, { ...sv, minSph: -6, maxSph: 0 }),
        row(1.56, { duron: [2040, 512] }, { ...sv, minSph: -8, maxSph: 0 }),
      ],
    })];
    const settings = { indexByPower: [{ upTo: 20, index: 1.5 }], maxIndex: 1.74, lenticularAbove: 20, tierMeanings: {}, indexMeanings: {} };
    const at = (sph: number) => compareLenses(c, { right: { sph, cyl: -3 } }, { type: 'Single Vision' }, settings).offers[0]?.srp;
    expect(at(-5)).toBe(1472);
    expect(at(-7)).toBe(2040);
  });
});

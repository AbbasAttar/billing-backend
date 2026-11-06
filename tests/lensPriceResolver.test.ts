import { describe, it, expect } from 'vitest';
import {
  applyMarkup,
  axisTypeFor,
  composeFromBook,
  resolveLensPrice,
  ruleCompany,
  DEFAULT_MARKUP,
  type RuleLike,
} from '../src/services/lensPriceResolver';
import type { ILensPriceBook } from '../src/models/LensPriceBook.model';

const spec = { company: 'Local', lensType: 'Single Vision', material: 'Fiber', coating: 'Blue Cut', color: 'White' };
const rx = { sph: -1, cyl: 0, add: null, axisType: 'ready' as const };

const book = (o: Partial<ILensPriceBook> = {}): ILensPriceBook => ({
  company: 'Local',
  bases: [{ lensType: 'Single Vision', material: 'Fiber', cost: 120, sell: 400 }],
  sphBands: [
    { min: -4, max: 4, cost: 0, sell: 0 },
    { min: -6, max: -4.25, cost: 40, sell: 150 },
  ],
  cylBands: [
    { min: 0, max: 2, cost: 0, sell: 0 },
    { min: 2.25, max: 4, cost: 60, sell: 200 },
  ],
  addBands: [],
  coatings: [{ coating: 'Blue Cut', cost: 150, sell: 500 }],
  colors: [{ color: 'Photo Chromatic', cost: 250, sell: 800 }],
  crossAxis: { cost: 30, sell: 100 },
  ...o,
});

const rule = (o: Partial<RuleLike> = {}): RuleLike => ({
  _id: 'r1', lensType: 'Single Vision', material: 'Fiber', coating: 'Blue Cut', color: 'White', axisType: 'any',
  minSph: -4, maxSph: 0, minCyl: 0, maxCyl: 2, minAdd: null, maxAdd: null, price: 999, costPrice: 300, ...o,
});

describe('applyMarkup', () => {
  it('uses the slab for the cost and rounds up to 50', () => {
    expect(applyMarkup(300)).toBe(900);     // 3×
    expect(applyMarkup(1000)).toBe(2500);   // 2.5×
    expect(applyMarkup(3000)).toBe(6000);   // 2×
    expect(applyMarkup(8000)).toBe(12800);  // 1.6×
    expect(applyMarkup(333)).toBe(1000);    // 999 → 1000
  });

  it('never goes under cost + minimum margin', () => {
    expect(applyMarkup(100, { ...DEFAULT_MARKUP, slabs: [{ x: 1.1 }] })).toBe(400);
  });

  it('uses tier slabs when the tier has its own', () => {
    const policy = { ...DEFAULT_MARKUP, tierSlabs: { luxury: [{ x: 1.5 }] } };
    expect(applyMarkup(3000, policy, 'luxury')).toBe(4500);
    expect(applyMarkup(3000, policy, 'premium')).toBe(6000);
  });
});

describe('axisTypeFor', () => {
  it('treats 90 ± 10 minus cyl and 180 ± 10 plus cyl as ready', () => {
    expect(axisTypeFor(-1, 90)).toBe('ready');
    expect(axisTypeFor(-1, 45)).toBe('cross');
    expect(axisTypeFor(1, 175)).toBe('ready');
    expect(axisTypeFor(1, 90)).toBe('cross');
    expect(axisTypeFor(0, 45)).toBe('ready');
  });
});

describe('ruleCompany', () => {
  it('falls back to wholesaler, then Local', () => {
    expect(ruleCompany({ company: 'Kodak' })).toBe('Kodak');
    expect(ruleCompany({ wholesaler: 'Enterprise Ophthalmics' })).toBe('Enterprise Ophthalmics');
    expect(ruleCompany({})).toBe('Local');
  });
});

describe('composeFromBook', () => {
  it('adds base, power bands, coating, tint and cross axis', () => {
    const lines = composeFromBook(book(), { ...spec, color: 'Photo Chromatic' }, { sph: -5, cyl: -2.5, add: null, axisType: 'cross' })!;
    expect(lines.reduce((s, l) => s + l.cost, 0)).toBe(120 + 40 + 60 + 150 + 250 + 30);
    expect(lines.reduce((s, l) => s + (l.sell ?? 0), 0)).toBe(400 + 150 + 200 + 500 + 800 + 100);
  });

  it('leaves zero-cost base bands out of the breakdown', () => {
    const lines = composeFromBook(book(), spec, rx)!;
    expect(lines.map((l) => l.label)).toEqual(['Single Vision Fiber', 'Blue Cut']);
  });

  it('returns null when the book does not cover the combination', () => {
    expect(composeFromBook(book(), { ...spec, material: 'Glass' }, rx)).toBeNull();
    expect(composeFromBook(book(), spec, { ...rx, sph: -8 })).toBeNull();
    expect(composeFromBook(book(), spec, { ...rx, cyl: -5 })).toBeNull();
    expect(composeFromBook(book(), { ...spec, coating: 'HMC' }, rx)).toBeNull();
    expect(composeFromBook(book(), { ...spec, color: 'Polarized' }, rx)).toBeNull();
    expect(composeFromBook(book(), spec, { ...rx, add: 2 })).toBeNull();
  });

  it('prices ADD from add bands', () => {
    const b = book({ bases: [{ lensType: 'Progressive', material: 'Fiber', cost: 500, sell: 1500 }], addBands: [{ min: 0.75, max: 3.5, cost: 0, sell: 0 }] });
    expect(composeFromBook(b, { ...spec, lensType: 'Progressive' }, { ...rx, add: 2 })).not.toBeNull();
  });
});

describe('resolveLensPrice', () => {
  it('prefers an exact rule for the same company', () => {
    const r = resolveLensPrice(spec, rx, { rules: [rule()], book: book() });
    expect(r).toMatchObject({ source: 'rule', sell: 999, cost: 300, ruleId: 'r1', marginOk: true });
  });

  it('ignores rules from another company', () => {
    const r = resolveLensPrice(spec, rx, { rules: [rule({ company: 'Kodak' })], book: book() });
    expect(r.source).toBe('book');
  });

  it('adds up the SRP of every part', () => {
    const r = resolveLensPrice(spec, rx, { rules: [], book: book(), company: { name: 'Local', tier: 'essential' } });
    expect(r).toMatchObject({ source: 'book', cost: 270, sell: 900, marginOk: true });
  });

  it('marks up the total cost when the book has costs only', () => {
    const kodak = { ...spec, company: 'Kodak' };
    const costOnly = book({
      company: 'Kodak',
      bases: [{ lensType: 'Single Vision', material: 'Fiber', cost: 800 }],
      coatings: [{ coating: 'Blue Cut', cost: 400 }],
    });
    const r = resolveLensPrice(kodak, rx, { rules: [], book: costOnly, company: { name: 'Kodak', tier: 'premium' } });
    expect(r).toMatchObject({ source: 'book', cost: 1200, sell: 3000 });
  });

  it('marks up from cost when any part lacks an SRP', () => {
    const partial = book({ coatings: [{ coating: 'Blue Cut', cost: 150 }] });
    const r = resolveLensPrice(spec, rx, { rules: [], book: partial });
    expect(r).toMatchObject({ source: 'book', cost: 270, sell: 850 });
  });

  it('falls back to the last purchase cost', () => {
    const r = resolveLensPrice(spec, { ...rx, sph: -9 }, { rules: [], book: book(), lastCost: 600 });
    expect(r).toMatchObject({ source: 'purchase', cost: 600, sell: 1500 });
  });

  it('reports missing when nothing prices it', () => {
    expect(resolveLensPrice(spec, rx, { rules: [] })).toMatchObject({ source: 'missing', sell: null, marginOk: null });
  });

  it('flags a rule priced under the minimum margin', () => {
    const r = resolveLensPrice(spec, rx, { rules: [rule({ price: 500, costPrice: 400 })] });
    expect(r.marginOk).toBe(false);
  });
});

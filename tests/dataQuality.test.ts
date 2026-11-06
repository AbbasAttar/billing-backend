import { describe, it, expect } from 'vitest';
import { cogsFigures, costGroups, isSharedAccount, normalizeMobile, paginate, phoneProblem } from '../src/services/dataQuality';
import { requiredRole } from '../src/middleware/accessPolicy';

describe('phone numbers', () => {
  it('normalizes +91 / 0 prefixes', () => {
    expect(normalizeMobile('+91 98250 12345')).toBe('9825012345');
    expect(normalizeMobile('09825012345')).toBe('9825012345');
  });
  it('flags missing, wrong length, placeholders and reported-wrong numbers', () => {
    expect(phoneProblem('')).toBe('missing');
    expect(phoneProblem(undefined)).toBe('missing');
    expect(phoneProblem('98250')).toBe('wrong_length');
    expect(phoneProblem('0000000000')).toBe('placeholder');
    expect(phoneProblem('9999999999')).toBe('placeholder');
    expect(phoneProblem('1234567890')).toBe('placeholder');
    expect(phoneProblem('5825012345')).toBe('placeholder');
    expect(phoneProblem('9825012345', true)).toBe('reported_wrong');
    expect(phoneProblem('9825012345')).toBeNull();
  });
});

describe('shared accounts', () => {
  it('matches walk-in style names only', () => {
    for (const name of ['Walk-in Client', 'walk in', 'WALKIN', 'Unknown', 'Cash', 'Guest Customer', 'Walk-by']) {
      expect(isSharedAccount({ name })).toBe(true);
    }
    expect(isSharedAccount({ name: 'Unknown Ahmed' })).toBe(false);
    expect(isSharedAccount({ name: 'Kalu Bhai' })).toBe(false);
  });
});

describe('cost groups', () => {
  const frames = [
    { _id: 'f1', name: 'JJ-1', companyName: 'Tulsi', costPrice: 0 },
    { _id: 'f2', name: 'BH-9', houseName: 'Classic', companyName: 'Ben Hunt', costPrice: 450 },
    { _id: 'unk', name: 'Unknown', companyName: 'Tulsi' },
  ];
  const lenses = [{ _id: 'l1', brand: 'Essilor', name: 'Crizal', category: 'Single Vision', index: '1.56', coating: 'AR', costPrice: 300 }];
  const items = [
    { _id: 'a', frame: 'f1', quantity: 1, price: 500 },
    { _id: 'b', frame: 'f1', quantity: 2, price: 450 },
    { _id: 'c', frame: 'f2', quantity: 1, price: 1200 },
    { _id: 'd', frame: 'f2', quantity: 1, price: 1200, costPrice: 450 },
    { _id: 'e', frame: 'unk', quantity: 1, price: 700 },
    { _id: 'g', frame: 'f1', quantity: 1, price: 0 },
    { _id: 'h', frame: 'f1', quantity: 1, price: 400, returnedQty: 1 },
    { _id: 'i', opticalLens: { _id: 'l1' }, type: 'opticalLens', quantity: 1, price: 800 },
    { _id: 'j', isCustomLens: true, lensBrand: 'Kodak', lensName: 'Clean', lensCategory: 'Progressive', lensIndex: '1.6', price: 2500, quantity: 1 },
    { _id: 'k', isCustomLens: true, lensBrand: 'kodak ', lensName: 'Clean', lensCategory: 'Progressive', lensIndex: '1.6', price: 2400, quantity: 1 },
    { _id: 'm', isCustomLens: true, lensBrand: 'Kodak', lensName: 'Clean', lensCategory: 'Progressive', lensIndex: '1.6', price: 2400, quantity: 1, costPrice: 1100 },
  ];

  it('groups uncosted frame lines by frame, skips catch-alls, ₹0 and returned lines', () => {
    const g = costGroups(items, frames, lenses, 'frame');
    expect(g.map((x) => x.key)).toEqual(['frame|f1', 'frame|f2']);
    expect(g[0]).toMatchObject({ lines: 2, units: 3, revenue: 1400, avgPrice: 467, productCost: null, lineIds: ['a', 'b'] });
    expect(g[1]).toMatchObject({ title: 'Classic', productCost: 450, suggestedCost: 450, lineIds: ['c'] });
  });

  it('groups lens lines by product spec, suggests the cost already used on its other lines', () => {
    const g = costGroups(items, frames, lenses, 'lens');
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ title: 'Kodak Clean', lines: 2, revenue: 4900, suggestedCost: 1100, lineIds: ['j', 'k'] });
    expect(g[1]).toMatchObject({ title: 'Essilor Crizal', productCost: 300, lensIds: ['l1'], lineIds: ['i'] });
  });
});

describe('cogs figures', () => {
  it('matches the invoice controller formula', () => {
    expect(cogsFigures({ total: 1000, packagingCost: 35 }, [{ quantity: 2, costPrice: 200 }, { quantity: 1 }])).toEqual({
      totalCogs: 400,
      netContributionMargin: 565,
      contributionMarginPct: 56.5,
    });
    expect(cogsFigures({ total: 0 }, [])).toEqual({ totalCogs: 0, netContributionMargin: 0, contributionMarginPct: 0 });
  });
});

describe('paginate', () => {
  it('clamps page and limit', () => {
    const list = Array.from({ length: 45 }, (_, i) => i);
    expect(paginate(list, '9', '20')).toMatchObject({ page: 3, pages: 3, limit: 20, slice: [40, 41, 42, 43, 44] });
    expect(paginate([], undefined, undefined)).toMatchObject({ page: 1, pages: 1 });
  });
});

describe('access', () => {
  it('data-quality is admin-only', () => {
    expect(requiredRole('GET', '/data-quality/summary')).toBe('admin');
    expect(requiredRole('POST', '/data-quality/costs')).toBe('admin');
  });
});

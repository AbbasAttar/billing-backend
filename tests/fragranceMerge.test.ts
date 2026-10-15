import { describe, it, expect } from 'vitest';
import { mergePlan } from '../src/services/fragranceMerge';
import { requiredRole } from '../src/middleware/accessPolicy';

describe('merging duplicate fragrances', () => {
  it('plain products: stock adds up, missing cost filled, channels and notes combined', () => {
    const r = mergePlan(
      { _id: 'a', stock: 3, costPrice: 0, channels: { retail: true }, scent: { top: ['Oud'] } },
      { _id: 'b', stock: 2.5, costPrice: 120, channels: { wholesale: true }, scent: { top: ['oud', 'Rose'] }, gender: 'men' },
    );
    expect(r).toEqual({ update: {
      stock: 5.5, costPrice: 120, channels: { retail: true, wholesale: true }, 'scent.top': ['Oud', 'oud', 'Rose'], gender: 'men',
    } });
  });

  it('grades: same label adds up, new grades are added', () => {
    const r: any = mergePlan(
      { _id: 'a', variants: [{ label: 'Premium', stock: 2, costPrice: 100 }] },
      { _id: 'b', variants: [{ label: 'premium ', stock: 1 }, { label: 'Super', stock: 4, costPrice: 300 }] },
    );
    expect(r.update.variants).toEqual([{ label: 'Premium', stock: 3, costPrice: 100 }, { label: 'Super', stock: 4, costPrice: 300 }]);
    expect(r.update.stock).toBe(7);
  });

  it('refuses mixing plain and graded, or the same product', () => {
    expect(mergePlan({ _id: 'a', variants: [{ label: 'x', stock: 1 }] }, { _id: 'b', stock: 1 })).toHaveProperty('error');
    expect(mergePlan({ _id: 'a' }, { _id: 'a' })).toHaveProperty('error');
  });

  it('is owner-only', () => {
    expect(requiredRole('POST', '/fragrances/abc/merge')).toBe('admin');
    expect(requiredRole('POST', '/fragrances')).toBe('staff');
  });
});

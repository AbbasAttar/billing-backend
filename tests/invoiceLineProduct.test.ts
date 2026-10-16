import { describe, it, expect } from 'vitest';
import { moveOptionStock, productCost } from '../src/services/invoiceLineProduct';

describe('productCost', () => {
  it('takes the grade cost first, then the product cost', () => {
    const f = { costPrice: 100, variants: [{ label: '6ml', costPrice: 40 }, { label: '12ml' }] };
    expect(productCost('fragrance', f, '6ml')).toBe(40);
    expect(productCost('fragrance', f, '12ml')).toBe(100);
    expect(productCost('frame', { costPrice: 2520 })).toBe(2520);
    expect(productCost('frame', null)).toBe(0);
  });
});

describe('moveOptionStock', () => {
  it('puts stock back on the old option and takes it from the new one, in one update per product', () => {
    const frame = { web: { frameVariants: [{ label: 'Black', stock: 1 }, { colors: [{ name: 'Gold' }], stock: 3 }] } };
    const pending = new Map<string, any>();
    moveOptionStock('frame', 'f1', frame, 'Black', 1, pending);
    moveOptionStock('frame', 'f1', frame, 'Gold', -1, pending);
    expect(pending.get('f1')['web.frameVariants'].map((v: any) => v.stock)).toEqual([2, 2]);
    expect(frame.web.frameVariants[0].stock).toBe(1); // the read copy is not changed
  });

  it('leaves products without that option alone and never goes below zero', () => {
    const pending = new Map<string, any>();
    moveOptionStock('frame', 'w', { name: 'Wholesale' }, 'Black', -1, pending);
    moveOptionStock('fragrance', 'r', { variants: [{ label: '6ml', stock: 0 }] }, '6ml', -2, pending);
    expect(pending.has('w')).toBe(false);
    expect(pending.get('r').variants[0].stock).toBe(0);
  });
});

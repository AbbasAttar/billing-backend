import { describe, it, expect } from 'vitest';
import { orderAfterInward } from '../src/controllers/wholesaleItem.controller';

describe('orderAfterInward', () => {
  it('keeps the rest on order after a part delivery', () => {
    expect(orderAfterInward(20, 12)).toEqual({ isOrdered: true, orderedQty: 8 });
  });
  it('closes the order when everything (or more) arrived, or no quantity was recorded', () => {
    const closed = { isOrdered: false, orderedQty: null, orderedAt: null };
    expect(orderAfterInward(20, 20)).toEqual(closed);
    expect(orderAfterInward(20, 25)).toEqual(closed);
    expect(orderAfterInward(null, 5)).toEqual(closed);
  });
});

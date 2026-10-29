import { describe, it, expect } from 'vitest';
import { parseRefillInput, planRefill } from '../src/services/fragranceRefill';

const attar = { _id: 'rose', name: 'Rose', type: 'attar', stock: 5, variants: [
  { label: 'Regular', stock: 5, costPrice: 100, sellPrice: 300 },
  { label: 'Premium', stock: 0, sellPrice: 500 },
] };
const bulk = { _id: 'bulk', name: 'Rose bulk oil', type: 'attar', costPrice: 120, stock: 10, variants: [] };
const docs = () => new Map<string, any>([['rose', structuredClone(attar)], ['bulk', structuredClone(bulk)]]);

describe('parseRefillInput', () => {
  it('needs a quantity, a source and, from wholesale, the product', () => {
    expect(parseRefillInput({ qty: 0, source: 'outside' })).toEqual({ error: 'Quantity must be more than 0' });
    expect(parseRefillInput({ qty: 2 })).toHaveProperty('error');
    expect(parseRefillInput({ qty: 2, source: 'wholesale' })).toHaveProperty('error');
    expect(parseRefillInput({ qty: 2, source: 'outside', totalCost: -1 })).toHaveProperty('error');
    expect(parseRefillInput({ qty: '2', source: 'outside', supplier: ' Kannauj ', totalCost: '240' }))
      .toMatchObject({ qty: 2, source: 'outside', supplier: 'Kannauj', totalCost: 240 });
  });
});

describe('planRefill', () => {
  it('from wholesale: takes stock off the bulk oil and averages the cost', () => {
    const plan = planRefill('rose', docs(), { qty: 5, source: 'wholesale', optionLabel: 'Regular', fromFragranceId: 'bulk' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.updates.get('bulk')).toEqual({ stock: 5 });
    const rose = plan.updates.get('rose')!;
    expect(rose.variants[0]).toMatchObject({ stock: 10, costPrice: 110 });
    expect(rose.stock).toBe(10);
    expect(plan.record).toMatchObject({ totalCost: 600, costPerUnit: 120, stockBefore: 5, stockAfter: 10, costBefore: 100, costAfter: 110, fromQty: 5, fromUnit: 'tola', unit: 'tola' });
  });

  it('bought outside into an empty option: cost is the refill cost', () => {
    const plan = planRefill('rose', docs(), { qty: 2, source: 'outside', optionLabel: 'Premium', totalCost: 500, supplier: 'Kannauj' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.updates.has('bulk')).toBe(false);
    expect(plan.updates.get('rose')!.variants[1]).toMatchObject({ stock: 2, costPrice: 250 });
  });

  it('no cost known: stock goes up, cost stays', () => {
    const plan = planRefill('bulk', docs(), { qty: 3, source: 'outside' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.updates.get('bulk')).toEqual({ stock: 13 });
    expect(plan.record.totalCost).toBeNull();
  });

  it('taking more than the wholesale stock stops it at 0 and notes the shortfall', () => {
    const plan = planRefill('rose', docs(), { qty: 12, source: 'wholesale', optionLabel: 'Regular', fromFragranceId: 'bulk', totalCost: 0 });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.updates.get('bulk')).toEqual({ stock: 0 });
    expect(plan.record.shortBy).toBe(2);
  });

  it('refill from another option of the same product writes both on one doc', () => {
    const plan = planRefill('rose', docs(), { qty: 1, source: 'wholesale', optionLabel: 'Premium', fromFragranceId: 'rose', fromOptionLabel: 'Regular' });
    if ('error' in plan) throw new Error(plan.error);
    const v = plan.updates.get('rose')!.variants;
    expect(v[0].stock).toBe(4);
    expect(v[1]).toMatchObject({ stock: 1, costPrice: 100 });
  });

  it('rejects a missing option and refilling from itself', () => {
    expect(planRefill('rose', docs(), { qty: 1, source: 'outside' })).toHaveProperty('error');
    expect(planRefill('bulk', docs(), { qty: 1, source: 'wholesale', fromFragranceId: 'bulk' })).toHaveProperty('error');
  });
});

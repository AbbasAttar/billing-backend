import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/models/LensStock.model', () => ({ LensStock: { collectionName: 'lensstocks' } }));

import {
  LensStockMoves,
  LensStockShortError,
  needsKey,
  sourceFromBody,
  sourceOfStored,
  stockRowFits,
} from '../src/services/lensStockMoves';

/** In-memory stand-in for the Firestore transaction: rows by id, updates recorded. */
function fakeTx(rows: any[]) {
  const updates: Record<string, number> = {};
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    updates,
    tx: {
      query: async (_m: any, f: any) => rows.filter((r) => r.lensType === f.lensType),
      getMany: async (_m: any, ids: string[]) => new Map(ids.filter((id) => byId.has(id)).map((id) => [id, byId.get(id)])),
      update: async (_m: any, id: string, patch: any) => { updates[id] = patch.quantity; },
    } as any,
  };
}

const row = (id: string, o: any = {}) => ({
  id, lensType: 'Progressive', material: 'Fiber', coating: 'Hard Coat', color: 'White',
  sph: 0, cyl: 0, axis: null, add: 2, quantity: 6, ...o,
});
const line = (o: any = {}) => ({
  type: 'opticalLens', lensType: 'Progressive', lensMaterial: 'Fiber', lensCoating: 'Hard Coat', lensColor: 'White', eye: 'both',
  rightSpherical: 0, rightCylinder: null, rightAxis: null, rightAddition: 2,
  leftSpherical: 0, leftCylinder: null, leftAxis: null, leftAddition: 2, ...o,
});

describe('lens source', () => {
  it('reads the source picked on the bill', () => {
    expect(sourceFromBody({ fulfillmentSource: 'stock', sendToWholesaler: false })).toBe('counter');
    expect(sourceFromBody({ fulfillmentSource: 'stock', alreadyOrdered: true, sendToWholesaler: false })).toBe('already');
    expect(sourceFromBody({ fulfillmentSource: 'local' })).toBe('local');
    expect(sourceFromBody({ fulfillmentSource: 'ordered', sendToWholesaler: true })).toBe('ordered');
  });

  it('does not take a lab job the queue marked fitted or cancelled for counter stock', () => {
    expect(sourceOfStored({ fulfillmentSource: 'stock', sentToWholesaler: false, labStatus: 'fitted' })).toBe('counter');
    expect(sourceOfStored({ fulfillmentSource: 'stock', sentToWholesaler: false, labFittedDate: new Date() })).toBe('ordered');
    expect(sourceOfStored({ fulfillmentSource: 'stock', sentToWholesaler: true, labFittedDate: new Date() })).toBe('already');
    expect(sourceOfStored({ fulfillmentSource: 'stock', sentToWholesaler: false, labStatus: 'cancelled' })).toBe('ordered');
    expect(sourceOfStored({ fulfillmentSource: 'local' })).toBe('local');
  });
});

describe('LensStockMoves', () => {
  it('takes one lens per eye and records the rows', async () => {
    const { tx, updates } = fakeTx([row('a')]);
    const m = new LensStockMoves(tx);
    await m.load([line()], []);
    expect(m.take(line())).toEqual([{ row: 'a', qty: 2 }]);
    await m.write();
    expect(updates).toEqual({ a: 4 });
  });

  it('refuses a counter line the shelf cannot fill and changes nothing', async () => {
    const { tx, updates } = fakeTx([row('a', { quantity: 1 })]);
    const m = new LensStockMoves(tx);
    await m.load([line()], []);
    expect(() => m.take(line())).toThrow(LensStockShortError);
    await m.write();
    expect(updates).toEqual({});
  });

  it('puts recorded lenses back (counter -> wholesaler, line removed, bill deleted)', async () => {
    const { tx, updates } = fakeTx([row('a', { quantity: 4 })]);
    const m = new LensStockMoves(tx);
    await m.load([], [[{ row: 'a', qty: 2 }]]);
    m.give([{ row: 'a', qty: 2 }]);
    await m.write();
    expect(updates).toEqual({ a: 6 });
  });

  it('swaps lenses when a counter line changes power', async () => {
    const { tx, updates } = fakeTx([row('a', { quantity: 4 }), row('b', { add: 2.5, quantity: 3 })]);
    const m = new LensStockMoves(tx);
    const after = line({ rightAddition: 2.5, leftAddition: 2.5 });
    await m.load([after], [[{ row: 'a', qty: 2 }]]);
    m.give([{ row: 'a', qty: 2 }]);
    expect(m.take(after)).toEqual([{ row: 'b', qty: 2 }]);
    await m.write();
    expect(updates).toEqual({ a: 6, b: 1 });
  });

  it('skips a row deleted since the bill', async () => {
    const { tx, updates } = fakeTx([]);
    const m = new LensStockMoves(tx);
    await m.load([], [[{ row: 'gone', qty: 2 }]]);
    m.give([{ row: 'gone', qty: 2 }]);
    await m.write();
    expect(updates).toEqual({});
  });
});

describe('matching', () => {
  it('matches names ignoring case, plus cyl to minus cyl, and checks ADD and axis', () => {
    const d = { lensType: 'Single Vision', material: 'fiber', coating: 'HARD COAT', color: 'white', sph: -0.5, cyl: 0.5, axis: 90, add: 0 };
    expect(stockRowFits(row('a', { lensType: 'Single Vision', sph: 0, cyl: -0.5, axis: 180, add: null }), d)).toBe(true);
    expect(stockRowFits(row('a', { add: 2.5 }), { ...d, lensType: 'Progressive', sph: 0, cyl: 0, axis: null, add: 2 })).toBe(false);
    expect(stockRowFits(row('a', { lensType: 'Bifocal', cyl: -1, axis: 90 }), { ...d, lensType: 'Bifocal', sph: 0, cyl: -1, axis: 45, add: 2 })).toBe(false);
  });

  it('sees a power change but not a cosmetic edit', () => {
    expect(needsKey(line())).toBe(needsKey(line({ lensCoating: 'hard coat', price: 900 })));
    expect(needsKey(line())).not.toBe(needsKey(line({ rightAddition: 2.25 })));
  });
});

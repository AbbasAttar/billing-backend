import { describe, it, expect } from 'vitest';
import { moveFrameStock, restoreFrameLine } from '../src/services/invoiceLineProduct';

const frame = () => ({
  _id: 'f1', stock: 5,
  web: { frameVariants: [{ colors: [{ name: 'Black' }], size: 52, stock: 3 }, { colors: [{ name: 'Gold' }], size: 52, stock: 2 }] },
});

describe('frame stock on bills', () => {
  it('a sale takes pieces off the total and the variant picked', () => {
    const pending = new Map<string, any>();
    moveFrameStock('f1', frame(), 'Black · 52mm', -2, pending);
    expect(pending.get('f1').stock).toBe(3);
    expect(pending.get('f1')['web.frameVariants'].map((v: any) => v.stock)).toEqual([1, 2]);
  });

  it('without a variant only the total moves, and never below 0', () => {
    const pending = new Map<string, any>();
    moveFrameStock('f1', { _id: 'f1', stock: 1 }, undefined, -3, pending);
    expect(pending.get('f1')).toEqual({ stock: 0 });
  });

  it('two moves on the same frame add up (edit: old back, new off)', () => {
    const pending = new Map<string, any>();
    moveFrameStock('f1', frame(), 'Black · 52mm', 1, pending);
    moveFrameStock('f1', frame(), 'Gold · 52mm', -2, pending);
    expect(pending.get('f1').stock).toBe(4);
    expect(pending.get('f1')['web.frameVariants'].map((v: any) => v.stock)).toEqual([4, 0]);
  });

  it('putting a line back: newer lines restore the total, older lines only their variant', () => {
    const newer = new Map<string, any>();
    restoreFrameLine({ frame: 'f1', quantity: 1, frameVariantLabel: 'Gold · 52mm', frameStockTaken: true }, frame(), newer);
    expect(newer.get('f1').stock).toBe(6);
    expect(newer.get('f1')['web.frameVariants'][1].stock).toBe(3);

    const older = new Map<string, any>();
    restoreFrameLine({ frame: 'f1', quantity: 1, frameVariantLabel: 'Gold · 52mm' }, frame(), older);
    expect(older.get('f1').stock).toBeUndefined();
    expect(older.get('f1')['web.frameVariants'][1].stock).toBe(3);

    const plainOld = new Map<string, any>();
    restoreFrameLine({ frame: 'f1', quantity: 1 }, frame(), plainOld);
    expect(plainOld.size).toBe(0);
  });
});

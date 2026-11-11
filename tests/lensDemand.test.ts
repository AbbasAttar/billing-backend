import { describe, expect, it } from 'vitest';
import { buildPowerDemand } from '../src/services/lensDemand';

const kind = { lensType: 'Single Vision', lensMaterial: 'Fiber', lensCoating: 'Hard Coat', lensColor: 'White' };
const counter = { fulfillmentSource: 'stock', sentToWholesaler: false };
const ordered = { fulfillmentSource: 'ordered' };

describe('buildPowerDemand', () => {
  it('splits pieces sold into off-shelf and elsewhere', () => {
    const out = buildPowerDemand([
      { ...kind, ...counter, quantity: 1, rightSpherical: -1, leftSpherical: -1 },
      { ...kind, ...ordered, eye: 'right', quantity: 1, rightSpherical: -1 },
    ] as any[], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sph: -1, cyl: 0, add: null, sold: 3, fromShelf: 2, elsewhere: 1, onOrder: 0 });
  });

  it('ignores ADD on single vision and keeps it on bifocal', () => {
    const out = buildPowerDemand([
      { ...kind, ...ordered, eye: 'right', rightSpherical: 1, rightAddition: 2 },
      { ...kind, lensType: 'Bifocal', ...ordered, eye: 'right', rightSpherical: 1, rightAddition: 2 },
    ] as any[], []);
    expect(out.find((d) => d.lensType === 'Single Vision')?.add).toBeNull();
    expect(out.find((d) => d.lensType === 'Bifocal')?.add).toBe(2);
  });

  it('counts pending shelf purchases as on order, in pieces', () => {
    const out = buildPowerDemand([], [
      { status: 'pending', lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat', color: 'White', eye: 'both', sph: -1, cyl: 0, qty: 3 },
      { status: 'pending', lensType: 'Single Vision', material: 'Fiber', coating: 'hard coat', color: 'white', eye: 'right', sph: -1, cyl: 0, qty: 1 },
      { status: 'pending', importedFrom: 'bill', lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat', color: 'White', eye: 'both', sph: -1, cyl: 0, qty: 5 },
      { status: 'received', lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat', color: 'White', eye: 'both', sph: -1, cyl: 0, qty: 5 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sold: 0, onOrder: 7 });
  });

  it('matches plus-cyl purchases to minus-cyl sales', () => {
    const out = buildPowerDemand(
      [{ ...kind, ...ordered, eye: 'right', rightSpherical: -0.5, rightCylinder: -0.5, rightAxis: 180 }] as any[],
      [{ status: 'pending', lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat', color: 'White', eye: 'right', sph: -1, cyl: 0.5, qty: 2 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sph: -0.5, cyl: -0.5, sold: 1, onOrder: 2 });
  });
});

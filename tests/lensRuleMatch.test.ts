import { describe, it, expect } from 'vitest';
import { cylInRange, sphInRange, addInRange, pickBestRule } from '../src/services/lensRuleMatch';

const rule = (o: Partial<Parameters<typeof pickBestRule>[0][number]> & { id?: string }) => ({
  minSph: 0, maxSph: 6, minCyl: 0, maxCyl: 2, minAdd: null, maxAdd: null, axisType: 'any', ...o,
});

describe('lensRuleMatch', () => {
  it('keeps SPH signed — minus and plus are priced separately', () => {
    expect(sphInRange({ minSph: 0, maxSph: 6 }, 3)).toBe(true);
    expect(sphInRange({ minSph: 0, maxSph: 6 }, -3)).toBe(false);
    expect(sphInRange({ minSph: -6, maxSph: 0 }, -3)).toBe(true);
  });

  it('matches CYL by size whichever way the range or prescription is written', () => {
    expect(cylInRange({ minCyl: -2, maxCyl: 0 }, -1)).toBe(true);
    expect(cylInRange({ minCyl: -2, maxCyl: 0 }, 1)).toBe(true);
    expect(cylInRange({ minCyl: 0, maxCyl: 2 }, -1.5)).toBe(true);
    expect(cylInRange({ minCyl: 2.25, maxCyl: 4 }, -1)).toBe(false);
    expect(cylInRange({ minCyl: 2.25, maxCyl: 4 }, -3)).toBe(true);
  });

  it('only matches ADD rules when the prescription has an ADD', () => {
    expect(addInRange({ minAdd: null, maxAdd: null }, null)).toBe(true);
    expect(addInRange({ minAdd: 1.5, maxAdd: 3 }, null)).toBe(false);
    expect(addInRange({ minAdd: 1.5, maxAdd: 3 }, 2)).toBe(true);
    expect(addInRange({ minAdd: null, maxAdd: null }, 2)).toBe(false);
  });

  it('prefers an exact axis type, then the narrowest range', () => {
    const wide = rule({ id: 'wide', minSph: 0, maxSph: 8 });
    const narrow = rule({ id: 'narrow', minSph: 0, maxSph: 4 });
    const ready = rule({ id: 'ready', minSph: 0, maxSph: 8, axisType: 'ready' });
    expect(pickBestRule([wide, narrow], { sph: 2, cyl: 0, add: null })?.id).toBe('narrow');
    expect(pickBestRule([wide, narrow, ready], { sph: 2, cyl: 0, add: null, axisType: 'ready' })?.id).toBe('ready');
    expect(pickBestRule([wide], { sph: -2, cyl: 0, add: null })).toBeNull();
  });
});

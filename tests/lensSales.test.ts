import { describe, expect, it } from 'vitest';
import { bucketKey, bucketRange, canonicalLensType, eyeSales, linePairs, normalizeLensLine, share, trendGranularity } from '../src/services/lensSales';

describe('lensSales.eyeSales', () => {
  it('splits a pair line into two pieces and counts revenue once', () => {
    const e = eyeSales({ quantity: 1, price: 1000, rightSpherical: -1, rightCylinder: -0.5, leftSpherical: -1.25 });
    expect(e).toHaveLength(2);
    expect(e.reduce((s, x) => s + x.pieces, 0)).toBe(2);
    expect(e.reduce((s, x) => s + x.revenue, 0)).toBe(1000);
    expect(e[0].unitPrice).toBe(500);
    expect(e[1]).toMatchObject({ eye: 'left', sph: -1.25, cyl: 0 });
  });

  it('only counts the eye a single-eye line covers', () => {
    const e = eyeSales({ eye: 'right', quantity: 1, price: 600, rightSpherical: -2, leftSpherical: -3 });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ eye: 'right', sph: -2, pieces: 1, revenue: 600, unitPrice: 600 });
  });

  it('weights pieces by quantity', () => {
    const e = eyeSales({ quantity: 3, price: 400, rightSpherical: -1, leftSpherical: -1 });
    expect(e.map((x) => x.pieces)).toEqual([3, 3]);
    expect(e.reduce((s, x) => s + x.revenue, 0)).toBe(1200);
  });

  it('turns plus cyl into minus cyl like stock', () => {
    const [e] = eyeSales({ eye: 'right', rightSpherical: -1, rightCylinder: 0.5, rightAxis: 90 });
    expect(e).toMatchObject({ sph: -0.5, cyl: -0.5 });
  });

  it('falls back to old flat fields only when no eye power exists', () => {
    expect(eyeSales({ spherical: -1.5, addition: 2 })).toEqual([
      expect.objectContaining({ eye: 'single', sph: -1.5, add: 2, pieces: 1 }),
    ]);
    expect(eyeSales({ rightSpherical: -1, spherical: -4 })).toHaveLength(1);
  });

  it('drops ADD of zero', () => {
    expect(eyeSales({ rightSpherical: 1, rightAddition: 0 })[0].add).toBeNull();
  });
});

describe('lensSales helpers', () => {
  it('counts a single-eye line as half a pair', () => {
    expect(linePairs({ eye: 'left', quantity: 1 })).toBe(0.5);
    expect(linePairs({ quantity: 2 })).toBe(2);
  });

  it('share uses the whole population', () => {
    expect(share(10, 40)).toBe(25);
    expect(share(1, 0)).toBe(0);
  });

  it('buckets by IST week (Monday) and month', () => {
    // Sunday 23:00 UTC = Monday 04:30 IST
    expect(bucketKey('2026-11-08T23:00:00Z', 'week')).toBe('2026-11-09');
    expect(bucketKey('2026-11-08T10:00:00Z', 'week')).toBe('2026-11-02');
    expect(bucketKey('2026-10-31T20:00:00Z', 'month')).toBe('2026-11');
  });

  it('lists every bucket in the range, including empty ones', () => {
    const weeks = bucketRange(new Date('2026-10-01T06:00:00Z'), new Date('2026-11-11T06:00:00Z'), 'week');
    expect(weeks[0]).toBe('2026-09-28');
    expect(weeks[weeks.length - 1]).toBe('2026-11-09');
    expect(weeks).toHaveLength(7);
    const months = bucketRange(new Date('2026-01-31T06:00:00Z'), new Date('2026-05-02T06:00:00Z'), 'month');
    expect(months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  });

  it('uses weeks up to 90 days', () => {
    expect(trendGranularity(90)).toBe('week');
    expect(trendGranularity(180)).toBe('month');
  });
});

describe('lens type names', () => {
  it('counts Kryptok Bifocal as the shop Bifocal, keeps D-Bifocal apart', () => {
    expect(canonicalLensType('Kryptok Bifocal')).toBe('Bifocal');
    expect(canonicalLensType(' kryptok bifocal ')).toBe('Bifocal');
    expect(canonicalLensType('KT Bifocal')).toBe('Bifocal');
    expect(canonicalLensType('D-Bifocal')).toBe('D-Bifocal');
    expect(canonicalLensType('Progressive')).toBe('Progressive');
    expect(canonicalLensType(null)).toBeNull();
  });

  it('normalizes type and category on a line', () => {
    expect(normalizeLensLine({ lensType: 'Kryptok Bifocal', lensCategory: 'Kryptok Bifocal' })).toMatchObject({ lensType: 'Bifocal', lensCategory: 'Bifocal' });
    const same = { lensType: 'Single Vision' };
    expect(normalizeLensLine(same)).toBe(same);
  });
});

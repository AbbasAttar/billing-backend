import { describe, it, expect } from 'vitest';
import { buildLensName, effectiveShortName, type LensShortNames } from '../src/services/lensShortNames';

const shorts = (o: Partial<Record<keyof LensShortNames, Record<string, string>>> = {}): LensShortNames => ({
  coating: new Map(Object.entries(o.coating ?? {})),
  material: new Map(Object.entries(o.material ?? {})),
  color: new Map(Object.entries(o.color ?? {})),
});

describe('effectiveShortName', () => {
  it('uses the stored short name, even an empty one', () => {
    expect(effectiveShortName({ kind: 'material', name: 'Fiber', shortName: 'CR39' })).toBe('CR39');
    expect(effectiveShortName({ kind: 'material', name: 'Fiber', shortName: '' })).toBe('');
  });

  it('falls back to the old built-in codes, else nothing', () => {
    expect(effectiveShortName({ kind: 'material', name: 'Fiber' })).toBe('CR');
    expect(effectiveShortName({ kind: 'color', name: 'Photo Chromatic' })).toBe('PG');
    expect(effectiveShortName({ kind: 'color', name: 'White' })).toBe('');
    expect(effectiveShortName({ kind: 'material', name: 'Trivex' })).toBe('');
  });
});

describe('buildLensName', () => {
  const item = { lensColor: 'Photo Chromatic', lensMaterial: 'Fiber', lensCoating: 'Blue Cut', lensType: 'Bifocal' };

  it('prints the same codes as before when nothing is customised', () => {
    expect(buildLensName(item)).toBe('PG CR Blue Cut KT');
    expect(buildLensName({ ...item, lensColor: 'White', lensType: 'Single Vision' })).toBe('CR Blue Cut');
  });

  it('uses the shop’s short names', () => {
    const s = shorts({ color: { 'Photo Chromatic': 'PB' }, material: { Fiber: 'CR39' }, coating: { 'Blue Cut': 'BC' } });
    expect(buildLensName(item, s)).toBe('PB CR39 BC KT');
  });

  it('leaves out entries whose short name is blank', () => {
    expect(buildLensName(item, shorts({ material: { Fiber: '' } }))).toBe('PG Blue Cut KT');
  });

  it('keeps the gradal code for colours without a short name', () => {
    expect(buildLensName({ lensColor: 'Brown Gradal', lensMaterial: 'Glass' })).toBe('GRD Glass');
  });
});

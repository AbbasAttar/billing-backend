import { describe, it, expect } from 'vitest';
import { cleanList } from '../src/controllers/fragrancePresets.controller';

describe('fragrance presets', () => {
  it('trims, drops blanks and case-insensitive duplicates, keeps order', () => {
    expect(cleanList([' Oud ', 'rose', 'OUD', '', 7, 'Sandal  wood', 'Rose'])).toEqual(['Oud', 'rose', 'Sandal wood']);
    expect(cleanList('nope')).toEqual([]);
  });
});

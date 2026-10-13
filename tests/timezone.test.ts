import { describe, it, expect } from 'vitest';
import '../src/config/timezone';

describe('process timezone', () => {
  it('uses India time for local date getters', () => {
    // 12 Oct 2026, 00:00 IST
    const d = new Date('2026-10-11T18:30:00Z');
    expect(d.getDate()).toBe(12);
    expect(d.getHours()).toBe(0);
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    expect(start.toISOString()).toBe('2026-10-11T18:30:00.000Z');
  });
});

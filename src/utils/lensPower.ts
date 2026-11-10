/**
 * One lens power can be written two ways: minus cyl or plus cyl.
 *   0.00 / -0.50 × 180  ==  -0.50 / +0.50 × 90
 * Transposing: new SPH = SPH + CYL, new CYL = −CYL, axis turns 90°.
 * Stock is always kept in minus cyl so the same lens never appears twice under two spellings.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Axis turned 90° (0 is read as 180; result stays 1–180). */
export const turnAxis = (axis: number): number => {
  const a = axis === 0 ? 180 : axis;
  return a <= 90 ? a + 90 : a - 90;
};

/** The same power written in minus cyl. Minus-cyl and no-cyl powers come back unchanged. */
export function toMinusCyl<T extends number | null | undefined>(sph: number, cyl: number, axis: T): { sph: number; cyl: number; axis: T | number } {
  if (!(cyl > 0)) return { sph, cyl, axis };
  return { sph: r2(sph + cyl), cyl: r2(-cyl), axis: typeof axis === 'number' ? turnAxis(axis) : axis };
}

/**
 * One rule for matching a prescription to LensPricing ranges, shared by every lookup.
 *
 * - SPH is signed: minus and plus powers are priced separately (owner decision, Nov 2026).
 * - CYL is matched by size: its sign is only notation (minus-cyl vs plus-cyl form), so a rule
 *   written "-2..0" and one written "0..2" both cover a -1.00 or +1.00 cylinder.
 * - ADD is always positive; rules with no ADD range only match prescriptions without ADD.
 *
 * Prices on LensPricing are per PAIR (owner decision, Nov 2026).
 */
export interface PowerRange {
  minSph: number;
  maxSph: number;
  minCyl: number;
  maxCyl: number;
  minAdd?: number | null;
  maxAdd?: number | null;
}

const EPS = 0.001;

export function cylBounds(rule: Pick<PowerRange, 'minCyl' | 'maxCyl'>): [number, number] {
  const a = Math.abs(rule.minCyl);
  const b = Math.abs(rule.maxCyl);
  // A range crossing zero (e.g. -2..+1) covers sizes 0..2.
  const crossesZero = Math.sign(rule.minCyl) * Math.sign(rule.maxCyl) < 0;
  return [crossesZero ? 0 : Math.min(a, b), Math.max(a, b)];
}

export function sphInRange(rule: Pick<PowerRange, 'minSph' | 'maxSph'>, sph: number): boolean {
  const lo = Math.min(rule.minSph, rule.maxSph);
  const hi = Math.max(rule.minSph, rule.maxSph);
  return sph >= lo - EPS && sph <= hi + EPS;
}

export function cylInRange(rule: Pick<PowerRange, 'minCyl' | 'maxCyl'>, cyl: number): boolean {
  const [lo, hi] = cylBounds(rule);
  const size = Math.abs(cyl);
  return size >= lo - EPS && size <= hi + EPS;
}

/** add = null means the prescription has no ADD. */
export function addInRange(rule: Pick<PowerRange, 'minAdd' | 'maxAdd'>, add: number | null): boolean {
  const ruleHasAdd = rule.minAdd !== null && rule.minAdd !== undefined;
  if (add === null) return !ruleHasAdd;
  if (!ruleHasAdd) return false;
  const lo = rule.minAdd as number;
  const hi = rule.maxAdd ?? lo;
  return add >= lo - EPS && add <= hi + EPS;
}

export function ruleCoversRx(rule: PowerRange, sph: number, cyl: number, add: number | null): boolean {
  return sphInRange(rule, sph) && cylInRange(rule, cyl) && addInRange(rule, add);
}

/** Narrower ranges are more specific — used to pick the best of several matching rules. */
export function rangeWidth(rule: PowerRange): number {
  const [clo, chi] = cylBounds(rule);
  return Math.abs(rule.maxSph - rule.minSph) + (chi - clo);
}

type RankableRule = PowerRange & { axisType?: string };

/**
 * Best rule for one eye: exact axisType beats 'any', then the narrowest range wins.
 * Returns null when no rule covers the prescription.
 */
export function pickBestRule<T extends RankableRule>(
  rules: T[],
  rx: { sph: number; cyl: number; add: number | null; axisType?: string },
): T | null {
  const axisType = rx.axisType ?? 'any';
  const hits = rules.filter(
    (r) => (r.axisType === axisType || r.axisType === 'any' || !r.axisType) && ruleCoversRx(r, rx.sph, rx.cyl, rx.add),
  );
  hits.sort(
    (a, b) =>
      (a.axisType === 'any' ? 1 : 0) - (b.axisType === 'any' ? 1 : 0) || rangeWidth(a) - rangeWidth(b),
  );
  return hits[0] ?? null;
}

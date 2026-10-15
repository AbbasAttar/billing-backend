/**
 * Catch-all products the counter uses when the real item is not recorded:
 * - fragrance "Wholesale": mixed sales (older bills)
 * - fragrance "Attar": a retail attar sale where the exact attar was not noted
 * - frame "Unknown": a frame whose cost is not known (only the company is)
 * - frame "Wholesale" / "Quick Add": billing shortcuts for frames sold without picking the model
 * Their sales count in revenue and in their category, but not in margin, "no cost price" lists,
 * top sellers or stock lists, since there is no real product or cost behind them.
 */
const FRAGRANCE_NAMES = ['wholesale', 'attar'];
const FRAME_NAMES = ['unknown', 'wholesale', 'quick add'];

const norm = (name?: string) => (name ?? '').trim().toLowerCase();

export const isCatchAllFragrance = (f: { name?: string }) => FRAGRANCE_NAMES.includes(norm(f.name));
/** Fragrance "Wholesale": mixed wholesale orders billed as one line. Counts as wholesale, not retail. */
export const isWholesaleMixFragrance = (f: { name?: string }) => norm(f.name) === 'wholesale';
export const wholesaleMixIds = (fragrances: { _id: unknown; name?: string }[]) =>
  new Set(fragrances.filter(isWholesaleMixFragrance).map((f) => String(f._id)));

export const isCatchAllFrame = (f: { name?: string }) => FRAME_NAMES.includes(norm(f.name));

export const catchAllIds = (frames: { _id: unknown; name?: string }[], fragrances: { _id: unknown; name?: string }[]) =>
  new Set([...frames.filter(isCatchAllFrame), ...fragrances.filter(isCatchAllFragrance)].map((d) => String(d._id)));

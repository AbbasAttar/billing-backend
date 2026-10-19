/**
 * Bill lines and their product (frame / fragrance): the unit cost a line takes, and stock moved on a
 * colour / grade when a line's product changes.
 */

/** Same label rule as the admin UI uses to name a frame variant: colours, eye size, reading type and addition. */
export const frameVariantName = (v: any) =>
  v.label ||
  [
    (v.colors ?? []).map((c: any) => c.name).join(' + '),
    v.size ? `${v.size}mm` : '',
    v.readingType ?? '',
    v.power ? `${v.power > 0 ? '+' : '-'}${Math.abs(Number(v.power)).toFixed(2)}` : '',
  ].filter(Boolean).join(' · ');

/** Unit cost of a frame or fragrance (its size / grade first), as a new bill line would take it. */
export function productCost(kind: 'frame' | 'fragrance', doc: any, label?: string | null): number {
  if (kind === 'fragrance') {
    const v = label && doc?.variants?.length ? doc.variants.find((x: any) => x.label === label) : null;
    return v?.costPrice || doc?.costPrice || 0;
  }
  return doc?.costPrice || 0;
}

/**
 * Moves `delta` units on a product's colour / grade (frames: web.frameVariants, fragrances: variants),
 * recorded in `pending` (one $set per product). Products without that option are left alone, as on a new bill.
 */
export function moveOptionStock(kind: 'frame' | 'fragrance', id: string, doc: any, label: string | null | undefined, delta: number, pending: Map<string, any>) {
  if (!label || !doc) return;
  const key = kind === 'frame' ? 'web.frameVariants' : 'variants';
  const update = pending.get(id) ?? {};
  const variants: any[] | undefined = update[key] ?? (kind === 'frame' ? doc.web?.frameVariants : doc.variants);
  if (!variants?.length) return;
  const nameOf = kind === 'frame' ? frameVariantName : (v: any) => v.label;
  const idx = variants.findIndex((v: any) => nameOf(v) === label);
  if (idx < 0) return;
  const copy = variants.map((v: any) => ({ ...v }));
  copy[idx].stock = Math.max(0, (copy[idx].stock || 0) + delta);
  update[key] = copy;
  pending.set(id, update);
}

/**
 * Moves `delta` pieces on a frame: its total stock and, when a variant is named, that variant too.
 * Recorded in `pending` (one $set per frame). Stock never goes below 0.
 */
export function moveFrameStock(id: string, doc: any, label: string | null | undefined, delta: number, pending: Map<string, any>) {
  if (!doc || !delta) return;
  const update = pending.get(id) ?? {};
  const current = typeof update.stock === 'number' ? update.stock : Number(doc.stock) || 0;
  update.stock = Math.max(0, current + delta);
  pending.set(id, update);
  moveOptionStock('frame', id, doc, label, delta, pending);
}

/**
 * Frame lines billed since total stock started moving carry `frameStockTaken`; older lines only ever
 * took their variant. Putting a line's pieces back follows the same rule, so old bills do not add
 * stock that was never taken off.
 */
export function restoreFrameLine(item: any, doc: any, pending: Map<string, any>) {
  if (!item?.frame || !doc) return;
  const qty = item.quantity || 1;
  const id = String(item.frame?._id ?? item.frame);
  if (item.frameStockTaken) moveFrameStock(id, doc, item.frameVariantLabel, qty, pending);
  else moveOptionStock('frame', id, doc, item.frameVariantLabel, qty, pending);
}

/**
 * Merging a duplicate fragrance into the one to keep: stock moves over (per grade / size when both
 * have them), missing cost / wholesale price / notes are filled from the duplicate, and the duplicate
 * is archived (not deleted) so old bills still show it.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export function mergePlan(keep: any, dup: any): { update: Record<string, unknown> } | { error: string } {
  if (String(keep._id) === String(dup._id)) return { error: 'Pick two different products' };
  const kv: any[] = keep.variants ?? [];
  const dv: any[] = dup.variants ?? [];
  const update: Record<string, unknown> = {};

  if (kv.length === 0 && dv.length === 0) {
    update.stock = round2((keep.stock ?? 0) + (dup.stock ?? 0));
    if (!(keep.costPrice > 0) && dup.costPrice > 0) update.costPrice = dup.costPrice;
    if (!keep.wholesale && dup.wholesale) update.wholesale = dup.wholesale;
    if (!keep.recipe?.length && dup.recipe?.length) update.recipe = dup.recipe;
  } else if (kv.length > 0 && dv.length > 0) {
    // Same grade / size (ignoring case) adds up; new ones are added.
    const variants = kv.map((v) => ({ ...v }));
    for (const d of dv) {
      const hit = variants.find((v) => v.label.trim().toLowerCase() === String(d.label).trim().toLowerCase());
      if (hit) {
        hit.stock = round2((hit.stock ?? 0) + (d.stock ?? 0));
        if (!(hit.costPrice > 0) && d.costPrice > 0) hit.costPrice = d.costPrice;
        if (!hit.wholesale && d.wholesale) hit.wholesale = d.wholesale;
      } else {
        variants.push({ ...d });
      }
    }
    update.variants = variants;
    update.stock = round2(variants.reduce((s, v) => s + (v.stock || 0), 0));
  } else {
    return { error: 'One has grades / sizes and the other does not. Give the plain one a grade or size first, then merge.' };
  }

  const ch = { ...(keep.channels ?? { retail: true }) };
  for (const k of ['retail', 'wholesale', 'rawMaterial']) if (dup.channels?.[k]) ch[k] = true;
  update.channels = ch;
  for (const k of ['top', 'heart', 'base']) {
    const merged = [...new Set([...(keep.scent?.[k] ?? []), ...(dup.scent?.[k] ?? [])])];
    if (merged.length) update[`scent.${k}`] = merged;
  }
  if (!keep.gender && dup.gender) update.gender = dup.gender;
  if (!keep.web?.images?.length && dup.web?.images?.length) update['web.images'] = dup.web.images;
  return { update };
}

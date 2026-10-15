/**
 * "Made from" stock: selling a retail fragrance whose option (or plain product) has a recipe, with
 * `recipeDeductsStock` ticked, takes the ingredients (bulk oil, bottle…) out of stock too.
 * Recipe quantities are in each ingredient's own stock unit, so no conversion is needed.
 */

export type RecipeLine = { fragranceId: string; optionLabel?: string; qty: number };

/** The recipe that applies to one sold line, or [] when the product does not use its recipe for stock. */
export function recipeFor(f: any, grade?: string | null): RecipeLine[] {
  if (!f?.recipeDeductsStock) return [];
  if (grade && f.variants?.length) {
    const v = f.variants.find((x: any) => x.label === grade);
    return v?.recipe ?? [];
  }
  return f.variants?.length ? [] : f.recipe ?? [];
}

/** Ingredient ids to read before any write. */
export const recipeIngredientIds = (recipes: RecipeLine[][]) => [...new Set(recipes.flat().map((l) => l.fragranceId))];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Takes `soldQty` units' worth of each ingredient off the pending fragrance updates. */
export function applyRecipeStock(recipe: RecipeLine[], soldQty: number, fragrances: Map<string, any>, updates: Map<string, Record<string, any>>) {
  for (const line of recipe) {
    const f = fragrances.get(line.fragranceId);
    if (!f || !(line.qty > 0)) continue;
    const take = line.qty * soldQty;
    const update = updates.get(line.fragranceId) ?? {};
    const variants: any[] | undefined = update.variants ?? f.variants;
    if (line.optionLabel && variants?.length) {
      const copy = variants.map((v: any) => ({ ...v }));
      const idx = copy.findIndex((v: any) => v.label === line.optionLabel);
      if (idx >= 0) {
        copy[idx].stock = Math.max(0, round2((copy[idx].stock || 0) - take));
        update.variants = copy;
      }
    } else {
      update.stock = Math.max(0, round2((update.stock ?? f.stock ?? 0) - take));
    }
    updates.set(line.fragranceId, update);
  }
}

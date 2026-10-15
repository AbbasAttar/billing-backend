import { describe, it, expect } from 'vitest';
import { applyRecipeStock, recipeFor, recipeIngredientIds } from '../src/services/recipeStock';

const premium12 = {
  recipeDeductsStock: true,
  variants: [{ label: 'Premium 12ml', recipe: [{ fragranceId: 'oil', optionLabel: 'Bulk', qty: 1 }, { fragranceId: 'bottle', qty: 1 }] }],
};

describe('made-from stock', () => {
  it('only when the product is set to use its recipe', () => {
    expect(recipeFor(premium12, 'Premium 12ml')).toHaveLength(2);
    expect(recipeFor({ ...premium12, recipeDeductsStock: false }, 'Premium 12ml')).toEqual([]);
    expect(recipeFor({ recipeDeductsStock: true, recipe: [{ fragranceId: 'x', qty: 2 }], variants: [] }, null)).toHaveLength(1);
    expect(recipeIngredientIds([recipeFor(premium12, 'Premium 12ml'), [{ fragranceId: 'oil', qty: 1 }]])).toEqual(['oil', 'bottle']);
  });

  it('takes ingredients out for the quantity sold, merging with other changes', () => {
    const frs = new Map<string, any>([
      ['oil', { variants: [{ label: 'Bulk', stock: 10 }] }],
      ['bottle', { stock: 50, variants: [] }],
    ]);
    const updates = new Map<string, Record<string, any>>([['bottle', { stock: 49 }]]);
    applyRecipeStock(recipeFor(premium12, 'Premium 12ml'), 3, frs, updates);
    expect(updates.get('oil')!.variants[0].stock).toBe(7);
    expect(updates.get('bottle')!.stock).toBe(46);
  });
});

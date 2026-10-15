/**
 * Wholesale lines on bills: which record they take stock from, and the stock change.
 *
 * A line's `wholesaleItem` is either a wholesale entry key on the fragrance catalogue
 * ("<fragranceId>" or "<fragranceId>~<option>"), or — on bills made before the catalogue merge — the id
 * of an old wholesale item. An old item that was moved points to its fragrance (`migratedTo`), so its
 * stock is changed there.
 */
import { parseEntryKey, stockPerWholesaleUnit, stockUnitOf } from './wholesaleCatalog';

export interface WsTarget {
  fragranceId: string;
  optionLabel: string | null;
}

/** Ids to read: old wholesale items (keys without "~") and fragrances. */
export function wholesaleReadIds(keys: string[]) {
  const legacyIds = keys.filter((k) => !k.includes('~'));
  const fragranceIds = new Set(keys.map((k) => parseEntryKey(k).fragranceId));
  return { legacyIds, fragranceIds };
}

/** Where a line's stock lives, or null for an old (unmoved) wholesale item. */
export function resolveWsTarget(key: string, fragrances: Map<string, any>, legacy: Map<string, any>): WsTarget | null {
  const parsed = parseEntryKey(key);
  if (fragrances.has(parsed.fragranceId)) return parsed;
  const old = legacy.get(key);
  if (old?.migratedTo && fragrances.has(String(old.migratedTo))) return { fragranceId: String(old.migratedTo), optionLabel: null };
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Applies `qty` wholesale units (negative = sold, positive = put back) to the pending fragrance update.
 * Returns the cost of one wholesale unit for the bill line (null when unknown) and a display name.
 */
export function applyWsStock(
  target: WsTarget,
  qty: number,
  f: any,
  update: Record<string, any>,
): { unitCost: number | null; name: string; unit: string } {
  const variants: any[] | undefined = update.variants ?? f.variants;
  if (target.optionLabel && variants?.length) {
    const copy = variants.map((v: any) => ({ ...v }));
    const idx = copy.findIndex((v: any) => v.label === target.optionLabel);
    if (idx >= 0) {
      const v = copy[idx];
      const per = stockPerWholesaleUnit(v.wholesale?.unit, stockUnitOf(f));
      v.stock = Math.max(0, round2((v.stock || 0) + qty * per));
      update.variants = copy;
      const cost = v.costPrice ?? f.costPrice;
      return {
        unitCost: cost && cost > 0 ? round2(cost * per) : null,
        name: `${f.name} · ${v.label}${f.companyName ? ` (${f.companyName})` : ''}`,
        unit: (v.wholesale?.unit ?? 'per bottle').replace(/^per\s+/i, ''),
      };
    }
  }
  const per = stockPerWholesaleUnit(f.wholesale?.unit, stockUnitOf(f));
  const current = update.stock ?? f.stock ?? 0;
  update.stock = Math.max(0, round2(current + qty * per));
  return {
    unitCost: f.costPrice && f.costPrice > 0 ? round2(f.costPrice * per) : null,
    name: f.companyName ? `${f.name} (${f.companyName})` : f.name,
    unit: (f.wholesale?.unit ?? `per ${stockUnitOf(f)}`).replace(/^per\s+/i, ''),
  };
}
